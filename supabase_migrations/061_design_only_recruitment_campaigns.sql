-- VAM OS Batch 5B-1A
-- DESIGN ONLY — NOT APPLIED
-- OWNER AUTHORIZATION REQUIRED before staging or production execution.
-- This file contains no seed or backfill statements.

begin;

create table if not exists public.recruitment_campaigns (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid not null references public.intake_batches(id) on delete restrict,
  applicant_role text not null check (applicant_role in ('mentor', 'mentee')),
  name text not null check (length(trim(name)) between 3 and 160),
  public_slug text not null check (public_slug = lower(public_slug) and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'closed', 'archived')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  timezone text not null default 'Asia/Ho_Chi_Minh' check (timezone = 'Asia/Ho_Chi_Minh'),
  capacity_target integer check (capacity_target is null or capacity_target > 0),
  interview_required boolean not null default true,
  confirmation_deadline_days integer check (confirmation_deadline_days is null or confirmation_deadline_days > 0),
  eligibility_text text not null,
  privacy_notice text not null,
  consent_version text not null,
  success_message text not null,
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

create unique index if not exists recruitment_campaigns_public_slug_uniq
  on public.recruitment_campaigns (lower(public_slug));
create index if not exists recruitment_campaigns_scope_idx
  on public.recruitment_campaigns (program_id, season_id, intake_batch_id, applicant_role, status);

create or replace function public.validate_recruitment_campaign_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  v_season_program uuid;
  v_batch_season uuid;
begin
  select program_id into v_season_program from public.seasons where id = new.season_id;
  if v_season_program is distinct from new.program_id then
    raise exception 'CAMPAIGN_SCOPE_INVALID: season does not belong to program' using errcode = '23514';
  end if;
  select season_id into v_batch_season from public.intake_batches where id = new.intake_batch_id;
  if v_batch_season is distinct from new.season_id then
    raise exception 'CAMPAIGN_SCOPE_INVALID: intake batch does not belong to season' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_campaigns_scope_guard on public.recruitment_campaigns;
create trigger recruitment_campaigns_scope_guard
before insert or update of program_id, season_id, intake_batch_id
on public.recruitment_campaigns for each row execute function public.validate_recruitment_campaign_scope();

alter table public.applications
  add column if not exists recruitment_campaign_id uuid references public.recruitment_campaigns(id) on delete restrict,
  add column if not exists application_reference text,
  add column if not exists consent_version text,
  add column if not exists consented_at timestamptz;

create unique index if not exists applications_campaign_email_role_uniq
  on public.applications (recruitment_campaign_id, role_applied, lower(email_primary))
  where recruitment_campaign_id is not null and email_primary is not null;
create unique index if not exists applications_reference_uniq
  on public.applications (application_reference)
  where application_reference is not null;
create index if not exists applications_campaign_status_idx
  on public.applications (recruitment_campaign_id, status, submitted_at);

create or replace function public.validate_application_campaign_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  v_campaign public.recruitment_campaigns%rowtype;
begin
  if new.recruitment_campaign_id is null then return new; end if;
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

drop trigger if exists applications_campaign_scope_guard on public.applications;
create trigger applications_campaign_scope_guard
before insert or update of recruitment_campaign_id, season_id, intake_batch_id, role_applied
on public.applications for each row execute function public.validate_application_campaign_scope();

alter table public.recruitment_campaigns enable row level security;
drop policy if exists recruitment_campaigns_admin_read on public.recruitment_campaigns;
create policy recruitment_campaigns_admin_read on public.recruitment_campaigns
for select to authenticated using (public.is_admin_role(array['viewer','reviewer','support_team','core_team','admin','super_admin']));

-- No anon SELECT/INSERT policy is intentionally created. Public lookup and submit
-- must use guarded server code; service-role credentials never reach the browser.
-- Program-level write authorization remains mandatory in the server action even
-- when service role is used, because service role bypasses RLS.

commit;
