-- UEHM Season 11 events staging import script for migration 048 review.
--
-- DO NOT RUN ON PRODUCTION.
-- Intended execution: staging Supabase only, using psql from the repository root.
--
-- Prerequisite:
--   1. Apply supabase_migrations/048_add_kickoff_event_type.sql on staging.
--   2. Apply supabase_migrations/049_expand_event_participation_status_model.sql on staging.
--   3. Run this script only after reviewing docs/UEHM_S11_EVENTS_STAGING_IMPORT_PLAN.md.
--
-- Suggested command from repo root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/uehm_s11_events/scripts/048_stage_uehm_s11_events_import.sql
--
-- Source CSV:
--   data_imports/uehm_s11_events/event_participations_import_ready_dedup.csv
--
-- Scope:
--   Include: UEHM_S11_KICKOFF, UEHM_S11_TRAINING01, UEHM_S11_TRAINING02
--   Hold:    UEHM_S11_ORIENTATION (official date still unknown)

begin;

create temp table _uehm_s11_event_source (
  event_code text,
  participant_name text,
  email text,
  phone text,
  mssv text,
  attendance_status_mvp text,
  checkin_status text,
  attendance_status_detailed text,
  excused_absence_flag text,
  no_show_flag text,
  blacklist_flag text,
  issue_flag text,
  issue_note text,
  source_file text,
  source_sheet text,
  dedup_group_size text,
  import_ready text
) on commit drop;

\copy _uehm_s11_event_source from 'data_imports/uehm_s11_events/event_participations_import_ready_dedup.csv' with (format csv, header true, encoding 'UTF8')

create temp table _uehm_s11_event_seed (
  event_code text primary key,
  event_name text not null,
  event_type text not null,
  starts_at timestamptz not null,
  location text,
  source_notes text not null
) on commit drop;

insert into _uehm_s11_event_seed (event_code, event_name, event_type, starts_at, location, source_notes)
values
  (
    'UEHM_S11_KICKOFF',
    'UEH Mentoring Season 11 Kickoff',
    'kickoff',
    '2025-11-08 08:00:00+07',
    'Hội trường A.116, cơ sở A Đại học UEH, 59C Nguyễn Đình Chiểu, Phường Xuân Hòa, TP.HCM',
    'Business event type: kickoff. Core season-opening event. Mandatory for Season 11 mentors and mentees; alumni also invited. Location: Hội trường A.116, cơ sở A Đại học UEH, 59C Nguyễn Đình Chiểu, Phường Xuân Hòa, TP.HCM. Source: Antigravity Phase 2 dedup import-ready file.'
  ),
  (
    'UEHM_S11_TRAINING01',
    'UEH Mentoring Season 11 Training 01 - Crack the Code',
    'training',
    '2025-11-21 11:10:13.637+07',
    null,
    'Source: Antigravity Phase 2 dedup import-ready file. Rich registration, confirmation, blacklist, and feedback details remain in audit CSVs and are not imported into unsupported MVP columns.'
  ),
  (
    'UEHM_S11_TRAINING02',
    'UEH Mentoring Season 11 Training 02',
    'training',
    '2025-11-25 20:08:17.617+07',
    null,
    'Source: Antigravity Phase 2 dedup import-ready file. Rich registration, confirmation, and feedback details remain in audit CSVs and are not imported into unsupported MVP columns.'
  );

create table if not exists public.staging_uehm_s11_event_import_skips (
  id uuid primary key default gen_random_uuid(),
  import_run_key text not null,
  event_code text not null,
  participant_name text,
  email text,
  phone text,
  mssv text,
  issue_reason text not null,
  source_file text,
  source_sheet text,
  source_row jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staging_uehm_s11_event_import_skips_run_idx
  on public.staging_uehm_s11_event_import_skips(import_run_key, event_code);

create temp table _uehm_s11_import_context as
select
  'uehm_s11_events_048_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') as import_run_key,
  s.id as season_id
from public.seasons s
where s.code = 'UEHM-S11'
limit 1;

do $$
begin
  if not exists (select 1 from _uehm_s11_import_context where season_id is not null) then
    raise exception 'Season UEHM-S11 was not found. Stop before importing events.';
  end if;
end;
$$;

-- Upsert event master records by canonical event_code while also reusing the
-- earlier hyphenated Phase 2 seed code if it exists.
with existing_events as (
  select
    seed.event_code,
    e.id
  from _uehm_s11_event_seed seed
  join public.events e
    on e.season_id = (select season_id from _uehm_s11_import_context)
   and e.legacy_event_temp_id in (
      seed.event_code,
      replace(seed.event_code, 'UEHM_S11_', 'UEHM-S11-')
    )
),
updated as (
  update public.events e
  set
    legacy_event_temp_id = seed.event_code,
    event_name = seed.event_name,
    event_type = seed.event_type,
    starts_at = seed.starts_at,
    source_notes = seed.source_notes
  from _uehm_s11_event_seed seed
  join existing_events existing on existing.event_code = seed.event_code
  where e.id = existing.id
  returning seed.event_code, e.id
),
inserted as (
  insert into public.events (
    legacy_event_temp_id,
    season_id,
    event_name,
    event_type,
    starts_at,
    source_notes
  )
  select
    seed.event_code,
    ctx.season_id,
    seed.event_name,
    seed.event_type,
    seed.starts_at,
    seed.source_notes
  from _uehm_s11_event_seed seed
  cross join _uehm_s11_import_context ctx
  where not exists (
    select 1 from updated u where u.event_code = seed.event_code
  )
    and not exists (
      select 1
      from public.events e
      where e.season_id = ctx.season_id
        and e.legacy_event_temp_id = seed.event_code
    )
  returning legacy_event_temp_id as event_code, id
)
select 'events_upserted' as step, count(*) as affected_rows
from (
  select * from updated
  union all
  select * from inserted
) x;

create temp table _uehm_s11_source_normalized as
select
  row_number() over () as source_row_no,
  trim(event_code) as event_code,
  nullif(trim(participant_name), '') as participant_name,
  lower(nullif(trim(email), '')) as email_norm,
  regexp_replace(coalesce(phone, ''), '\D', '', 'g') as phone_norm,
  regexp_replace(regexp_replace(coalesce(mssv, ''), '\.0$', ''), '\D', '', 'g') as mssv_norm,
  trim(attendance_status_mvp) as attendance_status_mvp,
  trim(checkin_status) as checkin_status,
  trim(attendance_status_detailed) as attendance_status_detailed,
  trim(excused_absence_flag) as excused_absence_flag,
  trim(no_show_flag) as no_show_flag,
  trim(blacklist_flag) as blacklist_flag,
  trim(issue_flag) as issue_flag,
  nullif(trim(issue_note), '') as issue_note,
  source_file,
  source_sheet,
  nullif(trim(dedup_group_size), '') as dedup_group_size,
  trim(import_ready) as import_ready,
  to_jsonb(src) as source_row
from _uehm_s11_event_source src
where trim(event_code) in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
  and upper(trim(import_ready)) = 'TRUE';

create temp table _uehm_s11_identity_candidates as
with email_match as (
  select
    src.source_row_no,
    p.id as person_id,
    'email' as match_method
  from _uehm_s11_source_normalized src
  join public.people p
    on lower(trim(p.email_primary)) = src.email_norm
  where src.email_norm is not null
),
phone_match as (
  select
    src.source_row_no,
    p.id as person_id,
    'phone' as match_method
  from _uehm_s11_source_normalized src
  join public.people p
    on regexp_replace(coalesce(p.phone_primary, ''), '\D', '', 'g') = src.phone_norm
  where src.phone_norm <> ''
),
mssv_match as (
  select
    src.source_row_no,
    mp.person_id,
    'mssv' as match_method
  from _uehm_s11_source_normalized src
  join public.mentee_profiles mp
    on regexp_replace(coalesce(mp.mssv, mp.mentee_code, ''), '\D', '', 'g') = src.mssv_norm
  where src.mssv_norm <> ''
    and mp.person_id is not null
)
select * from email_match
union all
select * from phone_match
union all
select * from mssv_match;

create temp table _uehm_s11_identity_resolved as
with ranked_methods as (
  select *,
    case match_method
      when 'email' then 1
      when 'phone' then 2
      when 'mssv' then 3
      else 9
    end as method_rank
  from _uehm_s11_identity_candidates
),
best_method as (
  select source_row_no, min(method_rank) as method_rank
  from ranked_methods
  group by source_row_no
),
best_candidates as (
  select rm.*
  from ranked_methods rm
  join best_method bm
    on bm.source_row_no = rm.source_row_no
   and bm.method_rank = rm.method_rank
)
select
  source_row_no,
  case when count(distinct person_id) = 1 then (array_agg(distinct person_id))[1] end as person_id,
  case when count(distinct person_id) = 1 then min(match_method) end as match_method,
  count(distinct person_id) as candidate_count
from best_candidates
group by source_row_no;

insert into public.staging_uehm_s11_event_import_skips (
  import_run_key,
  event_code,
  participant_name,
  email,
  phone,
  mssv,
  issue_reason,
  source_file,
  source_sheet,
  source_row
)
select
  ctx.import_run_key,
  src.event_code,
  src.participant_name,
  src.email_norm,
  src.phone_norm,
  src.mssv_norm,
  case
    when coalesce(res.candidate_count, 0) = 0 then 'missing_identity_match'
    when res.candidate_count > 1 then 'ambiguous_identity_match'
    else 'unknown_identity_resolution_issue'
  end as issue_reason,
  src.source_file,
  src.source_sheet,
  src.source_row
from _uehm_s11_source_normalized src
cross join _uehm_s11_import_context ctx
left join _uehm_s11_identity_resolved res on res.source_row_no = src.source_row_no
where res.person_id is null
on conflict do nothing;

create temp table _uehm_s11_participation_ready as
select
  src.source_row_no,
  src.event_code,
  e.id as event_id,
  ctx.season_id,
  res.person_id,
  case
    when upper(coalesce(src.source_sheet, '')) like '%CỰU%' then 'guest'
    when upper(coalesce(src.source_sheet, '')) like '%CUU%' then 'guest'
    when upper(coalesce(src.source_sheet, '')) like '%MENTOR%' then 'mentor'
    when upper(coalesce(src.source_sheet, '')) like '%MENTEE%' then 'mentee'
    when src.mssv_norm <> '' then 'mentee'
    else 'unknown'
  end as role_at_event,
  case
    when src.attendance_status_mvp = 'registered_confirmed' then 'confirmed'
    when src.attendance_status_mvp = 'absent' and src.excused_absence_flag = 'True' then 'declined'
    else 'registered'
  end as registration_status,
  case
    when src.attendance_status_mvp = 'attended' then 'attended'
    when src.attendance_status_mvp = 'absent' and src.excused_absence_flag = 'True' then 'absent_excused'
    when src.attendance_status_mvp = 'absent' then 'absent_unexcused'
    when src.attendance_status_mvp = 'registered' then 'registered_no_response'
    when src.attendance_status_mvp = 'registered_confirmed' then 'unknown'
    else 'unknown'
  end as attendance_status,
  case
    when src.attendance_status_mvp = 'attended' then (e.starts_at at time zone 'Asia/Ho_Chi_Minh')::date
    else null::date
  end as attendance_date,
  case
    when src.attendance_status_mvp = 'absent' then 'Absent/no-show in source event file.'
    when src.excused_absence_flag = 'True' then 'Excused absence in source event file.'
    else null
  end as excuse_reason,
  concat_ws(
    E'\n',
    'UEHM S11 event import 048.',
    'event_code=' || src.event_code,
    'source_file=' || coalesce(src.source_file, ''),
    'source_sheet=' || coalesce(src.source_sheet, ''),
    'match_method=' || coalesce(res.match_method, ''),
    'attendance_status_mvp=' || coalesce(src.attendance_status_mvp, ''),
    'attendance_status_detailed=' || coalesce(src.attendance_status_detailed, ''),
    'checkin_status=' || coalesce(src.checkin_status, ''),
    case when src.blacklist_flag = 'True' then 'blacklist_flag=True' end,
    case when src.no_show_flag = 'True' then 'no_show_flag=True' end,
    case when src.issue_note is not null then 'issue_note=' || src.issue_note end
  ) as admin_notes
from _uehm_s11_source_normalized src
join _uehm_s11_identity_resolved res on res.source_row_no = src.source_row_no and res.person_id is not null
join public.events e on e.legacy_event_temp_id = src.event_code and e.season_id = (select season_id from _uehm_s11_import_context)
cross join _uehm_s11_import_context ctx;

insert into public.event_participations (
  event_id,
  season_id,
  person_id,
  role_at_event,
  registration_status,
  attendance_status,
  attendance_date,
  excuse_reason,
  admin_notes,
  captured_by,
  walk_in
)
select
  ready.event_id,
  ready.season_id,
  ready.person_id,
  ready.role_at_event,
  ready.registration_status,
  ready.attendance_status,
  ready.attendance_date,
  ready.excuse_reason,
  ready.admin_notes,
  'uehm_s11_events_048_staging_import',
  false
from _uehm_s11_participation_ready ready
where not exists (
  select 1
  from _uehm_s11_participation_ready duplicate_ready
  where duplicate_ready.event_id = ready.event_id
    and duplicate_ready.person_id = ready.person_id
    and duplicate_ready.source_row_no < ready.source_row_no
)
  and not exists (
    select 1
    from public.event_participations existing
    where existing.event_id = ready.event_id
      and existing.person_id = ready.person_id
  );

select 'import_run_key' as metric, import_run_key as value
from _uehm_s11_import_context
union all
select 'source_rows_in_scope', count(*)::text from _uehm_s11_source_normalized
union all
select 'resolved_rows', count(*)::text from _uehm_s11_participation_ready
union all
select 'skipped_rows_logged', count(*)::text
from public.staging_uehm_s11_event_import_skips
where import_run_key = (select import_run_key from _uehm_s11_import_context);

commit;
