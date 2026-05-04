-- =============================================================================
-- Phase 044B: Interview self-claim workflow
-- =============================================================================
-- Safe additions only — no destructive changes, no column renames/drops.
-- Uses "add column if not exists" so this script is idempotent.
-- =============================================================================

-- Add claimed_at: timestamp when a reviewer self-claimed this interview review.
alter table public.application_reviews
  add column if not exists claimed_at timestamptz;

-- Add claim_source: distinguishes how a review row was created.
--   'self_claim'  — created via the /interviews self-claim page (Phase 044B).
--   'bulk_assign' — created via the /reviews/assign-bulk page (Phase 044A).
--   NULL          — legacy rows created before Phase 044B.
alter table public.application_reviews
  add column if not exists claim_source text;

-- Index for querying self-claimed interview reviews (e.g., audit reports).
create index if not exists idx_application_reviews_claim_source
  on public.application_reviews (claim_source)
  where claim_source is not null;

-- Document the new columns.
comment on column public.application_reviews.claimed_at is
  'Phase 044B: UTC timestamp when a reviewer self-claimed this review via /interviews.';
comment on column public.application_reviews.claim_source is
  'Phase 044B: "self_claim" = /interviews page | "bulk_assign" = /reviews/assign-bulk | NULL = legacy.';
