# Team Matching V2 Summary

## Source

- Workbook: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\UEH Mentoring TEAM INFORMATION SS11.xlsx`
- Sheets: `Coreteam`, `ST mùa 11`
- Matching against current Supabase `people`, `mentor_profiles`, and `mentee_profiles`.
- No rows were imported and no app/schema changes were made.

## Matching rules

Coreteam rows are treated as `coreteam` and expected to map to existing mentors. Support Team rows are treated as `support_team` and expected to map to existing mentees.

Priority used:

1. Exact email match against `people.email_primary` or profile email fields if present.
2. Normalized phone match against `people.phone_primary`/`people.phone_raw` or profile phone fields if present.
3. Normalized full-name match against `people.full_name`.
4. Normalized full-name match against profile name fields if present.
5. Manual review.

## Results

| Group | Total source rows | High-confidence matches | Manual review |
|---|---:|---:|---:|
| Coreteam | 33 | 13 | 20 |
| Support team | 14 | 13 | 1 |

## Match method counts

- `email`: 24
- `manual_review`: 21
- `people_name`: 2

## Key fields missing

- Rows without parseable email: 5
- Rows without normalized phone: 21
- Rows without normalized name: 13

Notes:

- `mentor_profiles` and `mentee_profiles` currently do not expose dedicated email/phone/name columns in the current app schema, so most profile-level matching falls back to `people` identity fields.
- Coreteam has section/email-list rows such as HAM/FAM/BKM. These are preserved in the row-level audit, but only confident matches are included in `DRAFT_REVIEWED_team_assignments.csv`.
- If a matched person already has both mentor and mentee profiles, the report marks `existing_role=mentor+mentee`.

## Recommended next step

1. Review `team_manual_review_v2.csv`, especially Coreteam rows with missing names or email-list section rows.
2. Confirm whether Coreteam rows matched by normalized name are correct before importing any operational role assignments.
3. If accepted, use `DRAFT_REVIEWED_team_assignments.csv` as the reviewed input for a future additive team assignment migration/import.
4. Do not create duplicate people records; unresolved rows should remain manual review until confirmed.
