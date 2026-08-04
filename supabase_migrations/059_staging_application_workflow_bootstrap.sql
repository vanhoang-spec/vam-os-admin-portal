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
-- interview_in_progress (owner decision 2026-07-21). That list is already
-- final here, so migration 060 is unnecessary after this migration and is
-- deliberately NOT bundled, referenced, or required as a follow-on. The same
-- applies to migration 061, which is design-only and blocked, and to
-- migration 038, which is permanently excluded because it references a
-- season column that does not exist.
--
-- ============================================================
-- SECURITY CONTRACT (PHASE 8, applied before COMMIT)
-- ============================================================
-- The application workflow is server-only. Every legitimate read and write of
-- all five tables already happens server-side under service_role: see
-- lib/applications-create.ts, lib/application-approvals.ts,
-- lib/application-decisions.ts, lib/application-reviews.ts,
-- lib/bulk-assignment.ts, lib/interview-claim.ts, lib/portfolio.ts and the
-- server-only accessors in lib/data.ts. No direct anon or authenticated table
-- access is required by any code path.
--
-- ONE uniform contract therefore applies to all five tables — applications,
-- application_answers, application_reviews, application_decisions and
-- review_assignment_batches:
--
--   * ROW LEVEL SECURITY enabled and FORCED
--   * zero policies — no policy of any kind is created on any of them
--   * REVOKE ALL from PUBLIC, anon and authenticated
--   * GRANT exactly SELECT, INSERT, UPDATE, DELETE to service_role
--   * no TRUNCATE, REFERENCES, TRIGGER, ownership or schema-management grant
--   * every client role fails closed
--
-- applications and application_answers hold applicant PII (full name, email,
-- phone, gender, free-text answers); application_reviews additionally holds
-- reviewer scoring and notes. Creating any of them without an explicit
-- privilege contract would leave them exposed through the ambient Supabase
-- default privileges that grant newly created public tables to anon and
-- authenticated.
--
-- FORCE ROW LEVEL SECURITY subjects the table owner to policies too, so it is
-- only safe where the owner keeps out-of-band access. Phase 0 therefore
-- aborts unless both the migration owner and service_role carry BYPASSRLS,
-- which is what preserves postgres/table-owner behaviour unchanged.
--
-- This supersedes the migration 040/041/044a policy design for the three
-- review workflow tables. The application_reviews_read,
-- application_decisions_read and review_assignment_batches_read policies are
-- deliberately NOT created, and authenticated keeps no SELECT privilege on
-- those tables. Consequently this migration has no dependency on
-- public.is_admin_role(text[]) at all — that helper is neither required,
-- created nor replaced here.
--
-- Does NOT:
--   - INSERT, UPDATE, or DELETE any data
--   - DROP any existing table
--   - ALTER mentor_profiles, mentee_profiles, matches, admin_audit_log
--   - install migration 057 (security hardening) content
--   - install any S11 seed or dashboard content
--   - create an applications trigger
--   - create any policy on any of the five tables
--   - grant TRUNCATE, or any privilege at all to PUBLIC, anon or authenticated
--     on any of the five tables
--   - depend on, create or replace public.is_admin_role
--   - introduce a SECURITY DEFINER helper of any kind
--
-- Abort conditions:
--   - Any of the five target tables already exists (OBJECT_CONFLICT)
--   - An enum exists but has incompatible values (ENUM_SCHEMA_CONFLICT)
--   - A dependency (people, seasons, intake_batches, admin_users) is absent
--     (DEPENDENCY_MISSING)
--   - A foreign-key target column lacks an eligible unique index
--     (FK_TARGET_NOT_UNIQUE)
--   - anon, authenticated or service_role does not exist (ROLE_MISSING)
--   - the owner or service_role lacks BYPASSRLS (RLS_FORCE_UNSAFE)
--   - a policy exists on any of the five tables at COMMIT time
--     (POLICY_CONFLICT)
--   - the final privilege contract is not exactly as declared
--     (GRANT_CONTRACT_VIOLATION / RLS_CONTRACT_VIOLATION)
--
-- Dependencies that must exist on staging before this migration:
--   public.people
--   public.seasons
--   public.intake_batches
--   public.admin_users
-- Each must carry an eligible unique index on its id column; see the
-- FK_TARGET_NOT_UNIQUE guard in PHASE 0 for the exact rule.
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

-- Every foreign-key target column must be backed by an index PostgreSQL will
-- accept as a foreign-key target.
--
-- This is the catalog rule PostgreSQL itself applies (transformFkeyCheckAttrs
-- scans pg_index, not pg_constraint): a unique, valid, ready, immediate index
-- whose single key column is the referenced column, with no partial predicate
-- and no expression key. Primary-key and UNIQUE-constraint indexes qualify
-- through exactly the same rule, so no separate constraint check is needed —
-- and a bare CREATE UNIQUE INDEX, which produces no pg_constraint row at all,
-- is correctly accepted.
--
-- Only the FIRST key column is compared and indnkeyatts must be 1, so a
-- composite index cannot qualify on the strength of containing the column.
-- INCLUDE columns live beyond indnkeyatts and are therefore ignored, which is
-- correct: they are not part of the key.
DO $$
DECLARE
  v_target text;
BEGIN
  SELECT t INTO v_target FROM (
    VALUES ('people'), ('seasons'), ('intake_batches'), ('admin_users')
  ) AS required(t)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attname = 'id'
     AND a.attnum > 0
     AND NOT a.attisdropped
    WHERE i.indrelid = to_regclass('public.' || required.t)
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indimmediate
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND (string_to_array(i.indkey::text, ' ')::smallint[])[1] = a.attnum
  )
  LIMIT 1;

  IF v_target IS NOT NULL THEN
    RAISE EXCEPTION
      'FK_TARGET_NOT_UNIQUE: public.%.id has no unique, valid, ready, '
      'immediate, single-column, non-partial, non-expression index. '
      'Migration 059 declares a foreign key against it, which PostgreSQL '
      'will refuse without one.',
      v_target;
  END IF;
END;
$$;

-- Verify the privilege contract in PHASE 8 can actually be established.
DO $$
DECLARE
  v_role text;
BEGIN
  SELECT r INTO v_role FROM (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ) AS required(r)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = required.r)
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLE_MISSING: role % does not exist. '
      'Migration 059 must be able to revoke from anon/authenticated and '
      'grant to service_role explicitly.',
      v_role;
  END IF;

  -- FORCE ROW LEVEL SECURITY applies policies to the table owner as well.
  -- With zero policies on all five tables that would deny the owner and
  -- service_role entirely, unless both bypass RLS. Both do on Supabase.
  -- Abort rather than silently locking anyone out: this precondition is what
  -- keeps postgres/table-owner behaviour unchanged under FORCE.
  IF NOT COALESCE(
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false
  ) THEN
    RAISE EXCEPTION
      'RLS_FORCE_UNSAFE: migration owner % lacks BYPASSRLS. '
      'Migration 059 forces row level security on all five application '
      'workflow tables; without BYPASSRLS the owner would lose access.',
      current_user;
  END IF;

  IF NOT COALESCE(
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'), false
  ) THEN
    RAISE EXCEPTION
      'RLS_FORCE_UNSAFE: service_role lacks BYPASSRLS. '
      'Migration 059 grants service_role the only access to the five '
      'application workflow tables, which carry no policies; without '
      'BYPASSRLS every '
      'server-side read and write would return or affect zero rows.';
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
--   The list is already final here; no follow-on migration is required.
--
-- Constraints included:
--   PK, UNIQUE (legacy_application_temp_id),
--   FK person_id → people(id) DEFERRABLE INITIALLY DEFERRED,
--   FK season_id → seasons(id) DEFERRABLE INITIALLY DEFERRED,
--   FK intake_batch_id → intake_batches(id),
--   applications_status_check (20 values)
--
-- RLS: ENABLED and FORCED in PHASE 8, with zero policies and no
--      PUBLIC/anon/authenticated privilege. See the SECURITY CONTRACT header.
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
  -- Already final; no follow-on alignment migration is bundled or required.
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

-- No policy is created on public.applications. The production-era
-- read_applications_review_roles policy is deliberately omitted: it granted
-- direct SELECT to any authenticated reviewer/admin/super_admin JWT, which is
-- exactly the direct-API path this table must not expose. Applicant PII is
-- read server-side under service_role only. RLS is enabled and forced in
-- PHASE 8 with zero policies, so every non-bypassing role is denied.

-- ============================================================
-- PHASE 3: public.application_answers (pre-012 base table, 6 cols)
-- ============================================================
-- Stores structured answers from the intake form.
-- application_id is nullable in production (legacy rows without link).
--
-- RLS: ENABLED and FORCED in PHASE 8, with zero policies and no
--      PUBLIC/anon/authenticated privilege. See the SECURITY CONTRACT header.

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

-- RLS is enabled and forced for this table in PHASE 8, with zero policies.
-- The migration 040 application_reviews_read policy is deliberately NOT
-- created: it granted direct SELECT to authenticated reviewer/admin JWTs,
-- which the server-only contract removes. Reviewer scoping is enforced by the
-- server accessors in lib/data.ts, not by a table policy.

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

-- RLS is enabled and forced for this table in PHASE 8, with zero policies.
-- The migration 041 application_decisions_read policy is deliberately NOT
-- created, for the same server-only reason as application_reviews above.

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

-- RLS is enabled and forced for this table in PHASE 8, with zero policies.
-- The migration 044a review_assignment_batches_read policy is deliberately
-- NOT created, for the same server-only reason as application_reviews above.

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

-- ============================================================
-- PHASE 8: EXPLICIT SECURITY CONTRACT
-- ============================================================
-- Everything above created objects. Nothing above granted or revoked
-- anything, so at this point all five tables still carry only whatever the
-- ambient Supabase default privileges attached at CREATE TABLE time — which
-- on a stock project includes anon and authenticated. This phase replaces
-- that inherited posture with an explicit, deny-by-default one and then
-- proves the result before COMMIT.

-- ── 8a. one uniform contract for all five tables ───
-- Deny-by-default: RLS on, RLS forced, zero policies, no privilege at all for
-- PUBLIC/anon/authenticated, and exactly the four DML privileges for
-- service_role. TRUNCATE, REFERENCES and TRIGGER are deliberately excluded,
-- as is every ownership and schema-management privilege.

ALTER TABLE public.applications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications              FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.application_answers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_answers       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.application_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_reviews       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.application_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_decisions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.review_assignment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_assignment_batches FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.applications, public.application_answers,
                    public.application_reviews, public.application_decisions,
                    public.review_assignment_batches
  FROM PUBLIC;
REVOKE ALL ON TABLE public.applications, public.application_answers,
                    public.application_reviews, public.application_decisions,
                    public.review_assignment_batches
  FROM anon;
REVOKE ALL ON TABLE public.applications, public.application_answers,
                    public.application_reviews, public.application_decisions,
                    public.review_assignment_batches
  FROM authenticated;
REVOKE ALL ON TABLE public.applications, public.application_answers,
                    public.application_reviews, public.application_decisions,
                    public.review_assignment_batches
  FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.applications, public.application_answers,
           public.application_reviews, public.application_decisions,
           public.review_assignment_batches
  TO service_role;

-- ── 8c. fail-closed proof of the contract, inside the transaction ──
-- If any assertion below fails the whole migration rolls back, so the tables
-- can never be committed in a weaker state than declared.

-- No policy may exist on any of the five tables.
DO $$
DECLARE
  v_policy text;
BEGIN
  SELECT p.policyname INTO v_policy
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN ('applications', 'application_answers',
                        'application_reviews', 'application_decisions',
                        'review_assignment_batches')
  LIMIT 1;

  IF v_policy IS NOT NULL THEN
    RAISE EXCEPTION
      'POLICY_CONFLICT: policy % exists on an application workflow table. '
      'All five tables must carry no policy at all.',
      v_policy;
  END IF;
END;
$$;

-- RLS must be enabled AND forced on all five tables.
DO $$
DECLARE
  v_table text;
BEGIN
  SELECT c.relname INTO v_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('applications', 'application_answers',
                      'application_reviews', 'application_decisions',
                      'review_assignment_batches')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
  LIMIT 1;

  IF v_table IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS_CONTRACT_VIOLATION: public.% must have row level security both '
      'enabled and forced.', v_table;
  END IF;
END;
$$;

-- Exact ACL check. aclexplode reports grantee 0 as PUBLIC; the owner's own
-- implicit grants are the only entries allowed besides the declared ones.
DO $$
DECLARE
  v_bad text;
BEGIN
  WITH target(relname, oid, allowed_role, allowed_privs) AS (
    VALUES
      ('applications',              'public.applications'::regclass,
       'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('application_answers',       'public.application_answers'::regclass,
       'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('application_reviews',       'public.application_reviews'::regclass,
       'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('application_decisions',     'public.application_decisions'::regclass,
       'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('review_assignment_batches', 'public.review_assignment_batches'::regclass,
       'service_role', ARRAY['SELECT','INSERT','UPDATE','DELETE'])
  ),
  acl AS (
    SELECT t.relname,
           COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC') AS grantee_name,
           a.privilege_type,
           t.allowed_role,
           t.allowed_privs
    FROM target t
    JOIN pg_class c ON c.oid = t.oid
    CROSS JOIN LATERAL aclexplode(c.relacl) a
  )
  SELECT format('%s -> %s:%s', relname, grantee_name, privilege_type)
    INTO v_bad
  FROM acl
  WHERE grantee_name <> current_user
    AND NOT (grantee_name = allowed_role AND privilege_type = ANY (allowed_privs))
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'GRANT_CONTRACT_VIOLATION: unexpected privilege % on an application '
      'workflow table. Only service_role may hold SELECT/INSERT/UPDATE/DELETE.',
      v_bad;
  END IF;

  -- ...and service_role must actually hold all four, on all five tables.
  SELECT format('%s -> service_role missing %s', t.relname, p.priv)
    INTO v_bad
  FROM (VALUES ('applications'), ('application_answers'),
               ('application_reviews'), ('application_decisions'),
               ('review_assignment_batches')) AS t(relname)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  WHERE NOT has_table_privilege('service_role', 'public.' || t.relname, p.priv)
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'GRANT_CONTRACT_VIOLATION: %', v_bad;
  END IF;
END;
$$;

-- Effective-privilege check. has_table_privilege also resolves privileges
-- inherited through PUBLIC and role membership, so this catches anything the
-- ACL scan above could miss. No client role may hold ANY privilege on ANY of
-- the five tables, and service_role must not hold the excluded three.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT format('%s -> %s:%s', t.relname, r.role_name, p.priv)
    INTO v_bad
  FROM (VALUES ('applications'), ('application_answers'),
               ('application_reviews'), ('application_decisions'),
               ('review_assignment_batches')) AS t(relname)
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  WHERE has_table_privilege(r.role_name, 'public.' || t.relname, p.priv)
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'GRANT_CONTRACT_VIOLATION: client role retains privilege %.', v_bad;
  END IF;

  SELECT format('%s -> service_role:%s', t.relname, p.priv)
    INTO v_bad
  FROM (VALUES ('applications'), ('application_answers'),
               ('application_reviews'), ('application_decisions'),
               ('review_assignment_batches')) AS t(relname)
  CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  WHERE has_table_privilege('service_role', 'public.' || t.relname, p.priv)
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'GRANT_CONTRACT_VIOLATION: service_role holds excluded privilege %.',
      v_bad;
  END IF;
END;
$$;

COMMIT;
