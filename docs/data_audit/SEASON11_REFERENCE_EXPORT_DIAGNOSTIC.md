# Season 11 Reference Export Diagnostic

Generated: 2026-04-30

## Executive Finding

Important correction: March 2026 was **not** missing from the raw tracking workbook. It was present in raw tracking / `Cleaning data`, and source prep extracted 286 March rows into `data_imports/season11/season11_march_source_review.csv`.

The gap is in VAM OS MVP / Supabase `mentoring_recaps`: UEHM-S11 has no `2026-03` rows there because March has not been imported yet.

Therefore:

- `season11_march_source_review.csv` is the March recap source of truth for offline mapping.
- MVP reference exports should be used for people/profile/match ID mapping.
- `mentoring_recaps_march_2026_mvp.csv` is duplicate-check-only.
- An empty MVP March existing-recap export is acceptable and should produce `duplicate_existing = 0`.

No Supabase writes, import execution, dashboard RPC changes, deploys, commits, pushes, or sensitive export edits were performed.

## Current MVP Mapping Result

The mapper was run with:

```powershell
node .\scripts\map-season11-march-offline.mjs --reference-source=mvp
```

Result:

| Metric | Count |
| --- | ---: |
| Total March source rows | 286 |
| Mapped rows | 20 |
| Mapped with warnings rows | 205 |
| Missing mentor status rows | 42 |
| Missing mentee status rows | 4 |
| Missing match rows | 11 |
| Duplicate existing candidates | 0 |
| Placeholder URL rows | 257 |
| Ready for import rows | 225 |
| Mapping success rate | 78.67% |

The report also counts unresolved-review blockers by review note:

| Blocker | Count |
| --- | ---: |
| Rows still needing mentor resolution | 46 |
| Rows still needing mentee resolution | 22 |
| Rows with mapped mentor/mentee but no UEHM-S11 match ID | 11 |
| Ambiguous or structurally incomplete rows | 4 |

Human review remains required before any import execution.

## Corrected Data Lineage

| Layer | March 2026 status | Role in workflow |
| --- | --- | --- |
| Raw tracking workbook / `Cleaning data` | March rows present | Original March recap source |
| `season11_march_source_review.csv` | 286 extracted March rows | Offline mapping source of truth |
| `Báo cáo Recap` official KPI | March KPI = 271 | Official benchmark for review/reconciliation |
| `Mentee Tracking` | March = 275 | Operational comparison point |
| MVP `mentoring_recaps` | No UEHM-S11 `2026-03` rows | Not a March source; only existing-duplicate reference |
| `mentoring_recaps_march_2026_mvp.csv` | May be empty | Duplicate-check-only input |

The missing March issue is an import coverage gap in `mentoring_recaps`, not an absence in the source workbook.

## MVP Reference Export Use

Use MVP exports for ID mapping:

- `people_mvp.csv`
- `mentee_profiles_mvp.csv`
- `mentor_profiles_mvp.csv`
- `matches_uehm_s11_mvp.csv`

Use the MVP March recap export only for duplicate detection:

- `mentoring_recaps_march_2026_mvp.csv`

If `mentoring_recaps_march_2026_mvp.csv` has only headers or no rows, the mapper should continue and set duplicate-existing candidates to zero.

## Evidence That MVP References Are Real Mapping Data

The MVP reference set has real scale and source overlap:

| Check | Count |
| --- | ---: |
| People reference rows | 1331 |
| Mentee profile reference rows | 654 |
| Mentor profile reference rows | 448 |
| UEHM-S11 match reference rows | 637 |
| Existing March recap reference rows | 0 |
| Unique source mentee code keys | 220 |
| Reference profile code keys | 1254 |
| Source-to-profile code matches | 218 |
| Unique source mentor name keys | 184 |
| Reference people name keys | 1292 |
| Source-to-people mentor name matches | 175 |
| Synthetic-looking people names | 0 |
| Synthetic/test email rows | 0 |
| Synthetic-looking mentee codes | 0 |
| Synthetic-looking mentor codes | 0 |

This is materially different from the earlier validation/test exports and is suitable as reference data for offline ID mapping.

## Why Empty MVP March Recaps Are Acceptable

The MVP `mentoring_recaps` table is not the source for March recap content in this workflow. It is only used to identify rows that already exist so the import plan can avoid duplicates.

Because MVP currently has no UEHM-S11 `2026-03` recaps:

- duplicate-existing detection has no existing March rows to compare against;
- `duplicate_existing` should be zero unless a future export includes March rows;
- the empty file should not block mapping;
- the 286 extracted source rows remain the source of truth for March import review.

## Go / No-Go

**Offline mapping: Go for human review.**

The MVP-backed mapping output now contains 225 ready-for-import rows, but they require human review because many rows use placeholder URLs and some rows have missing matches or unresolved IDs.

**Manual March import execution: No-Go until review approval.**

Do not execute import until Operations reviews:

- placeholder URL acceptance;
- missing mentor and mentee rows;
- missing match rows;
- `needs_review` rows;
- reconciliation against the official March KPI of 271 and Mentee Tracking value of 275.

**Dashboard RPC rewrite: blocked until March import / closed KPI is valid.**

The dashboard closed-month rewrite should wait until March import decisions and closed KPI governance are reviewed and approved.

## Next Steps

1. Keep using `season11_march_source_review.csv` as the March recap source of truth.
2. Keep using MVP people/profiles/matches as reference data for ID mapping.
3. Treat the MVP March existing recap export as duplicate-check-only.
4. Rerun mapping after any reference export refresh:

```powershell
node .\scripts\map-season11-march-offline.mjs --reference-source=mvp
```

5. Review `data_imports/season11/season11_march_ready_for_import.csv`.
6. Resolve or explicitly approve blocker categories before any staging import execution.
