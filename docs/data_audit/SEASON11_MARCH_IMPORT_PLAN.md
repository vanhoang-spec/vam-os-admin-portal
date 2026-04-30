# Season 11 March 2026 Import Preparation Plan

Generated: 2026-04-30

## Purpose

Prepare a staging-only March 2026 import package for review. This package does not execute the import, does not modify Supabase, does not change dashboard RPCs, and does not deploy anything.

The goal is to prepare the controlled path for importing reviewed March 2026 recap rows into the existing `mentoring_recaps` table, then recording the official March KPI snapshot in `season_monthly_kpis` with `closed = true`.

## Current State

Migration 031 has been executed successfully on staging and created:

- `data_import_batches`
- `data_quality_issues`
- `season_monthly_kpis`
- `v_mentee_monthly_tracking`
- `v_season_latest_closed_month`

Confirmed pre-import staging data for UEHM-S11 / March 2026:

| Metric | Current Supabase | Expected Excel Audit |
| --- | ---: | ---: |
| Total recap entries | 23 | 271 from `Bao cao Recap` |
| Valid recap entries | 23 | 275 from `Mentee Tracking`; 286 from `Cleaning data` |
| Distinct mentees | 15 | 224 official writers from `Bao cao Recap`; 229 from `Mentee Tracking` |

April 2026 has recap/event data and remains open. It must not drive official KPI or follow-up logic.

## Files In This Package

- Plan: `docs/data_audit/SEASON11_MARCH_IMPORT_PLAN.md`
- Review-only SQL draft: `docs/data_audit/sql/SEASON11_MARCH_2026_IMPORT_DRAFT.sql`

The SQL draft is not a migration and must not be run against production. It is intended for manual staging review and controlled execution later.

## Import Principles

- Reuse `mentoring_recaps`; do not create `recap_events`.
- Preserve legitimate multiple recap entries by the same mentee in the same month.
- Remove or flag exact duplicates only.
- Use `Bao cao Recap` as the official KPI source for the March monthly snapshot.
- Use distinct mentees, not total recap entries, for follow-up/silent logic.
- Mark March 2026 as closed in `season_monthly_kpis`.
- Keep April 2026 open and excluded from official KPI/follow-up logic.
- Record an import batch before import execution.
- Log import blockers/warnings into `data_quality_issues`.

## Required Reviewed Source Shape

Before manual staging execution, a reviewed source table or temp table must be prepared in the same staging SQL session.

Expected relation name in the SQL draft:

- `_season11_march_source`

Expected columns:

| Column | Required | Notes |
| --- | --- | --- |
| `source_row_id` | Yes | Stable row key from the cleaned source. |
| `source_sheet` | Yes | Expected `Cleaning data` for raw rows. |
| `source_file` | Yes | Workbook/file identifier. |
| `meeting_date` | Yes | Must be March 2026. |
| `mentor_person_id` | Yes | Must exist in `people` and `mentor_profiles.person_id`. |
| `mentee_person_id` | Yes | Must exist in `people` and `mentee_profiles.person_id`. |
| `match_id` | No | Strongly preferred; if present, must match mentor/mentee/season. |
| `recap_url` | Yes | Required by `mentoring_recaps`. |
| `recap_note` | No | Used in duplicate review context. |
| `meeting_type` | No | Defaults to `1on1_primary` if absent. |
| `captured_by` | No | Defaults to import batch label if absent. |
| `raw_payload` | No | JSONB original row payload for QA/debugging. |

## Mapping Validation

The draft validates:

- UEHM-S11 season exists.
- `meeting_date` is in March 2026.
- `meeting_month` resolves to `2026-03`.
- `mentor_person_id` exists in `people`.
- `mentee_person_id` exists in `people`.
- `mentor_person_id` exists in `mentor_profiles.person_id`.
- `mentee_person_id` exists in `mentee_profiles.person_id`.
- `match_id`, when supplied, points to the same season, mentor, and mentee.
- Exact duplicate candidates exist in source.
- Exact duplicate candidates already exist in `mentoring_recaps`.

Rows with blocker issues should not be inserted. Warnings should be reviewed but may not block if Operations accepts them.

## Duplicate Handling

Exact duplicate candidate signature:

- season
- meeting date
- mentor person id
- mentee person id
- recap URL

This intentionally does not deduplicate by mentee/month. Multiple distinct recap rows for the same mentee in March 2026 must be preserved for activity volume.

## KPI Snapshot

The March 2026 KPI row should use official `Bao cao Recap` values:

- `month_value = '2026-03'`
- `closed = true`
- `total_recap_entries = 271`
- `distinct_mentees_with_recap = 224`
- `total_mentees = 593`
- `pct_mentees_with_recap = 37.8`
- `source_name = 'Bao cao Recap'`
- `source_file = 'TRACKING _ SEASON 11.xlsx'`
- `closed_at = now()` at manual execution time

The import source can contain 286 raw `Cleaning data` rows and still store 271 as the official KPI benchmark. The difference must be captured as a QA note or accepted warning before dashboard rewiring.

## Validation After Manual Staging Execution

Expected validation checks:

- New `data_import_batches` row exists for March 2026.
- `data_quality_issues` contains all blockers/warnings generated during import.
- `mentoring_recaps` March row count increases from the current 23 toward the accepted imported total.
- `v_mentee_monthly_tracking` shows March distinct mentee coverage from valid rows.
- `season_monthly_kpis` contains `2026-03` with `closed = true`.
- `v_season_latest_closed_month` returns March 2026 as latest closed month and February 2026 as previous closed month if February KPI is present.
- April 2026 is not marked closed in `season_monthly_kpis`.

## Unresolved Mapping Risks

- The current package does not include the actual cleaned March source rows.
- Name/email to `person_id` matching must be completed before manual SQL execution.
- Some March source rows may not have reliable `match_id`.
- Raw `Cleaning data` count (286), `Mentee Tracking` count (275), and official `Bao cao Recap` count (271) do not fully match. The accepted reconciliation rule must be recorded before execution.
- Existing 23 March rows in Supabase may overlap with incoming rows and must be checked as exact duplicate candidates.
- If mentor/mentee IDs are null or point to non-profile people, distinct mentee/follow-up logic is not trustworthy for those rows.

## Manual Execution Readiness

Not ready for manual staging execution until:

1. A reviewed `_season11_march_source` dataset exists.
2. ID mapping has been checked and accepted.
3. Duplicate candidates have been reviewed.
4. Expected row-count reconciliation is documented.
5. The SQL draft is reviewed by a human owner.
6. Staging execution is explicitly approved.

## Next Step

Review `docs/data_audit/sql/SEASON11_MARCH_2026_IMPORT_DRAFT.sql`, prepare the source dataset, and run SELECT-only previews against staging before approving any write transaction.
