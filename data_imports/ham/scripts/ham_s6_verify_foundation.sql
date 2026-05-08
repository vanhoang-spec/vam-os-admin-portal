-- HAM Season 6 staging foundation verification.
--
-- Read-only. Run after the HAM seed/people/profile/match scripts.

-- 1. Program, season, and batch.
select
  p.code as program_code,
  p.name as program_name,
  s.code as season_code,
  s.name as season_name,
  ib.code as intake_batch_code,
  ib.name as intake_batch_name,
  ib.is_active
from public.programs p
left join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
left join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM';

-- 2. Identity map action counts.
select
  action,
  count(*)::int as count
from public.staging_ham_s6_people_identity_map
group by action
order by action;

-- 3. Skip log counts.
select
  import_step,
  issue_reason,
  count(*)::int as count
from public.staging_ham_s6_import_skips
group by import_step, issue_reason
order by import_step, issue_reason;

-- 4. HAM people rows created/linked by role.
select
  ham_role,
  action,
  count(*)::int as count
from public.staging_ham_s6_people_identity_map
group by ham_role, action
order by ham_role, action;

-- 5. Profile counts for HAM-S6 batch.
with ctx as (
  select ib.id as intake_batch_id
  from public.programs p
  join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
  join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
  where p.code = 'HAM'
)
select 'mentor_profiles' as object_type, count(*)::int as count
from public.mentor_profiles mp, ctx
where mp.intake_batch_id = ctx.intake_batch_id
union all
select 'mentee_profiles' as object_type, count(*)::int as count
from public.mentee_profiles mtp, ctx
where mtp.intake_batch_id = ctx.intake_batch_id;

-- 6. HAM-S6 match count.
select
  s.code as season_code,
  count(m.id)::int as match_count
from public.seasons s
left join public.matches m on m.season_id = s.id
where s.code = 'HAM-S6'
group by s.code;

-- 7. Duplicate HAM-S6 matches.
select
  m.mentor_person_id,
  m.mentee_person_id,
  count(*)::int as duplicate_count
from public.matches m
join public.seasons s on s.id = m.season_id
where s.code = 'HAM-S6'
group by m.mentor_person_id, m.mentee_person_id
having count(*) > 1
order by duplicate_count desc;

-- 8. Unresolved match rows.
select
  issue_reason,
  count(*)::int as count
from public.staging_ham_s6_import_skips
where import_step = 'matches'
group by issue_reason
order by issue_reason;

-- 9. Confirm no HAM recaps were imported by these foundation scripts.
select
  count(*)::int as ham_s6_recaps
from public.mentoring_recaps mr
join public.seasons s on s.id = mr.season_id
where s.code = 'HAM-S6';
