-- =============================================================================
-- Migration 054: Event Phase 2A — Configurable registration & check-in config
-- =============================================================================
-- Scope:
--   * Additive only. ADD COLUMN IF NOT EXISTS throughout.
--   * No columns dropped, renamed, or rewritten.
--   * No data imported or modified.
--   * No RLS changes.
--   * Existing events / event_registrations rows are 100% unaffected.
--     All new columns default to the same value that makes the current
--     open/walk-in behaviour continue unchanged.
--   * The existing registration_status CHECK constraint on event_registrations
--     is expanded from ('registered','cancelled') to include the Phase 2
--     workflow states. All current data is still valid under the new constraint.
--   * Safe to re-run (idempotent via IF NOT EXISTS + DO $$ guards).
--
-- Blueprint: docs/EVENT_PHASE2_CONFIGURABLE_REGISTRATION_WORKFLOW_BLUEPRINT.md
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. events — per-event registration & check-in config
-- ---------------------------------------------------------------------------

-- 1a. Registration mode
alter table public.events
  add column if not exists registration_required  boolean not null default false,
  add column if not exists approval_required       boolean not null default false;

-- 1b. Capacity & waitlist
alter table public.events
  add column if not exists capacity_limit_enabled  boolean not null default false,
  add column if not exists capacity_limit          integer  null,
  add column if not exists waitlist_enabled        boolean not null default false;

-- 1c. Walk-in policy
alter table public.events
  add column if not exists allow_walk_in           boolean not null default true;

-- 1d. Check-in mode
--     open (default) | registration_required | confirmed_only | manual_admin_only
alter table public.events
  add column if not exists checkin_mode            text    not null default 'open';

-- 1e. Check-in window (secondary time-gate, separate from event_links.opens_at/closes_at)
alter table public.events
  add column if not exists checkin_window_enabled  boolean    not null default false,
  add column if not exists checkin_opens_at        timestamptz null,
  add column if not exists checkin_closes_at       timestamptz null;

-- 1f. Proof / evidence submission
alter table public.events
  add column if not exists proof_required                   boolean not null default false,
  add column if not exists proof_label                      text    null,
  add column if not exists proof_description                text    null,
  add column if not exists proof_required_for_registration  boolean not null default false,
  add column if not exists proof_required_for_checkin       boolean not null default false;

-- 1g. Speaker / organiser question collection
alter table public.events
  add column if not exists question_collection_enabled  boolean not null default false,
  add column if not exists speaker_question_label       text    null;

-- 1h. No-show policy display
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

-- 1j. Public-facing event description (separate from admin-only source_notes)
alter table public.events
  add column if not exists event_description  text  null;

-- 1k. Field visibility controls (per-event)
alter table public.events
  add column if not exists show_student_id_field   boolean not null default true,
  add column if not exists student_id_required     boolean not null default false,
  add column if not exists show_mentee_code_field  boolean not null default false,
  add column if not exists mentee_code_required    boolean not null default false,
  add column if not exists show_school_field       boolean not null default true,
  add column if not exists show_program_field      boolean not null default true,
  add column if not exists show_role_text_field    boolean not null default false,
  add column if not exists show_notes_field        boolean not null default true;

-- Helpful indexes for config-based queries
create index if not exists events_checkin_mode_idx
  on public.events(checkin_mode);

create index if not exists events_capacity_limit_enabled_idx
  on public.events(capacity_limit_enabled)
  where capacity_limit_enabled = true;

-- Column documentation
comment on column public.events.registration_required is
  'Phase 2: if true, participants must have a pre-existing non-cancelled registration to check in.';
comment on column public.events.approval_required is
  'Phase 2: if true, new public registrations start as pending_review and require admin confirmation.';
comment on column public.events.capacity_limit_enabled is
  'Phase 2: master toggle for capacity enforcement.';
comment on column public.events.capacity_limit is
  'Phase 2: max number of confirmed/registered registrants. Enforced when capacity_limit_enabled = true.';
comment on column public.events.waitlist_enabled is
  'Phase 2: when capacity is full, new registrations get waitlisted instead of rejected.';
comment on column public.events.allow_walk_in is
  'Phase 2: if false, walk-in check-in is blocked. Defaults to true (current production behaviour).';
comment on column public.events.checkin_mode is
  'Phase 2: open | registration_required | confirmed_only | manual_admin_only. Defaults to open.';
comment on column public.events.checkin_window_enabled is
  'Phase 2: if true, enforce checkin_opens_at / checkin_closes_at time gates.';
comment on column public.events.proof_required is
  'Phase 2: master toggle for proof/evidence collection on this event.';
comment on column public.events.fee_required is
  'Phase 2: master toggle for fee collection on this event.';
comment on column public.events.event_description is
  'Phase 2: public-facing event description shown on the registration and check-in pages.';

-- ---------------------------------------------------------------------------
-- 2. event_registrations — expand registration_status constraint + new columns
-- ---------------------------------------------------------------------------

-- 2a. Expand the registration_status CHECK constraint to Phase 2 values.
--     Original: ('registered', 'cancelled')
--     New:      ('registered', 'cancelled', 'pending_review', 'confirmed', 'waitlisted', 'rejected')
--     All existing rows have 'registered' or 'cancelled' — still valid under the new constraint.

do $$
begin
  -- Drop the old narrow constraint if it does not yet include 'pending_review'
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

  -- Add expanded constraint only if missing
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

-- 2b. New identity / extended collection fields
alter table public.event_registrations
  add column if not exists mentee_code       text  null,
  add column if not exists speaker_question  text  null;

-- 2c. Proof / evidence fields (Phase 2A: URL-based; Phase 2D: file upload)
alter table public.event_registrations
  add column if not exists proof_url          text  null,
  add column if not exists proof_note         text  null,
  add column if not exists proof_status       text  not null default 'not_required',
  add column if not exists proof_reviewed_at  timestamptz  null,
  add column if not exists proof_reviewed_by  uuid         null,
  add column if not exists proof_review_note  text         null;

-- 2d. Admin review / approval workflow
alter table public.event_registrations
  add column if not exists review_status  text         null,
  add column if not exists review_note    text         null,
  add column if not exists confirmed_at   timestamptz  null,
  add column if not exists confirmed_by   uuid         null,
  add column if not exists waitlisted_at  timestamptz  null,
  add column if not exists rejected_at    timestamptz  null;

-- 2e. Payment fields (Phase 2A: URL-based proof only; no gateway)
alter table public.event_registrations
  add column if not exists payment_status          text         not null default 'not_required',
  add column if not exists payment_proof_url       text         null,
  add column if not exists payment_proof_note      text         null,
  add column if not exists payment_confirmed_at    timestamptz  null,
  add column if not exists payment_confirmed_by    uuid         null,
  add column if not exists payment_rejected_at     timestamptz  null,
  add column if not exists payment_rejected_by     uuid         null,
  add column if not exists payment_rejection_note  text         null;

-- 2f. No-show / blacklist flags (post-event, admin-only)
alter table public.event_registrations
  add column if not exists no_show_flagged     boolean      not null default false,
  add column if not exists no_show_flagged_at  timestamptz  null,
  add column if not exists no_show_flagged_by  uuid         null,
  add column if not exists blacklist_flag      boolean      not null default false,
  add column if not exists blacklist_note      text         null;

-- Useful indexes for Phase 2 workflows
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

-- Column documentation
comment on column public.event_registrations.mentee_code is
  'Phase 2: VAM-assigned mentee code. Collected when event.show_mentee_code_field = true.';
comment on column public.event_registrations.proof_url is
  'Phase 2A: external URL submitted as registration proof. Phase 2D will add file-upload support.';
comment on column public.event_registrations.proof_status is
  'Phase 2: not_required | submitted | accepted | rejected.';
comment on column public.event_registrations.review_status is
  'Phase 2: pending | approved | rejected | null (not_required). Tracks admin review workflow.';
comment on column public.event_registrations.payment_status is
  'Phase 2: not_required | pending | submitted | confirmed | rejected.';
comment on column public.event_registrations.no_show_flagged is
  'Phase 2: set true post-event for confirmed registrants who did not attend.';
comment on column public.event_registrations.blacklist_flag is
  'Phase 2: escalation from no_show_flagged. Manual admin action only. Never automatic.';

-- ---------------------------------------------------------------------------
-- Verification helper (for reviewers — not executed at migration time)
-- ---------------------------------------------------------------------------
-- select column_name, data_type, column_default, is_nullable
-- from   information_schema.columns
-- where  table_schema = 'public'
--   and  table_name   = 'events'
--   and  column_name  like '%checkin%' or column_name like '%capacity%'
-- order  by ordinal_position;
--
-- select pg_get_constraintdef(oid)
-- from   pg_constraint
-- where  conname = 'event_registrations_registration_status_check'
--   and  conrelid = 'public.event_registrations'::regclass;
--
-- select count(*) from public.event_registrations
-- where registration_status not in (
--   'registered','cancelled','pending_review','confirmed','waitlisted','rejected'
-- );  -- must return 0

notify pgrst, 'reload schema';
