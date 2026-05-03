-- ============================================================
-- Migration 038 — Season 12 intake foundation
--
-- Purpose: minimum schema needed for the native pilot application
-- forms (/apply/mentor, /apply/mentee) for Season 12 Batch 1.
--
-- This migration does NOT touch:
--   - public.action_items
--   - public.action_item_comments
--   - any Phase 4 workflow tables
--   - applications.final_status (legacy column kept untouched)
--   - applications.consent_pdpa (legacy column kept untouched)
--   - mentor_profiles / mentee_profiles / matches schema
--   - admin_users role enum
--
-- Idempotent: every DDL uses `if not exists` / `on conflict do nothing`.
-- Safe to re-run.
--
-- Dependencies (must already exist in production):
--   - public.applications        (predates migration history)
--   - public.seasons             (predates migration history)
--   - public.intake_batches      (created in 036_mentor_taxonomy_and_programs)
--   - public.programs            (created in 036_mentor_taxonomy_and_programs)
--   - UEHM program row           (seeded in 036)
-- ============================================================

begin;

-- ----------------------------------------------------------------
-- 1. applications: add columns needed by the pilot intake form
-- ----------------------------------------------------------------

alter table public.applications
  add column if not exists intake_batch_id uuid references public.intake_batches(id);

alter table public.applications
  add column if not exists status text default 'submitted';

alter table public.applications
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

alter table public.applications
  add column if not exists consent_data_storage boolean not null default false;

alter table public.applications
  add column if not exists score_total int;

alter table public.applications
  add column if not exists internal_notes jsonb not null default '{}'::jsonb;

alter table public.applications
  add column if not exists source text;

-- Status CHECK constraint covering every status the S12 pipeline uses.
-- Drop first so re-runs don't fail; idempotent.
alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check check (
    status is null
    or status in (
      'submitted',
      'under_data_check',
      'ready_for_screening',
      'screening_assigned',
      'screening_completed',
      'screening_passed',
      'invited_to_meeting',
      'invited_to_orientation',
      'invited_to_interview',
      'interview_scheduled',
      'interview_completed',
      'interview_passed',
      'approved_as_mentor',
      'approved_as_mentee',
      'waitlisted',
      'rejected_or_not_fit',
      'withdrawn'
    )
  );

-- Helpful index for the duplicate check the form action runs on every submit.
create index if not exists applications_dedup_idx
  on public.applications (intake_batch_id, role_applied, lower(email_primary));

-- Index for admin /applications list filters.
create index if not exists applications_status_idx
  on public.applications (status);

-- ----------------------------------------------------------------
-- 2. Seed Season 12 (UEHM-S12) — only if not already present
-- ----------------------------------------------------------------

insert into public.seasons (code, name, status, program_id)
select 'UEHM-S12', 'UEH Mentoring Season 12', 'active', p.id
from public.programs p
where p.code = 'UEHM'
on conflict (code) do nothing;

-- ----------------------------------------------------------------
-- 3. Seed Intake Batch UEHM-S12-B1 — only if not already present
-- ----------------------------------------------------------------

insert into public.intake_batches (season_id, code, name, is_active)
select s.id, 'UEHM-S12-B1', 'Season 12 — Batch 1 (Pilot intake)', true
from public.seasons s
where s.code = 'UEHM-S12'
on conflict (season_id, code) do nothing;

-- ----------------------------------------------------------------
-- 4. RLS posture for applications (extend existing read policy from
--    migration 018; do NOT add INSERT policy — pilot form action uses
--    the service-role client server-side and bypasses RLS.)
-- ----------------------------------------------------------------

-- Re-assert the existing read policy if 018 was applied (idempotent).
-- If 018 was not applied, this just creates the policy fresh.
drop policy if exists "read_applications_review_roles" on public.applications;
create policy "read_applications_review_roles"
on public.applications
for select
using (public.is_admin_role(array['reviewer', 'admin', 'super_admin']));

commit;
