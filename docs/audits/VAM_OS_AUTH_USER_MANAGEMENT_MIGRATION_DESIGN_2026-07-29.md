# VAM OS Auth & User Management Migration Design
## 2026-07-29

Design only. No implementation in this task.

---

## Current Migration State

| Migration | Description | Status | Applied? |
|---|---|---|---|
| 017 | `admin_users` table + first super_admin seed | Production | YES |
| 018 | DRAFT RLS read policies + helper functions | DRAFT — DO NOT RUN UNTIL APPROVED | NO |
| 020 | `admin_scope_access` schema alignment; RLS policy for self/super_admin; `current_admin_role()` + `is_active_admin()` helpers | Production | YES |
| 024 | `admin_audit_log` table | Production | YES |
| 047 | Fix `admin_users.role` constraint: adds `core_team` and `support_team` | Production | YES |
| 057 | DESIGN ONLY: RLS for `event_links`, `event_registrations`; revoke EXECUTE on `current_admin_context()`, `is_active_admin()`, `admin_can_access_season()` from `anon`, `public` | DESIGN ONLY — NOT APPLIED | NO |

---

## Schema Readiness Analysis

### 1. Auth-to-Person Linkage

**`admin_users` → `auth.users`:** `admin_users.auth_user_id uuid null`. FK to `auth.users` is implicit (nullability). Suitable for admin staff linkage.

**Gap — `people` → `auth.users`:** `public.people` has NO `auth_user_id` column. When participants (mentors, mentees) need login accounts, this column must be added. Required migration:

```sql
alter table public.people
  add column if not exists auth_user_id uuid null;

create unique index if not exists people_auth_user_id_idx
  on public.people(auth_user_id)
  where auth_user_id is not null;

comment on column public.people.auth_user_id is
  'Supabase Auth user id for participant login. Null until participant account is created.';
```

This migration does not exist yet. It must be created before participant login is built.

---

### 2. Platform Role Representation

**Fully covered.** `admin_users.role` with constraint:
```
check (role in ('viewer','reviewer','support_team','core_team','admin','super_admin'))
```
Migration 047 added `core_team` and `support_team` to the constraint.
`ADMIN_ROLES` Set in `lib/admin-users.ts` matches.

No migration gap for platform admin roles.

---

### 3. Invited vs. Auth-Linked Identity

**Covered but partially.** `admin_users.status` values:
```
check (status in ('invited','active','suspended','inactive'))
```

An `invited` row means `auth_user_id` may be null or set (invite email sent but not activated). An `active` row has `auth_user_id` set and user has logged in.

**Gap — No explicit `invited_at` timestamp:** When a user is invited, only `created_at` is recorded. There is no `invited_at` or `last_invited_at` column. Re-invitation (resending invite email) cannot be distinguished from original invitation in the audit log.

**Gap — No `invitation_token` or `invitation_sent_at`:** Supabase Auth's `inviteUserByEmail` returns an invite URL but there is no column to store whether the invite was sent or when it expires (Supabase invites expire in 24h by default).

---

### 4. Deactivated Access

**Covered.** `admin_users.status = 'inactive'` is the soft-delete state. `removeAdminAccess()` in `lib/admin-users.ts` sets status to `inactive` and deletes all `admin_scope_access` rows for the user.

`admin_scope_access.status` also has `'active'` / `'inactive'` — scope grants can be individually deactivated without removing the admin_users row.

No migration gap for deactivated access representation.

---

### 5. Audit Events

**Covered.** `public.admin_audit_log` (migration 024):
- `actor_admin_user_id` → FK to `admin_users.id`
- `target_admin_user_id` → FK to `admin_users.id`
- `action_type` text (not constrained to a check — any string allowed)
- `before_data` JSONB / `after_data` JSONB
- `created_at` timestamptz

**Gap — No constraint on `action_type`:** Any string is accepted. Canonical action types are scattered in `lib/admin-users.ts` strings. A check constraint or enum would enforce consistency.

**Gap — Audit log has no RLS.** `admin_audit_log` has no RLS policy in any applied migration. Migration 018 (DRAFT) does not include an `admin_audit_log` policy.

**Gap — Password change events not logged.** When a user changes their password via `/reset-password`, the Supabase `updateUser()` call leaves no entry in `admin_audit_log`. No application-level log of password change events exists.

---

### 6. Applied RLS Coverage

| Table | RLS enabled? | Applied policy? | Source |
|---|---|---|---|
| `admin_users` | NO (017 comment: "RLS will be implemented later") | NO — migration 018 is DRAFT | GAP |
| `admin_scope_access` | YES | `read_admin_scope_access_self_or_super_admin` | Migration 020 |
| `admin_audit_log` | NO | NO policy in any applied migration | GAP |
| `programs` | NO | Migration 018 only (DRAFT) | GAP |
| `seasons` | NO | Migration 018 only (DRAFT) | GAP |
| `people` | NO | Migration 018 only (DRAFT) | GAP |
| `mentor_profiles` | NO | Migration 018 only (DRAFT) | GAP |
| `mentee_profiles` | NO | Migration 018 only (DRAFT) | GAP |
| `matches` | NO | Migration 018 only (DRAFT) | GAP |
| `applications` | NO | Migration 018 only (DRAFT) | GAP |
| `mentoring_recaps` | NO | Migration 018 only (DRAFT) | GAP |
| `event_links` | NO | Migration 057 only (DESIGN ONLY) | GAP |
| `event_registrations` | NO | Migration 057 only (DESIGN ONLY) | GAP |

**The application currently relies entirely on service-role for mutations and the two-stage middleware gate for all reads.** No table except `admin_scope_access` has applied RLS protecting rows from Supabase Auth users who bypass the middleware (e.g., via direct API calls with a valid JWT).

---

### 7. SECURITY DEFINER Functions

Migration 057 (DESIGN ONLY) intends to:
```sql
REVOKE EXECUTE ON FUNCTION public.current_admin_context() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_active_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_can_access_season(text) FROM anon, public;
```

**Currently NOT applied.** These functions are callable by unauthenticated and authenticated-anon clients, which could allow role-probing via direct Supabase API calls.

Migration 020 defines `current_admin_role()` and `is_active_admin()` as SECURITY DEFINER, but does not include REVOKE statements for `anon` / `public`.

---

## Required Migrations (New — Not Yet Written)

| ID | Description | Priority | Reason |
|---|---|---|---|
| 062 | `people.auth_user_id uuid null` + unique index | MUST before participant login | No column exists |
| 063 | Apply RLS + helper functions from migration 018 (reviewed and tested version) | HIGH | `admin_users` and all core tables unprotected |
| 064 | Apply security hardening from migration 057 (reviewed version) | HIGH | SECURITY DEFINER functions callable by anon |
| 065 | `admin_audit_log`: enable RLS + read policy for super_admin only; action_type check constraint | MEDIUM | Audit log exposed + unconstrained action types |
| 066 | `admin_users.invited_at timestamptz null` + `last_invited_at timestamptz null` | LOW | Invitation timestamp tracking |

---

## Migration Dependency Order

```
062 (people.auth_user_id)     — no dependencies
063 (RLS / 018 reviewed)      — requires helper functions from 020 to exist (already applied)
064 (security hardening / 057) — requires is_active_admin() to exist (already applied)
065 (audit log RLS)           — requires admin_audit_log to exist (migration 024, already applied)
066 (invited_at columns)      — requires admin_users to exist (migration 017, already applied)
```

---

## What Current Schema CAN Represent

| Scenario | Can current schema represent it? |
|---|---|
| Staff admin account with role and status | YES |
| Staff account with program/season scope grants | YES |
| Audit trail for role/status changes | YES |
| Auth-to-staff linkage via auth_user_id | YES (admin_users) |
| Auth-to-participant linkage | NO — people.auth_user_id missing |
| Participant login blocking (status check) | NO — no participant auth row to check |
| Multiple scope grants per admin user | YES |
| Inactive / suspended staff blocking | YES |

---

*Design only. No implementation in this task. No database connections used.*
