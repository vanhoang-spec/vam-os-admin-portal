# VAM OS Preview Auth and Callback Readiness — 2026-07-22

Decision: **AUTH READY WITH SUPABASE URL CONFIGURATION**.

The UAT login uses Supabase email/password (`signInWithPassword`), not magic link or OAuth. It therefore does not depend on an `/auth/callback` route or a Preview-domain callback for normal login. No callback route exists. Password recovery uses Supabase's recovery session on `/reset-password`; if that flow is included in UAT, the exact Preview URL must be allowlisted in Supabase Auth redirect URLs.

| Area | Repository evidence | Readiness / owner configuration |
|---|---|---|
| Unlock | Optional shared-password gate uses `VAM_OS_ADMIN_PASSWORD`; secure, HTTP-only, SameSite=Lax cookie in deployed builds | Configure Preview-only value if the gate is required; share out of band |
| Login | Server action calls `signInWithPassword`, verifies an active `admin_users` row, and stores access/refresh tokens | Preview URL, anon/publishable key, service-role key, Auth users, and matching active staging rows must all belong to staging |
| Callback | No `/auth/callback`; password login redirects server-side to a validated internal path | No callback required for password login; do not test magic-link/OAuth as though supported |
| Session | HTTP-only SameSite=Lax cookies; middleware verifies access token and refreshes it with the refresh token | Test expiry/refresh on the actual Preview domain |
| Logout | Signs out, removes both Auth cookies and unlock cookie, redirects to `/login` | Verify direct protected URL is denied after logout |
| Localhost | Cookies are non-secure in development; password login works without callback | Localhost is not proof of Preview readiness |
| Recovery | `/reset-password` consumes Supabase recovery auth state | Add exact Preview recovery redirect only if recovery is in UAT scope |

Owner acceptance test: use a synthetic staging account; unlock if configured; log in; open a role-allowed and role-denied route; refresh; test after a session refresh; log out; revisit a protected URL. Confirm only synthetic staging data is visible and no technical error or secret appears.

This decision is conditional on Vercel Preview variables being proven staging-scoped. It does not authorize changing Supabase Auth settings or creating users.
