# Season 11 March Offline Mapping Strategy

## 1. Mentee Mapping Rules
1. **Primary (Student Code):** Match `mentee_identifier_mssv` against `people_staging.csv` -> `student_code`.
2. **Secondary (Email):** If MSSV is missing, check if `mentee_identifier_edit` is a valid email. If so, match against `people_staging.csv` -> `email`.
3. **Tertiary (Fallback Name):** Normalize `mentee_identifier_edit` or `mentee_identifier_mssv` (lowercase, remove diacritics, strip extra spaces). Match against a normalized `full_name` in `people_staging`.
4. **Validation:** The resolved `people.id` MUST exist in `mentee_profiles_staging.csv`. If it exists in `people` but not `mentee_profiles`, fail the mapping.

## 2. Mentor Mapping Rules
1. **Primary (Email):** If `mentor_identifier_name` contains an `@` symbol, match against `people_staging.csv` -> `email`.
2. **Secondary (Name):** Normalize `mentor_identifier_name` (lowercase, remove diacritics, strip spaces). Match against a normalized `full_name` in `people_staging`. 
3. **Validation:** The resolved `people.id` MUST exist in `mentor_profiles_staging.csv`.

## 3. Match ID Mapping Rules
1. Lookup in `matches_uehm_s11_staging.csv`.
2. Find row where `mentor_person_id` = mapped mentor AND `mentee_person_id` = mapped mentee.
3. If exactly one match is found, assign `mapped_match_id` = `id`.
4. If zero matches are found, leave `mapped_match_id` blank but flag the row as `missing_match`. (The SQL draft handles null match IDs gracefully as a warning).

## 4. Existing March Duplicate Detection
1. Lookup in `mentoring_recaps_march_2026_staging.csv`.
2. Compare: `meeting_date` + `mentor_person_id` + `mentee_person_id` + `recap_url`.
3. If an exact match is found, flag the source row as `duplicate_existing`.

## 5. Recap URL Fallback Rules
1. If `recap_url` (from the source CSV) is a valid HTTP/HTTPS string, use it.
2. If `recap_url` is empty but `recap_reference` exists (e.g., text like "x" or a note), generate a safe placeholder URL that preserves the reference in a query string:
   `https://system.local/missing-url?ref=${encodeURIComponent(recap_reference.slice(0, 50))}`
3. If both are empty, use: `https://system.local/missing-url`.
*Rationale:* The SQL draft requires `recap_url IS NOT NULL`. A safe, identifiable local URL prevents database constraints from failing while making it obvious to operations staff that the original link was missing.

## 6. Mapping Status Classifications
* `mapped`: Mentor and Mentee resolved, Match found, URL valid, no overlap.
* `mapped_with_warnings`: Mentor/Mentee resolved, but `match_id` missing or using a placeholder URL.
* `missing_mentor`: Could not resolve mentor to a valid profile.
* `missing_mentee`: Could not resolve mentee to a valid profile.
* `duplicate_existing`: Exact overlap with the existing 23 March rows.
* `needs_review`: Ambiguous mapping (e.g., two people with the exact same name).

## 7. Human Review Checklist
Before manually executing the SQL import draft, the operations owner must review `season11_march_ready_for_import.csv` and verify:
- [ ] **The 19 Missing Rows:** Have the 19 rows with missing mentor/mentee identifiers been manually resolved, or are we accepting that they will be dropped?
- [ ] **Placeholder URLs:** Are we comfortable with rows that lacked an HTTP link being imported with `https://system.local/missing-url`?
- [ ] **Ambiguous Names:** Were there any mentees/mentors mapped by name where multiple people shared the same name? (Confirm the correct ID was selected).
- [ ] **Total Row Count Acceptance:** If `mapped` + `mapped_with_warnings` equals ~263 rows, does Operations explicitly accept this discrepancy against the official KPI snapshot of 271?

## 8. Codex-Ready Prompt

```text
The offline mapping strategy for the Season 11 March 2026 recap import has been approved. Please write a Node.js script (e.g., `scripts/map-season11-march-offline.mjs`) to execute this strategy.

Inputs (all in `data_imports/season11/`):
- `season11_march_source_review.csv` (286 raw rows)
- `reference_exports/people_staging.csv`
- `reference_exports/mentee_profiles_staging.csv`
- `reference_exports/mentor_profiles_staging.csv`
- `reference_exports/matches_uehm_s11_staging.csv`
- `reference_exports/mentoring_recaps_march_2026_staging.csv`

Requirements:
1. Map mentees by `student_code`, then by email, then by normalized full name. Must exist in `mentee_profiles`.
2. Map mentors by email, then by normalized full name. Must exist in `mentor_profiles`.
3. Resolve `match_id` using the mentor/mentee pair against `matches_uehm_s11_staging.csv`.
4. Detect duplicates against `mentoring_recaps_march_2026_staging.csv` using (date + mentor + mentee + url).
5. Generate `final_recap_url`: use HTTP `recap_url` if valid, otherwise fallback to `https://system.local/missing-url?ref=[encoded_recap_reference]`.
6. Output `season11_march_ready_for_import.csv` with columns:
   `source_row_id`, `source_sheet`, `source_file`, `meeting_date`, `mentor_person_id`, `mentee_person_id`, `match_id`, `recap_url` (mapped to final_recap_url), `recap_note` (mapped to recap_text_excerpt), `meeting_type` (mapped to activity_type), `mapping_status`, `mapping_notes`.

Please implement the script using robust CSV parsing (e.g., handling commas inside quotes) and string normalization for names.
```
