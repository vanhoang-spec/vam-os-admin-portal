-- VAM OS Batch 5B-1A — Migration 061 revised by pre-authorization review
-- DESIGN ONLY — NOT APPLIED
-- OWNER AUTHORIZATION REQUIRED before staging or production execution.
-- First-install migration: repeated execution fails closed with OBJECT_CONFLICT.
-- No seed, backfill, UPDATE, DELETE, TRUNCATE, enum alteration, or historical rewrite.

begin;

-- Fail before taking DDL locks when dependencies or target objects are uncertain.
do $$
declare
  v_missing text;
  v_conflict text;
begin
  select name into v_missing from (values
    ('programs'), ('seasons'), ('intake_batches'), ('applications'),
    ('admin_users'), ('admin_scope_access')
  ) required(name)
  where to_regclass('public.' || required.name) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DEPENDENCY_MISSING: public.%', v_missing;
  end if;

  if to_regclass('public.recruitment_campaigns') is not null then
    raise exception 'OBJECT_CONFLICT: public.recruitment_campaigns already exists; compare its exact schema before any rerun';
  end if;

  select column_name into v_conflict
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'applications'
    and column_name in ('recruitment_campaign_id','application_reference','consent_version','consented_at')
  limit 1;
  if v_conflict is not null then
    raise exception 'OBJECT_CONFLICT: public.applications.% already exists; compare type, constraints and ownership before proceeding', v_conflict;
  end if;

  if to_regprocedure('public.validate_recruitment_campaign_scope()') is not null
     or to_regprocedure('public.validate_application_campaign_scope()') is not null then
    raise exception 'OBJECT_CONFLICT: a migration 061 trigger function already exists';
  end if;

  if to_regclass('public.recruitment_campaigns_public_slug_uniq') is not null
     or to_regclass('public.recruitment_campaigns_scope_idx') is not null
     or to_regclass('public.applications_campaign_email_role_uniq') is not null
     or to_regclass('public.applications_reference_uniq') is not null
     or to_regclass('public.applications_campaign_status_idx') is not null then
    raise exception 'OBJECT_CONFLICT: a migration 061 index name already exists';
  end if;
end;
$$;

create table public.recruitment_campaigns (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid not null references public.intake_batches(id) on delete restrict,
  applicant_role text not null check (applicant_role in ('mentor', 'mentee')),
  name text not null check (length(btrim(name)) between 3 and 160),
  public_slug text not null check (public_slug = lower(btrim(public_slug)) and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'closed', 'archived')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  timezone text not null default 'Asia/Ho_Chi_Minh' check (timezone = 'Asia/Ho_Chi_Minh'),
  capacity_target integer check (capacity_target is null or capacity_target > 0),
  interview_required boolean not null default true,
  confirmation_deadline_days integer check (confirmation_deadline_days is null or confirmation_deadline_days > 0),
  eligibility_text text not null check (btrim(eligibility_text) <> ''),
  privacy_notice text not null check (btrim(privacy_notice) <> ''),
  consent_version text not null check (btrim(consent_version) <> ''),
  success_message text not null check (btrim(success_message) <> ''),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint recruitment_campaigns_time_window check (opens_at < closes_at),
  constraint recruitment_campaigns_archive_state check (
    (status = 'archived' and archived_at is not null) or
    (status <> 'archived' and archived_at is null)
  )
);

create unique index recruitment_campaigns_public_slug_uniq
  on public.recruitment_campaigns (lower(btrim(public_slug)));
create index recruitment_campaigns_scope_idx
  on public.recruitment_campaigns (program_id, season_id, intake_batch_id, applicant_role, status);

alter table public.applications
  add column recruitment_campaign_id uuid references public.recruitment_campaigns(id) on delete restrict,
  add column application_reference text,
  add column consent_version text,
  add column consented_at timestamptz;

create unique index applications_campaign_email_role_uniq
  on public.applications (recruitment_campaign_id, role_applied, lower(btrim(email_primary)))
  where recruitment_campaign_id is not null and nullif(btrim(email_primary), '') is not null;
create unique index applications_reference_uniq
  on public.applications (application_reference)
  where application_reference is not null;
create index applications_campaign_status_idx
  on public.applications (recruitment_campaign_id, status, submitted_at);

create function public.validate_recruitment_campaign_scope()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_season_program uuid;
  v_batch_season uuid;
begin
  if tg_op = 'UPDATE'
     and (new.program_id, new.season_id, new.intake_batch_id)
         is distinct from (old.program_id, old.season_id, old.intake_batch_id)
     and exists (
       select 1 from public.applications a
       where a.recruitment_campaign_id = old.id
     ) then
    raise exception 'CAMPAIGN_SCOPE_LOCKED: campaign already has applications' using errcode = '23514';
  end if;

  select s.program_id into v_season_program from public.seasons s where s.id = new.season_id;
  if v_season_program is distinct from new.program_id then
    raise exception 'CAMPAIGN_SCOPE_INVALID: season does not belong to program' using errcode = '23514';
  end if;
  select b.season_id into v_batch_season from public.intake_batches b where b.id = new.intake_batch_id;
  if v_batch_season is distinct from new.season_id then
    raise exception 'CAMPAIGN_SCOPE_INVALID: intake batch does not belong to season' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.validate_recruitment_campaign_scope() from public, anon, authenticated;

create trigger recruitment_campaigns_scope_guard
before insert or update
on public.recruitment_campaigns for each row execute function public.validate_recruitment_campaign_scope();

create function public.validate_application_campaign_scope()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_campaign public.recruitment_campaigns%rowtype;
begin
  if new.recruitment_campaign_id is null then return new; end if;
  if nullif(btrim(new.email_primary), '') is null
     or new.application_reference is null
     or new.application_reference !~ '^VAM-[A-Z0-9]{10,12}$'
     or nullif(btrim(new.consent_version), '') is null
     or new.consented_at is null then
    raise exception 'CAMPAIGN_APPLICATION_GOVERNANCE_INVALID' using errcode = '23514';
  end if;
  select * into v_campaign from public.recruitment_campaigns where id = new.recruitment_campaign_id;
  if not found
     or new.season_id is distinct from v_campaign.season_id
     or new.intake_batch_id is distinct from v_campaign.intake_batch_id
     or new.role_applied::text is distinct from v_campaign.applicant_role then
    raise exception 'APPLICATION_CAMPAIGN_SCOPE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_application_campaign_scope() from public, anon, authenticated;

create trigger applications_campaign_scope_guard
before insert or update of recruitment_campaign_id, season_id, intake_batch_id, role_applied, email_primary, application_reference, consent_version, consented_at
on public.applications for each row execute function public.validate_application_campaign_scope();

alter table public.recruitment_campaigns enable row level security;
revoke all on table public.recruitment_campaigns from anon;
revoke insert, update, delete, truncate, references, trigger on table public.recruitment_campaigns from authenticated;
grant select on table public.recruitment_campaigns to authenticated;
revoke all on table public.applications from anon;

create policy recruitment_campaigns_scoped_admin_read on public.recruitment_campaigns
for select to authenticated
using (
  exists (
    select 1 from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.status = 'active'
      and (
        au.role::text = 'super_admin'
        or exists (
          select 1
          from public.admin_scope_access asa
          left join public.programs p on p.id = recruitment_campaigns.program_id
          left join public.seasons s on s.id = recruitment_campaigns.season_id
          where asa.user_id = auth.uid()
            and asa.status = 'active'
            and (
              asa.program_id in (recruitment_campaigns.program_id::text, p.code)
              or asa.season_id in (recruitment_campaigns.season_id::text, s.code)
            )
        )
      )
  )
);

-- No campaign INSERT/UPDATE/DELETE policy and no anonymous application policy.
-- Guarded server code may use service role only after application authorization.

commit;
