# VAM OS Production Auth Fix

Date: 2026-04-29

## Production Scope

Production app URL:

```text
https://vam-os-admin-portal.vercel.app
```

Expected Supabase production project:

```text
qkkroesfiazsejkzflcd
https://qkkroesfiazsejkzflcd.supabase.co
```

Staging project must not be used for production login:

```text
ljfneyuvpxrmejpxsmpz
```

## Root Cause Found Locally

Local production env `.env.local` pointed at the production Supabase ref, but the URL had a trailing space:

```text
NEXT_PUBLIC_SUPABASE_URL=https://qkkroesfiazsejkzflcd.supabase.co<space>
```

The app previously did not trim Supabase URL/key env values before creating clients or before middleware Auth fetches. This can produce hard-to-read Auth failures after deployment if Vercel env values contain whitespace.

The code now trims:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The app also supports `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as a fallback if `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not set.

## Vercel Production Env Variables

Set these in Vercel Production environment for `vam-os-admin-portal`.

| Variable | Value | Public/Secret | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qkkroesfiazsejkzflcd.supabase.co` | Public | Must be production ref only. No trailing spaces. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production anon JWT or production publishable key | Public | Preferred for current app naming. Must come from production project. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional production `sb_publishable_...` | Public | Optional fallback. Use only if not using `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Production service role key | Secret | Server-side only. Required for `/admin/users`; never expose with `NEXT_PUBLIC_`. |
| `VAM_OS_ADMIN_PASSWORD` | Current password gate value, if still used | Secret | Optional transitional gate. |

Do not set:

```text
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
```

## Supabase Production Checks

In Supabase production project `qkkroesfiazsejkzflcd`:

1. Auth -> Providers:
   - Email provider enabled.
   - Password login enabled.
2. Authentication -> Users:
   - `thangnguyen@redsquarevietnam.com` exists.
   - Admin test account exists with exact email used in VAM OS.
   - Viewer test account exists with exact email used in VAM OS.
   - Users are confirmed, not banned, not deleted.
3. Table `admin_users`:
   - Each login email has a row.
   - `status = active`.
   - `role` is one of `viewer`, `reviewer`, `admin`, `super_admin`.
   - `auth_user_id` matches the Supabase Auth user id, or email fallback can find the row and then sync it.

## RLS / Role Lookup Notes

The app resolves roles through `admin_users`.

Login flow:

1. `signInWithPassword(email, password)`.
2. Look up active `admin_users` row by `auth_user_id` or email.
3. Set secure app cookies.
4. Middleware checks the Supabase Auth user and active `admin_users` row.

If Supabase Auth succeeds but VAM OS returns “no active permission,” likely causes are:

- Missing `admin_users` row.
- Wrong email in `admin_users`.
- `admin_users.status != active`.
- `admin_users` RLS blocks self/super_admin lookup.

Do not disable RLS broadly on production. If `admin_users` RLS is enabled, use a minimal policy/helper that lets an authenticated user read their own active row and lets super_admin read all rows.

## Debug Route

After login, open:

```text
/admin/debug-auth
```

It shows only non-secret diagnostics:

- Supabase host
- project ref
- public key type
- hasSession
- Auth user email/id
- resolved VAM OS role
- Operations data probe status

It never shows API keys.

Expected production values:

```text
Project ref: qkkroesfiazsejkzflcd
Is production ref: yes
Is staging ref: no
```

## Rollback Checklist

If production login still fails after env correction:

1. Confirm Vercel redeployed after env changes.
2. Open `/login` and check non-secret diagnostics:
   - Project ref must be `qkkroesfiazsejkzflcd`.
   - Key type must not be `missing`.
3. In Supabase production Auth logs, check the failed login reason.
4. Verify exact email spelling and password.
5. Verify `admin_users` row exists and is active.
6. Check whether `admin_users` RLS blocks the lookup.
7. Roll back to previous Vercel deployment if the new build introduces a regression.

## QA Results

Commands run locally:

```text
npm run lint
npm run typecheck
npm run build
```

Local production-env Auth smoke test used `.env.local` with:

```text
Project ref: qkkroesfiazsejkzflcd
Key type: starts_with_sb_publishable
```

Login test with password `VAM2026!`:

| Account | Supabase Auth result | Notes |
|---|---|---|
| `superadmin.staging@vam.test` | Failed: invalid credentials | Staging account tested against production project; expected unless duplicated in production. |
| `admin.staging@vam.test` | Failed: invalid credentials | Staging account tested against production project; expected unless duplicated in production. |
| `viewer.staging@vam.test` | Failed: invalid credentials | Staging account tested against production project; expected unless duplicated in production. |
| `thangnguyen@redsquarevietnam.com` | Failed with `VAM2026!` | Password may differ or Auth user may need reset/confirmation in production. |

Required manual production verification:

- Test the real production password for `thangnguyen@redsquarevietnam.com`.
- Test the real production admin account.
- Test the real production viewer account.
- If passwords are unknown, reset in Supabase production Auth dashboard, then retest.
