# Season 11 March Mapping Review Plan

Generated: 2026-04-30

## Purpose

Prepare a human-review mapping workflow for the March 2026 source rows before any staging import. This plan and CSV template do not write to Supabase, do not execute the March import, do not rewrite dashboard RPCs, and do not deploy anything.

Inputs:

- `data_imports/season11/season11_march_source_review.csv`
- `docs/data_audit/SEASON11_MARCH_SOURCE_PREP_REPORT.md`
- Local repo schema/type knowledge
- Staging schema created by migration 031

Outputs:

- `data_imports/season11/season11_march_mapping_review.csv`
- `scripts/prepare-season11-march-mapping-review.mjs`

## Current Source Prep Summary

| Metric | Count |
| --- | ---: |
| March source rows | 286 |
| Ready-for-mapping rows | 263 |
| Duplicate candidate rows | 0 |
| Missing mentor identifier rows | 19 |
| Missing mentee identifier rows | 19 |

Many rows have `recap_reference` but not an HTTP `recap_url`; this must be reviewed before import because `mentoring_recaps.recap_url` is required.

## Mapping Template Columns

The review CSV includes:

- `source_row_id`
- `source_row_number`
- `meeting_date`
- `meeting_month`
- `activity_type`
- `mentee_raw_identifier_mssv`
- `mentee_raw_identifier_edit`
- `mentor_raw_identifier_name`
- `recap_reference`
- `recap_url`
- `proposed_mentee_person_id`
- `proposed_mentor_person_id`
- `proposed_match_id`
- `mapping_status`
- `review_note`
- `approved_for_import`

Allowed `mapping_status` values:

- `mapped`
- `missing_mentor`
- `missing_mentee`
- `missing_match`
- `duplicate_candidate`
- `needs_review`

The generated template leaves proposed IDs blank because local data is insufficient to map Supabase IDs safely.

## Local Mapping Feasibility

Full mapping cannot be completed locally from the current repo artifacts alone.

Reason:

- The source CSV contains mentor raw names and mentee code/MSSV-like identifiers.
- The repo does not currently contain a staging export of `people`, `mentor_profiles`, `mentee_profiles`, or `matches`.
- Supabase IDs must come from staging using SELECT-only exports before a reliable mapping can be proposed.

The local workflow can still:

- Preserve all 286 source rows for review.
- Carry forward source identifiers and recap references.
- Pre-classify rows with missing raw mentor/mentee identifiers.
- Add blank proposed ID fields for human/Supabase-assisted mapping.
- Set `approved_for_import = false` by default.

## Required Supabase SELECT-Only Exports

Export these from staging as CSV before attempting automated or human-assisted ID mapping:

### People

```sql
select
  id,
  full_name,
  email_primary,
  phone_primary,
  source_sheets,
  data_quality_flags
from public.people
order by full_name nulls last, email_primary nulls last;
```

### Mentee Profiles

```sql
select
  id,
  person_id,
  mentee_code,
  mssv,
  school_code,
  school_raw,
  major,
  class_cohort
from public.mentee_profiles
order by mentee_code nulls last, mssv nulls last;
```

### Mentor Profiles

```sql
select
  id,
  person_id,
  mentor_code,
  company_current,
  title_current,
  industry,
  function_area
from public.mentor_profiles
order by mentor_code nulls last;
```

### Season 11 Matches

```sql
select
  m.id,
  m.season_id,
  s.code as season_code,
  m.status,
  m.match_type,
  m.mentor_person_id,
  mentor.full_name as mentor_name,
  m.mentee_person_id,
  mentee.full_name as mentee_name
from public.matches m
join public.seasons s on s.id = m.season_id
left join public.people mentor on mentor.id = m.mentor_person_id
left join public.people mentee on mentee.id = m.mentee_person_id
where s.code = 'UEHM-S11'
order by m.status, mentor.full_name nulls last, mentee.full_name nulls last;
```

### Existing March Recaps

```sql
select
  mr.id,
  mr.season_id,
  s.code as season_code,
  mr.match_id,
  mr.mentor_person_id,
  mentor.full_name as mentor_name,
  mr.mentee_person_id,
  mentee.full_name as mentee_name,
  mr.meeting_date,
  mr.meeting_month,
  mr.recap_url,
  mr.status
from public.mentoring_recaps mr
join public.seasons s on s.id = mr.season_id
left join public.people mentor on mentor.id = mr.mentor_person_id
left join public.people mentee on mentee.id = mr.mentee_person_id
where s.code = 'UEHM-S11'
  and mr.meeting_month = '2026-03'
order by mr.meeting_date, mentor.full_name nulls last, mentee.full_name nulls last;
```

## Review Rules

### Missing Mentor/Mentee Identifiers

The 19 missing mentor identifier rows and 19 missing mentee identifier rows should block those specific rows from import until resolved.

They should not necessarily block all other March rows if:

- unresolved rows are excluded from import,
- unresolved rows are logged to `data_quality_issues`,
- the accepted discrepancy is documented,
- and the imported subset is approved by Operations.

### Rows Without HTTP `recap_url`

Rows without HTTP `recap_url` but with `recap_reference` require human review.

Options:

- locate the real URL from Facebook/group source before import,
- use a stable internal placeholder/reference only if Operations accepts it,
- or exclude the row and log a QA issue.

Because `mentoring_recaps.recap_url` is required, no row should be imported with a blank URL.

### Unresolved Rows And QA

Import can proceed with unresolved rows only if unresolved rows are excluded from `mentoring_recaps` insert and logged to `data_quality_issues`.

Follow-up metrics must use distinct mapped `mentee_person_id`. Rows without mapped mentee IDs cannot safely contribute to follow-up/silent logic.

### Match Mapping

If mentor and mentee map successfully but no active Season 11 match is found, use `mapping_status = missing_match`.

Those rows may still be importable with `match_id = null` only if Operations accepts unmatched recaps and they are logged/reviewed as QA warnings.

## Human Review Workflow

1. Export the SELECT-only staging CSVs listed above.
2. Fill or script proposed `mentee_person_id` from mentee code/MSSV/profile exports.
3. Fill or script proposed `mentor_person_id` from mentor name/profile exports.
4. Fill proposed `match_id` when an active UEHM-S11 match connects the mapped mentor and mentee.
5. Mark `mapping_status = mapped` only when mentor, mentee, required recap reference/URL, and import decision are accepted.
6. Keep `approved_for_import = false` until a human reviewer approves the row.
7. Exclude or QA-log unresolved rows during the later import draft execution.

## Recommended Next Step

Run the SELECT-only exports from staging, save them under `data_imports/season11/reference_exports/`, then either manually fill `season11_march_mapping_review.csv` or extend the local mapping script to propose IDs from those exports.
