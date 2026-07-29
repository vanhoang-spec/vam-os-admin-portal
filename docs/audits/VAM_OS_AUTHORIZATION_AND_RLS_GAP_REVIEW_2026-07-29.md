# VAM OS Authorization and RLS Gap Review
## 2026-07-29

Read-only audit. No code was changed.

---

## Authorization Layering

VAM OS uses three authorization layers. They are not equivalent — a gap in any
layer exposes the others.

| Layer | Mechanism | Currently enforced? |
|---|---|---|
| 1. Route gate | `middleware.ts`: two-stage cookie check (Stage 1: unlock; Stage 2: JWT + active admin_users) | YES — all non-excluded routes |
| 2. Server action gate | `getCurrentAdminUser()` + permission functions from `lib/permissions.ts` | YES — all server actions |
| 3. Database gate (RLS) | Row-Level Security policies on Supabase tables | PARTIALLY — only `admin_scope_access` has applied RLS |

**The application currently relies on Layers 1 and 2 exclusively for data protection.** If a valid Supabase JWT bypasses the middleware (e.g., direct Supabase API call, `supabase-js` from a custom client), Layer 3 is the last defense — and it is largely absent.

---

## Server Action Authorization — Status

### Actions with correct guards

| Server action file | Guard used | Correct? |
|---|---|---|
| `app/admin/users/actions.ts` | `requireSuperAdmin()` | YES |
| `app/actions/application-approvals.ts` | `getCurrentAdminUser()` + `canDecide()` | YES |
| `app/actions/application-reviews.ts` | `getCurrentAdminUser()` + `canAssignReview()` / `canReview()` | YES |
| `app/actions/application-decisions.ts` | `getCurrentAdminUser()` + `canDecide()` | YES |
| `app/actions/activity-corrections.ts` | `getCurrentAdminUser()` + `canEditRecap()` | YES |
| `app/actions/people.ts` | `getCurrentAdminUser()` + `canEditRecap()` | YES |
| `app/actions/events.ts` | `getCurrentAdminUser()` + role checks | YES |
| `app/actions/workflow.ts` | `getCurrentAdminUser()` + role checks | YES |
| `app/actions/bulk-assignment.ts` | `getCurrentAdminUser()` + `canBulkAssignReviews()` | YES |

### Authorization correctness assessment

**All server actions correctly gate on session-derived role.** No server action trusts
a role value from `formData`. Roles are always read from `getCurrentAdminUser()` which
queries `admin_users` via service-role.

---

## Email Normalization — Corrected Assessment

The previous phase identified `app/actions/application-approvals.ts:27` as having
only `.trim()` on `emailPrimary`. Further reading of `lib/application-approvals.ts:184`
shows:

```typescript
const emailNorm = input.emailPrimary?.trim().toLowerCase() ?? null;
```

The library function normalizes correctly. The action passes the non-lowercased value
to the library, which re-normalizes it. **The gap is defense-in-depth only:** the
action should normalize before the library call, but the library call itself is safe.

**Corrected risk:** LOW (not MEDIUM). The approval lookup will not fail for mixed-case
emails because the library normalizes. However, the action-level normalization should
still be fixed for code hygiene and consistency with `normalizeEmail()`.

---

## RLS Coverage Analysis

### Tables with NO applied RLS

These tables have zero `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in any applied
migration. Any Supabase Auth user with a valid JWT can query them directly via the
Supabase JS client using the anon key.

| Table | Sensitivity | Draft policy exists? |
|---|---|---|
| `admin_users` | **CRITICAL** — exposes all admin emails, roles, statuses, auth_user_ids | Migration 018 DRAFT |
| `admin_audit_log` | HIGH — exposes all admin account changes with before/after snapshots | No draft |
| `people` | HIGH — full CRM: names, emails, phones, genders | Migration 018 DRAFT |
| `mentee_profiles` | HIGH — applicant personal data | Migration 018 DRAFT |
| `mentor_profiles` | HIGH — mentor personal data | Migration 018 DRAFT |
| `applications` | HIGH — applicant submissions | Migration 018 DRAFT |
| `matches` | MEDIUM | Migration 018 DRAFT |
| `programs` | LOW — reference data | Migration 018 DRAFT |
| `seasons` | LOW — reference data | Migration 018 DRAFT |
| `events` | LOW — reference data | Migration 018 DRAFT |
| `mentoring_recaps` | MEDIUM — operational activity data | Migration 018 DRAFT |
| `event_participations` | MEDIUM | Migration 018 DRAFT |
| `activity_correction_log` | MEDIUM | Migration 018 DRAFT |
| `operational_team_assignments` | MEDIUM | Migration 018 DRAFT |
| `event_links` | HIGH — contains registration tokens | Migration 057 DESIGN ONLY |
| `event_registrations` | HIGH — contains registrant data | Migration 057 DESIGN ONLY |

### Tables WITH applied RLS

| Table | Policy | Source | Notes |
|---|---|---|---|
| `admin_scope_access` | `read_admin_scope_access_self_or_super_admin` | Migration 020 | SELECT only; no write policy |

---

## SECURITY DEFINER Functions

These functions run with elevated privileges and are callable by anyone with a valid
Supabase connection — including unauthenticated `anon` clients.

| Function | Callable by | Intended callers | Risk |
|---|---|---|---|
| `public.current_admin_role()` | `anon`, `authenticated`, `service_role` | RLS policies only | MEDIUM — role probing via direct API |
| `public.is_active_admin()` | `anon`, `authenticated`, `service_role` | RLS policies only | MEDIUM — existence check for any auth.uid |
| `public.is_admin_role(text[])` | `anon`, `authenticated`, `service_role` | RLS policies only | MEDIUM |
| `public.admin_can_access_season(text)` | `anon`, `authenticated`, `service_role` | RLS policies + helper queries | MEDIUM |
| `public.current_admin_context()` | `anon`, `authenticated`, `service_role` | Operations dashboard RPCs | MEDIUM |

Migration 057 (DESIGN ONLY) would revoke `EXECUTE` from `anon` and `public` for three of these.
`current_admin_role()` and `is_admin_role()` are NOT included in 057's revoke list.

---

## Cross-Program / Cross-Season Isolation

**Current state:** There is no enforced program/season isolation at the database layer.
All queries use service-role (bypasses RLS). Program/season filtering is applied only in:

1. Server-rendered queries that accept `program_code` or `season_code` from URL params.
2. Server actions that call `admin_can_access_season()` via the `current_admin_context()`
   RPC function (Operations Dashboard scope gate in migration 022).

**Gap:** A `reviewer` with scope for UEHM-S12 can, via direct Supabase API call with
a valid JWT, read applications from HAM-S11 or any other program — because no table
has an RLS policy checking program/season scope.

**Gap:** A `core_team` member scoped to one program could submit a server action
targeting an entity in another program. Server actions do not currently validate that
the target entity belongs to the caller's assigned program.

---

## UI vs. Server/DB Authorization Consistency

| Feature | UI gate | Server action gate | DB gate |
|---|---|---|---|
| Admin user list | Page requires `super_admin` via `requireSuperAdmin()` | `requireSuperAdmin()` on every action | NO RLS — admin_users is open |
| Application approvals | Page renders for `canDecide()` roles | `canDecide()` checked in action | NO RLS |
| Application reviews | Page scoped by reviewer assignment | `canReview()` checked | NO RLS |
| Recap edit | Form hidden for non-`canEditRecap()` roles | `canEditRecap()` checked | NO RLS |
| Match management | Page guarded by `canManageMatches()` | `canManageMatches()` checked | NO RLS |
| Scope access read | Page renders scopes for current user | N/A (read-only) | RLS: `admin_scope_access` (applied) |
| Event registrations | Admin portal only | `is_active_admin()` checked | NO RLS (migration 057 not applied) |

**Summary:** Layers 1 and 2 are consistently applied. Layer 3 (DB) is nearly absent.
Any valid Supabase JWT holder who knows the table structure can bypass all UI and action
gates by calling the Supabase REST API directly.

---

## Write Policy Gaps

No `admin_scope_access` write policy exists. The applied RLS policy is SELECT only:
```sql
create policy "read_admin_scope_access_self_or_super_admin"
on public.admin_scope_access for select using (...);
```

INSERT, UPDATE, DELETE on `admin_scope_access` have no RLS policy. Since the
service-role client bypasses RLS, all current mutations still work. But an
`authenticated` user who crafts a direct Supabase INSERT call with their JWT could
insert scope grants for themselves — bypassing the middleware.

---

## Findings Summary

| Risk | Description | Severity |
|---|---|---|
| `admin_users` no RLS | All admin emails, roles, statuses, auth_user_ids readable via anon key by any valid JWT holder | CRITICAL |
| `people` no RLS | Full CRM data readable directly | HIGH |
| `applications` no RLS | Applicant submissions readable directly | HIGH |
| `event_links` / `event_registrations` no RLS | Registration tokens and registrant data exposed | HIGH |
| SECURITY DEFINER functions callable by anon | Role probing possible without an active admin session | MEDIUM |
| Cross-program scope not enforced | Server actions don't validate target entity belongs to caller's scope | MEDIUM |
| `admin_scope_access` no write RLS | Authenticated users could craft INSERT scope grants directly | MEDIUM |
| `admin_audit_log` no RLS | All account change audit history readable directly | MEDIUM |
| Email normalization at action layer (defense-in-depth) | `app/actions/application-approvals.ts:27` — library normalizes correctly but action should too | LOW |

---

*Audit prepared 2026-07-29. No code changes made. No database connections used.*
