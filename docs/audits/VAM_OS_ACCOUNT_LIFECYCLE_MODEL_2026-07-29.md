# VAM OS Account Lifecycle Model
## 2026-07-29

Derived from schema, migrations, and application code. No database connections used.

---

## Two Orthogonal Lifecycles

VAM OS maintains two independent lifecycle tracks that must not be merged:

1. **Business person lifecycle** — exists in `public.people`; governs CRM and
   programme participation. Does not require an Auth account.

2. **Platform auth lifecycle** — exists in `auth.users` + `public.admin_users`.
   Governs portal access. Staff only (currently).

These two lifecycles intersect only through the `auth_user_id` column in
`admin_users` and (when participant login is built) through a future
`people.auth_user_id` or equivalent linkage.

---

## Admin Account Lifecycle

Source: `lib/admin-users.ts`, `supabase_migrations/017_create_admin_users_and_roles.sql`,
`supabase_migrations/024_super_admin_user_console.sql`

| Lifecycle state | Auth state | `admin_users.status` | Access allowed | Admin action |
|---|---|---|---|---|
| Business person only (no admin account) | No auth.users row | No admin_users row | None — not a portal user | Create admin account via `/admin/users` |
| Invited — Auth account created, not activated | `auth.users` row exists; password may not be set | `invited` | Blocked — middleware requires `status='active'` | User must set password via invite email → `/reset-password` |
| Active | `auth.users` row with valid password | `active` | Full access per role and scope | — |
| Suspended — temporary denial | `auth.users` row still exists | `suspended` | Blocked — middleware checks status on every request; immediate effect without logout | Super Admin sets `suspended`; reverse with `active` |
| Inactive — permanent removal | `auth.users` row may still exist | `inactive` | Blocked | Super Admin calls `removeAdminAccess()` which sets `inactive` and clears all `admin_scope_access` rows |
| Auth user unlinked (no admin_users row) | `auth.users` row exists | No row | Blocked — login action checks for active admin_users | Requires `SyncAuthForm` or re-invitation |
| First login (auth_user_id backfill) | Auth session valid; `admin_users.auth_user_id` is null | `active` | Allowed — `admin-auth.ts` backfills `auth_user_id` on first successful login | Automatic; recorded in `admin_audit_log` |

**Transition rules:**
- `invited` → `active`: set by Super Admin; user then sets password and logs in.
- `active` → `suspended`: Super Admin action; immediate access denial.
- `suspended` → `active`: Super Admin restores; access resumes on next request.
- `active` → `inactive`: Super Admin removes access; all scopes cleared.
- `inactive` → `active`: requires Super Admin re-invitation (scopes must also be re-granted).
- Last active Super Admin cannot be deactivated (guarded by `canRemoveOrDeactivate()` in `app/admin/users/page.tsx:61–63`).

---

## Participant (Mentor / Mentee) Lifecycle

Source: `supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql`,
`supabase_migrations/038_s12_intake_foundation.sql`

| Lifecycle state | `people` row | `person_season_memberships.status` | Auth account | Access allowed | Admin action |
|---|---|---|---|---|---|
| Business person only, no Auth account | EXISTS | None (not yet a programme member) | None | None | Import via CSV or manual creation |
| Invited to season | EXISTS | `invited` | None (not required yet) | None — no login path for participants yet | Admin creates membership row |
| Active participant | EXISTS | `active` | None currently | None — no participant login yet | — |
| Paused | EXISTS | `paused` | Preserved | None (when participant login exists, access denied) | Admin sets `paused` |
| Withdrawn | EXISTS | `withdrawn` | Preserved | None | Participant or admin withdraws |
| Completed | EXISTS | `completed` | Preserved | None / alumni | Programme ends successfully |
| Graduated | EXISTS | `graduated` | Preserved | Alumni access (if implemented) | Programme milestone achieved |
| Opted out | EXISTS | `opted_out` | Preserved | None | Participant choice |
| Cancelled | EXISTS | `cancelled` | Preserved | None | Admin cancels membership |
| Alumni mentee | EXISTS | New membership row with role `alumni_mentee` | If built | Alumni scope | Former mentee given alumni status |

**Note:** Currently no participant has an Auth account or login path. All participant
lifecycle state is in `person_season_memberships`. Auth integration for participants
is a future work item.

---

## Application Lifecycle

Source: `supabase_migrations/038_s12_intake_foundation.sql`,
`supabase_migrations/041_application_decision_workflow.sql`,
`supabase_migrations/058_add_excluded_status.sql`

| State | Description | Next state options |
|---|---|---|
| `submitted` | Application received | `under_review`, `excluded`, `withdrawn` |
| `under_review` | Reviewer(s) assigned | `interview_scheduled`, `rejected`, `waitlisted`, `withdrawn` |
| `interview_scheduled` | Interview confirmed | `interview_in_progress`, `withdrawn` |
| `interview_in_progress` | Interview underway | `accepted`, `rejected`, `waitlisted` |
| `accepted` | Accepted — candidate transitions to membership creation | End state |
| `rejected` | Rejected | End state |
| `waitlisted` | Waitlisted | `accepted`, `rejected` |
| `withdrawn` | Applicant withdrew | End state |
| `excluded` | Excluded by admin | End state |

Application lifecycle is explicitly distinct from membership lifecycle. An `accepted`
application does not automatically create an `auth.users` account or a
`person_season_memberships` row — these must be explicitly provisioned.

---

## Missing Invariants

| Gap | Description | Risk |
|---|---|---|
| No Auth account for participants | Mentors and mentees cannot log in, reset their own password, or access any self-service portal | HIGH — must be addressed before participant-facing features |
| No `invited` → `active` automation for participants | When a participant receives an invite email, there is no flow to activate their membership | HIGH — links invitation to activation |
| No deletion flow | No `DELETE` is defined for any lifecycle state. `inactive` and `cancelled` are soft-deletions. No hard-delete path for GDPR or data subject requests | MEDIUM — regulatory risk |
| No business-person → Auth linkage column | `public.people` has no `auth_user_id` column. When participant login is built, a migration will be needed to link people rows to auth accounts | MUST PLAN |
| No password-change history or audit | Password changes via `/reset-password` are not logged anywhere in the application or database | MEDIUM — compliance |
| No forced re-login on role change | If a user's role in `admin_users` is changed while they have an active session, the new role takes effect only on the next API call that re-validates the admin_users row. No session invalidation mechanism exists | MEDIUM — privilege escalation window |

---

*Audit prepared 2026-07-29. No database connections used. No code changes made.*
