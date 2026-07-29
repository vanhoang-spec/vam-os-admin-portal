# VAM OS Auth & User Management Test Plan
## 2026-07-29

Design only. No implementation in this task.

---

## Test Suite Organization

All auth and user management tests live in `__tests__/`. Organized by batch.
Each test file has a corresponding unit under `describe("VAM OS Auth & User Mgmt — Batch N")`.

---

## Batch 1 Tests (Auth Foundation)

### B1-T1: Email Normalization

File: `__tests__/auth-email-normalization.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `normalizeEmail("Test@Example.COM")` | Returns `"test@example.com"` |
| 2 | `normalizeEmail("  spaced@domain.com  ")` | Returns `"spaced@domain.com"` |
| 3 | `normalizeEmail(null)` | Returns `""` |
| 4 | `normalizeEmail(undefined)` | Returns `""` |
| 5 | `normalizeEmail("")` | Returns `""` |
| 6 | approveApplicationAction with `"Test@Example.COM"` email | Calls `approveApplication` with lowercased email |
| 7 | unlock actions.ts uses shared `safeNext` | File does not contain a local `safeNext` function definition |
| 8 | `safeNext("//evil.com")` | Returns `/operations` (blocks `//`) |
| 9 | `safeNext("\\/evil.com")` | Returns `/operations` (blocks `\/`) |
| 10 | `safeNext("\x00path")` | Returns `/operations` (blocks control characters) |

---

### B1-T2: RLS Structure (Static)

File: `__tests__/auth-rls-structure.test.ts`

These tests verify migration files contain the expected RLS statements. They do
not connect to a database.

| # | Test | Assertion |
|---|---|---|
| 1 | Migration 018 enables RLS on `admin_users` | File contains `alter table public.admin_users enable row level security` |
| 2 | Migration 018 enables RLS on `people` | File contains `alter table public.people enable row level security` |
| 3 | Migration 018 enables RLS on `applications` | File contains `alter table public.applications enable row level security` |
| 4 | Migration 018 policy for `admin_users` uses `current_admin_role()` | File contains `read_admin_users_super_admin_or_self` policy |
| 5 | Migration 057 revokes EXECUTE on `is_active_admin()` from anon | File contains `revoke execute on function public.is_active_admin()` |
| 6 | Migration 057 revokes EXECUTE on `current_admin_context()` from anon | File contains `revoke execute on function public.current_admin_context()` |
| 7 | New migration for `admin_audit_log` RLS exists | File exists in `supabase_migrations/` directory |
| 8 | `admin_scope_access` write policy file exists | Migration file exists with INSERT/DELETE policies |

---

### B1-T3: Server Action Guards (Static + Logic)

File: `__tests__/auth-server-action-guards.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | All server action files import `getCurrentAdminUser` or `requireSuperAdmin` | Every `app/actions/*.ts` and `app/admin/*/actions.ts` with `"use server"` calls one of these guards |
| 2 | No server action reads `role` from `formData` | No `formData.get("role")` used as authorization value |
| 3 | `approveApplicationAction` with no admin session | Returns `{ ok: false }` with "Bạn chưa đăng nhập" message |
| 4 | `approveApplicationAction` with viewer role | Returns `{ ok: false }` with "Chỉ admin" message |

---

## Batch 2 Tests (User Administration)

### B2-T1: Admin User Lifecycle

File: `__tests__/auth-admin-user-lifecycle.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `StatusToggleForm` renders "Tạm khóa" button for active user | Button is present and not disabled for non-last-super_admin |
| 2 | `StatusToggleForm` "Tạm khóa" submits `status=suspended` | Hidden input `name="status"` value is `"suspended"` |
| 3 | `StatusToggleForm` "Kích hoạt lại" submits `status=active` | Hidden input `name="status"` value is `"active"` for suspended user |
| 4 | `RemoveAccessForm` disabled when user is last active super_admin | `disabled` prop is `true` |
| 5 | `RemoveAccessForm` enabled when two active super_admins exist | `disabled` prop is `false` |
| 6 | `setAdminUserStatusAction` with suspended state | Updates `admin_users.status` to `"suspended"` |
| 7 | `setAdminUserStatusAction` does not accept `status=super_admin` | Value validated against `ADMIN_STATUSES` allowlist |
| 8 | `removeAdminAccessAction` sets `status=inactive` | AND clears all `admin_scope_access` rows for user |

---

### B2-T2: Password Policy

File: `__tests__/auth-password-policy.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Password "short" | Fails policy |
| 2 | Password "alllowercase1!" | Fails policy (no uppercase) |
| 3 | Password "AllUpper1!" | Passes policy |
| 4 | Password policy display: passing | Only `"Đạt yêu cầu"` displayed — no plaintext |
| 5 | Password policy display: failing | Only `"Không đạt yêu cầu"` displayed |
| 6 | No password fragment in DOM | No `*****`, no length, no score |
| 7 | `CreateAdminUserForm` submit blocked when password fails policy | Form does not submit |

---

### B2-T3: Pre-Mutation Preview

File: `__tests__/auth-creation-preview.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Preview for new email: `proposed_action = create_auth_invite_and_admin_user` | No Auth user + no admin_users row |
| 2 | Preview for existing Auth user (no admin row): `link_existing_auth_to_new_admin_user` | Auth user exists |
| 3 | Preview for existing active admin (same role): `no_change` | No mutation needed |
| 4 | Preview for existing active admin (different role): conflict shown | Block with conflict message |
| 5 | Preview does not expose existing password | Preview response contains no password field |
| 6 | Program Admin cannot preview super_admin creation | Preview returns authorization error |
| 7 | Stage 2 hash mismatch aborts | Error: "File có thể đã thay đổi" |

---

### B2-T4: Forgot Password and Change Password

File: `__tests__/auth-password-flows.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Forgot password form exists at `/admin/forgot-password` | Route renders |
| 2 | Forgot password action normalizes email | Calls `normalizeEmail()` before `resetPasswordForEmail()` |
| 3 | Forgot password action does not reveal whether email exists | Success message is generic |
| 4 | Change password requires active session | Action calls `getCurrentAdminUser()` first |
| 5 | Change password with weak new password | Returns policy failure message |
| 6 | Change password writes `admin_audit_log` entry | `action_type = password_change` row exists after success |

---

## Batch 3 Tests (CSV Provisioning)

### B3-T1: CSV Parse and Validate

File: `__tests__/auth-csv-import.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Valid 5-row CSV — all pass | Returns 5 rows with no validation errors |
| 2 | Row count > 100 | File-level error returned |
| 3 | Missing required header `email` | File-level error returned |
| 4 | Duplicate email in file (rows 2 and 4) | Row 4 gets `validation_errors: ["email trùng lặp"]` |
| 5 | Invalid role value | `validation_errors: ["vai trò không hợp lệ"]` |
| 6 | Weak password | `password_policy: "Không đạt yêu cầu"` |
| 7 | Formula injection: `=cmd` in name field | Row returned with sanitized preview; no formula execution |
| 8 | BOM stripped | UTF-8 BOM in file does not cause parse error |
| 9 | Mixed-case email normalized | Row `proposed_action` computed from lowercase email |
| 10 | Stage 1 produces no mutations | No `admin_users` rows created during Stage 1 |

---

### B3-T2: Stage 2 Execution

File: `__tests__/auth-csv-import-stage2.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Hash mismatch → abort | Error returned; no mutations |
| 2 | Idempotent re-run of same file | All rows `action = no_change`; no duplicate rows |
| 3 | Partial failure (row 3 fails): rows 1, 2, 4, 5 succeed | Result CSV shows row 3 error + rows 1,2,4,5 success |
| 4 | New Auth user created but admin_users fails → rollback | Auth user deleted; no orphan auth.users row |
| 5 | Result CSV contains no password column | Export columns checked |
| 6 | Result CSV formula-injection-safe | Cells beginning with `=` prefixed with `'` |
| 7 | Program Admin cannot import super_admin role | All rows with `super_admin` blocked |

---

## Regression Tests

All tests added in these batches must not break the existing 632+ tests.

After each batch, run:
```
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

If any test fails: investigate root cause. Do not suppress or skip.

---

## Coverage Goals

| Area | Target coverage |
|---|---|
| Email normalization | 100% of normalization paths |
| RLS migration content | 100% of new migration files |
| Server action guards | 100% of actions verified to call auth guard |
| Password policy display | All display variants covered |
| CSV conflict scenarios | 100% of 18 conflict scenarios from design doc |
| Rollback scenarios | Auth user creation + failure covered |

---

*Design only. No implementation in this task. No database connections used.*
