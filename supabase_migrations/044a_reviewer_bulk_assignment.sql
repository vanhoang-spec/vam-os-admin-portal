-- ============================================================
-- Migration 044a — Reviewer bulk assignment infrastructure
--
-- Purpose:
--   1. Create public.review_assignment_batches — one audit row
--      per bulk-assignment operation (one click on the admin UI).
--      Lets admins track when/who assigned which batch.
--   2. Add assignment_batch_id FK column to application_reviews
--      so individual review rows can be traced back to the batch
--      that created them.
--
-- Does NOT:
--   - change scoring / recommendation columns
--   - alter applications, people, mentor/mentee_profiles schema
--   - create any new RLS policies for reviewers
--
-- Idempotent: create-if-not-exists, add-column-if-not-exists,
-- create-index-if-not-exists. Safe to re-run.
--
-- Dependencies:
--   - public.intake_batches   (036_mentor_taxonomy_and_programs)
--   - public.admin_users      (017_create_admin_users_and_roles)
--   - public.application_reviews (040_application_reviews)
-- ============================================================

begin;

-- -----------------------------------------------------------------------
-- 1. review_assignment_batches
--    Must be created BEFORE the FK column on application_reviews.
-- -----------------------------------------------------------------------

create table if not exists public.review_assignment_batches (
  id                uuid primary key default gen_random_uuid(),
  intake_batch_id   uuid references public.intake_batches(id),
  review_round      text not null default 'profile_screening',
  created_by        uuid references public.admin_users(id),
  created_at        timestamptz not null default now(),
  due_at            timestamptz,
  assignment_note   text,
  application_count integer,
  reviewer_count    integer,
  constraint review_assignment_batches_round_check check (
    review_round in ('profile_screening', 'interview')
  )
);

create index if not exists review_assignment_batches_intake_batch_idx
  on public.review_assignment_batches(intake_batch_id)
  where intake_batch_id is not null;

create index if not exists review_assignment_batches_created_at_idx
  on public.review_assignment_batches(created_at desc);

create index if not exists review_assignment_batches_created_by_idx
  on public.review_assignment_batches(created_by)
  where created_by is not null;

-- -----------------------------------------------------------------------
-- 2. application_reviews — add assignment_batch_id FK column
-- -----------------------------------------------------------------------

alter table public.application_reviews
  add column if not exists assignment_batch_id uuid
    references public.review_assignment_batches(id);

create index if not exists application_reviews_assignment_batch_idx
  on public.application_reviews(assignment_batch_id)
  where assignment_batch_id is not null;

-- -----------------------------------------------------------------------
-- 3. RLS for review_assignment_batches
--    Admin tiers can read all rows. Service-role server actions bypass RLS.
-- -----------------------------------------------------------------------

alter table public.review_assignment_batches enable row level security;

drop policy if exists "review_assignment_batches_read" on public.review_assignment_batches;
create policy "review_assignment_batches_read"
  on public.review_assignment_batches
  for select
  using (
    public.is_admin_role(array['admin', 'super_admin', 'core_team'])
  );

commit;
