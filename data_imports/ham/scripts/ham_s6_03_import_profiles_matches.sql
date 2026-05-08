-- HAM Season 6 staging profile + match import.
--
-- STAGING ONLY. Do not run on production.
--
-- Prerequisites:
--   1. Run ham_s6_01_seed_program_season.sql.
--   2. Run ham_s6_02_import_people.sql.
--
-- Source files:
--   data_imports/ham/ham_people_clean.csv
--   data_imports/ham/ham_matches_clean.csv
--
-- Behavior:
--   * Creates mentor/mentee profiles only when missing for resolved people.
--   * Creates HAM-S6 matches only when both mentor and mentee identities resolve.
--   * Skips and logs rows involving manual-review/unresolved identities.
--   * Does not import recaps.

begin;

create table if not exists public.staging_ham_s6_import_skips (
  id uuid primary key default gen_random_uuid(),
  import_step text not null,
  source_row integer,
  source_file text,
  source_sheet text,
  full_name text,
  email text,
  phone text,
  issue_reason text not null,
  source_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staging_ham_s6_import_skips_step_idx
  on public.staging_ham_s6_import_skips(import_step, issue_reason);

create unique index if not exists staging_ham_s6_import_skips_unique_idx
  on public.staging_ham_s6_import_skips(import_step, coalesce(source_row, -1), issue_reason);

create temp table _ham_people_source (
  source_file text,
  source_sheet text,
  row_num text,
  stt text,
  full_name text,
  role text,
  program text,
  season text,
  email text,
  phone text,
  gender text,
  dob text,
  school text,
  company text,
  title text,
  expertise text,
  field text,
  fb_profile text,
  linkedin text,
  vam_profile_link text,
  mentee_names_raw text,
  mentee_count_raw text,
  issue_flag text,
  issue_note text,
  import_ready text
) on commit drop;

\copy _ham_people_source from 'data_imports/ham/ham_people_clean.csv' with (format csv, header true, encoding 'UTF8')

create temp table _ham_matches_source (
  source_file text,
  source_sheet text,
  row_num text,
  program text,
  season text,
  mentee_name text,
  mentee_email text,
  mentee_phone text,
  mentee_school text,
  mentor_name text,
  mentor_email text,
  direction text,
  match_status text,
  issue_flag text,
  issue_note text,
  import_ready text
) on commit drop;

\copy _ham_matches_source from 'data_imports/ham/ham_matches_clean.csv' with (format csv, header true, encoding 'UTF8')

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
begin
  if not exists (select 1 from _ham_context) then
    raise exception 'HAM-S6 context was not found. Run ham_s6_01_seed_program_season.sql first.';
  end if;
end;
$$;

create temp table _ham_people_resolved as
select
  ps.*,
  lower(nullif(trim(ps.email), '')) as email_norm,
  regexp_replace(coalesce(ps.phone, ''), '\D', '', 'g') as phone_norm,
  lower(regexp_replace(regexp_replace(translate(ps.full_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) as name_key,
  m.person_id
from _ham_people_source ps
join public.staging_ham_s6_people_identity_map m
  on m.full_name = ps.full_name
 and m.ham_role = ps.role
 and lower(coalesce(m.email, '')) = lower(coalesce(ps.email, ''))
where m.person_id is not null
  and upper(coalesce(ps.import_ready, '')) = 'TRUE';

insert into public.mentor_profiles (
  person_id,
  mentor_code,
  bio_url,
  company_current,
  title_current,
  current_company,
  current_title,
  industry,
  function_area,
  first_vam_season,
  bio_short,
  linkedin_url,
  intake_batch_id
)
select
  r.person_id,
  'HAM-S6-MENTOR-' || lpad(row_number() over (order by r.full_name)::text, 3, '0'),
  nullif(r.vam_profile_link, ''),
  nullif(r.company, ''),
  nullif(r.title, ''),
  nullif(r.company, ''),
  nullif(r.title, ''),
  nullif(r.field, ''),
  nullif(r.expertise, ''),
  'HAM-S6',
  concat_ws(
    E'\n',
    'HAM S6 mentor profile from clean source.',
    'source_file=' || coalesce(r.source_file, ''),
    'source_sheet=' || coalesce(r.source_sheet, ''),
    'source_row=' || coalesce(r.row_num, ''),
    'field=' || coalesce(r.field, ''),
    'expertise=' || coalesce(r.expertise, '')
  ),
  nullif(r.linkedin, ''),
  (select intake_batch_id from _ham_context)
from _ham_people_resolved r
where r.role = 'mentor'
  and not exists (
    select 1
    from public.mentor_profiles mp
    where mp.person_id = r.person_id
  );

insert into public.mentee_profiles (
  person_id,
  status,
  mentee_code,
  school_raw,
  university,
  career_interest,
  target_industry,
  target_function,
  mentee_status,
  intake_batch_id
)
select
  r.person_id,
  'active',
  'HAM-S6-MENTEE-' || lpad(row_number() over (order by r.full_name)::text, 3, '0'),
  nullif(r.school, ''),
  nullif(r.school, ''),
  nullif(coalesce(r.field, r.expertise), ''),
  nullif(r.field, ''),
  nullif(r.expertise, ''),
  'active',
  (select intake_batch_id from _ham_context)
from _ham_people_resolved r
where r.role = 'mentee'
  and not exists (
    select 1
    from public.mentee_profiles mp
    where mp.person_id = r.person_id
  );

create temp table _ham_match_ready as
with mentor_lookup as (
  select
    person_id,
    lower(coalesce(email, '')) as email_norm,
    lower(regexp_replace(regexp_replace(translate(full_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) as name_key
  from _ham_people_resolved
  where role = 'mentor'
),
mentee_lookup as (
  select
    person_id,
    lower(coalesce(email, '')) as email_norm,
    lower(regexp_replace(regexp_replace(translate(full_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')) as name_key
  from _ham_people_resolved
  where role = 'mentee'
)
select
  ms.*,
  ml.person_id as mentor_person_id,
  mtl.person_id as mentee_person_id,
  to_jsonb(ms) as source_payload
from _ham_matches_source ms
left join mentor_lookup ml
  on (
    lower(nullif(trim(ms.mentor_email), '')) is not null
    and ml.email_norm = lower(nullif(trim(ms.mentor_email), ''))
  )
  or (
    lower(nullif(trim(ms.mentor_email), '')) is null
    and ml.name_key = lower(regexp_replace(regexp_replace(translate(ms.mentor_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g'))
  )
left join mentee_lookup mtl
  on (
    lower(nullif(trim(ms.mentee_email), '')) is not null
    and mtl.email_norm = lower(nullif(trim(ms.mentee_email), ''))
  )
  or (
    lower(nullif(trim(ms.mentee_email), '')) is null
    and mtl.name_key = lower(regexp_replace(regexp_replace(translate(ms.mentee_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'), '[^[:alnum:]]+', ' ', 'g'))
  )
where upper(coalesce(ms.import_ready, '')) = 'TRUE';

insert into public.staging_ham_s6_import_skips (
  import_step,
  source_row,
  source_file,
  source_sheet,
  full_name,
  email,
  phone,
  issue_reason,
  source_payload
)
select
  'matches',
  nullif(row_num, '')::int,
  source_file,
  source_sheet,
  concat_ws(' / ', mentor_name, mentee_name),
  nullif(concat_ws(' / ', mentor_email, mentee_email), ''),
  nullif(mentee_phone, ''),
  case
    when mentor_person_id is null and mentee_person_id is null then 'unresolved_mentor_and_mentee'
    when mentor_person_id is null then 'unresolved_mentor'
    when mentee_person_id is null then 'unresolved_mentee'
    else 'unknown_match_resolution_issue'
  end,
  source_payload
from _ham_match_ready
where mentor_person_id is null
   or mentee_person_id is null
on conflict do nothing;

insert into public.matches (
  mentor_id,
  mentee_id,
  season_code,
  season_id,
  status,
  mentor_person_id,
  mentee_person_id,
  match_type,
  match_source_raw,
  match_confidence,
  notes,
  match_reason,
  primary_match
)
select
  ready.mentor_person_id,
  ready.mentee_person_id,
  'HAM-S6',
  ctx.season_id,
  'active',
  ready.mentor_person_id,
  ready.mentee_person_id,
  'primary',
  'HAM_S6 clean match import',
  1.0,
  concat_ws(
    E'\n',
    'HAM S6 match import.',
    'source_file=' || coalesce(ready.source_file, ''),
    'source_sheet=' || coalesce(ready.source_sheet, ''),
    'source_row=' || coalesce(ready.row_num, ''),
    'source_season=' || coalesce(ready.season, ''),
    'direction=' || coalesce(ready.direction, '')
  ),
  nullif(ready.direction, ''),
  true
from _ham_match_ready ready
cross join _ham_context ctx
where ready.mentor_person_id is not null
  and ready.mentee_person_id is not null
  and not exists (
    select 1
    from public.matches existing
    where existing.season_id = ctx.season_id
      and existing.mentor_person_id = ready.mentor_person_id
      and existing.mentee_person_id = ready.mentee_person_id
  );

select 'resolved_people_for_profiles' as metric, count(*)::text as value from _ham_people_resolved
union all
select 'mentor_profiles_total_for_ham_batch', count(*)::text
from public.mentor_profiles
where intake_batch_id = (select intake_batch_id from _ham_context)
union all
select 'mentee_profiles_total_for_ham_batch', count(*)::text
from public.mentee_profiles
where intake_batch_id = (select intake_batch_id from _ham_context)
union all
select 'match_rows_ready', count(*)::text from _ham_match_ready
union all
select 'match_rows_resolved', count(*)::text
from _ham_match_ready
where mentor_person_id is not null and mentee_person_id is not null
union all
select 'ham_s6_matches_total', count(*)::text
from public.matches
where season_id = (select season_id from _ham_context)
union all
select 'match_skips_logged', count(*)::text
from public.staging_ham_s6_import_skips
where import_step = 'matches';

notify pgrst, 'reload schema';

commit;
