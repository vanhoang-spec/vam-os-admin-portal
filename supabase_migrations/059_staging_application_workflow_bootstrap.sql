-- ============================================================
-- Migration 059 — Staging application workflow bootstrap
-- ============================================================
--
-- Purpose: create all application workflow objects on the staging
-- environment (ljfneyuvpxrmejpxsmpz) where they are absent.
-- Staging has 30+ existing tables but is missing the five
-- application workflow tables and their two enums.
--
-- Objects created (in dependency order):
--   1. public.role_type          (enum — pre-012 legacy enum)
--   2. public.application_status (enum — pre-012 legacy enum)
--   3. public.applications       (pre-012 base table, 28 cols)
--   4. public.application_answers (pre-012 base table, 6 cols)
--   5. public.application_reviews (migration 040 + 044a + 044b)
--   6. public.application_decisions (migration 041)
--   7. public.review_assignment_batches (migration 044a)
--   8. application_reviews.assignment_batch_id FK (migration 044a)
--   9. application_reviews claim columns/index (migration 044b)
--
-- applications.status CHECK uses the FINAL 20-value list including
-- interview_in_progress (owner decision 2026-07-21).
-- Migration 060 aligns production to this same 20-value list.
--
-- Does NOT:
--   - INSERT, UPDATE, or DELETE any data
--   - DROP any existing table
--   - ALTER mentor_profiles, mentee_profiles, matches, admin_audit_log
--   - install migration 057 (security hardening) content
--   - install any S11 seed or dashboard content
--   - create an applications trigger
--   - enable RLS on applications (kept disabled, per production)
--   - enable RLS on application_answers (kept disabled, no policy)
--
-- Abort conditions:
--   - Any of the five target tables already exists (OBJECT_CONFLICT)
--   - An enum exists but has incompatible values (ENUM_SCHEMA_CONFLICT)
--   - A dependency (people, seasons, intake_batches, admin_users) is absent
--
-- Dependencies that must exist on staging before this migration:
--   public.people
--   public.seasons
--   public.intake_batches
--   public.admin_users
--   public.is_admin_role(text[])  (created by migration 017)
--
-- Authorization phrase: AUTHORIZE STAGING APPLICATION BOOTSTRAP MIGRATION
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 0: PREFLIGHT — Object conflict detection
-- ============================================================
-- Abort immediately if any target table already exists.
-- This migration must only run on a database where all five tables
-- are absent. If any is present, inspect for compatibility before
-- proceeding manually.

DO $$
DECLARE
  v_conflict text;
BEGIN
  SELECT c.relname INTO v_conflict
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'applications',
      'application_answers',
      'application_reviews',
      'application_decisions',
      'review_assignment_batches'
    )
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'OBJECT_CONFLICT: public.% already exists. '
      'Migration 059 is designed for a staging environment where all five '
      'application workflow tables are absent. '
      'Inspect the existing table for compatibility before proceeding.',
      v_conflict;
  END IF;
END;
$$;

-- Verify required dependencies exist.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT t INTO v_missing FROM (
    VALUES ('people'), ('seasons'), ('intake_batches'), ('admin_users')
  ) AS required(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = required.t
  )
  LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'DEPENDENCY_MISSING: public.% not found. '
      'Migration 059 requires people, seasons, intake_batches, and admin_users '
      'to already exist on staging.',
      v_missing;
  END IF;
END;
$$;

-- ============================================================
-- PHASE 1: ENUMS
-- ============================================================

-- ── 1a. public.role_type ─────────────────────────────────────
-- Expected values (7, in order):
--   mentor, mentee, supporter, speaker, partner_contact, donor, admin
-- Create if absent. Abort (ENUM_SCHEMA_CONFLICT) if present with
-- different values or different order.

DO $$
DECLARE
  v_expected text[] := ARRAY[
    'mentor', 'mentee', 'supporter', 'speaker',
    'partner_contact', 'donor', 'admin'
  ];
  v_actual   text[];
  v_type_oid oid;
BEGIN
  SELECT t.oid INTO v_type_oid
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = 'role_type'
    AND t.typtype = 'e';

  IF v_type_oid IS NULL THEN
    CREATE TYPE public.role_type AS ENUM (
      'mentor', 'mentee', 'supporter', 'speaker',
      'partner_contact', 'donor', 'admin'
    );
    RAISE NOTICE 'public.role_type created.';
  ELSE
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO v_actual
    FROM pg_enum e
    WHERE e.enumtypid = v_type_oid;

    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION
        'ENUM_SCHEMA_CONFLICT: public.role_type exists but has incompatible values or order. '
        'Expected: %. Found: %. '
        'Do not alter the existing enum — resolve the conflict manually before re-running.',
        v_expected, v_actual;
    END IF;
    RAISE NOTICE 'public.role_type already exists and is compatible — skipped.';
  END IF;
END;
$$;

-- ── 1b. public.application_status ────────────────────────────
-- Expected values (5, in order):
--   accepted, rejected_or_pending, rejected, pending, withdrawn
-- Legacy enum used only by applications.final_status column.
-- Create if absent. Abort if present with incompatible values.

DO $$
DECLARE
  v_expected text[] := ARRAY[
    'accepted', 'rejected_or_pending', 'rejected', 'pending', 'withdrawn'
  ];
  v_actual   text[];
  v_type_oid oid;
BEGIN
  SELECT t.oid INTO v_type_oid
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = 'application_status'
    AND t.typtype = 'e';

  IF v_type_oid IS NULL THEN
    CREATE TYPE public.application_status AS ENUM (
      'accepted', 'rejected_or_pending', 'rejected', 'pending', 'withdrawn'
    );
    RAISE NOTICE 'public.application_status created.';
  ELSE
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO v_actual
    FROM pg_enum e
    WHERE e.enumtypid = v_type_oid;

    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION
        'ENUM_SCHEMA_CONFLICT: public.application_status exists but has incompatible values or order. '
        'Expected: %. Found: %. '
        'Do not alter the existing enum — resolve the conflict manually before re-running.',
        v_expected, v_actual;
    END IF;
    RAISE NOTICE 'public.application_status already exists and is compatible — skipped.';
  END IF;
END;
$$;

-- ============================================================
-- PHASE 2: public.applications (pre-012 base table, 28 columns)
-- ============================================================
-- Reproduces the production schema exactly as provided by owner
-- on 2026-07-21.
--
-- Differences from current production metadata (intentional):
--   applications_status_check includes 'interview_in_progress'
--   as the 12th value (20 values total vs 19 in production).
--   Migration 060 aligns production to this same 20-value list.
--
-- Constraints included:
--   PK, UNIQUE (legacy_application_temp_id),
--   FK person_id → people(id) DEFERRABLE INITIALLY DEFERRED,
--   FK season_id → seasons(id) DEFERRABLE INITIALLY DEFERRED,
--   FK intake_batch_id → intake_batches(id),
--   applications_status_check (20 values)
--
-- RLS: DISABLED (matches production — no ALTER TABLE ENABLE ROW LEVEL SECURITY)
-- Trigger: none (per owner — no non-internal triggers in production)

CREATE TABLE public.applications (
  id                         uuid        NOT NULL DEFAULT gen_random_uuid(),
  legacy_application_temp_id text,
  person_id                  uuid,
  season_id                  uuid,
  role_applied               public.role_type,
  submitted_at               date,
  sbd                        text,
  consent_pdpa               boolean,
  consent_pdpa_at            timestamptz,
  acquisition_channel        text,
  final_status               public.application_status,
  profile_url                text,
  source_sheet               text,
  source_row_id              integer,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  full_name                  text,
  email_primary              text,
  phone_primary              text,
  gender                     text,
  intake_batch_id            uuid,
  status                     text        DEFAULT 'submitted',
  raw_payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  consent_data_storage       boolean     NOT NULL DEFAULT false,
  source                     text        DEFAULT 'manual',
  score_total                integer,
  score_breakdown            jsonb       DEFAULT '{}'::jsonb,
  internal_notes             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT applications_pkey
    PRIMARY KEY (id),

  CONSTRAINT applications_legacy_application_temp_id_key
    UNIQUE (legacy_application_temp_id),

  -- person_id → people(id): deferred FK so bulk inserts can set person_id
  -- in a follow-up statement within the same transaction.
  CONSTRAINT applications_person_id_fkey
    FOREIGN KEY (person_id)
    REFERENCES public.people(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  -- season_id → seasons(id): deferred FK mirrors production behaviour.
  CONSTRAINT applications_season_id_fkey
    FOREIGN KEY (season_id)
    REFERENCES public.seasons(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT applications_intake_batch_id_fkey
    FOREIGN KEY (intake_batch_id)
    REFERENCES public.intake_batches(id),

  -- FINAL 20-value status constraint.
  -- interview_in_progress added per owner decision 2026-07-21.
  -- See migration 060 for the corresponding production alignment.
  CONSTRAINT applications_status_check CHECK (
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
  )
);

-- Indexes (from production)
-- Duplicate-submission guard used by the public intake form action.
CREATE INDEX applications_dedup_idx
  ON public.applications (intake_batch_id, role_applied, lower(email_primary))
  WHERE email_primary IS NOT NULL;

-- Fast pipeline status filter used by the /applications admin page.
CREATE INDEX applications_status_idx
  ON public.applications (status)
  WHERE status IS NOT NULL;

-- Legacy final_status filter (S11 rows).
CREATE INDEX idx_applications_final_status
  ON public.applications (final_status);

-- Legacy temp-id lookup (data-import tooling).
CREATE INDEX idx_applications_legacy_application_temp_id
  ON public.applications (legacy_application_temp_id);

-- Season-scoped filter used by getScopedIntakeBatchIds.
CREATE INDEX idx_applications_season_id
  ON public.applications (season_id);

-- RLS: disabled (new tables have RLS off by default — no ENABLE needed).
-- The production SELECT policy is created below for completeness,
-- but it is not enforced while RLS remains disabled.

-- Policy: create only if public.is_admin_role(text[]) is present
-- with the expected text[] argument signature.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_admin_role'
      AND pg_get_function_arguments(p.oid) = 'roles text[]'
  ) THEN
    DROP POLICY IF EXISTS "read_applications_review_roles" ON public.applications;
    EXECUTE $pol$
      CREATE POLICY "read_applications_review_roles"
        ON public.applications
        FOR SELECT
        USING (
          public.is_admin_role(
            ARRAY['reviewer'::text, 'admin'::text, 'super_admin'::text]
          )
        )
    $pol$;
    RAISE NOTICE 'Policy read_applications_review_roles created on public.applications.';
  ELSE
    RAISE WARNING
      'public.is_admin_role(text[]) not found — '
      'read_applications_review_roles policy skipped. '
      'RLS is disabled on applications so this does not affect access control.';
  END IF;
END;
$$;

-- ============================================================
-- PHASE 3: public.application_answers (pre-012 base table, 6 cols)
-- ============================================================
-- Stores structured answers from the intake form.
-- application_id is nullable in production (legacy rows without link).
--
-- RLS: disabled (matches production — no policy exists on production).

CREATE TABLE public.application_answers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  application_id uuid,
  question_key   text,
  question_label text,
  value_text     text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT application_answers_pkey
    PRIMARY KEY (id),

  CONSTRAINT application_answers_application_id_fkey
    FOREIGN KEY (application_id)
    REFERENCES public.applications(id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

-- ============================================================
-- PHASE 4: public.application_reviews
-- ============================================================
-- Full schema from migration 040, plus:
--   assignment_batch_id  (migration 044a — column only; FK added in Phase 7
--                         after review_assignment_batches is created)
--   claimed_at           (migration 044b)
--   claim_source         (migration 044b)
--
-- RLS: enabled (from migration 040).
-- Policy: application_reviews_read (from migration 040).

CREATE TABLE public.application_reviews (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         uuid        NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  review_round           text        NOT NULL,
  reviewer_admin_user_id uuid        REFERENCES public.admin_users(id),
  reviewer_person_id     uuid,
  assigned_by            uuid        REFERENCES public.admin_users(id),
  assigned_at            timestamptz DEFAULT now(),
  due_at                 timestamptz,
  status                 text        NOT NULL DEFAULT 'assigned',
  score_motivation       integer,
  score_goal_clarity     integer,
  score_commitment       integer,
  score_fit              integer,
  score_communication    integer,
  total_score            integer,
  recommendation         text,
  reviewer_note          text,
  submitted_at           timestamptz,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  -- Migration 044a: FK added after review_assignment_batches is created (Phase 7).
  assignment_batch_id    uuid,
  -- Migration 044b: self-claim tracking columns.
  claimed_at             timestamptz,
  claim_source           text,

  CONSTRAINT application_reviews_review_round_check CHECK (
    review_round IN ('profile_screening', 'interview')
  ),
  CONSTRAINT application_reviews_status_check CHECK (
    status IN (
      'assigned',
      'in_progress',
      'submitted',
      'returned_for_clarification',
      'cancelled'
    )
  ),
  CONSTRAINT application_reviews_recommendation_check CHECK (
    recommendation IS NULL OR recommendation IN (
      'pass_to_interview',
      'waitlist',
      'reject',
      'needs_admin_review',
      'pass_orientation',
      'approve_recommended'
    )
  ),
  CONSTRAINT application_reviews_score_motivation_check CHECK (
    score_motivation IS NULL OR (score_motivation >= 1 AND score_motivation <= 5)
  ),
  CONSTRAINT application_reviews_score_goal_clarity_check CHECK (
    score_goal_clarity IS NULL OR (score_goal_clarity >= 1 AND score_goal_clarity <= 5)
  ),
  CONSTRAINT application_reviews_score_commitment_check CHECK (
    score_commitment IS NULL OR (score_commitment >= 1 AND score_commitment <= 5)
  ),
  CONSTRAINT application_reviews_score_fit_check CHECK (
    score_fit IS NULL OR (score_fit >= 1 AND score_fit <= 5)
  ),
  CONSTRAINT application_reviews_score_communication_check CHECK (
    score_communication IS NULL OR (score_communication >= 1 AND score_communication <= 5)
  )
);

-- Indexes from migration 040
CREATE INDEX application_reviews_application_idx
  ON public.application_reviews (application_id);

CREATE INDEX application_reviews_reviewer_idx
  ON public.application_reviews (reviewer_admin_user_id)
  WHERE reviewer_admin_user_id IS NOT NULL;

CREATE INDEX application_reviews_status_idx
  ON public.application_reviews (status);

CREATE INDEX application_reviews_round_idx
  ON public.application_reviews (review_round);

-- RLS from migration 040
ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "application_reviews_read" ON public.application_reviews;
CREATE POLICY "application_reviews_read"
  ON public.application_reviews
  FOR SELECT
  USING (
    public.is_admin_role(ARRAY['admin', 'super_admin', 'core_team'])
    OR (
      public.is_admin_role(ARRAY['reviewer'])
      AND reviewer_admin_user_id = (
        SELECT id FROM public.admin_users
        WHERE auth_user_id = auth.uid()
          AND status = 'active'
        LIMIT 1
      )
    )
  );

-- ============================================================
-- PHASE 5: public.application_decisions
-- ============================================================
-- Audit table for every admin status decision (from migration 041).
-- decided_by_name is denormalised to avoid a join against admin_users.
--
-- RLS: enabled. Policy: application_decisions_read.

CREATE TABLE public.application_decisions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid        NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  decided_by      uuid        REFERENCES public.admin_users(id),
  decided_by_name text,
  decision        text        NOT NULL,
  previous_status text,
  new_status      text        NOT NULL,
  decision_note   text,
  created_at      timestamptz DEFAULT now()
);

-- Indexes from migration 041
CREATE INDEX application_decisions_application_idx
  ON public.application_decisions (application_id);

CREATE INDEX application_decisions_decided_by_idx
  ON public.application_decisions (decided_by)
  WHERE decided_by IS NOT NULL;

CREATE INDEX application_decisions_created_at_idx
  ON public.application_decisions (created_at DESC);

-- RLS from migration 041
ALTER TABLE public.application_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "application_decisions_read" ON public.application_decisions;
CREATE POLICY "application_decisions_read"
  ON public.application_decisions
  FOR SELECT
  USING (
    public.is_admin_role(ARRAY['admin', 'super_admin', 'core_team', 'reviewer'])
  );

-- ============================================================
-- PHASE 6: public.review_assignment_batches
-- ============================================================
-- One audit row per bulk-assignment operation (from migration 044a).
-- Must be created BEFORE the FK on application_reviews.assignment_batch_id
-- (added in Phase 7).
--
-- RLS: enabled. Policy: review_assignment_batches_read.

CREATE TABLE public.review_assignment_batches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_batch_id   uuid        REFERENCES public.intake_batches(id),
  review_round      text        NOT NULL DEFAULT 'profile_screening',
  created_by        uuid        REFERENCES public.admin_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  due_at            timestamptz,
  assignment_note   text,
  application_count integer,
  reviewer_count    integer,

  CONSTRAINT review_assignment_batches_round_check CHECK (
    review_round IN ('profile_screening', 'interview')
  )
);

-- Indexes from migration 044a
CREATE INDEX review_assignment_batches_intake_batch_idx
  ON public.review_assignment_batches (intake_batch_id)
  WHERE intake_batch_id IS NOT NULL;

CREATE INDEX review_assignment_batches_created_at_idx
  ON public.review_assignment_batches (created_at DESC);

CREATE INDEX review_assignment_batches_created_by_idx
  ON public.review_assignment_batches (created_by)
  WHERE created_by IS NOT NULL;

-- RLS from migration 044a
ALTER TABLE public.review_assignment_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_assignment_batches_read" ON public.review_assignment_batches;
CREATE POLICY "review_assignment_batches_read"
  ON public.review_assignment_batches
  FOR SELECT
  USING (
    public.is_admin_role(ARRAY['admin', 'super_admin', 'core_team'])
  );

-- ============================================================
-- PHASE 7: application_reviews.assignment_batch_id FK + indexes
-- ============================================================
-- review_assignment_batches now exists; add the FK and indexes
-- from migration 044a, and the 044b index and column comments.

ALTER TABLE public.application_reviews
  ADD CONSTRAINT application_reviews_assignment_batch_id_fkey
  FOREIGN KEY (assignment_batch_id)
  REFERENCES public.review_assignment_batches(id);

-- Index from migration 044a
CREATE INDEX application_reviews_assignment_batch_idx
  ON public.application_reviews (assignment_batch_id)
  WHERE assignment_batch_id IS NOT NULL;

-- Index from migration 044b
CREATE INDEX idx_application_reviews_claim_source
  ON public.application_reviews (claim_source)
  WHERE claim_source IS NOT NULL;

-- Column comments from migration 044b
COMMENT ON COLUMN public.application_reviews.claimed_at IS
  'Phase 044B: UTC timestamp when a reviewer self-claimed this review via /interviews.';
COMMENT ON COLUMN public.application_reviews.claim_source IS
  'Phase 044B: "self_claim" = /interviews page | "bulk_assign" = /reviews/assign-bulk | NULL = legacy.';

COMMIT;
