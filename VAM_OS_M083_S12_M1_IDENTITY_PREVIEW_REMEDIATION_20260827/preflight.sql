-- M083 READ-ONLY PREFLIGHT. Run independently before apply.sql.
begin;
set transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Human-readable evidence. No statement in this file corrects data.
select 'duplicate_canonical_people_email' as check_name,
       lower(btrim(email_primary)) as identity_value,
       count(*) as row_count
from public.people
where nullif(btrim(email_primary), '') is not null
group by lower(btrim(email_primary))
having count(*) > 1
order by identity_value;

select 'duplicate_season_role_canonical_application_email' as check_name,
       season_id, role_applied, lower(btrim(email_primary)) as identity_value,
       count(*) as row_count
from public.applications
where season_id is not null and role_applied is not null
  and nullif(btrim(email_primary), '') is not null
group by season_id, role_applied, lower(btrim(email_primary))
having count(*) > 1
order by season_id, role_applied, identity_value;

select 'duplicate_season_role_application_person' as check_name,
       season_id, role_applied, person_id, count(*) as row_count
from public.applications
where person_id is not null
  and season_id is not null
  and role_applied is not null
group by season_id, role_applied, person_id
having count(*) > 1
order by season_id, role_applied, person_id;

select 'duplicate_person_season_role_membership' as check_name,
       person_id, season_id, role, count(*) as row_count
from public.person_season_memberships
group by person_id, season_id, role
having count(*) > 1
order by person_id, season_id, role;

select 'duplicate_canonical_mentor_code' as check_name,
       lower(btrim(mentor_code)) as identity_value,
       count(*) as row_count,
       count(distinct person_id) as person_count
from public.mentor_profiles
where nullif(btrim(mentor_code), '') is not null
group by lower(btrim(mentor_code))
having count(*) > 1
order by identity_value;

select
  count(*) filter (where email_primary is null) as null_people_emails,
  count(*) filter (where email_primary is not null and btrim(email_primary) = '') as blank_people_emails,
  count(*) filter (where email_primary is not null and email_primary <> btrim(email_primary)) as untrimmed_people_emails,
  count(*) filter (where email_primary is not null and email_primary <> lower(email_primary)) as mixed_case_people_emails,
  count(*) filter (where email_primary like '%\%%' escape '\' or email_primary like '%\_%' escape '\') as people_emails_with_ilike_metacharacters
from public.people;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('people', 'applications', 'mentor_profiles', 'person_season_memberships')
order by tablename, indexname;

do $m083_preflight$
declare
  v_count integer;
  v_detail text;
begin
  if to_regclass('public.people') is null
     or to_regclass('public.applications') is null
     or to_regclass('public.mentor_profiles') is null
     or to_regclass('public.person_season_memberships') is null
     or to_regclass('public.admin_users') is null then
    raise exception 'M083 PREFLIGHT REFUSED [TABLE_PREREQUISITE]: required core tables are missing.';
  end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role'
    and p.pronargs = 0 and p.proretset;
  if v_count <> 1 then
    raise exception 'M083 PREFLIGHT REFUSED [AUTHORITATIVE_M072_RESOLVER]: expected exactly one set-returning public.vam063_trusted_api_role(), found %.', v_count;
  end if;

  select count(*) into v_count
  from pg_constraint c
  where c.conrelid = 'public.person_season_memberships'::regclass
    and c.conname = 'person_season_memberships_person_season_role_key'
    and c.contype = 'u'
    and pg_get_constraintdef(c.oid) = 'UNIQUE (person_id, season_id, role)';
  if v_count <> 1 then
    raise exception 'M083 PREFLIGHT REFUSED [MEMBERSHIP_UNIQUENESS_CONTRACT]: authoritative UNIQUE(person_id, season_id, role) is missing or changed.';
  end if;

  select count(*) into v_count from (
    select 1 from public.people
    where nullif(btrim(email_primary), '') is not null
    group by lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 PREFLIGHT REFUSED [PEOPLE_CANONICAL_EMAIL_CONFLICT]: % duplicate canonical identities; review without auto-merging.', v_count;
  end if;

  select count(*) into v_count from (
    select 1 from public.applications
    where season_id is not null and role_applied is not null
      and nullif(btrim(email_primary), '') is not null
    group by season_id, role_applied, lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 PREFLIGHT REFUSED [APPLICATION_CANONICAL_EMAIL_CONFLICT]: % conflicting groups.', v_count;
  end if;

  declare
    v_s12_season_id uuid;
  begin
    select id into v_s12_season_id from public.seasons where code = 'UEHM-S12';
    if not found then
      raise exception 'M083 PREFLIGHT REFUSED [MISSING_S12_SEASON]: UEHM-S12 not found in seasons.';
    end if;

    select count(*) into v_count from (
      select 1 from public.applications 
      where person_id is not null
        and season_id = v_s12_season_id
        and role_applied is not null
      group by season_id, role_applied, person_id having count(*) > 1
    ) d;
    if v_count > 0 then
      raise exception 'M083 PREFLIGHT REFUSED [APPLICATION_PERSON_CONFLICT]: % S12 conflicting groups.', v_count;
    end if;
  end;

  select count(*) into v_count from (
    select 1 from public.person_season_memberships
    group by person_id, season_id, role having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 PREFLIGHT REFUSED [MEMBERSHIP_CONFLICT]: % conflicting groups despite the authoritative constraint.', v_count;
  end if;

  select count(*) into v_count from (
    select 1 from public.mentor_profiles
    where nullif(btrim(mentor_code), '') is not null
    group by lower(btrim(mentor_code)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 PREFLIGHT REFUSED [MENTOR_CODE_CONFLICT]: % duplicate canonical mentor codes; do not guess ownership.', v_count;
  end if;

  select string_agg(format('%I.%I = %s', n.nspname, c.relname, pg_get_indexdef(c.oid)), E'\n')
    into v_detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'i' and n.nspname = 'public'
    and c.relname = any (array[
      'people_canonical_email_key',
      'applications_season_role_canonical_email_key',
      'applications_s12_role_person_key',
      'mentor_profiles_canonical_mentor_code_key'
    ]);
  if v_detail is not null then
    raise exception 'M083 PREFLIGHT REFUSED [INDEX_NAME_COLLISION]: target names already exist:%', E'\n' || v_detail;
  end if;

  if to_regclass('public.legacy_mentor_import_previews') is not null
     or exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'vam083\_%'
     ) then
    raise exception 'M083 PREFLIGHT REFUSED [PREVIEW_OBJECT_COLLISION]: M083 preview table or RPC namespace already exists.';
  end if;
end
$m083_preflight$;

select 'M083_PREFLIGHT_PASS' as result,
       'email-shape counts above are evidence only; no data was changed' as note;
rollback;

