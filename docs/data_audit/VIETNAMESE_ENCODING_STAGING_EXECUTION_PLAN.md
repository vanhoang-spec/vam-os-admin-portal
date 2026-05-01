# Staging Execution Plan: Vietnamese Encoding Remediation

## Objective
Safely resolve Vietnamese mojibake/encoding issues in the staging database for `people` names and related profile fields prior to production rollout.

## Core Principles
1. **No direct Supabase production writes:** This plan is strictly for staging.
2. **No blind string replacement:** We do not use `REPLACE()` functions or heuristic decoding algorithms in SQL, as they can cause irreversible data damage.
3. **Explicit mapping only:** Corrections are made by joining a reviewed CSV mapping of exact UUIDs/emails to their clean UTF-8 values.
4. **Safe execution:** The remediation script operates within a transaction block that explicitly defaults to `ROLLBACK`.

## Execution Workflow

### Phase 1: Diagnostics & Export
1. Run `docs/data_audit/sql/VIETNAMESE_ENCODING_DIAGNOSTIC_READONLY.sql` against the staging database to quantify and sample the affected rows.
2. Export the sample query results as a CSV.

### Phase 2: Human Review & Preparation
1. Using the clean UTF-8 source data (e.g., the original Google Sheet/Excel used for import), map the `corrupted_value` to the `corrected_value`.
2. Populate `data_imports/season11/encoding_review_template.csv` with the mappings.
   - Set `review_status` to `approved` for rows that are confirmed accurate.
   - Use `entity_type` (e.g., `people`, `mentor_profiles_company`, `mentee_profiles_major`) to distinguish target tables and fields.

### Phase 3: Staging Remediation Execution
1. Import the reviewed `encoding_review_template.csv` into a temporary staging table named `temp_encoding_fixes`.
2. Execute `docs/data_audit/sql/VIETNAMESE_ENCODING_REMEDIATION_DRAFT.sql` on the staging database.
3. The script will perform a dry-run:
   - Output pre-correction counts.
   - Apply corrections using an `INNER JOIN` on the provided `record_id`.
   - Output post-correction counts and samples.
   - `ROLLBACK` the changes.
4. If the dry-run output is visually verified and exactly correct, change `ROLLBACK;` to `COMMIT;` and re-run to persist changes to the staging database.

### Phase 4: Staging Validation
1. Verify the Admin Portal Operations page `/operations` and Home Dashboard `/` on staging. Ensure names render flawlessly in UTF-8 without mojibake.
2. If successful, this exact reviewed CSV and SQL script becomes the artifact package used for the production rollout.
