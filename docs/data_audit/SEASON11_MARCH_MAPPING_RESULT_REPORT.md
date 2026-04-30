# Season 11 March Mapping Result Report

Generated: 2026-04-30

## Scope

This report was generated offline from local CSV exports only. No Supabase writes, imports, dashboard RPC changes, deploys, commits, or pushes were performed.

Reference source: `mvp`

Reference directory used: `data_imports\season11\reference_exports_production`

## March Source And Duplicate-Check Assumptions

- March 2026 was present in the raw tracking workbook and was extracted from `Cleaning data` into `season11_march_source_review.csv`.
- `season11_march_source_review.csv` is the March recap source of truth for this offline mapping pass.
- The MVP `mentoring_recaps_march_2026_mvp.csv` file is used only for duplicate-existing detection.
- An empty MVP March existing-recap export is expected when MVP/Supabase has not imported UEHM-S11 March recaps yet.
- Empty existing-recap export handled safely: `yes`.

## Reference Inputs

| Metric | Count |
| --- | ---: |
| People reference rows | 1331 |
| Mentee profile reference rows | 654 |
| Mentor profile reference rows | 448 |
| UEHM-S11 match reference rows | 637 |
| Existing March recap reference rows | 0 |

## Reference Quality Checks

| Metric | Count |
| --- | ---: |
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

## Mapping Summary

| Metric | Count |
| --- | ---: |
| Total rows | 286 |
| Mapped rows | 20 |
| Mapped with warnings rows | 205 |
| Missing mentor rows | 46 |
| Missing mentee rows | 22 |
| Missing match rows | 11 |
| Duplicate existing candidates | 0 |
| Needs review rows | 4 |
| Placeholder URL rows | 257 |
| Ready for import rows | 225 |
| Blocker rows before manual staging import | 61 |

Mapping success rate: 78.67%

## Status Counts

| Metric | Count |
| --- | ---: |
| mapped | 20 |
| mapped_with_warnings | 205 |
| missing_match | 11 |
| missing_mentee | 4 |
| missing_mentor | 42 |
| needs_review | 4 |

## Blockers Before Manual Staging Import

- 46 rows still need mentor_person_id resolution.
- 22 rows still need mentee_person_id resolution.
- 11 mapped mentor/mentee rows have no UEHM-S11 match_id.
- 4 rows are ambiguous or structurally incomplete.
- 257 rows use system.local placeholder recap URLs and require approval.

## Human Review Requirement

Human review is required before execution. The ready-for-import CSV is an offline review artifact only; it must not be imported until Operations approves mapped IDs, placeholder URLs, duplicate handling, and any missing match decisions.
