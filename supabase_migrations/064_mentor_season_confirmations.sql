-- ============================================================
-- Migration 064 — Mentor season confirmations, outbound email log,
--                 public-form submission log
-- ============================================================
--
-- Purpose: Season 12 needs a per-season record of (a) whether each mentor
-- continues, and (b) how many mentees that mentor accepts. Neither exists
-- today: mentor_profiles.capacity_target is season-less and unused by the
-- application, and matching selects candidates purely by
-- mentor_profiles.intake_batch_id (lib/matches.ts), which makes every
-- Season 11 mentor invisible to Season 12 matching.
--
-- Objects created (in dependency order):
--   1. public.mentor_season_confirmations       — one row per (person, season)
--   2. public.mentor_season_confirmation_log    — append-only audit of changes
--   3. public.outbound_emails                   — send log for every app email
--   4. public.apply_submission_log              — hashed-IP log for rate limits
--
-- Two response channels write row 1:
--   * the mentor, through a tokenised public page (/confirm/<token>)
--   * an operator, through the admin console after a phone call
-- Both go through lib/mentor-confirmations.ts under service_role.
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- All four tables are server-only. Every legitimate read and write happens
-- server-side under service_role (lib/mentor-confirmations.ts, lib/email.ts,
-- lib/applications-create.ts). No anon or authenticated code path needs
-- direct table access — the public confirmation page reads and writes through
-- a server action, never through PostgREST.
--
-- One uniform contract therefore applies to all four tables:
--   * ROW LEVEL SECURITY enabled
--   * zero policies — no policy of any kind is created on any of them
--   * REVOKE ALL from PUBLIC, anon and authenticated
--   * GRANT exactly SELECT, INSERT, UPDATE, DELETE to service_role
--   * no TRUNCATE, REFERENCES, TRIGGER, ownership or schema-management grant
--   * every client role fails closed
--
-- ROW LEVEL SECURITY is enabled but deliberately NOT forced: the owner keeps
-- out-of-band access for operational repair, matching the posture of
-- migration 052 rather than the stricter staging bootstrap in 059.
--
-- mentor_season_confirmations.token is a bearer capability sent by email, and
-- contact_email/note may carry personal data, so the ambient Supabase default
-- privileges that grant new public tables to anon and authenticated must be
-- revoked explicitly — that is what the final section does.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It does not alter any pre-existing table, column, constraint or CHECK.
--     In particular admin_audit_log, person_season_memberships and
--     person_season_membership_log are untouched, so the frozen release
--     package VAM_OS_PROD_S12_RELEASE_20260809 still applies cleanly.
--   * It creates no function outside the two append-only guards below and
--     reuses public.set_updated_at() from migration 052.
--   * It writes no data. Confirmation rows are created by the application.
--
-- Idempotent: every statement is create-if-not-exists or drop-then-create.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 064';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 064';
  end if;
  if to_regclass('public.mentor_profiles') is null then
    raise exception 'PREREQ_MISSING: public.mentor_profiles is required by migration 064';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 064';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() (migration 052) is required by migration 064';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. mentor_season_confirmations
-- ------------------------------------------------------------
create table if not exists public.mentor_season_confirmations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  mentor_profile_id uuid null references public.mentor_profiles(id) on delete set null,
  season_id uuid not null references public.seasons(id) on delete restrict,

  -- Response
  status text not null default 'pending',
  max_mentees smallint null,
  extra_slots smallint not null default 0,
  agree_to_review boolean null,
  agree_to_interview boolean null,
  note text null,
  response_source text null,
  responded_at timestamptz null,
  responded_by_admin_user_id uuid null references public.admin_users(id) on delete set null,

  -- Invitation link
  token uuid not null default gen_random_uuid(),
  token_expires_at timestamptz null,
  contact_email text null,
  link_sent_at timestamptz null,
  link_send_error text null,
  provider_message_id text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mentor_season_confirmations_person_season_key unique (person_id, season_id),
  constraint mentor_season_confirmations_token_key unique (token),

  constraint mentor_season_confirmations_status_check
    check (status in ('pending', 'confirmed', 'declined')),

  constraint mentor_season_confirmations_max_mentees_check
    check (max_mentees is null or (max_mentees >= 1 and max_mentees <= 3)),

  constraint mentor_season_confirmations_extra_slots_check
    check (extra_slots >= 0 and extra_slots <= 3),

  constraint mentor_season_confirmations_response_source_check
    check (response_source is null or response_source in ('form', 'manual', 'phone', 'application')),

  constraint mentor_season_confirmations_note_length_check
    check (note is null or char_length(note) <= 1000),

  -- A confirmed row must carry a capacity and a recorded response; a declined
  -- row must not carry a capacity. Pending rows carry neither.
  constraint mentor_season_confirmations_response_shape_check
    check (
      (status = 'pending'   and max_mentees is null and responded_at is null and response_source is null)
      or (status = 'confirmed' and max_mentees is not null and responded_at is not null and response_source is not null)
      or (status = 'declined'  and max_mentees is null and responded_at is not null and response_source is not null)
    )
);

comment on table public.mentor_season_confirmations is
  'One row per mentor per season recording whether the mentor continues and how many mentees they accept. Written only by lib/mentor-confirmations.ts under service_role.';
comment on column public.mentor_season_confirmations.max_mentees is
  'Mentor-declared capacity for this season, 1..3. Null while pending or when declined. Matching uses max_mentees + extra_slots as the cap.';
comment on column public.mentor_season_confirmations.extra_slots is
  'Additional slots granted by core_team after an interview, 0..3. Added on top of max_mentees.';
comment on column public.mentor_season_confirmations.token is
  'Bearer capability for the public /confirm/<token> page. Sent by email; never exposed in any list rendered to non-admins.';
comment on column public.mentor_season_confirmations.contact_email is
  'Snapshot of the address the invitation was sent to. Written by operators only; the public form never updates it.';
comment on column public.mentor_season_confirmations.agree_to_review is
  'Mentor agreed to score mentee application forms this season (used to build the reviewer pool).';
comment on column public.mentor_season_confirmations.agree_to_interview is
  'Mentor agreed to interview mentees this season.';

create index if not exists mentor_season_confirmations_season_status_idx
  on public.mentor_season_confirmations (season_id, status);

create index if not exists mentor_season_confirmations_person_idx
  on public.mentor_season_confirmations (person_id);

drop trigger if exists mentor_season_confirmations_set_updated_at on public.mentor_season_confirmations;

create trigger mentor_season_confirmations_set_updated_at
before update on public.mentor_season_confirmations
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. mentor_season_confirmation_log (append-only)
-- ------------------------------------------------------------
create table if not exists public.mentor_season_confirmation_log (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.mentor_season_confirmations(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  old_status text null,
  new_status text not null,
  old_max_mentees smallint null,
  new_max_mentees smallint null,
  old_extra_slots smallint null,
  new_extra_slots smallint null,
  change_type text not null,
  response_source text null,
  reason text null,
  changed_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint mentor_season_confirmation_log_change_type_check
    check (change_type in (
      'created',
      'status_change',
      'capacity_change',
      'extra_slots_change',
      'link_issued',
      'link_sent',
      'token_reissued',
      'expiry_extended'
    )),

  constraint mentor_season_confirmation_log_new_status_check
    check (new_status in ('pending', 'confirmed', 'declined'))
);

comment on table public.mentor_season_confirmation_log is
  'Append-only audit of every mentor_season_confirmations change. UPDATE and DELETE are blocked by trigger, matching person_season_membership_log (migration 052).';

create index if not exists mentor_season_confirmation_log_confirmation_idx
  on public.mentor_season_confirmation_log (confirmation_id, changed_at desc);

create or replace function public.prevent_mentor_season_confirmation_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mentor_season_confirmation_log is append-only';
end;
$$;

drop trigger if exists mentor_season_confirmation_log_no_update on public.mentor_season_confirmation_log;
create trigger mentor_season_confirmation_log_no_update
before update on public.mentor_season_confirmation_log
for each row
execute function public.prevent_mentor_season_confirmation_log_mutation();

drop trigger if exists mentor_season_confirmation_log_no_delete on public.mentor_season_confirmation_log;
create trigger mentor_season_confirmation_log_no_delete
before delete on public.mentor_season_confirmation_log
for each row
execute function public.prevent_mentor_season_confirmation_log_mutation();

-- ------------------------------------------------------------
-- 3. outbound_emails
-- ------------------------------------------------------------
create table if not exists public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  to_email text not null,
  subject text null,
  related_table text null,
  related_id uuid null,
  status text not null default 'queued',
  provider text not null default 'resend',
  provider_message_id text null,
  error text null,
  created_at timestamptz not null default now(),

  constraint outbound_emails_status_check
    check (status in ('queued', 'sent', 'failed', 'skipped')),

  constraint outbound_emails_kind_check
    check (kind in (
      'mentor_confirmation_link',
      'mentee_application_confirmation',
      'mentor_application_confirmation',
      'review_batch_assigned',
      'interview_scheduled',
      'reviewer_invite'
    ))
);

comment on table public.outbound_emails is
  'Send log for every email the application sends through lib/email.ts. One row per recipient per send attempt; status skipped means sending was disabled by configuration.';

create index if not exists outbound_emails_kind_created_idx
  on public.outbound_emails (kind, created_at desc);

create index if not exists outbound_emails_related_idx
  on public.outbound_emails (related_table, related_id);

-- ------------------------------------------------------------
-- 4. apply_submission_log
-- ------------------------------------------------------------
create table if not exists public.apply_submission_log (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  route text not null,
  outcome text not null default 'accepted',
  created_at timestamptz not null default now(),

  constraint apply_submission_log_route_check
    check (route in ('apply_mentee', 'apply_mentor', 'confirm')),

  constraint apply_submission_log_outcome_check
    check (outcome in ('accepted', 'rejected_rate_limit', 'rejected_honeypot', 'rejected_gate'))
);

comment on table public.apply_submission_log is
  'Hashed-IP submission counter backing the public-form rate limit. ip_hash is a salted SHA-256 digest — the raw address is never stored. Rows older than 7 days are pruned by the application.';

create index if not exists apply_submission_log_ip_created_idx
  on public.apply_submission_log (ip_hash, created_at desc);

create index if not exists apply_submission_log_created_idx
  on public.apply_submission_log (created_at);

-- ------------------------------------------------------------
-- 5. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.mentor_season_confirmations     enable row level security;
alter table public.mentor_season_confirmation_log  enable row level security;
alter table public.outbound_emails                 enable row level security;
alter table public.apply_submission_log            enable row level security;

revoke all on public.mentor_season_confirmations    from public, anon, authenticated;
revoke all on public.mentor_season_confirmation_log from public, anon, authenticated;
revoke all on public.outbound_emails                from public, anon, authenticated;
revoke all on public.apply_submission_log           from public, anon, authenticated;

grant select, insert, update, delete on public.mentor_season_confirmations    to service_role;
grant select, insert                 on public.mentor_season_confirmation_log to service_role;
grant select, insert, update         on public.outbound_emails                to service_role;
grant select, insert, delete         on public.apply_submission_log           to service_role;

-- ------------------------------------------------------------
-- 6. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'mentor_season_confirmations',
    'mentor_season_confirmation_log',
    'outbound_emails',
    'apply_submission_log'
  ];
  offending text;
begin
  -- 6a. RLS must be enabled on every new table.
  select string_agg(c.relname, ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (target_tables)
    and c.relrowsecurity is false;

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: row level security is not enabled on: %', offending;
  end if;

  -- 6b. No policy may exist on any of them.
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename = any (target_tables);

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: unexpected policy present: %', offending;
  end if;

  -- 6c. No privilege may remain for PUBLIC, anon or authenticated.
  select string_agg(format('%s -> %s:%s', c.relname, grantee_name, a.privilege_type), ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
           x.privilege_type
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
  ) a(grantee_name, privilege_type)
  where n.nspname = 'public'
    and c.relname = any (target_tables)
    and a.grantee_name in ('PUBLIC', 'anon', 'authenticated');

  if offending is not null then
    raise exception 'GRANT_CONTRACT_VIOLATION: client-role privileges remain: %', offending;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
