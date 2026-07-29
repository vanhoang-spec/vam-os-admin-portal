# VAM OS Authentication Architecture Audit
## 2026-07-29

Audit scope: Next.js 14 App Router + Supabase project at `VAM_OS_Admin_Portal`.
This is a read-only audit. No code was changed.

---

## Authentication Provider

**Supabase Auth** via `@supabase/supabase-js`. Email and password only.
No OAuth, magic link, OTP, or SAML.

---

## Architecture Overview

VAM OS uses a **two-stage access gate** in front of all authenticated routes:

1. **Stage 1 — Shared password (unlock gate):** Cookie `vam_os_admin_unlocked`.
   A SHA-256 hash of a server-known secret is compared against a hash stored in
   the cookie. Valid for 12 hours, `httpOnly`, `sameSite: lax`. Protects against
   unauthenticated discovery of admin routes in preview/staging environments.

2. **Stage 2 — Supabase auth + admin_users check:** Cookie pair
   `vam_os_sb_access_token` / `vam_os_sb_refresh_token`. The middleware validates
   the access token with Supabase `/auth/v1/user`, then queries `admin_users` via
   service-role to confirm an `active` row exists for the authenticated email.
   Supabase Auth users who do not have an active `admin_users` row are denied.

Both stages are checked in `middleware.ts` on every request that is not explicitly
excluded from the matcher.

---

## Supabase Client Architecture

| Client | File | Key | Session | RLS |
|---|---|---|---|---|
| Browser (anon) | `lib/supabase.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `persistSession: false` | Subject to RLS |
| Server (anon+token) | `lib/supabase-server.ts` `getSupabaseServerClient()` | Anon key + cookie JWT as Bearer | Cookie-based | Subject to RLS |
| Server (service-role) | `lib/supabase-server.ts` `getSupabaseServiceRoleClient()` | `SUPABASE_SERVICE_ROLE_KEY` | N/A | Bypasses RLS |

`lib/supabase-server.ts` carries `import "server-only"` — prevents bundling in
client components. `SUPABASE_SERVICE_ROLE_KEY` never appears in browser-accessible
code.

---

## Route and File Map

| Concept | Route | File(s) | Current behavior |
|---|---|---|---|
| Staff login | `/login` | `app/login/page.tsx`, `app/login/actions.ts` | `signInWithPassword` + admin_users active check; sets cookie pair on success |
| Shared password | `/unlock` | `app/unlock/page.tsx`, `app/unlock/actions.ts` | SHA-256 comparison; sets unlock cookie on success |
| Forgot password | No dedicated route | Not implemented — no `resetPasswordForEmail` call found | Gap |
| Reset password | `/reset-password` | `app/reset-password/page.tsx` | Listens to `PASSWORD_RECOVERY` event via `onAuthStateChange`; calls `client.auth.updateUser({ password })` client-side |
| Change password | No dedicated route | Not implemented | Gap |
| Auth callback | None | No callback route found | — |
| Participant login | No dedicated route | Not implemented — participants do not currently have login access | Gap |
| Admin account list | `/admin/users` | `app/admin/users/page.tsx`, `app/admin/users/actions.ts` | Super Admin only; create/edit/deactivate/sync admin users |
| Sign-out | Handled in client component | `app/login/page.tsx` (clearAuthCookies) | Clears both cookie pairs |

---

## Session Validation

**Middleware check order:**
1. Bypass: `/register/*`, `/checkin/*` — token-in-URL routes, no auth check.
2. Bypass: `/login`, `/unlock`, `/apply`, `/reset-password`, static assets.
3. Stage 2 check (`authAllowsRequest()`):
   a. Read `vam_os_sb_access_token` from cookies.
   b. Call Supabase `/auth/v1/user` with token.
   c. On 401 with refresh token present: exchange refresh token, write new cookie pair.
   d. Query `admin_users` (service-role) for `email=<auth.user.email> AND status='active'`.
   e. Fail → redirect to `/login?next=<path>`.
4. Stage 1 check (`unlockAllowsRequest()`):
   a. Read `vam_os_admin_unlocked` cookie.
   b. Compare SHA-256(salt:provided) to stored hash.
   c. Fail → redirect to `/unlock?next=<path>`.

**Token refresh:** Handled transparently in middleware on 401 responses from Supabase.

---

## Server Action Authorization

All server actions are in files with `"use server"` directives. The guard chain is:

```
getCurrentAdminUser()          — validates cookie JWT + active admin_users row
  → requireSuperAdmin()        — additional role == "super_admin" check
  → canDecide() / canReview()  — permission function from lib/permissions.ts
```

No server action trusts role from `formData`. Role values from form input are
validated server-side against a hardcoded allowlist (`ADMIN_ROLES` Set in
`lib/admin-users.ts` line 54) before any DB write.

---

## Password Reset and Change

**Current reset flow:**
- `/reset-password` page is excluded from middleware (no auth required).
- Page listens to `onAuthStateChange('PASSWORD_RECOVERY', session)` in the browser.
- Calls `client.auth.updateUser({ password: newPassword })` directly from browser.
- No server-side validation of the update.
- Password minimum: `length >= 8`. No strength requirement beyond that.
- No rate limiting or attempt logging at the application layer.

**Gap:** There is no "Forgot password" form. The mechanism exists in Supabase
(`auth.admin.generateLink()` or `auth.resetPasswordForEmail()`), but no UI or
server action invokes it.

**Gap:** There is no "Change password" form for logged-in users.

---

## Email Normalization

**Current state:**

| Location | Method | Gap? |
|---|---|---|
| `app/login/actions.ts:14` | `.trim().toLowerCase()` before `signInWithPassword` | None |
| `lib/admin-users.ts:98–99` | `normalizeEmail()`: `.trim().toLowerCase()` | None |
| `lib/applications-create.ts:67` | `.trim().toLowerCase()` | None |
| `lib/enable-reviewer.ts:119` | `.trim().toLowerCase()` | None |
| `app/actions/application-approvals.ts:27` | `.trim()` only — **missing `.toLowerCase()`** | **GAP** |

**Owner direction:** One shared helper (`normalizeEmail` from `lib/admin-users.ts`)
should be imported and used everywhere. The approval action gap must be fixed.

---

## Safe Redirect Handling

**Primary validator:** `safeNext()` in `lib/auth-error-messages.ts`
- Requires leading `/` (blocks protocol-relative URLs).
- Blocks `//` and `\/` (open redirect vectors).
- Blocks control characters.
- Prevents redirect loops to `/login/*` and `/unlock/*`.
- Fallback: `/operations`.

**Gap:** `app/unlock/actions.ts` has a local `safeNext()` (lines 12-17) that
is missing the `\/` check and control character check. Should import the shared
lib version.

**Middleware:** Constructs `next` value from `request.nextUrl.pathname` — always
server-derived, never from user-supplied input. No open-redirect risk in middleware.

---

## Login Identifier Decision

### EMAIL ONLY — NO SEPARATE USERNAME

No `username`, `user_name`, `login_name`, `handle`, or `screen_name` column exists
in any migration or table. The `admin_users` table has only `email` as the login
identifier. The `people` table has only `email_primary` and `phone_primary`.

Supabase Auth uses email as the identity key. `admin_users` is joined to
`auth.users` via `auth_user_id` (UUID FK), not via email duplication — email
in `admin_users` is the record key, and `auth_user_id` is populated on first login.

Adding a separate username would create:
- Duplicate identity risk (username ≠ email can diverge)
- Password-recovery confusion (which identifier triggers reset?)
- Support burden (two identifiers to validate and deduplicate)
- Synchronization problems (email changes must propagate to username store)
- No canonical benefit — email already uniquely identifies every VAM OS user

**Decision: EMAIL ONLY.**

---

## Service-Role Usage Inventory

| File | Purpose | Auth guard |
|---|---|---|
| `lib/admin-auth.ts` | Validate user JWT + admin_users lookup | N/A (auth infrastructure itself) |
| `lib/admin-users.ts` | All admin user CRUD + audit log | `requireSuperAdmin()` called before every mutation |
| `lib/matches.ts` | Match create/cancel | `requireMatchAdmin()` |
| `lib/enable-reviewer.ts` | Invite and link reviewer | `canManageReviewers()` |
| `lib/admin-corrections.ts` | Recap corrections | `canEditRecap()` |
| `lib/applications-create.ts` | Public application form submissions | Intentional RLS bypass for anonymous writes |

No service-role usage in client-bundled code. Every file imports `server-only`.

---

## Unauthorized Auth User Handling

**Yes, handled.** In `app/login/actions.ts`: after `signInWithPassword` succeeds,
the action queries `admin_users` for an active row. If not found, sign-in is
aborted. The Supabase session is not stored in cookies. The user receives a
"không có quyền truy cập" error. This prevents any Supabase Auth user who is not
an active `admin_users` record from accessing the portal.

In middleware, `authAllowsRequest()` performs the same dual check on every request.
A Supabase user whose `admin_users` status was changed to `suspended` or `inactive`
will be denied on the next request even if they still hold a valid Supabase JWT.

---

## Risks and Required Actions

| Concept | Current route/helper/table | Current behavior | Risk | Required action |
|---|---|---|---|---|
| Forgot password | Not implemented | No UI to trigger password reset email | HIGH — users who forget password cannot recover without admin intervention | Implement forgot-password flow using `auth.resetPasswordForEmail()` |
| Change password | Not implemented | Users cannot change their own password while logged in | MEDIUM — password hygiene blocked | Implement change-password server action |
| Email normalization | `app/actions/application-approvals.ts:27` | Only `.trim()`, missing `.toLowerCase()` | MEDIUM — approval lookup may fail on mixed-case email | Import shared `normalizeEmail()` |
| Redirect validator | `app/unlock/actions.ts:12–17` | Missing `\/` check and control character check | LOW (Next.js adds its own guard) — inconsistency | Import `safeNext` from `lib/auth-error-messages.ts` |
| `admin_users` RLS | No applied RLS policy on `admin_users` | Any authenticated Supabase user can read the full admin_users table via anon key | HIGH — admin email, role, and status visible to authenticated non-admin users | Apply migration 018 (after owner review and testing) |
| SECURITY DEFINER helpers | `current_admin_context()`, `is_active_admin()`, `admin_can_access_season()` | Callable by `anon` and `public` roles | MEDIUM — function logic leakable to clients | Apply migration 057 to revoke EXECUTE from anon/public |
| Password strength | `app/reset-password/page.tsx` | Minimum 8 characters, no complexity | LOW — meets basic requirement but not strong | Define password policy; consider `zxcvbn` or similar |
| Supabase project refs | `lib/supabase.ts` `getSupabaseDiagnostics()` | Production and staging project refs hardcoded in source | INFO — refs do not grant access | Move to env vars or remove from source |
| Participant login | Not implemented | Mentors and mentees have no login path | MEDIUM — no self-service access | Design participant auth flow in Batch 1 |
| Auth callback | Not implemented | No `/auth/callback` route for PKCE flows | LOW for current password flow; would be needed for email-link invites | Implement if email-link or OAuth is added |

---

*Audit prepared 2026-07-29. No code changes made. No database connections used.*
