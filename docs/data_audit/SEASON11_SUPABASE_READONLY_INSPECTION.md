# Season 11 Supabase Read-Only Inspection Pack

Generated: 2026-04-30

## Purpose

This pack provides SELECT-only Supabase inspection queries for the Season 11 data work. It checks whether March 2026 recap data exists in Supabase, whether April 2026 data is present and at risk of being treated as official KPI data, and whether the schema has enough closed-month/KPI structure for dashboard logic to safely use the latest closed month.

Business interpretation for this inspection:

- Latest closed month: March 2026 (`2026-03`).
- Follow-up comparison months: February 2026 and March 2026.
- April 2026 (`2026-04`) is open and must be excluded from official closed-month KPI logic.
- `Bao cao Recap` is the official monthly KPI benchmark.
- `Mentee Tracking` drives distinct mentee follow-up/silent logic.
- `Cleaning data` is the raw recap event source after cleaning/deduplication.

## Guardrails

- All SQL below is SELECT-only.
- Do not run any schema-changing or data-changing SQL during this inspection.
- Do not execute dashboard rewrites, migrations, import scripts, CSV imports, or deployments from this pack.
- Run the metadata checks first. Only run table-specific recap checks after confirming the referenced table and columns exist.

## SQL Queries

### 01. Relevant Tables And Views

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
    or table_name ilike '%workflow%'
    or table_name in (
      'seasons',
      'people',
      'mentor_profiles',
      'mentee_profiles',
      'matches',
      'event_participations',
      'admin_audit_log',
      'activity_correction_log'
    )
  )
order by table_schema, table_name;
```

### 02. Relevant Columns

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
  and (
    table_name in (
      'seasons',
      'people',
      'mentor_profiles',
      'mentee_profiles',
      'matches',
      'mentoring_recaps',
      'recap_events',
      'event_participations',
      'v_monthly_activity_summary',
      'season_monthly_kpis',
      'v_season_monthly_kpis',
      'mentee_monthly_tracking',
      'v_mentee_dashboard',
      'v_mentor_dashboard',
      'action_items',
      'action_item_comments',
      'activity_correction_log',
      'admin_audit_log',
      'data_import_batches',
      'data_quality_issues'
    )
    or table_name ilike '%recap%'
    or table_name ilike '%kpi%'
    or table_name ilike '%quality%'
    or table_name ilike '%import%'
    or table_name ilike '%batch%'
  )
order by table_name, ordinal_position;
```

### 03. Relevant RPC And Functions

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
    or p.proname ilike '%recap%'
    or p.proname ilike '%month%'
  )
order by p.proname, arguments;
```

### 04. `mentoring_recaps` Column Existence Check

Run this before the recap distribution queries. The recap checks below assume `mentoring_recaps` has `season_id`, `meeting_month`, `meeting_date`, `status`, `mentor_person_id`, `mentee_person_id`, `match_id`, and `recap_url`.

```sql
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'mentoring_recaps'
  and column_name in (
    'id',
    'season_id',
    'match_id',
    'mentor_person_id',
    'mentee_person_id',
    'meeting_date',
    'meeting_month',
    'recap_url',
    'status',
    'issue_flag'
  )
order by column_name;
```

### 05. `mentoring_recaps` Row Distribution By Month

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as total_recap_entries,
  count(*) filter (
    where coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as valid_recap_entries,
  count(distinct mr.mentee_person_id) filter (
    where mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentees_with_valid_recap,
  count(distinct mr.mentor_person_id) filter (
    where mr.mentor_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentors_with_valid_recap
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
group by s.code, mr.meeting_month
order by s.code nulls last, mr.meeting_month;
```

### 06. March 2026 Row Count

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as total_recap_entries,
  count(*) filter (
    where coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as valid_recap_entries,
  count(distinct mr.mentee_person_id) filter (
    where mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentees_with_valid_recap,
  count(distinct (mr.mentor_person_id, mr.mentee_person_id)) filter (
    where mr.mentor_person_id is not null
      and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentor_mentee_pairs_with_valid_recap
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month = '2026-03'
group by s.code, mr.meeting_month
order by s.code nulls last;
```

### 07. April 2026 Row Count

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as total_recap_entries,
  count(*) filter (
    where coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as valid_recap_entries,
  count(distinct mr.mentee_person_id) filter (
    where mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentees_with_valid_recap,
  count(distinct (mr.mentor_person_id, mr.mentee_person_id)) filter (
    where mr.mentor_person_id is not null
      and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  ) as distinct_mentor_mentee_pairs_with_valid_recap
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month = '2026-04'
group by s.code, mr.meeting_month
order by s.code nulls last;
```

### 08. Row Distribution By `season_id`

```sql
select
  mr.season_id,
  s.code as season_code,
  s.name as season_name,
  count(*) as total_recap_entries,
  min(mr.meeting_month) as first_meeting_month,
  max(mr.meeting_month) as latest_meeting_month
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
group by mr.season_id, s.code, s.name
order by total_recap_entries desc, season_code nulls last;
```

### 09. Row Distribution By Status

```sql
select
  s.code as season_code,
  mr.meeting_month,
  coalesce(nullif(trim(lower(mr.status)), ''), '<blank>') as normalized_status,
  count(*) as row_count
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
group by s.code, mr.meeting_month, coalesce(nullif(trim(lower(mr.status)), ''), '<blank>')
order by s.code nulls last, mr.meeting_month, normalized_status;
```

### 10. Rows With Null `mentee_person_id`

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as rows_with_null_mentee_person_id
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
  and mr.mentee_person_id is null
group by s.code, mr.meeting_month
order by s.code nulls last, mr.meeting_month;
```

### 11. Rows With Null `mentor_person_id`

```sql
select
  s.code as season_code,
  mr.meeting_month,
  count(*) as rows_with_null_mentor_person_id
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
  and mr.mentor_person_id is null
group by s.code, mr.meeting_month
order by s.code nulls last, mr.meeting_month;
```

### 12. Possible Duplicate Recap Rows

This checks likely exact duplicates. Legitimate multiple recaps by the same mentee in the same month should not be treated as duplicates unless the stronger row signature also repeats.

```sql
select
  s.code as season_code,
  mr.meeting_month,
  mr.meeting_date,
  mr.match_id,
  mr.mentor_person_id,
  mr.mentee_person_id,
  mr.recap_url,
  count(*) as duplicate_candidate_count,
  array_agg(mr.id order by mr.id) as recap_ids
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
  and coalesce(trim(lower(mr.status)), '') not in ('deleted', 'invalid')
group by
  s.code,
  mr.meeting_month,
  mr.meeting_date,
  mr.match_id,
  mr.mentor_person_id,
  mr.mentee_person_id,
  mr.recap_url
having count(*) > 1
order by duplicate_candidate_count desc, mr.meeting_month, mr.meeting_date;
```

### 13. Multiple Recaps Per Mentee Per Month

This query is not a duplicate detector. It shows whether legitimate multiple recap volume exists and must be preserved.

```sql
select
  s.code as season_code,
  mr.meeting_month,
  mr.mentee_person_id,
  count(*) as recap_entries_for_mentee_month,
  count(distinct mr.recap_url) as distinct_recap_urls,
  min(mr.meeting_date) as first_meeting_date,
  max(mr.meeting_date) as latest_meeting_date
from public.mentoring_recaps mr
left join public.seasons s on s.id = mr.season_id
where mr.meeting_month between '2025-11' and '2026-04'
  and mr.mentee_person_id is not null
  and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
group by s.code, mr.meeting_month, mr.mentee_person_id
having count(*) > 1
order by recap_entries_for_mentee_month desc, s.code nulls last, mr.meeting_month;
```

### 14. Closed-Month Or KPI Table Existence

```sql
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%kpi%'
    or table_name ilike '%metric%'
    or table_name ilike '%month%'
    or table_name in (
      'season_monthly_kpis',
      'v_season_monthly_kpis',
      'v_monthly_activity_summary'
    )
  )
order by table_name;
```

### 15. Closed-Month Columns

```sql
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    column_name in ('closed', 'is_closed', 'closed_at', 'month_status', 'reporting_month', 'meeting_month', 'month')
    or table_name in ('season_monthly_kpis', 'v_season_monthly_kpis', 'v_monthly_activity_summary')
  )
order by table_name, ordinal_position;
```

### 16. Closed KPI Rows, If `season_monthly_kpis` Exists

Run this only if query 14/15 confirms `public.season_monthly_kpis` exists with compatible month and closed columns.

```sql
select
  *
from public.season_monthly_kpis
where month in ('2026-02', '2026-03', '2026-04')
order by month;
```

### 17. Data Import Batch Table Existence

```sql
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%import%'
    or table_name ilike '%batch%'
    or table_name in ('data_import_batches', 'import_batches')
  )
order by table_name;
```

### 18. Data Import Batch Columns

```sql
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%import%'
    or table_name ilike '%batch%'
    or table_name in ('data_import_batches', 'import_batches')
  )
order by table_name, ordinal_position;
```

### 19. Data Quality Issue Table Existence

```sql
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%quality%'
    or table_name ilike '%issue%'
    or table_name in ('data_quality_issues', 'data_issues')
  )
order by table_name;
```

### 20. Data Quality Issue Columns

```sql
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%quality%'
    or table_name ilike '%issue%'
    or table_name in ('data_quality_issues', 'data_issues')
  )
order by table_name, ordinal_position;
```

### 21. Current Dashboard RPC Month Selection

This calls existing read RPCs through SELECT. Use it to inspect whether the returned dashboard payload selects April, March, or another month.

```sql
select
  public.get_operations_dashboard_data('UEHM-S11') -> 'kpis' as operations_dashboard_kpis;
```

```sql
select
  public.get_founder_intelligence_dashboard('UEHM-S11') -> 'definitions' as founder_intelligence_definitions;
```

### 22. Monthly Summary View Output, If Present

Run this if `v_monthly_activity_summary` exists.

```sql
select
  s.code as season_code,
  v.meeting_month,
  v.recap_count,
  v.active_mentee_count,
  v.active_mentor_count
from public.v_monthly_activity_summary v
left join public.seasons s on s.id = v.season_id
where v.meeting_month between '2025-11' and '2026-04'
order by s.code nulls last, v.meeting_month;
```

## Result Capture Template

| Query name | Result summary | Risk | Decision impact |
| --- | --- | --- | --- |
| 01. Relevant Tables And Views |  |  |  |
| 02. Relevant Columns |  |  |  |
| 03. Relevant RPC And Functions |  |  |  |
| 04. `mentoring_recaps` Column Existence Check |  |  |  |
| 05. `mentoring_recaps` Row Distribution By Month |  |  |  |
| 06. March 2026 Row Count |  |  |  |
| 07. April 2026 Row Count |  |  |  |
| 08. Row Distribution By `season_id` |  |  |  |
| 09. Row Distribution By Status |  |  |  |
| 10. Rows With Null `mentee_person_id` |  |  |  |
| 11. Rows With Null `mentor_person_id` |  |  |  |
| 12. Possible Duplicate Recap Rows |  |  |  |
| 13. Multiple Recaps Per Mentee Per Month |  |  |  |
| 14. Closed-Month Or KPI Table Existence |  |  |  |
| 15. Closed-Month Columns |  |  |  |
| 16. Closed KPI Rows, If `season_monthly_kpis` Exists |  |  |  |
| 17. Data Import Batch Table Existence |  |  |  |
| 18. Data Import Batch Columns |  |  |  |
| 19. Data Quality Issue Table Existence |  |  |  |
| 20. Data Quality Issue Columns |  |  |  |
| 21. Current Dashboard RPC Month Selection |  |  |  |
| 22. Monthly Summary View Output, If Present |  |  |  |

## Decision Interpretation Guide

### If March 2026 rows = 0

The next step is staging import preparation. Do not treat the dashboard as wrong solely because it misses March if March is absent from Supabase. Prepare the staging schema/import path first, including import batches, data quality issue capture, and official closed KPI records.

### If March 2026 rows exist but the dashboard misses them

The next step is query/RPC correction. Check whether March rows have the wrong `season_id`, invalid `status`, null `mentee_person_id`, malformed `meeting_month`, or are filtered out by dashboard/RPC logic. If rows are valid and still missed, the dashboard/RPC month selection and filters need correction.

### If April 2026 rows exist and dashboard uses them as official KPI

Closed-month logic must be fixed before the dashboard is trusted. April is open and should not drive official KPI cards, latest closed month health, or two-month follow-up decisions.

### If no closed-month/KPI structure exists

Prepare a minimum staging migration before dashboard rewrite. The minimum safe shape should provide official monthly KPI rows, a `closed` or equivalent flag, and a reliable way to select latest closed month as March 2026 while excluding April 2026.

### If March rows exist with null mentor or mentee IDs

Treat this as an import/data quality blocker for follow-up metrics. Total recap volume can still be counted, but distinct mentee, mentor coverage, and silent/follow-up logic cannot be trusted for those rows.

### If possible duplicates exist

Review the duplicate candidates manually. Exact duplicates should be removed or marked before official reporting, but legitimate multiple distinct recaps from the same mentee in the same month must be preserved for activity volume.

### If data import batch or data quality issue structures are missing

Staging import is not audit-ready. Prepare those structures before loading official March 2026 data or wiring dashboard logic to new KPI outputs.
