-- ============================================================
-- Migration 038 — Season 12 intake foundation  (patched v2)
--
-- Purpose: minimum schema needed for the native pilot application
-- forms (/apply/mentor, /apply/mentee) for Season 12 Batch 1.
--
-- Patch v2 vs v1 (which failed in production with
--   "ERROR: 42703: column email_primary does not exist"):
--   v1 only added 7 columns but the dedup index immediately
--   referenced email_primary (never in the legacy schema).
--   v2 adds ALL required columns — including the contact/identity
--   columns full_name, email_primary, phone_primary, gender —
--   BEFORE any constraint or index that references them.
--   Indexes are now partial (WHERE ... IS NOT NULL) so legacy rows
--   with NULL values in new columns are excluded and never cause
--   expression errors.
--
-- This migration does NOT touch:
--   - public.action_items
--   - public.action_item_comments
--   - public.application_reviews
--   - public.mentor_match_preferences
--   - applications.final_status         (legacy column, kept untouched)
--   - applications.consent_pdpa         (legacy column, kept untouched)
--   - applications.consent_pdpa_at      (legacy column, kept untouched)
--   - applications.submitted_at         (legacy date column, kept untouched)
--   - applications.sbd                  (legacy column, kept untouched)
--   - applications.acquisition_channel  (legacy column, kept untouched)
--   - mentor_profiles / mentee_profiles / matches schema
--   - people
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
-- 1. applications: add ALL columns required by the pilot intake
--    form and the admin pipeline.
--
--    ORDER MATTERS: every column must exist before any constraint
--    or index expression that references it.
-- ----------------------------------------------------------------

-- Contact / identity columns (absent from legacy schema)
alter table public.applications
  add column if not exists full_name text;

alter table public.applications
  add column if not exists email_primary text;

alter table public.applications
  add column if not exists phone_primary text;

alter table public.applications
  add column if not exists gender text;

-- Batch linkage (references intake_batches which must already exist)
alter table public.applications
  add column if not exists intake_batch_id uuid references public.intake_batches(id);

-- Pipeline status — coexists with legacy final_status column
alter table public.applications
  add column if not exists status text default 'submitted';

-- Unstructured form payload — NOT NULL safe because default covers
-- every existing legacy row immediately on column creation
alter table public.applications
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

-- Consent for personal-data storage (distinct from legacy consent_pdpa)
alter table public.applications
  add column if not exists consent_data_storage boolean not null default false;

-- Attribution / submission source
alter table public.applications
  add column if not exists source text default 'manual';

-- Scoring
alter table public.applications
  add column if not exists score_total integer;

alter table public.applications
  add column if not exists score_breakdown jsonb default '{}'::jsonb;

-- Internal reviewer notes
alter table public.applications
  add column if not exists internal_notes jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------
-- 2. Status CHECK constraint
--    Only safe to add now that the status column exists above.
--    Drop first so re-runs don't fail; idempotent.
-- ----------------------------------------------------------------

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

-- ----------------------------------------------------------------
-- 3. Indexes
--    Both created AFTER their referenced columns exist (above).
--    Both are partial (WHERE ... IS NOT NULL) so legacy rows with
--    NULL values in new columns are skipped entirely — no expression
--    error, no false uniqueness blocks.
-- ----------------------------------------------------------------

-- Duplicate-check index used by the form action on every submit.
-- Partial on email_primary IS NOT NULL so legacy rows are excluded.
create index if not exists applications_dedup_idx
  on public.applications (intake_batch_id, role_applied, lower(email_primary))
  where email_primary is not null;

-- Admin /applications list filter index.
-- Partial on status IS NOT NULL so legacy rows without status are excluded.
create index if not exists applications_status_idx
  on public.applications (status)
  where status is not null;

-- ----------------------------------------------------------------
-- 4. Seed Season 12 (UEHM-S12) — only if not already present
-- ----------------------------------------------------------------

insert into public.seasons (code, name, status, program_id)
select 'UEHM-S12', 'UEH Mentoring Season 12', 'running', p.id
from public.programs p
where p.code = 'UEHM'
on conflict (code) do nothing;

-- ----------------------------------------------------------------
-- 5. Seed Intake Batch UEHM-S12-B1 — only if not already present
-- ----------------------------------------------------------------

insert into public.intake_batches (season_id, code, name, is_active)
select s.id, 'UEHM-S12-B1', 'Season 12 — Batch 1 (Pilot intake)', true
from public.seasons s
where s.code = 'UEHM-S12'
on conflict (season_id, code) do nothing;

-- ----------------------------------------------------------------
-- 6. RLS posture for applications (extend existing read policy from
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
