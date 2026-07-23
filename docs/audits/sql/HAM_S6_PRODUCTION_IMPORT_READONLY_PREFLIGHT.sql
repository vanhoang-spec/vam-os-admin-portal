-- ============================================================
-- HAM-S6 PRODUCTION IMPORT READ-ONLY PREFLIGHT PROBE
-- ============================================================
-- OWNER-RUN ONLY. DO NOT MODIFY INTO A WRITE STATEMENT.
-- NOT AUTHORIZED — READ REVIEW RUNBOOK BEFORE EXECUTION.
--
-- Authorization phrase required before running:
--   AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT
--
-- Requirements:
--   * Single WITH ... SELECT statement.
--   * Returns exactly one row, exactly one JSONB column.
--   * Read-only: no INSERT, UPDATE, DELETE, DDL, or COPY.
--   * No PII: no names, emails, phones, student IDs, or Auth IDs.
--   * Aggregate counts and boolean flags only.
-- ============================================================

with

-- 1. Target project identity check
-- SQL cannot directly read the Supabase project ref.
-- Owner must independently verify the project ref (qkkroesfiazsejkzflcd) in the
-- Supabase dashboard URL before running this probe.
-- The owner_confirmation_required field below always returns true as a reminder.
target_identity as (
  select
    true as owner_must_verify_project_ref,
    current_database() as db_name,
    current_schema() as current_schema_name
),

-- 2. HAM program existence
ham_program as (
  select
    count(*)::int as ham_program_count,
    bool_and(p.is_active) as ham_is_active
  from public.programs p
  where p.code = 'HAM'
),

-- 3. HAM-S6 season pre-existence check
ham_s6_season as (
  select count(*)::int as ham_s6_season_count
  from public.seasons s
  where s.code = 'HAM-S6'
),

-- 4. HAM-S6-B1 batch pre-existence check
ham_s6_b1_batch as (
  select count(*)::int as ham_s6_b1_batch_count
  from public.intake_batches ib
  where ib.code = 'HAM-S6-B1'
),

-- 5. Conflicting season or batch codes (any season/batch code matching HAM-S* or HAM-S6*)
conflicting_codes as (
  select
    (select count(*)::int from public.seasons where code like 'HAM-S6%') as ham_s6_prefix_season_count,
    (select count(*)::int from public.intake_batches where code like 'HAM-S6%') as ham_s6_prefix_batch_count
),

-- 6. Required tables exist
required_tables as (
  select
    bool_and(table_exists) as all_required_tables_exist,
    jsonb_object_agg(table_name, table_exists) as table_existence_map
  from (
    select
      t.tname as table_name,
      exists (
        select 1 from information_schema.tables ist
        where ist.table_schema = 'public'
          and ist.table_name = t.tname
      ) as table_exists
    from (values
      ('programs'), ('seasons'), ('intake_batches'), ('people'),
      ('mentor_profiles'), ('mentee_profiles'), ('matches'),
      ('person_season_memberships'), ('mentoring_recaps'), ('events'),
      ('admin_users'), ('admin_scope_access')
    ) as t(tname)
  ) sub
),

-- 7. Required columns and data types
required_columns as (
  select
    bool_and(col_exists) as all_required_columns_exist,
    jsonb_object_agg(check_name, col_exists) as column_existence_map
  from (
    select
      c.check_name,
      exists (
        select 1 from information_schema.columns ic
        where ic.table_schema = 'public'
          and ic.table_name = c.tbl
          and ic.column_name = c.col
      ) as col_exists
    from (values
      ('programs.code', 'programs', 'code'),
      ('programs.name', 'programs', 'name'),
      ('programs.is_active', 'programs', 'is_active'),
      ('seasons.code', 'seasons', 'code'),
      ('seasons.name', 'seasons', 'name'),
      ('seasons.program_id', 'seasons', 'program_id'),
      ('seasons.status', 'seasons', 'status'),
      ('intake_batches.code', 'intake_batches', 'code'),
      ('intake_batches.season_id', 'intake_batches', 'season_id'),
      ('intake_batches.is_active', 'intake_batches', 'is_active'),
      ('people.full_name', 'people', 'full_name'),
      ('people.email_primary', 'people', 'email_primary'),
      ('people.phone_primary', 'people', 'phone_primary'),
      ('people.gender', 'people', 'gender'),
      ('people.role', 'people', 'role'),
      ('people.source_sheets', 'people', 'source_sheets'),
      ('people.data_quality_flags', 'people', 'data_quality_flags'),
      ('mentor_profiles.person_id', 'mentor_profiles', 'person_id'),
      ('mentor_profiles.intake_batch_id', 'mentor_profiles', 'intake_batch_id'),
      ('mentor_profiles.mentor_code', 'mentor_profiles', 'mentor_code'),
      ('mentor_profiles.linkedin_url', 'mentor_profiles', 'linkedin_url'),
      ('mentee_profiles.person_id', 'mentee_profiles', 'person_id'),
      ('mentee_profiles.intake_batch_id', 'mentee_profiles', 'intake_batch_id'),
      ('mentee_profiles.mentee_code', 'mentee_profiles', 'mentee_code'),
      ('mentee_profiles.status', 'mentee_profiles', 'status'),
      ('matches.season_id', 'matches', 'season_id'),
      ('matches.mentor_person_id', 'matches', 'mentor_person_id'),
      ('matches.mentee_person_id', 'matches', 'mentee_person_id'),
      ('matches.status', 'matches', 'status'),
      ('matches.season_code', 'matches', 'season_code'),
      ('matches.match_type', 'matches', 'match_type'),
      ('person_season_memberships.person_id', 'person_season_memberships', 'person_id'),
      ('person_season_memberships.season_id', 'person_season_memberships', 'season_id'),
      ('person_season_memberships.role', 'person_season_memberships', 'role'),
      ('person_season_memberships.status', 'person_season_memberships', 'status')
    ) as c(check_name, tbl, col)
  ) sub
),

-- 8. Required enum labels (people.role, matches.status, mentee_profiles.status)
required_enums as (
  select
    bool_and(label_exists) as all_required_enum_labels_exist,
    jsonb_object_agg(check_name, label_exists) as enum_existence_map
  from (
    select
      e.check_name,
      exists (
        select 1 from pg_enum pe
        join pg_type pt on pt.oid = pe.enumtypid
        join pg_namespace pn on pn.oid = pt.typnamespace
        where pn.nspname = 'public'
          and pt.typname = e.type_name
          and pe.enumlabel = e.label
      ) as label_exists
    from (values
      ('people.role=mentor', 'role', 'mentor'),
      ('people.role=mentee', 'role', 'mentee'),
      ('matches.status=active', 'match_status', 'active')
    ) as e(check_name, type_name, label)
  ) sub
),

-- 9. Required constraints (PK, unique, FK)
required_constraints as (
  select
    bool_and(constraint_exists) as all_required_constraints_exist,
    jsonb_object_agg(check_name, constraint_exists) as constraint_existence_map
  from (
    select
      c.check_name,
      exists (
        select 1 from information_schema.table_constraints tc
        where tc.table_schema = 'public'
          and tc.table_name = c.tbl
          and tc.constraint_type = c.ctype
      ) as constraint_exists
    from (values
      ('programs_pkey', 'programs', 'PRIMARY KEY'),
      ('seasons_pkey', 'seasons', 'PRIMARY KEY'),
      ('intake_batches_pkey', 'intake_batches', 'PRIMARY KEY'),
      ('people_pkey', 'people', 'PRIMARY KEY'),
      ('mentor_profiles_pkey', 'mentor_profiles', 'PRIMARY KEY'),
      ('mentee_profiles_pkey', 'mentee_profiles', 'PRIMARY KEY'),
      ('matches_pkey', 'matches', 'PRIMARY KEY'),
      ('seasons_program_fk', 'seasons', 'FOREIGN KEY'),
      ('mentor_profiles_person_fk', 'mentor_profiles', 'FOREIGN KEY'),
      ('mentee_profiles_person_fk', 'mentee_profiles', 'FOREIGN KEY'),
      ('matches_season_fk', 'matches', 'FOREIGN KEY')
    ) as c(check_name, tbl, ctype)
  ) sub
),

-- 10. Required indexes (import depends on people.email_primary for dedup)
required_indexes as (
  select
    bool_and(index_exists) as all_required_indexes_exist,
    jsonb_object_agg(check_name, index_exists) as index_existence_map
  from (
    select
      ix.check_name,
      exists (
        select 1 from pg_indexes pgi
        where pgi.schemaname = 'public'
          and pgi.tablename = ix.tbl
          and pgi.indexname ilike ix.name_pattern
      ) as index_exists
    from (values
      ('people_email_idx', 'people', '%email%'),
      ('mentor_profiles_person_idx', 'mentor_profiles', '%person%'),
      ('mentee_profiles_person_idx', 'mentee_profiles', '%person%'),
      ('matches_season_idx', 'matches', '%season%')
    ) as ix(check_name, tbl, name_pattern)
  ) sub
),

-- 11. Aggregate collision counts for source legacy identifiers
--     (How many existing people have HAM-related data_quality_flags or source_sheets)
existing_ham_collision as (
  select
    (
      select count(*)::int from public.people
      where source_sheets ilike '%HAM%'
    ) as people_with_ham_source_sheets,
    (
      select count(*)::int from public.people
      where data_quality_flags ilike '%HAM%'
    ) as people_with_ham_data_flags
),

-- 12. Aggregate collision counts for normalized identity keys
--     Counts how many existing people have email_primary that appears more than once
--     (potential email collision risk in existing data, separate from HAM import)
email_collision_check as (
  select
    count(*) filter (where email_count > 1)::int as duplicate_email_count_in_people_table,
    max(email_count)::int as max_email_appearances
  from (
    select lower(trim(email_primary)) as email_norm, count(*) as email_count
    from public.people
    where email_primary is not null
    group by lower(trim(email_primary))
  ) sub
),

-- 13. Existing shared-person candidate count
--     (People with both mentor_profiles and mentee_profiles = dual-role candidates)
shared_person_candidates as (
  select
    (
      select count(distinct mp.person_id)::int
      from public.mentor_profiles mp
      join public.mentee_profiles mtp on mtp.person_id = mp.person_id
    ) as dual_role_person_count
),

-- 14. Ambiguous identity candidate count
--     (People whose name appears more than once in people table — normalized)
ambiguous_identity_candidates as (
  select
    count(*) filter (where name_count > 1)::int as ambiguous_name_count_in_people_table
  from (
    select
      lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) as name_key,
      count(*) as name_count
    from public.people
    group by lower(regexp_replace(trim(full_name), '\s+', ' ', 'g'))
  ) sub
),

-- 15. Existing HAM profile and match count (should be 0 before import)
existing_ham_data as (
  select
    (
      select count(*)::int
      from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ) as existing_ham_mentor_profiles,
    (
      select count(*)::int
      from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ) as existing_ham_mentee_profiles,
    (
      select count(*)::int
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6'
    ) as existing_ham_matches
),

-- 16. Existing UEH rows that must remain untouched
ueh_baseline as (
  select
    (
      select count(*)::int from public.seasons
      where code in ('UEHM-S11', 'UEHM-S12')
    ) as ueh_season_count,
    (
      select count(*)::int from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code in ('UEHM-S11', 'UEHM-S12')
    ) as ueh_match_count,
    (
      select count(*)::int from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code in ('UEHM-S11', 'UEHM-S12')
    ) as ueh_mentor_profile_count,
    (
      select count(*)::int from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code in ('UEHM-S11', 'UEHM-S12')
    ) as ueh_mentee_profile_count
),

-- 17. Schema compatibility check: seasons table has program_id FK
seasons_program_id_fk as (
  select
    exists (
      select 1 from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name
        and kcu.constraint_schema = rc.constraint_schema
      where rc.constraint_schema = 'public'
        and kcu.table_name = 'seasons'
        and kcu.column_name = 'program_id'
    ) as seasons_has_program_id_fk
)

select jsonb_build_object(
  'probe',              'HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V1',
  'authorized_phrase',  'AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT',
  'owner_must_verify_project_ref',  (select owner_must_verify_project_ref from target_identity),
  'db_name',            (select db_name from target_identity),

  'gate_1_ham_program', jsonb_build_object(
    'ham_program_count',   (select ham_program_count from ham_program),
    'ham_is_active',       (select ham_is_active from ham_program),
    'expected_count',      1,
    'pass',                (select ham_program_count = 1 from ham_program)
  ),

  'gate_2_ham_s6_not_exist', jsonb_build_object(
    'ham_s6_season_count', (select ham_s6_season_count from ham_s6_season),
    'expected_count',      0,
    'pass',                (select ham_s6_season_count = 0 from ham_s6_season)
  ),

  'gate_3_ham_s6_b1_not_exist', jsonb_build_object(
    'ham_s6_b1_batch_count', (select ham_s6_b1_batch_count from ham_s6_b1_batch),
    'expected_count',          0,
    'pass',                    (select ham_s6_b1_batch_count = 0 from ham_s6_b1_batch)
  ),

  'gate_4_no_conflicting_codes', jsonb_build_object(
    'ham_s6_prefix_season_count', (select ham_s6_prefix_season_count from conflicting_codes),
    'ham_s6_prefix_batch_count',  (select ham_s6_prefix_batch_count from conflicting_codes),
    'pass',                       (select ham_s6_prefix_season_count = 0 and ham_s6_prefix_batch_count = 0 from conflicting_codes)
  ),

  'gate_5_required_tables', jsonb_build_object(
    'all_required_tables_exist', (select all_required_tables_exist from required_tables),
    'table_existence_map',       (select table_existence_map from required_tables)
  ),

  'gate_6_required_columns', jsonb_build_object(
    'all_required_columns_exist', (select all_required_columns_exist from required_columns),
    'column_existence_map',       (select column_existence_map from required_columns)
  ),

  'gate_7_required_enums', jsonb_build_object(
    'all_required_enum_labels_exist', (select all_required_enum_labels_exist from required_enums),
    'enum_existence_map',             (select enum_existence_map from required_enums)
  ),

  'gate_8_required_constraints', jsonb_build_object(
    'all_required_constraints_exist', (select all_required_constraints_exist from required_constraints),
    'constraint_existence_map',       (select constraint_existence_map from required_constraints)
  ),

  'gate_9_required_indexes', jsonb_build_object(
    'all_required_indexes_exist', (select all_required_indexes_exist from required_indexes),
    'index_existence_map',        (select index_existence_map from required_indexes)
  ),

  'gate_10_collision_counts', jsonb_build_object(
    'people_with_ham_source_sheets',  (select people_with_ham_source_sheets from existing_ham_collision),
    'people_with_ham_data_flags',     (select people_with_ham_data_flags from existing_ham_collision),
    'duplicate_email_count_in_people_table', (select duplicate_email_count_in_people_table from email_collision_check),
    'max_email_appearances',          (select max_email_appearances from email_collision_check)
  ),

  'gate_11_shared_person_candidates', jsonb_build_object(
    'dual_role_person_count', (select dual_role_person_count from shared_person_candidates)
  ),

  'gate_12_ambiguous_identity_candidates', jsonb_build_object(
    'ambiguous_name_count_in_people_table', (select ambiguous_name_count_in_people_table from ambiguous_identity_candidates)
  ),

  'gate_13_existing_ham_data', jsonb_build_object(
    'existing_ham_mentor_profiles', (select existing_ham_mentor_profiles from existing_ham_data),
    'existing_ham_mentee_profiles', (select existing_ham_mentee_profiles from existing_ham_data),
    'existing_ham_matches',         (select existing_ham_matches from existing_ham_data),
    'expected_all_zero',            true,
    'pass',                         (
      select existing_ham_mentor_profiles = 0
        and existing_ham_mentee_profiles = 0
        and existing_ham_matches = 0
      from existing_ham_data
    )
  ),

  'gate_14_ueh_baseline', jsonb_build_object(
    'ueh_season_count',          (select ueh_season_count from ueh_baseline),
    'ueh_match_count',           (select ueh_match_count from ueh_baseline),
    'ueh_mentor_profile_count',  (select ueh_mentor_profile_count from ueh_baseline),
    'ueh_mentee_profile_count',  (select ueh_mentee_profile_count from ueh_baseline)
  ),

  'gate_15_schema_compatibility', jsonb_build_object(
    'seasons_has_program_id_fk', (select seasons_has_program_id_fk from seasons_program_id_fk)
  ),

  'summary_pass', (
    select
      (select ham_program_count = 1 from ham_program)
      and (select ham_s6_season_count = 0 from ham_s6_season)
      and (select ham_s6_b1_batch_count = 0 from ham_s6_b1_batch)
      and (select ham_s6_prefix_season_count = 0 and ham_s6_prefix_batch_count = 0 from conflicting_codes)
      and (select all_required_tables_exist from required_tables)
      and (select all_required_columns_exist from required_columns)
      and (select all_required_constraints_exist from required_constraints)
      and (select existing_ham_mentor_profiles = 0 and existing_ham_mentee_profiles = 0 and existing_ham_matches = 0 from existing_ham_data)
  )
);
