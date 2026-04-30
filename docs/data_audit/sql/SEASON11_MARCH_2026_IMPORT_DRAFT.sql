-- Season 11 March 2026 Import Draft
-- REVIEW ONLY. DO NOT EXECUTE UNTIL STAGING APPROVAL.
--
-- This is not a migration and not an automated import script.
-- Intended target: Supabase STAGING only.
--
-- Business decision recorded 2026-04-30:
-- - Import approved/import-eligible March rows into public.mentoring_recaps.
-- - Do not import missing_mentor, missing_mentee, duplicate_existing, or hard needs_review blockers.
-- - Import missing_match rows only when mentor_person_id and mentee_person_id are valid; set match_id = null and log warning.
-- - Placeholder recap URLs are accepted for staging, but must be logged as warning/info.
-- - Log excluded rows to public.data_quality_issues.
-- - Upsert the official March KPI snapshot as closed.
-- - Do not touch April.
-- - Do not rewrite dashboard RPCs.
--
-- Source artifacts:
-- - data_imports/season11/season11_march_import_approved_rows.csv
-- - data_imports/season11/season11_march_import_excluded_qa_rows.csv
--
-- Current source counts:
-- - approved/import-eligible rows: 236
--   - mapped: 20
--   - mapped_with_warnings: 205
--   - missing_match imported with match_id = null: 11
-- - excluded QA rows: 50
--   - missing_mentor: 42
--   - missing_mentee: 4
--   - needs_review: 4
--
-- Manual loading requirement:
-- Before running the transaction, create and populate these TEMP tables
-- from the two CSV files in the same SQL session. The easiest path depends
-- on the SQL client. In psql, use \copy after creating the temp tables.
--
-- CREATE TEMP TABLE _season11_march_import_approved (
--   source_row_id text,
--   source_sheet text,
--   source_file text,
--   meeting_date text,
--   meeting_month text,
--   mentor_person_id text,
--   mentee_person_id text,
--   match_id text,
--   recap_url text,
--   recap_note text,
--   meeting_type text,
--   mapping_status text,
--   mapping_notes text,
--   approved_for_import text,
--   review_note text
-- ) ON COMMIT DROP;
--
-- CREATE TEMP TABLE _season11_march_import_excluded (
--   source_row_id text,
--   source_sheet text,
--   source_file text,
--   meeting_date text,
--   meeting_month text,
--   mentor_person_id text,
--   mentee_person_id text,
--   match_id text,
--   recap_url text,
--   recap_note text,
--   meeting_type text,
--   mapping_status text,
--   mapping_notes text,
--   approved_for_import text,
--   review_note text
-- ) ON COMMIT DROP;
--
-- Example psql load commands, adjusted for local paths:
-- \copy _season11_march_import_approved from 'data_imports/season11/season11_march_import_approved_rows.csv' with (format csv, header true)
-- \copy _season11_march_import_excluded from 'data_imports/season11/season11_march_import_excluded_qa_rows.csv' with (format csv, header true)

BEGIN;

-- 0. Guardrails: required temp tables and expected source counts.
DO $$
BEGIN
  IF to_regclass('pg_temp._season11_march_import_approved') IS NULL THEN
    RAISE EXCEPTION 'Temp table _season11_march_import_approved is missing. Load approved CSV before running.';
  END IF;

  IF to_regclass('pg_temp._season11_march_import_excluded') IS NULL THEN
    RAISE EXCEPTION 'Temp table _season11_march_import_excluded is missing. Load excluded QA CSV before running.';
  END IF;

  IF (SELECT count(*) FROM _season11_march_import_approved) <> 236 THEN
    RAISE EXCEPTION 'Expected 236 approved/import-eligible rows, found %.', (SELECT count(*) FROM _season11_march_import_approved);
  END IF;

  IF (SELECT count(*) FROM _season11_march_import_excluded) <> 50 THEN
    RAISE EXCEPTION 'Expected 50 excluded QA rows, found %.', (SELECT count(*) FROM _season11_march_import_excluded);
  END IF;
END;
$$;

-- 1. Create import batch as pending.
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
    'season11_march_import_approved_rows.csv',
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

-- 2. Normalize approved/import-eligible rows.
CREATE TEMP TABLE _season11_march_approved_normalized ON COMMIT DROP AS
SELECT
  ctx.batch_id,
  ctx.season_id,
  nullif(trim(src.source_row_id), '') AS source_row_id,
  nullif(trim(src.source_sheet), '') AS source_sheet,
  nullif(trim(src.source_file), '') AS source_file,
  nullif(trim(src.meeting_date), '')::date AS meeting_date,
  coalesce(nullif(trim(src.meeting_month), ''), '2026-03') AS meeting_month,
  nullif(trim(src.mentor_person_id), '')::uuid AS mentor_person_id,
  nullif(trim(src.mentee_person_id), '')::uuid AS mentee_person_id,
  CASE
    WHEN src.mapping_status = 'missing_match' THEN NULL::uuid
    ELSE nullif(trim(src.match_id), '')::uuid
  END AS match_id,
  nullif(trim(src.recap_url), '') AS recap_url,
  nullif(trim(src.recap_note), '') AS recap_note,
  coalesce(nullif(trim(src.meeting_type), ''), 'mentoring') AS meeting_type,
  nullif(trim(src.mapping_status), '') AS mapping_status,
  nullif(trim(src.mapping_notes), '') AS mapping_notes,
  coalesce(nullif(trim(src.approved_for_import), ''), 'false') AS approved_for_import,
  nullif(trim(src.review_note), '') AS review_note,
  src.recap_url LIKE 'https://system.local/missing-url%' AS uses_placeholder_url,
  src.mapping_status = 'missing_match' AS imported_without_match
FROM _season11_march_import_approved src
CROSS JOIN _season11_march_import_context ctx;

-- 3. Validate approved/import-eligible rows before any insert.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _season11_march_approved_normalized
    WHERE meeting_month <> '2026-03'
       OR meeting_date < date '2026-03-01'
       OR meeting_date >= date '2026-04-01'
  ) THEN
    RAISE EXCEPTION 'Approved rows include non-March meeting dates.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _season11_march_approved_normalized
    WHERE mapping_status IN ('missing_mentor', 'missing_mentee', 'duplicate_existing', 'needs_review')
  ) THEN
    RAISE EXCEPTION 'Approved rows include hard blocker mapping statuses.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _season11_march_approved_normalized
    WHERE mentor_person_id IS NULL
       OR mentee_person_id IS NULL
       OR recap_url IS NULL
  ) THEN
    RAISE EXCEPTION 'Approved rows include missing mentor_person_id, mentee_person_id, or recap_url.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _season11_march_approved_normalized approved
    LEFT JOIN public.people mentor ON mentor.id = approved.mentor_person_id
    LEFT JOIN public.people mentee ON mentee.id = approved.mentee_person_id
    LEFT JOIN public.mentor_profiles mentor_profile ON mentor_profile.person_id = approved.mentor_person_id
    LEFT JOIN public.mentee_profiles mentee_profile ON mentee_profile.person_id = approved.mentee_person_id
    WHERE mentor.id IS NULL
       OR mentee.id IS NULL
       OR mentor_profile.person_id IS NULL
       OR mentee_profile.person_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Approved rows include mentor/mentee IDs that do not exist in people/profile tables.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _season11_march_approved_normalized approved
    LEFT JOIN public.matches m ON m.id = approved.match_id
    WHERE approved.match_id IS NOT NULL
      AND (
        m.id IS NULL
        OR m.season_id <> approved.season_id
        OR m.mentor_person_id <> approved.mentor_person_id
        OR m.mentee_person_id <> approved.mentee_person_id
      )
  ) THEN
    RAISE EXCEPTION 'Approved rows include match_id values that do not match season/mentor/mentee.';
  END IF;
END;
$$;

-- 4. Log excluded rows as QA issues.
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
  'recap_source_row',
  NULL,
  coalesce(nullif(trim(excluded.mapping_status), ''), 'excluded_from_march_import') AS issue_type,
  'block' AS severity,
  CASE coalesce(nullif(trim(excluded.mapping_status), ''), 'excluded_from_march_import')
    WHEN 'missing_mentor' THEN 'Excluded from staging import: mentor_person_id unresolved.'
    WHEN 'missing_mentee' THEN 'Excluded from staging import: mentee_person_id unresolved.'
    WHEN 'duplicate_existing' THEN 'Excluded from staging import: duplicate existing recap candidate.'
    WHEN 'needs_review' THEN 'Excluded from staging import: hard needs_review blocker.'
    ELSE 'Excluded from staging import by manual review policy.'
  END AS description,
  to_jsonb(excluded) || jsonb_build_object(
    'source_row_id', excluded.source_row_id,
    'policy', 'season11_march_staging_import_2026_04_30'
  ) AS raw_data
FROM _season11_march_import_excluded excluded
CROSS JOIN _season11_march_import_context ctx;

-- 5. Log imported missing-match rows as warnings.
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
  NULL,
  'missing_match_imported_with_null_match_id',
  'warning',
  'Imported staging recap with valid mentor_person_id and mentee_person_id but null match_id by approved March policy.',
  to_jsonb(approved) || jsonb_build_object('source_row_id', source_row_id)
FROM _season11_march_approved_normalized approved
WHERE imported_without_match;

-- 6. Log placeholder URLs as info.
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
  NULL,
  'placeholder_recap_url',
  'info',
  'Imported staging recap uses a generated placeholder recap URL accepted by staging policy.',
  to_jsonb(approved) || jsonb_build_object('source_row_id', source_row_id, 'recap_url', recap_url)
FROM _season11_march_approved_normalized approved
WHERE uses_placeholder_url;

-- 7. Insert approved/import-eligible rows into mentoring_recaps.
-- Exact existing duplicates are skipped defensively even though current duplicate_existing count is zero.
CREATE TEMP TABLE _season11_march_inserted_recaps ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.mentoring_recaps (
    match_id,
    meeting_month,
    season_id,
    status,
    mentor_person_id,
    mentee_person_id,
    meeting_date,
    recap_url,
    recap_source,
    recap_note,
    meeting_type,
    captured_by,
    issue_flag,
    admin_notes
  )
  SELECT
    approved.match_id,
    '2026-03',
    approved.season_id,
    'submitted',
    approved.mentor_person_id,
    approved.mentee_person_id,
    approved.meeting_date,
    approved.recap_url,
    'season11_march_staging_import',
    approved.recap_note,
    approved.meeting_type,
    'manual_staging_review',
    approved.uses_placeholder_url OR approved.imported_without_match,
    concat_ws(
      ' ',
      'Season 11 March staging import.',
      'source_row_id=' || approved.source_row_id || '.',
      CASE WHEN approved.uses_placeholder_url THEN 'placeholder_url_accepted.' END,
      CASE WHEN approved.imported_without_match THEN 'imported_with_null_match_id.' END,
      'Official KPI snapshot differs from raw imported count by accepted business decision.'
    )
  FROM _season11_march_approved_normalized approved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.mentoring_recaps existing
    WHERE existing.season_id = approved.season_id
      AND existing.meeting_date = approved.meeting_date
      AND existing.mentor_person_id = approved.mentor_person_id
      AND existing.mentee_person_id = approved.mentee_person_id
      AND existing.recap_url = approved.recap_url
      AND coalesce(trim(lower(existing.status)), '') NOT IN ('deleted', 'invalid')
  )
  RETURNING id
)
SELECT id FROM inserted;

-- 8. Log defensive duplicate skips, if any.
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
  approved.batch_id,
  'recap_source_row',
  NULL,
  'duplicate_existing_skipped',
  'warning',
  'Approved row was not inserted because an exact existing recap already exists.',
  to_jsonb(approved) || jsonb_build_object('source_row_id', approved.source_row_id)
FROM _season11_march_approved_normalized approved
WHERE EXISTS (
  SELECT 1
  FROM public.mentoring_recaps existing
  WHERE existing.season_id = approved.season_id
    AND existing.meeting_date = approved.meeting_date
    AND existing.mentor_person_id = approved.mentor_person_id
    AND existing.mentee_person_id = approved.mentee_person_id
    AND existing.recap_url = approved.recap_url
    AND existing.recap_source <> 'season11_march_staging_import'
    AND coalesce(trim(lower(existing.status)), '') NOT IN ('deleted', 'invalid')
);

-- 9. Upsert official March KPI snapshot as closed.
-- This is intentionally based on Bao cao Recap official KPI, not raw inserted row count.
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
  0,
  37.8,
  'Bao cao Recap',
  'TRACKING _ SEASON 11.xlsx',
  ctx.batch_id,
  concat_ws(
    ' ',
    'Official March KPI snapshot accepted for Season 11 staging import.',
    'Raw Cleaning data extraction has 286 March rows.',
    'Approved/import-eligible staging import set has 236 rows, including 11 missing_match rows imported with null match_id if transaction is executed.',
    'Rows excluded from import are logged to data_quality_issues.',
    'Discrepancy from raw imported count is accepted by business decision.'
  ),
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

-- 10. Mark batch completed with actual inserted row count.
UPDATE public.data_import_batches batch
SET
  status = 'completed',
  rows_processed = (SELECT count(*) FROM _season11_march_inserted_recaps),
  updated_at = now()
FROM _season11_march_import_context ctx
WHERE batch.id = ctx.batch_id;

-- 11. Manual review summary. Inspect these result sets before COMMIT.
SELECT 'approved_source_rows' AS metric, count(*) AS value FROM _season11_march_approved_normalized
UNION ALL
SELECT 'excluded_source_rows', count(*) FROM _season11_march_import_excluded
UNION ALL
SELECT 'inserted_recaps', count(*) FROM _season11_march_inserted_recaps
UNION ALL
SELECT 'placeholder_url_rows', count(*) FROM _season11_march_approved_normalized WHERE uses_placeholder_url
UNION ALL
SELECT 'missing_match_imported_rows', count(*) FROM _season11_march_approved_normalized WHERE imported_without_match;

SELECT *
FROM public.season_monthly_kpis kpi
JOIN _season11_march_import_context ctx ON ctx.season_id = kpi.season_id
WHERE kpi.month_value = '2026-03';

-- COMMIT only after manual staging review approves the summary above.
-- ROLLBACK;
-- COMMIT;
