-- VAM OS Founder & Core Team Intelligence Dashboard.
-- Additive/idempotent staging migration. Does not enable RLS on mentoring_recaps or event_participations.

alter table public.mentor_profiles
  add column if not exists current_company text,
  add column if not exists current_title text,
  add column if not exists industry text,
  add column if not exists function_area text,
  add column if not exists years_of_experience int,
  add column if not exists years_in_vam int,
  add column if not exists first_vam_season text,
  add column if not exists mentor_type text,
  add column if not exists capacity_target int,
  add column if not exists seniority_level text,
  add column if not exists bio_short text,
  add column if not exists linkedin_url text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.mentee_profiles
  add column if not exists university text,
  add column if not exists school_or_faculty text,
  add column if not exists graduation_year int,
  add column if not exists year_of_study text,
  add column if not exists career_interest text,
  add column if not exists target_industry text,
  add column if not exists target_function text,
  add column if not exists english_level text,
  add column if not exists location text,
  add column if not exists support_team text,
  add column if not exists mentee_status text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.matches
  add column if not exists matched_at date,
  add column if not exists match_reason text,
  add column if not exists support_team text,
  add column if not exists match_quality_score numeric,
  add column if not exists primary_match boolean default true,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists mentor_profiles_industry_idx on public.mentor_profiles(industry);
create index if not exists mentor_profiles_function_area_idx on public.mentor_profiles(function_area);
create index if not exists mentor_profiles_years_in_vam_idx on public.mentor_profiles(years_in_vam);
create index if not exists mentor_profiles_years_of_experience_idx on public.mentor_profiles(years_of_experience);
create index if not exists mentee_profiles_major_idx on public.mentee_profiles(major);
create index if not exists mentee_profiles_target_industry_idx on public.mentee_profiles(target_industry);
create index if not exists mentee_profiles_target_function_idx on public.mentee_profiles(target_function);
create index if not exists mentee_profiles_support_team_idx on public.mentee_profiles(support_team);
create index if not exists matches_season_id_idx on public.matches(season_id);
create index if not exists matches_status_idx on public.matches(status);
create index if not exists matches_support_team_idx on public.matches(support_team);

drop trigger if exists mentor_profiles_set_updated_at on public.mentor_profiles;
create trigger mentor_profiles_set_updated_at
before update on public.mentor_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists mentee_profiles_set_updated_at on public.mentee_profiles;
create trigger mentee_profiles_set_updated_at
before update on public.mentee_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
before update on public.matches
for each row
execute function public.set_updated_at();

-- Staging enrichment: only fills missing profile intelligence fields.
with mentor_seed as (
  select
    mp.id,
    row_number() over (order by coalesce(mp.mentor_code, p.full_name, mp.id::text)) as rn
  from public.mentor_profiles mp
  left join public.people p on p.id = mp.person_id
),
mentor_values as (
  select
    id,
    (array[
      'Finance / Banking / Investment',
      'Consulting',
      'Technology',
      'FMCG / Retail',
      'Manufacturing',
      'Education',
      'Healthcare',
      'Logistics',
      'Entrepreneurship / Startup',
      'Public / Nonprofit'
    ])[((rn - 1) % 10) + 1] as industry_value,
    (array[
      'Strategy',
      'Finance',
      'Marketing',
      'Sales / Business Development',
      'Operations',
      'Product',
      'Data / Analytics',
      'HR / People',
      'Legal / Compliance',
      'General Management'
    ])[((rn - 1) % 10) + 1] as function_value,
    (array['alumni', 'professional', 'founder', 'investor', 'academic', 'other'])[((rn - 1) % 6) + 1] as mentor_type_value,
    (array['junior', 'mid', 'senior', 'executive', 'founder_owner'])[((rn - 1) % 5) + 1] as seniority_value,
    (array[2, 5, 9, 15, 22])[((rn - 1) % 5) + 1] as years_experience_value,
    (array[0, 1, 2, 3, 4])[((rn - 1) % 5) + 1] as years_in_vam_value,
    (array[2, 2, 3, 3, 4, 4, 5])[((rn - 1) % 7) + 1] as capacity_value
  from mentor_seed
)
update public.mentor_profiles mp
set
  current_company = coalesce(nullif(mp.current_company, ''), nullif(mp.company_current, ''), (array['Vietcombank', 'BCG Vietnam', 'FPT Software', 'Unilever Vietnam', 'VinFast', 'Fulbright University Vietnam', 'FV Hospital', 'Gemadept', 'MoMo', 'UNDP Vietnam'])[((abs(('x' || substr(md5(mp.id::text), 1, 8))::bit(32)::int) % 10) + 1)]),
  current_title = coalesce(nullif(mp.current_title, ''), nullif(mp.title_current, ''), (array['Manager', 'Senior Consultant', 'Product Lead', 'Finance Director', 'Founder', 'Head of Operations', 'Data Lead', 'Marketing Manager'])[((abs(('x' || substr(md5(mp.id::text), 9, 8))::bit(32)::int) % 8) + 1)]),
  industry = coalesce(nullif(mp.industry, ''), mv.industry_value),
  function_area = coalesce(nullif(mp.function_area, ''), mv.function_value),
  years_of_experience = coalesce(mp.years_of_experience, mp.years_experience_min, mv.years_experience_value),
  years_in_vam = coalesce(mp.years_in_vam, mv.years_in_vam_value),
  first_vam_season = coalesce(nullif(mp.first_vam_season, ''), concat('UEHM-S', greatest(7, 11 - mv.years_in_vam_value))),
  mentor_type = coalesce(nullif(mp.mentor_type, ''), mv.mentor_type_value),
  capacity_target = coalesce(mp.capacity_target, mv.capacity_value),
  seniority_level = coalesce(nullif(mp.seniority_level, ''), mv.seniority_value),
  bio_short = coalesce(nullif(mp.bio_short, ''), 'Anonymized staging mentor profile for community intelligence testing.')
from mentor_values mv
where mv.id = mp.id;

with mentee_seed as (
  select
    mp.id,
    row_number() over (order by coalesce(mp.mentee_code, p.full_name, mp.id::text)) as rn
  from public.mentee_profiles mp
  left join public.people p on p.id = mp.person_id
),
mentee_values as (
  select
    id,
    (array[
      'Business Administration',
      'Finance',
      'Accounting',
      'Marketing',
      'International Business',
      'Economics',
      'Data Analytics',
      'Logistics / Supply Chain',
      'Human Resources',
      'Other'
    ])[((rn - 1) % 10) + 1] as major_value,
    (array[
      'Finance / Investment',
      'Consulting',
      'Marketing',
      'Startup',
      'Data / Tech',
      'Operations / Supply Chain',
      'FMCG',
      'Social Impact',
      'Undecided'
    ])[((rn - 1) % 9) + 1] as career_value,
    (array[
      'Finance / Banking / Investment',
      'Consulting',
      'Technology',
      'FMCG / Retail',
      'Manufacturing',
      'Education',
      'Healthcare',
      'Logistics',
      'Entrepreneurship / Startup',
      'Public / Nonprofit'
    ])[((rn - 1) % 10) + 1] as target_industry_value,
    (array[
      'Strategy',
      'Finance',
      'Marketing',
      'Sales / Business Development',
      'Operations',
      'Product',
      'Data / Analytics',
      'HR / People',
      'Legal / Compliance',
      'General Management'
    ])[((rn - 1) % 10) + 1] as target_function_value,
    (array['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Graduate'])[((rn - 1) % 5) + 1] as year_value,
    (array['Support Team A', 'Support Team B', 'Support Team C', 'Support Team D'])[((rn - 1) % 4) + 1] as support_team_value
  from mentee_seed
)
update public.mentee_profiles mp
set
  university = coalesce(nullif(mp.university, ''), 'University of Economics Ho Chi Minh City'),
  school_or_faculty = coalesce(nullif(mp.school_or_faculty, ''), nullif(mp.school_raw, ''), nullif(mp.school_code, ''), 'School of Business'),
  major = coalesce(nullif(mp.major, ''), mv.major_value),
  graduation_year = coalesce(mp.graduation_year, 2026 + ((abs(('x' || substr(md5(mp.id::text), 1, 8))::bit(32)::int) % 4))),
  year_of_study = coalesce(nullif(mp.year_of_study, ''), mv.year_value),
  career_interest = coalesce(nullif(mp.career_interest, ''), mv.career_value),
  target_industry = coalesce(nullif(mp.target_industry, ''), mv.target_industry_value),
  target_function = coalesce(nullif(mp.target_function, ''), mv.target_function_value),
  english_level = coalesce(nullif(mp.english_level, ''), (array['Basic', 'Intermediate', 'Upper Intermediate', 'Advanced'])[((abs(('x' || substr(md5(mp.id::text), 9, 8))::bit(32)::int) % 4) + 1)]),
  location = coalesce(nullif(mp.location, ''), 'Ho Chi Minh City'),
  support_team = coalesce(nullif(mp.support_team, ''), mv.support_team_value),
  mentee_status = coalesce(nullif(mp.mentee_status, ''), nullif(mp.status, ''), 'active')
from mentee_values mv
where mv.id = mp.id;

update public.matches m
set
  matched_at = coalesce(m.matched_at, m.created_at::date),
  match_reason = coalesce(nullif(m.match_reason, ''), nullif(m.match_source_raw, ''), 'Staging seed: profile and career-interest fit.'),
  support_team = coalesce(nullif(m.support_team, ''), mp.support_team, 'Support Team A'),
  match_quality_score = coalesce(m.match_quality_score, m.match_confidence, 3 + ((abs(('x' || substr(md5(m.id::text), 1, 8))::bit(32)::int) % 3))),
  primary_match = coalesce(m.primary_match, true)
from public.mentee_profiles mp
where mp.person_id = m.mentee_person_id;

create or replace function public.intel_norm(p_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(coalesce(p_value, ''))), '')
$$;

create or replace function public.intel_experience_band(p_years int)
returns text
language sql
immutable
as $$
  select case
    when p_years is null then 'Chưa rõ'
    when p_years <= 3 then '0-3 years'
    when p_years <= 7 then '4-7 years'
    when p_years <= 12 then '8-12 years'
    when p_years <= 20 then '13-20 years'
    else '20+ years'
  end
$$;

create or replace function public.intel_vam_seniority_band(p_years int)
returns text
language sql
immutable
as $$
  select case
    when p_years is null or p_years = 0 then 'New mentor'
    when p_years = 1 then '1 season'
    when p_years between 2 and 3 then '2-3 seasons'
    else '4+ seasons'
  end
$$;

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
  v_total_mentors int;
  v_active_mentors int;
  v_total_mentees int;
  v_active_mentees int;
  v_silent_mentees int;
  v_total_active_matches int;
  v_overloaded_count int;
  v_gap_count int;
begin
  if not public.admin_can_access_season(p_season_code) then
    raise exception 'VAM OS admin access required'
      using errcode = '42501';
  end if;

  select id into v_season_id from public.seasons where code = p_season_code limit 1;
  if v_season_id is null then
    raise exception 'Season % was not found', p_season_code using errcode = 'P0001';
  end if;

  select coalesce(max(mr.meeting_month), to_char(now(), 'YYYY-MM'))
    into v_selected_month
  from public.mentoring_recaps mr
  where mr.season_id = v_season_id
    and coalesce(trim(lower(mr.status)), '') in ('', 'submitted', 'needs_review');

  with
  active_matches as (
    select *
    from public.matches
    where season_id = v_season_id
      and lower(coalesce(status, '')) = 'active'
      and mentor_person_id is not null
      and mentee_person_id is not null
  ),
  valid_recaps_month as (
    select *
    from public.mentoring_recaps
    where season_id = v_season_id
      and meeting_month = v_selected_month
      and coalesce(trim(lower(status)), '') in ('', 'submitted', 'needs_review')
  ),
  mentor_metrics as (
    select
      mp.id as mentor_profile_id,
      mp.person_id as mentor_id,
      p.full_name as mentor_name,
      coalesce(mp.industry, 'Chưa rõ') as industry,
      coalesce(mp.function_area, 'Chưa rõ') as function_area,
      coalesce(mp.current_title, mp.title_current) as current_title,
      coalesce(mp.current_company, mp.company_current) as current_company,
      coalesce(mp.years_of_experience, mp.years_experience_min) as years_of_experience,
      mp.years_in_vam,
      coalesce(mp.seniority_level, 'Chưa rõ') as seniority_level,
      coalesce(mp.capacity_target, 4) as capacity_target,
      count(distinct am.mentee_person_id)::int as mentee_count,
      count(distinct vr.id)::int as recap_count_current_month
    from public.mentor_profiles mp
    left join public.people p on p.id = mp.person_id
    left join active_matches am on am.mentor_person_id = mp.person_id
    left join valid_recaps_month vr on vr.mentor_person_id = mp.person_id
    group by mp.id, mp.person_id, p.full_name, mp.industry, mp.function_area, mp.current_title, mp.title_current, mp.current_company, mp.company_current, mp.years_of_experience, mp.years_experience_min, mp.years_in_vam, mp.seniority_level, mp.capacity_target
  ),
  mentee_metrics as (
    select
      mp.id as mentee_profile_id,
      mp.person_id as mentee_id,
      p.full_name as mentee_name,
      coalesce(mp.major, 'Chưa rõ') as major,
      coalesce(mp.university, mp.school_raw, mp.school_code, 'Chưa rõ') as university,
      coalesce(mp.career_interest, 'Chưa rõ') as career_interest,
      coalesce(mp.target_industry, 'Chưa rõ') as target_industry,
      coalesce(mp.target_function, 'Chưa rõ') as target_function,
      coalesce(mp.year_of_study, 'Chưa rõ') as year_of_study,
      coalesce(mp.support_team, 'Chưa rõ') as support_team,
      count(distinct am.id)::int as active_match_count,
      count(distinct vr.id)::int as recap_count_current_month
    from public.mentee_profiles mp
    left join public.people p on p.id = mp.person_id
    left join active_matches am on am.mentee_person_id = mp.person_id
    left join valid_recaps_month vr on vr.mentee_person_id = mp.person_id
    group by mp.id, mp.person_id, p.full_name, mp.major, mp.university, mp.school_raw, mp.school_code, mp.career_interest, mp.target_industry, mp.target_function, mp.year_of_study, mp.support_team
  ),
  mentor_supply as (
    select industry as segment, count(*)::int as mentor_supply
    from mentor_metrics
    group by industry
  ),
  mentee_demand as (
    select target_industry as segment, count(*)::int as mentee_demand
    from mentee_metrics
    group by target_industry
  ),
  supply_demand as (
    select
      coalesce(ms.segment, md.segment) as segment,
      coalesce(ms.mentor_supply, 0) as mentor_supply,
      coalesce(md.mentee_demand, 0) as mentee_demand,
      coalesce(ms.mentor_supply, 0) - coalesce(md.mentee_demand, 0) as gap
    from mentor_supply ms
    full outer join mentee_demand md on public.intel_norm(ms.segment) = public.intel_norm(md.segment)
  )
  select
    (select count(*) from mentor_metrics),
    (select count(*) from mentor_metrics where mentee_count > 0 or recap_count_current_month > 0),
    (select count(*) from mentee_metrics),
    (select count(*) from mentee_metrics where active_match_count > 0),
    (select count(*) from mentee_metrics where active_match_count > 0 and recap_count_current_month = 0),
    (select count(*) from active_matches),
    (select count(*) from mentor_metrics where mentee_count > capacity_target or (capacity_target is null and mentee_count >= 4)),
    (select count(*) from supply_demand where gap < 0)
  into v_total_mentors, v_active_mentors, v_total_mentees, v_active_mentees, v_silent_mentees, v_total_active_matches, v_overloaded_count, v_gap_count;

  return (
    with
    active_matches as (
      select *
      from public.matches
      where season_id = v_season_id
        and lower(coalesce(status, '')) = 'active'
        and mentor_person_id is not null
        and mentee_person_id is not null
    ),
    valid_recaps_month as (
      select *
      from public.mentoring_recaps
      where season_id = v_season_id
        and meeting_month = v_selected_month
        and coalesce(trim(lower(status)), '') in ('', 'submitted', 'needs_review')
    ),
    mentor_metrics as (
      select
        mp.id as mentor_profile_id,
        mp.person_id as mentor_id,
        p.full_name as mentor_name,
        coalesce(mp.industry, 'Chưa rõ') as industry,
        coalesce(mp.function_area, 'Chưa rõ') as function_area,
        coalesce(mp.current_title, mp.title_current) as current_title,
        coalesce(mp.current_company, mp.company_current) as current_company,
        coalesce(mp.years_of_experience, mp.years_experience_min) as years_of_experience,
        mp.years_in_vam,
        coalesce(mp.seniority_level, 'Chưa rõ') as seniority_level,
        coalesce(mp.capacity_target, 4) as capacity_target,
        count(distinct am.mentee_person_id)::int as mentee_count,
        count(distinct vr.id)::int as recap_count_current_month
      from public.mentor_profiles mp
      left join public.people p on p.id = mp.person_id
      left join active_matches am on am.mentor_person_id = mp.person_id
      left join valid_recaps_month vr on vr.mentor_person_id = mp.person_id
      group by mp.id, mp.person_id, p.full_name, mp.industry, mp.function_area, mp.current_title, mp.title_current, mp.current_company, mp.company_current, mp.years_of_experience, mp.years_experience_min, mp.years_in_vam, mp.seniority_level, mp.capacity_target
    ),
    mentee_metrics as (
      select
        mp.id as mentee_profile_id,
        mp.person_id as mentee_id,
        p.full_name as mentee_name,
        coalesce(mp.major, 'Chưa rõ') as major,
        coalesce(mp.university, mp.school_raw, mp.school_code, 'Chưa rõ') as university,
        coalesce(mp.career_interest, 'Chưa rõ') as career_interest,
        coalesce(mp.target_industry, 'Chưa rõ') as target_industry,
        coalesce(mp.target_function, 'Chưa rõ') as target_function,
        coalesce(mp.year_of_study, 'Chưa rõ') as year_of_study,
        coalesce(mp.support_team, 'Chưa rõ') as support_team,
        count(distinct am.id)::int as active_match_count,
        count(distinct vr.id)::int as recap_count_current_month
      from public.mentee_profiles mp
      left join public.people p on p.id = mp.person_id
      left join active_matches am on am.mentee_person_id = mp.person_id
      left join valid_recaps_month vr on vr.mentee_person_id = mp.person_id
      group by mp.id, mp.person_id, p.full_name, mp.major, mp.university, mp.school_raw, mp.school_code, mp.career_interest, mp.target_industry, mp.target_function, mp.year_of_study, mp.support_team
    ),
    match_alignment as (
      select
        am.id,
        coalesce(mentor_mp.industry, 'Chưa rõ') as mentor_industry,
        coalesce(mentor_mp.function_area, 'Chưa rõ') as mentor_function,
        coalesce(mentee_mp.target_industry, 'Chưa rõ') as mentee_industry,
        coalesce(mentee_mp.target_function, 'Chưa rõ') as mentee_function,
        case when public.intel_norm(mentor_mp.industry) = public.intel_norm(mentee_mp.target_industry) then 'same_industry' else 'different_or_unknown' end as industry_alignment,
        case when public.intel_norm(mentor_mp.function_area) = public.intel_norm(mentee_mp.target_function) then 'same_function' else 'different_or_unknown' end as function_alignment
      from active_matches am
      left join public.mentor_profiles mentor_mp on mentor_mp.person_id = am.mentor_person_id
      left join public.mentee_profiles mentee_mp on mentee_mp.person_id = am.mentee_person_id
    ),
    mentor_supply as (
      select industry as segment, count(*)::int as mentor_supply
      from mentor_metrics
      group by industry
    ),
    mentee_demand as (
      select target_industry as segment, count(*)::int as mentee_demand
      from mentee_metrics
      group by target_industry
    ),
    supply_demand as (
      select
        coalesce(ms.segment, md.segment) as segment,
        coalesce(ms.mentor_supply, 0) as mentor_supply,
        coalesce(md.mentee_demand, 0) as mentee_demand,
        coalesce(ms.mentor_supply, 0) - coalesce(md.mentee_demand, 0) as gap
      from mentor_supply ms
      full outer join mentee_demand md on public.intel_norm(ms.segment) = public.intel_norm(md.segment)
    ),
    support_activity as (
      select
        support_team,
        count(*)::int as active_mentees,
        count(*) filter (where recap_count_current_month > 0)::int as mentees_with_recap,
        round(100.0 * count(*) filter (where recap_count_current_month > 0) / nullif(count(*), 0), 1) as recap_rate
      from mentee_metrics
      where active_match_count > 0
      group by support_team
    ),
    major_activity as (
      select
        major,
        count(*)::int as mentees,
        count(*) filter (where recap_count_current_month > 0)::int as active_mentees,
        round(100.0 * count(*) filter (where recap_count_current_month > 0) / nullif(count(*), 0), 1) as active_rate
      from mentee_metrics
      group by major
    ),
    industry_activity as (
      select
        industry,
        count(*)::int as mentors,
        count(*) filter (where recap_count_current_month > 0 or mentee_count > 0)::int as active_mentors,
        round(100.0 * count(*) filter (where recap_count_current_month > 0 or mentee_count > 0) / nullif(count(*), 0), 1) as active_rate
      from mentor_metrics
      group by industry
    ),
    recs as (
      select
        'high' as priority,
        concat('Tuyển thêm mentor cho ', segment) as title,
        concat('Nhu cầu mentee là ', mentee_demand, ' trong khi nguồn mentor là ', mentor_supply, '.') as reason,
        'Core Team / Partnership Lead' as suggested_owner,
        'Lập danh sách mentor cần recruit theo industry/function và ưu tiên outreach trong 7 ngày.' as suggested_action
      from supply_demand
      where gap < 0
      union all
      select
        'high',
        'Phân tải mentor overloaded',
        concat('Có ', count(*), ' mentor đang vượt capacity hoặc có từ 4 mentee active trở lên.'),
        'Ops Lead',
        'Rà soát lại matching, chuyển bớt mentee hoặc thêm co-mentor.'
      from mentor_metrics
      where mentee_count > capacity_target or (capacity_target is null and mentee_count >= 4)
      having count(*) > 0
      union all
      select
        'medium',
        concat('Follow-up support team ', support_team),
        concat('Recap rate hiện tại là ', coalesce(recap_rate, 0), '%.'),
        'Ops Lead',
        'Mở task follow-up cho support team và kiểm tra mentee silent.'
      from support_activity
      where coalesce(recap_rate, 0) < 70
      union all
      select
        'medium',
        concat('Check-in mentee nhóm ', career_interest),
        concat(count(*), ' mentee active chưa có recap trong tháng ', v_selected_month, '.'),
        'Recap Steward',
        'Tạo danh sách check-in theo career interest và cập nhật workflow tasks.'
      from mentee_metrics
      where active_match_count > 0 and recap_count_current_month = 0
      group by career_interest
      having count(*) > 0
      union all
      select
        'low',
        'Onboarding refresher cho mentor mới',
        concat(count(*), ' mentor mới chưa có recap tháng hiện tại.'),
        'Mentor Experience Lead',
        'Gửi hướng dẫn recap và nhắc lịch mentor onboarding refresher.'
      from mentor_metrics
      where coalesce(years_in_vam, 0) = 0 and recap_count_current_month = 0
      having count(*) > 0
    )
    select jsonb_build_object(
      'definitions', jsonb_build_object(
        'selectedMonth', v_selected_month,
        'activeMentor', 'Mentor có ít nhất một active match hoặc ít nhất một valid recap trong selectedMonth.',
        'silentMentee', 'Mentee có active match nhưng không có valid recap trong selectedMonth.',
        'overloadedMentor', 'current_mentee_count > capacity_target hoặc active mentee count >= 4 khi capacity không rõ.',
        'validRecapStatuses', jsonb_build_array('submitted', 'needs_review', '')
      ),
      'mentorProfile', jsonb_build_object(
        'totalMentors', v_total_mentors,
        'activeMentors', v_active_mentors,
        'inactiveMentors', greatest(v_total_mentors - v_active_mentors, 0),
        'byIndustry', coalesce((select jsonb_agg(jsonb_build_object('industry', industry, 'count', count) order by count desc, industry) from (select industry, count(*)::int from mentor_metrics group by industry) x), '[]'::jsonb),
        'byFunction', coalesce((select jsonb_agg(jsonb_build_object('functionArea', function_area, 'count', count) order by count desc, function_area) from (select function_area, count(*)::int from mentor_metrics group by function_area) x), '[]'::jsonb),
        'byExperienceBand', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'count', count) order by count desc, band) from (select public.intel_experience_band(years_of_experience) as band, count(*)::int from mentor_metrics group by 1) x), '[]'::jsonb),
        'byVamSeniority', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'count', count) order by count desc, band) from (select public.intel_vam_seniority_band(years_in_vam) as band, count(*)::int from mentor_metrics group by 1) x), '[]'::jsonb),
        'bySeniorityLevel', coalesce((select jsonb_agg(jsonb_build_object('level', seniority_level, 'count', count) order by count desc, seniority_level) from (select seniority_level, count(*)::int from mentor_metrics group by seniority_level) x), '[]'::jsonb),
        'overloadedMentors', coalesce((select jsonb_agg(jsonb_build_object('mentorId', mentor_id, 'mentorName', mentor_name, 'industry', industry, 'currentTitle', current_title, 'currentCompany', current_company, 'menteeCount', mentee_count, 'capacityTarget', capacity_target, 'recapCountCurrentMonth', recap_count_current_month) order by mentee_count desc, mentor_name) from mentor_metrics where mentee_count > capacity_target or (capacity_target is null and mentee_count >= 4)), '[]'::jsonb),
        'inactiveMentorsWithMentees', coalesce((select jsonb_agg(jsonb_build_object('mentorId', mentor_id, 'mentorName', mentor_name, 'industry', industry, 'currentTitle', current_title, 'currentCompany', current_company, 'menteeCount', mentee_count, 'capacityTarget', capacity_target, 'recapCountCurrentMonth', recap_count_current_month) order by mentee_count desc, mentor_name) from mentor_metrics where mentee_count > 0 and recap_count_current_month = 0), '[]'::jsonb)
      ),
      'menteeProfile', jsonb_build_object(
        'totalMentees', v_total_mentees,
        'activeMentees', v_active_mentees,
        'silentMentees', v_silent_mentees,
        'byMajor', coalesce((select jsonb_agg(jsonb_build_object('major', major, 'count', count) order by count desc, major) from (select major, count(*)::int from mentee_metrics group by major) x), '[]'::jsonb),
        'byUniversity', coalesce((select jsonb_agg(jsonb_build_object('university', university, 'count', count) order by count desc, university) from (select university, count(*)::int from mentee_metrics group by university) x), '[]'::jsonb),
        'byCareerInterest', coalesce((select jsonb_agg(jsonb_build_object('careerInterest', career_interest, 'count', count) order by count desc, career_interest) from (select career_interest, count(*)::int from mentee_metrics group by career_interest) x), '[]'::jsonb),
        'byTargetIndustry', coalesce((select jsonb_agg(jsonb_build_object('targetIndustry', target_industry, 'count', count) order by count desc, target_industry) from (select target_industry, count(*)::int from mentee_metrics group by target_industry) x), '[]'::jsonb),
        'byYearOfStudy', coalesce((select jsonb_agg(jsonb_build_object('yearOfStudy', year_of_study, 'count', count) order by count desc, year_of_study) from (select year_of_study, count(*)::int from mentee_metrics group by year_of_study) x), '[]'::jsonb),
        'bySupportTeam', coalesce((select jsonb_agg(jsonb_build_object('supportTeam', support_team, 'count', count) order by count desc, support_team) from (select support_team, count(*)::int from mentee_metrics group by support_team) x), '[]'::jsonb)
      ),
      'matchingIntelligence', jsonb_build_object(
        'totalActiveMatches', v_total_active_matches,
        'mentorMenteeRatio', case when v_active_mentees = 0 then '0:0' else concat(round(v_active_mentors::numeric / nullif(v_active_mentees, 0), 2), ':1') end,
        'matchesByIndustryAlignment', coalesce((select jsonb_agg(jsonb_build_object('alignment', industry_alignment, 'count', count) order by count desc) from (select industry_alignment, count(*)::int from match_alignment group by industry_alignment) x), '[]'::jsonb),
        'matchesByFunctionAlignment', coalesce((select jsonb_agg(jsonb_build_object('alignment', function_alignment, 'count', count) order by count desc) from (select function_alignment, count(*)::int from match_alignment group by function_alignment) x), '[]'::jsonb),
        'unmatchedOrWeakSegments', coalesce((select jsonb_agg(jsonb_build_object('segment', segment, 'mentorSupply', mentor_supply, 'menteeDemand', mentee_demand, 'gap', gap) order by gap asc, segment) from supply_demand where gap < 0), '[]'::jsonb),
        'menteesWithoutIndustryMentor', coalesce((select count(*)::int from match_alignment where industry_alignment <> 'same_industry'), 0),
        'mentorSupplyVsMenteeDemand', coalesce((select jsonb_agg(jsonb_build_object('segment', segment, 'mentorSupply', mentor_supply, 'menteeDemand', mentee_demand, 'gap', gap) order by gap asc, segment) from supply_demand), '[]'::jsonb)
      ),
      'activityBySegment', jsonb_build_object(
        'activeMenteeRateByMajor', coalesce((select jsonb_agg(jsonb_build_object('major', major, 'mentees', mentees, 'activeMentees', active_mentees, 'activeRate', active_rate) order by active_rate nulls first, major) from major_activity), '[]'::jsonb),
        'recapRateBySupportTeam', coalesce((select jsonb_agg(jsonb_build_object('supportTeam', support_team, 'activeMentees', active_mentees, 'menteesWithRecap', mentees_with_recap, 'recapRate', recap_rate) order by recap_rate nulls first, support_team) from support_activity), '[]'::jsonb),
        'activeMentorRateByIndustry', coalesce((select jsonb_agg(jsonb_build_object('industry', industry, 'mentors', mentors, 'activeMentors', active_mentors, 'activeRate', active_rate) order by active_rate nulls first, industry) from industry_activity), '[]'::jsonb),
        'silentMenteeByCareerInterest', coalesce((select jsonb_agg(jsonb_build_object('careerInterest', career_interest, 'silentMentees', count) order by count desc, career_interest) from (select career_interest, count(*)::int from mentee_metrics where active_match_count > 0 and recap_count_current_month = 0 group by career_interest) x), '[]'::jsonb)
      ),
      'recommendedActions', coalesce((select jsonb_agg(jsonb_build_object('priority', priority, 'title', title, 'reason', reason, 'suggestedOwner', suggested_owner, 'suggestedAction', suggested_action) order by case priority when 'high' then 1 when 'medium' then 2 else 3 end, title) from (select * from recs limit 10) limited), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_founder_intelligence_dashboard(text) from public, anon;
grant execute on function public.get_founder_intelligence_dashboard(text) to authenticated;

alter table public.mentoring_recaps disable row level security;
alter table public.event_participations disable row level security;

notify pgrst, 'reload schema';
