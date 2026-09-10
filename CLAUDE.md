# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VAM OS Admin Portal — internal Next.js 14 (App Router) admin portal for Vietnam Alumni Mentoring, backed by Supabase. Runs multiple mentoring programs/seasons (UEHM Season 11/12, HAM Season 6) covering people, applications, reviews/interviews, matching, events, recaps, and operations dashboards.

**Note:** `README.md` and `docs/DEPLOYMENT_NOTES.md` describe the original v0.1 MVP ("read-only, no auth, no RLS"). Both are stale — the app now has Supabase Auth, a role model, program-scoped access, and many write paths. Trust the code over those two documents.

**All user-facing text is Vietnamese.** New UI strings, validation messages, and action results must be Vietnamese; display labels for DB enums belong in `lib/ui-labels.ts` (never rename DB enum values to change display text).

## Commands

```bash
npm install
npm run dev:clean      # rimraf .next && next dev — preferred; avoids stale chunk issues
npm run build
npm run lint           # next lint
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npx vitest run __tests__/permissions.test.ts   # single test file
npx vitest run -t "canManageUsers"             # single test by name
```

On Windows the docs use `npm.cmd run …`; plain `npm run …` works from bash.

Vitest runs in a `node` environment against `__tests__/**/*.test.ts` only, with the `@/*` alias. Tests never touch a live database — they run against pure logic modules (`lib/permissions.ts`, `lib/nav-model.ts`, `lib/normalizers.ts`, `lib/ui-labels.ts`, …) or read SQL/markdown files from disk. Component and page tests do not exist.

## Environment

`.env.local` (see `.env.local.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` fallback)
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**; most data reads and all admin_users lookups depend on it
- `VAM_OS_ADMIN_PASSWORD` — shared MVP unlock gate; unset ⇒ gate is bypassed
- `VAM_OS_APPLY_TOKEN` / `VAM_OS_APPLICATION_PILOT_TOKEN`, `VAM_OS_ENABLE_MENTOR_APPLICATION`, `VAM_OS_ENABLE_MENTEE_APPLICATION` — public intake form gates

Known Supabase project refs are hardcoded in `lib/supabase.ts` and `lib/preview-environment.ts`: staging `ljfneyuvpxrmejpxsmpz`, production `qkkroesfiazsejkzflcd`. `PreviewEnvironmentBanner` warns loudly when a preview/dev deploy is pointed at production.

## Access control — three independent layers

Every non-public page passes through all three. Getting one right is not enough.

1. **Unlock gate** (`middleware.ts` + `/unlock` + `lib/password-gate.ts`) — shared password, coarse "internal only" lock. Skipped entirely when a valid Supabase session resolves to an active admin.
2. **Identity** (`lib/admin-auth.ts`) — Supabase Auth cookies (`AUTH_ACCESS_COOKIE`/`AUTH_REFRESH_COOKIE` in `lib/auth-constants.ts`) resolved to a row in `public.admin_users` with `status = 'active'`. This lookup **must** use the service-role client: `admin_users` has RLS that only exposes a user's own row, and reading it with the anon-bearer client silently returned null, degrading real admins to viewers. `getCurrentAdminUser()` therefore **throws on config/DB failure and only returns null for a genuine non-admin** — do not reintroduce a try/catch that swallows this (see the comment in `app/layout.tsx`).
3. **Authorization** — two orthogonal checks that are almost always combined:
   - *Global role* — `lib/permissions.ts` predicates (`canManageMatches`, `canDecide`, `canReview`, …) over roles `super_admin | admin | core_team | reviewer | support_team | viewer`.
   - *Program/season scope* — `lib/program-scope.ts` reads `admin_scope_access` into an `AdminScopeContext` with scope levels `full_access > operations > review > read`. `super_admin` bypasses scope entirely. `getScopeFilter(ctx)` returns allowed program/season ids and is threaded into `lib/data.ts` queries; `undefined` means unrestricted.

Typical page preamble:

```ts
const scopeContext = await getAdminScopeContext();
const scope = await getScopeFilter(scopeContext);
const adminUser = await getCurrentAdminUser();
const allowManage = canManageMatches(adminUser?.role) && canOperateAnyScope(scopeContext);
```

`middleware.ts`'s matcher excludes `/login`, `/unlock`, `/apply`, `/reset-password`; `/register/*` and `/checkin/*` are public and flagged via the `x-vam-public-route` header so `app/layout.tsx` renders them without the admin shell. Public intake forms are gated separately by `lib/apply-gate.ts` (enable flag **and** token, both required).

## Architecture conventions

- **Server components + server actions.** Pages are async server components that call `lib/*` directly. Mutations live in `app/actions/*.ts` (`"use server"`), which are thin: parse `FormData`, call the `lib/` function, `revalidatePath`, return an action-state object. **All authorization and validation live in the `lib/` function, not the action** (e.g. `createManualMatch` calls `requireMatchAdmin()` itself), so the guard can't be bypassed by another caller.
- **Action state types live in `lib/*-action-types.ts`**, never in the `"use server"` file — client components import them and cannot cross the `"use server"` boundary. Every `app/actions/x.ts` has a matching `lib/x-action-types.ts`.
- **`import "server-only"`** at the top of every `lib/` module that touches cookies or the service-role client. Modules that must stay testable (`permissions`, `ui-labels`, `nav-model`, `normalizers`, `program-context-core`, `preview-environment`) deliberately do not — keep them dependency-light. The `*-core.ts` split (`program-context-core.ts` vs `program-context.ts`) exists exactly for this: pure logic in `-core`, I/O in the wrapper.
- **Supabase clients** (`lib/supabase.ts`, `lib/supabase-server.ts`): `getSupabaseServiceRoleClient()` (privileged, server-only), `getSupabaseServerClient()` (anon key + user's access token), and the module-level `supabase` anon client. `lib/data.ts`'s `dataClient()` falls back service-role → user → anon. All are created with `cache: "no-store"`.
- **Error handling.** Data functions return `QueryResult<T> = { data, error }` with a Vietnamese message and log details via `console.error("[scope]", …)`; pages render `ErrorBox` rather than throwing. Mutations return `MutationResult = { ok, message }`. Never surface raw Postgres errors to users — `lib/action-feedback.ts#normalizeActionError` scrubs anything matching service_role/token/sql/constraint patterns.
- **Client components** are small leaves (`*-form.tsx`, `*-client.tsx`) colocated with their page and driven by `useFormState` against the server actions. Shared primitives are in `components/ui.tsx`; nav structure is derived from role by `lib/nav-model.ts#buildNavGroups`.
- **Season configuration is centralized in `lib/season-config.ts`** — `CURRENT_OPERATING_SEASON_CODE` (dashboards) and `CURRENT_APPLICATION_SEASON_CODE`/`CURRENT_APPLICATION_BATCH_CODE` (intake) are intentionally different seasons. Read the comments before changing either.

## Database & migrations

- Numbered SQL files in `supabase_migrations/` (currently through `061`), applied manually through the Supabase SQL editor — there is no migration runner in this repo. Migrations are additive by policy; do not drop production columns as a rollback (`docs/MIGRATION_PRODUCTION_SYNC.md`).
- Anything under `docs/audits/sql/design_only/` and `staging_bootstrap/design_only/` is **design only — not authorized to execute**. These files carry mandatory `DESIGN ONLY` / `STAGING ONLY` / `NOT AUTHORIZED` / `DO NOT EXECUTE` header phrases, and several vitest suites (`auth-emergency-admin-rls-*.test.ts`, `staging-baseline-*.test.ts`, `migration-061-*.test.ts`, `ham-s6-production-import-safety.test.ts`) parse the SQL text to assert those headers, transaction boundaries, and the absence of production identifiers. Editing one of those SQL files usually means updating its test.
- `docs/audits/` holds dated design/runbook/result documents; production changes are expected to have a preflight → backup → execution → verification document trail before touching data.
- `data_imports/`, `activity_import_runner/`, `team_assignment_import_runner/` hold CSV import material and Python runners. `.gitignore` deliberately excludes PII-bearing CSVs, workbooks, and DB backups — check it before adding files under `data_imports/`.

## Workflow

Work happens on feature branches merged to `main` via PR (branch names describe the work package, e.g. `auth-emergency-admin-rls-staging-package`). Run `npm run typecheck && npm run lint && npm test` before committing; there is no CI config in the repo.
