-- Phase 1A staging-only draft backfill for person_season_memberships.
--
-- Do not run against production without a reviewed count report.
-- This script is intentionally idempotent and conservative:
--   * INSERT ... ON CONFLICT DO NOTHING
--   * source = 'backfill'
--   * notes explain the inference path
--   * no existing mentor_profiles, mentee_profiles, matches, events,
--     applications, or production data are modified
--
-- Suggested staging QA after running:
--   select role, status, count(*) from public.person_season_memberships group by 1,2 order by 1,2;
--   select count(*) from public.person_season_membership_log where transition_type = 'backfill';
--   select psm.*
--   from public.person_season_memberships psm
--   join public.seasons s on s.id = psm.season_id
--   where psm.program_id is distinct from s.program_id;

-- Dry-run/count preview. Run this section on staging before the transaction below.
-- It mirrors the insert sources and excludes rows already present by the
-- person_season_memberships(person_id, season_id, role) uniqueness rule.
with mentee_candidates as (
  select distinct
    mp.person_id,
    s.program_id,
    s.id as season_id,
    mp.intake_batch_id,
    'mentee'::text as role,
    'completed'::text as status
  from public.mentee_profiles mp
  join public.intake_batches ib on ib.id = mp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where mp.person_id is not null
    and s.program_id is not null
),
mentor_match_candidates as (
  select
    m.mentor_person_id as person_id,
    s.program_id,
    s.id as season_id,
    m.intake_batch_id,
    'mentor'::text as role,
    case
      when lower(coalesce(m.status, '')) = 'active' then 'active'
      when lower(coalesce(m.status, '')) in ('completed', 'closed') then 'completed'
      else 'completed'
    end as status
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where m.mentor_person_id is not null
    and s.program_id is not null
),
mentor_match_chosen as (
  select
    person_id,
    program_id,
    season_id,
    (array_agg(intake_batch_id order by intake_batch_id nulls last))[1] as intake_batch_id,
    role,
    case
      when bool_or(status = 'active') then 'active'
      else 'completed'
    end as status
  from mentor_match_candidates
  group by person_id, program_id, season_id, role
),
mentor_profile_candidates as (
  select distinct
    mp.person_id,
    s.program_id,
    s.id as season_id,
    mp.intake_batch_id,
    'mentor'::text as role,
    'invited'::text as status
  from public.mentor_profiles mp
  join public.intake_batches ib on ib.id = mp.intake_batch_id
  join public.seasons s on s.id = ib.season_id
  where mp.person_id is not null
    and mp.intake_batch_id is not null
    and s.program_id is not null
),
mentee_inserts as (
  select mc.*
  from mentee_candidates mc
  where not exists (
    select 1
    from public.person_season_memberships psm
    where psm.person_id = mc.person_id
      and psm.season_id = mc.season_id
      and psm.role = mc.role
  )
),
mentor_match_inserts as (
  select mmc.*
  from mentor_match_chosen mmc
  where not exists (
    select 1
    from public.person_season_memberships psm
    where psm.person_id = mmc.person_id
      and psm.season_id = mmc.season_id
      and psm.role = mmc.role
  )
),
mentor_profile_inserts as (
  select mpc.*
  from mentor_profile_candidates mpc
  where not exists (
    select 1
    from public.person_season_memberships psm
    where psm.person_id = mpc.person_id
      and psm.season_id = mpc.season_id
      and psm.role = mpc.role
  )
  and not exists (
    select 1
    from mentor_match_inserts mmi
    where mmi.person_id = mpc.person_id
      and mmi.season_id = mpc.season_id
      and mmi.role = mpc.role
  )
),
membership_inserts as (
  select * from mentee_inserts
  union all
  select * from mentor_match_inserts
  union all
  select * from mentor_profile_inserts
),
existing_backfill_memberships_without_log as (
  select psm.id, psm.role, psm.status
  from public.person_season_memberships psm
  where psm.source = 'backfill'
    and not exists (
      select 1
      from public.person_season_membership_log log
      where log.membership_id = psm.id
        and log.transition_type = 'backfill'
    )
)
select
  'membership_rows_to_insert' as preview_metric,
  role,
  status,
  count(*) as row_count
from membership_inserts
group by role, status

union all

select
  'log_rows_to_insert_existing_backfill_memberships' as preview_metric,
  role,
  status,
  count(*) as row_count
from existing_backfill_memberships_without_log
group by role, status

union all

select
  'log_rows_to_insert_new_memberships' as preview_metric,
  role,
  status,
  count(*) as row_count
from membership_inserts
group by role, status
order by preview_metric, role, status;

begin;

-- Mentees from mentee_profiles linked to intake_batches/seasons.
-- Use completed as a conservative historical placeholder. Do not infer
-- graduated here: graduation must only be assigned after a future completion
-- review/admin-confirmed graduation process that checks requirements such as
-- recap count, event/training attendance, and final admin review.
insert into public.person_season_memberships (
  person_id,
  program_id,
  season_id,
  intake_batch_id,
  role,
  status,
  source,
  start_date,
  notes
)
select distinct
  mp.person_id,
  s.program_id,
  s.id as season_id,
  mp.intake_batch_id,
  'mentee' as role,
  'completed' as status,
  'backfill' as source,
  null::date as start_date,
  'staging draft backfill: inferred mentee season membership from mentee_profiles.intake_batch_id' as notes
from public.mentee_profiles mp
join public.intake_batches ib on ib.id = mp.intake_batch_id
join public.seasons s on s.id = ib.season_id
where mp.person_id is not null
  and s.program_id is not null
on conflict (person_id, season_id, role) do nothing;

-- Mentors from season-scoped matches.
-- Choose one deterministic row per mentor x season. If any match is active,
-- the membership is active; otherwise it is completed. For intake_batch_id,
-- use the first non-null UUID in ascending order as a stable representative.
with mentor_match_candidates as (
  select
    m.mentor_person_id as person_id,
    s.program_id,
    s.id as season_id,
    m.intake_batch_id,
    case
      when lower(coalesce(m.status, '')) = 'active' then 'active'
      else 'completed'
    end as status
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where m.mentor_person_id is not null
    and s.program_id is not null
),
mentor_match_chosen as (
  select
    person_id,
    program_id,
    season_id,
    (array_agg(intake_batch_id order by intake_batch_id nulls last))[1] as intake_batch_id,
    'mentor' as role,
    case
      when bool_or(status = 'active') then 'active'
      else 'completed'
    end as status
  from mentor_match_candidates
  group by person_id, program_id, season_id
)
insert into public.person_season_memberships (
  person_id,
  program_id,
  season_id,
  intake_batch_id,
  role,
  status,
  source,
  start_date,
  notes
)
select
  person_id,
  program_id,
  season_id,
  intake_batch_id,
  role,
  status,
  'backfill' as source,
  null::date as start_date,
  'staging draft backfill: inferred mentor season membership from matches' as notes
from mentor_match_chosen
on conflict (person_id, season_id, role) do nothing;

-- Optional mentor rows from mentor_profiles with intake_batch_id, where present.
-- Recent profile linkage may provide intake_batch_id for mentors who have no match yet.
insert into public.person_season_memberships (
  person_id,
  program_id,
  season_id,
  intake_batch_id,
  role,
  status,
  source,
  start_date,
  notes
)
select distinct
  mp.person_id,
  s.program_id,
  s.id as season_id,
  mp.intake_batch_id,
  'mentor' as role,
  'invited' as status,
  'backfill' as source,
  null::date as start_date,
  'staging draft backfill: inferred invited mentor membership from mentor_profiles.intake_batch_id; review before production' as notes
from public.mentor_profiles mp
join public.intake_batches ib on ib.id = mp.intake_batch_id
join public.seasons s on s.id = ib.season_id
where mp.person_id is not null
  and mp.intake_batch_id is not null
  and s.program_id is not null
on conflict (person_id, season_id, role) do nothing;

-- Log every backfilled row that does not already have a backfill log entry.
insert into public.person_season_membership_log (
  membership_id,
  person_id,
  program_id,
  season_id,
  role,
  old_status,
  new_status,
  transition_type,
  reason,
  changed_by,
  changed_at
)
select
  psm.id,
  psm.person_id,
  psm.program_id,
  psm.season_id,
  psm.role,
  null,
  psm.status,
  'backfill',
  psm.notes,
  null,
  now()
from public.person_season_memberships psm
where psm.source = 'backfill'
  and not exists (
    select 1
    from public.person_season_membership_log log
    where log.membership_id = psm.id
      and log.transition_type = 'backfill'
  );

commit;
