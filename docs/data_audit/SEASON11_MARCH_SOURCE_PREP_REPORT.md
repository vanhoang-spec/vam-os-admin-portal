# Season 11 March Source Prep Report

Generated: 2026-04-30T10:43:34.457Z

## Scope Guardrails

- Local workbook extraction only.
- No Supabase writes.
- No March import execution.
- No dashboard RPC rewrite.
- No deployment.

## Source

- Workbook: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\TRACKING _ SEASON 11.xlsx`
- Sheet: `Cleaning data`
- Target month: `2026-03`
- Review CSV: `data_imports/season11/season11_march_source_review.csv`

## Summary

| Metric | Count |
| --- |--- |
| March source rows extracted | 286 |
| Ready for mapping | 263 |
| Rows with recap_url detected | 29 |
| Rows with recap reference text | 191 |
| Duplicate candidate rows | 0 |
| Duplicate candidate groups | 0 |
| Missing mentor identifier rows | 19 |
| Missing mentee identifier rows | 19 |

## Activity Type Breakdown

| Activity type | Rows |
| --- |--- |
| cross_mentoring | 15 |
| mentoring | 203 |
| other | 8 |
| training | 60 |

## Duplicate Candidate Rule

Exact duplicate candidates are flagged by normalized meeting date, mentor name, mentee identifier, recap reference/URL, and recap text. This preserves legitimate multiple recaps in the same month when the recap content/reference differs.

## Mapping Notes

- `mentor_identifier_name` is extracted from `Cleaning data` column `MENTOR`.
- `mentee_identifier_mssv` is extracted from `Cleaning data` column `TACH MSSV`.
- `mentee_identifier_edit` is extracted from `Cleaning data` column `EDIT`.
- `recap_reference` is extracted from `Cleaning data` column `LINK`; many rows contain poster/reference text rather than an HTTP URL.
- `recap_url` is populated only when an HTTP/HTTPS/www URL is found in the recap reference or recap text.

## Human Review Checklist

- Confirm whether rows without HTTP `recap_url` can use `recap_reference` or another source URL before import.
- Map mentor names to `people.id` and `mentor_profiles.person_id`.
- Map mentee MSSV/code/name identifiers to `people.id` and `mentee_profiles.person_id`.
- Review duplicate candidate rows manually; remove exact duplicates only.
- Preserve distinct multiple recap rows per mentee/month.
- Confirm accepted reconciliation between `Bao cao Recap` 271, `Mentee Tracking` 275, and `Cleaning data` 286.

## Readiness

The source CSV is ready for human review, not import execution.
