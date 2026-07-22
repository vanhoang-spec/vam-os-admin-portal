# VAM OS Support UAT Preview Readiness — 2026-07-22

Decision: **PREVIEW TARGET CANNOT BE PROVEN**.

Git/Vercel documentation indicates branch deployments can produce previews, but no tracked `vercel.json` or repository-controlled environment binding proves which Supabase project a future preview uses. Local `.env.local`, `.env.staging.local`, and a local Vercel pull currently resolve to staging ref `ljfneyuvpxrmejpxsmpz`; those ignored local files do not prove Vercel dashboard configuration. Secret values were not read or disclosed.

Expected preview keys: `NEXT_PUBLIC_SUPABASE_URL`, a public anon/publishable key, server-only `SUPABASE_SERVICE_ROLE_KEY`, and the internal unlock variable where the current auth architecture requires it. Preview must not inherit production values. Authentication callback URL must include the exact preview domain; failures must show generic login/error pages without database details.

Owner readiness steps: create/inspect branch preview; verify commit SHA; inspect Vercel Preview environment key targets without exposing values; confirm Supabase hostname/ref is staging; test login/logout/direct denial with synthetic accounts; verify no real data; record rollback deployment/commit. Rollback is redeploying the last verified preview commit or switching UAT to the verified local build—never changing production. No production deployment is authorized.
