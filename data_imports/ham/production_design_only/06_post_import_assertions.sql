-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 06: Post-Import Assertions
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- This module runs AFTER all import modules have committed.
-- It is read-only: no INSERT, UPDATE, or DELETE.
-- It asserts that the import completed correctly.
-- ============================================================

-- ── Production guard ──────────────────────────────────────────────────────────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: module 06 must not be executed without owner authorization.';
end;
$$;

-- ── Assert HAM-S6 linkage ─────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from public.programs p
    join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
    join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
    where p.code = 'HAM'
  ) then
    raise exception 'POST-IMPORT FAIL: HAM / HAM-S6 / HAM-S6-B1 linkage broken. Stop.';
  end if;
  raise notice 'PASS: HAM-S6 linkage intact';
end;
$$;

-- ── Assert mentor profiles ────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.mentor_profiles mp
  join public.intake_batches ib on ib.id = mp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where s.code = 'HAM-S6';
  if v_count < 45 then
    raise exception 'POST-IMPORT FAIL: Expected ≥ 45 mentor profiles, got %. Stop.', v_count;
  end if;
  raise notice 'PASS: mentor_profiles = %', v_count;
end;
$$;

-- ── Assert mentee profiles ────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.mentee_profiles mtp
  join public.intake_batches ib on ib.id = mtp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where s.code = 'HAM-S6';
  if v_count < 55 then
    raise exception 'POST-IMPORT FAIL: Expected ≥ 55 mentee profiles, got %. Stop.', v_count;
  end if;
  raise notice 'PASS: mentee_profiles = %', v_count;
end;
$$;

-- ── Assert active matches ─────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where s.code = 'HAM-S6' and m.status = 'active';
  if v_count < 45 then
    raise exception 'POST-IMPORT FAIL: Expected ≥ 45 active matches, got %. Stop.', v_count;
  end if;
  raise notice 'PASS: active HAM-S6 matches = %', v_count;
end;
$$;

-- ── Assert no null critical FKs in HAM-S6 matches ────────────────────────────
do $$
declare v_null_mentors integer; v_null_mentees integer;
begin
  select
    count(*) filter (where mentor_person_id is null),
    count(*) filter (where mentee_person_id is null)
  into v_null_mentors, v_null_mentees
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where s.code = 'HAM-S6';
  if v_null_mentors > 0 or v_null_mentees > 0 then
    raise exception 'POST-IMPORT FAIL: Null person IDs in matches (null_mentors=%, null_mentees=%). Stop.', v_null_mentors, v_null_mentees;
  end if;
  raise notice 'PASS: No null person IDs in HAM-S6 matches';
end;
$$;

-- ── Assert no duplicate matches ───────────────────────────────────────────────
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes
  from (
    select mentor_person_id, mentee_person_id, count(*) as c
    from public.matches m
    join public.seasons s on s.id = m.season_id
    where s.code = 'HAM-S6'
    group by mentor_person_id, mentee_person_id
    having count(*) > 1
  ) sub;
  if v_dupes > 0 then
    raise exception 'POST-IMPORT FAIL: % duplicate match pairs in HAM-S6. Stop.', v_dupes;
  end if;
  raise notice 'PASS: No duplicate HAM-S6 match pairs';
end;
$$;

-- ── Assert UEH baseline unchanged ────────────────────────────────────────────
-- Compare against recorded baseline from module 01.
-- Owner must manually compare these counts to the baseline_before_import recorded earlier.
select
  'ueh_baseline_after_import' as checkpoint,
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

-- ── Full aggregate summary ────────────────────────────────────────────────────
select jsonb_build_object(
  'checkpoint', 'post_import_summary',
  'ham_s6_season_exists', (
    select exists (
      select 1 from public.seasons where code = 'HAM-S6'
    )
  ),
  'ham_s6_b1_batch_exists', (
    select exists (
      select 1 from public.intake_batches where code = 'HAM-S6-B1'
    )
  ),
  'ham_people_with_provenance', (
    select count(*)::int from public.people
    where data_quality_flags like '%source_season=HAM_S6%'
  ),
  'ham_s6_mentor_profiles', (
    select count(*)::int from public.mentor_profiles mp
    join public.intake_batches ib on ib.id = mp.intake_batch_id
    join public.seasons s on s.id = ib.season_id
    where s.code = 'HAM-S6'
  ),
  'ham_s6_mentee_profiles', (
    select count(*)::int from public.mentee_profiles mtp
    join public.intake_batches ib on ib.id = mtp.intake_batch_id
    join public.seasons s on s.id = ib.season_id
    where s.code = 'HAM-S6'
  ),
  'ham_s6_active_matches', (
    select count(*)::int from public.matches m
    join public.seasons s on s.id = m.season_id
    where s.code = 'HAM-S6' and m.status = 'active'
  ),
  'ham_s6_season_memberships', (
    select count(*)::int from public.person_season_memberships psm
    join public.seasons s on s.id = psm.season_id
    where s.code = 'HAM-S6'
  )
) as post_import_summary;
