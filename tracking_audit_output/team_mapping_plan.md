# Team Mapping Plan

## Business Rule

Coreteam members are also mentors in VAM OS. Support team members are also mentees in VAM OS. Do not create duplicate `people` records from this workbook.

## Workbook Interpretation

- `Coreteam`: core/admin team contact roster. Match these people to existing VAM OS people, preferably mentor profiles.
- `ST m?a 11`: support team roster with department/class/MSSV/email/Facebook fields. Match these people to existing VAM OS people, preferably mentee profiles.

## Matching Results

- Coreteam rows matched to existing people: 13
- Support team rows matched to existing people: 13
- Team rows needing manual review: 21
- Supabase fetch notes: none

See `team_people_match_report.csv` for row-level matching.

## Operational Role Recommendation

For MVP, do not create new person rows and do not alter current mentor/mentee identity. Use operational attribution fields such as `captured_by`, `admin_notes`, or temporary spreadsheet owner columns when importing activity rows.

For a later schema phase, create a dedicated table such as `team_assignments` or `operational_roles`:

- `id`
- `season_id`
- `person_id`
- `operational_role`: `ops_lead`, `recap_steward`, `event_steward`, `data_quality_reviewer`, `support_team_member`
- `team_name`
- `assigned_scope`
- `status`
- `notes`

## Alignment With Claude SOP Blueprint

Claude's Phase 2 SOP roles can map naturally from this workbook:

- Ops Lead: assign from Coreteam.
- Recap Steward: assign from Coreteam or support team members responsible for weekly Facebook sweep every Monday.
- Event Steward: assign owners for Mentee Orientation, Kickoff, and T?ng k?t.
- Data Quality Reviewer: assign reviewers for unresolved recap rows and person matching.
- Support Team Member: map from `ST m?a 11` after matching to existing mentee people.

The workbook can help assign owners for the 48-hour capture rule and monthly report deadline, but those assignments should be stored as operational roles later, not as duplicate people.

## Before Importing Anything

1. Review all `manual_needed` rows in `team_people_match_report.csv`.
2. Confirm whether each coreteam member exists as a mentor and each support team member exists as a mentee.
3. Decide the initial operational role list and owners.
4. Only then design a future migration for operational roles.
