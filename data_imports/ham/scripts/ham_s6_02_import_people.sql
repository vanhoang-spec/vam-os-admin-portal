-- HAM Season 6 staging people import.
--
-- STAGING ONLY. Do not run on production.
--
-- Source files:
--   data_imports/ham/ham_people_clean.csv
--   data_imports/ham/ham_identity_resolution_dry_run.csv
--
-- Behavior:
--   * Creates a persistent staging identity map for later HAM scripts.
--   * Links the 2 safe existing-person matches from the dry run.
--   * Inserts new people candidates only when dry-run says they are safe new rows.
--   * Skips and logs manual-review/name-only candidates.
--   * Does not create duplicate people when email already exists.

begin;

create table if not exists public.staging_ham_s6_people_identity_map (
  source_row integer primary key,
  source_file text,
  source_sheet text,
  ham_role text,
  full_name text,
  email text,
  phone text,
  source_match_status text,
  source_match_method text,
  person_id uuid references public.people(id) on delete set null,
  action text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staging_ham_s6_people_identity_map_person_idx
  on public.staging_ham_s6_people_identity_map(person_id)
  where person_id is not null;

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

create temp table _ham_identity_dry_run (
  source_row integer,
  source_file text,
  source_sheet text,
  ham_role text,
  full_name text,
  email text,
  phone text,
  school text,
  company text,
  title text,
  import_ready text,
  match_status text,
  match_method text,
  match_reason text,
  matched_count integer,
  matched_person_ids text,
  matched_names text,
  matched_email text,
  matched_phone text,
  existing_profile_class text,
  would_create_person text,
  unsafe_auto_import text
) on commit drop;

\copy _ham_identity_dry_run from 'data_imports/ham/ham_identity_resolution_dry_run.csv' with (format csv, header true, encoding 'UTF8')

create temp table _ham_people_ready as
select
  d.source_row,
  p.source_file,
  p.source_sheet,
  p.full_name,
  lower(nullif(trim(p.email), '')) as email_norm,
  regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') as phone_norm,
  p.role as ham_role,
  p.gender,
  p.school,
  p.company,
  p.title,
  p.expertise,
  p.field,
  p.linkedin,
  p.vam_profile_link,
  p.import_ready,
  d.match_status,
  d.match_method,
  d.match_reason,
  d.matched_person_ids,
  d.would_create_person,
  d.unsafe_auto_import,
  to_jsonb(p) || to_jsonb(d) as source_payload
from _ham_identity_dry_run d
join _ham_people_source p
  on p.source_file = d.source_file
 and p.source_sheet = d.source_sheet
 and p.full_name = d.full_name
where upper(coalesce(p.import_ready, '')) = 'TRUE';

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
  'people',
  source_row,
  source_file,
  source_sheet,
  full_name,
  email_norm,
  phone_norm,
  case
    when unsafe_auto_import = 'yes' then 'manual_review_identity'
    else 'not_import_ready'
  end,
  source_payload
from _ham_people_ready
where unsafe_auto_import = 'yes'
   or upper(coalesce(import_ready, '')) <> 'TRUE'
on conflict do nothing;

create temp table _ham_existing_safe_links as
select
  r.source_row,
  r.source_file,
  r.source_sheet,
  r.ham_role,
  r.full_name,
  r.email_norm,
  r.phone_norm,
  r.match_status,
  r.match_method,
  nullif(split_part(r.matched_person_ids, '|', 1), '')::uuid as person_id,
  r.match_reason
from _ham_people_ready r
where r.match_status = 'matched_existing_person'
  and r.unsafe_auto_import = 'no'
  and nullif(split_part(r.matched_person_ids, '|', 1), '') is not null;

create temp table _ham_new_people_candidates as
select r.*
from _ham_people_ready r
where r.match_status = 'no_match_new_person_candidate'
  and r.would_create_person = 'yes'
  and r.unsafe_auto_import = 'no';

with inserted as (
  insert into public.people (
    full_name,
    role,
    email_primary,
    phone_primary,
    gender,
    source_sheets,
    data_quality_flags
  )
  select
    c.full_name,
    c.ham_role,
    c.email_norm,
    c.phone_norm,
    nullif(c.gender, ''),
    concat_ws(' | ', 'HAM_S6', c.source_file, c.source_sheet),
    concat_ws(
      E'\n',
      'HAM S6 staging import candidate.',
      'source_row=' || c.source_row,
      'source_season=HAM_S6',
      'school=' || coalesce(c.school, ''),
      'company=' || coalesce(c.company, ''),
      'title=' || coalesce(c.title, ''),
      'expertise=' || coalesce(c.expertise, ''),
      'field=' || coalesce(c.field, ''),
      'linkedin=' || coalesce(c.linkedin, ''),
      'vam_profile_link=' || coalesce(c.vam_profile_link, '')
    )
  from _ham_new_people_candidates c
  where not exists (
    select 1
    from public.people existing
    where lower(trim(coalesce(existing.email_primary, ''))) = c.email_norm
      and c.email_norm is not null
  )
  returning id, lower(trim(email_primary)) as email_norm
),
resolved_new as (
  select
    c.source_row,
    c.source_file,
    c.source_sheet,
    c.ham_role,
    c.full_name,
    c.email_norm,
    c.phone_norm,
    c.match_status,
    c.match_method,
    coalesce(i.id, existing.id) as person_id,
    case when i.id is not null then 'created_new_person' else 'linked_existing_email_on_rerun' end as action,
    c.match_reason
  from _ham_new_people_candidates c
  left join inserted i on i.email_norm = c.email_norm
  left join public.people existing
    on lower(trim(coalesce(existing.email_primary, ''))) = c.email_norm
)
insert into public.staging_ham_s6_people_identity_map (
  source_row,
  source_file,
  source_sheet,
  ham_role,
  full_name,
  email,
  phone,
  source_match_status,
  source_match_method,
  person_id,
  action,
  reason,
  updated_at
)
select
  source_row,
  source_file,
  source_sheet,
  ham_role,
  full_name,
  email_norm,
  phone_norm,
  match_status,
  match_method,
  person_id,
  action,
  match_reason,
  now()
from resolved_new
where person_id is not null
on conflict (source_row) do update
set
  person_id = excluded.person_id,
  action = excluded.action,
  reason = excluded.reason,
  updated_at = now();

insert into public.staging_ham_s6_people_identity_map (
  source_row,
  source_file,
  source_sheet,
  ham_role,
  full_name,
  email,
  phone,
  source_match_status,
  source_match_method,
  person_id,
  action,
  reason,
  updated_at
)
select
  source_row,
  source_file,
  source_sheet,
  ham_role,
  full_name,
  email_norm,
  phone_norm,
  match_status,
  match_method,
  person_id,
  'linked_existing_person',
  match_reason,
  now()
from _ham_existing_safe_links
on conflict (source_row) do update
set
  person_id = excluded.person_id,
  action = excluded.action,
  reason = excluded.reason,
  updated_at = now();

select 'people_source_rows' as metric, count(*)::text as value from _ham_people_ready
union all
select 'safe_existing_links', count(*)::text from _ham_existing_safe_links
union all
select 'new_people_candidates', count(*)::text from _ham_new_people_candidates
union all
select 'identity_map_rows', count(*)::text from public.staging_ham_s6_people_identity_map
union all
select 'manual_review_skips_logged', count(*)::text
from public.staging_ham_s6_import_skips
where import_step = 'people'
  and issue_reason = 'manual_review_identity';

notify pgrst, 'reload schema';

commit;
