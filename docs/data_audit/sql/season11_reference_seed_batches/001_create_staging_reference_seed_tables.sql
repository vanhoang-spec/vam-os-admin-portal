-- Season 11 Staging Reference Seed Batch Pack
-- REVIEW ONLY. STAGING ONLY. DO NOT RUN ON PRODUCTION.
--
-- Contains sensitive MVP reference seed data. Keep local and do not commit unless explicitly approved.
-- Generated from SEASON11_STAGING_REFERENCE_SEED_SUPABASE_SQL_EDITOR_EXECUTION.sql.
-- Run this file first.
-- It creates persistent staging helper tables and clears only those helper tables.
-- It never truncates production/application tables.
CREATE TABLE IF NOT EXISTS public.staging_reference_seed_people (
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
);

CREATE TABLE IF NOT EXISTS public.staging_reference_seed_mentor_profiles (
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
);

CREATE TABLE IF NOT EXISTS public.staging_reference_seed_mentee_profiles (
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
);

CREATE TABLE IF NOT EXISTS public.staging_reference_seed_matches (
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
);
TRUNCATE TABLE
  public.staging_reference_seed_people,
  public.staging_reference_seed_mentee_profiles,
  public.staging_reference_seed_mentor_profiles,
  public.staging_reference_seed_matches;

SELECT 'helper_tables_ready' AS status;
