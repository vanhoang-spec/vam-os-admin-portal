# VAM OS Support UAT Synthetic Account Plan — 2026-07-22

Readiness: **PLANNED — OWNER CREATION REQUIRED**. No users were created.

| Role | Synthetic email pattern | Program scope | Season/batch | Purpose | Prohibited access |
|---|---|---|---|---|---|
| Super admin | `uat.super-admin+demo-s12@example.com` | All synthetic programs | DEMO-S12 / DEMO-S12-B1 | Setup and portfolio verification | Production; real identities/data |
| Admin | `uat.admin+demo-s12@example.com` | One synthetic program | DEMO-S12 / DEMO-S12-B1 | Operational administration | Other programs unless explicitly granted |
| Reviewer | `uat.reviewer+demo-s12@example.com` | One synthetic program | DEMO-S12 / DEMO-S12-B1 | Assigned application review | Admin/user management and other programs |
| Support team | `uat.support+demo-s12@example.com` | One synthetic program | DEMO-S12 / DEMO-S12-B1 | Support UAT and triage | Admin/destructive actions and other programs |
| Viewer | `uat.viewer+demo-s12@example.com` | One synthetic program | DEMO-S12 / DEMO-S12-B1 | Read-only denial testing | All writes, admin pages, other programs |

## Exact owner creation and linking procedure

1. Reconfirm the Preview banner says staging ref `ljfn…smpz`; stop on `UNKNOWN` or `PRODUCTION`.
2. Sign in as an existing authorized staging super admin and open **Admin → Quản lý người dùng** (`/admin/users`).
3. Create one account at a time with the synthetic email pattern, intended role, `active` status, synthetic program, DEMO-S12 season, and least-privilege scope.
4. Submit once. The repository-supported flow must find or invite the staging Supabase Auth user, then create/update `admin_users` with its `auth_user_id` and scope. Do not use production Auth or the untracked local creation scripts.
5. Confirm the row shows the intended role, `active` status, a non-empty Auth ID, and only the intended program/season scope. Do not record the full Auth ID in tickets or screenshots.
6. If the console shows **Chưa liên kết Auth**, use **Đồng bộ Auth** once and recheck. Stop if it remains unlinked, duplicates an email, or shows an unexpected scope.
7. Deliver the invite or temporary credential through an approved private channel. Never place passwords in Git, chat, screenshots, or UAT issues.
8. Repeat for the minimum roles needed for the first smoke test; create all five only when their test cases are scheduled.

## Login/logout smoke test

1. In a private browser session, open the confirmed Ready Preview deployment and verify the staging banner.
2. Complete the unlock gate if configured, then sign in with one synthetic account.
3. Confirm the displayed role, one allowed route, one prohibited route, and program isolation match the plan.
4. Refresh and navigate again to exercise session persistence/refresh.
5. Log out, then directly revisit the protected URL; it must return to login/unlock.
6. Record only role, branch/commit, PASS/FAIL, and non-secret observations. Stop if real data, another program, production classification, or technical secrets appear.
7. Repeat the role/denial checks for the remaining provisioned roles. Disable/delete UAT access after the test window according to the owner cleanup plan.
