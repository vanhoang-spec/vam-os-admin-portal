-- VAM OS 030: Enrich get_founder_intelligence_dashboard
-- Verified columns: migration_030_column_verification.md
-- Plan: migration_030_plan.md
-- RPC-only. No DDL. Rollback: re-run 029.
-- Do NOT apply without staging QA (docs/030_FOUNDER_INTELLIGENCE_QA.md).

-- ── Helper functions ──────────────────────────────────────────────────────────

create or replace function public.intel_norm(p_value text)
returns text language sql immutable as $$
  select nullif(lower(trim(coalesce(p_value, ''))), '')
$$;

create or replace function public.intel_experience_band(p_years int)
returns text language sql immutable as $$
  select case
    when p_years is null or p_years <= 0 then 'Chưa rõ'
    when p_years <= 3  then '0-3 years'
    when p_years <= 7  then '4-7 years'
    when p_years <= 12 then '8-12 years'
    else '13+ years'
  end
$$;


create or replace function public.intel_vam_seniority_band(p_years int)
returns text language sql immutable as $$
  select case
    when p_years is null or p_years = 0 then 'New mentor'
    when p_years = 1                    then '1 season'
    when p_years between 2 and 3        then '2-3 seasons'
    else '4+ seasons'
  end
$$;

-- ── Main RPC ──────────────────────────────────────────────────────────────────

create or replace function public.get_founder_intelligence_dashboard(
  p_season_code text default 'UEHM-S11'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_season_id      uuid;
  v_selected_month text;
  v_total_mentors  int := 0;
  v_total_mentees  int := 0;
  v_active_matches int := 0;
  v_active_mentors int := 0;
  v_active_mentees int := 0;
  v_silent_mentees int := 0;
begin
  -- Season resolution
  select s.id into v_season_id
  from public.seasons s where s.code = p_season_code limit 1;

  if v_season_id is null then
    select season_id into v_season_id
    from (
      select season_id from public.matches where season_id is not null
      union all
      select season_id from public.mentoring_recaps where season_id is not null
      union all
      select season_id from public.events where season_id is not null
      union all
      select season_id from public.event_participations where season_id is not null
    ) x group by season_id order by count(*) desc limit 1;
  end if;

  -- Scalar counts
  select count(*)::int into v_total_mentors from public.mentor_profiles;
  select count(*)::int into v_total_mentees from public.mentee_profiles;

  select count(*)::int into v_active_matches
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status::text,'')) = 'active'
    and m.mentor_person_id is not null and m.mentee_person_id is not null;

  select count(distinct m.mentor_person_id)::int into v_active_mentors
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status::text,'')) = 'active' and m.mentor_person_id is not null;

  select count(distinct m.mentee_person_id)::int into v_active_mentees
  from public.matches m
  where (v_season_id is null or m.season_id = v_season_id)
    and lower(coalesce(m.status::text,'')) = 'active'
    and m.mentor_person_id is not null
    and m.mentee_person_id is not null;

  -- Selected month
  select coalesce(
    max(mr.meeting_month) filter (
      where mr.meeting_month < to_char(now(),'YYYY-MM')
        and mr.meeting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    max(mr.meeting_month) filter (
      where mr.meeting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    to_char(now(),'YYYY-MM')
  ) into v_selected_month
  from public.mentoring_recaps mr
  where (v_season_id is null or mr.season_id = v_season_id)
    and coalesce(trim(lower(mr.status::text)),'') in ('','submitted','needs_review');

  -- Silent mentees
  with am as (
    select distinct m.mentee_person_id
    from public.matches m
    where (v_season_id is null or m.season_id = v_season_id)
      and lower(coalesce(m.status::text,'')) = 'active'
      and m.mentor_person_id is not null
      and m.mentee_person_id is not null
  ),
  rm as (
    select distinct mr.mentee_person_id
    from public.mentoring_recaps mr
    where (v_season_id is null or mr.season_id = v_season_id)
      and mr.meeting_month = v_selected_month and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status::text)),'') in ('','submitted','needs_review')
  )
  select count(*)::int into v_silent_mentees
  from am where not exists (select 1 from rm where rm.mentee_person_id = am.mentee_person_id);

  -- Main return
  return (
    with
    active_matches as (
      select * from public.matches m
      where (v_season_id is null or m.season_id = v_season_id)
        and lower(coalesce(m.status::text,'')) = 'active'
        and m.mentor_person_id is not null and m.mentee_person_id is not null
    ),
    mentor_load as (
      select am.mentor_person_id,
             count(distinct am.mentee_person_id)::int as mentee_count
      from active_matches am group by am.mentor_person_id
    ),
    -- 029-compatible base rows (for backward-compat sections)
    mentor_rows as (
      select mp.person_id, p.full_name,
             coalesce(nullif(mp.company_current,''),'Chưa rõ') as company,
             coalesce(nullif(mp.title_current,''),'Chưa rõ')   as title,
             coalesce(mp.years_experience_min,0)               as years_experience_min,
             coalesce(ml.mentee_count,0)                       as mentee_count
      from public.mentor_profiles mp
      left join public.people p  on p.id = mp.person_id
      left join mentor_load ml   on ml.mentor_person_id = mp.person_id
    ),
    mentee_rows as (
      select mp.person_id,
             coalesce(nullif(mp.school_code,''),nullif(mp.school_raw,''),'Chưa rõ') as school,
             coalesce(nullif(mp.major,''),'Chưa rõ') as major
      from public.mentee_profiles mp
    ),
    recaps_month as (
      select * from public.mentoring_recaps mr
      where (v_season_id is null or mr.season_id = v_season_id)
        and mr.meeting_month = v_selected_month
        and coalesce(trim(lower(mr.status::text)),'') in ('','submitted','needs_review')
    ),
    -- 030 enriched mentor metrics
    mentor_metrics as (
      select
        mp.person_id                                               as mentor_id,
        coalesce(p.full_name,'Chưa rõ')                          as mentor_name,
        coalesce(mp.industry,'Chưa rõ')                          as industry,
        coalesce(mp.function_area,'Chưa rõ')                     as function_area,
        coalesce(mp.current_title, mp.title_current)             as current_title,
        coalesce(mp.current_company, mp.company_current)         as current_company,
        coalesce(mp.years_of_experience, mp.years_experience_min) as years_of_experience,
        coalesce(mp.years_in_vam,0)                              as years_in_vam,
        coalesce(mp.seniority_level,'Chưa rõ')                   as seniority_level,
        coalesce(mp.capacity_target,4)                           as capacity_target,
        count(distinct am.mentee_person_id)::int                 as mentee_count,
        count(distinct rm.id)::int                               as recap_count_current_month
      from public.mentor_profiles mp
      left join public.people p   on p.id = mp.person_id
      left join active_matches am on am.mentor_person_id = mp.person_id
      left join recaps_month rm   on rm.mentor_person_id = mp.person_id
      group by mp.person_id, p.full_name,
               mp.industry, mp.function_area,
               mp.current_title, mp.title_current,
               mp.current_company, mp.company_current,
               mp.years_of_experience, mp.years_experience_min,
               mp.years_in_vam, mp.seniority_level, mp.capacity_target
    ),
    -- 030 enriched mentee metrics
    mentee_metrics as (
      select
        mp.person_id                                                          as mentee_id,
        coalesce(mp.major,'Chưa rõ')                                         as major,
        coalesce(mp.university, mp.school_raw, mp.school_code,'Chưa rõ')    as university,
        coalesce(mp.career_interest,'Chưa rõ')                              as career_interest,
        coalesce(mp.target_industry,'Chưa rõ')                              as target_industry,
        coalesce(mp.year_of_study,'Chưa rõ')                                as year_of_study,
        coalesce(mp.support_team,'Chưa rõ')                                 as support_team,
        count(distinct am.id)::int                                           as active_match_count,
        count(distinct rm.id)::int                                           as recap_count_current_month
      from public.mentee_profiles mp
      left join active_matches am on am.mentee_person_id = mp.person_id
      left join recaps_month rm   on rm.mentee_person_id = mp.person_id
      group by mp.person_id, mp.major,
               mp.university, mp.school_raw, mp.school_code,
               mp.career_interest, mp.target_industry,
               mp.year_of_study, mp.support_team
    ),
    -- Activity segment CTEs
    support_activity as (
      select support_team,
             count(*)::int as active_mentees,
             (count(*) filter (where recap_count_current_month > 0))::int as mentees_with_recap,
             round(100.0 * (count(*) filter (where recap_count_current_month > 0))
                   / nullif(count(*),0), 1) as recap_rate
      from mentee_metrics where active_match_count > 0 group by support_team
    ),
    major_activity as (
      select major,
             count(*)::int as mentees,
             (count(*) filter (where active_match_count > 0))::int as active_mentees,
             round(100.0 * (count(*) filter (where active_match_count > 0))
                   / nullif(count(*),0), 1) as active_rate
      from mentee_metrics group by major
    ),
    industry_activity as (
      select industry,
             count(*)::int as mentors,
             (count(*) filter (where mentee_count > 0 or recap_count_current_month > 0))::int as active_mentors,
             round(100.0 * (count(*) filter (where mentee_count > 0 or recap_count_current_month > 0))
                   / nullif(count(*),0), 1) as active_rate
      from mentor_metrics group by industry
    ),
    -- Recommended actions (3 safe rules)
    recs as (
      -- Rule 1: Overloaded mentors
      select 'high' as priority,
             'Phân tải mentor overloaded' as title,
             concat('Có ',count(*), ' mentor đang vượt capacity.') as reason,
             'Ops Lead' as suggested_owner,
             'Rà soát lại matching, chuyển bớt mentee hoặc thêm co-mentor.' as suggested_action
      from mentor_metrics
      where mentee_count > capacity_target
      having count(*) > 0
      union all
      -- Rule 2: Support teams with low recap rate (exclude null/fake teams)
      select 'medium',
             concat('Follow-up support team ', support_team),
             concat('Recap rate hiện tại là ', coalesce(recap_rate,0), '%.'),
             'Ops Lead',
             'Mở task follow-up cho support team và kiểm tra mentee silent.'
      from support_activity
      where coalesce(recap_rate,0) < 70
        and support_team is not null
        and support_team <> 'Chưa rõ'
      union all
      -- Rule 3: New mentors with 0 recaps
      select 'low',
             'Onboarding refresher cho mentor mới',
             concat(count(*),' mentor mới chưa có recap tháng hiện tại.'),
             'Mentor Experience Lead',
             'Gửi hướng dẫn recap và nhắc lịch mentor onboarding refresher.'
      from mentor_metrics
      where years_in_vam = 0 and recap_count_current_month = 0
      having count(*) > 0
    )
    select jsonb_build_object(
      -- ── Root fields (029-compatible, preserved exactly) ──────────────────────
      'season_code',    p_season_code,
      'season_id',      v_season_id,
      'selected_month', v_selected_month,
      'total_mentors',  v_total_mentors,
      'total_mentees',  v_total_mentees,
      'active_matches', v_active_matches,

      -- ── 029 backward-compat sections (base columns, unchanged) ───────────────
      'mentor_capacity_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('bucket',bucket,'count',cnt) order by bucket)
        from (
          select case when mentee_count=0 then '0 mentee'
                      when mentee_count=1 then '1 mentee'
                      when mentee_count=2 then '2 mentees'
                      when mentee_count=3 then '3 mentees'
                      else '4+ mentees' end as bucket,
                 count(*)::int as cnt
          from mentor_rows group by 1
        ) x
      ),'[]'::jsonb),

      'mentee_school_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('school',school,'count',cnt) order by cnt desc, school)
        from (select school, count(*)::int as cnt from mentee_rows group by school) x
      ),'[]'::jsonb),

      'mentor_company_distribution', coalesce((
        select jsonb_agg(jsonb_build_object('company',company,'count',cnt) order by cnt desc, company)
        from (select company, count(*)::int as cnt from mentor_rows group by company order by 2 desc limit 20) x
      ),'[]'::jsonb),

      'match_health_summary', jsonb_build_object(
        'activeMatches',         v_active_matches,
        'activeMentors',         v_active_mentors,
        'activeMentees',         v_active_mentees,
        'silentMentees',         coalesce(v_silent_mentees, 0),
        'recapsInSelectedMonth', (select count(*)::int from recaps_month)
      ),

      'top_mentors_by_mentee_count', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'mentorId',               mentor_id,
            'mentorName',             mentor_name,
            'currentCompany',         coalesce(current_company,'Chưa rõ'),
            'currentTitle',           coalesce(current_title,'Chưa rõ'),
            'menteeCount',            mentee_count,
            'capacityTarget',         capacity_target,
            'recapCountCurrentMonth', recap_count_current_month
          ) order by mentee_count desc, mentor_name
        )
        from (select * from mentor_metrics where mentee_count > 0 order by mentee_count desc limit 20) t
      ),'[]'::jsonb),

      'data_quality_flags', jsonb_build_array(
        jsonb_build_object('key','season_row_missing','count',
          case when exists(select 1 from public.seasons where code=p_season_code) then 0 else 1 end),
        jsonb_build_object('key','recap_missing_mentee','count',
          (select count(*)::int from public.mentoring_recaps
           where (v_season_id is null or season_id=v_season_id) and mentee_person_id is null)),
        jsonb_build_object('key','recap_missing_mentor','count',
          (select count(*)::int from public.mentoring_recaps
           where (v_season_id is null or season_id=v_season_id) and mentor_person_id is null))
      ),

      'definitions', jsonb_build_object(
        'selectedMonth',      v_selected_month,
        'activeMentor',       'Mentor with at least one active match or recap in selected season/month.',
        'silentMentee',       'Mentee with an active match and no valid recap in selected month.',
        'overloadedMentor',   'Mentor with active mentee count exceeding capacity_target (default 4).',
        'validRecapStatuses', jsonb_build_array('submitted','needs_review','')
      ),

      -- ── 030 ENRICHED: mentorProfile ──────────────────────────────────────────
      'mentorProfile', jsonb_build_object(
        'totalMentors',    v_total_mentors,
        'activeMentors',   v_active_mentors,
        'inactiveMentors', greatest(v_total_mentors - v_active_mentors, 0),

        'byIndustry', coalesce((
          select jsonb_agg(jsonb_build_object('industry',industry,'count',cnt) order by cnt desc, industry)
          from (select industry, count(*)::int as cnt from mentor_metrics group by industry) x
        ),'[]'::jsonb),

        'byFunction', coalesce((
          select jsonb_agg(jsonb_build_object('functionArea',function_area,'count',cnt) order by cnt desc, function_area)
          from (select function_area, count(*)::int as cnt from mentor_metrics group by function_area) x
        ),'[]'::jsonb),

        'byExperienceBand', coalesce((
          select jsonb_agg(jsonb_build_object('band',band,'count',cnt) order by cnt desc, band)
          from (
            select public.intel_experience_band(years_of_experience) as band, count(*)::int as cnt
            from mentor_metrics group by 1
          ) x
        ),'[]'::jsonb),

        'byVamSeniority', coalesce((
          select jsonb_agg(jsonb_build_object('band',band,'count',cnt) order by cnt desc, band)
          from (
            select public.intel_vam_seniority_band(years_in_vam) as band, count(*)::int as cnt
            from mentor_metrics group by 1
          ) x
        ),'[]'::jsonb),

        'bySeniorityLevel', coalesce((
          select jsonb_agg(jsonb_build_object('level',seniority_level,'count',cnt) order by cnt desc, seniority_level)
          from (select seniority_level, count(*)::int as cnt from mentor_metrics group by seniority_level) x
        ),'[]'::jsonb),

        'overloadedMentors', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'mentorId',               mentor_id,
              'mentorName',             mentor_name,
              'industry',               industry,
              'currentTitle',           coalesce(current_title,'Chưa rõ'),
              'currentCompany',         coalesce(current_company,'Chưa rõ'),
              'menteeCount',            mentee_count,
              'capacityTarget',         capacity_target,
              'recapCountCurrentMonth', recap_count_current_month
            ) order by mentee_count desc, mentor_name
          )
          from mentor_metrics
          where mentee_count > capacity_target
        ),'[]'::jsonb),

        'inactiveMentorsWithMentees', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'mentorId',               mentor_id,
              'mentorName',             mentor_name,
              'industry',               industry,
              'currentTitle',           coalesce(current_title,'Chưa rõ'),
              'currentCompany',         coalesce(current_company,'Chưa rõ'),
              'menteeCount',            mentee_count,
              'capacityTarget',         capacity_target,
              'recapCountCurrentMonth', recap_count_current_month
            ) order by mentee_count desc, mentor_name
          )
          from (
            select * from mentor_metrics
            where mentee_count > 0 and recap_count_current_month = 0
            limit 50
          ) t
        ),'[]'::jsonb)
      ),

      -- ── 030 ENRICHED: menteeProfile ──────────────────────────────────────────
      'menteeProfile', jsonb_build_object(
        'totalMentees',  v_total_mentees,
        'activeMentees', v_active_mentees,
        'silentMentees', coalesce(v_silent_mentees, 0),

        'byMajor', coalesce((
          select jsonb_agg(jsonb_build_object('major',major,'count',cnt) order by cnt desc, major)
          from (select major, count(*)::int as cnt from mentee_rows group by major) x
        ),'[]'::jsonb),

        'byUniversity', coalesce((
          select jsonb_agg(jsonb_build_object('university',school,'count',cnt) order by cnt desc, school)
          from (select school, count(*)::int as cnt from mentee_rows group by school) x
        ),'[]'::jsonb),

        'byCareerInterest', coalesce((
          select jsonb_agg(jsonb_build_object('careerInterest',career_interest,'count',cnt) order by cnt desc, career_interest)
          from (select career_interest, count(*)::int as cnt from mentee_metrics group by career_interest) x
        ),'[]'::jsonb),

        'byTargetIndustry', coalesce((
          select jsonb_agg(jsonb_build_object('targetIndustry',target_industry,'count',cnt) order by cnt desc, target_industry)
          from (select target_industry, count(*)::int as cnt from mentee_metrics group by target_industry) x
        ),'[]'::jsonb),

        'byYearOfStudy', coalesce((
          select jsonb_agg(jsonb_build_object('yearOfStudy',year_of_study,'count',cnt) order by cnt desc, year_of_study)
          from (select year_of_study, count(*)::int as cnt from mentee_metrics group by year_of_study) x
        ),'[]'::jsonb),

        'bySupportTeam', coalesce((
          select jsonb_agg(jsonb_build_object('supportTeam',support_team,'count',cnt) order by cnt desc, support_team)
          from (select support_team, count(*)::int as cnt from mentee_metrics group by support_team) x
        ),'[]'::jsonb)
      ),

      -- ── matchingIntelligence: deferred to 031 (stays as 029 shape) ───────────
      'matchingIntelligence', jsonb_build_object(
        'totalActiveMatches',         v_active_matches,
        'mentorMenteeRatio',
          case when v_active_mentees = 0 then '0:0'
               else concat(round(v_active_mentors::numeric / nullif(v_active_mentees,0),2),':1')
          end,
        'matchesByIndustryAlignment',  '[]'::jsonb,
        'matchesByFunctionAlignment',  '[]'::jsonb,
        'unmatchedOrWeakSegments',     '[]'::jsonb,
        'menteesWithoutIndustryMentor', 0,
        'mentorSupplyVsMenteeDemand',  '[]'::jsonb
      ),

      -- ── 030 ENRICHED: activityBySegment ──────────────────────────────────────
      'activityBySegment', jsonb_build_object(
        'activeMenteeRateByMajor', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'major',major,'mentees',mentees,
              'activeMentees',active_mentees,'activeRate',active_rate
            ) order by active_rate nulls first, major
          ) from major_activity
        ),'[]'::jsonb),

        'recapRateBySupportTeam', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'supportTeam',support_team,'activeMentees',active_mentees,
              'menteesWithRecap',mentees_with_recap,'recapRate',recap_rate
            ) order by recap_rate nulls first, support_team
          ) from support_activity
        ),'[]'::jsonb),

        'activeMentorRateByIndustry', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'industry',industry,'mentors',mentors,
              'activeMentors',active_mentors,'activeRate',active_rate
            ) order by active_rate nulls first, industry
          ) from industry_activity
        ),'[]'::jsonb),

        'silentMenteeByCareerInterest', coalesce((
          select jsonb_agg(
            jsonb_build_object('careerInterest',career_interest,'silentMentees',cnt)
            order by cnt desc, career_interest
          )
          from (
            select career_interest, count(*)::int as cnt
            from mentee_metrics
            where active_match_count > 0 and recap_count_current_month = 0
            group by career_interest
            order by cnt desc
            limit 20
          ) x
        ),'[]'::jsonb)
      ),

      -- ── 030 ENRICHED: recommendedActions (3 rules) ───────────────────────────
      'recommendedActions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'priority',priority,'title',title,'reason',reason,
            'suggestedOwner',suggested_owner,'suggestedAction',suggested_action
          )
          order by case priority when 'high' then 1 when 'medium' then 2 else 3 end, title
        )
        from (select * from recs limit 10) limited
      ),'[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_founder_intelligence_dashboard(text) is
  '030: Enriched founder intelligence dashboard. Restores byIndustry, byFunction, byVamSeniority, bySeniorityLevel, inactiveMentorsWithMentees, byCareerInterest, byTargetIndustry, byYearOfStudy, bySupportTeam, activityBySegment, recommendedActions. matchingIntelligence supply/demand deferred to 031.';

revoke all on function public.get_founder_intelligence_dashboard(text) from public;
revoke all on function public.get_founder_intelligence_dashboard(text) from anon;
grant execute on function public.get_founder_intelligence_dashboard(text) to authenticated;

notify pgrst, 'reload schema';
