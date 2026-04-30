-- VAM OS production sync: Season 11 canonical season row, Phase 2D columns,
-- and stable Operations dashboard RPC.
--
-- Idempotent and additive. It preserves existing Season 11 activity rows by
-- creating UEHM-S11 with the season_id already used by production data.

create extension if not exists pgcrypto;

do $$
declare
  v_s11_id uuid;
begin
  select season_id
    into v_s11_id
  from (
    select season_id from public.matches where season_id is not null
    union all
    select season_id from public.mentoring_recaps where season_id is not null
    union all
    select season_id from public.events where season_id is not null
    union all
    select season_id from public.event_participations where season_id is not null
  ) used_seasons
  group by season_id
  order by count(*) desc
  limit 1;

  v_s11_id := coalesce(v_s11_id, gen_random_uuid());

  if exists (select 1 from public.seasons where code = 'UEHM-S11') then
    update public.seasons
    set
      id = coalesce(id, v_s11_id),
      name = 'UEH Mentoring Season 11',
      status = 'active',
      updated_at = case
        when exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'seasons'
            and column_name = 'updated_at'
        ) then now()
        else updated_at
      end
    where code = 'UEHM-S11';
  elsif exists (select 1 from public.seasons where id = v_s11_id) then
    update public.seasons
    set
      code = 'UEHM-S11',
      name = 'UEH Mentoring Season 11',
      status = 'active',
      updated_at = case
        when exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'seasons'
            and column_name = 'updated_at'
        ) then now()
        else updated_at
      end
    where id = v_s11_id;
  else
    insert into public.seasons (id, code, name, status)
    values (v_s11_id, 'UEHM-S11', 'UEH Mentoring Season 11', 'active');
  end if;

  update public.matches
  set season_id = v_s11_id
  where season_id is null;

  update public.mentoring_recaps
  set season_id = v_s11_id
  where season_id is null;

  update public.events
  set season_id = v_s11_id
  where season_id is null;

  update public.event_participations ep
  set season_id = e.season_id
  from public.events e
  where ep.season_id is null
    and ep.event_id = e.id
    and e.season_id is not null;

  update public.event_participations
  set season_id = v_s11_id
  where season_id is null;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'data_issue',
  target_person_id uuid null references public.people(id),
  season_code text null,
  status text not null default 'open',
  owner_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text null
);

alter table public.action_items
  add column if not exists type text not null default 'data_issue',
  add column if not exists target_person_id uuid null references public.people(id),
  add column if not exists season_code text null,
  add column if not exists status text not null default 'open',
  add column if not exists owner_email text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists notes text null,
  add column if not exists action_type text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists priority text default 'medium',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists source text,
  add column if not exists metadata jsonb default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'action_items'
      and column_name = 'season_id'
  ) then
    update public.action_items ai
    set season_code = coalesce(ai.season_code, s.code)
    from public.seasons s
    where ai.season_id = s.id
      and ai.season_code is null;
  end if;
end;
$$;

update public.action_items
set
  type = coalesce(nullif(type, ''), nullif(action_type, ''), 'data_issue'),
  action_type = coalesce(nullif(action_type, ''), nullif(type, ''), 'data_issue'),
  title = coalesce(nullif(title, ''), 'Admin correction workflow item'),
  season_code = coalesce(nullif(season_code, ''), 'UEHM-S11'),
  metadata = coalesce(metadata, '{}'::jsonb),
  updated_at = coalesce(updated_at, created_at, now())
where type is null
   or action_type is null
   or title is null
   or season_code is null
   or metadata is null
   or updated_at is null;

alter table public.action_items
  alter column type set not null,
  alter column action_type set default 'data_issue',
  alter column title set default 'Admin correction workflow item',
  alter column status set default 'open',
  alter column season_code set default 'UEHM-S11',
  alter column updated_at set default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'action_items_status_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items drop constraint action_items_status_check;
  end if;

  alter table public.action_items
    add constraint action_items_status_check
      check (status in ('open', 'in_progress', 'resolved', 'dropped', 'no_response', 'parked'));

  if exists (
    select 1 from pg_constraint
    where conname = 'action_items_type_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items drop constraint action_items_type_check;
  end if;

  alter table public.action_items
    add constraint action_items_type_check
      check (
        type in (
          'followup_no_recap',
          'data_issue',
          'correction_request',
          'event_attendance_issue',
          'manual_task',
          'unmatched_recap',
          'missing_mentee',
          'missing_mentor',
          'invalid_date',
          'duplicate_recap'
        )
      );

  if exists (
    select 1 from pg_constraint
    where conname = 'action_items_action_type_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items drop constraint action_items_action_type_check;
  end if;

  alter table public.action_items
    add constraint action_items_action_type_check
      check (
        action_type is null
        or action_type in (
          'followup_no_recap',
          'data_issue',
          'correction_request',
          'event_attendance_issue',
          'manual_task',
          'unmatched_recap',
          'missing_mentee',
          'missing_mentor',
          'invalid_date',
          'duplicate_recap'
        )
      );
end;
$$;

create index if not exists action_items_type_idx on public.action_items(type);
create index if not exists action_items_target_person_id_idx on public.action_items(target_person_id);
create index if not exists action_items_season_code_idx on public.action_items(season_code);
create index if not exists action_items_status_idx on public.action_items(status);
create index if not exists action_items_owner_email_idx on public.action_items(owner_email);
create index if not exists action_items_updated_at_idx on public.action_items(updated_at desc);

drop trigger if exists action_items_set_updated_at on public.action_items;
create trigger action_items_set_updated_at
before update on public.action_items
for each row
execute function public.set_updated_at();

create table if not exists public.activity_correction_log (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id uuid not null,
  correction_type text not null,
  field_name text null,
  old_value text null,
  new_value text null,
  reason text null,
  corrected_by text null,
  created_at timestamptz not null default now()
);

alter table public.activity_correction_log
  add column if not exists target_table text,
  add column if not exists target_id uuid,
  add column if not exists correction_type text,
  add column if not exists field_name text,
  add column if not exists old_value text,
  add column if not exists new_value text,
  add column if not exists reason text,
  add column if not exists corrected_by text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists status text default 'applied',
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'activity_correction_log_target_table_check'
      and conrelid = 'public.activity_correction_log'::regclass
  ) then
    alter table public.activity_correction_log drop constraint activity_correction_log_target_table_check;
  end if;

  alter table public.activity_correction_log
    add constraint activity_correction_log_target_table_check
      check (target_table in ('mentoring_recaps', 'event_participations'));

  if exists (
    select 1 from pg_constraint
    where conname = 'activity_correction_log_correction_type_check'
      and conrelid = 'public.activity_correction_log'::regclass
  ) then
    alter table public.activity_correction_log drop constraint activity_correction_log_correction_type_check;
  end if;

  alter table public.activity_correction_log
    add constraint activity_correction_log_correction_type_check
      check (
        correction_type in (
          'update_field',
          'status_change',
          'issue_flag_change',
          'admin_note',
          'manual_review',
          'other'
        )
      );
end;
$$;

create index if not exists activity_correction_log_target_idx
  on public.activity_correction_log(target_table, target_id);
create index if not exists activity_correction_log_created_at_idx
  on public.activity_correction_log(created_at desc);
create index if not exists activity_correction_log_correction_type_idx
  on public.activity_correction_log(correction_type);
create index if not exists activity_correction_log_corrected_by_idx
  on public.activity_correction_log(corrected_by);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'mentoring_recaps_status_check'
      and conrelid = 'public.mentoring_recaps'::regclass
  ) then
    alter table public.mentoring_recaps drop constraint mentoring_recaps_status_check;
  end if;

  alter table public.mentoring_recaps
    add constraint mentoring_recaps_status_check
      check (status in ('submitted', 'needs_review', 'invalid', 'duplicate', 'deleted'));
end;
$$;

create or replace function public.get_operations_dashboard_data(p_season_code text default 'UEHM-S11')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_season_id uuid;
  v_selected_month text;
  v_previous_month text;
  v_result jsonb;
begin
  select au.role
    into v_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('viewer', 'reviewer', 'admin', 'super_admin') then
    raise exception 'VAM OS admin access required'
      using errcode = '42501';
  end if;

  select s.id
    into v_season_id
  from public.seasons s
  where s.code = p_season_code
  limit 1;

  if v_season_id is null then
    raise exception 'Season % was not found', p_season_code
      using errcode = 'P0001';
  end if;

  with months_with_data as (
    select mr.meeting_month as month_value
    from public.mentoring_recaps mr
    where mr.season_id = v_season_id
      and mr.meeting_month between '2025-10' and '2026-06'
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
    union
    select to_char(e.starts_at, 'YYYY-MM') as month_value
    from public.events e
    where e.season_id = v_season_id
      and to_char(e.starts_at, 'YYYY-MM') between '2025-10' and '2026-06'
  )
  select coalesce(
    (select max(month_value) from months_with_data where month_value <= to_char(now(), 'YYYY-MM')),
    case when to_char(now(), 'YYYY-MM') between '2025-10' and '2026-06' then to_char(now(), 'YYYY-MM') end,
    (select max(month_value) from months_with_data),
    '2025-10'
  )
    into v_selected_month;

  v_previous_month := to_char((v_selected_month || '-01')::date - interval '1 month', 'YYYY-MM');

  select jsonb_build_object(
    'seasons',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.code nulls last, row_data.name nulls last)
        from (
          select id, code, name
          from public.seasons
        ) row_data
      ), '[]'::jsonb),
    'people',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.full_name nulls last, row_data.email_primary nulls last)
        from (
          select id, full_name, email_primary
          from public.people
        ) row_data
      ), '[]'::jsonb),
    'mentees',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.mentee_code nulls last)
        from (
          select id, person_id, mentee_code
          from public.mentee_profiles
        ) row_data
      ), '[]'::jsonb),
    'matches',
      coalesce((
        select jsonb_agg(to_jsonb(row_data))
        from (
          select id, season_id, status, match_type, mentor_person_id, mentee_person_id
          from public.matches
          where season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'recaps',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.meeting_date desc nulls last)
        from (
          select
            id,
            season_id,
            match_id,
            mentor_person_id,
            mentee_person_id,
            meeting_date,
            meeting_month,
            recap_url,
            recap_source,
            recap_note,
            meeting_type,
            captured_by,
            issue_flag,
            status,
            admin_notes
          from public.mentoring_recaps
          where season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'events',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.starts_at nulls last, row_data.event_name nulls last)
        from (
          select id, legacy_event_temp_id, season_id, event_name, event_type, starts_at, source_notes
          from public.events
          where season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'eventParticipations',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.attendance_date desc nulls last)
        from (
          select
            ep.id,
            ep.event_id,
            ep.season_id,
            ep.person_id,
            ep.role_at_event,
            ep.registration_status,
            ep.attendance_status,
            ep.attendance_date,
            ep.recap_url,
            ep.excuse_reason,
            ep.admin_notes,
            ep.captured_by,
            ep.walk_in
          from public.event_participations ep
          left join public.events e on e.id = ep.event_id
          where ep.season_id = v_season_id
             or e.season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'kpis',
      jsonb_build_object(
        'selectedMonth', v_selected_month,
        'recapCount', (
          select count(*)::int
          from public.mentoring_recaps mr
          where mr.season_id = v_season_id
            and mr.meeting_month = v_selected_month
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'activeMenteeCount', (
          select count(distinct mr.mentee_person_id)::int
          from public.mentoring_recaps mr
          where mr.season_id = v_season_id
            and mr.meeting_month = v_selected_month
            and mr.mentee_person_id is not null
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'activeMentorCount', (
          select count(distinct mr.mentor_person_id)::int
          from public.mentoring_recaps mr
          where mr.season_id = v_season_id
            and mr.meeting_month = v_selected_month
            and mr.mentor_person_id is not null
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'mentorWithoutRecapCount', (
          with active_mentors as (
            select distinct m.mentor_person_id
            from public.matches m
            where m.season_id = v_season_id
              and lower(coalesce(m.status, '')) = 'active'
              and m.mentor_person_id is not null
              and m.mentee_person_id is not null
          ),
          selected_mentors as (
            select distinct mr.mentor_person_id
            from public.mentoring_recaps mr
            where mr.season_id = v_season_id
              and mr.meeting_month = v_selected_month
              and mr.mentor_person_id is not null
              and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
          )
          select count(*)::int
          from active_mentors am
          where not exists (
            select 1 from selected_mentors sm where sm.mentor_person_id = am.mentor_person_id
          )
        ),
        'eventTrainingCount', (
          select count(*)::int
          from public.events e
          where e.season_id = v_season_id
            and to_char(e.starts_at, 'YYYY-MM') = v_selected_month
        ),
        'eventAttendanceCount', (
          select count(*)::int
          from public.event_participations ep
          join public.events e on e.id = ep.event_id
          where e.season_id = v_season_id
            and to_char(e.starts_at, 'YYYY-MM') = v_selected_month
            and lower(coalesce(ep.attendance_status, '')) = 'attended'
        ),
        'followUpCount', (
          with active_mentees as (
            select distinct m.mentee_person_id
            from public.matches m
            where m.season_id = v_season_id
              and lower(coalesce(m.status, '')) = 'active'
              and m.mentor_person_id is not null
              and m.mentee_person_id is not null
          ),
          selected_mentees as (
            select distinct mr.mentee_person_id
            from public.mentoring_recaps mr
            where mr.season_id = v_season_id
              and mr.meeting_month = v_selected_month
              and mr.mentee_person_id is not null
              and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
          ),
          previous_mentees as (
            select distinct mr.mentee_person_id
            from public.mentoring_recaps mr
            where mr.season_id = v_season_id
              and mr.meeting_month = v_previous_month
              and mr.mentee_person_id is not null
              and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
          )
          select count(*)::int
          from active_mentees am
          where not exists (
            select 1 from selected_mentees sm where sm.mentee_person_id = am.mentee_person_id
          )
            and not exists (
              select 1 from previous_mentees pm where pm.mentee_person_id = am.mentee_person_id
            )
        )
      )
  )
    into v_result;

  return v_result;
end;
$$;

comment on function public.get_operations_dashboard_data(text) is
  'Stable Season-scoped read surface for the Operations dashboard. Requires an active admin user and a canonical seasons row.';

revoke all on function public.get_operations_dashboard_data(text) from public;
revoke all on function public.get_operations_dashboard_data(text) from anon;
grant execute on function public.get_operations_dashboard_data(text) to authenticated;

notify pgrst, 'reload schema';
