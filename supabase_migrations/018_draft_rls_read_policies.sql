-- VAM OS Sprint 1B - DRAFT RLS read policies.
-- REVIEW ONLY. DO NOT RUN UNTIL APPROVED.
-- This draft enables read-only RLS policies for Supabase Auth admin roles.
-- It does not add write policies and does not change table data.

-- ============================================================
-- Helper functions
-- Risk level: high
-- Test requirement:
--   - Test with unauthenticated, no-role, viewer, reviewer, admin, super_admin.
--   - Confirm inactive/suspended admin_users cannot read protected data.
-- Rollback note:
--   - Drop helper functions only after dropping policies that depend on them.
-- ============================================================

create or replace function public.current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select au.role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
  limit 1
$$;

comment on function public.current_admin_role() is
  'Returns the active VAM OS admin role for the current Supabase Auth user. SECURITY DEFINER is used so RLS policies can resolve the caller role without requiring direct broad read access to admin_users.';

create or replace function public.is_admin_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_admin_role() = any(required_roles), false)
$$;

comment on function public.is_admin_role(text[]) is
  'Checks whether current_admin_role() is included in required_roles. SECURITY DEFINER follows current_admin_role() so policy checks do not depend on direct admin_users table visibility.';

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.status = 'active'
  )
$$;

comment on function public.is_active_admin() is
  'Returns true when the current Supabase Auth user has an active admin_users row. SECURITY DEFINER is used for safe policy-level identity checks.';

-- ============================================================
-- Reference tables: programs, seasons, events
-- Risk level: low
-- Test requirement:
--   - Active admin roles can load dashboard/page reference data.
--   - Unauthenticated users cannot select rows.
-- Rollback note:
--   - Disable RLS for this batch first if reference data disappears.
-- ============================================================

alter table public.programs enable row level security;
drop policy if exists "read_programs_active_admins" on public.programs;
create policy "read_programs_active_admins"
on public.programs
for select
using (public.is_active_admin());

alter table public.seasons enable row level security;
drop policy if exists "read_seasons_active_admins" on public.seasons;
create policy "read_seasons_active_admins"
on public.seasons
for select
using (public.is_active_admin());

alter table public.events enable row level security;
drop policy if exists "read_events_active_admins" on public.events;
create policy "read_events_active_admins"
on public.events
for select
using (public.is_active_admin());

-- ============================================================
-- Core data: people, mentor_profiles, mentee_profiles, matches
-- Risk level: high for people/mentee_profiles, medium for mentor_profiles/matches
-- Test requirement:
--   - viewer, reviewer, admin, super_admin can load dashboard/profile pages.
--   - Unauthenticated users cannot select rows.
-- Rollback note:
--   - If Dashboard or People profile breaks, disable RLS on this batch.
-- ============================================================

alter table public.people enable row level security;
drop policy if exists "read_people_internal_roles" on public.people;
create policy "read_people_internal_roles"
on public.people
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

alter table public.mentor_profiles enable row level security;
drop policy if exists "read_mentor_profiles_internal_roles" on public.mentor_profiles;
create policy "read_mentor_profiles_internal_roles"
on public.mentor_profiles
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

alter table public.mentee_profiles enable row level security;
drop policy if exists "read_mentee_profiles_internal_roles" on public.mentee_profiles;
create policy "read_mentee_profiles_internal_roles"
on public.mentee_profiles
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

alter table public.matches enable row level security;
drop policy if exists "read_matches_internal_roles" on public.matches;
create policy "read_matches_internal_roles"
on public.matches
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

-- ============================================================
-- Applications
-- Risk level: high
-- Test requirement:
--   - reviewer, admin, super_admin can load Applications if approved.
--   - viewer should not read applications in this draft.
-- Rollback note:
--   - If Applications page is needed for viewer, revise policy before rollout.
-- Open decision:
--   - Decide later whether viewer can read applications.
-- ============================================================

alter table public.applications enable row level security;
drop policy if exists "read_applications_review_roles" on public.applications;
create policy "read_applications_review_roles"
on public.applications
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin']));

-- ============================================================
-- Activity tables: mentoring_recaps, event_participations
-- Risk level: medium
-- Test requirement:
--   - viewer, reviewer, admin, super_admin can load Operations Dashboard and profile activity.
--   - admin/super_admin correction pages can still read recap rows.
-- Rollback note:
--   - If Operations Dashboard breaks, disable RLS on activity batch.
-- ============================================================

alter table public.mentoring_recaps enable row level security;
drop policy if exists "read_mentoring_recaps_internal_roles" on public.mentoring_recaps;
create policy "read_mentoring_recaps_internal_roles"
on public.mentoring_recaps
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

alter table public.event_participations enable row level security;
drop policy if exists "read_event_participations_internal_roles" on public.event_participations;
create policy "read_event_participations_internal_roles"
on public.event_participations
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

-- ============================================================
-- Correction log
-- Risk level: high
-- Test requirement:
--   - reviewer, admin, super_admin can read correction logs if approved.
--   - viewer cannot read correction logs in this draft.
-- Rollback note:
--   - If recap edit page needs logs for admin and fails, revise or disable this policy.
-- ============================================================

alter table public.activity_correction_log enable row level security;
drop policy if exists "read_activity_correction_log_review_roles" on public.activity_correction_log;
create policy "read_activity_correction_log_review_roles"
on public.activity_correction_log
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin']));

-- ============================================================
-- Operational team assignments
-- Risk level: medium
-- Test requirement:
--   - viewer, reviewer, admin, super_admin can load operational assignment profile sections.
--   - Unauthenticated users cannot select rows.
-- Rollback note:
--   - If profile pages fail, disable this table policy and review access boundary.
-- ============================================================

alter table public.operational_team_assignments enable row level security;
drop policy if exists "read_operational_team_assignments_internal_roles" on public.operational_team_assignments;
create policy "read_operational_team_assignments_internal_roles"
on public.operational_team_assignments
for select
using (public.is_admin_role(array['viewer', 'reviewer', 'admin', 'super_admin']));

-- ============================================================
-- Admin users
-- Risk level: high
-- Test requirement:
--   - super_admin can read all admin_users rows.
--   - active user can read only their own admin_users row.
--   - viewer/reviewer/admin cannot read other users.
-- Rollback note:
--   - If login/role lookup breaks, review helper functions and admin_users policy.
-- ============================================================

alter table public.admin_users enable row level security;
drop policy if exists "read_admin_users_super_admin_or_self" on public.admin_users;
create policy "read_admin_users_super_admin_or_self"
on public.admin_users
for select
using (
  auth.uid() = auth_user_id
  or public.current_admin_role() = 'super_admin'
);

-- ============================================================
-- Rollback section - comments only, do not run by default
-- ============================================================

-- Draft only: inspect policies before rollback.
-- select schemaname, tablename, policyname, permissive, roles, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;

-- Draft only: drop read policies.
-- drop policy if exists "read_programs_active_admins" on public.programs;
-- drop policy if exists "read_seasons_active_admins" on public.seasons;
-- drop policy if exists "read_events_active_admins" on public.events;
-- drop policy if exists "read_people_internal_roles" on public.people;
-- drop policy if exists "read_mentor_profiles_internal_roles" on public.mentor_profiles;
-- drop policy if exists "read_mentee_profiles_internal_roles" on public.mentee_profiles;
-- drop policy if exists "read_matches_internal_roles" on public.matches;
-- drop policy if exists "read_applications_review_roles" on public.applications;
-- drop policy if exists "read_mentoring_recaps_internal_roles" on public.mentoring_recaps;
-- drop policy if exists "read_event_participations_internal_roles" on public.event_participations;
-- drop policy if exists "read_activity_correction_log_review_roles" on public.activity_correction_log;
-- drop policy if exists "read_operational_team_assignments_internal_roles" on public.operational_team_assignments;
-- drop policy if exists "read_admin_users_super_admin_or_self" on public.admin_users;

-- Draft only: disable RLS by table if a batch breaks production.
-- alter table public.programs disable row level security;
-- alter table public.seasons disable row level security;
-- alter table public.events disable row level security;
-- alter table public.people disable row level security;
-- alter table public.mentor_profiles disable row level security;
-- alter table public.mentee_profiles disable row level security;
-- alter table public.matches disable row level security;
-- alter table public.applications disable row level security;
-- alter table public.mentoring_recaps disable row level security;
-- alter table public.event_participations disable row level security;
-- alter table public.activity_correction_log disable row level security;
-- alter table public.operational_team_assignments disable row level security;
-- alter table public.admin_users disable row level security;

-- Draft only: drop helper functions after all dependent policies are removed.
-- drop function if exists public.is_admin_role(text[]);
-- drop function if exists public.is_active_admin();
-- drop function if exists public.current_admin_role();
