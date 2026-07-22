# VAM OS Vercel Preview Environment Verification — 2026-07-22

Decision: **PREVIEW CONFIRMED STAGING**.

## Owner-provided evidence

The owner manually inspected Vercel without copying or exposing any secret value.

| Evidence | Owner-confirmed result | Classification |
|---|---|---|
| Vercel project | `vam-os-admin-portal` | Confirmed project |
| Preview deployment branch | `preview-environment-and-auth-readiness` | Confirmed branch |
| Preview deployment commit | `fc8c718` | Confirmed deployed commit |
| Deployment state | Ready | Confirmed deployment metadata |
| `NEXT_PUBLIC_SUPABASE_URL` Preview scope | Present; ref inspected only | CONFIRMED STAGING |
| Supabase ref observed | `ljfneyuvpxrmejpxsmpz` | CONFIRMED STAGING |
| Production ref `qkkroesfiazsejkzflcd` present | NO | Production excluded |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Preview-scoped; value not recorded | Present, staging Preview scope |
| `SUPABASE_SERVICE_ROLE_KEY` | Preview-scoped; value not recorded | Present, staging Preview scope |
| `DATABASE_URL` | Preview-scoped; value not recorded | Present, staging Preview scope |
| Secret values copied or exposed | NO | Pass |

This owner evidence satisfies the environment-target gate. It does not prove user authentication, data isolation, or fixture compatibility; those require separate staging-only acceptance checks.

If a later deployment shows `PRODUCTION`, `UNKNOWN`, real participant data, or a different ref, stop UAT and repeat this verification. Never return keys, passwords, cookies, database URLs, OIDC tokens, or authorization headers as evidence.
