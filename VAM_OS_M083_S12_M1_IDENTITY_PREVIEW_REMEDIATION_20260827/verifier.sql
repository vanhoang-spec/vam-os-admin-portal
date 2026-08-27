-- M083 independent post-apply verifier. READ ONLY.
begin;
set transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = any (array[
    'people_canonical_email_key',
    'applications_season_role_canonical_email_key',
    'applications_season_role_person_key',
    'mentor_profiles_canonical_mentor_code_key'
  ])
order by indexname;

do $m083_verify$
declare
  v_count integer;
  v_bad text;
begin
  if to_regclass('public.legacy_mentor_import_previews') is null then
    raise exception 'M083 VERIFY FAILED [PREVIEW_TABLE_MISSING].';
  end if;

  select string_agg(expected.name, ', ' order by expected.name) into v_bad
  from (values
    ('people_canonical_email_key', 'people', 'lower(btrim(email_primary))', 'NULLIF(btrim(email_primary)'),
    ('applications_season_role_canonical_email_key', 'applications', 'season_id, role_applied, lower(btrim(email_primary))', 'NULLIF(btrim(email_primary)'),
    ('applications_season_role_person_key', 'applications', 'season_id, role_applied, person_id', 'season_id IS NOT NULL'),
    ('mentor_profiles_canonical_mentor_code_key', 'mentor_profiles', 'lower(btrim(mentor_code))', 'NULLIF(btrim(mentor_code)')
  ) as expected(name, table_name, key_fragment, predicate_fragment)
  left join pg_class idx on idx.relname = expected.name
  left join pg_namespace idx_ns on idx_ns.oid = idx.relnamespace and idx_ns.nspname = 'public'
  left join pg_index i on i.indexrelid = idx.oid
  left join pg_class tbl on tbl.oid = i.indrelid
  left join pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
  where idx_ns.oid is null
     or not i.indisunique
     or tbl_ns.nspname <> 'public'
     or tbl.relname <> expected.table_name
     or position(expected.key_fragment in pg_get_indexdef(idx.oid)) = 0
     or position(expected.predicate_fragment in pg_get_indexdef(idx.oid)) = 0;
  if v_bad is not null then
    raise exception 'M083 VERIFY FAILED [INDEX_DEFINITION]: %.', v_bad;
  end if;

  select count(*) into v_count from (
    select 1 from public.people
    where nullif(btrim(email_primary), '') is not null
    group by lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [PEOPLE_DUPLICATES]: %.', v_count; end if;

  select count(*) into v_count from (
    select 1 from public.applications
    where season_id is not null and role_applied is not null
      and nullif(btrim(email_primary), '') is not null
    group by season_id, role_applied, lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [APPLICATION_EMAIL_DUPLICATES]: %.', v_count; end if;

  select count(*) into v_count from (
    select 1 from public.applications where person_id is not null
    group by season_id, role_applied, person_id having count(*) > 1
  ) d;
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [APPLICATION_PERSON_DUPLICATES]: %.', v_count; end if;

  select count(*) into v_count from (
    select 1 from public.mentor_profiles
    where nullif(btrim(mentor_code), '') is not null
    group by lower(btrim(mentor_code)) having count(*) > 1
  ) d;
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [MENTOR_CODE_DUPLICATES]: %.', v_count; end if;

  select count(*) into v_count
  from pg_constraint c
  where c.conrelid = 'public.person_season_memberships'::regclass
    and c.conname = 'person_season_memberships_person_season_role_key'
    and c.contype = 'u'
    and pg_get_constraintdef(c.oid) = 'UNIQUE (person_id, season_id, role)';
  if v_count <> 1 then
    raise exception 'M083 VERIFY FAILED [MEMBERSHIP_UNIQUENESS_CONTRACT].';
  end if;

  select count(*) into v_count from (
    select 1 from public.person_season_memberships
    group by person_id, season_id, role having count(*) > 1
  ) d;
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [MEMBERSHIP_DUPLICATES]: %.', v_count; end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role'
    and p.pronargs = 0 and p.proretset;
  if v_count <> 1 then raise exception 'M083 VERIFY FAILED [AUTHORITATIVE_M072_RESOLVER].'; end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam083\_%';
  if v_count <> 2 then raise exception 'M083 VERIFY FAILED [RPC_COUNT]: expected 2, found %.', v_count; end if;

  select string_agg(p.proname::text, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam083\_%'
    and (
      not p.prosecdef
      or position('vam063_trusted_api_role' in p.prosrc) = 0
      or position('request.jwt.claim.role' in p.prosrc) > 0
    );
  if v_bad is not null then raise exception 'M083 VERIFY FAILED [TRUSTED_CONTEXT_SOURCE]: %.', v_bad; end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam083_consume_legacy_mentor_preview'
    and position('delete from public.legacy_mentor_import_previews' in lower(p.prosrc)) > 0
    and position('actor_admin_user_id = p_actor_admin_user_id' in lower(p.prosrc)) > 0
    and position('secret_hash = p_secret_hash' in lower(p.prosrc)) > 0
    and position('expires_at > now()' in lower(p.prosrc)) > 0;
  if v_count <> 1 then raise exception 'M083 VERIFY FAILED [ONE_USE_ACTOR_BINDING].'; end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'legacy_mentor_import_previews'
    and c.relrowsecurity and not c.relforcerowsecurity;
  if v_count <> 1 then raise exception 'M083 VERIFY FAILED [RLS_STATE].'; end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'legacy_mentor_import_previews';
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [UNEXPECTED_TABLE_POLICY]: %.', v_count; end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  where n.nspname = 'public' and c.relname = 'legacy_mentor_import_previews'
    and acl.grantee = any (array[
      0::oid,
      coalesce(to_regrole('anon')::oid, 0::oid),
      coalesce(to_regrole('authenticated')::oid, 0::oid),
      coalesce(to_regrole('service_role')::oid, 0::oid)
    ]);
  if v_count <> 0 then raise exception 'M083 VERIFY FAILED [DIRECT_TABLE_GRANT]: % client/server grants remain.', v_count; end if;

  if not has_function_privilege('service_role', 'public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer)', 'execute')
     or has_function_privilege('anon', 'public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)', 'execute') then
    raise exception 'M083 VERIFY FAILED [RPC_GRANT_CONTRACT].';
  end if;
end
$m083_verify$;

select 'M083_VERIFY_PASS' as result,
       4 as unique_index_postconditions,
       2 as trusted_preview_rpcs,
       'NO_DIRECT_TABLE_ACCESS' as preview_table_access;
rollback;

