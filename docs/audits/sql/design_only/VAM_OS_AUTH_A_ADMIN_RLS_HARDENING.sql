-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- PRODUCTION AND STAGING MUTATION NOT AUTHORIZED
-- =============================================================================
-- VAM OS Auth Hardening — A: Admin & Business Table RLS
-- Prepared: 2026-07-29
-- Purpose: Re-enable RLS on tables disabled by migrations 023/025; enable RLS
--          on tables never protected; correct existing policy gaps.
-- Pre-requisites:
--   migration 017 (admin_users) applied
--   migration 018 (RLS read policies + helpers) applied
--   migration 020 (admin_scope_access RLS + helpers) applied
--   migrations 023, 025 are applied (mentoring_recaps/event_participations disabled)
--   migration 040 (application_reviews) applied
--   migration 041 (application_decisions) applied
--   migration 044a (review_assignment_batches) applied
--   migration 052 (person_season_memberships) applied
-- =============================================================================

-- --------------------------------------------------------------------------
-- A1. Re-enable RLS on mentoring_recaps
-- --------------------------------------------------------------------------
-- Migrations 023 and 025 explicitly disabled RLS on mentoring_recaps.
-- Migration 018 had created an RLS-enabled policy. Re-enabling RLS restores
-- the intended protection.
-- Risk: Operations Dashboard queries use service-role — unaffected.
--       Direct API callers will lose open access — INTENDED.
-- --------------------------------------------------------------------------

alter table public.mentoring_recaps enable row level security;

drop policy if exists "read_mentoring_recaps_internal_roles" on public.mentoring_recaps;
create policy "read_mentoring_recaps_internal_roles"
on public.mentoring_recaps
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin', 'core_team', 'support_team']));

-- --------------------------------------------------------------------------
-- A2. Re-enable RLS on event_participations
-- --------------------------------------------------------------------------
-- Same pattern as mentoring_recaps.
-- --------------------------------------------------------------------------

alter table public.event_participations enable row level security;

drop policy if exists "read_event_participations_internal_roles" on public.event_participations;
create policy "read_event_participations_internal_roles"
on public.event_participations
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin', 'core_team', 'support_team']));

-- --------------------------------------------------------------------------
-- A3. Enable RLS on admin_audit_log (super_admin only)
-- --------------------------------------------------------------------------
-- admin_audit_log has NO RLS in any applied migration. Any JWT holder can
-- SELECT all rows via direct Supabase REST API. Audit data includes before/after
-- JSONB blobs with role, status, and email information.
-- --------------------------------------------------------------------------

alter table public.admin_audit_log enable row level security;

drop policy if exists "read_admin_audit_log_super_admin_only" on public.admin_audit_log;
create policy "read_admin_audit_log_super_admin_only"
on public.admin_audit_log
for select
using (public.current_admin_role() = 'super_admin');

-- --------------------------------------------------------------------------
-- A4. Enable RLS on person_season_memberships (viewer+ SELECT)
-- --------------------------------------------------------------------------
-- Migration 052 created this table with explicitly NO RLS.
-- Membership data (role, season, program per person) is operational PII.
-- --------------------------------------------------------------------------

alter table public.person_season_memberships enable row level security;

drop policy if exists "read_person_season_memberships_internal_roles" on public.person_season_memberships;
create policy "read_person_season_memberships_internal_roles"
on public.person_season_memberships
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin', 'core_team', 'support_team']));

-- --------------------------------------------------------------------------
-- A5. Enable RLS on person_season_membership_log (super_admin only)
-- --------------------------------------------------------------------------
-- Append-only audit log for membership state changes. Super_admin only.
-- --------------------------------------------------------------------------

alter table public.person_season_membership_log enable row level security;

drop policy if exists "read_person_season_membership_log_super_admin" on public.person_season_membership_log;
create policy "read_person_season_membership_log_super_admin"
on public.person_season_membership_log
for select
using (public.current_admin_role() = 'super_admin');

-- --------------------------------------------------------------------------
-- A6. Enable RLS on event_links and event_registrations
-- --------------------------------------------------------------------------
-- Migration 057 was DESIGN ONLY and never applied. event_links contains
-- registration tokens (sensitive); event_registrations contains registrant data.
-- Scope: admin+ (reviewer and above) can read.
-- --------------------------------------------------------------------------

alter table public.event_links enable row level security;

drop policy if exists "read_event_links_admin_roles" on public.event_links;
create policy "read_event_links_admin_roles"
on public.event_links
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin', 'core_team']));

alter table public.event_registrations enable row level security;

drop policy if exists "read_event_registrations_admin_roles" on public.event_registrations;
create policy "read_event_registrations_admin_roles"
on public.event_registrations
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin', 'core_team', 'support_team']));

-- --------------------------------------------------------------------------
-- A7. Correct applications policy — add core_team
-- --------------------------------------------------------------------------
-- The existing policy from migration 018 excludes core_team. In the app,
-- core_team has canDecide() = true for applications. The RLS policy should match.
-- Migration 038 may also have an applications policy. Drop and recreate.
-- --------------------------------------------------------------------------

drop policy if exists "read_applications_review_roles" on public.applications;
create policy "read_applications_review_roles"
on public.applications
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin', 'core_team']));

-- --------------------------------------------------------------------------
-- A8. Enable RLS on crm_notes (viewer+ SELECT)
-- --------------------------------------------------------------------------
-- CRM notes contain admin-authored notes about participants. Should be
-- restricted to internal admin roles.
-- --------------------------------------------------------------------------

alter table public.crm_notes enable row level security;

drop policy if exists "read_crm_notes_internal_roles" on public.crm_notes;
create policy "read_crm_notes_internal_roles"
on public.crm_notes
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin', 'core_team', 'support_team']));

-- --------------------------------------------------------------------------
-- A9. Add action_type constraint to admin_audit_log
-- --------------------------------------------------------------------------
-- Prevents non-canonical action type strings in the audit log.
-- NOTE: Only add this constraint if the existing data has no non-canonical strings.
-- Run this verification query first (READ ONLY — do not skip):
--   SELECT DISTINCT action_type FROM public.admin_audit_log;
-- If any unexpected value appears, add it to the constraint or backfill first.
-- --------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_audit_log_action_type_check'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_action_type_check
      check (action_type in (
        'create_admin_user',
        'update_admin_user',
        'remove_admin_access',
        'reactivate_admin_user',
        'deactivate_admin_user',
        'sync_auth'
      ));
  end if;
end;
$$;

-- =============================================================================
-- ROLLBACK — run to undo this migration (if needed):
-- =============================================================================
-- alter table public.mentoring_recaps disable row level security;
-- alter table public.event_participations disable row level security;
-- alter table public.admin_audit_log disable row level security;
-- alter table public.person_season_memberships disable row level security;
-- alter table public.person_season_membership_log disable row level security;
-- alter table public.event_links disable row level security;
-- alter table public.event_registrations disable row level security;
-- alter table public.crm_notes disable row level security;
-- drop policy if exists "read_mentoring_recaps_internal_roles" on public.mentoring_recaps;
-- drop policy if exists "read_event_participations_internal_roles" on public.event_participations;
-- drop policy if exists "read_admin_audit_log_super_admin_only" on public.admin_audit_log;
-- drop policy if exists "read_person_season_memberships_internal_roles" on public.person_season_memberships;
-- drop policy if exists "read_person_season_membership_log_super_admin" on public.person_season_membership_log;
-- drop policy if exists "read_event_links_admin_roles" on public.event_links;
-- drop policy if exists "read_event_registrations_admin_roles" on public.event_registrations;
-- drop policy if exists "read_crm_notes_internal_roles" on public.crm_notes;
-- Restore original applications policy (excluding core_team):
-- drop policy if exists "read_applications_review_roles" on public.applications;
-- create policy "read_applications_review_roles" on public.applications
--   for select using (public.is_admin_role(array['reviewer', 'admin', 'super_admin']));
-- alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_type_check;
-- =============================================================================
