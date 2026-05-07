-- UEHM Season 11 events staging import verification queries.
-- Read-only. Run after migrations 048 and 049 and the staging import script.

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

-- 3. Registration status count by event.
with expected_registration_statuses(registration_status) as (
  values
    ('registered'),
    ('confirmed'),
    ('declined'),
    ('no_response'),
    ('cancelled'),
    ('unknown')
),
imported_events as (
  select e.id, e.legacy_event_temp_id as event_code
  from public.events e
  join public.seasons s on s.id = e.season_id
  where s.code = 'UEHM-S11'
    and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
)
select
  ie.event_code,
  ers.registration_status,
  count(ep.id)::int as count
from imported_events ie
cross join expected_registration_statuses ers
left join public.event_participations ep
  on ep.event_id = ie.id
 and coalesce(ep.registration_status, 'unknown') = ers.registration_status
group by ie.event_code, ers.registration_status
order by ie.event_code, ers.registration_status;

-- 4. Attendance status count by event.
with expected_attendance_statuses(attendance_status) as (
  values
    ('attended'),
    ('absent_excused'),
    ('absent_unexcused'),
    ('registered_no_response'),
    ('walk_in'),
    ('unknown'),
    ('registered_absent')
),
imported_events as (
  select e.id, e.legacy_event_temp_id as event_code
  from public.events e
  join public.seasons s on s.id = e.season_id
  where s.code = 'UEHM-S11'
    and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
)
select
  ie.event_code,
  eas.attendance_status,
  count(ep.id)::int as count
from imported_events ie
cross join expected_attendance_statuses eas
left join public.event_participations ep
  on ep.event_id = ie.id
 and coalesce(ep.attendance_status, 'unknown') = eas.attendance_status
group by ie.event_code, eas.attendance_status
order by ie.event_code, eas.attendance_status;

-- 5. Unexpected participation status values.
select
  e.legacy_event_temp_id as event_code,
  ep.registration_status,
  ep.attendance_status,
  count(ep.id)::int as count
from public.event_participations ep
join public.events e on e.id = ep.event_id
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
  and (
    coalesce(ep.registration_status, 'unknown') not in ('registered', 'confirmed', 'declined', 'no_response', 'cancelled', 'unknown')
    or coalesce(ep.attendance_status, 'unknown') not in ('attended', 'absent_excused', 'absent_unexcused', 'registered_no_response', 'walk_in', 'unknown', 'registered_absent')
  )
group by e.legacy_event_temp_id, ep.registration_status, ep.attendance_status
order by e.legacy_event_temp_id, ep.registration_status, ep.attendance_status;

-- 6. Duplicate participation check.
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

-- 7. Rows skipped due to missing identity/schema limitation.
select
  import_run_key,
  event_code,
  issue_reason,
  count(*)::int as skipped_count
from public.staging_uehm_s11_event_import_skips
where event_code in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
group by import_run_key, event_code, issue_reason
order by import_run_key desc, event_code, issue_reason;

-- 8. Check Orientation was not imported.
select
  count(*)::int as orientation_event_rows
from public.events e
join public.seasons s on s.id = e.season_id
where s.code = 'UEHM-S11'
  and e.legacy_event_temp_id = 'UEHM_S11_ORIENTATION';
