# Season 11 March Human Review Checklist

Generated: 2026-04-30

## Scope

This checklist supports offline human review of `data_imports/season11/season11_march_ready_for_import.csv`. It does not execute import, write to Supabase, change dashboard RPCs, deploy, or touch sensitive reference exports.

## Review Files

| File | Purpose | Rows |
| --- | --- | ---: |
| `data_imports/season11/review/march_ready_rows.csv` | Rows currently marked `approved_for_import=true` by the offline mapper | 225 |
| `data_imports/season11/review/march_missing_mentor_rows.csv` | Rows blocked by unresolved mentor mapping | 42 |
| `data_imports/season11/review/march_missing_mentee_rows.csv` | Rows blocked by unresolved mentee mapping | 4 |
| `data_imports/season11/review/march_missing_match_rows.csv` | Rows with mapped people but no UEHM-S11 match ID | 11 |
| `data_imports/season11/review/march_placeholder_url_rows.csv` | Rows using generated `https://system.local/missing-url...` recap URLs | 257 |

## Counts By Mapping Status

| Mapping status | Rows | Review class |
| --- | ---: | --- |
| `mapped` | 20 | Ready, no automated warning |
| `mapped_with_warnings` | 205 | Warning review required |
| `missing_mentor` | 42 | Blocker |
| `missing_mentee` | 4 | Blocker |
| `missing_match` | 11 | Blocker unless Operations approves null `match_id` handling |
| `needs_review` | 4 | Blocker |
| `duplicate_existing` | 0 | Blocker if present |

Total rows: 286. Current ready-for-import rows: 225.

## Blockers

Rows are blockers when they cannot be imported without additional resolution or explicit Operations approval:

- `missing_mentor`: resolve `mentor_person_id` before import.
- `missing_mentee`: resolve `mentee_person_id` before import.
- `missing_match`: confirm whether the recap may be imported with blank `match_id`, or resolve the UEHM-S11 match.
- `needs_review`: inspect `mapping_notes` and `review_note` before import.
- `duplicate_existing`: none currently; if present later, exclude or resolve before import.

Do not mark blocker rows `approved_for_import=true` until the blocking issue is resolved and documented.

## Warnings

Rows are warnings when core IDs are mapped but human approval is still needed:

- `mapped_with_warnings`: usually generated because a placeholder URL was used.
- `march_placeholder_url_rows.csv`: 257 rows use `https://system.local/missing-url...`.
- Placeholder URLs are acceptable only if Operations approves importing a stable placeholder instead of a real recap URL.

## Recommended Approval Workflow

1. Review `march_ready_rows.csv` first. Confirm mapped `mentor_person_id`, `mentee_person_id`, `match_id`, meeting date, meeting type, and recap note look reasonable.
2. Review `march_placeholder_url_rows.csv`. Decide whether each placeholder URL is acceptable, should be replaced with a real URL, or should block import.
3. Resolve `march_missing_mentor_rows.csv` by finding the correct mentor or excluding/logging the row.
4. Resolve `march_missing_mentee_rows.csv` by finding the correct mentee or excluding/logging the row.
5. Review `march_missing_match_rows.csv`. Either resolve the match ID or explicitly approve blank `match_id` handling.
6. Inspect any `needs_review` rows in the master CSV.
7. Reconcile the reviewed import set against the official KPI snapshot before any staging import execution.

## How To Mark `approved_for_import`

Use the master file `data_imports/season11/season11_march_ready_for_import.csv` as the decision file.

- Keep `approved_for_import=true` only for rows approved for the next import draft.
- Set `approved_for_import=false` for rows that should be excluded, unresolved, or deferred.
- If a blocker row is manually resolved, fill the missing ID field, update `mapping_status` if appropriate, add a concise `review_note`, and only then set `approved_for_import=true`.
- If a placeholder URL is rejected, replace it with a real HTTP/HTTPS recap URL or set `approved_for_import=false`.

## Official KPI Snapshot

Keep this March KPI snapshot visible during review:

| Metric | Value |
| --- | ---: |
| Official March total recaps | 271 |
| Official distinct mentee writers | 224 |
| Total mentees | 593 |
| Official percentage | 37.8% |

The source extraction has 286 March rows, while the official KPI says 271 total recaps. Any approved import set must document how duplicate-like rows, non-recap activity rows, unresolved rows, and placeholder URL decisions reconcile to the official KPI.

## Go / No-Go

Human review is ready to begin.

Import execution remains **No-Go** until the review owner approves the final row set, blocker handling, placeholder URL handling, and KPI reconciliation.
