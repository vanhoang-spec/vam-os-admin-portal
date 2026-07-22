# VAM OS Vercel Preview Environment Verification — 2026-07-22

Decision: **PREVIEW TARGET UNKNOWN**.

Ignored local files and locally pulled Vercel files resolve to staging, but neither is valid proof of current Vercel Preview-scoped metadata. No tracked `vercel.json`, workflow binding, deployment output, or owner evidence proves the live target.

## Owner browser verification

1. Open the Vercel project connected to `ThangNguyen-bot/vam-os-admin-portal`.
2. Open **Settings → Environment Variables** and filter to **Preview** scope.
3. Inspect only the hostname/project ref for `NEXT_PUBLIC_SUPABASE_URL`; do not copy values or keys.
4. Confirm the hostname contains staging ref `ljfneyuvpxrmejpxsmpz`.
5. Confirm it does not contain production ref `qkkroesfiazsejkzflcd`.
6. Confirm the Preview public anon/publishable variable is sourced from the staging project (report presence and project classification only).
7. If `SUPABASE_SERVICE_ROLE_KEY` is present, confirm it is Preview-scoped and from staging; never reveal or copy it.
8. Confirm `VAM_OS_ADMIN_PASSWORD`, if required, is present in Preview scope without exposing it.
9. Open the latest deployment for branch `preview-environment-and-auth-readiness`; record its branch and commit SHA.
10. Open the Preview URL. Confirm the banner reads `PREVIEW · STAGING · ljfn…smpz`, then test password login and logout with one synthetic staging account.

Stop and block UAT if the banner says production, if real data is visible, or if any variable is inherited from production without confirmed staging provenance.

## Safe evidence to return

- Screenshot of Vercel project name and deployment branch/commit (deployment URL may be redacted).
- Screenshot of environment-variable names and **Preview** scope badges, with every value fully hidden.
- Cropped screenshot showing only the Supabase URL hostname/ref `ljfneyuvpxrmejpxsmpz`.
- Text: `Preview production ref absent: YES`.
- Screenshot of the non-secret Preview banner.
- Login/logout result using only role name and PASS/FAIL; redact email and all tokens.

Do not return key values, passwords, cookies, authorization headers, database URLs, OIDC tokens, or screenshots containing real participant data.
