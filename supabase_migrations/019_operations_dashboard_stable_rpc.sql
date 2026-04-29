-- VAM OS Sprint 1B recovery: stable Operations dashboard read surface.
-- Safe to review/apply after approval.
-- This migration does not enable RLS, disable RLS, alter raw table data, or change existing policies.

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

  with months_with_data as (
    select mr.meeting_month as month_value
    from public.mentoring_recaps mr
    where (v_season_id is null or mr.season_id = v_season_id)
      and mr.meeting_month between '2025-10' and '2026-06'
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
    union
    select to_char(e.starts_at, 'YYYY-MM') as month_value
    from public.events e
    where (v_season_id is null or e.season_id = v_season_id)
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
          where v_season_id is null or season_id = v_season_id
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
          where v_season_id is null or season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'events',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.starts_at nulls last, row_data.event_name nulls last)
        from (
          select id, legacy_event_temp_id, season_id, event_name, event_type, starts_at, source_notes
          from public.events
          where v_season_id is null or season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'eventParticipations',
      coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.attendance_date desc nulls last)
        from (
          select
            id,
            event_id,
            season_id,
            person_id,
            role_at_event,
            registration_status,
            attendance_status,
            attendance_date,
            recap_url,
            excuse_reason,
            admin_notes,
            captured_by,
            walk_in
          from public.event_participations
          where v_season_id is null or season_id = v_season_id
        ) row_data
      ), '[]'::jsonb),
    'kpis',
      jsonb_build_object(
        'selectedMonth', v_selected_month,
        'recapCount', (
          select count(*)::int
          from public.mentoring_recaps mr
          where (v_season_id is null or mr.season_id = v_season_id)
            and mr.meeting_month = v_selected_month
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'activeMenteeCount', (
          select count(distinct mr.mentee_person_id)::int
          from public.mentoring_recaps mr
          where (v_season_id is null or mr.season_id = v_season_id)
            and mr.meeting_month = v_selected_month
            and mr.mentee_person_id is not null
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'activeMentorCount', (
          select count(distinct mr.mentor_person_id)::int
          from public.mentoring_recaps mr
          where (v_season_id is null or mr.season_id = v_season_id)
            and mr.meeting_month = v_selected_month
            and mr.mentor_person_id is not null
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        ),
        'mentorWithoutRecapCount', (
          with active_mentors as (
            select distinct m.mentor_person_id
            from public.matches m
            where (v_season_id is null or m.season_id = v_season_id)
              and lower(coalesce(m.status, '')) = 'active'
              and m.mentor_person_id is not null
              and m.mentee_person_id is not null
          ),
          selected_mentors as (
            select distinct mr.mentor_person_id
            from public.mentoring_recaps mr
            where (v_season_id is null or mr.season_id = v_season_id)
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
          where (v_season_id is null or e.season_id = v_season_id)
            and to_char(e.starts_at, 'YYYY-MM') = v_selected_month
        ),
        'eventAttendanceCount', (
          select count(*)::int
          from public.event_participations ep
          join public.events e on e.id = ep.event_id
          where (v_season_id is null or e.season_id = v_season_id)
            and to_char(e.starts_at, 'YYYY-MM') = v_selected_month
            and lower(coalesce(ep.attendance_status, '')) = 'attended'
        ),
        'followUpCount', (
          with active_mentees as (
            select distinct m.mentee_person_id
            from public.matches m
            where (v_season_id is null or m.season_id = v_season_id)
              and lower(coalesce(m.status, '')) = 'active'
              and m.mentor_person_id is not null
              and m.mentee_person_id is not null
          ),
          selected_mentees as (
            select distinct mr.mentee_person_id
            from public.mentoring_recaps mr
            where (v_season_id is null or mr.season_id = v_season_id)
              and mr.meeting_month = v_selected_month
              and mr.mentee_person_id is not null
              and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
          ),
          previous_mentees as (
            select distinct mr.mentee_person_id
            from public.mentoring_recaps mr
            where (v_season_id is null or mr.season_id = v_season_id)
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
  'Stable read surface for the Operations dashboard. SECURITY DEFINER avoids fragile cross-table dashboard reads when raw tables are under RLS. This first recovery version is active-admin gated and does not change raw table RLS state.';

revoke all on function public.get_operations_dashboard_data(text) from public;
revoke all on function public.get_operations_dashboard_data(text) from anon;
grant execute on function public.get_operations_dashboard_data(text) to authenticated;

-- Rollback:
-- drop function if exists public.get_operations_dashboard_data(text);
