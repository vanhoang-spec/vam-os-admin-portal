-- ============================================================
-- Migration 041 — Application decision workflow
--
-- Purpose:
--   1. Extend applications.status CHECK constraint to include
--      'needs_more_review' (the only value missing from 040).
--   2. Create public.application_decisions audit table so every
--      admin/core-team status change is traceable.
--
-- This migration does NOT:
--   - create or modify people / mentor_profiles / mentee_profiles
--   - build final approval, matching, or email automation
--   - change any schema from migrations 038 or 040
--
-- Idempotent: constraint uses drop-if-exists + add; table uses
-- create-if-not-exists; indexes use create-if-not-exists; RLS
-- policy uses drop-if-exists + create.
-- ============================================================

begin;

-- ----------------------------------------------------------------
-- 1. Extend applications.status CHECK constraint
--    Adds 'needs_more_review' to the set allowed by migration 040.
--    All other statuses from 038 / 040 are preserved verbatim.
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
      'screening_in_progress',
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
      'needs_more_review',
      'withdrawn'
    )
  );

-- ----------------------------------------------------------------
-- 2. Create application_decisions audit table
--
-- Records every admin/core-team decision that moves an application
-- through the pipeline. Uses a denormalised decided_by_name column
-- so reads don't require a join against admin_users (which has
-- restrictive RLS).
-- ----------------------------------------------------------------

create table if not exists public.application_decisions (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references public.applications(id) on delete cascade,
  decided_by       uuid references public.admin_users(id),
  decided_by_name  text,
  decision         text not null,
  previous_status  text,
  new_status       text not null,
  decision_note    text,
  created_at       timestamptz default now()
);

-- Indexes
create index if not exists application_decisions_application_idx
  on public.application_decisions (application_id);

create index if not exists application_decisions_decided_by_idx
  on public.application_decisions (decided_by)
  where decided_by is not null;

create index if not exists application_decisions_created_at_idx
  on public.application_decisions (created_at desc);

-- ----------------------------------------------------------------
-- 3. RLS for application_decisions
--
-- READ: admin tiers + reviewer can see all decisions (transparency).
-- WRITE: service-role server actions bypass RLS — no INSERT/UPDATE
--        policy needed at the SQL layer.
-- ----------------------------------------------------------------

alter table public.application_decisions enable row level security;

drop policy if exists "application_decisions_read" on public.application_decisions;
create policy "application_decisions_read"
  on public.application_decisions
  for select
  using (
    public.is_admin_role(array['admin', 'super_admin', 'core_team', 'reviewer'])
  );

commit;
