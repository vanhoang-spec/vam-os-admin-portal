# Season 11 March Import Decision

Generated: 2026-04-30

## Decision

Proceed with a **staging-only** March 2026 import package using the reviewed mapped output.

This is not a production rollout. It does not rewrite dashboard RPCs and does not execute automatically.

## Source Artifacts

| Artifact | Purpose | Rows |
| --- | --- | ---: |
| `data_imports/season11/season11_march_ready_for_import.csv` | Full mapped review output | 286 |
| `data_imports/season11/season11_march_import_approved_rows.csv` | Approved/import-eligible rows for staging import draft | 236 |
| `data_imports/season11/season11_march_import_excluded_qa_rows.csv` | Excluded rows to log to `data_quality_issues` | 50 |
| `docs/data_audit/sql/SEASON11_MARCH_2026_IMPORT_DRAFT.sql` | Review-only SQL transaction template | - |

## Import Eligibility Policy

Rows are import-eligible when:

- `approved_for_import = true`; or
- `mapping_status = missing_match`, with valid `mentor_person_id` and `mentee_person_id`, imported with `match_id = null`.

Rows are excluded from this staging import when:

- `mapping_status = missing_mentor`;
- `mapping_status = missing_mentee`;
- `mapping_status = duplicate_existing`;
- `mapping_status = needs_review`.

Rows with placeholder recap URLs may be imported in staging, but they must be logged to `data_quality_issues`.

## Current Row Counts

| Category | Rows |
| --- | ---: |
| Total mapped source rows | 286 |
| Original ready-for-import rows (`approved_for_import=true`) | 225 |
| Additional import-eligible `missing_match` rows | 11 |
| Approved/import-eligible rows | 236 |
| Excluded QA rows | 50 |
| Duplicate existing rows | 0 |
| Placeholder URL rows in full mapped output | 257 |

Approved/import-eligible status breakdown:

| Mapping status | Rows |
| --- | ---: |
| `mapped` | 20 |
| `mapped_with_warnings` | 205 |
| `missing_match` | 11 |

Excluded QA status breakdown:

| Mapping status | Rows |
| --- | ---: |
| `missing_mentor` | 42 |
| `missing_mentee` | 4 |
| `needs_review` | 4 |

## QA Logging Policy

The SQL draft logs:

- all excluded rows as `block` issues in `data_quality_issues`;
- imported `missing_match` rows as `warning` issues;
- imported placeholder URL rows as `info` issues;
- defensive exact duplicate skips as `warning` issues if any appear at execution time.

## Official KPI Snapshot

The official March KPI snapshot remains:

| KPI | Value |
| --- | ---: |
| `total_recap_entries` | 271 |
| `distinct_mentees_with_recap` | 224 |
| `total_mentees` | 593 |
| `pct_mentees_with_recap` | 37.8% |

The raw imported row count will not exactly match the official KPI snapshot. This discrepancy is accepted for staging and must remain documented in `season_monthly_kpis.notes` and the import batch QA trail.

## Scope Boundaries

The staging import package must:

- create a `data_import_batches` row;
- insert only approved/import-eligible rows into `mentoring_recaps`;
- log excluded and warning rows to `data_quality_issues`;
- upsert the official March KPI snapshot to `season_monthly_kpis` with `closed = true`;
- keep March as the official latest closed month;
- avoid touching April;
- avoid dashboard RPC rewrites.

## Manual Review Status

The SQL draft is ready for manual staging review, not automatic execution.

Before execution, the reviewer must:

1. Load `season11_march_import_approved_rows.csv` into `_season11_march_import_approved`.
2. Load `season11_march_import_excluded_qa_rows.csv` into `_season11_march_import_excluded`.
3. Run the SQL draft inside a manual transaction in staging.
4. Inspect the summary result sets before `COMMIT`.
5. Roll back if inserted row counts, QA issue counts, or KPI values differ from the approved decision.
