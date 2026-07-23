-- OWNER-RUN READ-ONLY PROBE. DO NOT MODIFY INTO A WRITE STATEMENT.
-- Returns aggregate metadata/counts only; no personal or business-row details.
with
target_programs as (
  select p.id, p.code, p.name, p.is_active
  from public.programs p
  where upper(p.code) in ('UEHM', 'HAM')
),
candidate_seasons as (
  select
    s.id,
    s.code,
    s.name,
    s.status,
    s.program_id,
    tp.code as linked_program_code,
    case
      when upper(s.code) like 'UEHM-S%' then 'UEHM'
      when upper(s.code) like 'HAM-S%' then 'HAM'
      else null
    end as code_program_hint
  from public.seasons s
  left join target_programs tp on tp.id = s.program_id
  where tp.id is not null
     or upper(s.code) like 'UEHM-S%'
     or upper(s.code) like 'HAM-S%'
),
season_counts as (
  select
    s.id as season_id,
    s.code as season_code,
    s.status as season_status,
    s.program_id,
    s.linked_program_code,
    s.code_program_hint,
    (select count(*) from public.applications a where a.season_id = s.id) as applications_count,
    (select count(*) from public.matches m where m.season_id = s.id and lower(coalesce(m.status::text, '')) = 'active') as active_matches_count,
    (select count(distinct m.mentor_person_id) from public.matches m where m.season_id = s.id and lower(coalesce(m.status::text, '')) = 'active' and m.mentor_person_id is not null) as valid_match_mentor_count,
    (select count(distinct m.mentee_person_id) from public.matches m where m.season_id = s.id and lower(coalesce(m.status::text, '')) = 'active' and m.mentee_person_id is not null) as valid_match_mentee_count,
    (select count(distinct psm.person_id) from public.person_season_memberships psm where psm.season_id = s.id and lower(psm.role) = 'mentor' and lower(psm.status) = 'active') as mentor_membership_count,
    (select count(distinct psm.person_id) from public.person_season_memberships psm where psm.season_id = s.id and lower(psm.role) = 'mentee' and lower(psm.status) = 'active') as mentee_membership_count,
    (select count(*) from public.events e where e.season_id = s.id) as events_count,
    (select count(*) from public.intake_batches ib where ib.season_id = s.id) as intake_batch_count,
    (select count(*) from public.matches m where m.season_id = s.id and m.mentor_person_id is null) as null_mentor_link_count,
    (select count(*) from public.matches m where m.season_id = s.id and m.mentee_person_id is null) as null_mentee_link_count
  from candidate_seasons s
),
program_results as (
  select
    p.id,
    p.code,
    p.name,
    p.is_active,
    coalesce(
      jsonb_agg(to_jsonb(sc) order by sc.season_code) filter (where sc.season_id is not null),
      '[]'::jsonb
    ) as linked_seasons
  from target_programs p
  left join season_counts sc on sc.program_id = p.id
  group by p.id, p.code, p.name, p.is_active
)
select jsonb_build_object(
  'probe', 'VAM_OS_UEH_HAM_PORTFOLIO_LINKAGE_READONLY_V1',
  'programs', coalesce(
    (select jsonb_agg(
      jsonb_build_object(
        'program_id', pr.id,
        'program_code', pr.code,
        'program_name', pr.name,
        'program_is_active', pr.is_active,
        'linked_seasons', pr.linked_seasons
      )
      order by pr.code
    ) from program_results pr),
    '[]'::jsonb
  ),
  'code_named_seasons_not_linked_to_matching_program', coalesce(
    (select jsonb_agg(
      jsonb_build_object(
        'season_id', sc.season_id,
        'season_code', sc.season_code,
        'season_status', sc.season_status,
        'season_program_id', sc.program_id,
        'linked_program_code', sc.linked_program_code,
        'expected_program_code_from_season_code', sc.code_program_hint
      )
      order by sc.season_code
    )
    from season_counts sc
    where sc.code_program_hint is not null
      and sc.code_program_hint is distinct from sc.linked_program_code),
    '[]'::jsonb
  ),
  'null_season_linkage', jsonb_build_object(
    'applications', (select count(*) from public.applications where season_id is null),
    'matches', (select count(*) from public.matches where season_id is null),
    'events', (select count(*) from public.events where season_id is null),
    'memberships', (select count(*) from public.person_season_memberships where season_id is null)
  )
);
