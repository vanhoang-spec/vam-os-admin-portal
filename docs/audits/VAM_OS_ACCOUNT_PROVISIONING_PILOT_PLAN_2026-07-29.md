# VAM OS Account Provisioning Pilot Plan
## 2026-07-29

Design only. No implementation in this task.

---

## Pilot Scope

Six accounts provisioned across the four role levels. The pilot is performed
in staging before any production provisioning.

| Account | Role | Scope | Purpose |
|---|---|---|---|
| 1. Second Super Admin | `super_admin` | Platform-wide | Verify super_admin creation flow; verify super_admin count guard |
| 2. Program Admin | `admin` | HAM program, current season, `full_access` scope | Verify program-scoped admin cannot touch UEHM data |
| 3. Reviewer | `reviewer` | HAM program, current season, `review` scope | Verify reviewer sees only assigned applications |
| 4. Mentor (invited) | `mentor` | HAM-S6 / S12 season membership | Verify participant provisioning path (no admin portal access) |
| 5. Mentee A (invited) | `mentee` | S12 season membership | Verify mentee provisioning; verify no admin portal access |
| 6. Mentee B (invited, existing person) | `mentee` | S12 season membership | Verify provisioning against an existing `people` row; no duplicate |

---

## Pre-Pilot Checklist

- [ ] Batch 1 (auth foundation) applied to staging
- [ ] Batch 2 (user administration) applied to staging
- [ ] Staging smoke test: login, applications, recaps, matches all functional
- [ ] `admin_users` direct API access blocked for non-super_admin JWT
- [ ] Owner (Super Admin) active session in staging

---

## Account 1 — Second Super Admin

**Actor:** Existing Super Admin (owner)
**Route:** `/admin/users` → "Thêm user quản trị"

Steps:
1. Enter email, full name, role=`super_admin`, status=`invited`.
2. Enter password that meets policy. Observe `"Đạt yêu cầu"`.
3. No program/season scope required for `super_admin`.
4. Click "Tạo / mời người dùng".
5. Verify preview shows: proposed_action=`create_auth_invite_and_admin_user`, no conflicts.
6. Confirm. Verify `admin_users` row created with `role=super_admin`, `status=invited`.
7. Verify `admin_audit_log` entry created: `action_type=create_admin_user`.
8. Log in as new Super Admin. Verify access to all pages.

**Pass criteria:**
- `admin_users` count of active `super_admin` rows is now 2.
- "Xóa quyền admin" is disabled for the original Super Admin (guard: 1 remaining
  active super_admin check uses `<=1`).
- Second Super Admin can see all admin user rows.

---

## Account 2 — Program Admin

**Actor:** Existing Super Admin
**Route:** `/admin/users` → "Thêm user quản trị"

Steps:
1. Enter email, full name, role=`admin`, status=`invited`.
2. Select program=`HAM`, season=current HAM season, scope=`full_access`.
3. Confirm. Verify `admin_users` row + `admin_scope_access` row created.
4. Log in as Program Admin.

**Pass criteria:**
- Program Admin can access `/applications` filtered to HAM.
- Program Admin cannot create a `super_admin` user. Attempt: fill Create form with
  role=`super_admin` → server rejects with authorization error.
- Program Admin cannot grant scope to UEHM program. Attempt → server rejects.
- Program Admin can create a `reviewer` user within HAM scope.

---

## Account 3 — Reviewer

**Actor:** Existing Super Admin (or Program Admin from Account 2)
**Route:** `/admin/users` → "Thêm user quản trị"

Steps:
1. Enter email, role=`reviewer`, status=`invited`, scope=`review`, HAM season.
2. Confirm. Log in as Reviewer.

**Pass criteria:**
- Reviewer can access `/reviews` and see only their own assigned reviews.
- Reviewer cannot access `/admin/users`.
- Reviewer cannot submit application decisions (canDecide → false).
- Reviewer cannot access recap edit.

---

## Account 4 — Mentor (Invited Participant)

**Actor:** Existing Super Admin
**Route:** `/mentors/create` (existing flow) or via HAM import — no admin portal login created

Steps:
1. Navigate to `/mentors/create`.
2. Create mentor profile for test email.
3. Verify: `people` row created, `mentor_profiles` row created.
4. Verify: NO `admin_users` row created.
5. Verify: NO `auth.users` invite sent (participant login not yet implemented).
6. Verify: Attempt to log in as mentor email → login page returns "không có quyền truy cập".

**Pass criteria:**
- Mentor exists in CRM.
- No admin portal access via login.
- Participant login gap confirmed and documented.

---

## Accounts 5 & 6 — Mentees (Including Existing Person)

**Actor:** Existing Super Admin
**Route:** Application approval flow (`/applications/[id]` → approve)

Steps for Account 5 (new person):
1. Find a submitted S12 application with a new email.
2. Approve as `mentee`.
3. Verify: `people` row created, `mentee_profiles` row created, `person_season_memberships` row with role=`mentee`, status=`invited`.
4. Verify: NO `admin_users` row created.

Steps for Account 6 (existing person):
1. Find a submitted S12 application whose email matches an existing `people` row.
2. Approve as `mentee`.
3. Verify: existing `people` row reused (no duplicate), new `mentee_profiles` and `person_season_memberships` rows created.
4. Verify: NO `admin_users` row created.

**Pass criteria:**
- Account 5: `people` count increased by 1.
- Account 6: `people` count unchanged; `mentee_profiles` count increased by 1.
- No Auth account created for either mentee.
- Both mentees blocked from admin portal login.

---

## Pilot Rollback Plan

| Rollback trigger | Action |
|---|---|
| Account 1: second Super Admin breaks guard | Immediately set status=`inactive` via original Super Admin; verify guard restored |
| Account 2: Program Admin can see UEHM data | Suspend Account 2; investigate cross-program isolation gap |
| Any test account gains unexpected access | Suspend immediately; document in audit log; escalate to owner |
| Staging DB corruption | Restore from backup; do not proceed to production |

---

## After Pilot

If all pass criteria are met in staging:

1. Document pilot results in the audit log (manual entry).
2. Owner approval to proceed to Batch 2 production deployment.
3. Provision Account 2 (Program Admin) and Account 3 (Reviewer) in production.
4. Accounts 4, 5, 6 (participant provisioning) are already production-equivalent
   via existing mentor/application approval flows — no new production provisioning needed.

---

*Design only. No implementation in this task. No database connections used.*
