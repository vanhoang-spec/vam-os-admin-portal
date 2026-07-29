-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- PRODUCTION AND STAGING MUTATION NOT AUTHORIZED
-- =============================================================================
-- VAM OS Auth Hardening — C: Participant RLS Policies
-- Prepared: 2026-07-29
-- Purpose: Add participant self-read policies for when participant login is
--          introduced. Participants are auth.users whose auth.uid() maps to
--          public.people.auth_user_id.
-- Pre-requisites (MUST be applied before this file):
--   VAM_OS_AUTH_B_PEOPLE_AUTH_LINKAGE.sql applied (people.auth_user_id exists)
--   VAM_OS_AUTH_A_ADMIN_RLS_HARDENING.sql applied (RLS enabled on all tables)
--   VAM_OS_AUTH_D_GRANTS_FUNCTION_HARDENING.sql applied (revokes in place)
-- Owner decisions needed (see VAM_OS_AUTH_OWNER_DECISIONS_2026-07-29.md):
--   P1 — mentor profile update fields
--   P2 — mentee profile update fields
--   P3-P6 — match visibility, cross-participant visibility, event access
-- =============================================================================

-- --------------------------------------------------------------------------
-- C0. DEFER NOTICE
-- --------------------------------------------------------------------------
-- This file is DRAFT ONLY and DEFERRED until participant login is being built.
-- The policies in this file MUST NOT be applied to production or staging until:
--   1. people.auth_user_id linkage is live and populated for participants.
--   2. The participant login portal exists and can be tested.
--   3. Owner decisions P1-P6 are made.
--   4. All participant-facing pages use the correct client (anon-bearer, not service-role).
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- C1. current_person_id() — SECURITY DEFINER helper
-- --------------------------------------------------------------------------
-- Returns the public.people.id for the currently authenticated participant.
-- Returns NULL for:
--   - anon callers (no auth.uid())
--   - admin callers not in people table
--   - authenticated users whose auth.uid() is not yet linked to a people row
-- --------------------------------------------------------------------------

create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.people
  where auth_user_id = auth.uid()
  limit 1
$$;

comment on function public.current_person_id() is
  'Returns the people.id for the current Supabase Auth participant user.
   Returns NULL for anon, admin callers, or unlinked auth users.
   SECURITY DEFINER so RLS policies can resolve participant identity without
   requiring direct read access to the people table.';

-- Revoke from anon/public (applied in VAM_OS_AUTH_D_GRANTS_FUNCTION_HARDENING.sql).
-- Listed here for documentation — actual REVOKE is in file D.
-- revoke execute on function public.current_person_id() from anon, public;
-- grant execute on function public.current_person_id() to authenticated;

-- --------------------------------------------------------------------------
-- C2. people — participant self-read
-- --------------------------------------------------------------------------
-- Adds a participant branch to the existing admin policy (from migration 018).
-- Two PERMISSIVE policies combine via OR:
--   (1) read_people_internal_roles: admin tiers [from migration 018]
--   (2) participant_read_own_person (NEW): own row via auth_user_id
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_person" on public.people;
create policy "participant_read_own_person"
on public.people
for select
using (
  auth.uid() is not null
  and auth_user_id = auth.uid()
);

-- --------------------------------------------------------------------------
-- C3. mentor_profiles — participant self-read
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_mentor_profile" on public.mentor_profiles;
create policy "participant_read_own_mentor_profile"
on public.mentor_profiles
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C4. mentee_profiles — participant self-read
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_mentee_profile" on public.mentee_profiles;
create policy "participant_read_own_mentee_profile"
on public.mentee_profiles
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C5. matches — participant read own match(es)
-- --------------------------------------------------------------------------
-- A participant sees matches where they are the mentor OR the mentee.
-- Requires indexes on mentor_profiles.person_id and mentee_profiles.person_id.
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_matches" on public.matches;
create policy "participant_read_own_matches"
on public.matches
for select
using (
  public.current_person_id() is not null
  and (
    mentor_profile_id in (
      select id from public.mentor_profiles
      where person_id = public.current_person_id()
    )
    or mentee_profile_id in (
      select id from public.mentee_profiles
      where person_id = public.current_person_id()
    )
  )
);

-- --------------------------------------------------------------------------
-- C6. mentoring_recaps — participant reads recaps for own match(es)
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_recaps" on public.mentoring_recaps;
create policy "participant_read_own_recaps"
on public.mentoring_recaps
for select
using (
  public.current_person_id() is not null
  and match_id in (
    select id from public.matches
    where
      mentor_profile_id in (
        select id from public.mentor_profiles
        where person_id = public.current_person_id()
      )
      or mentee_profile_id in (
        select id from public.mentee_profiles
        where person_id = public.current_person_id()
      )
  )
);

-- --------------------------------------------------------------------------
-- C7. event_participations — participant reads own participations
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_event_participations" on public.event_participations;
create policy "participant_read_own_event_participations"
on public.event_participations
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C8. applications — participant reads own application
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_application" on public.applications;
create policy "participant_read_own_application"
on public.applications
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C9. person_season_memberships — participant reads own memberships
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_memberships" on public.person_season_memberships;
create policy "participant_read_own_memberships"
on public.person_season_memberships
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C10. event_registrations — participant reads own registration
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_event_registration" on public.event_registrations;
create policy "participant_read_own_event_registration"
on public.event_registrations
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- --------------------------------------------------------------------------
-- C11. Reference data — participants can read programs, seasons, events
-- --------------------------------------------------------------------------
-- Participants need reference data to display program/season context.
-- Add a participant branch to existing policies.
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_programs" on public.programs;
create policy "participant_read_programs"
on public.programs
for select
using (
  public.current_person_id() is not null
);

drop policy if exists "participant_read_seasons" on public.seasons;
create policy "participant_read_seasons"
on public.seasons
for select
using (
  public.current_person_id() is not null
);

drop policy if exists "participant_read_events" on public.events;
create policy "participant_read_events"
on public.events
for select
using (
  public.current_person_id() is not null
);

-- --------------------------------------------------------------------------
-- C12. mentor_program_participations — participant reads own
-- --------------------------------------------------------------------------

drop policy if exists "participant_read_own_mentor_program_participations" on public.mentor_program_participations;
create policy "participant_read_own_mentor_program_participations"
on public.mentor_program_participations
for select
using (
  public.current_person_id() is not null
  and person_id = public.current_person_id()
);

-- =============================================================================
-- ROLLBACK — run to undo this file:
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
