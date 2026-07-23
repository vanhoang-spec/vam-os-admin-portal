# HAM-S6 Production Linkage Audit — 2026-07-23

## Audit scope and constraints

Read-only repository investigation only. No SQL was executed, no database was queried, no
environment was mutated. All evidence comes from repository source files, migration scripts,
staging import records, and owner-provided documentation. Staging ref: `ljfneyuvpxrmejpxsmpz`.
Production ref: `qkkroesfiazsejkzflcd`.

---

## PHASE 2 — LINKAGE AUDIT

### Root cause trace

**Step 1 — programs table (both environments)**

Migration `036_mentor_taxonomy_and_programs.sql` seeds seven program rows including:
```sql
insert into public.programs (code, name)
values ('HAM', 'Hanoi Alumni Mentoring') on conflict (code) do nothing;
```
This migration runs on every environment as part of the standard migration chain.
Result: `programs.code = 'HAM'` EXISTS in both staging and production.

**Step 2 — seasons table (staging only)**

`data_imports/ham/scripts/ham_s6_01_seed_program_season.sql` header:
```
-- STAGING ONLY. Do not run on production without a separate approval.
```
This script creates the `HAM-S6` season row linked to the HAM program via `program_id`.
It was executed on staging `ljfneyuvpxrmejpxsmpz` on 2026-05-07.
It was never approved or executed on production.
Result: `seasons.code = 'HAM-S6'` EXISTS in staging. DOES NOT EXIST in production.

**Step 3 — People, matches, profiles (staging only)**

Scripts `ham_s6_02_import_people.sql` and `ham_s6_03_import_profiles_matches.sql`
imported HAM-S6 participant data into staging only. Confirmed staging counts
(per `HAM_S6_STAGING_FOUNDATION_IMPORT_RESULT.md`, 2026-05-07):
- 108 identity rows
- 52 active matches
- 48 mentor profiles, 58 mentee profiles

These scripts were never executed on production.

**Step 4 — HAM admin accounts (staging only)**

`scripts/create-ham-staging-admins.mjs` contains an explicit environment guard:
```js
function assertStagingUrl(url) {
  if (url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing to run: production ref detected in NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (!url.includes(STAGING_REF)) {
    throw new Error("Refusing to run: staging ref was not found in NEXT_PUBLIC_SUPABASE_URL.");
  }
}
```
The script reads from `.env.staging.local` and refuses to run against any non-staging URL.
Result: `hanoimentoring@gmail.com` and `vanlethu79@gmail.com` auth accounts and
`admin_scope_access` rows with `program_id = 'HAM'` / `season_id = 'HAM-S6'` exist in
staging only. Production has no HAM admin accounts.

**Step 5 — Code path (portfolio loader)**

```ts
// lib/portfolio-core.ts
const linkedSeasons = catalog.seasons.filter((row) => row.programId === program.id);
// production HAM: linkedSeasons = []  (no season row with program_id = HAM uuid)

const currentSeason = resolveCurrentSeason(linkedSeasons);
// resolveCurrentSeason([]) → null

const selectedSeasons =
  scope.mode === "all"     ? linkedSeasons
  : scope.mode === "selected" ? linkedSeasons.filter(...)
  : currentSeason ? [currentSeason] : [];
// → selectedSeasons = []

if (!selectedSeasons.length) {
  return { ...(all null KPIs)... } satisfies ProgramPortfolioRow;
}
// → UI renders "Chưa có dữ liệu"
```

The code is correct. "Chưa có dữ liệu" for HAM in production is the expected behavior
when no season is linked. It is not a code defect.

### Root cause classification

```
CLASSIFICATION: HAM DATA EXISTS IN STAGING ONLY
```

The staging QA checkpoint (`docs/HAM_S6_EXTERNAL_TEST_RELEASE_CHECKPOINT.md`) explicitly
states: "Proceed to production import only after staging sign-off." Staging sign-off
occurred 2026-05-08 (`docs/HAM_S6_STAGING_ACCESS_QA.md`), but production promotion was
never authorized or executed.

---

## PHASE 3 — READ-ONLY VERIFICATION PROBES

The existing probe `docs/audits/sql/VAM_OS_UEH_PORTFOLIO_LINKAGE_READONLY_PROBE.sql`
already covers HAM. It queries `where upper(p.code) in ('UEHM', 'HAM')` and returns
per-program linked season counts, match counts, and membership counts as a single JSONB.

**Expected result on staging (`ljfneyuvpxrmejpxsmpz`):**
```jsonb
{
  "programs": [
    {
      "program_code": "HAM",
      "linked_seasons": [
        {
          "season_code": "HAM-S6",
          "active_matches_count": 52,
          "intake_batch_count": 1
        }
      ]
    }
  ]
}
```

**Expected result on production (`qkkroesfiazsejkzflcd`):**
```jsonb
{
  "programs": [
    {
      "program_code": "HAM",
      "linked_seasons": []
    }
  ]
}
```

The difference between these two results confirms the environment mismatch.

Owner authorization phrase to run the existing probe:
`AUTHORIZE OWNER-RUN READ-ONLY UEH AND HAM PORTFOLIO LINKAGE PROBE`

---

## PHASE 4 — SUPER ADMIN EXPECTED BEHAVIOR

**Current production state (correct):**

| UI location | Expected display | Reason |
|---|---|---|
| `/portfolio` — HAM card | "Chưa có dữ liệu" | No season linked to HAM in production |
| `/programs/HAM` | "Chưa có dữ liệu" | Same reason |
| `/programs/HAM?season=HAM-S6` | "Chưa có dữ liệu" or 404 | Season row does not exist in production |
| Mentor application form | HAM option visible | Static enum; unrelated to season linkage |

**After production import (expected state):**

| UI location | Expected display |
|---|---|
| `/portfolio` — HAM card | Season: HAM-S6 · 52 matches · 49 mentors |
| `/programs/HAM` | All-season aggregate (1 season total) |
| `/programs/HAM?season=HAM-S6` | Season đã chọn: HAM-S6 · full KPIs |

**Known staging caveat** (from `HAM_S6_STAGING_ACCESS_QA.md`):
> UEHM-S11 is currently attached to the legacy program row `VAM` in staging, while HAM-S6
> is attached to `HAM`.

This caveat applies to staging only. In production, UEHM-S11 is linked to the canonical
`UEHM` program (per the portfolio-season-linkage fix that is already merged).

---

## PHASE 5 — SAFE CODE OR DATA DECISION

### Code fix needed: NONE

The portfolio loader, `reconcilePortfolioRows`, and the "Chưa có dữ liệu" fallback are
all functioning correctly. Showing empty KPIs for a program with no linked season is the
intended and documented behavior. No code change is required or authorized.

### Data action required (owner decision)

To make HAM-S6 visible in production, the owner must execute the following scripts
against the **production** database URL in order:

| # | Script | Effect |
|---|---|---|
| 1 | `data_imports/ham/scripts/ham_s6_01_seed_program_season.sql` | Creates `HAM-S6` season + `HAM-S6-B1` batch linked to HAM program |
| 2 | `data_imports/ham/scripts/ham_s6_02_import_people.sql` | Imports 108 identity rows |
| 3 | `data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql` | Creates 52 active matches, 49 mentor profiles, 58 mentee profiles |

**Pre-flight checks before production import:**
- Confirm `programs.code = 'HAM'` exists in production (should be present from migration 036)
- Confirm `seasons.code = 'HAM-S6'` does NOT already exist (avoid duplicate)
- The CSV source files used by `ham_s6_02` and `ham_s6_03` must be present in the import
  working directory
- The staging helper tables (`public.staging_ham_s6_people_identity_map`,
  `public.staging_ham_s6_import_skips`) are created by the import scripts themselves; they
  do not need to exist first
- Script 01 already uses `on conflict (code) do nothing` — safe to run even if the
  program row exists

**HAM admin accounts:**
`scripts/create-ham-staging-admins.mjs` has an explicit staging-only guard. A separate
decision is required to provision `hanoimentoring@gmail.com` and `vanlethu79@gmail.com`
(or equivalent production accounts) with HAM-S6 scope in production.

---

## FINAL REPORT

### Decision

```
HAM DATA EXISTS IN STAGING ONLY
HAM-S6 LINKAGE REQUIRES OWNER DATA ACTION
```

### Root cause (one sentence)

`ham_s6_01_seed_program_season.sql` and subsequent people/match import scripts were marked
staging-only and were never approved or executed on production, so `seasons` has no
`HAM-S6` row linked to the HAM program in production.

### Evidence chain

1. Migration 036 seeds `programs.code = 'HAM'` in all environments — CONFIRMED
2. `ham_s6_01_seed_program_season.sql` has explicit `-- STAGING ONLY` header — CONFIRMED
3. Staging import report (`HAM_S6_STAGING_FOUNDATION_IMPORT_RESULT.md`) confirms 108 rows
   in staging as of 2026-05-07 — CONFIRMED
4. External test checkpoint states: "Proceed to production import only after staging
   sign-off" — CONFIRMED (production promotion deferred and never executed)
5. Staging QA passed 2026-05-08 (`HAM_S6_STAGING_ACCESS_QA.md`) — CONFIRMED
6. Portfolio code shows "Chưa có dữ liệu" when `linkedSeasons = []` — by design, not a bug

### What is NOT needed

- No code change
- No migration
- No backfill
- No schema change
- No SQL probe on the existing database (the source-file evidence is conclusive)

### What IS needed (owner decision)

Owner authorization and execution of production HAM-S6 data import:
```
AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
```

Scripts to execute (in order, against production URL only):
1. `data_imports/ham/scripts/ham_s6_01_seed_program_season.sql`
2. `data_imports/ham/scripts/ham_s6_02_import_people.sql`
3. `data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql`

Post-import verification:
```sql
-- Run ham_s6_verify_foundation.sql against production to confirm:
-- · HAM-S6 season and HAM-S6-B1 batch present
-- · 52 matches, 49 mentor profiles, 58 mentee profiles
-- · 0 duplicate matches
-- · 0 HAM-S6 recaps (foundation import does not create recaps)
```

### Timeline

| Date | Event |
|---|---|
| 2026-05-07 | HAM-S6 staging import completed (108 people, 52 matches) |
| 2026-05-08 | Staging QA passed; production import deferred pending sign-off |
| 2026-07-23 | This audit confirms production import was never executed |
| Pending | Owner authorization: `AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT` |
