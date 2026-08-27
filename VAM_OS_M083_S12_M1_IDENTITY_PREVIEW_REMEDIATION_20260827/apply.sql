-- M083 REVIEW-ONLY APPLY. Two separately committed risk domains.
-- Never run on a connected database without explicit isolated-DB approval.

-- ============================================================================
-- DOMAIN A: CORE IDENTITY ARBITERS
-- ============================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $m083_domain_a_pre$
declare
  v_count integer;
  v_names text;
begin
  select count(*) into v_count from (
    select 1 from public.people
    where nullif(btrim(email_primary), '') is not null
    group by lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 DOMAIN A ABORTED [PEOPLE_CANONICAL_EMAIL_CONFLICT]: % groups.', v_count;
  end if;

  select count(*) into v_count from (
    select 1 from public.applications
    where season_id is not null and role_applied is not null
      and nullif(btrim(email_primary), '') is not null
    group by season_id, role_applied, lower(btrim(email_primary)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 DOMAIN A ABORTED [APPLICATION_CANONICAL_EMAIL_CONFLICT]: % groups.', v_count;
  end if;

  declare
    v_s12_season_id uuid;
  begin
    select id into v_s12_season_id from public.seasons where code = 'UEHM-S12';
    if not found then
      raise exception 'M083 DOMAIN A ABORTED [MISSING_S12_SEASON]: UEHM-S12 not found in seasons.';
    end if;

    select count(*) into v_count from (
      select 1 from public.applications 
      where person_id is not null 
        and season_id = v_s12_season_id 
        and role_applied is not null
      group by season_id, role_applied, person_id having count(*) > 1
    ) d;
    if v_count > 0 then
      raise exception 'M083 DOMAIN A ABORTED [APPLICATION_PERSON_CONFLICT]: % S12 groups.', v_count;
    end if;
  end;

  select count(*) into v_count from (
    select 1 from public.mentor_profiles
    where nullif(btrim(mentor_code), '') is not null
    group by lower(btrim(mentor_code)) having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'M083 DOMAIN A ABORTED [MENTOR_CODE_CONFLICT]: % groups.', v_count;
  end if;

  select string_agg(c.relname::text, ', ' order by c.relname) into v_names
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'i'
    and c.relname = any (array[
      'people_canonical_email_key',
      'applications_season_role_canonical_email_key',
      'applications_s12_role_person_key',
      'mentor_profiles_canonical_mentor_code_key'
    ]);
  if v_names is not null then
    raise exception 'M083 DOMAIN A ABORTED [INDEX_NAME_COLLISION]: %. Inspect pg_get_indexdef; no IF NOT EXISTS bypass is permitted.', v_names;
  end if;
end
$m083_domain_a_pre$;

create unique index people_canonical_email_key
  on public.people (lower(btrim(email_primary)))
  where nullif(btrim(email_primary), '') is not null;

create unique index applications_season_role_canonical_email_key
  on public.applications (season_id, role_applied, lower(btrim(email_primary)))
  where season_id is not null
    and role_applied is not null
    and nullif(btrim(email_primary), '') is not null;

do $m083_domain_a_idx$
declare
  v_s12_season_id uuid;
begin
  select id into v_s12_season_id from public.seasons where code = 'UEHM-S12';
  if not found then
    raise exception 'M083 DOMAIN A ABORTED [MISSING_S12_SEASON]: UEHM-S12 not found in seasons.';
  end if;

  execute format(
    'create unique index applications_s12_role_person_key
     on public.applications (season_id, role_applied, person_id)
     where person_id is not null
       and role_applied is not null
       and season_id = %L::uuid',
    v_s12_season_id
  );
end
$m083_domain_a_idx$;

create unique index mentor_profiles_canonical_mentor_code_key
  on public.mentor_profiles (lower(btrim(mentor_code)))
  where nullif(btrim(mentor_code), '') is not null;

do $m083_domain_a_post$
declare
  v_bad text;
begin
  select string_agg(expected.name, ', ' order by expected.name) into v_bad
  from (values
    ('people_canonical_email_key', 'people', 'lower(btrim('),
    ('applications_season_role_canonical_email_key', 'applications', 'lower(btrim('),
    ('applications_s12_role_person_key', 'applications', 'person_id'),
    ('mentor_profiles_canonical_mentor_code_key', 'mentor_profiles', 'lower(btrim(mentor_code))')
  ) as expected(name, table_name, required_fragment)
  left join pg_class idx on idx.relname = expected.name
  left join pg_namespace idx_ns on idx_ns.oid = idx.relnamespace and idx_ns.nspname = 'public'
  left join pg_index i on i.indexrelid = idx.oid
  left join pg_class tbl on tbl.oid = i.indrelid
  left join pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
  where idx_ns.oid is null
     or not i.indisunique
     or tbl_ns.nspname <> 'public'
     or tbl.relname <> expected.table_name
     or position(expected.required_fragment in pg_get_indexdef(idx.oid)) = 0
     or position(' WHERE ' in pg_get_indexdef(idx.oid)) = 0;
  if v_bad is not null then
    raise exception 'M083 DOMAIN A ABORTED [INDEX_POSTCONDITION]: unexpected definitions for %.', v_bad;
  end if;
end
$m083_domain_a_post$;

commit;

-- ============================================================================
-- DOMAIN B: ENCRYPTED, ACTOR-BOUND, ONE-USE LEGACY PREVIEW STORE
-- ============================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $m083_domain_b_pre$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role'
    and p.pronargs = 0 and p.proretset;
  if v_count <> 1 then
    raise exception 'M083 DOMAIN B ABORTED [AUTHORITATIVE_M072_RESOLVER]: expected exactly one public.vam063_trusted_api_role(), found %.', v_count;
  end if;
  if to_regclass('public.legacy_mentor_import_previews') is not null then
    raise exception 'M083 DOMAIN B ABORTED [TABLE_NAME_COLLISION]: public.legacy_mentor_import_previews already exists.';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'vam083\_%'
  ) then
    raise exception 'M083 DOMAIN B ABORTED [RPC_NAME_COLLISION]: public.vam083_* already exists.';
  end if;
end
$m083_domain_b_pre$;

create table public.legacy_mentor_import_previews (
  id uuid primary key,
  actor_admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  ciphertext text not null check (ciphertext <> ''),
  iv text not null check (iv <> ''),
  auth_tag text not null check (auth_tag <> ''),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint legacy_mentor_import_previews_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

comment on table public.legacy_mentor_import_previews is
  'M083 encrypted legacy mentor CSV previews; actor-bound, <=10 minute TTL, consumed by atomic DELETE RPC.';

alter table public.legacy_mentor_import_previews enable row level security;
revoke all on table public.legacy_mentor_import_previews
  from public, anon, authenticated, service_role;

create function public.vam083_create_legacy_mentor_preview(
  p_preview_id uuid,
  p_actor_admin_user_id uuid,
  p_secret_hash text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_expires_at timestamptz,
  p_max_previews integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role'
     or not exists (
       select 1 from public.admin_users
       where id = p_actor_admin_user_id
         and role = any (array['core_team','admin','super_admin'])
         and status = 'active'
     )
     or p_secret_hash !~ '^[0-9a-f]{64}$'
     or nullif(p_ciphertext, '') is null
     or nullif(p_iv, '') is null
     or nullif(p_auth_tag, '') is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes'
     or p_max_previews <> 50 then
    raise exception 'VAM083 legacy preview rejected' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('VAM083_LEGACY_PREVIEW_STORE'));
  delete from public.legacy_mentor_import_previews where expires_at <= now();
  if (select count(*) from public.legacy_mentor_import_previews) >= p_max_previews then
    raise exception 'VAM083 legacy preview capacity reached' using errcode = '54000';
  end if;
  insert into public.legacy_mentor_import_previews
    (id, actor_admin_user_id, secret_hash, ciphertext, iv, auth_tag, expires_at)
  values
    (p_preview_id, p_actor_admin_user_id, p_secret_hash, p_ciphertext, p_iv, p_auth_tag, p_expires_at);
end
$$;

create function public.vam083_consume_legacy_mentor_preview(
  p_preview_id uuid,
  p_actor_admin_user_id uuid,
  p_secret_hash text
) returns table(ciphertext text, iv text, auth_tag text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM083 trusted server context required' using errcode = '42501';
  end if;
  return query
    delete from public.legacy_mentor_import_previews p
    where p.id = p_preview_id
      and p.actor_admin_user_id = p_actor_admin_user_id
      and p.secret_hash = p_secret_hash
      and p.expires_at > now()
    returning p.ciphertext, p.iv, p.auth_tag;
end
$$;

revoke all on function
  public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer),
  public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)
from public, anon, authenticated, service_role;

grant execute on function
  public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer),
  public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)
to service_role;

do $m083_domain_b_post$
declare
  v_bad text;
begin
  select string_agg(p.proname::text, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam083\_%'
    and (
      not p.prosecdef
      or p.proconfig is distinct from array['search_path=public, pg_temp']::text[]
      or position('vam063_trusted_api_role' in p.prosrc) = 0
      or position('request.jwt.claim.role' in p.prosrc) > 0
    );
  if v_bad is not null then
    raise exception 'M083 DOMAIN B ABORTED [RPC_POSTCONDITION]: invalid trusted-context/security definition for %.', v_bad;
  end if;
end
$m083_domain_b_post$;

commit;
notify pgrst, 'reload schema';

