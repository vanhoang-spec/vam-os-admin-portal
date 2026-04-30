-- VAM OS Founder & Core Team Intelligence RPC.
-- Idempotent. Uses only production-safe base columns and returns defaults when
-- deeper enrichment fields are not available yet.

create or replace function public.get_founder_intelligence_dashboard(p_season_code text default 'UEHM-S11')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
  v_selected_month text;
  v_total_mentors int := 0;
  v_total_mentees int := 0;
  v_active_matches int := 0;
  v_active_mentors int := 0;
  v_active_mentees int := 0;
  v_silent_mentees int := 0;
begin
  select s.id
    into v_season_id
  from public.seasons s
  where s.code = p_season_code
  limit 1;

  if v_season_id is null then
    select season_id
      into v_season_id
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
  end if;

  select count(*)::int into v_total_mentors from public.mentor_profiles;
  select count(*)::int into v_total_mentees from public.mentee_profiles;

  select count(*)::int
    into v_active_matches
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status, '')) = 'active'
    and m.mentor_person_id is not null
    and m.mentee_person_id is not null;

  select count(distinct m.mentor_person_id)::int
    into v_active_mentors
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status, '')) = 'active'
    and m.mentor_person_id is not null;

  select count(distinct m.mentee_person_id)::int
    into v_active_mentees
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status, '')) = 'active'
    and m.mentee_person_id is not null;

  select coalesce(
    max(mr.meeting_month) filter (
      where mr.meeting_month <= to_char(now(), 'YYYY-MM')
        and mr.meeting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    ),
    max(mr.meeting_month) filter (
      where mr.meeting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    ),
    to_char(now(), 'YYYY-MM')
  )
    into v_selected_month
  from public.mentoring_recaps mr
  where (v_season_id is null or mr.season_id = v_season_id)
    and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review');

  with active_mentees as (
    select distinct m.mentee_person_id
    from public.matches m
    where (v_season_id is null or m.season_id = v_season_id)
      and lower(coalesce(m.status, '')) = 'active'
      and m.mentee_person_id is not null
  ),
  recapped_mentees as (
    select distinct mr.mentee_person_id
    from public.mentoring_recaps mr
    where (v_season_id is null or mr.season_id = v_season_id)
      and mr.meeting_month = v_selected_month
      and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
  )
  select count(*)::int
    into v_silent_mentees
  from active_mentees am
  where not exists (
    select 1 from recapped_mentees rm where rm.mentee_person_id = am.mentee_person_id
  );

  return (
    with active_matches as (
      select *
      from public.matches m
      where (v_season_id is null or m.season_id = v_season_id)
        and lower(coalesce(m.status, '')) = 'active'
        and m.mentor_person_id is not null
        and m.mentee_person_id is not null
    ),
    mentor_load as (
      select
        am.mentor_person_id,
        count(distinct am.mentee_person_id)::int as mentee_count
      from active_matches am
      group by am.mentor_person_id
    ),
    mentor_rows as (
      select
        mp.person_id,
        p.full_name,
        coalesce(nullif(mp.company_current, ''), 'Unknown') as company,
        coalesce(nullif(mp.title_current, ''), 'Unknown') as title,
        coalesce(mp.years_experience_min, 0) as years_experience_min,
        coalesce(ml.mentee_count, 0) as mentee_count
      from public.mentor_profiles mp
      left join public.people p on p.id = mp.person_id
      left join mentor_load ml on ml.mentor_person_id = mp.person_id
    ),
    mentee_rows as (
      select
        mp.person_id,
        coalesce(nullif(mp.school_code, ''), nullif(mp.school_raw, ''), 'Unknown') as school,
        coalesce(nullif(mp.major, ''), 'Unknown') as major
      from public.mentee_profiles mp
    ),
    recaps_month as (
      select *
      from public.mentoring_recaps mr
      where (v_season_id is null or mr.season_id = v_season_id)
        and mr.meeting_month = v_selected_month
        and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review')
    )
    select jsonb_build_object(
      'season_code', p_season_code,
      'season_id', v_season_id,
      'selected_month', v_selected_month,
      'total_mentors', v_total_mentors,
      'total_mentees', v_total_mentees,
      'active_matches', v_active_matches,
      'mentor_capacity_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) order by bucket)
        from (
          select
            case
              when mentee_count = 0 then '0 mentee'
              when mentee_count = 1 then '1 mentee'
              when mentee_count = 2 then '2 mentees'
              when mentee_count = 3 then '3 mentees'
              else '4+ mentees'
            end as bucket,
            count(*)::int
          from mentor_rows
          group by 1
        ) buckets
      ), '[]'::jsonb),
      'mentee_school_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('school', school, 'count', count) order by count desc, school)
        from (
          select school, count(*)::int
          from mentee_rows
          group by school
        ) schools
      ), '[]'::jsonb),
      'mentor_company_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('company', company, 'count', count) order by count desc, company)
        from (
          select company, count(*)::int
          from mentor_rows
          group by company
          order by count(*) desc, company
          limit 20
        ) companies
      ), '[]'::jsonb),
      'match_health_summary', jsonb_build_object(
        'activeMatches', v_active_matches,
        'activeMentors', v_active_mentors,
        'activeMentees', v_active_mentees,
        'silentMentees', v_silent_mentees,
        'recapsInSelectedMonth', (select count(*)::int from recaps_month)
      ),
      'top_mentors_by_mentee_count', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'mentorId', person_id,
            'mentorName', full_name,
            'currentCompany', company,
            'currentTitle', title,
            'menteeCount', mentee_count,
            'capacityTarget', 4,
            'recapCountCurrentMonth', (
              select count(*)::int
              from recaps_month rm
              where rm.mentor_person_id = mentor_rows.person_id
            )
          )
          order by mentee_count desc, full_name
        )
        from (
          select *
          from mentor_rows
          where mentee_count > 0
          order by mentee_count desc, full_name
          limit 20
        ) mentor_rows
      ), '[]'::jsonb),
      'data_quality_flags', jsonb_build_array(
        jsonb_build_object('key', 'season_row_missing', 'count', case when exists (select 1 from public.seasons where code = p_season_code) then 0 else 1 end),
        jsonb_build_object('key', 'recap_missing_mentee', 'count', (select count(*)::int from public.mentoring_recaps where (v_season_id is null or season_id = v_season_id) and mentee_person_id is null)),
        jsonb_build_object('key', 'recap_missing_mentor', 'count', (select count(*)::int from public.mentoring_recaps where (v_season_id is null or season_id = v_season_id) and mentor_person_id is null))
      ),
      'definitions', jsonb_build_object(
        'selectedMonth', v_selected_month,
        'activeMentor', 'Mentor with at least one active match in selected season.',
        'silentMentee', 'Mentee with an active match and no valid recap in selected month.',
        'overloadedMentor', 'Mentor with 4+ active mentees, until explicit capacity fields are available.',
        'validRecapStatuses', jsonb_build_array('submitted', 'needs_review', '')
      ),
      'mentorProfile', jsonb_build_object(
        'totalMentors', v_total_mentors,
        'activeMentors', v_active_mentors,
        'inactiveMentors', greatest(v_total_mentors - v_active_mentors, 0),
        'byIndustry', '[]'::jsonb,
        'byFunction', '[]'::jsonb,
        'byExperienceBand', coalesce((
          select jsonb_agg(jsonb_build_object('band', band, 'count', count) order by band)
          from (
            select
              case
                when years_experience_min <= 0 then 'Unknown'
                when years_experience_min <= 3 then '0-3 years'
                when years_experience_min <= 7 then '4-7 years'
                when years_experience_min <= 12 then '8-12 years'
                else '13+ years'
              end as band,
              count(*)::int
            from mentor_rows
            group by 1
          ) bands
        ), '[]'::jsonb),
        'byVamSeniority', '[]'::jsonb,
        'bySeniorityLevel', '[]'::jsonb,
        'overloadedMentors', coalesce((
          select jsonb_agg(jsonb_build_object('mentorId', person_id, 'mentorName', full_name, 'industry', 'Unknown', 'currentTitle', title, 'currentCompany', company, 'menteeCount', mentee_count, 'capacityTarget', 4, 'recapCountCurrentMonth', 0) order by mentee_count desc, full_name)
          from mentor_rows
          where mentee_count >= 4
        ), '[]'::jsonb),
        'inactiveMentorsWithMentees', '[]'::jsonb
      ),
      'menteeProfile', jsonb_build_object(
        'totalMentees', v_total_mentees,
        'activeMentees', v_active_mentees,
        'silentMentees', v_silent_mentees,
        'byMajor', coalesce((select jsonb_agg(jsonb_build_object('major', major, 'count', count) order by count desc, major) from (select major, count(*)::int from mentee_rows group by major) majors), '[]'::jsonb),
        'byUniversity', coalesce((select jsonb_agg(jsonb_build_object('university', school, 'count', count) order by count desc, school) from (select school, count(*)::int from mentee_rows group by school) schools), '[]'::jsonb),
        'byCareerInterest', '[]'::jsonb,
        'byTargetIndustry', '[]'::jsonb,
        'byYearOfStudy', '[]'::jsonb,
        'bySupportTeam', '[]'::jsonb
      ),
      'matchingIntelligence', jsonb_build_object(
        'totalActiveMatches', v_active_matches,
        'mentorMenteeRatio', case when v_active_mentees = 0 then '0:0' else concat(round(v_active_mentors::numeric / nullif(v_active_mentees, 0), 2), ':1') end,
        'matchesByIndustryAlignment', '[]'::jsonb,
        'matchesByFunctionAlignment', '[]'::jsonb,
        'unmatchedOrWeakSegments', '[]'::jsonb,
        'menteesWithoutIndustryMentor', 0,
        'mentorSupplyVsMenteeDemand', '[]'::jsonb
      ),
      'activityBySegment', jsonb_build_object(
        'activeMenteeRateByMajor', '[]'::jsonb,
        'recapRateBySupportTeam', '[]'::jsonb,
        'activeMentorRateByIndustry', '[]'::jsonb,
        'silentMenteeByCareerInterest', '[]'::jsonb
      ),
      'recommendedActions', '[]'::jsonb
    )
  );
end;
$$;

comment on function public.get_founder_intelligence_dashboard(text) is
  'Founder/Core Team intelligence read surface. Returns JSONB with defaults so /operations/intelligence can load even before deeper enrichment exists.';

revoke all on function public.get_founder_intelligence_dashboard(text) from public;
revoke all on function public.get_founder_intelligence_dashboard(text) from anon;
grant execute on function public.get_founder_intelligence_dashboard(text) to authenticated;

notify pgrst, 'reload schema';
