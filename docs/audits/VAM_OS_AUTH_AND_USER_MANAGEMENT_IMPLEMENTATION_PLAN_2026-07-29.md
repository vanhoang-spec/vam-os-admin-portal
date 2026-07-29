# VAM OS Auth & User Management Implementation Plan
## 2026-07-29

Design only. No implementation in this task.

---

## Overview

Three sequential batches. Each batch is independently deployable and leaves the
system in a consistent, testable state. No batch introduces breaking changes
to existing functionality.

---

## Batch 1 — Auth Foundation

**Goal:** Close the highest-severity security gaps. No new user-facing features.
Existing functionality must be unchanged after Batch 1.

**Branch:** `batch1-auth-foundation`

### B1.1 — Email Normalization Fix

File: `app/actions/application-approvals.ts:27`

Change:
```typescript
// Before
const emailPrimary = String(formData.get("email_primary") ?? "").trim() || null;

// After
import { normalizeEmail } from "@/lib/admin-users";
const emailPrimary = normalizeEmail(formData.get("email_primary")) || null;
```

Test: Add test asserting `approveApplicationAction` with mixed-case email
produces the same result as lowercase email.

**Risk:** LOW — defensive fix; library already normalizes.

---

### B1.2 — Safe Redirect Fix

File: `app/unlock/actions.ts:12–17`

Change: Replace local `safeNext` with import from `lib/auth-error-messages.ts`.

Test: Existing unlock action tests; add backslash-redirect and control-character tests.

**Risk:** LOW — Next.js adds its own redirect guard; this is a consistency fix.

---

### B1.3 — Apply Migration 018 (RLS Phase 1)

Migration 018 is DRAFT. Review required before applying:
- Confirm `is_active_admin()` and `current_admin_role()` are defined (they are, via 020).
- Test each policy in staging: unauthenticated → all tables return 0 rows.
- Test authenticated active admin → tables return rows.
- Test suspended admin → tables return 0 rows.
- Test `admin_users` policy: `super_admin` sees all rows; non-super sees only own row.

The service-role client in server actions bypasses RLS — all existing server actions
continue to work unchanged. The middleware also uses service-role. No regression risk
from applying RLS — only previously-unguarded direct API access is blocked.

**Risk:** MEDIUM — verify in staging before production. Rollback is the commented
`ALTER TABLE ... DISABLE ROW LEVEL SECURITY` section in migration 018.

---

### B1.4 — Apply Migration 057 (SECURITY DEFINER Revoke)

Revoke EXECUTE on `current_admin_context()`, `is_active_admin()`, `admin_can_access_season()`
from `anon` and `public`. Grant to `authenticated`.

After this migration, `current_admin_role()` and `is_admin_role()` remain callable by
anon — add them to the revoke list.

**Risk:** MEDIUM — verify that all RLS policies using these functions continue to work
for `authenticated` users after the REVOKE.

---

### B1.5 — Add `admin_audit_log` RLS

New migration (062). Enable RLS on `admin_audit_log`. Apply SELECT policy:
```sql
alter table public.admin_audit_log enable row level security;
create policy "read_admin_audit_log_super_admin"
on public.admin_audit_log for select
using (public.current_admin_role() = 'super_admin');
```

**Risk:** LOW — audit log is not read by any non-super_admin code path.

---

### B1.6 — Add `action_type` constraint to `admin_audit_log`

New migration (063). Add CHECK constraint documenting canonical action types.

**Risk:** LOW — additive constraint; existing values must be valid.

---

### B1.7 — Add `admin_scope_access` Write Policies

New migration (064). Add INSERT and DELETE RLS policies to `admin_scope_access`:
- Only `super_admin` or `admin` with `full_access` scope may INSERT.
- Only `super_admin` may DELETE.

**Risk:** LOW — service-role mutations unaffected; closes direct API INSERT gap.

---

**Batch 1 exit criteria:**
- [ ] All 7 items applied and tested in staging
- [ ] 0 regressions in existing 632+ tests
- [ ] Lint clean, TSC clean, build clean
- [ ] Staging smoke: login, users page, applications, recaps, matches all functional
- [ ] `admin_users` direct API access returns 0 rows for non-super_admin JWT

---

## Batch 2 — User Administration

**Goal:** Improve the admin user management experience. Manual account provisioning
with preview, password policy, and correct `suspended` state handling.

**Branch:** `batch2-user-administration`

### B2.1 — Fix `StatusToggleForm` Status Enum

Current: toggles between `active` and `inactive`. Target: add `suspended` as
intermediate state.

- "Tạm khóa" → `suspended` (reversible; session blocks immediately)
- "Kích hoạt lại" → `active`
- "Xóa quyền admin" → `inactive` (all scopes cleared; permanent until re-invitation)

File: `app/admin/users/user-management-forms.tsx` + `app/admin/users/actions.ts`

---

### B2.2 — Replace `ActionMessage` with `InlineActionMessage` in Admin Users Forms

File: `app/admin/users/user-management-forms.tsx`

Replace all instances of local `ActionMessage` with `InlineActionMessage` from
`@/components/action-feedback`. Add `role="status"` / `role="alert"` ARIA support.

---

### B2.3 — Replace Submit Buttons with `LoadingButton`

File: `app/admin/users/user-management-forms.tsx`

All form submit buttons must use `LoadingButton` with `pendingLabel="Đang lưu..."`.

---

### B2.4 — Add Password Field to `CreateAdminUserForm`

- Add password input to `CreateAdminUserForm`.
- Client-side strength check on `onChange`.
- Display ONLY `"Đạt yêu cầu"` / `"Không đạt yêu cầu"`.
- Pass password to server action which calls `auth.admin.createUser({ password })` or
  `auth.admin.inviteUserByEmail()` depending on flow.
- Server validates password policy before sending to Supabase Auth.

---

### B2.5 — Add Pre-Mutation Preview to `CreateAdminUserForm`

Two-step flow: Step 1 returns preview (proposed action, conflicts, policy check).
Step 2 confirms and executes. Design in `docs/audits/VAM_OS_MANUAL_ACCOUNT_CREATION_DESIGN_2026-07-29.md`.

---

### B2.6 — Program/Season Dropdowns in Admin Users Forms

Replace free-text `program` and `season_code` inputs with dropdowns fetched from
`public.programs` and `public.seasons` (server-fetched, pre-rendered as select options).

---

### B2.7 — Multi-Scope Display and Management

`EditAdminUserForm` currently shows only the first scope (`scopes[0]`). Extend to:
- Show all active scopes as a list.
- Allow adding a new scope with program/season/role dropdowns.
- Allow deactivating an individual scope row (sets `status = 'inactive'`).

---

### B2.8 — Forgot Password Flow

New page: `/admin/forgot-password`.
- Field: email (normalized via `normalizeEmail()`).
- Server action: `auth.resetPasswordForEmail(email, { redirectTo: '/reset-password' })`.
- Link added to `/login` page.

---

### B2.9 — Change Password Flow

New page: `/admin/change-password` (requires active session).
- Fields: current password (for re-auth), new password, confirm.
- Server action: `client.auth.updateUser({ password: newPassword })`.
- Write `admin_audit_log` entry for password change.
- Password policy check before calling Supabase.

---

**Batch 2 exit criteria:**
- [ ] All 9 items implemented and tested in staging
- [ ] 0 regressions in existing tests
- [ ] New tests for StatusToggleForm states, password policy display, multi-scope display
- [ ] Pilot provisioning: 1 Super Admin, 1 Program Admin, 1 reviewer (see Pilot Plan)

---

## Batch 3 — CSV Provisioning

**Goal:** Bulk account provisioning for program coordinators.

**Branch:** `batch3-csv-provisioning`

### B3.1 — CSV Template Download

Download link on `/admin/users` for the canonical CSV template with correct headers.

### B3.2 — Stage 1: CSV Parse, Validate, Preview

Server action that accepts file upload. Returns per-row validation and proposed actions.
Design in `docs/audits/VAM_OS_BULK_USER_IMPORT_DESIGN_2026-07-29.md`.

### B3.3 — Stage 2: Confirm and Execute

Server action that accepts SHA-256 hash confirmation + executor approval.
Applies mutations per-row with partial-failure handling.

### B3.4 — Result Export

Sanitized CSV download after Stage 2 execution.

### B3.5 — Formula-Injection Protection

All preview table cells rendered as text content (no innerHTML). All CSV exports
prefix formula-injection candidates with `'`.

---

**Batch 3 exit criteria:**
- [ ] Stage 1 returns correct proposed actions for all conflict scenarios
- [ ] Stage 2 applies mutations with correct idempotency
- [ ] Hash mismatch between Stage 1 and Stage 2 aborts with error
- [ ] Formula injection test: `=cmd|' /C calc'!A0` in name field renders as literal text
- [ ] 100-row file completes in < 30s in staging

---

## What Is NOT In These Batches

The following items are explicitly deferred:

| Deferred item | Reason |
|---|---|
| Participant (mentor/mentee) login | Requires `people.auth_user_id` migration + participant portal design — separate project |
| OAuth / magic link | Not in scope for staff portal |
| Password reset audit log in Supabase Dashboard | Supabase does not expose auth event webhooks without custom setup |
| Automated `invited` → `active` conversion for participants | Deferred until participant login is built |
| GDPR / data-subject deletion flow | Legal review required first |
| Session invalidation on role change | Requires Supabase custom JWT claims or session invalidation webhook |

---

*Design only. No implementation in this task.*
