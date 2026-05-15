-- =============================================================================
-- Migration 055: Event Phase 2A — Production Schema Alignment
-- =============================================================================
-- Context:
--   Migration 054 was NOT run against production.  A manual patch was applied
--   instead, but it:
--     (a) used different column names for several columns, and
--     (b) missed several columns entirely.
--
--   This migration is a safe, comprehensive catch-up that:
--     * Uses ADD COLUMN IF NOT EXISTS throughout (idempotent / re-runnable).
--     * Only adds columns that application code actively reads, writes, or
--       depends on for NOT NULL / DEFAULT constraints.
--     * Does NOT drop or rename any existing column (the wrong-named columns
--       added by the manual patch are harmless — they just sit unused).
--     * Does NOT modify any existing data.
--     * Does NOT change RLS policies.
--
-- Naming conflicts resolved by adding the correct-name column alongside the
-- wrong-name one (the wrong-name column is left untouched for safety):
--
--   Manual patch name           Correct code/migration name
--   ─────────────────────────   ────────────────────────────
--   collect_speaker_questions   question_collection_enabled
--   speaker_question_prompt     speaker_question_label
--   show_no_show_policy         no_show_policy_enabled
--   show_role_field             show_role_text_field
--   proof_instruction           (not used by code — leave as-is)
--   reviewed_at                 proof_reviewed_at
--   reviewed_by                 proof_reviewed_by
--
-- Safe to re-run on any environment (staging or production).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. public.events — Phase 2A columns
-- ---------------------------------------------------------------------------
-- All columns from migration 054 that code references.
-- IF NOT EXISTS means already-present columns are silently skipped.

-- 1a. Registration mode
alter table public.events
  add column if not exists registration_required  boolean not null default false,
  add column if not exists approval_required       boolean not null default false;

-- 1b. Capacity & waitlist
--     NOTE: "waitlist_enabled" was missing from the manual production patch.
alter table public.events
  add column if not exists capacity_limit_enabled  boolean not null default false,
  add column if not exists capacity_limit          integer  null,
  add column if not exists waitlist_enabled        boolean not null default false;

-- 1c. Walk-in policy
alter table public.events
  add column if not exists allow_walk_in           boolean not null default true;

-- 1d. Check-in mode  (open | registration_required | confirmed_only | manual_admin_only)
alter table public.events
  add column if not exists checkin_mode            text    not null default 'open';

-- 1e. Check-in window
alter table public.events
  add column if not exists checkin_window_enabled  boolean    not null default false,
  add column if not exists checkin_opens_at        timestamptz null,
  add column if not exists checkin_closes_at       timestamptz null;

-- 1f. Proof / evidence submission
--     NOTE: proof_required, proof_label, proof_description, proof_required_for_checkin
--           were ALL missing from the manual production patch.
alter table public.events
  add column if not exists proof_required                   boolean not null default false,
  add column if not exists proof_label                      text    null,
  add column if not exists proof_description                text    null,
  add column if not exists proof_required_for_registration  boolean not null default false,
  add column if not exists proof_required_for_checkin       boolean not null default false;

-- 1g. Speaker / organiser question collection
--     NOTE: manual patch used "collect_speaker_questions" and "speaker_question_prompt".
--           Code uses "question_collection_enabled" and "speaker_question_label".
--           Adding the correct-name columns; wrong-name columns are left untouched.
alter table public.events
  add column if not exists question_collection_enabled  boolean not null default false,
  add column if not exists speaker_question_label       text    null;

-- 1h. No-show policy display
--     NOTE: manual patch used "show_no_show_policy".
--           Code uses "no_show_policy_enabled". Adding correct-name column.
alter table public.events
  add column if not exists no_show_policy_enabled  boolean not null default false,
  add column if not exists no_show_policy_text     text    null;

-- 1i. Fee & payment instructions
alter table public.events
  add column if not exists fee_required           boolean       not null default false,
  add column if not exists fee_amount             numeric(10,2) null,
  add column if not exists fee_currency           text          not null default 'VND',
  add column if not exists fee_description        text          null,
  add column if not exists payment_instruction    text          null,
  add column if not exists payment_proof_required boolean       not null default false;

-- 1j. Public-facing event description
alter table public.events
  add column if not exists event_description  text  null;

-- 1k. Field visibility controls
--     NOTE: "show_role_text_field" missing from manual patch (it added "show_role_field").
--           "mentee_code_required" confirmed missing (latest production error).
alter table public.events
  add column if not exists show_student_id_field   boolean not null default true,
  add column if not exists student_id_required     boolean not null default false,
  add column if not exists show_mentee_code_field  boolean not null default false,
  add column if not exists mentee_code_required    boolean not null default false,
  add column if not exists show_school_field       boolean not null default true,
  add column if not exists show_program_field      boolean not null default true,
  add column if not exists show_role_text_field    boolean not null default false,
  add column if not exists show_notes_field        boolean not null default true;

-- Indexes for config-based queries (idempotent)
create index if not exists events_checkin_mode_idx
  on public.events(checkin_mode);

create index if not exists events_capacity_limit_enabled_idx
  on public.events(capacity_limit_enabled)
  where capacity_limit_enabled = true;


-- ---------------------------------------------------------------------------
-- 2. public.event_registrations — Phase 2A columns
-- ---------------------------------------------------------------------------

-- 2a. Expand the registration_status CHECK constraint.
--     Idempotent: only drops the old narrow constraint if it does not yet
--     include 'pending_review'; only adds the expanded constraint if missing.
do $$
begin
  if exists (
    select 1
    from   pg_constraint
    where  conname    = 'event_registrations_registration_status_check'
      and  conrelid   = 'public.event_registrations'::regclass
      and  pg_get_constraintdef(oid) not like '%pending_review%'
  ) then
    alter table public.event_registrations
      drop constraint event_registrations_registration_status_check;
  end if;

  if not exists (
    select 1
    from   pg_constraint
    where  conname  = 'event_registrations_registration_status_check'
      and  conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_registration_status_check
      check (registration_status in (
        'registered', 'cancelled',
        'pending_review', 'confirmed', 'waitlisted', 'rejected'
      ));
  end if;
end;
$$;

-- 2b. Identity / extended collection fields
--     NOTE: speaker_question is ACTIVELY INSERTED by registerForEvent — missing from manual patch.
alter table public.event_registrations
  add column if not exists mentee_code       text  null,
  add column if not exists speaker_question  text  null;

-- 2c. Proof / evidence fields
--     NOTE: manual patch added "reviewed_at"/"reviewed_by" (wrong names).
--           Code and migration 054 use "proof_reviewed_at"/"proof_reviewed_by".
--           Adding correct-name columns; wrong-name columns are left untouched.
alter table public.event_registrations
  add column if not exists proof_url          text         null,
  add column if not exists proof_note         text         null,
  add column if not exists proof_status       text         not null default 'not_required',
  add column if not exists proof_reviewed_at  timestamptz  null,
  add column if not exists proof_reviewed_by  uuid         null,
  add column if not exists proof_review_note  text         null;

-- 2d. Admin review / approval workflow
--     Includes all columns from the manual production patch so this migration
--     is fully self-contained for fresh environments.
alter table public.event_registrations
  add column if not exists review_status      text         null,
  add column if not exists review_note        text         null,
  add column if not exists confirmed_at       timestamptz  null,
  add column if not exists confirmed_by       uuid         null,
  add column if not exists waitlist_position  integer      null,
  add column if not exists waitlisted_at      timestamptz  null,
  add column if not exists waitlisted_by      uuid         null,
  add column if not exists rejected_at        timestamptz  null,
  add column if not exists rejected_by        uuid         null,
  add column if not exists reject_reason      text         null,
  add column if not exists cancelled_at       timestamptz  null,
  add column if not exists cancelled_by       uuid         null,
  add column if not exists cancel_reason      text         null;

-- 2e. Payment fields
--     NOTE: payment_proof_note is ACTIVELY INSERTED by registerForEvent — missing from manual patch.
alter table public.event_registrations
  add column if not exists payment_status          text         not null default 'not_required',
  add column if not exists payment_proof_url       text         null,
  add column if not exists payment_proof_note      text         null,
  add column if not exists payment_confirmed_at    timestamptz  null,
  add column if not exists payment_confirmed_by    uuid         null,
  add column if not exists payment_rejected_at     timestamptz  null,
  add column if not exists payment_rejected_by     uuid         null,
  add column if not exists payment_rejection_note  text         null;

-- 2f. No-show / blacklist flags
alter table public.event_registrations
  add column if not exists no_show_flagged     boolean      not null default false,
  add column if not exists no_show_flagged_at  timestamptz  null,
  add column if not exists no_show_flagged_by  uuid         null,
  add column if not exists blacklist_flag      boolean      not null default false,
  add column if not exists blacklist_note      text         null;

-- Indexes
create index if not exists event_registrations_registration_status_idx
  on public.event_registrations(registration_status);

create index if not exists event_registrations_proof_status_idx
  on public.event_registrations(proof_status)
  where proof_status <> 'not_required';

create index if not exists event_registrations_payment_status_idx
  on public.event_registrations(payment_status)
  where payment_status <> 'not_required';

create index if not exists event_registrations_no_show_flagged_idx
  on public.event_registrations(no_show_flagged)
  where no_show_flagged = true;


-- ---------------------------------------------------------------------------
-- Reload PostgREST schema cache so Supabase client sees new columns immediately
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
