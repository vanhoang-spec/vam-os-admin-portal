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
  m.mentor_person_id,
  s.program_id,
  s.id as season_id,
  m.intake_batch_id,
  'mentor' as role,
  case
    when lower(coalesce(m.status, '')) = 'active' then 'active'
    when lower(coalesce(m.status, '')) in ('completed', 'closed') then 'completed'
    else 'completed'
  end as status,
  'backfill' as source,
  null::date as start_date,
  'staging draft backfill: inferred mentor season membership from matches' as notes
from public.matches m
join public.seasons s on s.id = m.season_id
where m.mentor_person_id is not null
  and s.program_id is not null
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
