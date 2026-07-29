-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 04: Import Profiles and Season Memberships
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- Prerequisites:
--   * Module 03 committed in the SAME SESSION (temp tables _ham_prod_identity_map
--     and _ham_prod_ready must still exist)
--
-- Writes:
--   INSERT public.mentor_profiles (new rows; skips if person already has any mentor_profile)
--   INSERT public.mentee_profiles (new rows; skips if person already has any mentee_profile)
--   INSERT public.person_season_memberships (new rows; conflict = do nothing)
--
-- Deletes: NONE
-- Updates: NONE
-- UEH rows: NEVER touched
-- ============================================================

begin;

-- ── Production guard ──────────────────────────────────────────────────────────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: module 04 must not be executed without owner authorization.';
end;
$$;

-- ── Context resolution ────────────────────────────────────────────────────────
create temp table _ham_prod_context as
select
  p.id as program_id,
  s.id as season_id,
  ib.id as intake_batch_id
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM'
limit 1
on commit drop;

do $$
begin
  if not exists (select 1 from _ham_prod_context) then
    raise exception 'CONTEXT FAIL: HAM-S6 / HAM-S6-B1 context not found. Run module 02 first. Stop.';
  end if;
  raise notice 'PASS: HAM-S6 context resolved';
end;
$$;

-- ── Resolved people for profiles ──────────────────────────────────────────────
create temp table _ham_prod_people_for_profiles as
select
  r.source_row,
  r.ham_role,
  r.school,
  r.company,
  r.title,
  r.expertise,
  r.field,
  r.linkedin,
  r.vam_profile_link,
  m.person_id
from _ham_prod_ready r
join _ham_prod_identity_map m on m.source_row = r.source_row
where m.person_id is not null
on commit drop;

-- ── Insert mentor profiles ────────────────────────────────────────────────────
-- NOTE: Profile guard is scoped to HAM-S6-B1 batch specifically,
-- NOT a global person_id guard. This allows a UEHM mentor to also receive
-- a HAM-S6-B1 mentor_profile, which is the correct behavior.
--
-- NOTE: mentor_profiles.linkedin_url is absent from production schema.
-- LinkedIn URL is preserved in people.data_quality_flags as linkedin=<url>.
insert into public.mentor_profiles (
  person_id,
  mentor_code,
  bio_url,
  company_current,
  title_current,
  current_company,
  current_title,
  industry,
  function_area,
  first_vam_season,
  bio_short,
  intake_batch_id
)
select
  r.person_id,
  'HAM-S6-MENTOR-' || lpad(row_number() over (order by r.person_id::text)::text, 3, '0'),
  nullif(r.vam_profile_link, ''),
  nullif(r.company, ''),
  nullif(r.title, ''),
  nullif(r.company, ''),
  nullif(r.title, ''),
  nullif(r.field, ''),
  nullif(r.expertise, ''),
  'HAM-S6',
  concat_ws(E'\n',
    'HAM S6 mentor profile from production import.',
    'source_row=' || r.source_row,
    'field=' || coalesce(r.field, ''),
    'expertise=' || coalesce(r.expertise, '')
  ),
  (select intake_batch_id from _ham_prod_context)
from _ham_prod_people_for_profiles r
where r.ham_role = 'mentor'
  and not exists (
    select 1 from public.mentor_profiles mp
    where mp.person_id = r.person_id
      and mp.intake_batch_id = (select intake_batch_id from _ham_prod_context)
  );

-- ── Insert mentee profiles ────────────────────────────────────────────────────
-- NOTE: mentee_profiles.status and mentee_profiles.mentee_status are both absent
-- from production schema (confirmed by preflight V2, 2026-07-23).
-- Lifecycle status is tracked exclusively via person_season_memberships.status (inserted below).
insert into public.mentee_profiles (
  person_id,
  mentee_code,
  school_raw,
  university,
  career_interest,
  target_industry,
  target_function,
  intake_batch_id
)
select
  r.person_id,
  'HAM-S6-MENTEE-' || lpad(row_number() over (order by r.person_id::text)::text, 3, '0'),
  nullif(r.school, ''),
  nullif(r.school, ''),
  nullif(coalesce(r.field, r.expertise), ''),
  nullif(r.field, ''),
  nullif(r.expertise, ''),
  (select intake_batch_id from _ham_prod_context)
from _ham_prod_people_for_profiles r
where r.ham_role = 'mentee'
  and not exists (
    select 1 from public.mentee_profiles mtp
    where mtp.person_id = r.person_id
      and mtp.intake_batch_id = (select intake_batch_id from _ham_prod_context)
  );

-- ── Insert season memberships ─────────────────────────────────────────────────
-- NOTE: program_id is NOT NULL in person_season_memberships (migration 052).
-- It is resolved from _ham_prod_context along with season_id.
insert into public.person_season_memberships (person_id, program_id, season_id, role, status)
select
  m.person_id,
  (select program_id from _ham_prod_context),
  (select season_id from _ham_prod_context),
  lower(m.ham_role),
  'active'
from _ham_prod_identity_map m
where m.person_id is not null
on conflict (person_id, season_id, role) do nothing;

-- ── Assertions ────────────────────────────────────────────────────────────────
do $$
declare
  v_mentors     integer;
  v_mentees     integer;
  v_memberships integer;
begin
  select count(*) into v_mentors
  from public.mentor_profiles
  where intake_batch_id = (select intake_batch_id from _ham_prod_context);

  select count(*) into v_mentees
  from public.mentee_profiles
  where intake_batch_id = (select intake_batch_id from _ham_prod_context);

  select count(*) into v_memberships
  from public.person_season_memberships
  where season_id = (select season_id from _ham_prod_context);

  raise notice 'PROFILES: mentor_profiles=%, mentee_profiles=%, memberships=%',
    v_mentors, v_mentees, v_memberships;

  if v_mentors <> 52 then
    raise exception 'ASSERTION FAIL: Expected exactly 52 mentor profiles, got %. Stop.', v_mentors;
  end if;
  if v_mentees <> 60 then
    raise exception 'ASSERTION FAIL: Expected exactly 60 mentee profiles, got %. Stop.', v_mentees;
  end if;
  if v_memberships <> 112 then
    raise exception 'ASSERTION FAIL: Expected exactly 112 HAM-S6 memberships, got %. Stop.', v_memberships;
  end if;

  raise notice 'PASS: profile and membership assertions satisfied';
end;
$$;

commit;
