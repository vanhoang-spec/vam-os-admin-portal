# VAM OS Production Auth/RLS Read-Only Verification Result

## Target

- Environment: Production
- Project: vam-os-mvp
- Ref: qkkroesfiazsejkzflcd
- Database: postgres
- Execution method: Owner-run Supabase SQL Editor (no direct Claude connection)
- Probe: VAM_OS_AUTH_RLS_READONLY_VERIFICATION_V2
- Executed UTC: 2026-07-29 10:23:19 UTC
- Read-only: YES
- Sections present: 13 of 13 (RV1–RV13)
- Output complete: YES
- Truncated: NO KNOWN TRUNCATION
- PII observed: NO
- Credentials observed: NO
- Sanitized: YES — all data in this document contains only schema metadata, boolean flags, aggregate counts, structural analysis, and action-type code strings; no email values, names, UUIDs linked to individuals, tokens, or raw business records

---

## Phase 4 — Sanitization and Validation

**Probe version:** VAM_OS_AUTH_RLS_READONLY_VERIFICATION_V2 ✓

**Section completeness:**

| Section | Expected | Received | Status |
|---|---|---|---|
| rv1_core_rls | RLS inventory all public tables | YES | ✓ |
| rv2_policies | Structural policy flags | YES | ✓ |
| rv3_function_security | Function SECURITY DEFINER inventory | YES | ✓ |
| rv4_function_privileges | EXECUTE grant matrix | YES | ✓ |
| rv5_people_auth_column | people column schema | YES | ✓ |
| rv6_admin_users_rls | admin_users RLS + policy state | YES | ✓ |
| rv7_disabled_tables | mentoring_recaps, event_participations | YES | ✓ |
| rv8_unprotected_tables | Seven expected-unprotected tables | YES | ✓ |
| rv9_audit_constraints | admin_audit_log constraints | YES | ✓ |
| rv10_people_indexes | people index inventory | YES | ✓ |
| rv11_approx_row_counts | Row estimates from pg_class | YES | ✓ |
| rv12_audit_action_types | action_type statistics | YES | ✓ |
| rv13_sprint1b_rls | Sprint 1B table confirmation | YES | ✓ |

**Internal inconsistency noted:** RV8 note for admin_audit_log reads "No RLS in any applied migration" — this is stale text in the probe. **Production metadata (RV1) confirms admin_audit_log has RLS=true.** Production metadata is authoritative. The note is an artifact of the probe design and does not reflect current production state.

**Sanitization outcome:** PASS — output contains no PII, credentials, or raw business records.

---

## Executive Security Finding

**Overall classification:** MATERIAL SECURITY BLOCKERS PRESENT — hardening required before Auth rollout

**Immediate concerns:**

1. `admin_users` has RLS **disabled** in production. Any Supabase Auth user with a valid JWT can directly query the Supabase REST API and read all admin accounts, roles, and `auth_user_id` values without going through the application.
2. Four SECURITY DEFINER functions grant `EXECUTE` to the `anon` role (`current_admin_role`, `is_active_admin`, `is_admin_role`, `get_operations_dashboard_data`). All four fail closed (return null/false/exception for anon callers), but the grants are unnecessary and should be revoked.
3. All major PII and operational tables (people, mentor_profiles, mentee_profiles, matches, events, applications, mentoring_recaps, event_participations) have RLS **disabled**. They are protected only by the application middleware gate, not by the database.
4. `people.auth_user_id` does not exist. Participant login is architecturally blocked.

**Auth rollout status:** NOT READY — minimum design required before issuing participant Auth accounts.

**Critical correction from prior audit:** The prior analysis (Part 2, July 2026) documented admin_users as PROTECTED based on a code comment in `lib/admin-auth.ts`. Production metadata now confirms admin_users has `rowsecurity = false`. The code comment describes intended behavior, not actual production state. **The prior correction was wrong. admin_users is UNPROTECTED at the database layer.**

---

## Phase 5 — Effective Table Security Inventory

Classification rules:
- **PROTECTED** — RLS enabled; policy confirmed by production metadata
- **PARTIALLY PROTECTED** — RLS enabled; policy details require separate verification
- **UNPROTECTED** — RLS disabled; DB layer provides no access control regardless of policies that may exist
- **SERVER-ONLY EXPECTED** — write-only via service-role; no intended direct client read path
- **EVIDENCE INCOMPLETE** — table not observed in owner output

| Table | Exists | RLS enabled | Policies on table | Effective protection | Main risk |
|---|---|---|---|---|---|
| admin_users | YES | **NO** | NO (rv6 returned no policy) | **UNPROTECTED** | Any JWT holder can enumerate all admin accounts, roles, and auth_user_id values via direct Supabase REST API |
| admin_scope_access | YES | YES | YES (self or super_admin) | **PROTECTED** | Low — policy enforced |
| admin_audit_log | YES | YES | EVIDENCE INCOMPLETE (policy structure unconfirmed) | **PARTIALLY PROTECTED** | Need policy verification; table has RLS enabled, grant details unknown |
| people | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Full participant PII readable by any JWT holder via direct API |
| person_roles | YES | **NO** | Unknown | **UNPROTECTED** | Role assignments exposed via direct API |
| person_season_memberships | YES | **NO** | Unknown | **UNPROTECTED** | All membership/participation status exposed |
| person_season_membership_log | YES | **NO** | Unknown | **UNPROTECTED** | Activity log exposed |
| mentor_profiles | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Profile data exposed |
| mentee_profiles | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Profile data exposed |
| applications | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | All application data exposed |
| application_answers | YES | **NO** | Unknown | **UNPROTECTED** | Sensitive application responses exposed |
| application_reviews | YES | YES | YES | **PROTECTED** | Low — policy enforced |
| application_decisions | YES | YES | YES | **PROTECTED** | Low — policy enforced |
| review_assignment_batches | YES | YES | YES | **PROTECTED** | Low — policy enforced |
| matches | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Match decisions exposed |
| events | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Event data exposed |
| event_registrations | YES | **NO** | Unknown | **UNPROTECTED** | Registrant data and tokens exposed |
| event_links | YES | **NO** | Unknown | **UNPROTECTED** | Registration link tokens exposed |
| mentoring_recaps | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Session notes and meeting dates exposed |
| event_participations | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Attendance records exposed |
| operational_team_assignments | YES | **NO** | YES (policy exists; currently ineffective) | **UNPROTECTED** | Internal team structure exposed |
| intake_batches | YES | **NO** | Unknown | **UNPROTECTED** | Batch metadata exposed |
| crm_notes | YES | **NO** | Unknown | **UNPROTECTED** | Relationship notes exposed |
| programs | YES | YES | YES (is_active_admin) | **PROTECTED** | Low |
| seasons | YES | YES | YES (is_active_admin) | **PROTECTED** | Low |
| activity_correction_log | YES | YES | YES | **PROTECTED** | Low |
| action_items | YES | YES | Unknown | **PARTIALLY PROTECTED** | Unexpected table — not in original inventory |

**Summary totals:**
- Protected (confirmed): 6
- Partially protected: 2
- Unprotected: 19 or more
- Evidence incomplete for several staging/import tables

---

## Phase 6 — Policy Effectiveness Review

### Current state

Policies exist on several RLS-disabled tables. These policies are **currently ineffective** — with RLS disabled, PostgreSQL does not evaluate any policy expression. The table is fully readable by any role regardless of policies defined.

| Table | Has policies | RLS enabled | Policies effective? | USING | WITH CHECK | Admin helper | auth.uid | Program scope | Season scope |
|---|---|---|---|---|---|---|---|---|---|
| people | YES | NO | **NO** | YES | NO | YES (is_active_admin) | NO | NO | NO |
| mentor_profiles | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| mentee_profiles | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| applications | YES | NO | **NO** | YES | NO | YES (role-based) | NO | NO | NO |
| matches | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| events | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| mentoring_recaps | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| event_participations | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| operational_team_assignments | YES | NO | **NO** | YES | NO | YES | NO | NO | NO |
| admin_users | NO | NO | **NO** | — | — | — | — | — | — |
| programs | YES | YES | **YES** | YES | NO | YES | NO | NO | NO |
| seasons | YES | YES | **YES** | YES | NO | YES | NO | NO | NO |
| admin_scope_access | YES | YES | **YES** | YES | NO | NO | YES (auth.uid) | NO | NO |
| application_reviews | YES | YES | **YES** | YES | NO | YES (role-based) | NO | NO | NO |
| application_decisions | YES | YES | **YES** | YES | NO | YES (role-based) | NO | NO | NO |

### Policy structure analysis

**SELECT-only policies with no WITH CHECK:** Normal and expected — writes to all tables go through the service-role client which bypasses RLS. Write policies are not required under the current application architecture.

**admin_users: NO policy of any kind.** This is the highest-risk combination: RLS disabled AND no policy defined. Even if RLS were enabled today, there would be no policy to authorize any access — fail-closed would deny everything. Enabling RLS on admin_users requires simultaneously creating the read policy.

**Internal-role read policies are global, not program-scoped.** All observed policies use `is_active_admin()` (any active admin) or role-tier checks (`is_admin_role(['viewer','reviewer',...])`). No policy references program_id, season_id, or admin_scope_access. This means:
- When policies ARE effective (programs, seasons, activity_correction_log, application_reviews, application_decisions), any active admin can read rows from any program.
- Cross-program isolation is enforced at the application layer (program-scope.ts), not at the database layer.
- Direct API callers with a valid JWT bypass program scope entirely.

**Program/season isolation gap:** Even after enabling RLS, the existing policies will not enforce program-level data isolation for direct API callers. Auth_A migration must be reviewed to determine whether program-scoped policies are feasible or whether cross-program isolation remains application-layer-only.

---

## Phase 7 — Functions and Execute Privileges

### Production privilege matrix

| Function | anon execute | authenticated execute | service_role execute | search_path hardened | Risk |
|---|---|---|---|---|---|
| current_admin_role | **YES** | YES | YES | YES | MEDIUM |
| is_active_admin | **YES** | YES | YES | YES | LOW |
| is_admin_role | **YES** | YES | YES | YES | LOW |
| get_operations_dashboard_data | **YES** | YES | YES | YES | MEDIUM |
| current_admin_context | NO | YES | YES | YES | LOW |
| admin_can_access_season | NO | YES | YES | YES | LOW |
| get_founder_intelligence_dashboard | NO | YES | YES | YES | LOW |

### Anon-callable function analysis (from repository source)

**`current_admin_role()` — EXECUTE granted to anon; MEDIUM risk; fails closed**

```sql
select au.role from public.admin_users au
where au.auth_user_id = auth.uid() and au.status = 'active' limit 1
```
- `auth.uid()` = null for anon → WHERE clause matches zero rows → returns null
- No business data returned to anon callers
- Confirms admin_users table exists (minimal info leak)
- SECURITY DEFINER bypasses RLS to read admin_users — correct design for a policy helper
- EXECUTE grant to anon is unnecessary and should be revoked (Auth_D)

**`is_active_admin()` — EXECUTE granted to anon; LOW risk; fails closed**

```sql
select exists(select 1 from public.admin_users au
  where au.auth_user_id = auth.uid() and au.status = 'active')
```
- With anon: returns false
- No data returned; boolean only
- EXECUTE grant to anon unnecessary; revoke via Auth_D

**`is_admin_role(text[])` — EXECUTE granted to anon; LOW risk; fails closed**

- Calls `current_admin_role()` and checks against the required-roles array
- With anon: current_admin_role() returns null → coalesce(null = any(...), false) = false
- No data returned
- EXECUTE grant to anon unnecessary; revoke via Auth_D

**`get_operations_dashboard_data(text)` — EXECUTE granted to anon; MEDIUM risk; fails closed**

```sql
-- First gate:
select au.role into v_admin_role from public.admin_users au
where au.auth_user_id = v_auth_user_id and au.status = 'active' limit 1;
if v_admin_role is null or v_admin_role not in ('viewer','reviewer','admin','super_admin') then
  raise exception 'VAM OS admin access required' using errcode = '42501';
end if;
```
- With anon (auth.uid() = null): v_auth_user_id = null → no admin_users row found → v_admin_role = null → exception raised
- Anon callers receive an error, not data
- When called legitimately (authorized JWT via server client, not service-role), function returns full_name and email_primary from people — PII returned inside SECURITY DEFINER context is correct behavior for authorized callers
- **Note:** Application code (`data.ts:731`) correctly calls this via `getSupabaseServerClient()` (user JWT), not service-role, so auth.uid() is valid in RPC context
- Migration 022 attempted `REVOKE EXECUTE ON FUNCTION public.get_operations_dashboard_data FROM anon` — this REVOKE was apparently not applied to production or was later reversed
- EXECUTE grant to anon unnecessary; revoke via Auth_D

**`current_admin_context()` and `admin_can_access_season()` — correctly NOT granted to anon**
Both already revoked in production (migration 023 REVOKE was applied). No action required.

**`get_founder_intelligence_dashboard()` — correctly NOT granted to anon**
REVOKE applied. No action required.

---

## Phase 8 — People Auth Linkage Readiness

### Production state

| Item | Status |
|---|---|
| people.auth_user_id column | **ABSENT** — not in production schema |
| Participant login linkage | **NOT READY** |
| current_person_id() helper | ABSENT — no evidence in repository |
| Participant self-read RLS (Auth_C) | ABSENT — dependent on auth_user_id |

**Existing people indexes (from rv10):**
- Primary key on `id`
- Unique index on `email_primary`
- Unique index on `legacy_person_temp_id`
- No auth_user_id index (column does not exist)

### Linkage option comparison

| Option | Description | Auth deletion | Person preserved | Re-invite | Orphan risk | Rollback |
|---|---|---|---|---|---|---|
| **A — No FK + app verification** | auth_user_id stored as plain uuid; app validates existence | No cascade | YES | YES | YES — can store stale auth UIDs | Easiest |
| **B — FK ON DELETE SET NULL** | FK to auth.users(id); deletion nulls auth_user_id | auth deletion nulls column | YES | YES | None | Medium |
| **C — FK ON DELETE RESTRICT** | FK to auth.users(id); prevents auth deletion if person linked | Blocks deletion | YES | N/A (deletion blocked) | None | Medium |

**Recommendation: Option B — FK to auth.users(id) ON DELETE SET NULL**

Rationale:
- Prevents orphaned auth UUIDs in people (unlike Option A)
- Preserves person record when Auth account is deleted — critical for historical data (mentoring records, event participations reference people.id)
- Allows re-invitation by creating a new Auth account and updating auth_user_id
- Consistent with Supabase's documented FK pattern for auth.users
- Admin-created business-only people: auth_user_id remains null, no FK constraint violated
- Not feasible for admin_users (pattern was no FK due to legacy state) but people table is newer and can adopt a stronger constraint

**Departure from admin_users pattern:** admin_users deliberately has no FK to auth.users due to the table's historical creation order and legacy state. The people table will be the first participant-facing table and should adopt FK from the start.

**THIS RECOMMENDATION REQUIRES OWNER APPROVAL** — FK deletion behavior has operational consequences (Auth account deletion cascades to unlinking person from participant login).

---

## Phase 9 — Static Service-Role Code Path Audit

**Architecture summary:** `dataClient()` (lib/data.ts:82) always returns the Supabase service-role client when `SUPABASE_SERVICE_ROLE_KEY` is set. Service-role bypasses ALL RLS policies. All application data reads go through service-role. RLS in production currently provides defense-in-depth only against direct Supabase REST API callers, not against application data paths.

**Scope enforcement architecture:** Program/season scope is enforced at the application layer by `lib/program-scope.ts`. Scope values (allowedProgramIds, allowedSeasonIds) are derived server-side from `admin_scope_access` table via service-role — **scope values are NOT taken from browser input**. This is a sound design.

| File / Helper | Caller pattern | Browser-controlled scope | Actor validation | Program validation | Season validation | Result filtering | Risk |
|---|---|---|---|---|---|---|---|
| `lib/data.ts:getPeople(scope)` | All people pages | NO — scope from getAdminScopeContext() | getCurrentAdminUser() gate | allowedProgramIds via person join | allowedSeasonIds via person join | App layer, server-derived | SAFE |
| `lib/data.ts:getApplications(scope)` | Applications pages | NO — scope from getAdminScopeContext() | getCurrentAdminUser() gate | season/batch filter | Season filter | App layer | SAFE |
| `lib/data.ts:getMatches(scope)` | Matches pages | NO | getCurrentAdminUser() gate | Indirect via season | allowedSeasonIds | App layer | SAFE |
| `lib/data.ts:getEvents(scope)` | Events pages | NO | getCurrentAdminUser() gate | Indirect via season | allowedSeasonIds | App layer | SAFE |
| `lib/data.ts:getMentoringRecapsByMenteePersonId(personId, scope)` | Person detail | NO | getCurrentAdminUser() gate | Indirect via season | allowedSeasonIds applied as DB filter | DB filter | SAFE |
| `lib/data.ts:getOperationalTeamAssignments(scope)` | Team page | NO | getCurrentAdminUser() gate | Indirect via personIds | Indirect via personIds | DB filter | SAFE |
| `lib/data.ts:getRolesForPerson(personId)` | Person detail | personId from URL | getCurrentAdminUser() gate | None — fetches ALL person_roles then JS filters by personId | None | JS filter post-fetch | NEEDS HARDENING — fetches entire person_roles table via service-role then discards; should filter by personId at DB level |
| `lib/data.ts:getDataIssues()` | Data issues page | NO | getCurrentAdminUser() gate | None | None | None | NEEDS HARDENING — returns all data_issues regardless of scope; no program/season filter |
| `lib/data.ts:getAnswersForApplications(ids)` | Application detail | applicationIds from server | getCurrentAdminUser() gate | Inherited from calling context | Inherited | DB filter (IN clause) | SAFE IF caller validates IDs |
| `lib/data.ts:getApplication(id, scope)` | Application detail | id from URL params | getCurrentAdminUser() gate | scope checked after fetch | scope checked after fetch | Post-fetch check | NEEDS HARDENING — DB hit occurs before scope check; should apply scope filter to DB query directly |
| `lib/data.ts:getMatch(id, scope)` | Match detail | id from URL params | getCurrentAdminUser() gate | None | allowedSeasonIds checked after fetch on season_id | Post-fetch check | NEEDS HARDENING — same pattern: DB fetch before scope check |
| `lib/data.ts:updateMentoringRecapCorrection(input)` | Correction action | recapId from form | getAdminScopeContext() gate + canOperateSeason() | canOperateSeason(scopeContext, recap.season_id) | canOperateSeason() | Verified before mutation | SAFE |
| `lib/data.ts:getOperationsDataFromRpc()` | Operations dashboard | season_code from SEASON_CONFIG constant | getSupabaseServerClient() (user JWT) → auth.uid() checked internally | Internal auth gate in RPC | Internal scope check in RPC | RPC returns scoped data | SAFE — RPC called via user JWT, not service-role |
| `lib/program-scope.ts:getAdminScopeContext()` | All scoped pages | NO — reads admin_scope_access via service-role for current user | getCurrentAdminUser() gate | Derived from admin_scope_access rows | Derived from admin_scope_access rows | Server-derived filter | SAFE |

**Highest-risk paths:**
1. `getRolesForPerson(personId)` — full person_roles table scan via service-role, then in-memory filter: inefficient and provides no DB-level guard
2. `getApplication(id, scope)` — fetches application row by ID before scope check; a scoped admin querying another program's application ID would incur a DB read
3. `getDataIssues()` — no scope filter; all data issues visible to any authenticated admin regardless of program assignment

**Key finding: Service-role path architecture is sound.** Scope enforcement is server-derived, not browser-derived. The identified "NEEDS HARDENING" paths are efficiency and defense-in-depth concerns, not immediate security vulnerabilities under the current architecture (application middleware gate stops unauthenticated access). No path was found that accepts a program_id or season_id from the browser and passes it directly to a service-role DB query without server-side validation.

---

## Phase 10 — Recommended Remediation Order

Based on production metadata. Does not assume all disabled RLS tables can be enabled safely in one migration — the application currently uses service-role for all writes and does not supply write policies; enabling RLS without write policies means only service-role can mutate data (which is current behavior, so enabling RLS on read-only tables is safe under the current architecture).

| # | Item | Classification | Rationale |
|---|---|---|---|
| 1 | Revoke anon EXECUTE from current_admin_role, is_active_admin, is_admin_role, get_operations_dashboard_data (Auth_D) | **EMERGENCY** | Unnecessary access grants; migration 022 REVOKE did not take effect in production; required before any participant Auth accounts exist |
| 2 | Enable RLS on admin_users with read policy (Auth_A section A1) | **BEFORE USER ADMIN** | admin_users unprotected at DB layer; any JWT holder can enumerate admin accounts; required before launching Batch 2 user admin |
| 3 | Verify admin_audit_log policy and grant state | **BEFORE USER ADMIN** | RLS is enabled but policy structure is unconfirmed; audit log must be restricted to super_admin read |
| 4 | Add action_type check constraint to admin_audit_log (Auth_A section A9) | **BEFORE USER ADMIN** | Unconstrained action_type allows arbitrary strings; required for audit integrity |
| 5 | Enable RLS on people, mentor_profiles, mentee_profiles (Auth_A) | **BEFORE PARTICIPANT LOGIN** | PII tables unprotected at DB layer; required before any participant can hold a JWT |
| 6 | Enable RLS on applications, application_answers | **BEFORE PARTICIPANT LOGIN** | Application data unprotected; participants must not see each other's applications |
| 7 | Enable RLS on mentoring_recaps, event_participations | **BEFORE PARTICIPANT LOGIN** | Session and attendance data unprotected; sensitive for participant privacy |
| 8 | Enable RLS on matches, events, operational_team_assignments | **BEFORE PARTICIPANT LOGIN** | Operational data unprotected at DB layer |
| 9 | Add people.auth_user_id column + unique partial index + FK (Auth_B — Migration 062) | **BEFORE PARTICIPANT LOGIN** | Architecturally required; no participant login is possible without this column |
| 10 | Add current_person_id() helper function + participant self-read policies (Auth_C — Migration 063) | **BEFORE PARTICIPANT LOGIN** | Participant RLS depends on this helper |
| 11 | Batch 1 — participant Auth account creation + password login | **BEFORE PRODUCTION AUTH DEPLOYMENT** | Blocked on items 5, 9, 10 |
| 12 | Harden getRolesForPerson() to filter at DB level | **DEFENSE IN DEPTH** | Efficiency concern; no active exploit under current architecture |
| 13 | Harden getApplication(), getMatch() to apply scope filter in DB query | **DEFENSE IN DEPTH** | Post-fetch scope check is correct but less efficient |
| 14 | Batch 2 — Admin user management UI | **BEFORE USER ADMIN** | Requires item 2 (admin_users RLS) |
| 15 | Batch 3 — CSV bulk provisioning | **OWNER DECISION REQUIRED** | Depends on Batch 2 completion and owner prioritization |

**Note on enabling RLS for currently-disabled tables:** The application uses service-role for all writes, so enabling RLS without write policies means mutations continue to work through service-role (service-role bypasses RLS). Read policies protect direct API callers. This is safe under current architecture. However, each table should be tested individually — some tables (mentoring_recaps, event_participations) were previously disabled due to Sprint 1B failures and should be validated in staging before re-enabling in production.

---

## Owner Decisions Required

| Decision | Item | Default if not decided |
|---|---|---|
| **D1 — FK deletion behavior** | people.auth_user_id FK: ON DELETE SET NULL vs ON DELETE RESTRICT vs no FK | Recommend Option B (SET NULL); blocks Migration 062 until resolved |
| **D2 — Emergency scope** | Which of items 1–4 above constitute "emergency" vs "scheduled" work | If deferred: risk window remains open |
| **D3 — Program Admin cross-program isolation** | Current policies are global role-based; program-scoped DB policies require Auth_A redesign | If not addressed: Program Admins can access all programs' data via direct API even after RLS enabled |
| **D4 — Participant contact visibility** | Should participants see each other's profiles after matching? | Determines participant RLS policy scope in Auth_C |
| **D5 — Invitation vs temporary password** | Auth account creation method for Batch 1 | Determines migration 062 flow and Admin_users.status semantics |
| **D6 — core_team/support_team scope** | current_admin_context() excludes these roles from the allowlist (migration 023 gap); requires migration 047 follow-up | If deferred: core_team/support_team users cannot use scope-gated functions |

---

## Safety Record

| Action | Status |
|---|---|
| Claude direct database connection | NO |
| Owner-run production query | READ ONLY — Supabase SQL Editor |
| Production mutation | NO |
| Staging query | NO |
| Migration executed | NO |
| Users created | NO |
| Password operation | NO |
| HAM-S6 import | NO |
| Migration 061 | NOT AUTHORIZED — not executed |
| Deployment | NO |
| Credentials in committed files | NO |

---

## Decision

**1. EMERGENCY AUTH/RLS HARDENING DESIGN REQUIRED BEFORE AUTH**

Basis: Production confirms that admin_users has RLS disabled with no policies, four SECURITY DEFINER functions grant unnecessary EXECUTE to anon, and all major PII tables (people, profiles, applications, matches, mentoring_recaps) are unprotected at the database layer. While the current application architecture prevents unauthenticated access through the middleware gate, the absence of database-layer protection means:

1. Any current or former Supabase Auth user for this project with a valid JWT can directly query the production Supabase REST API and read admin accounts, participant PII, and operational data without going through the application.
2. Before any participant Auth accounts are created (Batch 1), the database layer must be hardened — creating participant JWTs increases the attack surface for direct API access.

Minimum required before Batch 1: items 1, 5, 9, 10 in the recommended remediation order above. Items 2 and 3 (admin_users RLS) are required before Batch 2.
