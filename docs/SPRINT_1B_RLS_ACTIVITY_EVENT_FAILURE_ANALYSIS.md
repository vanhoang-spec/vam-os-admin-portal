# Sprint 1B RLS Activity/Event Failure Analysis

Date: 2026-04-29

## Executive Summary

Sprint 1B RLS likely caused Operations activity/event data loss because the protected Next.js routes prove the user is logged in, but the shared Supabase data layer still queries tables with the exported anon client from `lib/supabase.ts`. That client does not attach the current user's Supabase access token, so database policies that depend on `auth.uid()` evaluate as unauthenticated/anonymous for the actual data reads.

This explains why disabling RLS on `mentoring_recaps` and `event_participations` restored recap/activity rows, while the event KPI could remain zero: Operations filters event participation rows through the visible `events` rows. If `events` RLS is still enabled and the query is running without user auth context, `eventsInMonth` becomes empty, `eventIdsInMonth` becomes empty, and attended event participation counts are filtered to zero even if `event_participations` is visible again.

No code, data, or migrations were changed for this analysis.

## Requested Files Inspected

- `lib/supabase.ts`
- `lib/data.ts`
- `lib/admin-auth.ts`
- `middleware.ts`
- `app/operations/page.tsx`

Related context also reviewed:

- `supabase_migrations/018_draft_rls_read_policies.sql`
- Sprint 1B RLS planning/test docs under `docs/`

## How Operations Fetches Data

`app/operations/page.tsx` calls `getOperationsData()` and `getCurrentAdminUser()` in parallel.

`getOperationsData()` fetches these tables through `selectAllTable()`:

| Operations need | Table | Fetch code path | Client/auth context |
| --- | --- | --- | --- |
| seasons | `seasons` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| people | `people` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| mentee profiles | `mentee_profiles` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| matches | `matches` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| mentoring recaps | `mentoring_recaps` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| events | `events` | `getOperationsData()` -> `selectAllTable()` | shared anon client |
| event participations | `event_participations` | `getOperationsData()` -> `selectAllTable()` | shared anon client |

Profile pages use the same pattern for activity detail:

- `getMentoringRecapsByMenteePersonId()` queries `mentoring_recaps` with the shared anon client.
- `getMentoringRecapsByMentorPersonId()` queries `mentoring_recaps` with the shared anon client.
- `getEventParticipationsByPersonId()` queries `event_participations` with the shared anon client.
- `getEvents()` queries `events` with the shared anon client.

## Evidence From Code

### Shared Supabase Client Is Anon Only

`lib/supabase.ts` creates one exported client with `NEXT_PUBLIC_SUPABASE_ANON_KEY` and no per-request Authorization header:

- `lib/supabase.ts:8-14` creates `supabase = createClient(supabaseUrl, supabaseAnonKey, ...)`.
- It disables persisted sessions and token refresh.
- It does not read cookies.
- It does not attach `Authorization: Bearer <access_token>`.
- It is not a service-role client.

### Data Layer Uses That Shared Client For Reads

`lib/data.ts` imports the shared client and uses it everywhere:

- `lib/data.ts:1` imports `{ supabase }` from `@/lib/supabase`.
- `lib/data.ts:41-45` `selectTable()` calls `supabase.from(table).select(columns)`.
- `lib/data.ts:48-59` `selectAllTable()` calls `supabase.from(table).select(columns).range(...)`.
- `lib/data.ts:312-332` `getOperationsData()` uses `selectAllTable()` for `seasons`, `people`, `mentee_profiles`, `matches`, `mentoring_recaps`, `events`, and `event_participations`.

There is no request-scoped client passed into `getOperationsData()`.

### Auth Exists, But It Is Separate From Data Reads

`lib/admin-auth.ts` can create a token-aware client:

- `lib/admin-auth.ts:26-34` defines `authClient(accessToken?)` and attaches `Authorization: Bearer <accessToken>` when provided.
- `lib/admin-auth.ts:37-46` uses that client only for `client.auth.getUser()`.

But after that:

- `lib/admin-auth.ts:49-58` looks up `admin_users` through the shared `supabase` client, not the token-aware client.
- `lib/admin-auth.ts:63-69` may update `admin_users.auth_user_id` through the shared anon client.

So even role lookup is mixed: Auth API calls use the user token, while table reads/writes use the anon client.

### Middleware Protects Routes, But Does Not Fix Supabase Query Context

`middleware.ts` validates the browser request before the page loads:

- `middleware.ts:27-41` fetches the Supabase Auth user using the access token.
- `middleware.ts:85-118` refreshes/validates cookies and allows the request.

However, the active admin-user check is also not using the user's token for table RLS:

- `middleware.ts:69-75` queries `/rest/v1/admin_users` with `Authorization: Bearer ${supabaseAnonKey}`.

That means middleware can protect the route at the app level while server component data fetches still execute as anonymous at the database level.

### Operations KPI Depends On Events Before Counting Attendance

`app/operations/page.tsx` computes the event KPI this way:

- `app/operations/page.tsx:202` filters `data.events.data` into `eventsInMonth`.
- `app/operations/page.tsx:203` builds `eventIdsInMonth` from those events.
- `app/operations/page.tsx:204` filters `data.eventParticipations.data` by `event_id` membership in `eventIdsInMonth`.
- `app/operations/page.tsx:205` counts rows with `attendance_status === "attended"`.

Therefore, `event_participations` can be visible but still count as zero if `events` is invisible under RLS.

### Draft RLS Policies Require Auth Context

`supabase_migrations/018_draft_rls_read_policies.sql` defines helper functions around `auth.uid()`:

- `current_admin_role()` checks `admin_users.auth_user_id = auth.uid()`.
- `is_active_admin()` checks `admin_users.auth_user_id = auth.uid()`.
- `events` select policy uses `public.is_active_admin()`.
- `mentoring_recaps` and `event_participations` select policies use `public.is_admin_role(...)`.

Those policies are valid only when the database request includes the logged-in user's JWT. With the current data layer, the request is effectively anonymous, so `auth.uid()` is null and the policies return false.

## Affected Tables

Directly affected in Operations:

- `events`
- `event_participations`
- `mentoring_recaps`
- `people`
- `mentee_profiles`
- `matches`
- `seasons`

Likely affected elsewhere by the same client mismatch:

- `mentor_profiles`
- `applications`
- `application_answers`
- `data_issues`
- `activity_correction_log`
- `operational_team_assignments`
- `admin_users` if/when RLS is enabled there

## Current Rollback Status

Based on the incident context:

- RLS Step 1 initially passed for `programs`, `seasons`, and `events`.
- RLS Step 2 passed for `people` and profile tables.
- RLS Step 3 caused activity data loss.
- RLS was disabled on `mentoring_recaps` and `event_participations`.
- Recap data returned after that rollback.
- Event KPI remained zero.

Interpretation:

- `mentoring_recaps` and `event_participations` are currently rolled back/disabled.
- `events` may still have RLS enabled from Step 1.
- If `events` remains RLS-enabled, Operations will still show event KPI zero because event participation rows are counted only when their `event_id` matches a visible event in the selected month.
- No data rollback is indicated or recommended.

## Root Cause Hypothesis

Primary hypothesis:

The application authenticates the route with cookies, but internal server-side Supabase table reads are made through an anon client that does not carry the authenticated Supabase user JWT. RLS policies that rely on `auth.uid()` block those reads or return empty row sets. Operations then converts empty row sets into zero KPIs.

Secondary contributor:

Operations event attendance is a derived KPI that depends on both `events` and `event_participations`. Rolling back `event_participations` alone is insufficient if `events` is still hidden by RLS.

Why some pages/tables appeared to work:

- A table whose RLS was not yet enabled would still be readable by the anon client if existing grants allowed it.
- A test performed directly in Supabase with an authenticated JWT would not match the app's server-side anon query path.
- A page can pass app-level authentication while its data queries still fail RLS, because middleware and the data layer use separate request contexts.
- If a table has permissive policies or RLS disabled, it may mask the client mismatch until a stricter table is enabled.

## Client Classification

Current state is mixed:

- `lib/supabase.ts`: anon client without auth user context.
- `lib/data.ts`: uses anon client for app data reads and some writes.
- `lib/admin-auth.ts`: uses authenticated cookie-based client only for `auth.getUser()`, then uses anon client for `admin_users` table lookup/update.
- `middleware.ts`: validates Auth API user with cookie token, but queries `admin_users` as anon key bearer.
- No service-role client was found in the inspected runtime code.

## Recommended Safe Architecture

Recommended path for this admin portal: app-level auth plus a server-only service-role client for internal server-side reads.

Rationale:

- Operations is an internal admin dashboard, not an end-user scoped product surface.
- Server components already perform centralized app-level authorization.
- Internal KPIs need broad cross-table reads that are awkward to express safely as per-user RLS unless every server query consistently carries the user JWT.
- A service-role client avoids RLS surprises for server-only reporting reads while keeping browser/client access protected by app auth.

Safety requirements for this path:

- Store `SUPABASE_SERVICE_ROLE_KEY` only in server-side environment variables.
- Never expose it with `NEXT_PUBLIC_`.
- Never import the service-role client into client components.
- Centralize it in a clearly named server-only module, for example `lib/supabase-admin.ts`.
- Gate every page/action with `getCurrentAdminUser()` or equivalent app-level role checks before using service-role reads.
- Keep writes separately reviewed and role-gated.

Acceptable alternative:

Use a request-scoped authenticated Supabase server client for all reads. This means every `lib/data.ts` read must use the request cookies/access token and send `Authorization: Bearer <user_access_token>` to Supabase. This preserves database-level RLS enforcement, but requires more plumbing and more careful tests because every server-side query must be request-scoped.

Do not mix these strategies table by table. Pick one architecture for server-side reads and apply it consistently.

## Recommended Fix

Minimal safe fix direction, not implemented here:

1. Keep RLS disabled on `mentoring_recaps` and `event_participations` until client architecture is fixed and tested.
2. Do not re-enable more RLS in production during this incident.
3. Decide the server-side read model:
   - Preferred: add a server-only service-role client and route Operations/internal data reads through it after app-level auth succeeds.
   - Alternative: refactor `lib/data.ts` to accept/use a cookie-authenticated request-scoped Supabase client.
4. Fix `admin_users` lookup consistency before enabling `admin_users` RLS. It currently uses anon table reads in both `lib/admin-auth.ts` and `middleware.ts`.
5. Re-test `events` and activity tables together, because event KPI depends on both.

## Next Safe Test Plan

1. Confirm current production RLS state table by table without changing it:
   - `events`
   - `mentoring_recaps`
   - `event_participations`
   - `people`
   - `mentee_profiles`
   - `matches`
   - `admin_users`
2. With RLS state unchanged, compare row counts from:
   - anon client
   - authenticated user JWT client
   - service-role client, if introduced in a server-only test branch
3. Specifically test Operations event KPI prerequisites:
   - selected month
   - visible `events` count for selected month
   - visible `event_participations` count
   - joined/filterable participations whose `event_id` is in visible `events`
4. In a preview/staging environment, implement only one client architecture.
5. Verify these pages as `viewer`, `admin`, and `super_admin`:
   - `/operations`
   - `/people/[id]`
   - `/recaps/[id]/edit` for authorized roles
6. Confirm unauthenticated browser access still redirects before any server-side privileged read.
7. Only after preview passes, consider re-enabling RLS one table at a time, starting with `events` plus explicit KPI checks.

## Bottom Line

The likely failure was not bad activity data. It was an auth-context mismatch: protected routes plus anonymous Supabase table queries. For this admin portal, the safer architecture is to keep app-level auth/roles as the gate and use a server-only service-role client for internal server-side reads, or else fully refactor to a cookie-authenticated Supabase server client everywhere. The current mixed model should not be used for further RLS rollout.
