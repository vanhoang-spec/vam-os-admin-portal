-- ============================================================
-- Migration 060 — Align application status CHECK: interview_in_progress
-- ============================================================
--
-- Purpose: add 'interview_in_progress' to the
-- public.applications.status CHECK constraint (applications_status_check)
-- on any database where public.applications already exists.
--
-- This migration is independently usable on:
--   - Production (qkkroesfiazsejkzflcd): primary target.
--     Production currently has 19 allowed values; this adds the 20th.
--   - Staging (ljfneyuvpxrmejpxsmpz): safe to apply after migration 059.
--     Migration 059 creates applications with the 20-value constraint,
--     so this migration detects interview_in_progress is already present
--     and exits without making any change (idempotent no-op).
--
-- Background:
--   lib/interview-claim.ts line 193 writes 'interview_in_progress' to
--   applications.status as part of the Phase 044B interview self-claim
--   workflow. The value is used by the /interviews page and several
--   client-side status filters. The production CHECK constraint did not
--   include this value (CODE_SCHEMA_STATUS_MISMATCH, detected 2026-07-21).
--   Owner decision 2026-07-21: the schema must be aligned to the code
--   contract; 'interview_in_progress' is an intended pipeline status.
--
-- Does NOT:
--   - alter any application row data
--   - modify final_status, the legacy enums, or any legacy column
--   - enable or modify RLS
--   - modify indexes
--   - modify any other constraint
--   - modify any other table
--
-- ── LOCK IMPLICATIONS ──────────────────────────────────────────────
-- Dropping and recreating a CHECK constraint on public.applications
-- requires an ACCESS EXCLUSIVE lock on the table.
--
-- On production:
--   - The lock blocks all concurrent reads and writes on the table
--     for the duration of the constraint replacement.
--   - PostgreSQL must scan all existing rows to verify they satisfy
--     the new constraint (no row can have a status value removed from
--     the old constraint — only a new value is added — so the scan
--     will always succeed).
--   - For tables with O(thousands) of application rows, the scan is
--     effectively instant (sub-second).
--   - The lock is released as soon as COMMIT completes.
--   - If any concurrent session holds a long-running transaction that
--     has touched public.applications, this migration will queue behind
--     it. Execute during a low-traffic window.
--
-- ── ROLLBACK BEHAVIOUR ────────────────────────────────────────────
-- This migration is fully transactional. If the transaction rolls back
-- (connection loss, manual ROLLBACK, or an exception), the constraint
-- reverts exactly to its state before BEGIN. No partial schema change
-- is possible.
--
-- ── PREFLIGHT CHECKS ──────────────────────────────────────────────
-- 1. public.applications must exist and have a text status column.
-- 2. applications_status_check must exist.
-- 3. If interview_in_progress is already in the constraint → no-op.
-- 4. All 19 other expected production values must be present in the
--    existing constraint. If any are missing, the migration aborts
--    rather than silently overwriting a diverged constraint.
--
-- Authorization phrase for production: AUTHORIZE PRODUCTION INTERVIEW STATUS ALIGNMENT
-- ============================================================

BEGIN;

DO $$
DECLARE
  -- The 19 values currently in the production CHECK (not including
  -- the value being added). All must be present before proceeding.
  v_production_values text[] := ARRAY[
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
  ];
  v_existing_def text;
  v_check_value  text;
BEGIN

  -- ── PREFLIGHT 1: table exists ─────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'applications'
      AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT_FAILED: public.applications does not exist on this database. '
      'Migration 060 requires applications to already exist '
      '(apply migration 059 first on staging, or use on production directly).';
  END IF;

  -- ── PREFLIGHT 2: status column is text ───────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'applications'
      AND column_name  = 'status'
      AND data_type    = 'text'
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT_FAILED: public.applications.status does not exist or is not type text. '
      'Manual inspection required.';
  END IF;

  -- ── PREFLIGHT 3: constraint exists ────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname   = 'applications_status_check'
      AND conrelid  = 'public.applications'::regclass
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT_FAILED: applications_status_check constraint not found on public.applications. '
      'The constraint may have been renamed or removed. Manual intervention required.';
  END IF;

  -- ── Load existing constraint definition ───────────────────
  SELECT pg_get_constraintdef(oid) INTO v_existing_def
  FROM pg_constraint
  WHERE conname  = 'applications_status_check'
    AND conrelid = 'public.applications'::regclass;

  -- ── PREFLIGHT 4: idempotent check ─────────────────────────
  -- If interview_in_progress is already present, exit cleanly.
  IF v_existing_def LIKE '%interview_in_progress%' THEN
    RAISE NOTICE
      'interview_in_progress is already present in applications_status_check. '
      'No change needed — migration 060 complete (no-op).';
    RETURN;
  END IF;

  -- ── PREFLIGHT 5: all expected production values present ───
  -- Verify that the existing constraint contains every value that
  -- the production constraint is known to have. If any is missing,
  -- the constraint has diverged unexpectedly and we must not
  -- silently overwrite it.
  FOREACH v_check_value IN ARRAY v_production_values
  LOOP
    IF v_existing_def NOT LIKE '%' || v_check_value || '%' THEN
      RAISE EXCEPTION
        'PREFLIGHT_FAILED: applications_status_check is missing expected value ''%''. '
        'The constraint has diverged from the known production state. '
        'Existing definition: % '
        'Expected values: % '
        'Inspect manually before re-running migration 060.',
        v_check_value, v_existing_def, v_production_values;
    END IF;
  END LOOP;

  -- ── All preflights passed ─────────────────────────────────
  -- Replace the CHECK constraint with the final 20-value list.
  -- ACCESS EXCLUSIVE lock is acquired here and held until COMMIT.

  ALTER TABLE public.applications
    DROP CONSTRAINT applications_status_check;

  ALTER TABLE public.applications
    ADD CONSTRAINT applications_status_check CHECK (
      status IS NULL OR status IN (
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
        'interview_in_progress',
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

  RAISE NOTICE
    'applications_status_check updated. '
    'interview_in_progress added as the 12th allowed value (20 total). '
    'lib/interview-claim.ts line 193 status write is now schema-compatible.';

END;
$$;

COMMIT;
