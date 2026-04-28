# Combined Phase 2 Source Audit

## Files Audited

- Tracking workbook: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\TRACKING _ SEASON 11.xlsx`
- Coreteam/support team workbook: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\UEH Mentoring TEAM INFORMATION SS11.xlsx`

The exact desktop paths provided in the request were not present. Matching files were found and audited under `VAM_OS_Data_Cleaning/Input`.

## Workbook Summary

- Tracking workbook sheets: 12
- Team workbook sheets: 2

## Reliable Source Data

Tracking workbook:

- Reliable source candidate: `Raw data` for Facebook recap content and embedded recap URLs.
- Helper source: `Cleaning data` for extracted codes/type flags, but URL preservation is inconsistent.
- Roster/helper source: `DATA T?NG`, `Mentee Tracking`, `Mentor Tracking` for matching/context and monthly totals.
- Summary/control: `Overview`, `B?o c?o Recap`.

Team workbook:

- `Coreteam` for operational owner/core team roster.
- `ST m?a 11` for support team roster.

## Key Counts

- Total recap-like rows found: 6397
- Likely importable mentoring recap rows after review: 748
- Likely event/training rows: 1224
- Recap rows needing manual review: 5649
- Recap rows missing URL: 2717
- Recap rows missing mentee code: 298
- Recap rows with ambiguous mentor: 5122
- Coreteam rows matched: 13
- Support team rows matched: 13
- Team rows needing manual review: 21

## Duplicate Person Rule

Do not create duplicate people records from either workbook. Coreteam should map to existing mentors and support team should map to existing mentees. If a member is unmatched, mark manual review rather than inserting a new person automatically.

## Can We Proceed To Import CSVs?

Not directly from Excel. We can proceed to create reviewed import CSV drafts, but only after manual review of unresolved rows and confirmation of the Season 11 code/event scope.

Recommended path:

1. Use `tracking_raw_recap_audit_sample.csv` to validate extraction quality.
2. Use `manual_review_needed.csv` to resolve missing URL/code/mentor and unmatched team members.
3. Generate clean `mentoring_recaps` import CSV for rows that are clearly one mentor-mentee meeting recap.
4. Treat training/event recaps separately and import only Phase 2 scoped events: Mentee Orientation, Kickoff, T?ng k?t.
5. Run `activity_import_runner` with `--dry-run` before any real import.

## Output Files

- `tracking_workbook_inventory.md`
- `team_workbook_inventory.md`
- `tracking_import_mapping_plan.md`
- `team_mapping_plan.md`
- `team_people_match_report.csv`
- `tracking_raw_recap_audit_sample.csv`
- `team_member_audit_sample.csv`
- `manual_review_needed.csv`
