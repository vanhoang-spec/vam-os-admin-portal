# VAM OS Auth RLS Target Inventory
## 2026-07-29

Read-only analysis. No production or staging connection used.
Sources: repository migrations, code comments, Sprint 1B post-mortem (2026-04-29),
May 2026 RLS security audit, `lib/admin-auth.ts` inline documentation.

---

## Architecture Context: `dataClient()` Uses Service-Role First

Before interpreting the RLS table below, the following is critical:

```typescript
// lib/data.ts:82
function dataClient() {
  return getSupabaseServiceRoleClient() ?? getSupabaseServerClient() ?? supabase;
}
```

**All reads in `lib/data.ts` use service-role when `SUPABASE_SERVICE_ROLE_KEY` is set.**
Service-role bypasses ALL RLS policies. This means:
- RLS does NOT currently protect data going through the Next.js app.
- RLS ONLY protects against direct Supabase REST API calls made by JWT holders
  who have obtained a valid `access_token` but are bypassing the app's middleware.
- All writes use service-role (via `getSupabaseServiceRoleClient()`).

This is intentional: the app authorizes at Layer 2 (server actions / getCurrentAdminUser())
rather than at Layer 3 (DB). RLS provides defense-in-depth for direct API callers only.

---

## CRITICAL CORRECTION to Previous Audit

The previous audit (2026-07-29 authorization gap review) stated:
> **CRITICAL — `admin_users` has no applied RLS.**

This was incorrect. `lib/admin-auth.ts` lines 68–80 contain an explicit code comment:

> "IMPORTANT: this MUST use the service-role client. The `admin_users` table has
> RLS enabled (migration 018) which only lets a user read their own row when
> `auth.uid() = auth_user_id`. Reading via the anon-bearer client therefore
> silently returned null..."

`admin_users` has RLS ENABLED with a policy that restricts JWT holders to their own
row. The CRITICAL risk was overstated. The production admin_users table IS protected
at the database layer.

---

## Table Inventory

Classification:
- **PROTECTED** — RLS enabled; policy confirmed or strongly evidenced
- **PARTIALLY PROTECTED** — RLS enabled but SELECT-only; no write policies needed (writes go through service-role)
- **UNPROTECTED** — No RLS; rows readable/writable by any JWT holder via direct API
- **SERVER-ONLY EXPECTED** — Table is write-only via service-role; no direct client read path
- **EVIDENCE INCOMPLETE** — Cannot confirm from repository evidence alone

| Table | Exists in repo | RLS ENABLE source | Policy source | App access path | Production state | Classification |
|---|---|---|---|---|---|---|
| `admin_users` | Migration 017 | Migration 018 (applied, confirmed by admin-auth.ts comment) | `read_admin_users_super_admin_or_self`: own row or super_admin | `getSupabaseServiceRoleClient()` always | **PROTECTED** | PROTECTED |
| `admin_scope_access` | Migration 020 | Migration 020 | `read_admin_scope_access_self_or_super_admin`: own active rows or super_admin | Service-role | **PROTECTED** | PROTECTED |
| `application_reviews` | Migration 040 | Migration 040 | `application_reviews_read`: admin tiers see all; reviewer sees own | Service-role | **PROTECTED** | PROTECTED |
| `application_decisions` | Migration 041 | Migration 041 | `application_decisions_read`: admin tiers + reviewer | Service-role | **PROTECTED** | PROTECTED |
| `review_assignment_batches` | Migration 044a | Migration 044a | `review_assignment_batches_read`: admin tiers only | Service-role | **PROTECTED** | PROTECTED |
| `people` | Core table (no migration in repo) | Migration 018 (probable — Sprint 1B Step 2 passed) | `read_people_internal_roles`: viewer+ | `dataClient()` → service-role → bypasses RLS | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `mentor_profiles` | Migration 036 | Migration 018 (probable) | `read_mentor_profiles_internal_roles`: viewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `mentee_profiles` | Migration 036 | Migration 018 (probable) | `read_mentee_profiles_internal_roles`: viewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `programs` | Migration 036 | Migration 018 (probable — Sprint 1B Step 1 passed) | `read_programs_active_admins`: is_active_admin | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `seasons` | Core table | Migration 018 (probable) | `read_seasons_active_admins`: is_active_admin | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `events` | Core table | Migration 018 (probable) | `read_events_active_admins`: is_active_admin | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `matches` | Core table | Migration 018 (probable) | `read_matches_internal_roles`: viewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `applications` | Migration 038 | Migration 018 (probable — policy in 038 is idempotent drop+create) | `read_applications_review_roles`: reviewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `activity_correction_log` | Migration 015 | Migration 018 (probable) | `read_activity_correction_log_review_roles`: reviewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `operational_team_assignments` | Migration 016 | Migration 018 (probable) | `read_operational_team_assignments_internal_roles`: viewer+ | `dataClient()` → service-role | **PROBABLY PROTECTED** | EVIDENCE INCOMPLETE |
| `mentoring_recaps` | Migration 012, 013 | DISABLED — migrations 023, 025 explicitly disable | DISABLED | `dataClient()` → service-role | **UNPROTECTED** | UNPROTECTED |
| `event_participations` | Migration 012, 013 | DISABLED — migrations 023, 025 explicitly disable | DISABLED | `dataClient()` → service-role | **UNPROTECTED** | UNPROTECTED |
| `person_season_memberships` | Migration 052 | NOT ENABLED — migration 052 explicitly: "No RLS enable/disable/policies" | None | Service-role | **UNPROTECTED** | UNPROTECTED |
| `person_season_membership_log` | Migration 052 | NOT ENABLED | None | Service-role | **UNPROTECTED** | UNPROTECTED |
| `admin_audit_log` | Migration 024 | NOT ENABLED — no migration enables it | None | Service-role | **UNPROTECTED** | UNPROTECTED |
| `event_links` | Migration 051 | NOT ENABLED — migration 057 is DESIGN ONLY | None | Service-role | **UNPROTECTED** | UNPROTECTED |
| `event_registrations` | Migration 051 | NOT ENABLED — migration 057 is DESIGN ONLY | None | Service-role | **UNPROTECTED** | UNPROTECTED |
| `intake_batches` | Migration 038 | NOT ENABLED — no migration enables it | None | `dataClient()` → service-role | **UNPROTECTED** | UNPROTECTED |
| `industries` | Migration 036 | Unknown | Unknown | `dataClient()` → service-role | EVIDENCE INCOMPLETE | EVIDENCE INCOMPLETE |
| `function_areas` | Migration 036 | Unknown | Unknown | `dataClient()` → service-role | EVIDENCE INCOMPLETE | EVIDENCE INCOMPLETE |
| `mentor_industries` | Migration 036 | Unknown | Unknown | `dataClient()` → service-role | EVIDENCE INCOMPLETE | EVIDENCE INCOMPLETE |
| `mentor_function_area_links` | Migration 036 | Unknown | Unknown | `dataClient()` → service-role | EVIDENCE INCOMPLETE | EVIDENCE INCOMPLETE |
| `mentor_program_participations` | Migration 036 | Unknown | Unknown | `dataClient()` → service-role | EVIDENCE INCOMPLETE | EVIDENCE INCOMPLETE |
| `crm_notes` | Migration 052 | NOT ENABLED — migration 052: no RLS | None | Service-role | **UNPROTECTED** | UNPROTECTED |

---

## SECURITY DEFINER Functions Callable by Anon

These functions are SECURITY DEFINER and currently callable by the `anon` and `public` roles
(migration 057 REVOKE is DESIGN ONLY and not applied):

| Function | Callable by anon? | Risk if called directly |
|---|---|---|
| `public.current_admin_context()` | YES | Returns program/season context for auth.uid() — probes membership |
| `public.current_admin_role()` | YES | Returns admin role for auth.uid() — probes role |
| `public.is_active_admin()` | YES | Returns boolean — confirms whether a JWT is an active admin |
| `public.is_admin_role(text[])` | YES | Confirms whether a JWT holder has a specific role |
| `public.admin_can_access_season(text)` | YES | Probes season access for a JWT holder |

---

## Risk Summary by Sensitivity Tier

| Tier | Tables | Current protection | Direct API risk |
|---|---|---|---|
| CRITICAL (identity + access) | admin_users | PROTECTED — own row or super_admin only | LOW — policy enforced |
| CRITICAL (identity + access) | admin_audit_log | UNPROTECTED | HIGH — all account changes readable |
| CRITICAL (PII) | people, mentor_profiles, mentee_profiles | PROBABLY PROTECTED | PROBABLY LOW — pending confirmation |
| HIGH (operational PII) | person_season_memberships | UNPROTECTED | HIGH — membership status for all participants |
| HIGH (operational) | mentoring_recaps, event_participations | UNPROTECTED — RLS disabled | HIGH — participant activity data |
| HIGH (registration) | event_links, event_registrations | UNPROTECTED | HIGH — registration tokens + registrant data |
| MEDIUM | admin_scope_access | PROTECTED | LOW — policy enforced |
| MEDIUM | application_reviews, application_decisions | PROTECTED | LOW — policy enforced |
| MEDIUM | review_assignment_batches | PROTECTED | LOW |

---

## Key Revision from Prior Audit

The prior audit incorrectly classified `admin_users` as CRITICAL UNPROTECTED.
The correct classifications are:

| Table | Prior audit | This audit | Confidence |
|---|---|---|---|
| `admin_users` | CRITICAL UNPROTECTED | PROTECTED | HIGH — code comment proves it |
| `mentoring_recaps` | UNPROTECTED | UNPROTECTED | HIGH — migrations 023/025 disable it |
| `event_participations` | UNPROTECTED | UNPROTECTED | HIGH |
| `person_season_memberships` | Not assessed | UNPROTECTED | HIGH — migration 052 confirms no RLS |
| `admin_audit_log` | UNPROTECTED | UNPROTECTED | HIGH — no migration enables it |
| `event_links`, `event_registrations` | UNPROTECTED | UNPROTECTED | HIGH — 057 is DESIGN ONLY |

---

## Evidence Gaps Requiring Production Confirmation

The following cannot be confirmed without a direct catalog query:

1. Whether `programs`, `seasons`, `events`, `people`, `mentor_profiles`, `mentee_profiles`,
   `matches`, `applications`, `activity_correction_log`, `operational_team_assignments`
   have RLS enabled in production. Evidence points to YES (Sprint 1B steps 1+2 reportedly
   passed and were not rolled back), but this is not confirmed from `pg_policies`.
2. Whether any write policies (INSERT/UPDATE/DELETE) exist on any table.
3. Exact GRANT EXECUTE state of SECURITY DEFINER functions.
4. Whether `intake_batches`, `industries`, `function_areas`, `mentor_industries`,
   `mentor_function_area_links` have any RLS applied.

---

*Design only. No production or staging connection used.*
