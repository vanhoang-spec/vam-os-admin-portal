-- Migration 035: Fix Operations RPC match_status enum cast
-- Resolves the empty string enum cast error "invalid input value for enum match_status: """.
-- Replaces lower(coalesce(m.status, '')) = 'active' with exact enum comparison m.status = 'active'.

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
  v_kpi_recap_count int;
  v_kpi_active_mentee_count int;
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

  -- Use v_season_latest_closed_month instead of dynamic max() open-month bleed logic
  select latest_closed_month, previous_closed_month, total_recap_entries, distinct_mentees_with_recap
    into v_selected_month, v_previous_month, v_kpi_recap_count, v_kpi_active_mentee_count
  from public.v_season_latest_closed_month
  where season_id = v_season_id;

  if v_selected_month is null then
    v_selected_month := '2025-10';
    v_previous_month := '2025-09';
  end if;

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
        'recapCount', coalesce(v_kpi_recap_count, (
          select count(*)::int
          from public.mentoring_recaps mr
          where mr.season_id = v_season_id
            and mr.meeting_month = v_selected_month
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        )),
        'activeMenteeCount', coalesce(v_kpi_active_mentee_count, (
          select count(distinct mr.mentee_person_id)::int
          from public.mentoring_recaps mr
          where mr.season_id = v_season_id
            and mr.meeting_month = v_selected_month
            and mr.mentee_person_id is not null
            and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
        )),
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
              and m.status = 'active'
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
              and m.status = 'active'
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
              and mr.meeting_month = coalesce(v_previous_month, to_char((v_selected_month || '-01')::date - interval '1 month', 'YYYY-MM'))
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
  'Stable Season-scoped read surface for the Operations dashboard. Relies on v_season_latest_closed_month for correct KPI timeframe logic.';

notify pgrst, 'reload schema';


-- Verification queries (Note: The parameter is p_season_code, not p_month)
-- Passing '2026-03' will throw 'Season 2026-03 was not found'.
-- But to fulfill the exact requested structure (commented out to prevent crash):
-- select public.get_operations_dashboard_data('2026-03');
-- select public.get_operations_dashboard_data('2026-04');

-- SELECT public.get_operations_dashboard_data('UEHM-S11'); -- Commented out to prevent VAM OS admin access error during migration

