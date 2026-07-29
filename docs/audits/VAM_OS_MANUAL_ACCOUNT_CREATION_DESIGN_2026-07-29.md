# VAM OS Manual Account Creation Design
## 2026-07-29

Design only. No implementation in this task.

---

## Owner Input Fields

When creating a new account the administrator must supply:

| Field | Type | Required | Validation |
|---|---|---|---|
| Full name | Text | Yes | Non-empty after trim |
| Email | Text | Yes | Normalize: `trim().toLowerCase()`; valid email format; must not already exist in `admin_users` |
| Temporary password | Password (entry only — never stored in plaintext) | Yes for staff; No for future participants (invite flow) | Password policy: minimum 8 characters, at least one uppercase, one digit, one special character |
| Canonical role | Dropdown | Yes | Server-side: must be in `ADMIN_ROLES` allowlist; no `super_admin` if caller is not `super_admin` |
| Program | Dropdown (from `public.programs`) | No | If provided: must be a valid program code from the DB |
| Season | Dropdown (from `public.seasons` filtered by program) | No | If provided: must be a valid season code linked to the selected program |
| Intake batch | Dropdown (from `public.intake_batches` filtered by season) | Conditional | Required only if the canonical model requires it for the assigned role |
| Initial status | Radio: Active / Invited | Yes | Default: `invited`; `active` requires explicit Super Admin choice |

---

## Pre-Mutation Preview (Required Before Any Write)

Before any mutation the server must query and display:

| Preview item | Source | Display |
|---|---|---|
| Auth user exists? | `auth.admin.listUsers()` search | "Auth account found" / "Auth account not found — will be invited" |
| Business person exists? | `public.people` search by normalized email | "Business person record found (ID: …)" / "No business person record — account is staff-only" |
| Existing admin_users row? | `public.admin_users` search by normalized email | "Admin record exists (role: …, status: …)" / "No admin record — will be created" |
| Existing scope grants? | `public.admin_scope_access` by user_id | List of current active program/season scopes |
| Proposed action | Derived from above | e.g., "Create auth invite, create admin_users row (reviewer), grant operations scope to HAM-S6" |
| Conflicts | Derived | e.g., "Existing admin record with role admin — cannot downgrade to reviewer without removing current role" |
| Password policy result | Client-side strength check | "Đạt yêu cầu" / "Không đạt yêu cầu" — NEVER show plaintext, masked password, length, or fragments |

The preview is computed server-side but displayed to the administrator before a
Confirm button appears. Only after explicit confirmation does mutation proceed.

---

## Mutation Rules (Server-Side Enforcement)

1. **Never display or log an existing password.** Not even masked. Not in logs.
2. **Never overwrite an existing Auth user password.** If an `auth.users` row exists
   for the email, use `auth.admin.inviteUserByEmail()` to send a new invite link —
   which does not change the existing password. If the owner wants to reset a password
   for an existing user, that requires a separate "Reset password" action with its own
   authorization phrase.
3. **Never convert a staff admin to a participant role silently.** Creating an account
   with `reviewer` role does not add a `person_season_memberships` row. Membership
   creation is a separate action.
4. **Never grant `super_admin` based only on browser input.** The server action must
   re-check `requireSuperAdmin()` for the calling user and only allow `super_admin`
   creation if the caller is `super_admin`. Program Admins (`admin` role) cannot
   create `super_admin` rows.
5. **Role and scope are validated server-side** against the canonical allowlist
   (`ADMIN_ROLES` and `SCOPE_ROLES` in `lib/admin-users.ts`) before any DB write.
   A role value submitted by the browser that is not in the allowlist defaults to
   `viewer` — it does not cause a DB write with an invalid role.
6. **Existing people may receive additional program/season participation** via scope
   grants. An existing admin_users row can have new `admin_scope_access` rows added
   without replacing existing ones.
7. **No duplicate business person.** If a `people` row exists for the email, it must
   not be duplicated. Staff-only accounts may have no `people` row at all.
8. **New Auth user rollback** must never delete a pre-existing Auth user. Rollback
   only deletes an Auth user that was created in the same transaction. If the Auth
   user existed before this mutation, it is preserved even if the `admin_users` write
   fails.

---

## Mutation Sequence (Ordered, Atomic Where Possible)

```
1. Authorize caller: requireSuperAdmin() [or requireAdmin() for non-super_admin creation]
2. Normalize email: trim().toLowerCase()
3. Validate all fields server-side (role, status, scope codes)
4. Check for existing Auth user (auth.admin.listUsers, paginated)
5. Check for existing admin_users row
6. If no Auth user: auth.admin.inviteUserByEmail() [returns auth_user_id]
   If Auth user exists: use existing auth_user_id
7. Upsert admin_users row (INSERT ... ON CONFLICT DO NOTHING or UPDATE status)
   — set auth_user_id, full_name, role, status
8. If program/season provided: INSERT admin_scope_access row
   ON CONFLICT (user_id, program_id, season_id, role) DO NOTHING
9. Write audit log (writeAuditLog() in lib/admin-users.ts)
   — record actor, target, action_type, before_data, after_data
10. Return success result with created/updated counts
```

**Rollback on step failure:**
- If step 6 created a new Auth user but step 7 fails: delete the newly created
  Auth user via `auth.admin.deleteUser(newAuthUserId)`.
- If the Auth user already existed (not created in step 6): preserve it.
  Only the `admin_users` write failure needs to be surfaced.
- If step 7 succeeds but step 8 fails: surface the scope grant failure to the
  admin — the `admin_users` row was written and the audit log should reflect the
  partial state. A follow-up scope grant action can complete the assignment.

---

## Program Admin Scope Restriction

A `Program Admin` (role `admin`) may create accounts only within their assigned
programs and seasons. The server action must verify:

```
callerScopes = admin_scope_access for caller, status='active'
targetProgram ∈ {s.program_id for s in callerScopes where s.role = 'full_access'}
```

If the caller attempts to grant access to a program or season not in their scope,
the action must reject with an authorization error — not silently downgrade.

`super_admin` is exempt from scope restriction.

---

## Audit Trail

Every account creation and modification writes to `admin_audit_log`:

| Field | Value |
|---|---|
| `actor_admin_user_id` | Calling admin's `admin_users.id` |
| `target_admin_user_id` | Target user's `admin_users.id` |
| `action_type` | `create_admin_user`, `update_role`, `grant_scope`, `revoke_scope`, `suspend`, `restore`, `deactivate` |
| `before_data` | JSONB snapshot of row before mutation (null for creation) |
| `after_data` | JSONB snapshot of row after mutation |
| `created_at` | Timestamp |

---

## UI Touchpoints

- Existing: `/admin/users` page with `CreateAdminUserForm` (Super Admin only).
  Needs to be extended to:
  - Add the preview step before confirmation.
  - Add password policy feedback (strength only — no plaintext display).
  - Add program/season/batch selector.
  - Add initial status selector (invited vs. active).

- Future: `/admin/users/new` dedicated page for cleaner full-screen creation flow.

---

*Design only. No implementation in this task. No database connections used.*
