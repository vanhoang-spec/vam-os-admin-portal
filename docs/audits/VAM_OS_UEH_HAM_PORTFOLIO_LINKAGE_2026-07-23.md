# VAM OS UEH and HAM Portfolio Linkage Verification — 2026-07-23

## Safety and evidence boundary

This audit used Git history, repository source/tests, Vercel deployment metadata/build logs, and owner-provided visual results. It did not query either database, run SQL, expose row-level business data, or mutate production/staging. Therefore the live per-season counts remain unknown until the owner runs the supplied aggregate-only probe.

## Deployment verification

- Git `main` is merge commit `263b521` (“Merge pull request #16…”).
- `git merge-base --is-ancestor d64b652 main` passed. `d64b652` is the direct parent of the merge commit.
- Vercel deployment `dpl_4wniiutg7oANnKKRamY17QH6WoqL` is `READY`, targets production, and owns the production/main aliases.
- Its build log states: branch `main`, commit `263b521`; build began 2026-07-23 00:28:04Z and completed successfully.
- `/portfolio` and `/programs/[programCode]` are dynamic server-rendered routes. The owner-observed disappearance of the pre-fix 637 result is behavioral evidence of the deployed fix. Stale deployment or a static page cache does not explain the current screenshots.

## Trace of 14 applications

The repeated 14 is caused by a remaining program-workspace code defect:

1. `app/programs/[programCode]/page.tsx` correctly parsed `?season=UEHM-S11` and `resolveAuthorizedProgramContext` resolved its season UUID.
2. The page passed that context to `getProgramWorkspaceSummary`.
3. `getProgramWorkspaceSummary` discarded `context.selectedSeasonId` and called `loadAggregateRows` with only the program ID.
4. `reconcilePortfolioRows` then selected the current season. With both S11 and S12 marked `running`, deterministic numeric ordering selected S12.
5. Consequently the no-season (“Tất cả season”), explicit S11, and portfolio current-season views all used the S12 KPI reconciliation path. The equality does not establish that S11 contains 14 applications.

There is no memoization or application-level server cache in this path. The loader reads through the Supabase service client on each dynamic render. Batch selection is not a portfolio KPI scope; absence of a batch must not remove the season filter.

### Truth table before the follow-up fix

| Route | Selected program | Selected season | Expected filter | Actual filter |
|---|---|---|---|---|
| `/portfolio` | all cards / UEHM row | current UEHM-S12 | resolved S12 UUID only | S12 during in-memory reconciliation; source query may fetch broader rows |
| `/programs/UEHM` | UEHM | none (“Tất cả season”) | all season UUIDs linked to UEHM | current resolver chose S12 only |
| `/programs/UEHM?season=UEHM-S11` | UEHM | S11 | resolved S11 UUID only | selected UUID discarded; current resolver chose S12 |
| `/programs/UEHM?season=UEHM-S12` | UEHM | S12 | resolved S12 UUID only | selected UUID discarded; current resolver chose S12 |

### Truth table after the follow-up fix

| Route | Selected program | Selected season | Expected filter | Actual filter |
|---|---|---|---|---|
| `/portfolio` | all cards / UEHM row | current UEHM-S12 | resolved S12 UUID only | current S12 reconciliation only |
| `/programs/UEHM` | UEHM | none (“Tất cả season”) | all season UUIDs linked to UEHM | deliberate aggregate over all linked UEHM season IDs |
| `/programs/UEHM?season=UEHM-S11` | UEHM | S11 | resolved S11 UUID only | explicit S11 UUID query scope and reconciliation |
| `/programs/UEHM?season=UEHM-S12` | UEHM | S12 | resolved S12 UUID only | explicit S12 UUID query scope and reconciliation |

## UEH linkage assessment

Owner evidence confirms two linked seasons, UEHM-S11 and UEHM-S12, both with status `running`. It does not prove the distribution of the 14 applications, nor whether historical matches/events/memberships have either season ID. Repository history explicitly notes that historical lifecycle membership backfill was incomplete. The owner-run probe is required to distinguish correct zeroes from incomplete season/person linkage.

The two simultaneous `running` statuses are ambiguous governance data. The current-season resolver deterministically chooses the higher season number (S12), but the owner should confirm which season is operationally current. The code no longer falls from S12 to S11.

## HAM linkage assessment

Owner evidence proves canonical program `HAM` exists and no season is linked/listed in the production UI. Repository staging evidence for HAM-S6 is not production evidence. A HAM-coded season could be absent, linked to another program, or absent from production entirely.

Current classification: **INSUFFICIENT EVIDENCE**. The probe separately reports linked HAM seasons and HAM-coded seasons whose `program_id` does not match HAM.

## UI state

The follow-up fix makes scope visible:

- Portfolio: current season remains the only KPI scope shown beside the resolved season code.
- Program workspace with `?season=`: “Season đã chọn: …”.
- Program workspace without `?season=`: “Tất cả season (tổng hợp có chủ đích)”.
- Program with no linked season: `Chưa có dữ liệu`.
- Active matches with insufficient participant identity linkage: `Chưa liên kết đủ dữ liệu`.
- Query failure remains null/warning, distinct from a successful zero.

## Owner read-only verification runbook

Probe: `docs/audits/sql/VAM_OS_UEH_PORTFOLIO_LINKAGE_READONLY_PROBE.sql`.

1. Review that the file is one `WITH ... SELECT`, contains no write/DDL verbs, and returns one JSONB value.
2. Open the Supabase SQL Editor for the intended production project and independently verify the project reference.
3. Paste the file unchanged and run once.
4. Save only the single aggregate JSONB result in the approved secure review channel; do not add credentials or row-level exports.
5. Compare S11, S12, HAM-linked, mislinked-season, and null-season totals. Do not backfill from this result.

Exact authorization phrase:

`AUTHORIZE OWNER-RUN READ-ONLY UEH AND HAM PORTFOLIO LINKAGE PROBE`

## Decision

**INSUFFICIENT EVIDENCE**

The repeated 14 code defect is proven and fixed, but the owner-run aggregate result is still required to classify UEH historical linkage and HAM production season state.
