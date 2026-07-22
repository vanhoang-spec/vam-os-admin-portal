-- DESIGN ONLY — NOT APPLIED — OWNER AUTHORIZATION REQUIRED.
-- Rollback is safe only before campaign-backed applications exist.
begin;

do $$
begin
  if exists (select 1 from public.applications where recruitment_campaign_id is not null) then
    raise exception 'ROLLBACK_BLOCKED: campaign-backed applications exist; preserve history and use forward repair';
  end if;
end;
$$;

drop trigger if exists applications_campaign_scope_guard on public.applications;
drop function if exists public.validate_application_campaign_scope();
drop index if exists public.applications_campaign_status_idx;
drop index if exists public.applications_reference_uniq;
drop index if exists public.applications_campaign_email_role_uniq;
alter table public.applications
  drop column if exists consented_at,
  drop column if exists consent_version,
  drop column if exists application_reference,
  drop column if exists recruitment_campaign_id;

drop trigger if exists recruitment_campaigns_scope_guard on public.recruitment_campaigns;
drop function if exists public.validate_recruitment_campaign_scope();
drop table if exists public.recruitment_campaigns;

commit;
