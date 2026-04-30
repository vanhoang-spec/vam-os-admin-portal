-- Season 11 Staging Reference Seed Draft
-- REVIEW ONLY. STAGING ONLY. DO NOT RUN ON PRODUCTION.
--
-- Purpose:
-- - Seed real Season 11 MVP reference identities into Supabase staging before March recap import.
-- - Preserve MVP UUIDs used by data_imports/season11/season11_march_import_approved_rows.csv.
-- - Do not import March recaps. Do not rewrite dashboard RPCs. Do not delete validation data.
--
-- Expected temp tables:
-- - _season11_seed_people (1331 rows)
-- - _season11_seed_mentor_profiles (448 rows)
-- - _season11_seed_mentee_profiles (654 rows)
-- - _season11_seed_matches (637 rows)
--
-- Supabase SQL Editor users should run:
-- docs/data_audit/sql/SEASON11_STAGING_REFERENCE_SEED_SUPABASE_SQL_EDITOR_EXECUTION.sql
-- because it embeds INSERT statements for the temp tables.

CREATE TEMP TABLE _season11_seed_people (
  id text,
  legacy_person_temp_id text,
  full_name text,
  full_name_normalized text,
  email_primary text,
  phone_primary text,
  phone_raw text,
  gender text,
  date_of_birth text,
  facebook_url text,
  preferred_language text,
  consent_pdpa text,
  consent_pdpa_at text,
  consent_marketing_email text,
  source_sheets text,
  source_sheet text,
  source_row_id text,
  data_quality_flags text,
  created_at text,
  updated_at text
) ON COMMIT DROP;

CREATE TEMP TABLE _season11_seed_mentor_profiles (
  id text,
  person_id text,
  mentor_code text,
  bio_url text,
  company_current text,
  title_current text,
  alma_mater text,
  first_joined_year text,
  years_experience_min text,
  years_experience_text text,
  interests_text text,
  support_team_lead text,
  admin_notes text,
  source_sheet text,
  source_row_id text,
  created_at text,
  updated_at text,
  current_company text,
  current_title text,
  industry text,
  function_area text,
  years_of_experience text,
  years_in_vam text,
  capacity_target text,
  seniority_level text
) ON COMMIT DROP;

CREATE TEMP TABLE _season11_seed_mentee_profiles (
  id text,
  person_id text,
  mentee_code text,
  school_code text,
  school_raw text,
  mssv text,
  mssv_raw text,
  major text,
  class_cohort text,
  gpa_4 text,
  has_prior_season text,
  source_sheet text,
  source_row_id text,
  created_at text,
  updated_at text,
  university text,
  career_interest text,
  target_industry text,
  year_of_study text,
  support_team text
) ON COMMIT DROP;

CREATE TEMP TABLE _season11_seed_matches (
  id text,
  legacy_match_temp_id text,
  season_id text,
  mentee_person_id text,
  mentor_person_id text,
  match_type text,
  match_source_raw text,
  match_confidence text,
  status text,
  notes text,
  source_sheet text,
  source_row_id text,
  created_at text,
  updated_at text
) ON COMMIT DROP;

-- Load the temp tables above before running the transaction below.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp._season11_nullish(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $
  SELECT CASE
    WHEN value IS NULL THEN NULL
    WHEN btrim(value) = '' THEN NULL
    WHEN lower(btrim(value)) = 'null' THEN NULL
    ELSE value
  END
$;

DO $
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
  SELECT count(*) INTO v_people_count FROM _season11_seed_people;
  SELECT count(*) INTO v_mentor_count FROM _season11_seed_mentor_profiles;
  SELECT count(*) INTO v_mentee_count FROM _season11_seed_mentee_profiles;
  SELECT count(*) INTO v_match_count FROM _season11_seed_matches;

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
    SELECT person_id FROM _season11_seed_mentor_profiles
    UNION ALL
    SELECT person_id FROM _season11_seed_mentee_profiles
  ) profile_people
  LEFT JOIN _season11_seed_people p ON p.id = profile_people.person_id
  WHERE profile_people.person_id IS NOT NULL
    AND trim(profile_people.person_id) <> ''
    AND p.id IS NULL;

  IF v_missing_profile_people <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % profile rows reference people not present in MVP people export.', v_missing_profile_people;
  END IF;

  SELECT count(*) INTO v_bad_match_people
  FROM _season11_seed_matches m
  LEFT JOIN _season11_seed_people mentor_person ON mentor_person.id = m.mentor_person_id
  LEFT JOIN _season11_seed_people mentee_person ON mentee_person.id = m.mentee_person_id
  WHERE mentor_person.id IS NULL OR mentee_person.id IS NULL;

  IF v_bad_match_people <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % match rows reference people not present in MVP people export.', v_bad_match_people;
  END IF;

  SELECT count(*) INTO v_bad_match_profiles
  FROM _season11_seed_matches m
  LEFT JOIN _season11_seed_mentor_profiles mentor_profile ON mentor_profile.person_id = m.mentor_person_id
  LEFT JOIN _season11_seed_mentee_profiles mentee_profile ON mentee_profile.person_id = m.mentee_person_id
  WHERE mentor_profile.person_id IS NULL OR mentee_profile.person_id IS NULL;

  IF v_bad_match_profiles <> 0 THEN
    RAISE EXCEPTION 'Guardrail failed: % match rows reference mentor/mentee people without matching MVP profile rows.', v_bad_match_profiles;
  END IF;
END $$;

WITH person_roles AS (
  SELECT
    p.id,
    EXISTS (SELECT 1 FROM _season11_seed_mentor_profiles mp WHERE mp.person_id = p.id) AS is_mentor,
    EXISTS (SELECT 1 FROM _season11_seed_mentee_profiles mp WHERE mp.person_id = p.id) AS is_mentee
  FROM _season11_seed_people p
), upsert_people AS (
  INSERT INTO public.people (
    id,
    legacy_person_temp_id,
    full_name,
    full_name_normalized,
    email_primary,
    phone_primary,
    phone_raw,
    gender,
    date_of_birth,
    facebook_url,
    preferred_language,
    consent_pdpa,
    consent_pdpa_at,
    consent_marketing_email,
    source_sheets,
    source_sheet,
    source_row_id,
    created_at,
    updated_at
  )
  SELECT
    p.id::uuid,
    pg_temp._season11_nullish(p.legacy_person_temp_id),
    pg_temp._season11_nullish(p.full_name),
    pg_temp._season11_nullish(p.full_name_normalized),
    pg_temp._season11_nullish(p.email_primary),
    pg_temp._season11_nullish(p.phone_primary),
    pg_temp._season11_nullish(p.phone_raw),
    pg_temp._season11_nullish(p.gender),
    CASE WHEN pg_temp._season11_nullish(p.date_of_birth) IS NULL THEN NULL ELSE p.date_of_birth::date END,
    pg_temp._season11_nullish(p.facebook_url),
    pg_temp._season11_nullish(p.preferred_language),
    CASE lower(trim(p.consent_pdpa)) WHEN 'true' THEN true WHEN 'false' THEN false ELSE NULL END,
    CASE WHEN pg_temp._season11_nullish(p.consent_pdpa_at) IS NULL THEN NULL ELSE p.consent_pdpa_at::timestamptz END,
    CASE lower(trim(p.consent_marketing_email)) WHEN 'true' THEN true WHEN 'false' THEN false ELSE NULL END,
    pg_temp._season11_nullish(p.source_sheets),
    pg_temp._season11_nullish(p.source_sheet),
    pg_temp._season11_nullish(p.source_row_id),
    COALESCE(pg_temp._season11_nullish(p.created_at)::timestamptz, now()),
    COALESCE(pg_temp._season11_nullish(p.updated_at)::timestamptz, now())
  FROM _season11_seed_people p
  JOIN person_roles pr ON pr.id = p.id
  ON CONFLICT (id) DO UPDATE SET
    legacy_person_temp_id = COALESCE(EXCLUDED.legacy_person_temp_id, public.people.legacy_person_temp_id),
    full_name = COALESCE(EXCLUDED.full_name, public.people.full_name),
    full_name_normalized = COALESCE(EXCLUDED.full_name_normalized, public.people.full_name_normalized),
    email_primary = COALESCE(EXCLUDED.email_primary, public.people.email_primary),
    phone_primary = COALESCE(EXCLUDED.phone_primary, public.people.phone_primary),
    phone_raw = COALESCE(EXCLUDED.phone_raw, public.people.phone_raw),
    gender = COALESCE(EXCLUDED.gender, public.people.gender),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.people.date_of_birth),
    facebook_url = COALESCE(EXCLUDED.facebook_url, public.people.facebook_url),
    preferred_language = COALESCE(EXCLUDED.preferred_language, public.people.preferred_language),
    consent_pdpa = COALESCE(EXCLUDED.consent_pdpa, public.people.consent_pdpa),
    consent_pdpa_at = COALESCE(EXCLUDED.consent_pdpa_at, public.people.consent_pdpa_at),
    consent_marketing_email = COALESCE(EXCLUDED.consent_marketing_email, public.people.consent_marketing_email),
    source_sheets = COALESCE(EXCLUDED.source_sheets, public.people.source_sheets),
    source_sheet = COALESCE(EXCLUDED.source_sheet, public.people.source_sheet),
    source_row_id = COALESCE(EXCLUDED.source_row_id, public.people.source_row_id),
    updated_at = now()
  RETURNING id
), upsert_mentor_profiles AS (
  INSERT INTO public.mentor_profiles (
    id, person_id, mentor_code, bio_url, company_current, title_current, alma_mater,
    first_joined_year, years_experience_min, years_experience_text, interests_text,
    support_team_lead, admin_notes, source_sheet, source_row_id, created_at, updated_at,
    current_company, current_title, industry, function_area, years_of_experience,
    years_in_vam, capacity_target, seniority_level
  )
  SELECT
    id::uuid,
    person_id::uuid,
    pg_temp._season11_nullish(mentor_code),
    pg_temp._season11_nullish(bio_url),
    pg_temp._season11_nullish(company_current),
    pg_temp._season11_nullish(title_current),
    pg_temp._season11_nullish(alma_mater),
    CASE WHEN pg_temp._season11_nullish(first_joined_year) ~ '^[0-9]+$' THEN first_joined_year::int ELSE NULL END,
    CASE WHEN pg_temp._season11_nullish(years_experience_min) ~ '^[0-9]+$' THEN years_experience_min::int ELSE NULL END,
    pg_temp._season11_nullish(years_experience_text),
    pg_temp._season11_nullish(interests_text),
    pg_temp._season11_nullish(support_team_lead),
    pg_temp._season11_nullish(admin_notes),
    pg_temp._season11_nullish(source_sheet),
    pg_temp._season11_nullish(source_row_id),
    COALESCE(pg_temp._season11_nullish(created_at)::timestamptz, now()),
    COALESCE(pg_temp._season11_nullish(updated_at)::timestamptz, now()),
    pg_temp._season11_nullish(current_company),
    pg_temp._season11_nullish(current_title),
    pg_temp._season11_nullish(industry),
    pg_temp._season11_nullish(function_area),
    CASE WHEN pg_temp._season11_nullish(years_of_experience) ~ '^[0-9]+$' THEN years_of_experience::int ELSE NULL END,
    CASE WHEN pg_temp._season11_nullish(years_in_vam) ~ '^[0-9]+$' THEN years_in_vam::int ELSE NULL END,
    CASE WHEN pg_temp._season11_nullish(capacity_target) ~ '^[0-9]+$' THEN capacity_target::int ELSE NULL END,
    pg_temp._season11_nullish(seniority_level)
  FROM _season11_seed_mentor_profiles
  ON CONFLICT (id) DO UPDATE SET
    person_id = EXCLUDED.person_id,
    mentor_code = COALESCE(EXCLUDED.mentor_code, public.mentor_profiles.mentor_code),
    bio_url = COALESCE(EXCLUDED.bio_url, public.mentor_profiles.bio_url),
    company_current = COALESCE(EXCLUDED.company_current, public.mentor_profiles.company_current),
    title_current = COALESCE(EXCLUDED.title_current, public.mentor_profiles.title_current),
    alma_mater = COALESCE(EXCLUDED.alma_mater, public.mentor_profiles.alma_mater),
    first_joined_year = COALESCE(EXCLUDED.first_joined_year, public.mentor_profiles.first_joined_year),
    years_experience_min = COALESCE(EXCLUDED.years_experience_min, public.mentor_profiles.years_experience_min),
    years_experience_text = COALESCE(EXCLUDED.years_experience_text, public.mentor_profiles.years_experience_text),
    interests_text = COALESCE(EXCLUDED.interests_text, public.mentor_profiles.interests_text),
    support_team_lead = COALESCE(EXCLUDED.support_team_lead, public.mentor_profiles.support_team_lead),
    admin_notes = COALESCE(EXCLUDED.admin_notes, public.mentor_profiles.admin_notes),
    source_sheet = COALESCE(EXCLUDED.source_sheet, public.mentor_profiles.source_sheet),
    source_row_id = COALESCE(EXCLUDED.source_row_id, public.mentor_profiles.source_row_id),
    current_company = COALESCE(EXCLUDED.current_company, public.mentor_profiles.current_company),
    current_title = COALESCE(EXCLUDED.current_title, public.mentor_profiles.current_title),
    industry = COALESCE(EXCLUDED.industry, public.mentor_profiles.industry),
    function_area = COALESCE(EXCLUDED.function_area, public.mentor_profiles.function_area),
    years_of_experience = COALESCE(EXCLUDED.years_of_experience, public.mentor_profiles.years_of_experience),
    years_in_vam = COALESCE(EXCLUDED.years_in_vam, public.mentor_profiles.years_in_vam),
    capacity_target = COALESCE(EXCLUDED.capacity_target, public.mentor_profiles.capacity_target),
    seniority_level = COALESCE(EXCLUDED.seniority_level, public.mentor_profiles.seniority_level),
    updated_at = now()
  RETURNING id
), upsert_mentee_profiles AS (
  INSERT INTO public.mentee_profiles (
    id, person_id, mentee_code, school_code, school_raw, mssv, mssv_raw, major,
    class_cohort, gpa_4, has_prior_season, source_sheet, source_row_id, created_at,
    updated_at, university, career_interest, target_industry, year_of_study, support_team
  )
  SELECT
    id::uuid,
    person_id::uuid,
    pg_temp._season11_nullish(mentee_code),
    pg_temp._season11_nullish(school_code),
    pg_temp._season11_nullish(school_raw),
    pg_temp._season11_nullish(mssv),
    pg_temp._season11_nullish(mssv_raw),
    pg_temp._season11_nullish(major),
    pg_temp._season11_nullish(class_cohort),
    CASE WHEN pg_temp._season11_nullish(gpa_4) ~ '^[0-9]+(\.[0-9]+)?$' THEN gpa_4::numeric ELSE NULL END,
    CASE lower(trim(has_prior_season)) WHEN 'true' THEN true WHEN 'false' THEN false ELSE NULL END,
    pg_temp._season11_nullish(source_sheet),
    pg_temp._season11_nullish(source_row_id),
    COALESCE(pg_temp._season11_nullish(created_at)::timestamptz, now()),
    COALESCE(pg_temp._season11_nullish(updated_at)::timestamptz, now()),
    pg_temp._season11_nullish(university),
    pg_temp._season11_nullish(career_interest),
    pg_temp._season11_nullish(target_industry),
    pg_temp._season11_nullish(year_of_study),
    pg_temp._season11_nullish(support_team)
  FROM _season11_seed_mentee_profiles
  ON CONFLICT (id) DO UPDATE SET
    person_id = EXCLUDED.person_id,
    mentee_code = COALESCE(EXCLUDED.mentee_code, public.mentee_profiles.mentee_code),
    school_code = COALESCE(EXCLUDED.school_code, public.mentee_profiles.school_code),
    school_raw = COALESCE(EXCLUDED.school_raw, public.mentee_profiles.school_raw),
    mssv = COALESCE(EXCLUDED.mssv, public.mentee_profiles.mssv),
    mssv_raw = COALESCE(EXCLUDED.mssv_raw, public.mentee_profiles.mssv_raw),
    major = COALESCE(EXCLUDED.major, public.mentee_profiles.major),
    class_cohort = COALESCE(EXCLUDED.class_cohort, public.mentee_profiles.class_cohort),
    gpa_4 = COALESCE(EXCLUDED.gpa_4, public.mentee_profiles.gpa_4),
    has_prior_season = COALESCE(EXCLUDED.has_prior_season, public.mentee_profiles.has_prior_season),
    source_sheet = COALESCE(EXCLUDED.source_sheet, public.mentee_profiles.source_sheet),
    source_row_id = COALESCE(EXCLUDED.source_row_id, public.mentee_profiles.source_row_id),
    university = COALESCE(EXCLUDED.university, public.mentee_profiles.university),
    career_interest = COALESCE(EXCLUDED.career_interest, public.mentee_profiles.career_interest),
    target_industry = COALESCE(EXCLUDED.target_industry, public.mentee_profiles.target_industry),
    year_of_study = COALESCE(EXCLUDED.year_of_study, public.mentee_profiles.year_of_study),
    support_team = COALESCE(EXCLUDED.support_team, public.mentee_profiles.support_team),
    updated_at = now()
  RETURNING id
), target_season AS (
  SELECT id FROM public.seasons WHERE code = 'UEHM-S11' LIMIT 1
), upsert_matches AS (
  INSERT INTO public.matches (
    id, legacy_match_temp_id, season_id, mentee_person_id, mentor_person_id, match_type,
    match_source_raw, match_confidence, status, notes, source_sheet, source_row_id,
    created_at, updated_at
  )
  SELECT
    m.id::uuid,
    pg_temp._season11_nullish(m.legacy_match_temp_id),
    ts.id,
    m.mentee_person_id::uuid,
    m.mentor_person_id::uuid,
    pg_temp._season11_nullish(m.match_type),
    pg_temp._season11_nullish(m.match_source_raw),
    CASE WHEN pg_temp._season11_nullish(m.match_confidence) ~ '^[0-9]+(\.[0-9]+)?$' THEN m.match_confidence::numeric ELSE NULL END,
    COALESCE(pg_temp._season11_nullish(m.status), 'active'),
    pg_temp._season11_nullish(m.notes),
    pg_temp._season11_nullish(m.source_sheet),
    pg_temp._season11_nullish(m.source_row_id),
    COALESCE(pg_temp._season11_nullish(m.created_at)::timestamptz, now()),
    COALESCE(pg_temp._season11_nullish(m.updated_at)::timestamptz, now())
  FROM _season11_seed_matches m
  CROSS JOIN target_season ts
  ON CONFLICT (id) DO UPDATE SET
    legacy_match_temp_id = COALESCE(EXCLUDED.legacy_match_temp_id, public.matches.legacy_match_temp_id),
    season_id = EXCLUDED.season_id,
    mentee_person_id = EXCLUDED.mentee_person_id,
    mentor_person_id = EXCLUDED.mentor_person_id,
    match_type = COALESCE(EXCLUDED.match_type, public.matches.match_type),
    match_source_raw = COALESCE(EXCLUDED.match_source_raw, public.matches.match_source_raw),
    match_confidence = COALESCE(EXCLUDED.match_confidence, public.matches.match_confidence),
    status = COALESCE(EXCLUDED.status, public.matches.status),
    notes = COALESCE(EXCLUDED.notes, public.matches.notes),
    source_sheet = COALESCE(EXCLUDED.source_sheet, public.matches.source_sheet),
    source_row_id = COALESCE(EXCLUDED.source_row_id, public.matches.source_row_id),
    updated_at = now()
  RETURNING id
)
SELECT
  (SELECT count(*) FROM upsert_people) AS people_upserted,
  (SELECT count(*) FROM upsert_mentor_profiles) AS mentor_profiles_upserted,
  (SELECT count(*) FROM upsert_mentee_profiles) AS mentee_profiles_upserted,
  (SELECT count(*) FROM upsert_matches) AS uehm_s11_matches_upserted;

-- Validation summary: expected all counts to match MVP export row counts.
WITH target_season AS (
  SELECT id FROM public.seasons WHERE code = 'UEHM-S11' LIMIT 1
)
SELECT 'people_seeded' AS check_name, count(*) AS actual_count, 1331 AS expected_count
FROM public.people p
JOIN _season11_seed_people seed ON seed.id::uuid = p.id
UNION ALL
SELECT 'mentor_profiles_seeded', count(*), 448
FROM public.mentor_profiles mp
JOIN _season11_seed_mentor_profiles seed ON seed.id::uuid = mp.id
UNION ALL
SELECT 'mentee_profiles_seeded', count(*), 654
FROM public.mentee_profiles mp
JOIN _season11_seed_mentee_profiles seed ON seed.id::uuid = mp.id
UNION ALL
SELECT 'uehm_s11_matches_seeded', count(*), 637
FROM public.matches m
JOIN _season11_seed_matches seed ON seed.id::uuid = m.id
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
-- 1. Review both validation result sets above.
-- 2. If counts and sample checks are correct, uncomment COMMIT.
-- 3. If anything is unexpected, uncomment ROLLBACK.

-- ROLLBACK;
-- COMMIT;
