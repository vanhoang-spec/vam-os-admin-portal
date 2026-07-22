# VAM OS Support UAT Synthetic Account Plan — 2026-07-22

No users were created. All identities must be created only in staging Auth and linked to active, synthetic `admin_users` rows.

| Role | Synthetic email pattern | Program scope | Season/batch | Purpose | Prohibited access |
|---|---|---|---|---|---|
| Super admin | `uat.super-admin+demo-s12@example.com` | All synthetic programs | DEMO-S12 / DEMO-S12-B1 | Owner setup, portfolio and role verification | Production; real identities/data |
| Admin | `uat.admin+demo-s12@example.com` | One named synthetic program | DEMO-S12 / DEMO-S12-B1 | Operational administration | Other programs; user provisioning unless explicitly tested |
| Reviewer | `uat.reviewer+demo-s12@example.com` | One named synthetic program | DEMO-S12 / DEMO-S12-B1 | Assigned application review | Admin, matching, user management, other programs |
| Support team | `uat.support+demo-s12@example.com` | One named synthetic program | DEMO-S12 / DEMO-S12-B1 | UAT navigation, triage and read workflows | Destructive/admin actions; other programs |
| Viewer | `uat.viewer+demo-s12@example.com` | One named synthetic program | DEMO-S12 / DEMO-S12-B1 | Read-only and denial verification | All writes, admin pages, other programs |

Recommended creation method: manually create each user in the confirmed staging Supabase Auth dashboard, use unique owner-delivered temporary passwords, then create/link the corresponding staging `admin_users` and program-scope rows through the repository-supported admin console where possible. This is safer for five users than introducing a new service-role provisioning script. Deliver credentials out of band and delete or disable accounts after UAT.

Do not reuse production emails, copy production `auth_user_id` values, include passwords in tickets/docs, or run the untracked local admin-creation scripts as part of this authorization.
