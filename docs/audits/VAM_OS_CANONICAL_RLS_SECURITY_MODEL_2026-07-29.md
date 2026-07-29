# VAM OS Canonical RLS Security Model
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Purpose

This document defines the canonical security principles for RLS in VAM OS and how
they interact with the Supabase Auth principal model, the application's two-stage
middleware gate, and the service-role architecture. It serves as the authority for
evaluating whether any proposed policy is correct and sufficient.

---

## 1. Supabase Principal Model

Supabase PostgREST identifies every request by the Postgres role it executes as:

| Supabase role | When active | Bypasses RLS? | JWT present? |
|---|---|---|---|
| `anon` | No `Authorization` header; or expired/invalid JWT | NO — subject to RLS | NO |
| `authenticated` | Valid Supabase Auth JWT in `Authorization: Bearer` | NO — subject to RLS | YES |
| `service_role` | Service-role key in `apikey` header | YES — bypasses all RLS | N/A |

Within `authenticated`, `auth.uid()` returns the UUID of the signed-in user.
Within `anon`, `auth.uid()` returns NULL.
Within `service_role`, RLS policies are not evaluated.

**VAM OS implication:** The Next.js app always uses the service-role client for all
reads and writes via `dataClient()` in `lib/data.ts`. This means:
- NO query inside the Next.js app is subject to RLS today.
- RLS only protects against callers who bypass the Next.js app and call Supabase
  REST/GraphQL directly with a valid Auth JWT.

---

## 2. VAM OS Three-Layer Security Model

```
Layer 1 — HTTP Middleware Gate (SHA-256 Cookie)
  └─ All routes: next.config.ts + middleware checks cookie presence
  └─ If missing: redirect to /access

Layer 2 — Application Auth Gate (JWT + admin_users check)
  └─ All admin pages: requireActiveAdmin() / getCurrentAdminUser()
  └─ If invalid JWT or no admin_users row: redirect to /login
  └─ Role-based permission check: canXxx() guards from lib/permissions.ts
  └─ Server actions re-validate (requireActiveAdmin / requireSuperAdmin at top of action)

Layer 3 — Database RLS (Supabase Postgres policies)
  └─ Defense-in-depth only for current architecture (service-role bypasses)
  └─ Protects direct Supabase API callers with a valid JWT
  └─ MUST become primary gate when participant login is introduced
```

Layer 3 is currently defense-in-depth. Its primary role today is to protect data
from authenticated-but-unauthorized JWT holders (e.g., a Supabase Auth user whose
admin_users row is inactive, suspended, or doesn't exist).

---

## 3. Fail-Closed Principle

In PostgreSQL, when RLS is enabled on a table and no policy matches a given operation
(SELECT/INSERT/UPDATE/DELETE), the operation is **DENIED by default for non-superusers**.

This is the fail-closed guarantee that makes RLS safe:

| Scenario | Outcome |
|---|---|
| RLS enabled; matching SELECT policy | ALLOW (rows passing USING filter only) |
| RLS enabled; no SELECT policy | DENY — no rows returned |
| RLS enabled; no INSERT policy | DENY — insert fails with permission denied |
| RLS enabled; no UPDATE/DELETE policy | DENY |
| RLS disabled | ALLOW — all rows visible; all operations permitted |
| `service_role` (bypass) | ALLOW always, regardless of policy or RLS state |

**Consequence for VAM OS design:**
- Tables with RLS ENABLED and no write policies are SAFE for write protection.
  Writes from direct JWT callers fail (policy not found = denied).
  Writes from the app succeed (service-role bypasses RLS).
- Tables with RLS DISABLED are fully open to any JWT holder via direct Supabase API.
  These are the current priority for hardening.

---

## 4. Policy Evaluation Model

PostgreSQL evaluates policies as follows:

### USING clause
Evaluated for SELECT, UPDATE, DELETE. Defines which existing rows are visible or
affected. Rows where USING returns FALSE or NULL are invisible (as if they don't exist).

### WITH CHECK clause
Evaluated for INSERT, UPDATE. Defines which new/modified rows are permitted.
If WITH CHECK is absent on a non-restrictive policy: defaults to USING expression
(for UPDATE) or permissive (for INSERT on permissive policies). See PostgreSQL docs.

### PERMISSIVE vs. RESTRICTIVE
Default is PERMISSIVE: a row passes if ANY permissive policy allows it.
RESTRICTIVE: a row passes only if ALL restrictive policies AND at least one permissive
policy allow it. VAM OS uses permissive policies only (as of 018/020).

---

## 5. Canonical Policy Principles for VAM OS

### Principle 1: All policies that read admin identity must use SECURITY DEFINER helpers

Policies must NOT directly query `admin_users` in a USING clause — this would create a
recursive or cross-policy dependency. Instead, use:

```sql
-- CORRECT
using (public.is_active_admin())
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']))
using (auth.uid() = auth_user_id or public.current_admin_role() = 'super_admin')

-- INCORRECT — do not use these in a policy USING clause
using (exists (select 1 from admin_users where auth_user_id = auth.uid() and status = 'active'))
```

Why: the SECURITY DEFINER function bypasses RLS on `admin_users` when called from
within a policy, using the function definer's privileges. The function is safe because:
- `search_path = public` is hardcoded — no injection risk.
- It only queries by `auth.uid()` — no cross-user data returned.
- It returns NULL/FALSE for anon callers — safe fail-closed.

### Principle 2: Helper functions must not be callable by anon or public

All SECURITY DEFINER helper functions must have EXECUTE revoked from `anon` and `public`:

```sql
revoke execute on function public.current_admin_role() from anon, public;
revoke execute on function public.is_admin_role(text[]) from anon, public;
revoke execute on function public.is_active_admin() from anon, public;
```

The `authenticated` role retains EXECUTE because RLS policies call these functions
at query time. If EXECUTE is revoked from `authenticated`, policies fail with
"permission denied for function" — which is a silent SELECT failure that returns zero rows.

**This revoke is NOT currently applied.** Migration 057 has partial revokes but is
DESIGN ONLY and not applied to production.

### Principle 3: search_path must be hardcoded on all SECURITY DEFINER functions

All SECURITY DEFINER functions in VAM OS correctly set `set search_path = public`.
This prevents a search-path injection attack where a malicious schema placed before
`public` in the session's search_path could intercept calls to `admin_users`.

Never write a SECURITY DEFINER function without `set search_path = public`.

### Principle 4: RLS must be fail-closed for participant-facing tables

When participant login is introduced, these tables become participant-readable:
- `people` — own row only; or admin view for admin callers
- `mentor_profiles` / `mentee_profiles` — own row only for participant callers
- `mentoring_recaps` — own match's recaps only for participant callers
- `event_participations` — own participations only for participant callers

This requires a two-branch USING policy:

```sql
-- Example target (not yet written):
using (
  -- Participant sees their own row
  (auth.uid() = (select auth_user_id from people where id = people.id))
  -- Admin sees based on role
  or public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin'])
)
```

Until participant login exists, the admin-only policies in migration 018 are sufficient
for the current scope.

### Principle 5: Write policies are not required while service-role handles all writes

Since `dataClient()` uses service-role, all writes bypass RLS. No INSERT/UPDATE/DELETE
policies are needed to keep the app functional.

However, adding RESTRICTIVE write policies is a valid defense-in-depth measure:
- Prevent direct JWT callers from writing data they should not modify.
- Prevent future code changes from accidentally using anon-key client for writes.

For the current hardening sprint: write policies are out of scope. Focus on SELECT
protection for unprotected tables.

### Principle 6: service_role must never be issued to the browser or participants

The Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`) must remain in:
- Server-side environment only (`lib/supabase-server.ts` with `import "server-only"`)
- Never in `NEXT_PUBLIC_*` environment variables
- Never sent in API responses or cookies

All `getSupabaseServiceRoleClient()` calls are in server-only modules. This is correct
and must be preserved.

---

## 6. Principal Role Summary for VAM OS

| Principal | Who | auth.uid() | Passes RLS? | Currently used for |
|---|---|---|---|---|
| `anon` (unauthenticated) | Non-logged-in browser; unauthenticated API callers | NULL | Subject to RLS; fail-closed | Not used by app after Stage 1 cookie check |
| `authenticated` (JWT valid) | Any Supabase Auth user with a valid JWT | User UUID | Subject to RLS policies | Direct API callers; login flow before service-role call |
| `service_role` | Next.js server (app) using service key | N/A — bypasses auth.uid() | BYPASSES all RLS | All app data reads and writes via dataClient() |
| `super_admin` (app concept) | admin_users.role = 'super_admin' | User UUID | Subject to RLS policies | Can read all admin_users rows; manage all scope |

Note: `super_admin` is an application-level concept stored in `admin_users.role`.
It is NOT a Postgres role or Supabase Auth role. RLS policies implement super_admin
access via `current_admin_role() = 'super_admin'`.

---

## 7. Current Hardening Gaps Against Canonical Model

| Principle | Current state | Gap |
|---|---|---|
| SECURITY DEFINER helpers for all role checks | ✅ Used in 018 policies | None |
| search_path hardcoded | ✅ `set search_path = public` on all helpers | None |
| REVOKE EXECUTE from anon/public | ❌ NOT applied | CRITICAL — anon callers can invoke helpers via RPC |
| Fail-closed for unprotected tables | ❌ mentoring_recaps, event_participations, person_season_memberships, admin_audit_log have NO RLS | HIGH — open to direct JWT reads |
| Participant policies ready | ❌ Not written | Must be written before participant login |
| Write protection (defense-in-depth) | ❌ No write policies exist | LOW — mitigated by service-role architecture |
| service_role server-only | ✅ `import "server-only"` on all server modules | None |

---

## 8. Target State RLS Coverage (Post-Hardening)

| Table | Target classification | Owner decision needed? |
|---|---|---|
| `admin_users` | PROTECTED — own row or super_admin SELECT | ✅ Already in 018 |
| `admin_scope_access` | PROTECTED — own active rows or super_admin SELECT | ✅ Already in 020 |
| `admin_audit_log` | PROTECTED — super_admin SELECT only | Requires new migration |
| `programs`, `seasons`, `events` | PROTECTED — is_active_admin SELECT | ✅ 018 (if confirmed applied) |
| `people`, `mentor_profiles`, `mentee_profiles` | PROTECTED — viewer+ SELECT; PARTICIPANT SELECT (own row, future) | 018 covers admin; participant extension deferred |
| `matches` | PROTECTED — viewer+ SELECT | ✅ 018 |
| `applications` | PROTECTED — reviewer+ SELECT; add core_team | 018 + correction migration |
| `mentoring_recaps` | PROTECTED — viewer+ SELECT (re-enable, undoing 023/025 disable) | Requires new migration; risk: operations workflow |
| `event_participations` | PROTECTED — viewer+ SELECT (re-enable) | Requires new migration; risk: event operations |
| `person_season_memberships` | PROTECTED — viewer+ SELECT | Requires new migration |
| `application_reviews` | ✅ PROTECTED (migration 040) | None |
| `application_decisions` | ✅ PROTECTED (migration 041) | None |
| `review_assignment_batches` | ✅ PROTECTED (migration 044a) | None |
| `event_links`, `event_registrations` | PROTECTED — admin+ (registration tokens are sensitive) | Requires new migration; 057 was design only |

---

## 9. Priority Order for Hardening

1. **REVOKE EXECUTE from anon** — `current_admin_role`, `is_admin_role`, `is_active_admin`,
   `current_admin_context`, `admin_can_access_season`. Lowest risk of regression.
   Required before any participant login goes live.

2. **Re-enable RLS on `mentoring_recaps` and `event_participations`** — highest sensitivity
   unprotected tables. Policy already written in 018; migrations 023/025 disabled it.
   Risk: may affect Operations Dashboard queries if they use anon-key path (unlikely
   given current architecture, but must be verified).

3. **Enable RLS on `admin_audit_log`** — super_admin-only SELECT. Log data should not be
   visible to non-super-admin direct API callers.

4. **Enable RLS on `person_season_memberships`** — viewer+ SELECT. Medium-sensitivity
   membership data currently fully open.

5. **Enable RLS on `event_links` and `event_registrations`** — admin+ SELECT.
   Registration tokens must not be publicly readable.

6. **Correct `applications` policy** — add `core_team` to allowlist.

---

*Design only. No production or staging connection used. No SQL executed.*
