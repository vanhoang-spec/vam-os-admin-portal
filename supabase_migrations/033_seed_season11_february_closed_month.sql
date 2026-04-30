-- Migration 033: Seed Season 11 February Closed Month Anchor
-- Purpose:
-- Establishes 2026-02 as a closed governance month so
-- v_season_latest_closed_month can return:
--   latest_closed_month = 2026-03
--   previous_closed_month = 2026-02
--
-- Important:
-- This row is used primarily as a closed-month anchor for follow-up logic.
-- February values are based on the Season 11 tracking audit:
--   Bao cao Recap: 126
--   Mentee Tracking: 137
--   Cleaning data: 137
--
-- Do not use placeholder zero KPI values in season_monthly_kpis.

DO $$
DECLARE
  v_season_id uuid;
BEGIN
  SELECT id INTO v_season_id
  FROM public.seasons
  WHERE code = 'UEHM-S11'
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Season UEHM-S11 not found.';
  END IF;

  INSERT INTO public.season_monthly_kpis (
    season_id,
    month_value,
    closed,
    total_mentees,
    total_recap_entries,
    distinct_mentees_with_recap,
    total_mentors,
    pct_mentees_with_recap,
    source_name,
    source_file,
    notes,
    closed_at
  )
  VALUES (
    v_season_id,
    '2026-02',
    true,
    593,
    126,
    137,
    0,
    round((137::numeric / 593::numeric) * 100, 1),
    'Season 11 Tracking Audit',
    'Báo cáo Recap / Mentee Tracking / Cleaning data',
    'Closed-month anchor for follow-up logic. February values are audit-based: Bao cao Recap total recaps = 126; Mentee Tracking distinct/activity count = 137; Cleaning data = 137. Total mentees uses March official denominator 593 until a February-specific denominator is confirmed.',
    now()
  )
  ON CONFLICT (season_id, month_value) DO UPDATE SET
    closed = EXCLUDED.closed,
    total_mentees = EXCLUDED.total_mentees,
    total_recap_entries = EXCLUDED.total_recap_entries,
    distinct_mentees_with_recap = EXCLUDED.distinct_mentees_with_recap,
    total_mentors = EXCLUDED.total_mentors,
    pct_mentees_with_recap = EXCLUDED.pct_mentees_with_recap,
    source_name = EXCLUDED.source_name,
    source_file = EXCLUDED.source_file,
    notes = EXCLUDED.notes,
    closed_at = COALESCE(public.season_monthly_kpis.closed_at, EXCLUDED.closed_at),
    updated_at = now();

END;
$$;

select
  season_id,
  latest_closed_month,
  previous_closed_month,
  total_mentees,
  total_recap_entries,
  distinct_mentees_with_recap,
  pct_mentees_with_recap
from public.v_season_latest_closed_month
where season_id = (
  select id from public.seasons where code = 'UEHM-S11'
);