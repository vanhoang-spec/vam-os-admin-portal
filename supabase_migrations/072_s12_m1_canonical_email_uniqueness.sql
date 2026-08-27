-- S12-M1 REVIEW-ONLY MIGRATION. DO NOT APPLY TO A CONNECTED DATABASE WITHOUT
-- independent data review and an approved maintenance window.
--
-- Purpose: close the race window left by application-level duplicate checks.
-- Canonical policy is lower(btrim(email)); no Gmail/provider rewriting.

begin;

do $preflight$
declare
  v_people_conflicts text;
  v_application_conflicts text;
begin
  select string_agg(canonical_email || ' (' || n || ')', ', ' order by canonical_email)
    into v_people_conflicts
  from (
    select lower(btrim(email_primary)) canonical_email, count(*) n
    from public.people
    where nullif(btrim(email_primary), '') is not null
    group by lower(btrim(email_primary))
    having count(*) > 1
  ) conflicts;
  if v_people_conflicts is not null then
    raise exception 'M072 ABORTED [PEOPLE_CANONICAL_EMAIL_CONFLICT]: %', v_people_conflicts;
  end if;

  select string_agg(season_id::text || '/' || role_applied || '/' || canonical_email || ' (' || n || ')', ', ')
    into v_application_conflicts
  from (
    select season_id, role_applied, lower(btrim(email_primary)) canonical_email, count(*) n
    from public.applications
    where season_id is not null
      and role_applied is not null
      and nullif(btrim(email_primary), '') is not null
    group by season_id, role_applied, lower(btrim(email_primary))
    having count(*) > 1
  ) conflicts;
  if v_application_conflicts is not null then
    raise exception 'M072 ABORTED [APPLICATION_CANONICAL_EMAIL_CONFLICT]: %', v_application_conflicts;
  end if;
end
$preflight$;

create unique index if not exists people_canonical_email_key
  on public.people (lower(btrim(email_primary)))
  where nullif(btrim(email_primary), '') is not null;

create unique index if not exists applications_season_role_canonical_email_key
  on public.applications (season_id, role_applied, lower(btrim(email_primary)))
  where season_id is not null
    and role_applied is not null
    and nullif(btrim(email_primary), '') is not null;

-- A separate encrypted, one-use preview store. M062's account-import preview
-- RPC intentionally admits super_admin only; changing that authorization would
-- broaden an unrelated staff/account workflow. This store is limited to active
-- Core Team/admin tiers and carries no plaintext CSV.
create table if not exists public.legacy_mentor_import_previews (
  id uuid primary key,
  actor_admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint legacy_mentor_import_previews_expiry_check check (expires_at > created_at)
);

alter table public.legacy_mentor_import_previews enable row level security;
revoke all on public.legacy_mentor_import_previews from public, anon, authenticated;

create or replace function public.vam072_create_legacy_mentor_preview(
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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     or not exists (
       select 1 from public.admin_users
       where id = p_actor_admin_user_id
         and role = any (array['core_team','admin','super_admin'])
         and status = 'active'
     )
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes'
     or p_max_previews <> 50 then
    raise exception 'VAM072 legacy preview rejected' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM072_LEGACY_PREVIEW_STORE'));
  delete from public.legacy_mentor_import_previews where expires_at <= now();
  if (select count(*) from public.legacy_mentor_import_previews) >= p_max_previews then
    raise exception 'VAM072 legacy preview capacity reached' using errcode = '54000';
  end if;
  insert into public.legacy_mentor_import_previews
    (id,actor_admin_user_id,secret_hash,ciphertext,iv,auth_tag,expires_at)
  values
    (p_preview_id,p_actor_admin_user_id,p_secret_hash,p_ciphertext,p_iv,p_auth_tag,p_expires_at);
end
$$;

create or replace function public.vam072_consume_legacy_mentor_preview(
  p_preview_id uuid,
  p_actor_admin_user_id uuid,
  p_secret_hash text
) returns table(ciphertext text, iv text, auth_tag text)
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.legacy_mentor_import_previews
  where id = p_preview_id
    and actor_admin_user_id = p_actor_admin_user_id
    and secret_hash = p_secret_hash
    and expires_at > now()
  returning ciphertext, iv, auth_tag
$$;

revoke all on function
  public.vam072_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer),
  public.vam072_consume_legacy_mentor_preview(uuid,uuid,text)
from public, anon, authenticated, service_role;

grant execute on function
  public.vam072_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer),
  public.vam072_consume_legacy_mentor_preview(uuid,uuid,text)
to service_role;

commit;
