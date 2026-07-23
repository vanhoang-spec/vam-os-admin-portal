# HAM-S6 Production — Admin Account Plan
## 2026-07-23

Production admin accounts are NOT part of the foundation import.
They require a separate decision and separate authorization.

---

## Separation from foundation import

The foundation import (modules 01–06) creates:
- HAM program row (already exists from migration 036)
- HAM-S6 season
- HAM-S6-B1 batch
- People, profiles, and matches

The foundation import does NOT create:
- Supabase Auth users (email + password identities)
- `admin_users` rows
- `admin_scope_access` rows

Admin account provisioning must be authorized separately after foundation import
verification passes.

---

## Existing Auth identity check

Before creating new production admin accounts, the owner must check whether the intended
email addresses already exist in the production Supabase Auth user store:
- `hanoimentoring@gmail.com`
- `vanlethu79@gmail.com` (or any replacement accounts designated by the owner)

If either account already exists in production Auth, update the account rather than
creating a new one.

The check can be performed via the Supabase dashboard → Authentication → Users (search
by email). Do not use the SQL API to access auth.users directly.

---

## Required `admin_users` rows

For each HAM admin:

| Column | Value |
|---|---|
| `auth_user_id` | UUID from Supabase Auth (resolved at runtime) |
| `email` | admin email address |
| `full_name` | admin full name |
| `role` | `admin` |
| `status` | `active` |

Upsert on conflict by `email`.

---

## Required `admin_scope_access` rows

For each HAM admin, one scope row per program/season combination:

| Column | Value |
|---|---|
| `user_id` | Auth user UUID |
| `program_id` | `HAM` (string code — not UUID, per existing schema) |
| `season_id` | `HAM-S6` (string code — not UUID, per existing schema) |
| `role` | `operations` |
| `status` | `active` |

Note: `admin_scope_access.program_id` and `season_id` store string codes, not UUIDs.
This is confirmed by the staging admin creation script (`create-ham-staging-admins.mjs`).

---

## Recommended least-privilege scope

| Scope dimension | Value | Reason |
|---|---|---|
| Program | HAM only | Least privilege — no UEH visibility |
| Season | HAM-S6 only | Scoped to current season |
| Role | `operations` | Same as staging QA validated |

Do NOT grant `super_admin` role. Do NOT grant UEH scope.

---

## HAM-only program scope

The scope row must restrict access to `program_id = 'HAM'` only. HAM admins must not
have visibility into UEHM-S11, UEHM-S12, or any other program.

The QA checkpoint (`HAM_S6_STAGING_ACCESS_QA.md`) confirmed that:
> A UEHM-only scoped user does NOT see HAM data.
The inverse must also hold: a HAM-scoped user must NOT see UEH data.

---

## Password / invitation process

Options (owner decides):
1. **Generated password**: generate a secure password, communicate to the admin via a
   secure channel. Admin changes password on first login.
2. **Password reset email**: create the Auth account without a password and send a
   password reset link via Supabase dashboard → Authentication → Invite user.
3. **Shared account**: if the two staging test accounts are the intended production
   accounts, the owner must decide whether to promote them or create new accounts.

Do NOT embed passwords in code, SQL, or repository files.

---

## Login smoke test

After provisioning, the owner should verify:

1. Admin can log in at the production URL
2. Admin can access `/operations` and sees HAM-S6 data
3. Admin cannot access `/programs/UEHM` or any UEHM-scoped view
4. Admin cannot access `/admin` (super-admin only routes)

---

## Direct-route access denial tests

After provisioning, verify denial of unauthorized routes:

| Route | Expected result for HAM operations admin |
|---|---|
| `/admin` | Forbidden / redirect to login or 403 |
| `/admin/users` | Forbidden |
| `/programs/UEHM` | Forbidden or empty (no scope) |
| `/programs/HAM` | Accessible (HAM scope) |
| `/operations` | Accessible (HAM-S6 scope) |

---

## Account revocation

To revoke a HAM admin account:

1. Set `admin_scope_access.status = 'inactive'` for all HAM scope rows for that user
2. Set `admin_users.status = 'inactive'` for that user
3. Optionally: disable the Auth account via Supabase dashboard → Authentication → Users

Do NOT delete `admin_users` or `admin_scope_access` rows — set to inactive for audit trail.

---

## Audit logging

Admin account creation and scope changes should be logged in whatever audit mechanism
is in place (`admin_audit_log` or equivalent). This is outside the scope of the
foundation import and is the owner's responsibility at account-provisioning time.

---

## Authorization phrase

```
AUTHORIZE PRODUCTION HAM ADMIN ACCOUNTS
```

This phrase must be issued by the owner before any admin account is created or modified
in production. It does not authorize the foundation import or any other action.

---

## Production script note

`scripts/create-ham-staging-admins.mjs` has a hard staging-only guard
(`assertStagingUrl()` throws on production URL). It **must not** be used against
production without removing the guard AND changing the target environment. A separate
production script or manual Supabase dashboard action is recommended.
