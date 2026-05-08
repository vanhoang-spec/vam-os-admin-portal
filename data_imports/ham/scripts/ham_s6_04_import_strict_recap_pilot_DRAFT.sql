-- HAM Season 6 strict recap pilot import.
--
-- DRAFT ONLY / DO NOT RUN until explicitly approved.
--
-- STAGING ONLY. Do not run on production.
-- Does not import events or group activities.
-- Does not enable, disable, or alter RLS.
--
-- Source file:
--   data_imports/ham/ham_recaps_clean.csv
--
-- Privacy note:
--   This draft reads private clean CSV fields inside temp tables only.
--   It does not embed participant names, emails, phones, profile links, source URLs,
--   or raw recap notes as literal data in this file.
--   Exclusion audit rows store sanitized source references and reason codes only.

begin;

create table if not exists public.staging_ham_s6_recap_pilot_audit (
  id uuid primary key default gen_random_uuid(),
  import_step text not null,
  source_row integer,
  source_file text,
  source_sheet text,
  activity_type text,
  decision text not null,
  reason_code text not null,
  sanitized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists staging_ham_s6_recap_pilot_audit_unique_idx
  on public.staging_ham_s6_recap_pilot_audit(import_step, coalesce(source_row, -1), decision, reason_code);

create temp table _ham_recap_source (
  source_file text,
  source_sheet text,
  row_num text,
  program text,
  season text,
  post_date text,
  post_time text,
  fb_post_link text,
  post_author text,
  views text,
  reacts text,
  mssv_tag text,
  type_tag text,
  topic text,
  mentor_name text,
  mentee_names_raw text,
  mentees_extracted text,
  meeting_time_raw text,
  location text,
  activity_type text,
  body_length text,
  body_snippet text,
  issue_flag text,
  issue_note text,
  import_ready text
) on commit drop;

\copy _ham_recap_source from 'data_imports/ham/ham_recaps_clean.csv' with (format csv, header true, encoding 'UTF8')

create temp table _ham_context as
select
  p.id as program_id,
  s.id as season_id
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
where p.code = 'HAM'
limit 1;

do $$
begin
  if not exists (select 1 from _ham_context) then
    raise exception 'HAM-S6 staging context was not found. Stop.';
  end if;
end;
$$;

create temp table _ham_resolved_recap_candidates as
with normalized_source as (
  select
    rs.*,
    nullif(rs.row_num, '')::int as source_row,
    nullif(trim(rs.fb_post_link), '') as recap_url,
    nullif(trim(rs.post_date), '')::date as meeting_date,
    to_char(nullif(trim(rs.post_date), '')::date, 'YYYY-MM') as meeting_month,
    lower(regexp_replace(regexp_replace(translate(rs.mentor_name, 'ÄÄ‘', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) as mentor_name_key,
    lower(regexp_replace(regexp_replace(translate(coalesce(nullif(rs.mentees_extracted, ''), rs.mentee_names_raw), 'ÄÄ‘', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) as mentee_name_key,
    (
      coalesce(nullif(rs.mentees_extracted, ''), rs.mentee_names_raw) ~ '(;|\||,|/|&|\+|\sand\s)'
    ) as needs_human_interpretation
  from _ham_recap_source rs
  where nullif(trim(rs.post_date), '') is not null
),
mentor_candidates as (
  select
    ns.source_row,
    count(distinct m.person_id) as mentor_candidate_count,
    min(m.person_id) as mentor_person_id
  from normalized_source ns
  left join public.staging_ham_s6_people_identity_map m
    on m.ham_role = 'mentor'
   and m.person_id is not null
   and lower(regexp_replace(regexp_replace(translate(m.full_name, 'ÄÄ‘', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) = ns.mentor_name_key
  group by ns.source_row
),
mentee_candidates as (
  select
    ns.source_row,
    count(distinct m.person_id) as mentee_candidate_count,
    min(m.person_id) as mentee_person_id
  from normalized_source ns
  left join public.staging_ham_s6_people_identity_map m
    on m.ham_role = 'mentee'
   and m.person_id is not null
   and lower(regexp_replace(regexp_replace(translate(m.full_name, 'ÄÄ‘', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) = ns.mentee_name_key
  group by ns.source_row
),
joined as (
  select
    ns.*,
    coalesce(mc.mentor_candidate_count, 0) as mentor_candidate_count,
    mc.mentor_person_id,
    coalesce(mt.mentee_candidate_count, 0) as mentee_candidate_count,
    mt.mentee_person_id,
    hm.id as match_id,
    count(*) over (partition by lower(ns.recap_url)) as recap_url_count,
    count(*) over (
      partition by ns.meeting_date, ns.mentor_name_key, ns.mentee_name_key, lower(coalesce(ns.activity_type, ''))
    ) as signature_count
  from normalized_source ns
  left join mentor_candidates mc on mc.source_row = ns.source_row
  left join mentee_candidates mt on mt.source_row = ns.source_row
  left join public.matches hm
    on hm.season_id = (select season_id from _ham_context)
   and hm.status = 'active'
   and hm.mentor_person_id = mc.mentor_person_id
   and hm.mentee_person_id = mt.mentee_person_id
)
select
  *,
  case
    when upper(coalesce(import_ready, '')) <> 'TRUE' or upper(coalesce(issue_flag, '')) = 'TRUE'
      then 'source_not_import_ready_or_issue_flagged'
    when mentor_candidate_count <> 1 or mentee_candidate_count <> 1
      then 'unresolved_or_manual_review_identity'
    when match_id is null
      then 'not_linked_to_imported_ham_s6_match'
    when coalesce(recap_url_count, 0) > 1 or coalesce(signature_count, 0) > 1
      then 'duplicate_risk_row'
    when activity_type = 'unknown_manual_review'
      then 'unknown_manual_review_recap_type'
    when meeting_date is null or recap_url is null
      then 'invalid_or_missing_date_source'
    when needs_human_interpretation
      then 'needs_human_interpretation'
    else 'include_strict_pilot'
  end as dry_run_decision
from joined;

do $$
declare
  v_candidate_count integer;
begin
  select count(*) into v_candidate_count
  from _ham_resolved_recap_candidates
  where dry_run_decision = 'include_strict_pilot'
    and activity_type in ('1on1_primary', '1on1_cross');

  if v_candidate_count <> 29 then
    raise exception 'Strict recap pilot candidate count expected 29, got %. Stop.', v_candidate_count;
  end if;
end;
$$;

insert into public.staging_ham_s6_recap_pilot_audit (
  import_step,
  source_row,
  source_file,
  source_sheet,
  activity_type,
  decision,
  reason_code,
  sanitized_payload
)
select
  'ham_s6_strict_recap_pilot',
  source_row,
  source_file,
  source_sheet,
  activity_type,
  'excluded',
  dry_run_decision,
  jsonb_build_object(
    'source_row', source_row,
    'source_file', source_file,
    'source_sheet', source_sheet,
    'activity_type', activity_type,
    'post_date_present', meeting_date is not null,
    'source_link_present', recap_url is not null,
    'mentor_candidate_count', mentor_candidate_count,
    'mentee_candidate_count', mentee_candidate_count,
    'has_match_id', match_id is not null
  )
from _ham_resolved_recap_candidates
where dry_run_decision <> 'include_strict_pilot'
on conflict do nothing;

insert into public.mentoring_recaps (
  season_id,
  match_id,
  mentor_person_id,
  mentee_person_id,
  meeting_date,
  meeting_month,
  recap_url,
  recap_source,
  recap_note,
  issue_flag,
  status,
  admin_notes
)
select
  (select season_id from _ham_context),
  match_id,
  mentor_person_id,
  mentee_person_id,
  meeting_date,
  meeting_month,
  recap_url,
  'facebook_group',
  null,
  false,
  'submitted',
  concat_ws(
    E'\n',
    'HAM-S6 strict recap pilot import.',
    'source_file=' || coalesce(source_file, ''),
    'source_sheet=' || coalesce(source_sheet, ''),
    'source_row=' || coalesce(source_row::text, ''),
    'activity_type=' || coalesce(activity_type, '')
  )
from _ham_resolved_recap_candidates c
where dry_run_decision = 'include_strict_pilot'
  and activity_type in ('1on1_primary', '1on1_cross')
  and not exists (
    select 1
    from public.mentoring_recaps existing
    where existing.season_id = (select season_id from _ham_context)
      and existing.match_id = c.match_id
      and existing.mentor_person_id = c.mentor_person_id
      and existing.mentee_person_id = c.mentee_person_id
      and existing.meeting_date = c.meeting_date
      and existing.recap_url = c.recap_url
  );

select 'strict_recap_pilot_candidates' as metric, count(*)::text as value
from _ham_resolved_recap_candidates
where dry_run_decision = 'include_strict_pilot'
union all
select dry_run_decision, count(*)::text
from _ham_resolved_recap_candidates
where dry_run_decision <> 'include_strict_pilot'
group by dry_run_decision
order by metric;

-- DRAFT ONLY: leave uncommitted until explicitly approved.
commit;
