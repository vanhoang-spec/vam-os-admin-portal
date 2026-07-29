# VAM OS Canonical Role and Permission Model
## 2026-07-29

Derived from: `supabase_migrations/`, `lib/permissions.ts`, `lib/auth-constants.ts`,
`lib/admin-users.ts`, `supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql`.
No roles invented. All values are from existing database constraints and code.

---

## Concept Separation

VAM OS manages six distinct authorization concepts that must not be conflated:

| Concept | Table / Location | Description |
|---|---|---|
| 1. Supabase Auth identity | `auth.users` | Email + password credential; managed by Supabase |
| 2. Business person record | `public.people` | The human being; may exist without an Auth account |
| 3. Platform-level admin role | `public.admin_users.role` | Admin portal access; staff only |
| 4. Program-level access | `public.admin_scope_access` (program_id) | Which program(s) a staff member may operate |
| 5. Season / intake access | `public.admin_scope_access` (season_id) | Which season(s) a staff member may operate |
| 6. Participant role in a season | `public.person_season_memberships.role` | Mentor, mentee, reviewer, etc. within a specific season |
| 7. Application / profile lifecycle status | `public.person_season_memberships.status`, `public.applications.status` | Where in the programme lifecycle a participant is |

A person may exist in `public.people` with no `auth.users` account.
An `auth.users` account does not grant any business role by itself.
Creating an Auth account must not silently grant a platform or participant role.
Authorization is always derived from the database, never from browser-submitted role values.

---

## Platform-Level Admin Roles (`admin_users.role`)

Source: `supabase_migrations/017_create_admin_users_and_roles.sql` +
`supabase_migrations/047_fix_admin_users_role_constraint_core_support_team.sql` +
`lib/auth-constants.ts`

| Canonical role | Scope | Source table | Can manage accounts | Can assign roles | Data access |
|---|---|---|---|---|---|
| `super_admin` | Platform (all programs, all seasons) | `admin_users` | Yes — all admin users | Yes — can create/edit any role including `super_admin` | Full platform access; bypasses program/season scope restrictions |
| `admin` | Assigned programs/seasons via `admin_scope_access` | `admin_users` | Yes — can create/edit non-super_admin users | Yes — can assign roles below `admin` | Full access within assigned scope; no cross-scope access |
| `core_team` | Assigned programs/seasons | `admin_users` | No — cannot mutate admin_users | No — cannot assign roles | Operations access: recap edit, review assignment, match management, workflow within scope |
| `support_team` | Assigned programs/seasons | `admin_users` | No | No | Operations access: read + limited write within scope |
| `reviewer` | Assigned applications/batches | `admin_users` | No | No | Can access `/reviews`, submit scoring, self-claim interviews within assigned scope |
| `viewer` | Assigned programs/seasons | `admin_users` | No | No | Read-only access within scope |

**Role hierarchy (permission superset order):**
`super_admin` ⊃ `admin` ⊃ `core_team` ⊃ `support_team` ⊃ `reviewer` ⊃ `viewer`

---

## Admin Scope Access Roles (`admin_scope_access.role`)

Source: `lib/admin-users.ts` `SCOPE_ROLES` constant and `scopeRoleForAdminRole()`:

| Scope role | Mapped from admin role | Description |
|---|---|---|
| `full_access` | `super_admin`, `admin` | Full read+write to all data in the assigned program/season |
| `operations` | `core_team`, `support_team` | Operational access: recap, match, review assignment, workflow |
| `review` | `reviewer` | Application scoring and interview within assigned batch |
| `read` | `viewer` | Read-only; no mutations |

A `super_admin` bypasses scope restrictions and can operate across all programs and
seasons without explicit `admin_scope_access` rows.

---

## Participant / Membership Roles (`person_season_memberships.role`)

Source: `supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql`

| Canonical role | Scope | Description |
|---|---|---|
| `mentor` | Season | Mentoring programme mentor participant |
| `mentee` | Season | Mentoring programme mentee participant |
| `supporter` | Season | Supporting participant (non-mentor, non-mentee) |
| `reviewer` | Season | Application reviewer role within the season (distinct from admin_users reviewer) |
| `interviewer` | Season | Interview assessor within the season |
| `coreteam` | Season | Core team participant role within a season (distinct from staff core_team) |
| `advisor` | Season | Advisory participant |
| `alumni_mentee` | Season | Former mentee who has graduated but maintains alumni status |
| `guest` | Season | Guest participant (no full programme membership) |

Note: `reviewer` and `coreteam` appear in both `admin_users.role` (staff) and
`person_season_memberships.role` (participant). These are distinct contexts:
a staff member with role `reviewer` has admin portal access; a person with a
`reviewer` membership has been assigned to review applications in a specific season.
The same person can hold both simultaneously.

---

## Application Status (`applications.status`)

Source: `supabase_migrations/038_s12_intake_foundation.sql` and
`supabase_migrations/041_application_decision_workflow.sql`

| Status | Description |
|---|---|
| `submitted` | Application received; awaiting review assignment |
| `under_review` | Review in progress — at least one reviewer assigned |
| `interview_scheduled` | Interview stage |
| `interview_in_progress` | Interview actively underway |
| `accepted` | Decision: accepted |
| `rejected` | Decision: rejected |
| `waitlisted` | Decision: waitlisted |
| `withdrawn` | Applicant withdrew |
| `excluded` | Excluded by admin (migration 058 `excluded` status added) |

Application status is explicitly separate from membership status and account status.
An `accepted` application does not automatically create an Auth account or membership.

---

## Membership Status (`person_season_memberships.status`)

Source: `supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql`

| Status | Description |
|---|---|
| `invited` | Person has been invited but has not yet confirmed |
| `active` | Fully participating in the season |
| `paused` | Temporarily suspended from active participation |
| `withdrawn` | Withdrew from the season |
| `completed` | Completed all season requirements |
| `graduated` | Graduated from the programme |
| `opted_out` | Voluntarily opted out |
| `cancelled` | Cancelled by admin |

This status governs operational participation — whether the person is currently
participating in the season. It is independent of their Auth account status.

---

## Admin Account Status (`admin_users.status`)

Source: `lib/admin-users.ts` `ADMIN_STATUSES` constant:

| Status | Description |
|---|---|
| `invited` | Auth account created (or invite sent); admin row exists but user has not yet activated |
| `active` | Full access — middleware `authAllowsRequest()` only allows `active` records |
| `suspended` | Temporarily denied — middleware blocks immediately without requiring logout |
| `inactive` | Permanently removed access — all scope grants cleared |

---

## Permission Functions (from `lib/permissions.ts`)

| Function | Allowed roles | Purpose |
|---|---|---|
| `canAccessAdminUser()` | `super_admin`, `admin`, `core_team` | Access admin user management |
| `canManageUsers()` | `super_admin`, `admin` | Create and edit admin users |
| `canEditRecap()` | `super_admin`, `admin`, `core_team` | Edit mentoring recaps |
| `canAssignReview()` | `super_admin`, `admin`, `core_team` | Assign applications to reviewers |
| `canReview()` | `super_admin`, `admin`, `core_team`, `reviewer` | Submit application scores |
| `isReviewerOnly()` | `reviewer` only | Scope list to own assignments |
| `canDecide()` | `super_admin`, `admin`, `core_team` | Record application decisions |
| `canBulkAssignReviews()` | `super_admin`, `admin`, `core_team` | Bulk-assign reviewers |
| `canManageReviewers()` | `super_admin`, `admin`, `core_team` | Enable/link reviewer accounts |
| `canSelfClaimInterview()` | `super_admin`, `admin`, `core_team`, `reviewer` | Self-claim interview from /interviews |
| `canManageMatches()` | `super_admin`, `admin`, `core_team` | Create and cancel mentor–mentee matches |
| `canOperateAnyScope()` | TBD — checked against admin_scope_access rows | Confirms caller has an active scope grant for the target program/season |

---

## Multi-Program and Multi-Season Participation

| Question | Answer |
|---|---|
| Can a person participate in multiple programs? | **YES.** `public.people` is program-agnostic. `person_season_memberships` links person → season, and seasons link to programs. A person can have memberships in HAM-S6 AND UEHM-S12 simultaneously. |
| Can a person participate in multiple seasons of the same program? | **YES.** No constraint prevents multiple season memberships in the same program. HAM-S7 could have HAM-S6 alumni as mentors. |
| Can a person hold different roles across seasons? | **YES.** `person_season_memberships` has unique constraint `(person_id, season_id, role)` — not `(person_id, season_id)`. A person can be `mentor` in HAM-S6 and `mentee` in UEHM-S12. |
| Can a person hold mentor and mentee roles in different contexts? | **YES.** Different seasons, different `person_season_memberships` rows. |
| Can a person hold two roles in the same season? | **YES** (by design — no constraint forbids it). A `supporter` who is also an `alumni_mentee` in the same season would have two rows in `person_season_memberships` for that season. |
| Can a business person exist without an Auth account? | **YES.** `public.people` has no FK to `auth.users`. Mentors and mentees imported via HAM-S6 CSV have `people` rows but no Auth credentials. |
| Can an admin staff member also be a programme participant? | **YES** — the tables are orthogonal. A `core_team` staff member with an `admin_users` row can also have a `person_season_memberships` row as a `supporter`. |

---

## Role Gaps and Required Decisions

| Gap | Description | Owner decision required |
|---|---|---|
| Participant login role | Mentors and mentees have no Auth account and no defined login path. When they do get accounts, what admin role (if any) should they have in `admin_users`? They likely should NOT be in `admin_users` at all — they need a separate auth path. | YES |
| `support_team` permissions | The `support_team` role is constrained in migrations but its permissions are not explicitly separated from `core_team` in `lib/permissions.ts`. Most functions treat them identically. | Consider |
| `viewer` functional scope | `viewer` is in the canonical role list but `canAccessAdminUser()` excludes it. What can a `viewer` actually access in the portal today? | Clarify |
| Reviewer overlap | A person can be both a `reviewer` in `admin_users` (staff access) and a `reviewer` in `person_season_memberships` (participant role). No invariant enforces this is the same person or prevents split state. | Document |

---

*Derived from existing code and migrations. No roles invented.*
*Audit prepared 2026-07-29. No database connections used.*
