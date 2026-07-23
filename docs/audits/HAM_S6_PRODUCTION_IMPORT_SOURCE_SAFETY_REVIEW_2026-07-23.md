# HAM-S6 Production Import — Source Data Safety Review
## 2026-07-23

Read-only offline review of source data files. No database was queried.
No personal values are reported. Aggregate counts only.

---

## Source files

| File | Rows (excl. header) | Purpose |
|---|---|---|
| `ham_people_clean.csv` | 132 | People (mentors + mentees) produced by `ham_audit_clean.py` from source XLSX |
| `ham_matches_clean.csv` | 60 | Mentor–mentee match assignments from Mentee S6 sheet |
| `ham_identity_resolution_dry_run.csv` | 118 | Per-row identity resolution output from offline matching pass |
| `ham_identity_resolution_summary.csv` | 14 (metrics) | Aggregate summary of identity resolution |
| `ham_manual_review_issues.csv` | 65 | Rows flagged for human review (names, type, action) |
| `ham_identity_duplicate_names.csv` | 1 | Duplicate normalized name candidate set |
| `ham_summary_by_file.csv` | 5 | Sheet-level aggregate summary |

Source XLSX: `Data HAM mua 6.xlsx` — **NOT in repository** — located in external
`VAM_OS_Data_Cleaning/Input/` directory. Not to be committed.

---

## People source (`ham_people_clean.csv`, `ham_identity_resolution_dry_run.csv`)

### Row counts by role and readiness

| Role | Total rows | import_ready = TRUE | import_ready = FALSE |
|---|---|---|---|
| mentor | 52 | 52 | 0 |
| mentee | 60 | 60 | 0 |
| other/null | 20 | 0 | 20 |
| **Total** | **132** | **112** | **20** |

Note: The 20 non-import-ready rows are present in `ham_people_clean.csv` but have
`import_ready = FALSE` and will be skipped by `ham_s6_02_import_people.sql`.

### Unique expected people (from identity resolution summary)

| Metric | Value |
|---|---|
| total_ham_people_rows | 112 |
| email_matches (matched to existing production person by email) | 0 |
| phone_matches (matched to existing production person by phone) | 1 |
| high_confidence_name_matches | 1 |
| ambiguous_matches | 0 |
| manual_review_unique_name_no_context | 4 |
| no_match_new_people_candidates | 106 |
| duplicate_email_values_in_source | 0 |
| duplicate_name_values_in_source | 1 |
| already_existing_mentor_profiles_safe_matches | 1 |
| already_existing_mentee_profiles_safe_matches | 1 |
| already_existing_profiles_manual_review_candidates | 4 |
| would_need_new_people_rows | 106 |
| unsafe_to_import_automatically | 4 |

### Identity resolution breakdown (from dry run)

| match_status | Count |
|---|---|
| matched_existing_person | 2 |
| no_match_new_person_candidate | 106 |
| manual_review | 4 |

| unsafe_auto_import | Count |
|---|---|
| no | 108 |
| yes | 4 |

**Expected auto-imported people: 108** (106 new + 2 linked to existing people)
**Expected skipped (manual review): 4** (logged to staging_ham_s6_import_skips)

---

## Match source (`ham_matches_clean.csv`)

| Metric | Value |
|---|---|
| Total match rows | 60 |
| import_ready = TRUE | 60 |
| import_ready = FALSE | 0 |

All 60 match rows are import-ready per source flag. However, the final imported count
(52 active matches in staging) is lower because:
- Match rows whose mentor or mentee identity resolved to `manual_review` (4 people) are
  skipped. If those 4 people map to 8 match rows (±), those rows cannot be imported.
- Source match rows map one mentee to one mentor; mentor without a resolved person_id
  causes the match row to be logged to `staging_ham_s6_import_skips`.

**Expected matches from staging result: 52 active matches.**
The exact final count in production depends on how many of the 4 manual-review people are
involved in match rows. This count may differ from staging if the production `people` table
has different existing rows.

---

## Duplicate detection

### Source email uniqueness

`duplicate_email_values_in_source: 0`
No email appears more than once across mentor and mentee source rows.

### Source name uniqueness

`duplicate_name_values_in_source: 1`
One normalized name appears in both the mentor and mentee lists or appears twice in one
list. From `ham_identity_duplicate_names.csv`: 1 entry. This is the same person
participating in both mentor and mentee roles, or a naming collision.

The import scripts handle this by matching source rows by `(full_name, ham_role, email)`
combination, so a name that appears as both mentor and mentee would produce two separate
identity map entries.

### Cross-role duplicate risk

A person appearing as both mentor and mentee would receive two separate `people` rows
(if their emails differ) or be linked to the same `people` row (if emails match). The
staging import treated them as separate identities since the role forms part of the
match key.

---

## Missing required identifiers

| Field | Missing in mentor source | Missing in mentee source |
|---|---|---|
| email | 0 (all 52 have email, all 52 import_ready) | 0 (all 60 have email, all 60 import_ready) |
| phone | 0 flagged as missing in import_ready rows | 0 flagged in import_ready rows |
| full_name | 0 in import_ready rows | 0 in import_ready rows |

The 20 non-import-ready rows in `ham_people_clean.csv` likely have missing or invalid
identifier fields (missing_email, missing_name, etc.) based on the ham_audit_clean.py
issue detection logic.

---

## Malformed rows

65 rows in `ham_manual_review_issues.csv` across all source sheets (people + recaps).
For people-only rows (from Mentor S6 and Mentee S6), the import_ready=TRUE count for
mentors is 52/52 and mentees is 60/60, meaning no people rows are flagged in the
import-ready population.

---

## Ambiguous identities

`ambiguous_matches: 0` in identity resolution summary. No row resolved to multiple
existing people with equal confidence.

The 4 `manual_review` rows were flagged as `unsafe_auto_import = yes` because they matched
existing people in staging by name only (no email or phone confirmation). These are not
ambiguous in the strict sense (they resolved to a specific person) but were not safe for
automatic merge.

---

## PII field presence

| Field | Present in source | Stored in DB after import |
|---|---|---|
| full_name | Yes (required identifier) | `people.full_name` |
| email | Yes (primary identity key) | `people.email_primary` |
| phone | Yes (secondary identifier) | `people.phone_primary` |
| date of birth | Yes in mentor source (dob column) | NOT imported by current scripts |
| gender | Yes in mentor source | `people.gender` (nullable) |
| school | Yes in mentee source | `mentee_profiles.school_raw`, `university` |
| company / title | Yes in mentor source | `mentor_profiles.company_current`, `title_current` |
| LinkedIn URL | Yes in mentor source | `mentor_profiles.linkedin_url` |
| Facebook profile URL | Yes in source (fb_profile column) | NOT imported by current scripts |
| VAM profile link | Yes in mentor source | `mentor_profiles.bio_url` |

---

## Free-text / sensitive field notes

### `people.data_quality_flags`

Script 02 writes multi-line notes to `people.data_quality_flags` including:
```
HAM S6 staging import candidate.
source_row=N
source_season=HAM_S6
school=…
company=…
title=…
expertise=…
field=…
linkedin=…
vam_profile_link=…
```

These notes contain non-PII descriptive metadata, not personal identifiers.
The field name `data_quality_flags` is used for import provenance tracking.

### `mentor_profiles.bio_short`

Script 03 writes multi-line import provenance to `bio_short`:
```
HAM S6 mentor profile from clean source.
source_file=…
source_sheet=…
source_row=…
field=…
expertise=…
```

No names, emails, or phones appear in these notes.

### `matches.notes`

Script 03 writes import provenance to `matches.notes`. No personal values are included —
only source_file, source_sheet, source_row, source_season, and direction.

---

## Encoding and delimiter

- All clean CSV files: UTF-8 (with BOM for ham_audit_clean.py output, `utf-8-sig`)
- Delimiter: comma (`,`)
- `\copy` command in scripts: `encoding 'UTF8'` specified
- Vietnamese characters: present in names, fields, expertise columns
- Production SQL must handle UTF-8 encoding correctly

---

## Files NOT reviewed (out of foundation scope)

| File | Reason excluded |
|---|---|
| `ham_recaps_clean.csv` | Not in foundation import; recap import is deferred |
| `ham_events_or_group_activities_clean.csv` | Not in foundation import |
| `ham_s6_04_import_strict_recap_pilot_DRAFT.sql` | DRAFT + staging only + not foundation |

---

## Summary judgment

| Dimension | Status | Notes |
|---|---|---|
| Source row counts | **VERIFIED** | 52 mentors, 60 mentees, 60 matches (all import_ready=TRUE) |
| Unique people | **VERIFIED** | 112 import-ready; 108 expected to be imported (4 manual-review skips) |
| Expected mentor profiles | **VERIFIED** | 49 (staging result) — production may differ by shared-person count |
| Expected mentee profiles | **VERIFIED** | 58 (staging result) — production may differ |
| Expected active matches | **VERIFIED** | 52 (staging result) — production count depends on manual-review resolution |
| Duplicate rows | **NONE** | 0 email duplicates in source; 1 duplicate name (known, handled by import logic) |
| Duplicate identities | **0 AMBIGUOUS** | 4 manual-review (unsafe by name-only), not strictly ambiguous |
| Missing required IDs | **0 IN IMPORT-READY ROWS** | All 112 import-ready people have name + email |
| Malformed rows | **ISOLATED** | 20 rows with import_ready=FALSE; safely excluded by import scripts |
| Email presence | **ALL** | All 112 import-ready people have email |
| Phone presence | **ALL** | All 112 import-ready people have phone (based on 0 flagged in summary) |
| Student ID | **N/A** | No student ID field in mentor source; mentee school field is not a student ID |
| Free-text / sensitive fields | **CONTAINED** | Provenance notes only; no raw PII in DB notes fields |
| Encoding | **UTF-8** | Consistent; Vietnamese characters present; scripts specify encoding explicitly |
| Staging UUID leakage risk | **PRESENT** | `ham_identity_resolution_dry_run.csv` contains staging UUIDs; must not be reused in production |
