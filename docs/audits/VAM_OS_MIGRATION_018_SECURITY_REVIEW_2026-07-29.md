# VAM OS Migration 018 Security Review
## 2026-07-29

Read-only review of `supabase_migrations/018_draft_rls_read_policies.sql`.
No migration was applied. No production connection used.

---

## Status

Migration 018 is marked **DRAFT — DO NOT RUN UNTIL APPROVED** in the file header.

However, `lib/admin-auth.ts` lines 68–80 explicitly confirm that `admin_users` has
RLS enabled from migration 018. Cross-referencing with the May 2026 VAM_OS_RLS_SECURITY_AUDIT.md
(which documents Sprint 1B steps 1+2 as passed), migration 018 was almost certainly
applied to production during Sprint 1B. The DRAFT label was added to prevent re-application
rather than to document a never-applied migration.

**Assessment:** Migration 018 IS applied in production (high confidence). The file
header should be updated to reflect this. The DRAFT label is misleading.

---

## Tables Affected by Migration 018

| Table | ENABLE RLS statement | Policy name | Policy command |
|---|---|---|---|
| `programs` | YES | `read_programs_active_admins` | FOR SELECT |
| `seasons` | YES | `read_seasons_active_admins` | FOR SELECT |
| `events` | YES | `read_events_active_admins` | FOR SELECT |
| `people` | YES | `read_people_internal_roles` | FOR SELECT |
| `mentor_profiles` | YES | `read_mentor_profiles_internal_roles` | FOR SELECT |
| `mentee_profiles` | YES | `read_mentee_profiles_internal_roles` | FOR SELECT |
| `matches` | YES | `read_matches_internal_roles` | FOR SELECT |
| `applications` | YES | `read_applications_review_roles` | FOR SELECT |
| `mentoring_recaps` | YES | `read_mentoring_recaps_internal_roles` | FOR SELECT |
| `event_participations` | YES | `read_event_participations_internal_roles` | FOR SELECT |
| `activity_correction_log` | YES | `read_activity_correction_log_review_roles` | FOR SELECT |
| `operational_team_assignments` | YES | `read_operational_team_assignments_internal_roles` | FOR SELECT |
| `admin_users` | YES | `read_admin_users_super_admin_or_self` | FOR SELECT |

Note: `mentoring_recaps` and `event_participations` were subsequently DISABLED in
migrations 023 and 025 (production migrations). Their RLS is currently DISABLED.

---

## Policy Analysis

### Helper Functions Used

Migration 018 defines all three helper functions as SECURITY DEFINER:
- `current_admin_role()` — reads `admin_users` to return the caller's role; returns NULL for anon.
- `is_admin_role(text[])` — delegates to `current_admin_role()`; returns FALSE for anon.
- `is_active_admin()` — queries `admin_users.status = 'active'`; returns FALSE for anon.

Migration 020 (`CREATE OR REPLACE`) redefines `current_admin_role()` and `is_active_admin()`
with identical implementations, making 020 the authoritative in-production definition of those
two. `is_admin_role(text[])` is defined only in 018.

All three functions set `search_path = public`, preventing search-path injection attacks.

| Policy | USING expression | WITH CHECK | Intended caller | Risk |
|---|---|---|---|---|
| `read_programs_active_admins` | `is_active_admin()` | NONE | Active staff admins | LOW — reference data; safe to show any active admin |
| `read_seasons_active_admins` | `is_active_admin()` | NONE | Active staff admins | LOW |
| `read_events_active_admins` | `is_active_admin()` | NONE | Active staff admins | LOW |
| `read_people_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM — PII; blocked for non-admins |
| `read_mentor_profiles_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM |
| `read_mentee_profiles_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM |
| `read_matches_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM |
| `read_applications_review_roles` | `is_admin_role(['reviewer','admin','super_admin'])` | NONE | Reviewer+ | MEDIUM — excludes viewer |
| `read_mentoring_recaps_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM (DISABLED — see below) |
| `read_event_participations_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | MEDIUM (DISABLED) |
| `read_activity_correction_log_review_roles` | `is_admin_role(['reviewer','admin','super_admin'])` | NONE | Reviewer+ | MEDIUM — excludes viewer |
| `read_operational_team_assignments_internal_roles` | `is_admin_role(['viewer','reviewer','admin','super_admin'])` | NONE | Viewer+ | LOW |
| `read_admin_users_super_admin_or_self` | `auth.uid() = auth_user_id OR current_admin_role() = 'super_admin'` | NONE | Own row or super_admin | MEDIUM — admin identity data |

---

## Policy Gaps Identified

### 1. No WITH CHECK on Any Policy

All policies are SELECT-only with no WITH CHECK clause.

**Impact:** No INSERT/UPDATE/DELETE protection at the policy level.
**Mitigation:** In PostgreSQL, when RLS is enabled but no policy covers an operation
(INSERT/UPDATE/DELETE), the operation is DENIED for non-superusers by default.
Service-role bypasses all policies. So:
- App (service-role): INSERT/UPDATE/DELETE allowed ✅
- Direct JWT caller: INSERT/UPDATE/DELETE DENIED ✅ (fail-closed)
- Conclusion: The absence of write policies is SAFE given the architecture.

### 2. `admin_users` Policy — No Write Protection for Scope Changes

The `read_admin_users_super_admin_or_self` policy is SELECT-only. There are no
INSERT/UPDATE/DELETE policies on `admin_users`. As analyzed above, this is SAFE
because direct JWT callers cannot write to admin_users (RLS fail-close on no policy).

### 3. `mentoring_recaps` and `event_participations` — RLS DISABLED

Migrations 023 and 025 executed:
```sql
alter table public.mentoring_recaps disable row level security;
alter table public.event_participations disable row level security;
```

**Impact:** Any JWT holder with a valid access token can SELECT all rows in
`mentoring_recaps` and `event_participations` via direct Supabase REST API.

**Risk:** HIGH — these tables contain participant activity data including
recap URLs, meeting dates, match associations, attendance status.

**Required action:** Re-enable RLS on both tables in the corrected migration set.

### 4. Cross-Program Isolation Not Enforced

Policies for `people`, `mentor_profiles`, `mentee_profiles`, `mentoring_recaps`,
`matches`, and `applications` are role-based only (viewer, reviewer, admin, super_admin).
They do NOT filter by the admin's `admin_scope_access` program or season scope.

**Impact:** A `viewer` with HAM-only scope can read ALL people, profiles, matches,
and recaps across all programs via direct API.

**Mitigation for current scope:** Application layer filters by program/season in
page queries. Direct API callers bypass this filtering.

**Required action (future):** Add program/season scope predicate to policies for
these tables. This requires joining through `admin_scope_access` in the policy
USING clause. Out of scope for immediate hardening but should be Phase 2.

### 5. SECURITY DEFINER Functions — No REVOKE from anon

Migration 018 defines `is_admin_role(text[])` as SECURITY DEFINER. Migration 020
defines `current_admin_role()` and `is_active_admin()` as SECURITY DEFINER.
Neither migration revokes EXECUTE from `anon` or `public`.

**Impact:** Unauthenticated callers can invoke these functions via RPC.
- `is_active_admin()`: returns `false` for anon (no auth.uid()) — minimal info leak
- `current_admin_role()`: returns NULL for anon — minimal info leak
- But the functions themselves internally query `admin_users` as SECURITY DEFINER,
  which could be used for timing attacks in theory

**Required action:** Apply migration 057's REVOKE statements (and extend to cover
`current_admin_role()` and `is_admin_role()` which 057 misses).

### 6. `applications` Policy Excludes `viewer` Role

The `read_applications_review_roles` policy allows `['reviewer', 'admin', 'super_admin']`
but NOT `viewer` or `core_team`. This means:

- `viewer`: cannot read applications via direct API — CORRECT (viewer should not see PII applications)
- `core_team`: cannot read applications via direct API — POTENTIALLY INCORRECT

In the app, `core_team` can access the applications page (canDecide returns true for core_team).
The service-role client bypasses this gap. But for future RLS-first architecture, the
applications policy should include `core_team`.

**Required action:** Add `'core_team'` to the applications policy allowlist. Also add
`'support_team'` if support_team should have read access to applications.

---

## Compatibility with Current Code

| Concern | Assessment | Safe? |
|---|---|---|
| App reads via service-role | Service-role bypasses all RLS | YES — unaffected |
| Login flow (`findAdminUserForAuthUser`) | Uses service-role explicitly to avoid RLS | YES |
| `admin_scope_access` reads (migration 020) | Policy `read_admin_scope_access_self_or_super_admin` uses `current_admin_role()` defined in 020 | YES |
| `application_reviews` policy (migration 040) | Uses `is_admin_role()` from 018 | YES — 018 applied first |
| `application_decisions` policy (migration 041) | Uses `is_admin_role()` from 018 | YES |
| `review_assignment_batches` policy (044a) | Uses `is_admin_role()` from 018 | YES |
| `dataClient()` → service-role | All reads bypass RLS | YES — no RLS-triggered empty data |
| Sprint 1B recovery fix | `dataClient()` now uses service-role first | YES — root cause resolved |

---

## Migration 018 — Required Corrections Before Any Re-application

If migration 018 is ever re-applied or a hardened version is created, these corrections
are required:

1. Add `'core_team'` (and consider `'support_team'`) to applications policy.
2. Extend REVOKE EXECUTE to cover `current_admin_role()` and `is_admin_role()`.
3. Do NOT re-apply to tables that are already enabled (will just recreate policies — harmless).
4. For `mentoring_recaps` and `event_participations`: must explicitly RE-ENABLE before
   creating/restoring their policies (migrations 023/025 disabled them).
5. Do NOT include `person_season_memberships`, `admin_audit_log`, `event_links`,
   `event_registrations` — these need separate migrations.

---

*Review only. No migration applied. No production connection used.*
