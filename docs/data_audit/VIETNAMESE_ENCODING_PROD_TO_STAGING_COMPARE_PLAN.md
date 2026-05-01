# Production to Staging Comparison & Patch Plan
**Objective:** Resolve the Vietnamese mojibake/encoding issue on the Staging environment (`ljfneyuvpxrmejpxsmpz`) by using the clean MVP/Production environment (`qkkroesfiazsejkzflcd`) as the source of truth for `people.full_name`.

## Context
The staging dashboard governance logic has passed QA, but names are corrupted (e.g., `HoĂ ng BĂch Thá»§y`). The production database does not exhibit this corruption. This plan outlines a safe strategy to extract the clean names from production and carefully patch them into staging without executing any blind string replacements.

## Phase 1: Production Export (Read-Only)
Run `docs/data_audit/sql/VIETNAMESE_ENCODING_PROD_EXPORT_READONLY.sql` against the **Production** database.
- Export `id`, `full_name`, `email_primary`, and `phone_primary` from the `people` table.
- Save this export as `data_imports/season11/encoding_prod_to_staging_patch_template.csv`.
- Visually verify the CSV contains clean UTF-8 Vietnamese names.

## Phase 2: Staging Diagnostic Comparison (Read-Only)
Run `docs/data_audit/sql/VIETNAMESE_ENCODING_STAGING_COMPARE_READONLY.sql` against the **Staging** database.
- This will require loading the production CSV into a temporary table `temp_prod_people`.
- The diagnostic script will verify whether Production `UUIDs` match Staging `UUIDs`.
- If UUIDs match reliably, `id` will be used as the primary key.
- If UUIDs do not match, `email_primary` will be used as the stable matching key.
- The script will also quantify exact matches vs ambiguous rows. Ambiguous rows (e.g., duplicate emails or missing matches) will be logged but skipped during patching.

## Phase 3: Staging Patch Execution (Draft)
Run `docs/data_audit/sql/VIETNAMESE_ENCODING_STAGING_PATCH_DRAFT.sql` against the **Staging** database.
- The script is strictly transaction-wrapped and defaults to `ROLLBACK;`.
- It will join the staging `people` table with `temp_prod_people` on `email_primary` (or `id` if confirmed).
- Staging `full_name` will be updated from Production `full_name` ONLY where a stable, 1-to-1 match exists.
- The script outputs "Before" and "After" metrics and samples for visual confirmation.
- Once the dry-run output is verified by a human, change `ROLLBACK;` to `COMMIT;` to finalize the patch.

## Phase 4: Follow-up
- Phase 1 focuses exclusively on display names (`people.full_name`) as they directly unblock the dashboard and Operations UI.
- Phase 2 (Future Task) will address profile fields (`company_current`, `title_current`, `major`) if mojibake is detected there.

## Safety Rules Followed
1. No direct writes to Production.
2. No blind string replacements or heuristic conversions.
3. No app logic changes.
4. Default to `ROLLBACK`.
