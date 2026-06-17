# VAM OS Security Audit — 2026-06-17

**Audited by:** Antigravity AI (Claude Sonnet 4.6 Thinking)
**Date:** 2026-06-17 (UTC+7)
**Production Supabase ref:** `qkkroesfiazsejkzflcd`
**Staging Supabase ref:** `ljfneyuvpxrmejpxsmpz`
**HEAD commit:** `6ece2cf Add registration close control and capacity visibility`
**Branch:** `main` (clean, up-to-date with origin)
**Phase:** 1 — Read-Only Audit + Immediate Secret Remediation

---

## Incident Log — Key Exposure and Rotation

| # | Timestamp (UTC+7) | Event |
|---|---|---|
| 1 | 2026-06-17 ~12:40 | Audit began. Phase 1 read-only inspection started. |
| 2 | 2026-06-17 ~12:44 | **STOP:** Real `SUPABASE_SERVICE_ROLE_KEY` found committed in `.env.local.example` (introduced in commit `d2f26b8`). Audit halted pending decision. |
| 3 | 2026-06-17 ~13:14 | **Thang confirmed:** exposed key has been **rotated and revoked**. |
| 4 | 2026-06-17 ~13:14 | New production service-role key created in Supabase Dashboard. |
| 5 | 2026-06-17 ~13:14 | Vercel `SUPABASE_SERVICE_ROLE_KEY` environment variable updated with new key. |
| 6 | 2026-06-17 ~13:14 | Production redeployed to Vercel. VAM OS verified working normally. |
| 7 | 2026-06-17 ~13:14 | Old exposed key revoked as "default" in Supabase project settings. |
| 8 | 2026-06-17 ~13:15 | `.env.local.example` cleaned — real key replaced with placeholder `your_service_role_key_here`. |
| 9 | 2026-06-17 ~13:16 | Full secret scan of all tracked files and git history completed. No additional exposed secrets in tracked files. |
| 10 | 2026-06-17 ~13:16 | `supabase_migrations/.env.staging.local` found containing staging anon JWT + staging DB password. File is **untracked** (covered by `.gitignore` `.env*.local` rule) — **not a git exposure**. |
| 11 | 2026-06-17 ~13:16 | Audit report updated. Commit prepared for review. |

**Status of exposed key:** ✅ Rotated, revoked, and unreachable. The new key was not printed, logged, or stored anywhere in this audit session.

---

## ⚠️ STOP CONDITION — RESOLVED

> **[CRITICAL — REMEDIATED] Real service-role key was found committed to Git history.**
>
> File: `.env.local.example`
> Key value: `[REDACTED — rotated and revoked]`
> Introduced in commit: `d2f26b8 Add native pilot intake forms for S12 B1 (/apply/mentor, /apply/mentee)`
> Was present in all commits from `d2f26b8` through HEAD at the time of discovery.
> File is tracked by Git (`.gitignore` correctly excludes `.env.local` and `.env*.local`
> but NOT `.env.local.example`).

**Resolution:** Key was rotated and revoked by Thang on 2026-06-17. `.env.local.example` has been cleaned. See Incident Log above.

**Remaining exposure window:** The revoked key remains readable in the git history of this repository. It can no longer be used. A git history purge (`git filter-repo`) is deferred — the key is confirmed invalidated and the repository is private.

---

## Pre-Flight Status Summary

| Check | Status |
|---|---|
| Git branch | `main` |
| HEAD commit | `6ece2cf` ✓ matches stated production commit |
| Working tree | Clean — only untracked files, no staged changes |
| Production changes made | ❌ None |
| Secret in source control | ✅ RESOLVED — key rotated, file cleaned, commit prepared |
| Supabase CLI installed | ❌ Not installed as system command |
| npx Supabase CLI | ❌ PowerShell script execution policy blocks npx |

---

## 1. Current Architecture

### 1.1 Application Type

Next.js 14 App Router, deployed to Vercel. TypeScript throughout.

### 1.2 Supabase Client Architecture

Two distinct client types are used:

#### Browser / Client-Side Client (`lib/supabase.ts`)

```typescript
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) }
})
```

- Uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
- This client is exported and **can be imported in client components**.
- Auth sessions are NOT persisted.
- Currently used **only** for the `/login` page sign-in action (password-based auth).

#### Server-Side Client with Bearer Token (`lib/supabase-server.ts → getSupabaseServerClient`)

```typescript
createClient(supabaseUrl, supabaseAnonKey, {
  global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
})
```

- Carries the admin user's Supabase JWT for authenticated reads.
- Used in middleware to call `/auth/v1/user` and verify `admin_users` row.

#### Service-Role Client (`lib/supabase-server.ts → getSupabaseServiceRoleClient`)

```typescript
createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})
```

- Uses `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix — correct).
- **Bypasses RLS entirely.**
- Used by: `lib/events.ts`, `lib/matches.ts`, `lib/people-create.ts`, `lib/admin-auth.ts`, `lib/admin-corrections.ts`, `lib/applications-create.ts`, `lib/data.ts`.
- This is the primary client for ALL data operations in the application.
- Protected by `import "server-only"` on the module — **correct, cannot leak to browser**.

### 1.3 Middleware (`middleware.ts`)

Two-stage access control:

**Stage 1 — MVP unlock gate:** Shared password via `VAM_OS_ADMIN_PASSWORD` env var. Cookie-based SHA-256 hash comparison. Runs at Edge.

**Stage 2 — Supabase Auth:** Bearer token in `vam_os_access` cookie. Middleware calls Supabase REST API (`/auth/v1/user`) and then queries `public.admin_users` to verify `status = 'active'`.

**Public routes bypassed by middleware matcher:**
- `/register/*` — public event registration (token-gated at application level)
- `/checkin/*` — public event check-in (token-gated at application level)
- `/apply/*` — pilot intake forms (token-gated at application level)
- `/login`, `/unlock`, `/reset-password` — auth flows
- `/_next/*`, static assets

### 1.4 Route Classification

| Route Pattern | Access Level | Supabase Client Used |
|---|---|---|
| `/register/[token]` | **Public** — no auth | Service-role (server action) |
| `/checkin/[token]` | **Public** — no auth | Service-role (server action) |
| `/apply/mentor`, `/apply/mentee` | **Public** — pilot token gate | Service-role (server action) |
| `/login`, `/unlock` | **Public** — auth flow | Anon + service-role for admin_users |
| `/admin/*` | Admin (active admin_users row) | Service-role |
| `/people/*`, `/mentors/*`, `/mentees/*` | Admin | Service-role |
| `/applications/*`, `/reviews/*` | Admin | Service-role |
| `/events/*` | Admin | Service-role |
| `/matches/*`, `/interviews/*` | Admin | Service-role |
| `/operations/*` | Admin | Service-role (RPC) |
| `/recaps/*` | Admin | Service-role |

### 1.5 Public Registration and Check-in Flows

**Registration flow (`/register/[token]`):**
1. `page.tsx` (Server Component) calls `getPublicRegistrationData(token)` — service-role, reads `event_links` + `events`.
2. Form rendered as Client Component (`registration-form.tsx`).
3. Form submits via Server Action `submitEventRegistrationAction`.
4. Server Action calls `registerForEvent(...)` in `lib/events.ts` — service-role client.
5. Server Action uses service-role to: read `event_links`, read `event_registrations` (duplicate check + capacity), read `people` (email match), insert `event_registrations`.
6. Redirect on success; no client-side Supabase calls.

**Check-in flow (`/checkin/[token]`):**
1. Similar pattern. Server Component reads link status. Server Action calls `checkInForEvent(...)`.
2. Service-role reads `event_links`, reads/updates `event_registrations`, optionally upserts `event_participations`.

**Key finding:** Both flows exclusively use the service-role client on the server. **The anon key is NOT used for any registration or check-in data operations.** No direct browser-to-Supabase data access occurs on public routes.

---

## 2. Migration History

Total tracked migrations: **44 files** (012–056, with some gaps at 037, 039, 042).

Key security-relevant migrations:

| Migration | Description | RLS Impact |
|---|---|---|
| 017 | Create `admin_users` + `custom_roles` | No RLS |
| 018 | Draft RLS read policies | Enables RLS + policies on ~13 tables |
| 019 | Operations dashboard RPC | SECURITY DEFINER; revokes anon, grants authenticated |
| 022 | Operations RPC scope gate | SECURITY DEFINER; replaces 019 |
| 023 | Phase 4 operations workflow | SECURITY DEFINER RPCs |
| 025 | Founder intelligence dashboard | SECURITY DEFINER views/functions |
| 029 | Founder intelligence RPCs | SECURITY DEFINER |
| 030 | Enrich founder intelligence | SECURITY DEFINER |
| 051 | `event_links` + `event_registrations` tables | No RLS added (comment says "no RLS policy in migration 051") |
| 052 | Lifecycle CRM | No explicit RLS check |
| 054 | Event Phase 2 config columns | No RLS changes |
| 055 | Event Phase 2 production schema alignment | No RLS changes |
| 056 | Optional meal payment | No RLS changes |

**Critical finding: `event_links` and `event_registrations` were created with NO RLS policies.**
The comment in migration 051 explicitly states: "No RLS enable/disable/alter and no RLS policies."

---

## 3. Table-by-Table Classification

### 3.1 Tables WITH RLS Policies (from migration 018)

These tables have RLS enabled AND policies created in migration 018:

| Table | RLS Enabled (018) | Policies | Notes |
|---|---|---|---|
| `programs` | ✓ | SELECT: active admins | Low risk |
| `seasons` | ✓ | SELECT: active admins | Low risk |
| `events` | ✓ | SELECT: active admins | Also readable by service-role for public routes |
| `people` | ✓ | SELECT: viewer/reviewer/admin/super_admin | HIGH — PII |
| `mentor_profiles` | ✓ | SELECT: viewer/reviewer/admin/super_admin | HIGH — PII |
| `mentee_profiles` | ✓ | SELECT: viewer/reviewer/admin/super_admin | HIGH — PII |
| `matches` | ✓ | SELECT: viewer/reviewer/admin/super_admin | HIGH |
| `applications` | ✓ | SELECT: reviewer/admin/super_admin | HIGH — PII |
| `mentoring_recaps` | ✓ | SELECT: viewer/reviewer/admin/super_admin | Medium |
| `event_participations` | ✓ | SELECT: viewer/reviewer/admin/super_admin | Medium |
| `activity_correction_log` | ✓ | SELECT: reviewer/admin/super_admin | Medium |
| `operational_team_assignments` | ✓ | SELECT: viewer/reviewer/admin/super_admin | Medium |
| `admin_users` | ✓ | SELECT: own row OR super_admin | HIGH |

**However:** Migration 018 was titled "DRAFT RLS read policies. REVIEW ONLY. DO NOT RUN UNTIL APPROVED." The file was committed but it is unknown whether it was ever applied to production. The Security Advisor report (in the brief) states "Many public tables with RLS disabled" and "Some tables already have policies but RLS itself is disabled." This strongly suggests migration 018 was NOT applied to production, or was partially applied.

**No WRITE (INSERT/UPDATE/DELETE) policies exist in any migration.** All writes go through the service-role client (which bypasses RLS), so this is intentional but means if service-role key is compromised, there is no row-level write protection.

### 3.2 Tables WITHOUT RLS Coverage (Critical Gap)

These tables exist in the schema but have no RLS policies in any migration:

| Table | Risk Level | Classification | Notes |
|---|---|---|---|
| `event_links` | 🔴 CRITICAL | Public-submit server-only | Token column exposed; registered in 051 with no RLS |
| `event_registrations` | 🔴 CRITICAL | Public-submit server-only | PII (name, email, phone, student_id); no RLS |
| `application_answers` | 🔴 HIGH | Admin-only | Referenced in code but no migration seen |
| `feedback_responses` | 🔴 HIGH | Admin-only | Referenced in brief, no migration seen |
| `communications` | 🔴 HIGH | Admin-only | Referenced in brief |
| `data_issues` | 🟡 MEDIUM | Admin-only | Data quality tracking |
| `data_quality_issues` | 🟡 MEDIUM | Admin-only | Data quality tracking |
| `person_roles` | 🟡 MEDIUM | Admin-only | |
| `interviews` | 🟡 MEDIUM | Admin-only | |
| `person_season_memberships` | 🟡 MEDIUM | Admin-only | |
| `person_season_membership_log` | 🟡 MEDIUM | Admin-only | |
| `season_monthly_kpis` | 🟡 MEDIUM | Admin-only | |
| `custom_roles` | 🟡 MEDIUM | Admin-only | |
| `data_import_batches` | 🟡 MEDIUM | Admin-only | |
| `staging_*` tables | 🟡 MEDIUM | Staging-only | Should be default-deny in production |
| `admin_audit_log` | 🟡 MEDIUM | Admin-only | Referenced in code |

### 3.3 Sensitive Column Exposure in `event_links`

The `event_links` table contains:
- `token` — the UUID used as the public registration/check-in URL token
- `is_active`, `opens_at`, `closes_at` — registration control fields

If this table has no RLS and anon-level SELECT is granted, any unauthenticated user could:
1. List all tokens for all events.
2. Enumerate closed or inactive registration links.
3. Forge registration URLs if they could also write to `event_registrations`.

However, the application architecture mitigates this significantly: the public registration flow uses the service-role client on the server. An attacker who reads `event_links` tokens via the anon key would still need to go through the server actions, which re-validate the token server-side.

**Risk: Medium-High** — token enumeration risk; registration is currently CLOSED so no immediate exploitation path for event registration, but this must be fixed before reopening.

---

## 4. Existing RLS Policy Analysis

### 4.1 Helper Functions (migration 018)

Three SECURITY DEFINER functions defined in migration 018:

```sql
public.current_admin_role()  -- reads admin_users WHERE auth.uid() matches
public.is_admin_role(text[]) -- calls current_admin_role()
public.is_active_admin()     -- reads admin_users WHERE auth.uid() matches
```

All three:
- ✅ Are SECURITY DEFINER with `set search_path = public` — correct, prevents search_path injection.
- ✅ Gate on `auth.uid()` which only resolves for authenticated Supabase Auth users.
- ⚠️ Have no explicit REVOKE/GRANT — default PostgreSQL behavior allows `public` (all users including anon) to EXECUTE these functions.

### 4.2 GRANT to anon / authenticated

From migration 019:
```sql
revoke all on function public.get_operations_dashboard_data(text) from public;
revoke all on function public.get_operations_dashboard_data(text) from anon;
grant execute on function public.get_operations_dashboard_data(text) to authenticated;
```

This is the correct pattern. However, most other SECURITY DEFINER functions in migrations 022, 023, 025, 029, 030 need to be audited for similar REVOKE/GRANT patterns.

### 4.3 Security Definer Views

Migration 025 and 030 create SECURITY DEFINER views for the Founder Intelligence dashboard. These:
- Execute with the privileges of the view creator (postgres/service role).
- If exposed to anon via direct PostgREST access without RLS, could leak data.
- Should be reviewed to confirm SECURITY INVOKER is safe or REVOKE PUBLIC is in place.

---

## 5. Function and View Risks

### 5.1 SECURITY DEFINER Functions Identified

| Function | Migration | Role Gate | anon EXECUTE | search_path |
|---|---|---|---|---|
| `current_admin_role()` | 018 | auth.uid() | Public (default) — ⚠️ | `set search_path = public` ✅ |
| `is_admin_role(text[])` | 018 | via current_admin_role | Public (default) — ⚠️ | `set search_path = public` ✅ |
| `is_active_admin()` | 018 | auth.uid() | Public (default) — ⚠️ | `set search_path = public` ✅ |
| `get_operations_dashboard_data(text)` | 019/022 | v_role check | Revoked explicitly ✅ | `set search_path = public` ✅ |
| Various `founder_intelligence_*` | 025,029,030 | Internal role check | Unknown — needs audit | Needs verification |
| Various RPCs in 023 | 023 | Admin role check | Unknown — needs audit | Needs verification |

### 5.2 Function `search_path` Mutable Warnings

Supabase Security Advisor flags functions without explicit `set search_path`. Migration 018 functions use `set search_path = public` correctly. Migrations 022, 023, 025, 029, 030 need individual inspection to confirm all functions set search_path.

### 5.3 Leaked Password Protection

Supabase offers HaveIBeenPwned integration for Auth. This is disabled by default. Enabling it is a Supabase Dashboard setting, not a migration.

---

## 6. Secret Exposure Audit

### 6.1 Source Control Findings

| File | Secret Type | Status | Risk |
|---|---|---|---|
| `.env.local.example` (committed, all commits from d2f26b8) | `SUPABASE_SERVICE_ROLE_KEY=[REDACTED]` | ✅ ROTATED & REVOKED — key invalid | RESOLVED: key rotated 2026-06-17, file cleaned |
| `.env.local` | All keys | ✅ Gitignored | Safe |
| `.env*.local` | All keys | ✅ Gitignored | Safe |
| `.env.production.local` | Production keys | ✅ Gitignored | Safe |
| `.env.staging.local` | Staging keys | ✅ Gitignored | Safe |
| `.env.vercel` | Vercel keys | ✅ Gitignored | Safe |
| `.env.vercel.prod` | Production keys | ✅ Gitignored | Safe |

### 6.2 `NEXT_PUBLIC_` Prefix Audit

| Variable | Prefix | Risk |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | NEXT_PUBLIC_ | ✅ URL is safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | NEXT_PUBLIC_ | ✅ Anon key is designed to be public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | NEXT_PUBLIC_ | ✅ Same as anon — designed to be public |
| `SUPABASE_SERVICE_ROLE_KEY` | No prefix | ✅ Correct — server-only |
| `VAM_OS_ADMIN_PASSWORD` | No prefix | ✅ Correct — server-only |
| `VAM_OS_APPLICATION_PILOT_TOKEN` | No prefix | ✅ Correct — server-only |

**No `NEXT_PUBLIC_` service-role key exposure in application code.** The `supabase-server.ts` module uses `import "server-only"` which prevents accidental client-side import.

### 6.3 Full Secret Scan Results (2026-06-17)

Scan scope: all tracked files (git grep) + full git history for `.env*`, `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.sql`, `*.md` files.

| Pattern Searched | Tracked Files | Git History | Result |
|---|---|---|---|
| `sb_secret_*` | ✅ None found | Found in `.env.local.example` history | RESOLVED — key rotated |
| `sb_publishable_*` (real token) | ✅ None — only string literal references in code | ✅ None | Safe |
| JWT `eyJhbGci*` (real token) | ✅ None in tracked files | ✅ None | Safe |
| `DATABASE_URL` with credentials | ✅ None — only placeholders like `[YOUR-PASSWORD]` | ✅ None | Safe |
| Hardcoded passwords in code | ✅ None found | ✅ None | Safe |
| `Minhduc*` (staging DB password) | ✅ None in tracked files | ✅ None in history | Safe — only in untracked `.env.staging.local` |

**Untracked file finding:** `supabase_migrations/.env.staging.local` contains a staging anon JWT and a staging database password (`[REDACTED]`). This file is untracked (`.env*.local` gitignore rule) and was never committed. No git exposure. However, the staging DB password should be rotated at the next opportunity as a hygiene measure.

### 6.4 Script Files

Scripts in `scripts/` directory reference `SUPABASE_SERVICE_ROLE_KEY` from environment variables (runtime injection), not hardcoded. The scripts themselves are `.js`/`.mjs` files. The `.mjs` files ARE tracked; they reference keys via `process.env`, not hardcoded — no additional exposure.

---

## 7. Supabase CLI Status

- **System PATH:** Not installed.
- **Via npx:** Blocked by PowerShell ExecutionPolicy.
- **Impact on Phase 2 (Backup):** CLI-based logical backup cannot be executed without either installing the CLI or changing execution policy.

**Backup alternatives:**
1. Install Supabase CLI via scoop or direct binary download (bypasses PS policy).
2. Use the Supabase Dashboard → Settings → Database → Backups.
3. Use `pg_dump` via the Supabase connection pooler if DB password is available.

---

## 8. Missing Protections Summary

### 8.1 Database Level

| Issue | Severity | Tables Affected |
|---|---|---|
| RLS disabled on `event_links` | 🔴 CRITICAL | event_links |
| RLS disabled on `event_registrations` | 🔴 CRITICAL | event_registrations |
| RLS disabled on most staging_* tables | 🟡 MEDIUM | All staging_* |
| RLS disabled on `application_answers` | 🔴 HIGH | application_answers |
| RLS disabled on `feedback_responses` | 🔴 HIGH | feedback_responses |
| No WRITE policies anywhere | 🔴 HIGH | All tables (intentional but risky if service-role compromised) |
| anon can EXECUTE SECURITY DEFINER helper functions | 🟡 MEDIUM | current_admin_role(), is_admin_role(), is_active_admin() |
| Uncertain search_path on some RPCs | 🟡 MEDIUM | RPCs in 022, 023, 025, 029, 030 |
| SECURITY DEFINER views (founder intelligence) | 🟡 MEDIUM | Views in 025, 030 |
| Leaked password protection disabled | 🟢 LOW | Auth settings |
| No visible point-in-time recovery setup | 🟡 MEDIUM | Production DB |

### 8.2 Application Level

| Issue | Severity | Notes |
|---|---|---|
| Service-role key in git history | 🔴 CRITICAL | .env.local.example |
| Admin portal is service-role-first | 🟡 MEDIUM | By design; must be protected by correct RLS if key is compromised |
| Public routes use service-role (acceptable) | ✅ OK | Server actions only, no client-side |
| No CSRF protection beyond SameSite=Lax cookie | 🟢 LOW | Next.js server actions handle this adequately |

---

## 9. Public Registration Flow Security Assessment

**Current state (registration CLOSED):**
- All public registration routes bypass the admin auth middleware.
- Registration is controlled by `event_links.is_active` field.
- `is_active = false` causes the page to show "Đăng ký đã đóng" without rendering the form.
- The Server Action `registerForEvent()` also re-validates the link status server-side before inserting.
- **Double protection: page-level block + server-action re-check.** ✅

**Dependency on anonymous table access:**
> "Stop immediately if the public registration flow depends on direct anonymous table access."

**Result: It does NOT.** All reads and writes in the registration flow use the service-role client via server actions (`"use server"`). The anon key is not used for any data operation in `/register/*` or `/checkin/*`. No browser-to-Supabase direct calls occur on public routes.

The registration flow is therefore **safe from RLS bypass at the database level for data writes**, but enabling RLS on `event_links` and `event_registrations` without carefully creating service-role-bypass-appropriate policies would **not** break the current flow (since service-role bypasses RLS), but would add defense-in-depth.

---

## 10. Recommended Remediation Sequence

### Priority 1 (Immediate — before any Phase 2/3/4 work)

1. ~~**Verify and rotate the exposed service-role key.**~~ ✅ **COMPLETED 2026-06-17** — Key identified, rotated in Supabase Dashboard, Vercel updated, production redeployed and verified, old key revoked.

2. ~~**Clean `.env.local.example`**~~ ✅ **COMPLETED 2026-06-17** — Real key replaced with placeholder `your_service_role_key_here`.

3. **Assess git history purge** — The key in git history is confirmed invalid. Consider `git filter-repo` to purge from history. Deferred — key is revoked and repository is private.

### Priority 2 (Staging first, then production after approval)

4. **Enable RLS on `event_links`** — with policy: service-role bypasses (automatic), admin (authenticated) can SELECT, no anon SELECT.
5. **Enable RLS on `event_registrations`** — same pattern.
6. **Apply migration 018 helper functions** to production (if not already applied).
7. **Enable RLS on tables 018 already covers** — verify migration 018 was actually applied to production; if not, apply it.
8. **REVOKE EXECUTE on helper functions from anon** — `revoke execute on function public.current_admin_role() from anon, public`.
9. **Audit search_path on all RPCs in migrations 022, 023, 025, 029, 030.**
10. **Review SECURITY DEFINER views** in migrations 025/030 — confirm they are SECURITY INVOKER safe or REVOKE public access.
11. **Enable RLS on `application_answers`, `feedback_responses`, `communications`** — default deny.
12. **Enable RLS and default-deny all `staging_*` tables** in production.
13. **Enable leaked password protection** in Supabase Dashboard → Auth Settings.
14. **Set up production backup schedule** in Supabase Dashboard.

### Priority 3 (Enhancement)

15. Add INSERT policy on `event_registrations` — allow INSERT from service-role only (implicit) or add server-side RLS function check.
16. Consider `anon` REVOKE on all public schema tables (belt-and-suspenders with service-role-first architecture).

---

## 11. Exact Files Expected to Change

### New files to create:

| File | Purpose |
|---|---|
| `supabase_migrations/057_security_hardening_rls_phase1.sql` | Main RLS hardening migration |
| `scripts/test_security_rls.ps1` | PowerShell test script for staging |
| `docs/VAM_OS_SECURITY_REMEDIATION_PLAN.md` | Remediation plan document |

### Existing files to modify:

| File | Change |
|---|---|
| `.env.local.example` | Replace real key with placeholder |

### Git history (out-of-band):

| Action | Tool |
|---|---|
| Remove key from git history | `git filter-repo` (requires separate approval) |

---

## 12. Test Plan

### 12.1 Pre-Staging Tests (No DB changes)

- [ ] Confirm `.env.local.example` no longer contains a real key value.
- [ ] Confirm Supabase Security Advisor warnings count (baseline).

### 12.2 Staging Tests (After migration 057 applied to staging only)

- [ ] Unauthenticated anon cannot SELECT from `people` via PostgREST (expected: 0 rows or 403).
- [ ] Unauthenticated anon cannot SELECT from `event_registrations` (expected: 0 rows or 403).
- [ ] Unauthenticated anon cannot SELECT from `event_links` tokens (expected: 0 rows or 403).
- [ ] Unauthenticated anon cannot SELECT from `application_answers` (expected: 0 rows or 403).
- [ ] Authenticated non-admin cannot EXECUTE admin RPCs.
- [ ] Admin can log in to staging portal.
- [ ] Admin can view People, Mentors, Mentees, Applications, Matches pages.
- [ ] Events list and event detail work.
- [ ] Public registration page loads correctly (event must exist and link be active on staging).
- [ ] Registration blocked when `is_active = false` on the link.
- [ ] Capacity and waitlist logic still work (test with staging event).
- [ ] Registration success verification still works (registration_id query param).
- [ ] Check-in still works.
- [ ] Operations dashboard and reports load correctly.
- [ ] Security Advisor rerun — count of remaining warnings documented.

---

## 13. Rollback Plan

### 13.1 Migration 057 Rollback (Staging)

For each table where RLS is enabled in migration 057:

```sql
-- Example rollback for event_links and event_registrations:
alter table public.event_links disable row level security;
drop policy if exists "event_links_anon_deny" on public.event_links;
drop policy if exists "event_links_admin_select" on public.event_links;

alter table public.event_registrations disable row level security;
drop policy if exists "event_registrations_anon_deny" on public.event_registrations;
drop policy if exists "event_registrations_admin_select" on public.event_registrations;
```

Full rollback will be included inline as comments in migration 057.

### 13.2 If Admin Portal Breaks After RLS Enable

Since all data access uses the service-role client (which bypasses RLS), enabling RLS should NOT break any admin portal functionality. However, if it does:

```sql
-- Emergency: disable RLS on affected table
alter table public.<table_name> disable row level security;
```

The service-role key bypass means RLS enable/disable only affects anon and JWT-based authenticated access — not service-role access used by the portal.

### 13.3 If Public Registration Breaks

Same reasoning applies — registration uses service-role. If registration mysteriously breaks:
1. Check server logs for SUPABASE_SERVICE_ROLE_KEY missing/changed.
2. Verify Vercel environment variables match the (possibly rotated) key.
3. As last resort: disable RLS on `event_links` and `event_registrations`.

---

## 14. Decisions Requiring Thang's Approval

| # | Decision | Impact | Status |
|---|---|---|---|
| 1 | Was `[REDACTED]` a real key? | 🔴 CRITICAL | ✅ **RESOLVED** — confirmed real production key; rotated, revoked 2026-06-17 |
| 2 | Rotate the exposed key? | HIGH | ✅ **RESOLVED** — rotated and revoked by Thang 2026-06-17 |
| 3 | Clean `.env.local.example` and commit? | LOW | ✅ **RESOLVED** — committed in this session |
| 4 | Git history purge (force-push)? | LOW-MEDIUM | ⏳ Deferred — key is invalid; purge requires separate approval |
| 5 | Proceed to Phase 2 (backup)? | MEDIUM | ✅ **RESOLVED** — pg_dump backups created securely 2026-06-17 |
| 6 | Staging schema comparison before applying migration 057? | MEDIUM | ⏳ Pending — Phase 3 schema comparison |
| 7 | Apply migration 057 to staging? | HIGH | ⏳ Pending — after Phase 3 diff review |
| 8 | Apply migration 057 to production? | 🔴 CRITICAL | ⏳ Pending — requires explicit Thang approval after staging tests pass |

---

## 15. Phase 2, 3, 4 Readiness Assessment

| Phase | Readiness | Blockers |
|---|---|---|
| Phase 2 — Backup | ✅ Completed | pg_dump logical backups securely created and validated 2026-06-17. |
| Phase 3 — Staging prep | 🟢 Ready | Staging is accessible. Proceeding to schema diff. |
| Phase 4 — Remediation design | 🟢 Ready | Can create migration 057 file without applying. |

---

*Audit completed: 2026-06-17. No production changes were made. This report is read-only.*
*Next action: Proceed to Phase 3 read-only schema comparison between production and staging.*
