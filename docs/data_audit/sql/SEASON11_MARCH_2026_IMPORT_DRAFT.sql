-- Season 11 March 2026 Import Draft
-- REVIEW ONLY. DO NOT EXECUTE UNTIL STAGING APPROVAL.
--
-- Purpose:
-- - Prepare a controlled March 2026 import into existing public.mentoring_recaps.
-- - Create a pending data_import_batches row.
-- - Validate ID mapping against people, mentor_profiles, mentee_profiles, and matches.
-- - Detect exact duplicate candidates.
-- - Log blockers/warnings to data_quality_issues.
-- - Insert only cleaned non-blocked rows.
-- - Upsert the official March 2026 KPI snapshot into season_monthly_kpis.
--
-- Guardrails:
-- - Staging only.
-- - Do not run on production.
-- - Do not run until _season11_march_source has been reviewed and populated in this session.
-- - This file is not a migration.
-- - This file does not rewrite dashboard RPCs.
--
-- Expected source relation in the same session:
--
-- CREATE TEMP TABLE _season11_march_source (
--   source_row_id text not null,
--   source_sheet text not null,
--   source_file text not null,
--   meeting_date date not null,
--   mentor_person_id uuid,
--   mentee_person_id uuid,
--   match_id uuid,
--   recap_url text,
--   recap_note text,
--   meeting_type text,
--   captured_by text,
--   raw_payload jsonb default '{}'::jsonb
-- ) ON COMMIT DROP;
--
-- Populate _season11_march_source from the reviewed cleaned March 2026 source rows
-- before running the transaction below. Do not use mentee/month as a uniqueness key.

BEGIN;

-- 0. Hard guard: source rows must be present in this session.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _season11_march_source) THEN
    RAISE EXCEPTION '_season11_march_source is empty or missing. Populate reviewed source rows before running this import draft.';
  END IF;
END;
$$;

-- 1. Create import context and pending batch.
CREATE TEMP TABLE _season11_march_import_context ON COMMIT DROP AS
WITH target_season AS (
  SELECT id AS season_id
  FROM public.seasons
  WHERE code = 'UEHM-S11'
  LIMIT 1
),
batch AS (
  INSERT INTO public.data_import_batches (
    season_id,
    status,
    source_file,
    created_by,
    rows_processed
  )
  SELECT
    target_season.season_id,
    'pending',
    'TRACKING _ SEASON 11.xlsx',
    'manual_staging_review',
    0
  FROM target_season
  RETURNING id AS batch_id, season_id
)
SELECT
  batch.batch_id,
  batch.season_id,
  '2026-03'::text AS import_month
FROM batch;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _season11_march_import_context) THEN
    RAISE EXCEPTION 'UEHM-S11 season was not found. Stop import preparation.';
  END IF;
END;
$$;

-- 2. Normalize source rows and attach mapping signals.
CREATE TEMP TABLE _season11_march_candidate_rows ON COMMIT DROP AS
WITH normalized AS (
  SELECT
    ctx.batch_id,
    ctx.season_id,
    src.source_row_id,
    src.source_sheet,
    src.source_file,
    src.meeting_date,
    to_char(src.meeting_date, 'YYYY-MM') AS meeting_month,
    src.mentor_person_id,
    src.mentee_person_id,
    src.match_id,
    nullif(trim(src.recap_url), '') AS recap_url,
    nullif(trim(src.recap_note), '') AS recap_note,
    coalesce(nullif(trim(src.meeting_type), ''), '1on1_primary') AS meeting_type,
    coalesce(nullif(trim(src.captured_by), ''), 'season11_march_import') AS captured_by,
    coalesce(src.raw_payload, '{}'::jsonb) AS raw_payload,
    mentor_person.id IS NOT NULL AS mentor_person_exists,
    mentee_person.id IS NOT NULL AS mentee_person_exists,
    mentor_profile.person_id IS NOT NULL AS mentor_profile_exists,
    mentee_profile.person_id IS NOT NULL AS mentee_profile_exists,
    matched.id IS NOT NULL AS supplied_match_exists,
    (
      src.match_id IS NULL
      OR (
        matched.id IS NOT NULL
        AND matched.season_id = ctx.season_id
        AND matched.mentor_person_id = src.mentor_person_id
        AND matched.mentee_person_id = src.mentee_person_id
      )
    ) AS supplied_match_is_consistent
  FROM _season11_march_source src
  CROSS JOIN _season11_march_import_context ctx
  LEFT JOIN public.people mentor_person ON mentor_person.id = src.mentor_person_id
  LEFT JOIN public.people mentee_person ON mentee_person.id = src.mentee_person_id
  LEFT JOIN public.mentor_profiles mentor_profile ON mentor_profile.person_id = src.mentor_person_id
  LEFT JOIN public.mentee_profiles mentee_profile ON mentee_profile.person_id = src.mentee_person_id
  LEFT JOIN public.matches matched ON matched.id = src.match_id
)
SELECT
  normalized.*,
  row_number() OVER (
    PARTITION BY season_id, meeting_date, mentor_person_id, mentee_person_id, recap_url
    ORDER BY source_row_id
  ) AS source_exact_duplicate_rank
FROM normalized;

-- 3. Exact duplicate candidates inside source.
CREATE TEMP TABLE _season11_march_source_duplicate_candidates ON COMMIT DROP AS
SELECT
  season_id,
  meeting_date,
  mentor_person_id,
  mentee_person_id,
  recap_url,
  count(*) AS duplicate_candidate_count,
  array_agg(source_row_id ORDER BY source_row_id) AS source_row_ids
FROM _season11_march_candidate_rows
GROUP BY
  season_id,
  meeting_date,
  mentor_person_id,
  mentee_person_id,
  recap_url
HAVING count(*) > 1;

-- 4. Exact duplicate candidates already present in mentoring_recaps.
CREATE TEMP TABLE _season11_march_existing_duplicate_candidates ON COMMIT DROP AS
SELECT
  candidate.source_row_id,
  existing.id AS existing_recap_id,
  candidate.season_id,
  candidate.meeting_date,
  candidate.mentor_person_id,
  candidate.mentee_person_id,
  candidate.recap_url
FROM _season11_march_candidate_rows candidate
JOIN public.mentoring_recaps existing
  ON existing.season_id = candidate.season_id
 AND existing.meeting_date = candidate.meeting_date
 AND existing.mentor_person_id = candidate.mentor_person_id
 AND existing.mentee_person_id = candidate.mentee_person_id
 AND existing.recap_url = candidate.recap_url
 AND coalesce(trim(lower(existing.status)), '') NOT IN ('deleted', 'invalid');

-- 5. Log blocker/warning issues.
INSERT INTO public.data_quality_issues (
  batch_id,
  entity_type,
  entity_id,
  issue_type,
  severity,
  description,
  raw_data
)
SELECT
  batch_id,
  'recap_source_row',
  null,
  issue_type,
  severity,
  description,
  raw_data
FROM (
  SELECT
    batch_id,
    source_row_id,
    'invalid_month' AS issue_type,
    'block' AS severity,
    'Source row meeting_date is not in March 2026.' AS description,
    raw_payload || jsonb_build_object('source_row_id', source_row_id, 'meeting_date', meeting_date)
  FROM _season11_march_candidate_rows
  WHERE meeting_month <> '2026-03'

  UNION ALL

  SELECT
    batch_id,
    source_row_id,
    'missing_recap_url',
    'block',
    'Source row is missing recap_url required by mentoring_recaps.',
    raw_payload || jsonb_build_object('source_row_id', source_row_id)
  FROM _season11_march_candidate_rows
  WHERE recap_url IS NULL

  UNION ALL

  SELECT
    batch_id,
    source_row_id,
    'missing_or_invalid_mentor',
    'block',
    'mentor_person_id is null, missing from people, or missing mentor profile.',
    raw_payload || jsonb_build_object('source_row_id', source_row_id, 'mentor_person_id', mentor_person_id)
  FROM _season11_march_candidate_rows
  WHERE mentor_person_id IS NULL
     OR NOT mentor_person_exists
     OR NOT mentor_profile_exists

  UNION ALL

  SELECT
    batch_id,
    source_row_id,
    'missing_or_invalid_mentee',
    'block',
    'mentee_person_id is null, missing from people, or missing mentee profile.',
    raw_payload || jsonb_build_object('source_row_id', source_row_id, 'mentee_person_id', mentee_person_id)
  FROM _season11_march_candidate_rows
  WHERE mentee_person_id IS NULL
     OR NOT mentee_person_exists
     OR NOT mentee_profile_exists

  UNION ALL

  SELECT
    batch_id,
    source_row_id,
    'match_mismatch',
    'warning',
    'Supplied match_id is missing or does not match season/mentor/mentee. Row may still import without match_id if accepted.',
    raw_payload || jsonb_build_object('source_row_id', source_row_id, 'match_id', match_id)
  FROM _season11_march_candidate_rows
  WHERE match_id IS NOT NULL
    AND NOT supplied_match_is_consistent

  UNION ALL

  SELECT
    ctx.batch_id,
    unnest(source_row_ids),
    'duplicate_source_candidate',
    'warning',
    'Exact duplicate candidate appears more than once in the reviewed source.',
    jsonb_build_object(
      'source_row_ids', source_row_ids,
      'duplicate_candidate_count', duplicate_candidate_count,
      'meeting_date', meeting_date,
      'mentor_person_id', mentor_person_id,
      'mentee_person_id', mentee_person_id,
      'recap_url', recap_url
    )
  FROM _season11_march_source_duplicate_candidates dup
  CROSS JOIN _season11_march_import_context ctx

  UNION ALL

  SELECT
    ctx.batch_id,
    existing_dup.source_row_id,
    'existing_recap_duplicate_candidate',
    'warning',
    'Exact duplicate candidate already exists in mentoring_recaps and will be skipped by insert.',
    jsonb_build_object(
      'source_row_id', existing_dup.source_row_id,
      'existing_recap_id', existing_dup.existing_recap_id,
      'meeting_date', existing_dup.meeting_date,
      'mentor_person_id', existing_dup.mentor_person_id,
      'mentee_person_id', existing_dup.mentee_person_id,
      'recap_url', existing_dup.recap_url
    )
  FROM _season11_march_existing_duplicate_candidates existing_dup
  CROSS JOIN _season11_march_import_context ctx
) issue_rows;

-- 6. Prepare cleaned rows.
CREATE TEMP TABLE _season11_march_cleaned_recaps ON COMMIT DROP AS
SELECT
  candidate.season_id,
  CASE
    WHEN candidate.supplied_match_is_consistent THEN candidate.match_id
    ELSE NULL
  END AS match_id,
  candidate.mentor_person_id,
  candidate.mentee_person_id,
  candidate.meeting_date,
  '2026-03'::text AS meeting_month,
  candidate.recap_url,
  'google_sheet'::text AS recap_source,
  candidate.recap_note,
  candidate.meeting_type,
  candidate.captured_by,
  false AS issue_flag,
  'submitted'::text AS status,
  concat(
    'Season 11 March staging import; source_row_id=',
    candidate.source_row_id,
    '; batch_id=',
    candidate.batch_id
  ) AS admin_notes,
  candidate.source_row_id,
  candidate.batch_id
FROM _season11_march_candidate_rows candidate
WHERE candidate.meeting_month = '2026-03'
  AND candidate.recap_url IS NOT NULL
  AND candidate.mentor_person_id IS NOT NULL
  AND candidate.mentee_person_id IS NOT NULL
  AND candidate.mentor_person_exists
  AND candidate.mentee_person_exists
  AND candidate.mentor_profile_exists
  AND candidate.mentee_profile_exists
  AND candidate.source_exact_duplicate_rank = 1;

-- 6b. Log official/source count reconciliation for human acceptance.
INSERT INTO public.data_quality_issues (
  batch_id,
  entity_type,
  entity_id,
  issue_type,
  severity,
  description,
  raw_data
)
SELECT
  ctx.batch_id,
  'season_monthly_kpi',
  null,
  'march_count_reconciliation',
  'warning',
  'March source/count reconciliation must be accepted before dashboard rewiring. Official Bao cao Recap total is 271; Mentee Tracking is 275; Cleaning data is 286.',
  jsonb_build_object(
    'official_bao_cao_recap', 271,
    'mentee_tracking', 275,
    'cleaning_data', 286,
    'reviewed_source_rows', (SELECT count(*) FROM _season11_march_candidate_rows),
    'cleaned_rows_prepared', (SELECT count(*) FROM _season11_march_cleaned_recaps)
  )
FROM _season11_march_import_context ctx;

-- 7. Insert cleaned rows, preserving legitimate multiple recaps and skipping only exact existing duplicates.
INSERT INTO public.mentoring_recaps (
  season_id,
  match_id,
  mentor_person_id,
  mentee_person_id,
  meeting_date,
  meeting_month,
  recap_url,
  recap_source,
  recap_note,
  meeting_type,
  captured_by,
  issue_flag,
  status,
  admin_notes
)
SELECT
  clean.season_id,
  clean.match_id,
  clean.mentor_person_id,
  clean.mentee_person_id,
  clean.meeting_date,
  clean.meeting_month,
  clean.recap_url,
  clean.recap_source,
  clean.recap_note,
  clean.meeting_type,
  clean.captured_by,
  clean.issue_flag,
  clean.status,
  clean.admin_notes
FROM _season11_march_cleaned_recaps clean
WHERE NOT EXISTS (
  SELECT 1
  FROM public.mentoring_recaps existing
  WHERE existing.season_id = clean.season_id
    AND existing.meeting_date = clean.meeting_date
    AND existing.mentor_person_id = clean.mentor_person_id
    AND existing.mentee_person_id = clean.mentee_person_id
    AND existing.recap_url = clean.recap_url
    AND coalesce(trim(lower(existing.status)), '') NOT IN ('deleted', 'invalid')
);

-- 8. Upsert official March 2026 KPI snapshot from Bao cao Recap.
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
  batch_id,
  notes,
  closed_at
)
SELECT
  ctx.season_id,
  '2026-03',
  true,
  593,
  271,
  224,
  (
    SELECT count(distinct mentor_person_id)::int
    FROM public.mentoring_recaps
    WHERE season_id = ctx.season_id
      AND meeting_month = '2026-03'
      AND mentor_person_id IS NOT NULL
      AND coalesce(trim(lower(status)), '') IN ('', 'submitted', 'needs_review')
  ),
  37.8,
  'Bao cao Recap',
  'TRACKING _ SEASON 11.xlsx',
  ctx.batch_id,
  'Official March 2026 KPI snapshot from Bao cao Recap. Cleaning data and Mentee Tracking discrepancies must remain documented in QA.',
  now()
FROM _season11_march_import_context ctx
ON CONFLICT (season_id, month_value)
DO UPDATE SET
  closed = EXCLUDED.closed,
  total_mentees = EXCLUDED.total_mentees,
  total_recap_entries = EXCLUDED.total_recap_entries,
  distinct_mentees_with_recap = EXCLUDED.distinct_mentees_with_recap,
  total_mentors = EXCLUDED.total_mentors,
  pct_mentees_with_recap = EXCLUDED.pct_mentees_with_recap,
  source_name = EXCLUDED.source_name,
  source_file = EXCLUDED.source_file,
  batch_id = EXCLUDED.batch_id,
  notes = EXCLUDED.notes,
  closed_at = EXCLUDED.closed_at,
  updated_at = now();

-- 9. Update batch row count. Keep status pending until manual validation accepts the run.
UPDATE public.data_import_batches batch
SET
  rows_processed = (
    SELECT count(*)::int
    FROM _season11_march_cleaned_recaps
  ),
  updated_at = now()
FROM _season11_march_import_context ctx
WHERE batch.id = ctx.batch_id;

-- 10. Manual validation queries to review before COMMIT.
SELECT
  'batch' AS check_name,
  ctx.batch_id,
  ctx.season_id,
  batch.status,
  batch.rows_processed
FROM _season11_march_import_context ctx
JOIN public.data_import_batches batch ON batch.id = ctx.batch_id;

SELECT
  'qa_issues_by_severity' AS check_name,
  severity,
  issue_type,
  count(*) AS issue_count
FROM public.data_quality_issues
WHERE batch_id = (SELECT batch_id FROM _season11_march_import_context)
GROUP BY severity, issue_type
ORDER BY severity, issue_type;

SELECT
  'march_recap_distribution_after_import' AS check_name,
  s.code AS season_code,
  mr.meeting_month,
  count(*) AS total_recap_entries,
  count(*) FILTER (
    WHERE coalesce(trim(lower(mr.status)), '') IN ('', 'submitted', 'needs_review')
  ) AS valid_recap_entries,
  count(distinct mr.mentee_person_id) FILTER (
    WHERE mr.mentee_person_id IS NOT NULL
      AND coalesce(trim(lower(mr.status)), '') IN ('', 'submitted', 'needs_review')
  ) AS distinct_mentees_with_valid_recap
FROM public.mentoring_recaps mr
JOIN public.seasons s ON s.id = mr.season_id
WHERE s.code = 'UEHM-S11'
  AND mr.meeting_month = '2026-03'
GROUP BY s.code, mr.meeting_month;

SELECT
  'march_kpi_snapshot' AS check_name,
  s.code AS season_code,
  kpi.month_value,
  kpi.closed,
  kpi.total_recap_entries,
  kpi.distinct_mentees_with_recap,
  kpi.total_mentees,
  kpi.pct_mentees_with_recap,
  kpi.source_name
FROM public.season_monthly_kpis kpi
JOIN public.seasons s ON s.id = kpi.season_id
WHERE s.code = 'UEHM-S11'
  AND kpi.month_value IN ('2026-02', '2026-03', '2026-04')
ORDER BY kpi.month_value;

SELECT
  'latest_closed_month_view' AS check_name,
  s.code AS season_code,
  latest.latest_closed_month,
  latest.previous_closed_month,
  latest.total_recap_entries,
  latest.distinct_mentees_with_recap
FROM public.v_season_latest_closed_month latest
JOIN public.seasons s ON s.id = latest.season_id
WHERE s.code = 'UEHM-S11';

-- If validation passes, manually COMMIT.
-- If validation fails, manually ROLLBACK.
--
-- COMMIT;
-- ROLLBACK;
