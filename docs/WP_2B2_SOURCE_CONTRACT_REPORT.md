# VAM OS — WP 2B.2 Source-Contract Reconciliation Report

**Mode:** forensic, read-only. No production system was modified.
**Prepared by:** new technical owner side (`vanhoang-spec`).
**Date:** 2026-09-07.

---

## A — Canonical source cross-check

### Checkout facts

| Item | Value |
|---|---|
| Repo | `vanhoang-spec/vam-os-admin-portal` |
| Branch | `main` |
| `git HEAD` | `cc75c10b453c4cfe024a7d436166a88fceb57cb0` |
| `git status` | clean |
| Package manager | npm (`package-lock.json`, `npm ci` in workflow) |
| Node requirement in repo | **none** — `package.json` has no `engines` field |
| Next.js | `^15.5.23` (resolved 15.5.25) |

> **Node observation.** There is no `engines` pin, so nothing in the repo asserts a
> Node version. Today the *build* runs on Node **20.19.0** (pinned in the GitHub
> Actions workflow) while the *runtime* is Node **24.x** (old Vercel project
> setting). That split already exists in production; it is not introduced by the
> move. To reproduce current behaviour, set the new project to Node **24.x** and
> leave the workflow at 20.19.0.

### Method

`process.env` was enumerated across the whole tree and then partitioned by whether
the file sits inside the Next.js runtime boundary (`app/`, `lib/`, `middleware.ts`,
`next.config.*`, `vercel.json`) or outside it (`scripts/`, `__tests__/`,
`.github/workflows/`). Dynamic access was checked as well as literal access:
`lib/supabase-server.ts` reads its key through a `const` indirection
(`process.env[SERVICE_ROLE_ENV_NAME]`), which a naive literal grep would miss — it
is included below.

### The three sets

**LIVE_VERCEL_ENV** — 10 unique names / 13 entries (per the old-project inventory
supplied with this work package):

*Production-scoped (5):* `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VAM_OS_APPLICATION_PILOT_TOKEN`, `VAM_OS_ADMIN_PASSWORD`

*Preview-only (5):* `DATABASE_URL`, `VAM_OS_APPLY_TOKEN`,
`VAM_OS_ALLOW_TOKENLESS_APPLICATIONS`, `VAM_OS_ENABLE_MENTEE_APPLICATION`,
`VAM_OS_ENABLE_MENTOR_APPLICATION`

**CODE_REFERENCED_ENV** — 8 names actually read by runtime code:

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VAM_OS_APPLY_TOKEN`, `VAM_OS_APPLICATION_PILOT_TOKEN`, `VAM_OS_E2E_HARNESS`,
`NODE_ENV`

**ENV_EXAMPLE_DOCUMENTED** — 6 names in `.env.local.example` (there is no
`.env.example`):

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VAM_OS_ADMIN_PASSWORD`, `VAM_OS_APPLICATION_PILOT_TOKEN`

### Set differences

**COMMON (live ∩ code) — 5**
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VAM_OS_APPLICATION_PILOT_TOKEN`, `VAM_OS_APPLY_TOKEN`

**LIVE_ONLY (in Vercel, never read by runtime code) — 5**
`VAM_OS_ADMIN_PASSWORD`, `DATABASE_URL`, `VAM_OS_ALLOW_TOKENLESS_APPLICATIONS`,
`VAM_OS_ENABLE_MENTEE_APPLICATION`, `VAM_OS_ENABLE_MENTOR_APPLICATION`

**CODE_ONLY (read by code, absent from Vercel) — 3**
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `VAM_OS_E2E_HARNESS`, `NODE_ENV`

**DOCUMENTED_ONLY — none.** Every name in `.env.local.example` appears in at least
one of the other two sets.

### CODE_ONLY detail

| Variable | File / path | Feature | Production behaviour if unset | Class |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `lib/supabase.ts:4` | Browser Supabase client key | None. It is the **second** operand of `ANON_KEY ?? PUBLISHABLE_KEY`; while `ANON_KEY` is set it is never consulted. | OPTIONAL |
| `VAM_OS_E2E_HARNESS` | `app/e2e-harness/page.tsx:9` | Test-only page rendering isolated components | `notFound()` → 404. This is the desired production state. | OPTIONAL — **must stay unset** |
| `NODE_ENV` | Next.js / platform | Standard build + runtime mode | Vercel sets it to `production` automatically. | Platform-managed — **never set by hand** |

---

## B — Current Production defaults, proven from code

Each of the five names below is absent from old Production. What follows is what the
current `main` actually does without them.

```
ENV_NAME=DATABASE_URL
UNSET_BEHAVIOR=No effect whatsoever. Zero runtime readers.
CODE_PATH=(none in app/, lib/, middleware.ts) — only scripts/pg-harness/run.mjs,
          a local developer harness that is not part of the Next.js build.
SAFE_TO_LEAVE_UNSET_IN_NEW_PRODUCTION=YES
REASON=The application reaches Postgres exclusively through supabase-js/PostgREST.
       No direct Postgres connection exists in the runtime.
```

```
ENV_NAME=VAM_OS_APPLY_TOKEN
UNSET_BEHAVIOR=configuredToken() falls through to VAM_OS_APPLICATION_PILOT_TOKEN.
               The apply gate keeps working on the Production token.
CODE_PATH=lib/apply-gate.ts:36-46
SAFE_TO_LEAVE_UNSET_IN_NEW_PRODUCTION=YES
REASON=It is not a second, independent switch — see section C. Setting it in the new
       Production would silently REPLACE the pilot token and invalidate every apply
       link already sent to students.
```

```
ENV_NAME=VAM_OS_ENABLE_MENTOR_APPLICATION
ENV_NAME=VAM_OS_ENABLE_MENTEE_APPLICATION
ENV_NAME=VAM_OS_ALLOW_TOKENLESS_APPLICATIONS
UNSET_BEHAVIOR=No effect. Zero runtime readers for all three (verified per-name).
CODE_PATH=(none). lib/season-config.ts:29-38 documents them explicitly as dead
          config, kept only as a warning to operators.
SAFE_TO_LEAVE_UNSET_IN_NEW_PRODUCTION=YES
REASON=Form open/closed state moved into the database: public.application_form_controls,
       read by lib/application-form-controls.ts:140. An env var cannot open or close
       a form any more.
```

The source comment, verbatim (`lib/season-config.ts:29-38`):

> `VAM_OS_ENABLE_MENTOR_APPLICATION`, `VAM_OS_ENABLE_MENTEE_APPLICATION` and
> `VAM_OS_ALLOW_TOKENLESS_APPLICATIONS` are dead config: nothing reads them. Setting
> them has no effect and cannot open a form. Remove them from Vercel once M069 is
> live so nobody believes otherwise.

**FEATURE_FLAGS_CURRENT_PRODUCTION_BEHAVIOR = database-driven, environment-independent.**
Do not carry any of the three into the new project. Their presence in old Preview is
historical residue, not configuration.

---

## C — Secret dependency analysis

No secret value was read, printed, or transmitted in producing this report.

### `VAM_OS_ADMIN_PASSWORD`

```
USED_IN_PRODUCTION_CODE=NO
CODE_PATH=(none) — appears only in .env.local.example and 13 documentation files
PURPOSE=Legacy shared admin password, superseded by Supabase Auth
CURRENT_PRODUCTION_SCOPE=Production (old Vercel)
ROTATION_NEEDED_FOR_NEW_PROJECT=NO
USER_IMPACT_IF_ROTATED=None.
```

Admin sign-in runs through Supabase Auth with each admin's own credentials —
`app/login/actions.ts:25` calls `client.auth.signInWithPassword({ email, password })`,
and that is the only call site in the repository. **Recommendation: do not carry this
variable over.** It is Production-scoped today purely as leftover state, and its
presence invites the false belief that a shared password still controls access.

### `VAM_OS_APPLICATION_PILOT_TOKEN`

```
USED_IN_PRODUCTION_CODE=YES (conditionally)
CODE_PATH=lib/apply-gate.ts:36-46 -> evaluateApplyGate
PURPOSE=The secret embedded in per-person apply links during a "pilot" intake
CURRENT_PRODUCTION_SCOPE=Production, write-only
ROTATION_NEEDED_FOR_NEW_PROJECT=NO — carrying the same value over is preferred
USER_IMPACT_IF_ROTATED=Every apply link already distributed stops working, IF and
                       ONLY IF the form state is currently `pilot`.
```

### `VAM_OS_APPLY_TOKEN`

```
USED_IN_PRODUCTION_CODE=YES when set — it takes precedence
CODE_PATH=lib/apply-gate.ts:36-46 (first operand)
PURPOSE=Current name for the same secret
CURRENT_PRODUCTION_SCOPE=Preview only
ROTATION_NEEDED_FOR_NEW_PROJECT=NO
USER_IMPACT_IF_SET_IN_NEW_PRODUCTION=Overrides the pilot token silently and breaks
                                     existing links. Leave unset.
```

### The distinction the work package asked for

The work package said: *"Do NOT assume they are interchangeable."* The code gives a
precise answer, and it is neither "interchangeable" nor "independent":

```ts
const value =
  process.env.VAM_OS_APPLY_TOKEN?.trim() ||
  process.env.VAM_OS_APPLICATION_PILOT_TOKEN?.trim();
```

They are **one setting with two names and a strict precedence**. `VAM_OS_APPLY_TOKEN`
is the current name and wins; `VAM_OS_APPLICATION_PILOT_TOKEN` is the original name,
retained as a fallback specifically so an existing deployment does not lose its pilot
link. Old Production has only the fallback set, so the fallback is the value in force
today.

The operational consequence is the single most dangerous item in this migration:
**setting `VAM_OS_APPLY_TOKEN` in the new Production to any value other than the old
pilot token silently invalidates every apply link already sent, with no error and no
log line.** The forms simply answer "closed" to students holding valid links.

### RESOLVED — the token is inert in current Production

Production `public.application_form_controls` was read on 2026-09-07:

| applicant_role | state | updated_at |
|---|---|---|
| mentee | `open` | 2026-08-15 23:04:09+00 |
| mentor | `open` | 2026-08-15 23:03:57+00 |

Both roles are `open`, and `evaluateApplyGate` returns on the `open` branch **before**
`configuredToken()` is ever called (`lib/apply-gate.ts:98-100`). Nothing else in the
tree reads either token env var: the token travels from the URL query string into a
hidden form field (`APPLY_TOKEN_FIELD`), so no server-side link builder depends on it
either.

**Therefore `VAM_OS_APPLICATION_PILOT_TOKEN` is not required in the new Production and
should be omitted.** The unrecoverable write-only value is a non-issue. If pilot intake
is ever wanted again, generate a fresh token at that time and set it alongside flipping
the state — one command, no history to preserve.

Note for the owner, not a migration blocker: both intake forms have been publicly open
since 2026-08-15. The new Production will reproduce that, because the state lives in
the database, not in Vercel.

### The gate's decision table, for reference

The gate makes the token relevant in only one of three states:

| DB state | token provided | result |
|---|---|---|
| `closed` | any | CLOSED — a token can never bypass closed |
| `pilot` | correct | OPEN |
| `pilot` | wrong / missing / env unset | CLOSED |
| `open` | ignored | OPEN |
| unreadable | any | CLOSED |

Only the `pilot` rows consult the token. Production is in `open`, so the token contract
is unreachable today — see the resolution above.

---

## D — Supabase contract

| Variable | Where read | Role |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase.ts:3` | Project URL, browser + server. **REQUIRED** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts:4` | Browser client key, first operand. **REQUIRED** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `lib/supabase.ts:4` | Fallback for the above. **OPTIONAL** |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase-server.ts:8,11` (via `SERVICE_ROLE_ENV_NAME`) | Server-side privileged client. **REQUIRED** |
| `DATABASE_URL` | nowhere in the runtime | — |

**`DATABASE_URL_REQUIRED_IN_PRODUCTION = NO.`** There is no direct Postgres connection
in the runtime: no `pg.Client`, no `new Pool`, no `postgres://` literal anywhere under
`app/`, `lib/` or `middleware.ts`. The `pg` package is present as a dependency, but its
only importer in the repository is `scripts/pg-harness/run.mjs`, which Next.js never
bundles. Introducing `DATABASE_URL` into the new Production because old Preview had it
would add a live database credential with no consumer.

All three required values must be taken **fresh** from Hoàng's Production Supabase
project (Settings → API), not copied from the old Vercel project. Their values do not
appear in this report.

**SUPABASE_CONTRACT = PASS.**

---

## E — Deployment contract

### Does Production deploy through GitHub Actions?

Yes. `.github/workflows/vercel-production.yml`, triggered on `push` to `main` and
`workflow_dispatch`, `environment: Production`, concurrency group `vercel-production`
with `cancel-in-progress: false`.

Pipeline: checkout (`fetch-depth: 0`) → Node 20.19.0 → **secret pre-flight** →
`npm ci` → `npm run typecheck` → `npm test` → install `vercel@59.1.3` →
`vercel pull --yes --environment=production` → `vercel build --prod` →
`vercel deploy --prebuilt --prod`.

### Does Vercel Git Integration also deploy?

**No — deliberately disabled**, and the proof lives in the repository rather than in
project settings, which means it travels with the repo to the new project:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": { "main": false } }
}
```

### Required GitHub Secrets

`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — all three **environment-scoped
on the `Production` environment**, not repository-scoped. They survived the repository
transfer intact. The workflow fails fast and loudly if any is empty, before installing
anything.

### Prebuilt artifact?

Yes — `vercel build --prod` then `vercel deploy --prebuilt --prod`. Two consequences
worth stating plainly:

1. `vercel pull --environment=production` fetches the Vercel project's Production env
   **into the build**. Environment values live in Vercel, not in GitHub. Therefore the
   new project's env must be complete **before** its first deploy — `NEXT_PUBLIC_*`
   values are inlined into the client bundle at build time, and a build run against an
   empty project bakes in missing values that no later env edit corrects without a
   rebuild.
2. The build runs on Node 20.19.0 in the runner; the serverless runtime uses the Vercel
   project's Node setting.

### Duplicate deployments after importing the new project?

**No, for `main`** — `vercel.json` disables git deployment on `main`, and the file is in
the repository, so a newly imported project inherits the rule immediately. Non-`main`
branches will get Preview deployments from the new project's git integration; that is
new activity but harmless and never touches Production.

The real cut-over point is not the import. It is the three GitHub secrets: until
`VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` / `VERCEL_TOKEN` are repointed, **every push to
`main` continues to deploy to the OLD project**. Creating and configuring the new
project changes nothing about where production traffic goes. That is exactly the
property that makes it safe to do before the cut-over.

### One thing not yet on `main`

A second workflow, `.github/workflows/ci.yml`, exists on branch `ci/pull-request-checks`
(PR #60) and is not merged. It runs on `pull_request` to `main` only, deploys nothing,
and needs no secrets. Noted so it is not mistaken for a second deploy path.

**DEPLOYMENT_AUTHORITY = GITHUB_ACTIONS**, on the evidence of `vercel.json` disabling
the alternative and the workflow owning the whole test-build-deploy chain.

---

## GATE 2B.2

| Gate | Verdict |
|---|---|
| `SOURCE_ENV_CONTRACT` | **PASS** |
| `PRODUCTION_DEFAULTS_PROVEN` | **PASS** |
| `SUPABASE_CONTRACT` | **PASS** |
| `DEPLOYMENT_CONTRACT` | **PASS** |

---

## Prepared new-project configuration (NOT applied)

| Setting | Value |
|---|---|
| Git repo | `vanhoang-spec/vam-os-admin-portal` |
| Production branch | `main` |
| Framework | Next.js |
| Node | 24.x |
| Build command | default (the Actions pipeline supplies the prebuilt artifact) |

**Production environment variables — exactly three:**

| Name | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Hoàng's Production Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, `service_role` `secret` key |

An organization transfer does not change a Supabase project's ref, URL or API keys, so
these three are byte-identical to what old Production is running on. There is no
mismatch risk and no rotation involved. Do **not** rotate them during the move — old
Production is still serving traffic on the same keys.

**Deliberately excluded:** `VAM_OS_APPLICATION_PILOT_TOKEN` (proven unreachable while
form state is `open`), `DATABASE_URL` (no consumer), `VAM_OS_APPLY_TOKEN` (would
override the pilot token), the three feature flags (dead config),
`VAM_OS_ADMIN_PASSWORD` (no consumer), `VAM_OS_E2E_HARNESS` (must stay unset),
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (unreachable while `ANON_KEY` is set),
`NODE_ENV` (platform-managed).

Ten live names become three. Nothing was dropped without a code path proving it unused.

---

## Addendum — the hostname is the real cut-over constraint

Not an environment-variable question, but it outranks one, so it is recorded here.

The old project holds `vam-os-admin-portal.vercel.app` and has **no custom domain**.
`*.vercel.app` hostnames are globally unique across Vercel, so a new project cannot be
served at that hostname while the old project still claims it; Vercel assigns a
suffixed hostname instead. Every apply link already in circulation points at the old
hostname.

Code imposes no constraint here — there are no `emailRedirectTo` / `redirectTo` /
`resetPasswordForEmail` / OTP flows, no `VERCEL_URL` or `NEXT_PUBLIC_SITE_URL` reader,
and no hardcoded production hostname anywhere in `app/` or `lib/`. Sign-in is
password-only through Supabase Auth. So the hostname can change without breaking the
application; it only breaks links people already hold.

Two ways forward, both requiring an owner decision rather than a code change:

1. **Attach a custom domain to the new project** (e.g. a VAM-owned subdomain). Removes
   the dependency on Vercel project naming permanently. Links already sent still point
   at the old hostname.
2. **Coordinated hostname swap at cut-over** — the old project is renamed to release
   the name, the new project is renamed to claim it. Costs a short outage window and
   requires both owners acting in sequence.

Recommendation: option 1, decided before the cut-over rather than during it.

---

## Addendum 2 — new project provisioned and smoke-tested (2026-09-08)

Executed after the gate passed. **The old project was not touched at any point.**

| Item | Value |
|---|---|
| Scope | team `tcm17` (Vercel no longer permits a personal-account scope on this account: `personal_scope_not_allowed`) |
| Project | `vam-os-admin-portal` |
| Framework preset | Next.js |
| Node.js | 24.x |
| Git integration | **not connected, deliberately** |
| Function region | **`sin1` (Singapore)** — a deliberate divergence from old production, see below |
| Production hostname | **`vam-os.vercel.app`** (`vam-os-admin-portal-delta.vercel.app` 307-redirects to it) |

**Why git was left unconnected.** `vercel deploy --prebuilt` needs no git connection, so
leaving it off makes duplicate deploys and stray preview builds structurally impossible
rather than merely disabled by `vercel.json`. The old project needed that file precisely
because it *was* connected.

**Environment variables — 3, verified by shape and claim, never by printing:**

| Name | Vercel type | Verification |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Config | matches `https://<20-char ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | JWT, `role="anon"`, `ref` matches the URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | not readable by `vercel env pull` — verified at runtime instead, see below |

Storing the service-role key as a Vercel **Secret** is a deliberate improvement over the
old project, where it is an ordinary variable. Two risks were checked and cleared:

1. *Does the build need it?* No. `next build` completed with every route dynamic
   (`ƒ server-rendered on demand`); the tree contains no `force-static` and no
   `generateStaticParams`, so nothing prerenders against Supabase.
2. *Does it reach the runtime?* Yes — proven behaviourally. `/apply/mentor` renders the
   live form with the season name read from the database. That path runs
   `evaluateApplyGate` → `readApplicationFormState` → server Supabase client. A missing
   or wrong key would have produced `control_rows_unreadable` and the page would read
   "Không xác minh được trạng thái form đăng ký."

**Equivalence check.** `/apply/mentor` was fetched from both the new deployment and the
old production. The rendered text is identical, including the programme name resolved
from the database. `/login` renders correctly, which additionally confirms the
`NEXT_PUBLIC_*` values were inlined into the client bundle at build time.

**Local `vercel build` caveat, not a defect:** on Windows it fails with
`EPERM: operation not permitted, symlink` when deduplicating serverless functions.
Windows requires Developer Mode or admin rights for symlinks. `ubuntu-latest` in GitHub
Actions is unaffected. The smoke deploy therefore used a Vercel-side build; the
prebuilt path remains the canonical one for CI.

### Deliberate divergence: function region

The one place the new project does **not** reproduce old production, decided by the
owner after measurement.

Old production runs its functions in `iad1` (Washington D.C.) while the Supabase
project is in `ap-southeast-1` (Singapore) — confirmed by `x-vercel-id: hkg1::iad1::…`
on both projects and ~60 ms TCP connect from Vietnam to the Supabase host. Every
query therefore crosses the Pacific twice, roughly 200 ms per round trip. That is the
cause of the slow admin pages, and it predates this migration.

Measured on `/apply/mentor`, warm, eight samples each:

| Project | Region | Mean | Steady state |
|---|---|---|---|
| new | `sin1` | 0.406 s | ~0.375 s |
| old | `iad1` | 0.555 s | ~0.550 s |

~175 ms saved per database round trip. `/apply/mentor` has one query stage, so it gains
only that; `app/applications/[id]/page.tsx` has roughly six sequential stages and
should gain close to a second. The code is not the problem — that page already uses
`Promise.all` in four places, and 31 `page.tsx` files parallelize their queries.

Two operational notes:

- `vercel redeploy` **clones the previous deployment along with its region**, so it
  does not pick up a region change. A fresh `vercel deploy --prod` is required. The
  first attempt failed for exactly this reason.
- The team is on a **Pro trial**. Region selection is a paid feature; if the trial
  lapses to Hobby the region may silently revert to `iad1` and the gain disappears
  with no notification. Treat the current speed as provisional until the plan is
  settled.

### What remains before cut-over

1. ~~**Hostname.**~~ **RESOLVED 2026-09-08.** Rather than contest
   `vam-os-admin-portal.vercel.app` or wait on DNS for a custom domain, the project
   claimed the unused shorter name **`vam-os.vercel.app`**, verified serving both
   `/login` and the database-backed `/apply/mentor`. No DNS, no certificate wait, no
   coordination with the old owner. The suffixed `-delta` hostname redirects to it.

   Residual, for the owner's awareness rather than action: a `.vercel.app` hostname
   is still tied to Vercel, so a future move off Vercel would break links again. A
   VAM-owned custom domain remains the portable answer whenever one is available —
   it can be added later without disturbing this hostname.

   Links already sent to mentors and mentees still point at
   `vam-os-admin-portal.vercel.app`, which belongs to the old project. Ask the old
   owner to configure that hostname to redirect to `vam-os.vercel.app` at cut-over;
   that preserves every distributed link without contacting anybody.
2. ~~**Repoint three GitHub secrets.**~~ **DONE 2026-09-08.** `VERCEL_PROJECT_ID`,
   `VERCEL_ORG_ID`, `VERCEL_TOKEN` on the `Production` environment now point at the new
   project. Verified by a `workflow_dispatch` run of `vercel-production.yml`: green
   end-to-end in 5m (typecheck → tests → `vercel build --prod` → `vercel deploy
   --prebuilt --prod`), landing a Ready Production deployment on the new project in
   12s. `vam-os.vercel.app` returns 200 from `sin1`, so the region survives the
   prebuilt pipeline. **Pushes to `main` now deploy to the new project.**
3. **Old project — needs the previous owner, and it is not merely tidy-up.**
   `vam-os-admin-portal.vercel.app` keeps serving its last build, and that build still
   holds valid Supabase Production credentials. From today it is a frozen second copy
   of the application writing to the live database, and it will drift further from
   `main` with every commit — any validation or fix added later will be absent from it
   while it remains able to write. Ask the previous owner to redirect that hostname to
   `vam-os.vercel.app` (Settings → Domains → Redirect), or delete the project. Then
   revoke the old `VERCEL_TOKEN` on their account.

---

## FINAL REPORT

```
VAM_OS_2B2_STATUS=PASS

CANONICAL_REPO=vanhoang-spec/vam-os-admin-portal
MAIN_HEAD=cc75c10b453c4cfe024a7d436166a88fceb57cb0

LIVE_ENV_COUNT=10 (13 entries)
CODE_ENV_COUNT=8
DOCUMENTED_ENV_COUNT=6

LIVE_ONLY=VAM_OS_ADMIN_PASSWORD, DATABASE_URL, VAM_OS_ALLOW_TOKENLESS_APPLICATIONS,
          VAM_OS_ENABLE_MENTEE_APPLICATION, VAM_OS_ENABLE_MENTOR_APPLICATION
CODE_ONLY=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, VAM_OS_E2E_HARNESS, NODE_ENV
DOCUMENTED_ONLY=(none)
COMMON=NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
       SUPABASE_SERVICE_ROLE_KEY, VAM_OS_APPLICATION_PILOT_TOKEN, VAM_OS_APPLY_TOKEN

PRODUCTION_DEFAULTS_PROVEN=PASS
DATABASE_URL_REQUIRED_IN_PRODUCTION=NO

APPLICATION_PILOT_TOKEN_REQUIRED=NO — proven. Production form state read 2026-09-07:
  mentee=open, mentor=open. evaluateApplyGate returns on the `open` branch before
  configuredToken() is called (lib/apply-gate.ts:98-100), and no link builder reads
  the env var. The unrecoverable write-only value is a non-issue; omit the variable.
APPLY_TOKEN_REQUIRED_IN_PRODUCTION=NO (and must be left unset — it would override the
  above if pilot intake is ever re-enabled with a fresh token)

FEATURE_FLAGS_CURRENT_PRODUCTION_BEHAVIOR=database-driven via
  public.application_form_controls; all three env flags are dead config with zero
  runtime readers; unset is the correct and current state

SUPABASE_CONTRACT=PASS
DEPLOYMENT_AUTHORITY=GITHUB_ACTIONS
DEPLOYMENT_CONTRACT=PASS

SAFE_TO_CREATE_NEW_VERCEL_PROJECT=YES

BLOCKERS=(none blocking project creation)

OWNER_DECISIONS_REQUIRED=
  1. RESOLVED 2026-09-07 — pilot-token continuity is a non-issue. Both roles are
     'open'; no token is carried over and none is generated.
  2. Confirm VAM_OS_ADMIN_PASSWORD is dropped rather than carried over.
  3. Hostname strategy before cut-over — custom domain on the new project, or a
     coordinated rename swap of vam-os-admin-portal.vercel.app. See addendum.
  4. Vercel scope for the new project: personal (vanhoang-spec) or team tcm17.

NEW_PROJECT_PROVISIONED=YES — tcm17/vam-os-admin-portal, 3 env vars, Next.js, Node
  24.x, no git integration. Serving at vam-os.vercel.app and verified equivalent to
  old production. See addendum 2.

HOSTNAME=vam-os.vercel.app (resolved; no custom domain needed for now)

CUTOVER_COMPLETE=YES, 2026-09-08. Three GitHub secrets repointed; workflow_dispatch
  run of vercel-production.yml green end-to-end; Production deployment Ready on the
  new project; vam-os.vercel.app serving 200 from sin1.

NEXT_ACTION=Previous owner: redirect vam-os-admin-portal.vercel.app to
  vam-os.vercel.app (or delete the old project), then revoke the old VERCEL_TOKEN.
  Until that happens a frozen copy of the app remains live against the production
  database. New owner: decide the Vercel plan before the Pro trial lapses, or the
  sin1 region — and the speed it buys — may silently revert.

PRODUCTION_MUTATIONS=0
SECRETS_EXPOSED=0
```

### Disclosure

One unintended local side effect: running `vercel env ls` to attempt a read-only
inventory triggered the Vercel CLI device-login flow, which was approved in the browser
and stored CLI credentials for `vanhoang-spec` on this machine. No Vercel project was
linked, read, or modified — that account cannot see the old project at all. Revoke at
vercel.com/account/tokens if unwanted.
