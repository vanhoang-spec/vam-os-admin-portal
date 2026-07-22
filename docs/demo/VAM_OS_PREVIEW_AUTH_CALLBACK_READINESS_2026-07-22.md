# VAM OS Preview Auth and Callback Readiness — 2026-07-22

Decision: **AUTH READY FOR PREVIEW** at configuration/code level; synthetic-account smoke testing remains an operational UAT condition.

Owner verification confirms the Preview public URL, anon key, service-role key, and database URL are Preview-scoped to staging, with production excluded. The app uses Supabase email/password (`signInWithPassword`), so normal login does not require `/auth/callback`; no callback route exists. Password recovery on `/reset-password` requires the exact Preview redirect to be allowlisted only if recovery is included in UAT.

| Area | Readiness | Required acceptance evidence |
|---|---|---|
| Unlock | Ready if `VAM_OS_ADMIN_PASSWORD` is configured as intended | Unlock succeeds without sharing the value |
| Password login | Code and staging environment ready | Synthetic active user reaches an allowed route |
| `admin_users` resolution | Code ready; accounts not created | Auth identity is linked to one active staging row |
| Session refresh | Middleware implemented | Refresh/navigation remains authenticated |
| Logout | Implemented | Cookies cleared and protected URL redirects to login/unlock |
| Callback | Not required for password login | Do not treat magic-link/OAuth as supported UAT flows |
| Recovery | Conditional scope | Allowlist exact Preview recovery URL only if tested |

No live authentication was performed in this verification. No Supabase Auth setting was changed.
