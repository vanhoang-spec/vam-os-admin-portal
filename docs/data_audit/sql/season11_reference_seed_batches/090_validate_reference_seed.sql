-- Season 11 Staging Reference Seed Batch Pack
-- REVIEW ONLY. STAGING ONLY. DO NOT RUN ON PRODUCTION.
--
-- Contains sensitive MVP reference seed data. Keep local and do not commit unless explicitly approved.
-- Generated from SEASON11_STAGING_REFERENCE_SEED_SUPABASE_SQL_EDITOR_EXECUTION.sql.
-- Run this file last, after all 010/020/030/040 seed batches are loaded.
-- It validates helper row counts, upserts into application tables, and outputs validation counts.
-- Transaction guidance: default final action is ROLLBACK for review. Change the final action to COMMIT only after validation is correct.

BEGIN;
CREATE OR REPLACE FUNCTION pg_temp._season11_nullish(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    WHEN btrim(value) = '' THEN NULL
    WHEN lower(btrim(value)) = 'null' THEN NULL
    ELSE value
  END
$$;

DO $$
DECLARE
  v_people_count int;
  v_mentor_count int;
  v_mentee_count int;
  v_match_count int;
  v_season_id uuid;
  v_missing_profile_people int;
  v_bad_match_people int;
  v_bad_match_profiles int;
BEGIN
  SELECT count(*) INTO v_people_count FROM public.staging_reference_seed_people;
  SELECT count(*) INTO v_mentor_count FROM public.staging_reference_seed_mentor_profiles;
  SELECT count(*) INTO v_mentee_count FROM public.staging_reference_seed_mentee_profiles;
  SELECT count(*) INTO v_match_count FROM public.staging_reference_seed_matches;

  IF v_people_count <> 1331 THEN
    RAISE EXCEPTION 'Guardrail failed: expected 1331 people rows, got %', v_people_count;
  END IF;
  IF v_mentor_count <> 448 THEN
    RAISE EXCEPTION 'Guardrail failed: expected 448 mentor profile rows, got %', v_mentor_count;
  END IF;
  IF v_mentee_count <> 654 THEN
    RAISE EXCEPTION 'Guardrail failed: expected 654 mentee profile rows, got %', v_mentee_count;
  END IF;
  IF v_match_count <> 637 THEN
    RAISE EXCEPTION 'Guardrail failed: expected 637 UEHM-S11 match rows, got %', v_match_count;
  END IF;

  SELECT id INTO v_season_id
  FROM public.seasons
  WHERE code = 'UEHM-S11'
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Guardrail failed: staging season code UEHM-S11 does not exist. Seed/create the season first.';
  END IF;

  SELECT count(*) INTO v_missing_profile_people
  FROM (
    SELECT person_id FROM public.staging_reference_seed_mentor_profiles
    UNION ALL
    SELECT person_id FROM public.staging_reference_seed_mentee_profiles
  ) profile_people
  LEFT JOIN public.staging_reference_seed_people p ON p.id = profile_people.person_id
  WHERE profile_people.person_id IS NOT NULL
    AND trim(profile_people.person_id) <> ''
    AND p.id IS NULL;

  IF v_missing_profile_people <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % profile rows reference people not present in MVP people export.', v_missing_profile_people;
  END IF;

  SELECT count(*) INTO v_bad_match_people
  FROM public.staging_reference_seed_matches m
  LEFT JOIN public.staging_reference_seed_people mentor_person ON mentor_person.id = m.mentor_person_id
  LEFT JOIN public.staging_reference_seed_people mentee_person ON mentee_person.id = m.mentee_person_id
  WHERE mentor_person.id IS NULL OR mentee_person.id IS NULL;

  IF v_bad_match_people <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % match rows reference people not present in MVP people export.', v_bad_match_people;
  END IF;

  SELECT count(*) INTO v_bad_match_profiles
  FROM public.staging_reference_seed_matches m
  LEFT JOIN public.staging_reference_seed_mentor_profiles mentor_profile ON mentor_profile.person_id = m.mentor_person_id
  LEFT JOIN public.staging_reference_seed_mentee_profiles mentee_profile ON mentee_profile.person_id = m.mentee_person_id
  WHERE mentor_profile.person_id IS NULL OR mentee_profile.person_id IS NULL;

  IF v_bad_match_profiles <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % match rows reference mentor/mentee people without matching MVP profile rows.', v_bad_match_profiles;
  END IF;
END $$;

CREATE TEMP TABLE IF NOT EXISTS _season11_apply_counts (
  metric text PRIMARY KEY,
  row_count int NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE _season11_apply_counts;

CREATE TEMP TABLE IF NOT EXISTS _season11_apply_column_plan (
  table_name text PRIMARY KEY,
  target_columns text NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE _season11_apply_column_plan;

DO $$
DECLARE
  v_columns text;
  v_selects text;
  v_update_set text;
  v_count int;
BEGIN
  SELECT
    string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
    string_agg(select_expression, ', ' ORDER BY ordinal_position),
    string_agg(
      CASE
        WHEN column_name IN ('id', 'created_at') THEN NULL
        WHEN column_name = 'updated_at' THEN format('%I = now()', column_name)
        ELSE format('%I = COALESCE(EXCLUDED.%I, public.people.%I)', column_name, column_name, column_name)
      END,
      ', ' ORDER BY ordinal_position
    )
    INTO v_columns, v_selects, v_update_set
  FROM (
    VALUES
      (1, 'id', 'p.id::uuid'),
      (2, 'full_name', 'pg_temp._season11_nullish(p.full_name)'),
      (3, 'email_primary', 'pg_temp._season11_nullish(p.email_primary)'),
      (4, 'phone_primary', 'pg_temp._season11_nullish(p.phone_primary)'),
      (5, 'gender', 'pg_temp._season11_nullish(p.gender)'),
      (6, 'source_sheets', 'pg_temp._season11_nullish(p.source_sheets)'),
      (7, 'data_quality_flags', 'pg_temp._season11_nullish(p.data_quality_flags)'),
      (8, 'created_at', 'COALESCE(pg_temp._season11_nullish(p.created_at)::timestamptz, now())'),
      (9, 'updated_at', 'COALESCE(pg_temp._season11_nullish(p.updated_at)::timestamptz, now())')
  ) AS allowed(ordinal_position, column_name, select_expression)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'people'
   AND c.column_name = allowed.column_name;

  IF v_columns IS NULL OR position('id' IN v_columns) = 0 THEN
    RAISE EXCEPTION 'Guardrail failed: public.people target column plan is empty or missing id.';
  END IF;

  EXECUTE format($sql$
    WITH person_roles AS (
      SELECT
        p.id,
        EXISTS (
          SELECT 1 FROM public.staging_reference_seed_mentor_profiles mp
          WHERE mp.person_id = p.id
        ) AS is_mentor,
        EXISTS (
          SELECT 1 FROM public.staging_reference_seed_mentee_profiles mp
          WHERE mp.person_id = p.id
        ) AS is_mentee
      FROM public.staging_reference_seed_people p
    ), upsert_people AS (
      INSERT INTO public.people (%s)
      SELECT %s
      FROM public.staging_reference_seed_people p
      JOIN person_roles pr ON pr.id = p.id
      ON CONFLICT (id) DO UPDATE SET %s
      RETURNING id
    )
    SELECT count(*) FROM upsert_people
  $sql$, v_columns, v_selects, v_update_set)
  INTO v_count;

  INSERT INTO _season11_apply_counts(metric, row_count)
  VALUES ('people_upserted', v_count);

  INSERT INTO _season11_apply_column_plan(table_name, target_columns)
  VALUES ('people', v_columns);

  SELECT
    string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
    string_agg(select_expression, ', ' ORDER BY ordinal_position),
    string_agg(
      CASE
        WHEN column_name IN ('id', 'created_at') THEN NULL
        WHEN column_name = 'updated_at' THEN format('%I = now()', column_name)
        WHEN column_name = 'person_id' THEN 'person_id = EXCLUDED.person_id'
        ELSE format('%I = COALESCE(EXCLUDED.%I, public.mentor_profiles.%I)', column_name, column_name, column_name)
      END,
      ', ' ORDER BY ordinal_position
    )
    INTO v_columns, v_selects, v_update_set
  FROM (
    VALUES
      (1, 'id', 'id::uuid'),
      (2, 'person_id', 'person_id::uuid'),
      (3, 'mentor_code', 'pg_temp._season11_nullish(mentor_code)'),
      (4, 'bio_url', 'pg_temp._season11_nullish(bio_url)'),
      (5, 'company_current', 'pg_temp._season11_nullish(company_current)'),
      (6, 'title_current', 'pg_temp._season11_nullish(title_current)'),
      (7, 'alma_mater', 'pg_temp._season11_nullish(alma_mater)'),
      (8, 'first_joined_year', 'CASE WHEN pg_temp._season11_nullish(first_joined_year) ~ ''^[0-9]+$'' THEN first_joined_year::int ELSE NULL END'),
      (9, 'years_experience_min', 'CASE WHEN pg_temp._season11_nullish(years_experience_min) ~ ''^[0-9]+$'' THEN years_experience_min::int ELSE NULL END'),
      (10, 'years_experience_text', 'pg_temp._season11_nullish(years_experience_text)'),
      (11, 'interests_text', 'pg_temp._season11_nullish(interests_text)'),
      (12, 'support_team_lead', 'pg_temp._season11_nullish(support_team_lead)'),
      (13, 'admin_notes', 'pg_temp._season11_nullish(admin_notes)'),
      (14, 'source_sheet', 'pg_temp._season11_nullish(source_sheet)'),
      (15, 'source_row_id', 'pg_temp._season11_nullish(source_row_id)'),
      (16, 'created_at', 'COALESCE(pg_temp._season11_nullish(created_at)::timestamptz, now())'),
      (17, 'updated_at', 'COALESCE(pg_temp._season11_nullish(updated_at)::timestamptz, now())'),
      (18, 'current_company', 'pg_temp._season11_nullish(current_company)'),
      (19, 'current_title', 'pg_temp._season11_nullish(current_title)'),
      (20, 'industry', 'pg_temp._season11_nullish(industry)'),
      (21, 'function_area', 'pg_temp._season11_nullish(function_area)'),
      (22, 'years_of_experience', 'CASE WHEN pg_temp._season11_nullish(years_of_experience) ~ ''^[0-9]+$'' THEN years_of_experience::int ELSE NULL END'),
      (23, 'years_in_vam', 'CASE WHEN pg_temp._season11_nullish(years_in_vam) ~ ''^[0-9]+$'' THEN years_in_vam::int ELSE NULL END'),
      (24, 'capacity_target', 'CASE WHEN pg_temp._season11_nullish(capacity_target) ~ ''^[0-9]+$'' THEN capacity_target::int ELSE NULL END'),
      (25, 'seniority_level', 'pg_temp._season11_nullish(seniority_level)')
  ) AS allowed(ordinal_position, column_name, select_expression)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'mentor_profiles'
   AND c.column_name = allowed.column_name;

  IF v_columns IS NULL OR position('id' IN v_columns) = 0 OR position('person_id' IN v_columns) = 0 THEN
    RAISE EXCEPTION 'Guardrail failed: public.mentor_profiles target column plan is empty or missing id/person_id.';
  END IF;

  EXECUTE format($sql$
    WITH upsert_mentor_profiles AS (
      INSERT INTO public.mentor_profiles (%s)
      SELECT %s
      FROM public.staging_reference_seed_mentor_profiles
      ON CONFLICT (id) DO UPDATE SET %s
      RETURNING id
    )
    SELECT count(*) FROM upsert_mentor_profiles
  $sql$, v_columns, v_selects, v_update_set)
  INTO v_count;

  INSERT INTO _season11_apply_counts(metric, row_count)
  VALUES ('mentor_profiles_upserted', v_count);

  INSERT INTO _season11_apply_column_plan(table_name, target_columns)
  VALUES ('mentor_profiles', v_columns);

  SELECT
    string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
    string_agg(select_expression, ', ' ORDER BY ordinal_position),
    string_agg(
      CASE
        WHEN column_name IN ('id', 'created_at') THEN NULL
        WHEN column_name = 'updated_at' THEN format('%I = now()', column_name)
        WHEN column_name = 'person_id' THEN 'person_id = EXCLUDED.person_id'
        ELSE format('%I = COALESCE(EXCLUDED.%I, public.mentee_profiles.%I)', column_name, column_name, column_name)
      END,
      ', ' ORDER BY ordinal_position
    )
    INTO v_columns, v_selects, v_update_set
  FROM (
    VALUES
      (1, 'id', 'id::uuid'),
      (2, 'person_id', 'person_id::uuid'),
      (3, 'mentee_code', 'pg_temp._season11_nullish(mentee_code)'),
      (4, 'school_code', 'pg_temp._season11_nullish(school_code)'),
      (5, 'school_raw', 'pg_temp._season11_nullish(school_raw)'),
      (6, 'mssv', 'pg_temp._season11_nullish(mssv)'),
      (7, 'mssv_raw', 'pg_temp._season11_nullish(mssv_raw)'),
      (8, 'major', 'pg_temp._season11_nullish(major)'),
      (9, 'class_cohort', 'pg_temp._season11_nullish(class_cohort)'),
      (10, 'gpa_4', 'CASE WHEN pg_temp._season11_nullish(gpa_4) ~ ''^[0-9]+(\.[0-9]+)?$'' THEN gpa_4::numeric ELSE NULL END'),
      (11, 'has_prior_season', 'CASE lower(trim(has_prior_season)) WHEN ''true'' THEN true WHEN ''false'' THEN false ELSE NULL END'),
      (12, 'source_sheet', 'pg_temp._season11_nullish(source_sheet)'),
      (13, 'source_row_id', 'pg_temp._season11_nullish(source_row_id)'),
      (14, 'created_at', 'COALESCE(pg_temp._season11_nullish(created_at)::timestamptz, now())'),
      (15, 'updated_at', 'COALESCE(pg_temp._season11_nullish(updated_at)::timestamptz, now())'),
      (16, 'university', 'pg_temp._season11_nullish(university)'),
      (17, 'career_interest', 'pg_temp._season11_nullish(career_interest)'),
      (18, 'target_industry', 'pg_temp._season11_nullish(target_industry)'),
      (19, 'year_of_study', 'pg_temp._season11_nullish(year_of_study)'),
      (20, 'support_team', 'pg_temp._season11_nullish(support_team)')
  ) AS allowed(ordinal_position, column_name, select_expression)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'mentee_profiles'
   AND c.column_name = allowed.column_name;

  IF v_columns IS NULL OR position('id' IN v_columns) = 0 OR position('person_id' IN v_columns) = 0 THEN
    RAISE EXCEPTION 'Guardrail failed: public.mentee_profiles target column plan is empty or missing id/person_id.';
  END IF;

  EXECUTE format($sql$
    WITH upsert_mentee_profiles AS (
      INSERT INTO public.mentee_profiles (%s)
      SELECT %s
      FROM public.staging_reference_seed_mentee_profiles
      ON CONFLICT (id) DO UPDATE SET %s
      RETURNING id
    )
    SELECT count(*) FROM upsert_mentee_profiles
  $sql$, v_columns, v_selects, v_update_set)
  INTO v_count;

  INSERT INTO _season11_apply_counts(metric, row_count)
  VALUES ('mentee_profiles_upserted', v_count);

  INSERT INTO _season11_apply_column_plan(table_name, target_columns)
  VALUES ('mentee_profiles', v_columns);

  SELECT
    string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
    string_agg(select_expression, ', ' ORDER BY ordinal_position),
    string_agg(
      CASE
        WHEN column_name IN ('id', 'created_at') THEN NULL
        WHEN column_name = 'updated_at' THEN format('%I = now()', column_name)
        WHEN column_name IN ('season_id', 'mentee_person_id', 'mentor_person_id') THEN format('%I = EXCLUDED.%I', column_name, column_name)
        ELSE format('%I = COALESCE(EXCLUDED.%I, public.matches.%I)', column_name, column_name, column_name)
      END,
      ', ' ORDER BY ordinal_position
    )
    INTO v_columns, v_selects, v_update_set
  FROM (
    VALUES
      (1, 'id', 'm.id::uuid'),
      (2, 'legacy_match_temp_id', 'pg_temp._season11_nullish(m.legacy_match_temp_id)'),
      (3, 'season_id', 'ts.id'),
      (4, 'mentee_person_id', 'm.mentee_person_id::uuid'),
      (5, 'mentor_person_id', 'm.mentor_person_id::uuid'),
      (6, 'match_type', 'pg_temp._season11_nullish(m.match_type)'),
      (7, 'match_source_raw', 'pg_temp._season11_nullish(m.match_source_raw)'),
      (8, 'match_confidence', 'CASE WHEN pg_temp._season11_nullish(m.match_confidence) ~ ''^[0-9]+(\.[0-9]+)?$'' THEN m.match_confidence::numeric ELSE NULL END'),
      (9, 'status', 'COALESCE(pg_temp._season11_nullish(m.status), ''active'')'),
      (10, 'notes', 'pg_temp._season11_nullish(m.notes)'),
      (11, 'source_sheet', 'pg_temp._season11_nullish(m.source_sheet)'),
      (12, 'source_row_id', 'pg_temp._season11_nullish(m.source_row_id)'),
      (13, 'created_at', 'COALESCE(pg_temp._season11_nullish(m.created_at)::timestamptz, now())'),
      (14, 'updated_at', 'COALESCE(pg_temp._season11_nullish(m.updated_at)::timestamptz, now())')
  ) AS allowed(ordinal_position, column_name, select_expression)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'matches'
   AND c.column_name = allowed.column_name;

  IF v_columns IS NULL
     OR position('id' IN v_columns) = 0
     OR position('season_id' IN v_columns) = 0
     OR position('mentee_person_id' IN v_columns) = 0
     OR position('mentor_person_id' IN v_columns) = 0 THEN
    RAISE EXCEPTION 'Guardrail failed: public.matches target column plan is empty or missing required IDs.';
  END IF;

  EXECUTE format($sql$
    WITH target_season AS (
      SELECT id FROM public.seasons WHERE code = 'UEHM-S11' LIMIT 1
    ), upsert_matches AS (
      INSERT INTO public.matches (%s)
      SELECT %s
      FROM public.staging_reference_seed_matches m
      CROSS JOIN target_season ts
      ON CONFLICT (id) DO UPDATE SET %s
      RETURNING id
    )
    SELECT count(*) FROM upsert_matches
  $sql$, v_columns, v_selects, v_update_set)
  INTO v_count;

  INSERT INTO _season11_apply_counts(metric, row_count)
  VALUES ('uehm_s11_matches_upserted', v_count);

  INSERT INTO _season11_apply_column_plan(table_name, target_columns)
  VALUES ('matches', v_columns);
END $$;

-- Review the exact application-table columns selected from the live staging schema.
SELECT table_name, target_columns
FROM _season11_apply_column_plan
ORDER BY table_name;

SELECT
  (SELECT row_count FROM _season11_apply_counts WHERE metric = 'people_upserted') AS people_upserted,
  (SELECT row_count FROM _season11_apply_counts WHERE metric = 'mentor_profiles_upserted') AS mentor_profiles_upserted,
  (SELECT row_count FROM _season11_apply_counts WHERE metric = 'mentee_profiles_upserted') AS mentee_profiles_upserted,
  (SELECT row_count FROM _season11_apply_counts WHERE metric = 'uehm_s11_matches_upserted') AS uehm_s11_matches_upserted;

-- Validation summary: expected all counts to match MVP export row counts.
WITH target_season AS (
  SELECT id FROM public.seasons WHERE code = 'UEHM-S11' LIMIT 1
)
SELECT 'people_seeded' AS check_name, count(*) AS actual_count, 1331 AS expected_count
FROM public.people p
JOIN public.staging_reference_seed_people seed ON seed.id::uuid = p.id
UNION ALL
SELECT 'mentor_profiles_seeded', count(*), 448
FROM public.mentor_profiles mp
JOIN public.staging_reference_seed_mentor_profiles seed ON seed.id::uuid = mp.id
UNION ALL
SELECT 'mentee_profiles_seeded', count(*), 654
FROM public.mentee_profiles mp
JOIN public.staging_reference_seed_mentee_profiles seed ON seed.id::uuid = mp.id
UNION ALL
SELECT 'uehm_s11_matches_seeded', count(*), 637
FROM public.matches m
JOIN public.staging_reference_seed_matches seed ON seed.id::uuid = m.id
JOIN target_season ts ON ts.id = m.season_id;

-- Validation summary: March approved sample IDs should now exist in people and profiles.
WITH sample_ids(role_name, person_id, source_row_id) AS (
  VALUES
  ('mentor', '271dc407-440b-4dfa-8ef5-c73eabe3c327'::uuid, 'Cleaning data:1559'),
  ('mentee', 'b6faa8d2-cd86-4e59-8fb8-e699abbfc6e1'::uuid, 'Cleaning data:1559'),
  ('mentor', '7075e97c-b3be-43e0-896b-1161b80942b7'::uuid, 'Cleaning data:1561'),
  ('mentee', '204d7905-f802-4b26-a464-c8d26838538f'::uuid, 'Cleaning data:1561'),
  ('mentor', 'f823f48b-a3b9-409a-91d2-f49c6ac119a5'::uuid, 'Cleaning data:1562'),
  ('mentee', '14f8f3d1-9a14-4fc2-9567-c524235e0b1e'::uuid, 'Cleaning data:1562'),
  ('mentor', 'fcf7d740-f498-494b-9160-81f089e46f50'::uuid, 'Cleaning data:1563'),
  ('mentee', 'ef7948cc-7f20-418c-b117-42f4baae88a2'::uuid, 'Cleaning data:1563'),
  ('mentor', 'b69717a0-020c-4a58-8be2-6b472c5a64e8'::uuid, 'Cleaning data:1564'),
  ('mentee', '38ee5d98-71d8-4eaa-bde8-46231270aef0'::uuid, 'Cleaning data:1564'),
  ('mentor', '7ff91bfc-4f78-4929-8234-5d97a02d834b'::uuid, 'Cleaning data:1565'),
  ('mentee', 'a0aa9393-3e51-4b6e-9a9e-b1c497effe04'::uuid, 'Cleaning data:1565'),
  ('mentor', '12c38a0c-e520-41a0-815c-30c6bb205ff1'::uuid, 'Cleaning data:1567'),
  ('mentee', '2a573d11-8f13-4858-816b-32a8b7d76c14'::uuid, 'Cleaning data:1567'),
  ('mentor', '51820d6c-d79f-4663-909e-b0dcf5f51bca'::uuid, 'Cleaning data:1568'),
  ('mentee', '35ad4d8f-c6ed-4161-8705-8993f6d8a025'::uuid, 'Cleaning data:1568'),
  ('mentor', '5764f75a-7000-441a-a2d9-b5423421e147'::uuid, 'Cleaning data:1569'),
  ('mentee', 'aaed9c25-5cee-439f-8712-553f9ed47e45'::uuid, 'Cleaning data:1569'),
  ('mentor', '919e7cc8-e9f2-4d13-8152-ba1fc21b941b'::uuid, 'Cleaning data:1571'),
  ('mentee', '6a563f8c-3499-4804-a7f5-9954d3e0d99c'::uuid, 'Cleaning data:1571')
)
SELECT
  role_name,
  person_id,
  source_row_id,
  EXISTS (SELECT 1 FROM public.people p WHERE p.id = sample_ids.person_id) AS exists_in_people,
  CASE
    WHEN role_name = 'mentor' THEN EXISTS (SELECT 1 FROM public.mentor_profiles mp WHERE mp.person_id = sample_ids.person_id)
    WHEN role_name = 'mentee' THEN EXISTS (SELECT 1 FROM public.mentee_profiles mp WHERE mp.person_id = sample_ids.person_id)
    ELSE false
  END AS exists_in_expected_profile
FROM sample_ids
ORDER BY source_row_id, role_name;

-- Manual final action for staging reviewer:
-- This file starts a transaction and defaults to ROLLBACK so the first execution is review-safe.
-- After reviewing all result sets, run this file again and change the final action to COMMIT only if everything is correct.
-- 1. Review both validation result sets above.
-- 2. If counts and sample checks are correct, uncomment COMMIT.
-- 3. If anything is unexpected, uncomment ROLLBACK.

ROLLBACK;
-- COMMIT;

