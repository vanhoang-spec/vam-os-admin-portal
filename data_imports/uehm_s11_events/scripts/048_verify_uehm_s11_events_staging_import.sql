-- UEHM Season 11 events staging import verification queries.
-- Read-only. Run after migration 048 and the staging import script.

-- 1. Events inserted/skipped by event_code.
select
  expected.event_code,
  case when e.id is null then 'missing' else 'present' end as event_status,
  e.id,
  e.event_name,
  e.event_type,
  e.starts_at,
  e.source_notes
from (
  values
    ('UEHM_S11_KICKOFF'),
    ('UEHM_S11_TRAINING01'),
    ('UEHM_S11_TRAINING02'),
    ('UEHM_S11_ORIENTATION')
) as expected(event_code)
left join public.events e
  on e.legacy_event_temp_id = expected.event_code
left join public.seasons s
  on s.id = e.season_id
where e.id is null
   or s.code = 'UEHM-S11'
order by expected.event_code;

-- 2. Participant count by imported event.
select
  e.legacy_event_temp_id as event_code,
  e.event_name,
  count(ep.id)::int as participant_count
from public.events e
left join public.event_participations ep on ep.event_id = e.id
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
group by e.legacy_event_temp_id, e.event_name
order by e.legacy_event_temp_id;

-- 3. Attendance status count by event.
select
  e.legacy_event_temp_id as event_code,
  coalesce(ep.attendance_status, '(none)') as attendance_status,
  count(ep.id)::int as count
from public.events e
left join public.event_participations ep on ep.event_id = e.id
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
group by e.legacy_event_temp_id, coalesce(ep.attendance_status, '(none)')
order by e.legacy_event_temp_id, attendance_status;

-- 4. Duplicate participation check.
select
  e.legacy_event_temp_id as event_code,
  ep.person_id,
  count(*)::int as duplicate_count
from public.event_participations ep
join public.events e on e.id = ep.event_id
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
  and ep.person_id is not null
group by e.legacy_event_temp_id, ep.person_id
having count(*) > 1
order by duplicate_count desc, event_code, ep.person_id;

-- 5. Rows skipped due to missing identity/schema limitation.
select
  import_run_key,
  event_code,
  issue_reason,
  count(*)::int as skipped_count
from public.staging_uehm_s11_event_import_skips
where event_code in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
group by import_run_key, event_code, issue_reason
order by import_run_key desc, event_code, issue_reason;

-- 6. Check Orientation was not imported.
select
  count(*)::int as orientation_event_rows
from public.events e
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id = 'UEHM_S11_ORIENTATION';
