# Team Matching V3 Summary

## Source and scope

- Workbook: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\UEH Mentoring TEAM INFORMATION SS11.xlsx`
- Sheets: `Coreteam`, `ST mùa 11`
- V3 applies a stricter Coreteam filter: only rows that appear to identify actual UEH Mentoring coreteam people are considered for matching.
- Coreteam/support team still map to existing `people`; no duplicate people are created.
- No import, schema change, or app code change was performed.

## Coreteam filter

Excluded Coreteam rows are written to `coreteam_excluded_rows_v3.csv` with one of the requested exclusion reasons.

### Exclusion breakdown

- `duplicate_or_email_list`: 13
- `insufficient_evidence`: 1
- `missing_identity`: 3
- `not_ueh_mentoring_coreteam`: 1
- `section_header`: 3

## Matching results

| Metric | Count |
|---|---:|
| Raw Coreteam rows | 35 |
| Coreteam rows excluded | 21 |
| Coreteam rows considered valid UEH Mentoring coreteam | 14 |
| Coreteam high-confidence matched | 12 |
| Coreteam manual review | 2 |
| Support team total | 14 |
| Support team high-confidence matched | 13 |
| Support team manual review | 1 |

## Support team functional breakdown

- `communication_media`: 3
- `design`: 4
- `event`: 4
- `other`: 3

## Support team role-note breakdown

- `member`: 14

## V3 compared with V2

- V2 Coreteam: 13/33 high-confidence (39.4%), with 20 manual review rows.
- V3 Coreteam: 12/14 high-confidence (85.7%), with 2 manual review rows after excluding non-person/non-UEH rows.
- V2 manual review rows excluded in V3 as non-person/non-UEH/insufficient rows: 15.

The Coreteam match rate improves because V3 removes section headers, email-list-only rows, and rows without enough UEH Mentoring coreteam evidence from the denominator while preserving real candidate rows for manual review.

## Recommended import scope

Use only `DRAFT_REVIEWED_team_assignments_v3.csv` as the candidate import source for a future operational team assignment import. It contains high-confidence matches only and uses existing VAM OS person/mentor/mentee data as authoritative identity fields.

Before any import:

1. Review Coreteam manual-review rows in `team_manual_review_v3.csv`.
2. Confirm whether any excluded Coreteam rows are actually UEH Mentoring coreteam people with missing identity fields.
3. Confirm Support Team functional-team mapping and role notes.
4. Import only into `operational_team_assignments`; do not create new people.
