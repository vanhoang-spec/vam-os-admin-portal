# VAM OS Admin Authorization Hardening Design
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Purpose

Prove — from code evidence — whether the following self-escalation and cross-admin
read scenarios are possible, and document what hardening is required.

---

## Authorization Model: How Admin Mutations Are Protected

Every write function in `lib/admin-users.ts` starts with:
```typescript
const actor = await requireSuperAdmin();
if (!actor) return { ok: false, message: "..." };
```

`requireSuperAdmin()` (`lib/admin-users.ts:83`) calls `getCurrentAdminUser()` and
checks `adminUser.role === 'super_admin' && adminUser.status === 'active'`. If either
check fails, null is returned and the mutation is rejected.

**Confirmed:** Every mutation (create, update, suspend, remove, sync) is gated by
`requireSuperAdmin()`. There is no path through the Next.js app for a non-super_admin
to mutate admin_users or admin_scope_access.

---

## Scenario Analysis

### Scenario 1: Can a non-super_admin read another admin's row via direct API?

**Via the app:** `listManagedAdminUsers()` calls `requireSuperAdmin()` — returns empty
for any role below super_admin.

**Via direct Supabase API with a valid JWT:**
- `admin_users` has RLS enabled (migration 018 applied).
- Policy `read_admin_users_super_admin_or_self`:
  ```sql
  using (auth.uid() = auth_user_id OR current_admin_role() = 'super_admin')
  ```
- A `viewer`, `reviewer`, `admin`, `core_team`, or `support_team` caller can only SELECT
  their own row. They cannot read other admins' rows.

**Result: BLOCKED.** RLS correctly enforces the own-row restriction for non-super_admin callers.

---

### Scenario 2: Can a non-super_admin modify their own role to escalate?

**Via the app:** All mutation functions gate on `requireSuperAdmin()`. A non-super_admin
cannot call `updateManagedAdminUser` or `createManagedAdminUser`.

**Via direct Supabase API with a valid JWT (UPDATE on admin_users):**
- `admin_users` has RLS enabled.
- Policy `read_admin_users_super_admin_or_self` is FOR SELECT only.
- No INSERT, UPDATE, or DELETE policy exists on `admin_users`.
- PostgreSQL fail-closed: no matching policy = DENY.
- A JWT holder attempting `UPDATE admin_users SET role = 'super_admin'` via REST API
  receives `insufficient_privilege` or an empty update (0 rows affected).

**Result: BLOCKED.** RLS fail-closed behavior on write operations protects against
self-escalation via direct API.

---

### Scenario 3: Can a non-super_admin grant themselves program scope?

**Via the app:** `upsertScope()` is a private function called only from mutation
functions that already check `requireSuperAdmin()`. There is no public endpoint for
self-granting scope.

**Via direct Supabase API with a valid JWT (INSERT on admin_scope_access):**
- `admin_scope_access` has RLS enabled (migration 020).
- Policy `read_admin_scope_access_self_or_super_admin` is FOR SELECT only.
- No INSERT policy exists on `admin_scope_access`.
- PostgreSQL fail-closed: INSERT DENIED.

**Result: BLOCKED.** RLS fail-closed behavior prevents direct scope self-grant.

---

### Scenario 4: Can a super_admin modify their own role/status?

**Via the app:**
- `updateManagedAdminUser` and `setManagedAdminUserStatus` take a target `id`.
- There is NO `actor.id !== id` check. A super_admin CAN pass their own `admin_users.id`
  as the target and modify their own record.
- `wouldRemoveLastActiveSuperAdmin()` prevents downgrading the LAST active super_admin.
  So a lone super_admin cannot self-deactivate or self-demote.
  But with 2+ super_admins, any super_admin can demote themselves.

**Assessment:** Intentional design — super_admin is a trusted role. Self-modification
by a super_admin who is not the last one is acceptable. The last-super_admin guard
prevents lock-out.

**Recommendation:** Add application-layer logging that makes self-modification visible.
The audit log already records actor and target — if they are the same, it is identifiable
in the audit trail. No additional code change required.

---

### Scenario 5: Can an admin read another admin's audit log entries via direct API?

**Via the app:** `listAdminAuditLogs()` calls `requireSuperAdmin()`. Non-super_admins
cannot see audit logs via the app.

**Via direct Supabase API with a valid JWT (SELECT on admin_audit_log):**
- `admin_audit_log` has **NO RLS enabled**. No migration enables RLS on this table.
- Any authenticated JWT holder (including `viewer`, `reviewer`, `core_team`) can
  `SELECT * FROM admin_audit_log` via direct Supabase REST API and read all entries,
  including `before_data` and `after_data` JSONB blobs containing role/status history.

**Risk:** HIGH. `before_data` and `after_data` may contain sensitive role information,
email addresses, and status change history for all admin users.

**Required action:** Enable RLS on `admin_audit_log` with a super_admin-only SELECT
policy. This is the HIGHEST PRIORITY hardening item for admin authorization.

---

### Scenario 6: Can any Supabase RPC function bypass the app auth gate?

**Current state:** No Supabase RPC function wraps any admin mutation. All mutation
logic is server-only TypeScript in `lib/admin-users.ts` with `import "server-only"`.

- Migration 019 defines `get_operations_dashboard_data` — data aggregation, no auth mutation.
- Migration 019 defines `get_mentor_profile_data_by_id` — data read, no auth mutation.
- No RPC function gives access to `createManagedAdminUser`, `updateManagedAdminUser`, etc.

**Result: BLOCKED.** No RPC surface for admin mutations exists.

---

## `canManageUsers` vs `requireSuperAdmin` Mismatch

`lib/permissions.ts` defines:
```typescript
export function canManageUsers(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}
```

This suggests `admin` role can manage users. However, all server-side mutation
functions in `lib/admin-users.ts` gate on `requireSuperAdmin()`, not `canManageUsers()`.

**Impact:** The UI may show "Manage Users" controls to `admin` role users, but clicking
them returns `"Chỉ super_admin mới được..."` error from the server action. No security
vulnerability — the server gate is tighter.

**Recommendation:** Either:
- Update `canManageUsers` to only include `super_admin` (matches actual behavior), OR
- Relax the server gate to allow `admin` role to manage users with appropriate constraints
  (cannot create/promote super_admins; cannot modify other admins above their own role).

**Owner decision required.** See `VAM_OS_AUTH_OWNER_DECISIONS_2026-07-29.md`, item D1.

---

## Self-Escalation Attack Surface Summary

| Attack vector | Outcome | Evidence |
|---|---|---|
| App: non-super_admin creates admin user | BLOCKED | `requireSuperAdmin()` at line 390 |
| App: non-super_admin updates admin user | BLOCKED | `requireSuperAdmin()` at line 456 |
| App: non-super_admin suspends admin user | BLOCKED | `requireSuperAdmin()` at line 512 |
| App: non-super_admin removes admin access | BLOCKED | `requireSuperAdmin()` at line 548 |
| App: non-super_admin syncs auth | BLOCKED | `requireSuperAdmin()` at line 579 |
| Direct API: UPDATE admin_users (role escalation) | BLOCKED | RLS fail-closed (no UPDATE policy) |
| Direct API: INSERT admin_scope_access (scope grant) | BLOCKED | RLS fail-closed (no INSERT policy) |
| Direct API: SELECT admin_users (cross-admin read) | BLOCKED | Policy: own row or super_admin |
| Direct API: SELECT admin_audit_log | **OPEN** | No RLS on admin_audit_log |
| RPC: admin mutation via DB function | BLOCKED | No RPC function wraps mutations |
| Service-role key compromise | **BYPASSES ALL** | Out of scope for RLS hardening |

---

## Hardening Actions Required

### H1 — Enable RLS on `admin_audit_log` (Priority: HIGH)

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
alter table public.admin_audit_log enable row level security;

create policy "read_admin_audit_log_super_admin_only"
on public.admin_audit_log
for select
using (public.current_admin_role() = 'super_admin');
```

This is the only open vulnerability in the admin authorization model for direct API callers.
The application already gates audit log access behind `requireSuperAdmin()`. The RLS
policy adds defense-in-depth that matches the application gate.

### H2 — Clarify `canManageUsers` scope (Priority: LOW — documentation)

Update `lib/permissions.ts` to remove `admin` from `canManageUsers`, or add a comment
explaining why the UI permission and server gate differ. This prevents future developers
from assuming admin can mutate users when adding new features.

### H3 — Add constraint on `admin_audit_log.action_type` (Priority: LOW)

Current schema accepts any string for `action_type`. Canonical values in the codebase:
- `"create_admin_user"`, `"update_admin_user"`, `"remove_admin_access"`
- `"reactivate_admin_user"`, `"deactivate_admin_user"`, `"sync_auth"`

A check constraint prevents non-canonical strings and makes audit searches reliable:
```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
alter table public.admin_audit_log
  add constraint admin_audit_log_action_type_check
  check (action_type in (
    'create_admin_user', 'update_admin_user', 'remove_admin_access',
    'reactivate_admin_user', 'deactivate_admin_user', 'sync_auth'
  ));
```

---

## Authorization Compatibility — Impact of Hardening H1

After adding RLS to `admin_audit_log`:

| Caller | Affected? |
|---|---|
| App via service-role (`listAdminAuditLogs`) | NO — service-role bypasses RLS |
| `writeAuditLog` inserts via service-role | NO — service-role bypasses RLS |
| Direct API JWT with super_admin | NO — policy allows super_admin |
| Direct API JWT with non-super_admin | CHANGE — was open; now blocked ✅ |

No regression risk for current application behavior.

---

*Design only. No production or staging connection used. No SQL executed.*
