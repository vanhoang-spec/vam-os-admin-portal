# VAM OS Staging Baseline Enum and View Design — 2026-07-22

Design only; not authorized for execution. Enum labels/order are listed in `VAM_OS_PRODUCTION_BASELINE_GAPS_OFFLINE_ANALYSIS_2026-07-22.md` and must be reproduced exactly after confirming target types are absent.

The three authoritative view query bodies are:

```sql
-- v_mentee_monthly_tracking; dependency: public.mentoring_recaps
SELECT season_id, mentee_person_id, meeting_month, count(id) AS valid_recap_count
FROM mentoring_recaps
WHERE COALESCE(TRIM(BOTH FROM lower(status)), ''::text) = ANY (ARRAY[''::text, 'submitted'::text, 'needs_review'::text])
  AND mentee_person_id IS NOT NULL
GROUP BY season_id, mentee_person_id, meeting_month;

-- v_monthly_activity_summary; dependency: public.mentoring_recaps
SELECT season_id, meeting_month, count(*) AS recap_count,
       count(DISTINCT mentee_person_id) AS active_mentee_count,
       count(DISTINCT mentor_person_id) AS active_mentor_count
FROM mentoring_recaps
WHERE status = ANY (ARRAY['submitted'::text, 'needs_review'::text])
GROUP BY season_id, meeting_month;

-- v_season_latest_closed_month; dependency: public.season_monthly_kpis
WITH closed_kpis AS (
  SELECT season_id, month_value,
         lag(month_value) OVER (PARTITION BY season_id ORDER BY month_value) AS previous_closed_month,
         total_mentees, total_recap_entries, distinct_mentees_with_recap, pct_mentees_with_recap,
         row_number() OVER (PARTITION BY season_id ORDER BY month_value DESC) AS latest_rank
  FROM season_monthly_kpis WHERE closed = true
)
SELECT season_id, month_value AS latest_closed_month, previous_closed_month,
       total_mentees, total_recap_entries, distinct_mentees_with_recap, pct_mentees_with_recap
FROM closed_kpis WHERE latest_rank = 1;
```

These are query bodies, not executable `CREATE VIEW` authorization. Exact column types and dependent table DDL must be established first. No security-barrier, ownership, or grant property is inferred.
