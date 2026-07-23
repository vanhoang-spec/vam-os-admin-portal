-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 01: Preflight Assertions
--
-- This module is a DESIGN DOCUMENT, not a runnable script.
-- It must be reviewed and authorized by the project owner
-- before any adaptation for production execution.
--
-- When authorized, this module must be run FIRST, before any
-- INSERT operation. It must complete with zero assertion
-- failures before proceeding to module 02.
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- Prerequisites:
--   * Owner has verified Supabase project ref = qkkroesfiazsejkzflcd
--   * Owner has reviewed and passed the read-only preflight probe
--     (docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql)
--   * Owner has confirmed this is NOT staging (ljfneyuvpxrmejpxsmpz)
--   * Production backup has been taken (see backup runbook)
-- ============================================================

-- NOTE: This module does not use \copy or psql meta-commands.
-- NOTE: This module runs outside any import transaction (read-only assertions).
-- NOTE: If any DO $$ block raises an exception, stop and do not proceed to module 02.

-- ── Assertion 1: Production project ref ──────────────────────────────────────
-- SQL cannot directly verify the Supabase project ref.
-- Owner must independently confirm the project ref before running this module.
-- This placeholder documents the requirement.
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise notice 'Owner must verify: Supabase project ref = qkkroesfiazsejkzflcd';
  raise notice 'Owner must verify: this is NOT the staging project (ljfneyuvpxrmejpxsmpz)';
  raise notice 'If not confirmed, do not proceed.';
  raise exception 'PRODUCTION DESIGN ONLY: this module is a design document and must not be executed without explicit owner authorization.';
end;
$$;

-- ── Assertion 2: HAM program exists exactly once ──────────────────────────────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.programs where code = 'HAM';
  if v_count <> 1 then
    raise exception 'PREFLIGHT FAIL: Expected exactly 1 HAM program row, found %. Stop.', v_count;
  end if;
  raise notice 'PASS: HAM program exists (count = %)', v_count;
end;
$$;

-- ── Assertion 3: HAM-S6 does not already exist ───────────────────────────────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.seasons where code = 'HAM-S6';
  if v_count <> 0 then
    raise exception 'PREFLIGHT FAIL: HAM-S6 season already exists (count = %). Refusing to reimport. Stop.', v_count;
  end if;
  raise notice 'PASS: HAM-S6 season does not exist yet';
end;
$$;

-- ── Assertion 4: HAM-S6-B1 does not already exist ────────────────────────────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.intake_batches where code = 'HAM-S6-B1';
  if v_count <> 0 then
    raise exception 'PREFLIGHT FAIL: HAM-S6-B1 batch already exists (count = %). Stop.', v_count;
  end if;
  raise notice 'PASS: HAM-S6-B1 batch does not exist yet';
end;
$$;

-- ── Assertion 5: Required tables exist ───────────────────────────────────────
do $$
declare
  v_missing text[];
  t text;
begin
  v_missing := array[]::text[];
  foreach t in array array[
    'programs','seasons','intake_batches','people',
    'mentor_profiles','mentee_profiles','matches',
    'person_season_memberships'
  ]
  loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      v_missing := v_missing || t;
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'PREFLIGHT FAIL: Missing required tables: %. Stop.', array_to_string(v_missing, ', ');
  end if;
  raise notice 'PASS: All required tables exist';
end;
$$;

-- ── Assertion 6: seasons.program_id FK exists ────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = rc.constraint_name
      and kcu.constraint_schema = rc.constraint_schema
    where rc.constraint_schema = 'public'
      and kcu.table_name = 'seasons'
      and kcu.column_name = 'program_id'
  ) then
    raise exception 'PREFLIGHT FAIL: seasons.program_id FK not found. Schema incompatible. Stop.';
  end if;
  raise notice 'PASS: seasons.program_id FK exists';
end;
$$;

-- ── Assertion 7: No existing HAM-S6 data (belt-and-suspenders) ───────────────
do $$
declare
  v_mentor_profiles integer;
  v_mentee_profiles integer;
  v_matches integer;
begin
  select count(*) into v_mentor_profiles
  from public.mentor_profiles mp
  join public.intake_batches ib on ib.id = mp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where s.code = 'HAM-S6';

  select count(*) into v_mentee_profiles
  from public.mentee_profiles mtp
  join public.intake_batches ib on ib.id = mtp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where s.code = 'HAM-S6';

  select count(*) into v_matches
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where s.code = 'HAM-S6';

  if v_mentor_profiles > 0 or v_mentee_profiles > 0 or v_matches > 0 then
    raise exception
      'PREFLIGHT FAIL: Existing HAM-S6 data detected (mentor_profiles=%, mentee_profiles=%, matches=%). Refusing to reimport. Stop.',
      v_mentor_profiles, v_mentee_profiles, v_matches;
  end if;
  raise notice 'PASS: No existing HAM-S6 data detected';
end;
$$;

-- ── Assertion 8: Record UEH baseline for post-import verification ─────────────
-- (Informational — does not fail. Owner must record the output.)
select
  'ueh_baseline_before_import' as checkpoint,
  (select count(*) from public.seasons where code in ('UEHM-S11','UEHM-S12'))::int as ueh_seasons,
  (select count(*) from public.matches m join public.seasons s on s.id = m.season_id where s.code in ('UEHM-S11','UEHM-S12'))::int as ueh_matches,
  (
    select count(*) from public.mentor_profiles mp
    join public.intake_batches ib on ib.id = mp.intake_batch_id
    join public.seasons s on s.id = ib.season_id
    where s.code in ('UEHM-S11','UEHM-S12')
  )::int as ueh_mentor_profiles,
  (
    select count(*) from public.mentee_profiles mtp
    join public.intake_batches ib on ib.id = mtp.intake_batch_id
    join public.seasons s on s.id = ib.season_id
    where s.code in ('UEHM-S11','UEHM-S12')
  )::int as ueh_mentee_profiles;
