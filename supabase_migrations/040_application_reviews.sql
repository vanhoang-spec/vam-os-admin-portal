-- ============================================================
-- Migration 040 — Application review workflow foundation
--
-- Purpose: create public.application_reviews and extend the
-- applications.status CHECK constraint to cover all pipeline
-- statuses needed for the S12 screening → interview flow.
--
-- This migration does NOT:
--   - approve applications or create people/mentor_profiles
--   - create matching or email automation tables
--   - add INSERT policy — server actions use service-role
--
-- Idempotent: add column if not exists, on conflict do nothing,
-- drop constraint if exists before re-adding.
-- ============================================================

begin;

-- ----------------------------------------------------------------
-- 1. Create application_reviews table
-- ----------------------------------------------------------------

create table if not exists public.application_reviews (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null references public.applications(id) on delete cascade,
  review_round           text not null,
  reviewer_admin_user_id uuid references public.admin_users(id),
  reviewer_person_id     uuid,                     -- nullable, future use
  assigned_by            uuid references public.admin_users(id),
  assigned_at            timestamptz default now(),
  due_at                 timestamptz,
  status                 text not null default 'assigned',
  -- Scoring dimensions (1–5 each)
  score_motivation       integer,
  score_goal_clarity     integer,
  score_commitment       integer,
  score_fit              integer,
  score_communication    integer,
  -- Computed from scoring dimensions on submit
  total_score            integer,
  recommendation         text,
  reviewer_note          text,
  submitted_at           timestamptz,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),

  constraint application_reviews_review_round_check check (
    review_round in ('profile_screening', 'interview')
  ),
  constraint application_reviews_status_check check (
    status in (
      'assigned',
      'in_progress',
      'submitted',
      'returned_for_clarification',
      'cancelled'
    )
  ),
  constraint application_reviews_recommendation_check check (
    recommendation is null
    or recommendation in (
      'pass_to_interview',
      'waitlist',
      'reject',
      'needs_admin_review',
      'pass_orientation',
      'approve_recommended'
    )
  ),
  constraint application_reviews_score_motivation_check check (
    score_motivation is null or (score_motivation >= 1 and score_motivation <= 5)
  ),
  constraint application_reviews_score_goal_clarity_check check (
    score_goal_clarity is null or (score_goal_clarity >= 1 and score_goal_clarity <= 5)
  ),
  constraint application_reviews_score_commitment_check check (
    score_commitment is null or (score_commitment >= 1 and score_commitment <= 5)
  ),
  constraint application_reviews_score_fit_check check (
    score_fit is null or (score_fit >= 1 and score_fit <= 5)
  ),
  constraint application_reviews_score_communication_check check (
    score_communication is null or (score_communication >= 1 and score_communication <= 5)
  )
);

-- Indexes
create index if not exists application_reviews_application_idx
  on public.application_reviews (application_id);

create index if not exists application_reviews_reviewer_idx
  on public.application_reviews (reviewer_admin_user_id)
  where reviewer_admin_user_id is not null;

create index if not exists application_reviews_status_idx
  on public.application_reviews (status);

create index if not exists application_reviews_round_idx
  on public.application_reviews (review_round);

-- ----------------------------------------------------------------
-- 2. Extend applications.status CHECK constraint
--    Idempotent: drop then re-add. Previous version seeded by 038
--    already covers most statuses; this re-adds with all S12 values.
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
      'withdrawn'
    )
  );

-- ----------------------------------------------------------------
-- 3. RLS for application_reviews
--
-- READ: admin/core_team/super_admin can see all rows;
--       reviewer can see only rows assigned to them.
-- WRITE: service-role client (server actions) bypasses RLS — no
--        INSERT/UPDATE policy needed for the action layer.
-- ----------------------------------------------------------------

alter table public.application_reviews enable row level security;

drop policy if exists "application_reviews_read" on public.application_reviews;
create policy "application_reviews_read"
  on public.application_reviews
  for select
  using (
    -- admin tiers see everything
    public.is_admin_role(array['admin', 'super_admin', 'core_team'])
    -- reviewer sees only their own assigned reviews
    or (
      public.is_admin_role(array['reviewer'])
      and reviewer_admin_user_id = (
        select id from public.admin_users
        where auth_user_id = auth.uid()
          and status = 'active'
        limit 1
      )
    )
  );

commit;
