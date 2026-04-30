# Season 11 Schema Gap Analysis

Generated: 2026-04-30

## Scope Guardrails

- Read-only schema/code/documentation analysis only.
- No Supabase SQL was executed.
- No Supabase schema/data was modified.
- No stash was popped or dropped.
- No migrations, import SQL, CSV import files, UI/dashboard changes, dashboard logic changes, or deployments were created.

## Files Inspected

- `scripts/audit-season11-tracking.mjs`
- `docs/data_audit/SEASON11_TRACKING_AUDIT.md`
- `docs/data_audit/SEASON11_IMPLEMENTATION_SPEC.md`
- `docs/data_audit/SEASON11_DASHBOARD_SPEC.md`
- `docs/data_audit/SEASON11_PRE_SCHEMA_REVIEW_PACK.md`
- `docs/data_audit/SEASON11_SUPABASE_STAGING_PLAYBOOK.md`
- `docs/data_audit/SEASON11_STAGING_DASHBOARD_GAP_REVIEW.md`
- `supabase_migrations/`
- `lib/types.ts`
- `lib/data.ts`
- `app/page.tsx`
- `app/operations/page.tsx`
- `app/operations/intelligence/page.tsx`
- `app/operations/tasks/page.tsx`
- `app/actions/workflow.ts`
- `app/data-issues/page.tsx`
- `app/recaps/[id]/edit/page.tsx`
- `app/recaps/[id]/edit/correction-form.tsx`
- `lib/admin-corrections.ts`
- mentor, mentee, match, person, application, recap-adjacent routes found under `app/`

## Existing Schema Objects Found

| Need | Existing support | Fit for Season 11 data work |
| --- | --- | --- |
| Season baseline metrics | No dedicated table found. `SEASON11_TRACKING_AUDIT.md` captures Season 10/11 workbook baseline in docs only. | Missing as durable schema object. |
| Season monthly KPI snapshots | `v_monthly_activity_summary` aggregates `mentoring_recaps` by month; dashboard RPCs compute current payloads. | Partial. No `season_monthly_kpis`, no official benchmark table, no `closed` boolean. |
| Raw recap events | `mentoring_recaps` exists with one row per recap and comments explicitly allow multiple recaps per mentee/month. | Reusable as event-level storage if import mapping is validated. It is not named `recap_events` and lacks source-sheet/import-batch lineage. |
| Total recap entries by month | `v_monthly_activity_summary.recap_count`; app and RPC counts use `count(*)`. | Partial, based on DB rows, not official `Bao cao Recap` benchmark. |
| Distinct mentees with recap by month | `v_monthly_activity_summary.active_mentee_count`; RPC/app use `count(distinct mentee_person_id)`/sets. | Supported in aggregate, but not tied to official `Mentee Tracking` source or closed-month rows. |
| Distinct mentor-mentee pairs with recap by month | No dedicated view/table found. Can be derived from `mentoring_recaps`. | Missing as reusable object. |
| Mentee monthly tracking | No `mentee_monthly_tracking` table/view found. App derives selected/follow-up sets from recaps + active matches. | Missing as source-aligned object. |
| Silent/follow-up list | `generate_monthly_followup_actions`, `action_items`, and app-side sets derive missing two-month lists. | Partial. Logic exists but depends on caller-selected month; no closed-month guard. |
| Data import batches | No `data_import_batches` or equivalent import log table found. `admin_audit_log` and `activity_correction_log` are audit logs, not import batches. | Missing. |
| Data quality issues | `action_items` supports `data_issue`; `mentoring_recaps.issue_flag`; `activity_correction_log`; admin correction issue builder. No durable `data_quality_issues` table found. | Partial. Reusable workflow exists, but not a dedicated QA issue table with import severity/block status. |

Key schema references:

- `supabase_migrations/012_create_activity_tracking_tables.sql` creates `mentoring_recaps`, `event_participations`, and `v_monthly_activity_summary`.
- `supabase_migrations/023_phase4_operations_workflow_system.sql` creates `action_items`, `action_item_comments`, `v_operations_workflow_summary`, and workflow RPCs.
- `supabase_migrations/028_production_season11_sync_and_operations_rpc.sql` defines the current stable `get_operations_dashboard_data`.
- `supabase_migrations/030_enrich_founder_intelligence_dashboard.sql` defines `get_founder_intelligence_dashboard`.
- `supabase_migrations/026_production_schema_sync_admin_audit.sql` creates `admin_audit_log` and `admin_scope_access`.
- `supabase_migrations/015_create_activity_correction_log.sql` and later sync migrations define/extend `activity_correction_log`.

## Missing Schema Objects

The current schema does not appear to have the core staging/import objects requested by the Season 11 implementation docs:

- `season_monthly_kpis` or `v_season_monthly_kpis` with official benchmark metrics and `closed boolean`.
- `recap_events` as a dedicated cleaned raw event table with source lineage. Existing `mentoring_recaps` may be reusable instead.
- `data_import_batches`.
- `data_quality_issues`.
- `mentee_monthly_tracking` or `v_mentee_dashboard`.
- `v_mentor_dashboard`.
- A reusable monthly distinct mentor-mentee-pair aggregate.
- A database-native latest-closed-month resolver such as `max(month) where closed = true`.

## Current Dashboard Data Flow

### Home dashboard (`app/page.tsx`)

1. `getDashboardData()` reads base tables: people, profiles, applications, matches, seasons, and all `mentoring_recaps`.
2. The page filters Season 11 rows by `seasons.code = 'UEHM-S11'`.
3. It builds `availableMonths` from months with valid recap rows.
4. It chooses `selectedMonth` as the latest available month less than or equal to `currentMonth()`, otherwise current month/fallback.
5. It computes `closedMonth` as `selectedMonth >= currentMonth() ? previous current calendar month : selectedMonth`.
6. KPI cards and charts are computed in React/server code from those sets.

### Operations dashboard (`app/operations/page.tsx`)

1. `getOperationsData()` first calls RPC `get_operations_dashboard_data`.
2. If the RPC returns the expected payload, the page still recomputes most displayed metrics locally from returned arrays.
3. `selectedMonth` is request `?month=` or dynamic default from available data/current month.
4. `closedMonth` is derived from current calendar month, not a closed-month table.
5. Follow-up rows are built from active matches missing distinct mentee recap IDs in `closedMonth` and `closedPreviousMonth`.

### Operations workflow (`app/operations/tasks/page.tsx`, `app/actions/workflow.ts`)

1. Tasks page hardcodes `DEFAULT_MONTH = '2026-04'`.
2. `generateMonthlyFollowupAction` defaults to `'2026-04'` if the form has no selected month.
3. RPC `generate_monthly_followup_actions` compares selected month and previous month using distinct mentee IDs.
4. The RPC itself does not check whether the selected month is closed.

### Founder intelligence (`app/operations/intelligence/page.tsx`)

1. Uses `getFounderIntelligenceDashboard`.
2. RPC/fallback selects latest recap month before current month where possible, otherwise latest/current.
3. "Silent mentee" is only missing in selected month, not the official two-month Feb+Mar rule.

## Current Logic Answers

### Does it use closed-month logic correctly?

No. It uses calendar/data-derived month selection. There is no `closed` flag or closed-month table. The app can approximate March 2026 on 2026-04 if March rows exist and April is absent or ignored, but this is not enforced by schema.

### Does it support March 2026 as latest closed month?

Only if March 2026 recap rows exist in `mentoring_recaps` and the selected/default logic lands on March. The workbook audit confirms March exists in Excel (`Bao cao Recap` 271, `Mentee Tracking` 275, `Cleaning data` 286), but current DB/dashboard logic does not have a durable March closed KPI snapshot.

### Does it compare February + March 2026 for silent 2-month logic?

It can if `selectedMonth` or `closedMonth` is March 2026. The two-month calculation uses distinct mentee IDs and previous month. However, this is dynamic and not bound to the official closed-month pair.

### Does it accidentally use April 2026/current month?

Yes. The home dashboard and operations dashboard can select April 2026 if April rows exist because `selectedMonth` allows months `<= currentMonth()`. The tasks workflow also defaults to April 2026.

### Why is the dashboard showing `2026-04`?

Because the selected month is derived from available data/current calendar month rather than `max(month) where closed = true`. If April 2026 has even one valid recap row, it becomes the latest available non-future month on 2026-04-30. The tasks workflow also hardcodes April as its default month.

### Why is `Mentee active thang da dong` showing 0?

The page computes closed-month active mentees from `closedMonth`, which should become March 2026 when the selected month is April 2026. A value of 0 means the dashboard payload being rendered has no valid March 2026 recap rows in `mentoring_recaps` for the Season 11 `season_id`, or the March rows have unmapped/null `mentee_person_id`, invalid status, wrong `meeting_month`, or mismatched `season_id`.

### Why does March 2026 appear missing from the chart?

The chart is built from `validOperationalRecaps` in `mentoring_recaps`. If March has no meaningful bar, then March recap rows are not present in that table/payload, are not valid status (`''`, `submitted`, `needs_review`), are not assigned to Season 11, or have malformed `meeting_month`. The Excel audit presence alone does not make the chart render March.

### Does current logic distinguish total recap entries from distinct mentees with recap?

Partially yes. Counts such as selected recap volume use row count; active mentees/follow-up use distinct mentee IDs. The risk is labeling: some dashboard cards say "Mentee active" but can use `selectedMenteeIds.size` without restricting to active matches in some places, while the official metric should be explicit.

### Does it support legitimate multiple recap entries per mentee per month?

At the schema level, yes: `mentoring_recaps` has a UUID primary key and no unique constraint on `(mentee_person_id, meeting_month)`. At the metric level, yes for volume (`count(*)`) and distinct mentee follow-up (`count(distinct mentee_person_id)`/sets). At the import/QA level, no durable import-batch/dedup lineage exists yet to distinguish exact duplicates from legitimate multiple recaps.

## Supabase/Data Risks

- Recap data is currently event-level in `mentoring_recaps`, not summary-level, but official monthly KPI benchmark data is not stored separately.
- Multiple recap entries from the same mentee/month can be preserved in `mentoring_recaps`.
- Active mentee and follow-up can be derived from distinct mentees if `mentee_person_id` is resolved and statuses/months are clean.
- Mentor/mentee IDs can be resolved only when import rows are mapped to existing `people.id` and profile `person_id`s. Current correction workflows flag missing mentor/mentee IDs, but no import-stage blocker table exists.
- Data Issues are partially reusable via `action_items`, `issue_flag`, and admin correction issue generation. There is no dedicated `data_quality_issues` object aligned to import batches/severity/blocking.
- Audit mechanisms exist (`admin_audit_log`, `activity_correction_log`), but no `data_import_batches` mechanism was found.

## Metric Definition Risks

- Official `Bao cao Recap` benchmark is not represented as a durable table/view, so dashboard totals can drift from official monthly KPI numbers.
- Current month naming ("thang nay") can display open-month April data.
- `get_founder_intelligence_dashboard` defines silent mentees as no valid recap in selected month, not the official two-month Feb+Mar follow-up rule.
- `v_monthly_activity_summary` lacks `closed`, official total mentees denominator, and source-of-truth flags.
- Distinct mentor-mentee pairs are not materialized/reusable.
- Data quality counts in dashboard are dynamic heuristics/action items, not import QA blocks/warnings.

## Multiple-Recap Handling Risks

- Schema allows multiple valid recaps per mentee/month, which is good.
- Exact duplicate detection exists only in admin correction logic and is based on season/match/person/date/link buckets, not an import batch QA contract.
- No source row hash/source sheet/source workbook row fields were found on `mentoring_recaps`, so repeatable import deduplication is weak.
- If future imports use upsert keys based only on mentee/month, they would destroy legitimate volume. Any import design must avoid that.

## Closed-Month Handling Risks

- No closed-month schema object was found.
- No `closed` column was found on a monthly KPI table/view.
- The dashboard derives "closed" using runtime current month, not business closure.
- April 2026 is not safely excluded if April rows exist.
- Workflow generation can create April follow-up tasks because both the tasks page and server action default to April 2026.

## March/April Readiness

- March 2026 is supported by current code only as a normal `meeting_month` value, not as the latest closed month.
- April 2026 is not safely excluded by schema or dashboard logic.
- The observed staging dashboard state is consistent with one April recap row in `mentoring_recaps` and no valid March rows in the current dashboard payload.
- Staging import is not safe yet if the goal is official Season 11 reporting, because required import audit/QA/closed-month objects are missing.

## Minimum Safe Next Step

Run read-only Supabase inspection to confirm the actual staging schema and row distribution before writing any migration or import artifact. Specifically verify whether `mentoring_recaps` has March 2026 rows, whether those rows have Season 11 `season_id`, valid statuses, and non-null `mentee_person_id`/`mentor_person_id`.

After read-only confirmation, the lowest-risk implementation path is likely:

1. Reuse `mentoring_recaps` as the event-level recap store if it passes multiple-recap and ID-resolution checks.
2. Add or stage a monthly KPI/closed-month layer (`season_monthly_kpis` or staging equivalent) for official benchmark values.
3. Add or stage import audit and QA objects (`data_import_batches`, `data_quality_issues`) before importing March data.
4. Point dashboard/RPC defaults to latest `closed = true`, not current calendar month.

## Is a Migration Required or Avoidable?

A migration is likely required for safe staging unless read-only inspection reveals equivalent objects already exist but were not represented in local migrations/types.

Avoidable:

- A new raw recap event table may be avoidable because `mentoring_recaps` can preserve multiple event rows and already has recap fields, person FKs, month, status, and correction support.

Likely required:

- Official monthly KPI snapshot table/view with `closed`.
- Import batch table.
- Dedicated or normalized data quality issue tracking tied to import batches.
- Views for closed-month KPIs, mentee monthly tracking, and silent/follow-up lists.

## Read-Only SQL Inspection Queries

All queries below are SELECT-only. Do not execute unless explicitly approved.

### List relevant tables and views

```sql
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%recap%'
    or table_name ilike '%kpi%'
    or table_name ilike '%metric%'
    or table_name ilike '%month%'
    or table_name ilike '%tracking%'
    or table_name ilike '%import%'
    or table_name ilike '%batch%'
    or table_name ilike '%quality%'
    or table_name ilike '%issue%'
    or table_name ilike '%action%'
    or table_name in (
      'seasons',
      'people',
      'mentor_profiles',
      'mentee_profiles',
      'matches',
      'admin_audit_log',
      'activity_correction_log'
    )
  )
order by table_schema, table_name;
```

### List relevant columns

```sql
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'seasons',
    'people',
    'mentor_profiles',
    'mentee_profiles',
    'matches',
    'mentoring_recaps',
    'event_participations',
    'v_monthly_activity_summary',
    'action_items',
    'action_item_comments',
    'activity_correction_log',
    'admin_audit_log',
    'data_import_batches',
    'data_quality_issues',
    'season_monthly_kpis',
    'recap_events',
    'mentee_monthly_tracking'
  )
order by table_name, ordinal_position;
```

### List relevant constraints and uniqueness risks

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'mentoring_recaps',
    'recap_events',
    'season_monthly_kpis',
    'data_import_batches',
    'data_quality_issues',
    'action_items'
  )
order by c.relname, con.conname;
```

### List relevant RPC/functions

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%dashboard%'
    or p.proname ilike '%workflow%'
    or p.proname ilike '%follow%'
    or p.proname ilike '%action%'
    or p.proname ilike '%admin%'
    or p.proname ilike '%intel%'
    or p.proname ilike '%import%'
    or p.proname ilike '%quality%'
  )
order by p.proname, arguments;
```

### Check March 2026 recap data if `mentoring_recaps` exists

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as total_recap_entries,
  count(distinct mr.mentee_person_id) as distinct_mentees_with_recap,
  count(distinct mr.mentor_person_id) as distinct_mentors_with_recap,
  count(distinct (mr.mentor_person_id::text || ':' || mr.mentee_person_id::text)) filter (
    where mr.mentor_person_id is not null and mr.mentee_person_id is not null
  ) as distinct_mentor_mentee_pairs,
  count(*) filter (where mr.mentee_person_id is null) as missing_mentee_id_rows,
  count(*) filter (where mr.mentor_person_id is null) as missing_mentor_id_rows,
  count(*) filter (where coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')) as valid_status_rows
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month = '2026-03'
group by s.code, mr.meeting_month
order by s.code nulls last;
```

### Check monthly recap distribution and April leakage

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as total_recap_entries,
  count(distinct mr.mentee_person_id) as distinct_mentees,
  count(distinct mr.mentor_person_id) as distinct_mentors,
  count(*) filter (where coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')) as valid_rows
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
group by s.code, mr.meeting_month
order by s.code nulls last, mr.meeting_month;
```

### Check whether closed-month support already exists

```sql
select
  table_schema,
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and column_name in ('closed', 'is_closed', 'closed_at', 'month_status', 'source_sheet', 'batch_id')
order by table_name, column_name;
```

### Check if a KPI table/view exists and whether April is marked closed

```sql
select
  table_schema,
  table_name,
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('season_monthly_kpis', 'v_season_monthly_kpis')
order by table_name, ordinal_position;
```

If `season_monthly_kpis` exists:

```sql
select *
from public.season_monthly_kpis
where month in ('2026-02', '2026-03', '2026-04')
order by month;
```

### Check existing dashboard RPC selected month indirectly

```sql
select public.get_operations_dashboard_data('UEHM-S11') -> 'kpis' as operations_kpis;
```

```sql
select public.get_founder_intelligence_dashboard('UEHM-S11') -> 'definitions' as founder_definitions;
```

## Staging Import Readiness

Not ready yet for a safe official staging import. Current schema can hold recap events, but the audit/import/closed-month safeguards required by the Season 11 specs are missing or only partial. Importing March directly into `mentoring_recaps` before adding closed KPI and QA/import-batch controls would likely make the dashboard look better without making the pipeline trustworthy.

## Final Assessment

- Existing schema can preserve raw recap event volume via `mentoring_recaps`.
- Existing logic can derive distinct mentees and two-month follow-up from event rows.
- Existing dashboard logic does not enforce latest closed month.
- March 2026 is not guaranteed as the latest closed month.
- April 2026 is not safely excluded.
- A migration is likely required for official KPI snapshots, closed-month semantics, import batches, and durable data quality issues.
