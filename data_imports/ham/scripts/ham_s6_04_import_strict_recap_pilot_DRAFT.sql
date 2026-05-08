-- HAM Season 6 strict recap pilot import.
--
-- DRAFT ONLY / DO NOT RUN UNTIL APPROVED.
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
--
-- Manual preflight before execution:
--   1. Confirm the connected database is STAGING, not production.
--   2. Confirm the intended Supabase project ref is ljfneyuvpxrmejpxsmpz.
--   3. Confirm HAM-S6 foundation import and access isolation QA have passed.
--   4. Confirm HAM event/group activity import remains out of scope.
--   5. Confirm expected first-run strict recap insert count is 29.
--   6. After any failed pre-commit attempt, verify no partial pilot rows exist:
--
--      select count(*)::int as ham_s6_strict_pilot_recaps
--      from public.mentoring_recaps mr
--      join public.seasons s on s.id = mr.season_id
--      where s.code = 'HAM-S6'
--        and mr.admin_notes like '%HAM-S6 strict recap pilot import.%';
--
--      Expected before rerun after failed transaction: 0.
--
-- Runtime context guard:
--   SQL cannot directly verify the Supabase project ref. This draft checks the
--   HAM/HAM-S6/HAM-S6-B1 context and stops if it is missing or inconsistent.

begin;

create or replace function pg_temp.ham_s6_recap_name_key(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    lower(regexp_replace(
      translate(
        coalesce(input_text, ''),
        U&'\00C1\00C0\1EA2\00C3\1EA0\0102\1EAE\1EB0\1EB2\1EB4\1EB6\00C2\1EA4\1EA6\1EA8\1EAA\1EAC\0110\00C9\00C8\1EBA\1EBC\1EB8\00CA\1EBE\1EC0\1EC2\1EC4\1EC6\00CD\00CC\1EC8\0128\1ECA\00D3\00D2\1ECE\00D5\1ECC\00D4\1ED0\1ED2\1ED4\1ED6\1ED8\01A0\1EDA\1EDC\1EDE\1EE0\1EE2\00DA\00D9\1EE6\0168\1EE4\01AF\1EE8\1EEA\1EEC\1EEE\1EF0\00DD\1EF2\1EF6\1EF8\1EF4\00E1\00E0\1EA3\00E3\1EA1\0103\1EAF\1EB1\1EB3\1EB5\1EB7\00E2\1EA5\1EA7\1EA9\1EAB\1EAD\0111\00E9\00E8\1EBB\1EBD\1EB9\00EA\1EBF\1EC1\1EC3\1EC5\1EC7\00ED\00EC\1EC9\0129\1ECB\00F3\00F2\1ECF\00F5\1ECD\00F4\1ED1\1ED3\1ED5\1ED7\1ED9\01A1\1EDB\1EDD\1EDF\1EE1\1EE3\00FA\00F9\1EE7\0169\1EE5\01B0\1EE9\1EEB\1EED\1EEF\1EF1\00FD\1EF3\1EF7\1EF9\1EF5',
        'AAAAAAAAAAAAAAAAADEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYaaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'
      ),
      '\([^)]*\)', ' ', 'g'
    )),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

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
  s.id as season_id,
  ib.id as intake_batch_id
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM'
limit 1;

do $$
declare
  v_active_match_count integer;
begin
  if not exists (select 1 from _ham_context) then
    raise exception 'HAM/HAM-S6/HAM-S6-B1 context was not found. Stop.';
  end if;

  select count(*) into v_active_match_count
  from public.matches m
  where m.season_id = (select season_id from _ham_context)
    and m.status = 'active';

  if v_active_match_count <> 52 then
    raise exception 'Expected 52 active HAM-S6 matches, got %. Stop.', v_active_match_count;
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
    pg_temp.ham_s6_recap_name_key(rs.mentor_name) as mentor_name_key,
    pg_temp.ham_s6_recap_name_key(coalesce(nullif(rs.mentees_extracted, ''), rs.mentee_names_raw)) as mentee_name_key,
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
    min(m.person_id::text)::uuid as mentor_person_id
  from normalized_source ns
  left join public.staging_ham_s6_people_identity_map m
    on m.ham_role = 'mentor'
   and m.person_id is not null
   and pg_temp.ham_s6_recap_name_key(m.full_name) = ns.mentor_name_key
  group by ns.source_row
),
mentee_candidates as (
  select
    ns.source_row,
    count(distinct m.person_id) as mentee_candidate_count,
    min(m.person_id::text)::uuid as mentee_person_id
  from normalized_source ns
  left join public.staging_ham_s6_people_identity_map m
    on m.ham_role = 'mentee'
   and m.person_id is not null
   and pg_temp.ham_s6_recap_name_key(m.full_name) = ns.mentee_name_key
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

select 'preflight_strict_recap_pilot_candidates' as metric, count(*)::text as value
from _ham_resolved_recap_candidates
where dry_run_decision = 'include_strict_pilot'
  and activity_type in ('1on1_primary', '1on1_cross')
union all
select 'preflight_' || dry_run_decision, count(*)::text
from _ham_resolved_recap_candidates
where dry_run_decision <> 'include_strict_pilot'
group by dry_run_decision
order by metric;

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

-- Post-execution verification SQL.
-- Run only after approved staging execution.
-- Expected:
--   ham_s6_strict_pilot_recaps = 29
--   non_ham_or_missing_match_rows = 0

select
  count(*)::int as ham_s6_strict_pilot_recaps
from public.mentoring_recaps mr
join public.seasons s on s.id = mr.season_id
where s.code = 'HAM-S6'
  and mr.admin_notes like '%HAM-S6 strict recap pilot import.%';

select
  reason_code,
  count(*)::int as excluded_count
from public.staging_ham_s6_recap_pilot_audit
where import_step = 'ham_s6_strict_recap_pilot'
  and decision = 'excluded'
group by reason_code
order by reason_code;

select
  count(*)::int as non_ham_or_missing_match_rows
from public.mentoring_recaps mr
left join public.matches m on m.id = mr.match_id
left join public.seasons s on s.id = mr.season_id
where mr.admin_notes like '%HAM-S6 strict recap pilot import.%'
  and (
    s.code <> 'HAM-S6'
    or m.id is null
    or m.season_id <> mr.season_id
    or m.status <> 'active'
  );

-- Rollback SQL if needed.
-- This rolls back only strict recap pilot rows and strict recap pilot audit rows.
-- It does not delete HAM foundation people, profiles, matches, seasons, programs,
-- intake batches, events, event participations, or RLS settings.
-- To use rollback, copy this block into a separate reviewed staging-only execution:
--
-- begin;
--
-- delete from public.mentoring_recaps mr
-- using public.seasons s
-- where mr.season_id = s.id
--   and s.code = 'HAM-S6'
--   and mr.admin_notes like '%HAM-S6 strict recap pilot import.%';
--
-- delete from public.staging_ham_s6_recap_pilot_audit
-- where import_step = 'ham_s6_strict_recap_pilot';
--
-- commit;
