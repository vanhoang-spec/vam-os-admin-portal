# HAM-S6 Production Import — Asset Inventory
## 2026-07-23

Read-only repository audit. No database was queried. No file was executed.
No personal values are printed in this document.

---

## File inventory

### Import scripts

| File | Purpose | Env assumption | Reads | Writes | Sensitive data | Production-safe |
|---|---|---|---|---|---|---|
| `data_imports/ham/scripts/ham_s6_01_seed_program_season.sql` | Insert HAM program (no-op if exists), HAM-S6 season, HAM-S6-B1 batch | STAGING ONLY header | `public.programs`, `public.seasons`, `public.intake_batches` | `public.programs`, `public.seasons`, `public.intake_batches` | No | **REQUIRES PRODUCTION WRAPPER** |
| `data_imports/ham/scripts/ham_s6_02_import_people.sql` | Create staging identity map + import HAM people | STAGING ONLY header | `ham_people_clean.csv`, `ham_identity_resolution_dry_run.csv`, `public.people` | `public.staging_ham_s6_people_identity_map`, `public.staging_ham_s6_import_skips`, `public.people` | Yes (full_name, email, phone in staging tables) | **REQUIRES HARDENING** |
| `data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql` | Create mentor/mentee profiles + matches | STAGING ONLY header | `ham_people_clean.csv`, `ham_matches_clean.csv`, `staging_ham_s6_people_identity_map`, `public.programs`, `public.seasons`, `public.intake_batches`, `public.people` | `public.mentor_profiles`, `public.mentee_profiles`, `public.matches`, `public.staging_ham_s6_import_skips` | No (skips table stores only codes and reasons) | **REQUIRES HARDENING** |
| `data_imports/ham/scripts/ham_s6_04_import_strict_recap_pilot_DRAFT.sql` | DRAFT-only recap import (29 strict recaps) | STAGING ONLY, DRAFT ONLY header; not in foundation scope | `ham_recaps_clean.csv`, `staging_ham_s6_people_identity_map`, `staging_ham_s6_recap_pilot_audit` | `public.mentoring_recaps`, `public.staging_ham_s6_recap_pilot_audit` | No | **STAGING ONLY** |
| `data_imports/ham/scripts/ham_s6_verify_foundation.sql` | Post-import verification; read-only | Implicitly staging but logic is environment-neutral | `public.programs`, `public.seasons`, `public.intake_batches`, `staging_ham_s6_people_identity_map`, `staging_ham_s6_import_skips`, `public.mentor_profiles`, `public.mentee_profiles`, `public.matches`, `public.mentoring_recaps` | None | No | **REQUIRES PRODUCTION WRAPPER** (staging helper table references must be replaced) |
| `scripts/create-ham-staging-admins.mjs` | Create/update auth + admin_users + admin_scope_access for 2 HAM admins | Staging-only guard: `assertStagingUrl()` throws if production ref detected | `.env.staging.local`, `public.admin_users`, `public.admin_scope_access` | Supabase Auth, `public.admin_users`, `public.admin_scope_access` | Yes (passwords in env vars) | **STAGING ONLY** — explicit production refusal guard |

### Source data files (CSV)

| File | Purpose | Env assumption | Rows | Sensitive data | Production-safe |
|---|---|---|---|---|---|
| `data_imports/ham/ham_people_clean.csv` | Cleaned identity source (52 mentors + 60 mentees + 20 non-ready) | Environment-neutral | 132 | Yes (full_name, email, phone, dob, fb_profile, linkedin) | **REQUIRES PRODUCTION WRAPPER** |
| `data_imports/ham/ham_matches_clean.csv` | Cleaned match source (mentee→mentor assignments) | Environment-neutral | 60 | Yes (names, emails, phones) | **REQUIRES PRODUCTION WRAPPER** |
| `data_imports/ham/ham_identity_resolution_dry_run.csv` | Dry-run identity resolution output; consumed by script 02 | Staging-specific outputs (matched_person_ids may be staging UUIDs) | 118 | Yes (names, emails, phones, staging UUIDs in matched_person_ids) | **REQUIRES HARDENING** — matched_person_ids are staging UUIDs, must not be re-used in production |
| `data_imports/ham/ham_identity_resolution_summary.csv` | Aggregate metrics only | Environment-neutral | 14 metrics | No | SAFE AS-IS (read-only reference) |
| `data_imports/ham/ham_manual_review_issues.csv` | 65 flagged rows for manual review | Staging artifact | 65 | Yes (names, emails, raw issue descriptions) | **STAGING ONLY** |
| `data_imports/ham/ham_identity_duplicate_names.csv` | Duplicate name candidates | Staging artifact | 1 entry (1 normalized name) | Partial (names) | **STAGING ONLY** |
| `data_imports/ham/ham_recaps_clean.csv` | Recap import source (not in foundation scope) | Staging artifact | 653 | Yes (names, post links, text snippets) | **STAGING ONLY** — not in foundation import scope |
| `data_imports/ham/ham_events_or_group_activities_clean.csv` | Group activity source (not in foundation scope) | Staging artifact | 230 | Yes (names, links) | **STAGING ONLY** — not in foundation import scope |
| `data_imports/ham/ham_summary_by_file.csv` | Aggregate summary of all sheets | Environment-neutral | 5 rows | No | SAFE AS-IS (aggregate only) |

### Inspection and audit scripts

| File | Purpose | Env assumption | Reads | Writes | Sensitive data | Production-safe |
|---|---|---|---|---|---|---|
| `data_imports/ham/scripts/ham_audit_clean.py` | Reads source XLSX, produces all clean CSVs | External XLSX path hardcoded (`VAM_OS_Data_Cleaning/Input/`) | `Data HAM mua 6.xlsx` (external, not in repo) | All CSV files above | Yes (processes raw source XLSX with PII) | **DO NOT USE IN PRODUCTION** — source XLSX is not in repo, script is a data preparation tool only |
| `data_imports/ham/scripts/ham_inspect.py` | Inspect source XLSX structure and sample rows | External XLSX path hardcoded | `Data HAM mua 6.xlsx` (external) | None | Yes (prints sample rows) | **DO NOT USE IN PRODUCTION** |

---

## Classification summary

| Classification | Files |
|---|---|
| **SAFE AS-IS** | `ham_identity_resolution_summary.csv`, `ham_summary_by_file.csv` |
| **REQUIRES PRODUCTION WRAPPER** | `ham_s6_01_seed_program_season.sql`, `ham_s6_verify_foundation.sql`, `ham_people_clean.csv`, `ham_matches_clean.csv` |
| **REQUIRES HARDENING** | `ham_s6_02_import_people.sql`, `ham_s6_03_import_profiles_matches.sql`, `ham_identity_resolution_dry_run.csv` |
| **STAGING ONLY** | `ham_s6_04_import_strict_recap_pilot_DRAFT.sql`, `create-ham-staging-admins.mjs`, `ham_manual_review_issues.csv`, `ham_identity_duplicate_names.csv`, `ham_recaps_clean.csv`, `ham_events_or_group_activities_clean.csv` |
| **DO NOT USE IN PRODUCTION** | `ham_audit_clean.py`, `ham_inspect.py` |

---

## Critical production-incompatibility notes

### `\copy` command (scripts 02 and 03)

Both `ham_s6_02_import_people.sql` and `ham_s6_03_import_profiles_matches.sql` use `\copy`
(backslash-copy), which is a psql CLI meta-command. It is not valid SQL and cannot be
executed in:
- Supabase SQL Editor
- Any SQL client that does not embed psql
- Any migration runner

The production import path must replace `\copy` with an alternative data-loading mechanism
(e.g., `COPY table FROM STDIN`, encoded inline VALUES, or a psql-executed script with a
production database URL).

### Staging persistent helper tables

`ham_s6_02_import_people.sql` creates `public.staging_ham_s6_people_identity_map` and
`public.staging_ham_s6_import_skips`. These tables:
- Store PII: full_name, email, phone
- Are named with the `staging_` prefix, implying staging-only lifetime
- Are consumed by script 03, which reads `staging_ham_s6_people_identity_map` to resolve
  person IDs for profile and match creation
- Will NOT exist in production unless the production import creates them

The production import path must either:
- Create production-equivalent identity resolution without PII-in-table, or
- Create equivalent helper tables in production and clean them up post-import

### Staging UUIDs in `ham_identity_resolution_dry_run.csv`

The `matched_person_ids` column contains pipe-delimited UUIDs of matched people in
**staging**. These UUIDs are not valid in production. Production identity resolution must
re-run the matching logic against live production data, not re-use these UUIDs.

### `notify pgrst, 'reload schema'`

This PostgREST-specific command appears in scripts 01, 02, and 03. In production:
- If using Supabase, this may or may not be processed depending on the connection mode
- It is safe to include (no-op if not PostgREST) but should be documented as advisory

### No production project ref guard

None of the staging scripts verify that the database they are connected to is the
production project (`qkkroesfiazsejkzflcd`). The production modules must include an
explicit owner confirmation step and cannot auto-detect the ref from within SQL.

---

## External source file (not in repository)

`Data HAM mua 6.xlsx` (source XLSX) is located at:
`C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\Ha Noi Alumni Mentoring*\`

This file is NOT tracked in the repository. It contains raw PII and must not be committed.
The clean CSV files derived from it ARE tracked and are the authoritative import sources.
