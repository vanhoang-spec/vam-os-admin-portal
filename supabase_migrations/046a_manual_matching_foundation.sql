-- Migration 046A: Manual Matching Foundation
-- Adds Phase 046A columns to the existing matches table to support
-- batch-aware manual mentor–mentee matching for Season 12.
-- All changes are additive (ADD COLUMN IF NOT EXISTS) — S11 legacy rows
-- are preserved and unaffected.

-- ── New columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS mentor_profile_id  uuid REFERENCES public.mentor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentee_profile_id  uuid REFERENCES public.mentee_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intake_batch_id    uuid REFERENCES public.intake_batches(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_source       text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS matched_by         uuid REFERENCES public.admin_users(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_at         timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at           timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason         text,
  ADD COLUMN IF NOT EXISTS admin_notes        text;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS matches_mentor_profile_id_idx
  ON public.matches (mentor_profile_id)
  WHERE mentor_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_mentee_profile_id_idx
  ON public.matches (mentee_profile_id)
  WHERE mentee_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_intake_batch_id_idx
  ON public.matches (intake_batch_id)
  WHERE intake_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_status_idx
  ON public.matches (status);

-- ── Partial unique index: one active match per mentee_profile ─────────────────
-- Enforces the "one mentee → one active mentor" business rule at DB level.
-- Legacy S11 rows have mentee_profile_id = NULL and are excluded by the
-- WHERE clause, so they never conflict with each other or with S12 rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'matches'
      AND indexname = 'matches_mentee_profile_active_uniq'
  ) THEN
    CREATE UNIQUE INDEX matches_mentee_profile_active_uniq
      ON public.matches (mentee_profile_id)
      WHERE status = 'active'
        AND mentee_profile_id IS NOT NULL;
  END IF;
END
$$;
