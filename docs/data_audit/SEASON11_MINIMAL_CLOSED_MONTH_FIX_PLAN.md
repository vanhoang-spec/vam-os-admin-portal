# Season 11 Minimal Closed-Month Fix Plan

Generated: 2026-04-30

## Scope Guardrails

- Plan only.
- Do not modify Supabase schema yet.
- Do not modify Supabase data.
- Do not create migrations yet.
- Do not change dashboard UI/code yet.
- Do not import March 2026 data.
- Do not deploy.

## 1. Current Confirmed Root Cause

The Operations dashboard RPC `public.get_operations_dashboard_data` currently derives `v_selected_month` from a `months_with_data` set built from two sources:

1. `public.mentoring_recaps.meeting_month`
2. `public.events.starts_at` converted to `YYYY-MM`

It then selects the latest available month with:

- `max(month_value)` where the month is not after the current calendar month, with fallback to `now()` or max available month.

Confirmed staging state:

- UEHM-S11 has 2 event rows in April 2026 (`2026-04`).
- Because event months are included in `months_with_data`, April becomes eligible for dashboard month selection.
- The RPC selects `2026-04` even though April 2026 is an open month.

This creates open-month bleed. April activity exists, but April is not an officially closed reporting month and must not drive official KPI cards or follow-up logic.

Why this causes false positives:

- KPI cards use the selected month as the operational month.
- Missing/silent mentee logic compares active mentees against recap presence in the selected month and prior month.
- If April is selected while March data is absent or not imported into the expected recap table, the dashboard sees very low April recap activity and treats many mentees as missing/silent.
- The result is inflated false-positive counts such as "missing latest month" and "silent 2 months" even though official follow-up should compare February 2026 and March 2026.

The correct target is not simply to ignore events. The correct target is to select the latest explicit closed reporting month from a closed-month/KPI source.

## 2. Target Architecture

Closed-month selection should be explicit, durable, and source-of-truth driven.

Recommended minimum source:

- `season_monthly_kpis` or an equivalent staging-safe table/view.

Minimum required fields:

- `season_id` or `season_code`
- `reporting_month` in `YYYY-MM`
- `closed` boolean
- official monthly KPI fields, including at least:
  - total recap entries from `Bao cao Recap`
  - distinct mentees with recap from the official tracking source
  - total mentees denominator
  - optional writer rate or percent mentees with recap
- source/audit fields if needed:
  - `source_sheet`
  - `source_workbook`
  - `source_version`
  - `import_batch_id`
  - `created_at`
  - `updated_at`

Latest closed month selection:

```sql
max(reporting_month) where closed = true for the season
```

Current Season 11 context:

- Latest closed month: `2026-03`
- Previous closed month: `2026-02`
- April 2026: open and excluded from official KPI/follow-up logic

## 3. Minimum Staging-Only Migration Proposal

This section proposes the shape of a future migration. Do not create or apply the migration yet.

### `season_monthly_kpis`

Purpose:

- Store official monthly KPI benchmark values and closed-month status.
- Provide the authoritative source for dashboard selected month.

Recommended minimum columns:

- `id`
- `season_id` or `season_code`
- `reporting_month`
- `closed`
- `total_recap_entries`
- `distinct_mentees_with_recap`
- `total_mentees`
- `writer_rate`
- `source_sheet`
- `source_notes`
- `import_batch_id`
- `created_at`
- `updated_at`

Recommended constraints/indexes:

- Unique season + reporting month.
- Index on season + closed + reporting month.
- Check `reporting_month` format as `YYYY-MM`.

### `data_import_batches`

Purpose:

- Record each staging import attempt before any recap/KPI data import.
- Support auditability and rollback planning.

Recommended minimum columns:

- `id`
- `season_id` or `season_code`
- `source_workbook`
- `source_sheet`
- `source_version`
- `status`
- `started_at`
- `completed_at`
- `created_by`
- `notes`
- `metadata`

### `data_quality_issues`

Purpose:

- Store import and KPI QA warnings/blocks.
- Distinguish acceptable discrepancies from blockers.

Recommended minimum columns:

- `id`
- `import_batch_id`
- `season_id` or `season_code`
- `reporting_month`
- `severity`
- `issue_type`
- `source_sheet`
- `entity_type`
- `entity_id`
- `message`
- `expected_value`
- `actual_value`
- `status`
- `created_at`
- `resolved_at`
- `metadata`

### Optional View: Latest Closed Month

Purpose:

- Centralize "latest closed month" selection for RPCs and dashboard data flows.

Suggested output:

- `season_id` or `season_code`
- `latest_closed_month`
- `previous_closed_month`

### Optional View: Mentee Follow-Up Based On Closed Months

Purpose:

- Centralize distinct mentee silent/follow-up logic.
- Use latest closed month and previous closed month from the closed-month source.

Suggested logic:

- Active mentees from active Season 11 matches.
- Latest closed month recap presence using distinct `mentee_person_id`.
- Previous closed month recap presence using distinct `mentee_person_id`.
- Missing latest closed month = no recap in latest closed month.
- Silent 2 months = no recap in latest closed month and no recap in previous closed month.

## 4. RPC Correction Strategy

Later, after the staging closed-month/KPI object exists, `get_operations_dashboard_data` should change as follows:

- Stop selecting `v_selected_month` from max month with recap/event data.
- Select latest closed reporting month from the KPI/closed-month source.
- Select `v_previous_month` from the previous closed reporting month for the same season, not from calendar/current-month inference.
- Use `v_selected_month = 2026-03` and `v_previous_month = 2026-02` for current Season 11 staging.
- Compute official closed-month health and follow-up counts from recap presence in those closed months.
- Keep event data available for operational charts and event/training sections, but do not allow event months to determine official closed-month health.
- Keep open-month April data separate from official KPI logic.

Events can still appear in charts or operational context. They must not determine the official dashboard month or follow-up window.

## 5. Dashboard Behavior After Fix

Expected behavior after closed-month architecture and RPC correction:

- Top KPI cards use latest closed month only.
- Current Season 11 top KPI cards use March 2026.
- Follow-up uses February 2026 + March 2026.
- April 2026 is excluded from official KPI and official follow-up counts.
- Open month can be shown separately as "thang dang mo" or "open month" context.
- Monthly charts can show April separately if useful, but April should have a visual warning or open-month label.
- Open April chart activity must not feed official missing/silent mentee counts.

## 6. Safety Gates

Required gates before implementation:

- SELECT-only inspection completed and recorded.
- Migration reviewed before execution.
- Staging only.
- No production changes.
- No Supabase data import until import batch and QA structures exist.
- No March 2026 import until target schema and QA process are approved.
- No dashboard rewiring until the closed-month table/view exists.
- No production deployment until staging validates:
  - March 2026 is selected as latest closed month.
  - February 2026 is selected as previous closed month.
  - April 2026 is excluded from official KPI/follow-up logic.
  - Multiple legitimate recaps per mentee/month are preserved.
  - Data quality blockers are visible and resolved or explicitly accepted.

## 7. Codex Next Implementation Prompt

Use this prompt for the next task. It intentionally asks for a staging-only migration artifact but does not apply it.

```text
Codex, prepare the staging-only Supabase migration for the Season 11 closed-month architecture.

Inputs:
- docs/data_audit/SEASON11_SCHEMA_GAP_ANALYSIS.md
- docs/data_audit/SEASON11_SUPABASE_READONLY_INSPECTION.md
- docs/data_audit/SEASON11_MINIMAL_CLOSED_MONTH_FIX_PLAN.md
- all Season 11 audit/spec docs

Important:
- Do not apply the migration.
- Do not modify Supabase schema or data.
- Do not import March data.
- Do not generate data import SQL or CSV import files.
- Do not change dashboard UI/code.
- Do not deploy.

Create a staging-only migration SQL artifact that proposes:
- season_monthly_kpis or equivalent closed-month KPI source
- data_import_batches
- data_quality_issues
- optional latest closed month view
- optional mentee follow-up view based on latest closed month and previous closed month

Requirements:
- Support latest closed month = 2026-03 for UEHM-S11.
- Support previous closed month = 2026-02.
- Exclude April 2026 from official KPI/follow-up logic.
- Preserve multiple legitimate recap entries per mentee/month.
- Include constraints/indexes that prevent duplicate KPI rows per season/month.
- Keep all objects staging-safe or clearly documented as staging-only.
- Include rollback notes in comments only.

Validation:
- Run npm.cmd run typecheck
- Run npm.cmd run lint

Report back:
- files created/changed
- migration objects proposed
- any assumptions
- why the migration is staging-safe
```

## Recommendation

Staging migration is now the next technical step, but only as a generated/reviewed artifact. It should not be applied until the migration is reviewed against the safety gates above.
