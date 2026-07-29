-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- PRODUCTION AND STAGING MUTATION NOT AUTHORIZED
-- =============================================================================
-- VAM OS Auth Hardening — Rollback Design
-- Prepared: 2026-07-29
-- Purpose: Rollback statements for all Auth hardening files (A, B, C, D).
--          Apply in REVERSE ORDER: D → C → B → A.
--          Never apply this file in whole — cherry-pick only the section
--          corresponding to the migration being rolled back.
-- =============================================================================

-- =============================================================================
-- ROLLBACK D — Grants / Function Hardening
-- =============================================================================
-- Restore anon EXECUTE on all revoked functions.
-- Run this BEFORE rollback C (if C was applied).
-- =============================================================================

-- grant execute on function public.current_admin_role() to anon, public;
-- grant execute on function public.is_admin_role(text[]) to anon, public;
-- grant execute on function public.is_active_admin() to anon, public;
-- grant execute on function public.current_admin_context() to anon, public;
-- grant execute on function public.admin_can_access_season(text) to anon, public;
-- grant execute on function public.current_person_id() to anon, public;      -- if C applied
-- grant execute on function public.get_operations_dashboard_data() to anon, public;
-- grant execute on function public.get_mentor_profile_data_by_id(text) to anon, public;

-- =============================================================================
-- ROLLBACK C — Participant RLS Policies
-- =============================================================================
-- Drop all participant policies and the current_person_id helper.
-- Does NOT re-disable RLS on any table (that would be done in rollback A).
-- =============================================================================

-- drop function if exists public.current_person_id();
-- drop policy if exists "participant_read_own_person" on public.people;
-- drop policy if exists "participant_read_own_mentor_profile" on public.mentor_profiles;
-- drop policy if exists "participant_read_own_mentee_profile" on public.mentee_profiles;
-- drop policy if exists "participant_read_own_matches" on public.matches;
-- drop policy if exists "participant_read_own_recaps" on public.mentoring_recaps;
-- drop policy if exists "participant_read_own_event_participations" on public.event_participations;
-- drop policy if exists "participant_read_own_application" on public.applications;
-- drop policy if exists "participant_read_own_memberships" on public.person_season_memberships;
-- drop policy if exists "participant_read_own_event_registration" on public.event_registrations;
-- drop policy if exists "participant_read_programs" on public.programs;
-- drop policy if exists "participant_read_seasons" on public.seasons;
-- drop policy if exists "participant_read_events" on public.events;
-- drop policy if exists "participant_read_own_mentor_program_participations" on public.mentor_program_participations;

-- =============================================================================
-- ROLLBACK B — people.auth_user_id column
-- =============================================================================
-- Remove column and index.
-- WARNING: If any participant auth accounts have been created and linked,
-- dropping this column loses all linkage data. Run:
--   SELECT count(*) FROM public.people WHERE auth_user_id IS NOT NULL;
-- before proceeding. If count > 0, DO NOT drop the column.
-- =============================================================================

-- drop index if exists public.people_auth_user_id_unique_idx;
-- alter table public.people drop column if exists auth_user_id;

-- =============================================================================
-- ROLLBACK A — Admin & Business Table RLS
-- =============================================================================
-- Restore the state before migration A was applied.
-- Sections can be run independently for targeted rollback.
-- =============================================================================

-- Section A1: Re-disable mentoring_recaps RLS
-- (restores migrations 023/025 state — INTENTIONALLY UNPROTECTED)
-- alter table public.mentoring_recaps disable row level security;
-- drop policy if exists "read_mentoring_recaps_internal_roles" on public.mentoring_recaps;

-- Section A2: Re-disable event_participations RLS
-- alter table public.event_participations disable row level security;
-- drop policy if exists "read_event_participations_internal_roles" on public.event_participations;

-- Section A3: Remove admin_audit_log RLS
-- alter table public.admin_audit_log disable row level security;
-- drop policy if exists "read_admin_audit_log_super_admin_only" on public.admin_audit_log;

-- Section A4: Remove person_season_memberships RLS
-- alter table public.person_season_memberships disable row level security;
-- drop policy if exists "read_person_season_memberships_internal_roles" on public.person_season_memberships;

-- Section A5: Remove person_season_membership_log RLS
-- alter table public.person_season_membership_log disable row level security;
-- drop policy if exists "read_person_season_membership_log_super_admin" on public.person_season_membership_log;

-- Section A6: Remove event_links and event_registrations RLS
-- alter table public.event_links disable row level security;
-- drop policy if exists "read_event_links_admin_roles" on public.event_links;
-- alter table public.event_registrations disable row level security;
-- drop policy if exists "read_event_registrations_admin_roles" on public.event_registrations;

-- Section A7: Restore applications policy (remove core_team)
-- drop policy if exists "read_applications_review_roles" on public.applications;
-- create policy "read_applications_review_roles"
-- on public.applications for select
-- using (public.is_admin_role(array['reviewer', 'admin', 'super_admin']));

-- Section A8: Remove crm_notes RLS
-- alter table public.crm_notes disable row level security;
-- drop policy if exists "read_crm_notes_internal_roles" on public.crm_notes;

-- Section A9: Remove admin_audit_log action_type constraint
-- alter table public.admin_audit_log
--   drop constraint if exists admin_audit_log_action_type_check;

-- =============================================================================
-- POST-ROLLBACK VERIFICATION (read-only)
-- =============================================================================
-- Run to verify rollback completeness:
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;
-- (mentoring_recaps and event_participations should show rowsecurity = false)
--
-- select schemaname, tablename, policyname
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
-- (should not list any policies from Auth hardening files)
-- =============================================================================
