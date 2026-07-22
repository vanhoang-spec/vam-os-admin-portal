-- STAGING ONLY. DESIGN ONLY. NOT AUTHORIZED. NOT EXECUTED.
-- MUST NEVER RUN ON PRODUCTION.
CREATE VIEW public.v_mentee_monthly_tracking AS
 SELECT season_id, mentee_person_id, meeting_month, count(id) AS valid_recap_count
 FROM public.mentoring_recaps
 WHERE COALESCE(TRIM(BOTH FROM lower(status)), ''::text) = ANY (ARRAY[''::text,'submitted'::text,'needs_review'::text])
   AND mentee_person_id IS NOT NULL
 GROUP BY season_id, mentee_person_id, meeting_month;

CREATE VIEW public.v_monthly_activity_summary AS
 SELECT season_id, meeting_month, count(*) AS recap_count,
        count(DISTINCT mentee_person_id) AS active_mentee_count,
        count(DISTINCT mentor_person_id) AS active_mentor_count
 FROM public.mentoring_recaps
 WHERE status = ANY (ARRAY['submitted'::text,'needs_review'::text])
 GROUP BY season_id, meeting_month;

CREATE VIEW public.v_season_latest_closed_month AS
 WITH closed_kpis AS (
   SELECT season_id, month_value,
          lag(month_value) OVER (PARTITION BY season_id ORDER BY month_value) AS previous_closed_month,
          total_mentees, total_recap_entries, distinct_mentees_with_recap, pct_mentees_with_recap,
          row_number() OVER (PARTITION BY season_id ORDER BY month_value DESC) AS latest_rank
   FROM public.season_monthly_kpis WHERE closed = true
 )
 SELECT season_id, month_value AS latest_closed_month, previous_closed_month,
        total_mentees, total_recap_entries, distinct_mentees_with_recap, pct_mentees_with_recap
 FROM closed_kpis WHERE latest_rank = 1;
