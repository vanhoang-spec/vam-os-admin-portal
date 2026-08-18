-- ============================================================
-- Migration 067 — Interview scheduling and mentor self-selection
-- ============================================================
--
-- Purpose: the Season 12 process continues past the ranking of migration 066.
-- The applications on the main list are interviewed, and the interview is done
-- by the mentors themselves. Two things are missing from the schema for that:
--
--   1. WHEN and WHERE an interview happens. Today an interview is only a row in
--      application_reviews with review_round = 'interview'; nothing records the
--      appointment, so neither the interviewer nor the candidate can be told a
--      time, and the organisers cannot see a schedule.
--
--   2. WHICH mentor account belongs to which mentor person. After the interview
--      the mentor picks the mentee they want to take, and that decision has to
--      be checked against the capacity that mentor confirmed for the season
--      (mentor_season_confirmations, migration 064). The link between the login
--      and the mentor record was implicit — the address the account was created
--      from — which is too weak a basis for creating a match.
--
-- The selection itself is also recorded, including the attempts that were
-- refused: a mentor who is already full and asks for one more place is exactly
-- the case the organisers need to see.
--
-- Objects:
--   1. public.application_reviews      — three additive columns (the appointment)
--   2. public.admin_users              — one additive column (linked_person_id)
--   3. public.mentor_mentee_selections — append-only record of the choices
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- The new table follows migrations 064 and 066 exactly: RLS enabled, zero
-- policies, every privilege revoked from PUBLIC/anon/authenticated, and only
-- what service_role needs granted. All access goes through lib/mentor-selection.ts
-- and lib/interview-scheduling.ts, which check permission and season scope
-- before touching a row.
--
-- The two existing tables keep the grants and RLS state they already have; this
-- migration only adds columns to them and does not touch their privileges.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It changes no existing column, constraint or CHECK. The one constraint it
--     adds applies to a column created in this same migration, so no existing
--     row can violate it and the frozen release package still applies.
--   * It drops nothing and writes no data.
--   * It adds no value to admin_audit_log.action_type: the selection path
--     reuses 'create_manual_match', which is already in the vocabulary.
--
-- Idempotent: add-column-if-not-exists / create-if-not-exists throughout, and
-- the CHECK constraint is added only when absent.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.applications') is null then
    raise exception 'PREREQ_MISSING: public.applications is required by migration 067';
  end if;
  if to_regclass('public.application_reviews') is null then
    raise exception 'PREREQ_MISSING: public.application_reviews (migration 040) is required by migration 067';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 067';
  end if;
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 067';
  end if;
  if to_regclass('public.matches') is null then
    raise exception 'PREREQ_MISSING: public.matches is required by migration 067';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 067';
  end if;
  if to_regclass('public.mentor_season_confirmations') is null then
    raise exception 'PREREQ_MISSING: public.mentor_season_confirmations (migration 064) is required by migration 067';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. application_reviews — the appointment
-- ------------------------------------------------------------
-- Kept on the review row rather than in a separate slots table: an interview is
-- one interviewer meeting one candidate, which is exactly what one review row
-- already is. A slot table would only pay for itself if interview times were
-- shared resources booked independently of the interviewer.

alter table public.application_reviews
  add column if not exists interview_scheduled_at timestamptz;

alter table public.application_reviews
  add column if not exists interview_mode text;

alter table public.application_reviews
  add column if not exists interview_location text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_reviews_interview_mode_check'
      and conrelid = 'public.application_reviews'::regclass
  ) then
    alter table public.application_reviews
      add constraint application_reviews_interview_mode_check
      check (interview_mode is null or interview_mode in ('online', 'offline'));
  end if;
end;
$$;

comment on column public.application_reviews.interview_scheduled_at is
  'Migration 067: appointed start time of this interview. Null for a review that was self-claimed on the day rather than scheduled in advance.';
comment on column public.application_reviews.interview_mode is
  'Migration 067: online | offline. Decides which line the invitation email prints — a meeting link or an address.';
comment on column public.application_reviews.interview_location is
  'Migration 067: meeting link when the mode is online, address or room when it is offline.';

create index if not exists application_reviews_interview_schedule_idx
  on public.application_reviews (interview_scheduled_at)
  where interview_scheduled_at is not null;

-- ------------------------------------------------------------
-- 2. admin_users — which person this login belongs to
-- ------------------------------------------------------------
-- Set when core_team turns a mentor into an interviewer account
-- (lib/enable-reviewer.ts), where the mentor's person row is known. Nullable,
-- because most admin accounts are staff who are not in `people` at all.

alter table public.admin_users
  add column if not exists linked_person_id uuid references public.people(id) on delete set null;

comment on column public.admin_users.linked_person_id is
  'Migration 067: the people row this login belongs to, set when a mentor is granted an interviewer account. Used to check a mentor self-selection against the capacity that mentor confirmed for the season. Null for staff accounts.';

create index if not exists admin_users_linked_person_idx
  on public.admin_users (linked_person_id)
  where linked_person_id is not null;

-- ------------------------------------------------------------
-- 3. mentor_mentee_selections (append-only)
-- ------------------------------------------------------------
create table if not exists public.mentor_mentee_selections (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid null references public.intake_batches(id) on delete set null,

  -- Who chose, and as whom
  actor_admin_user_id uuid null references public.admin_users(id) on delete set null,
  mentor_person_id uuid null references public.people(id) on delete set null,

  -- Who was chosen
  application_id uuid not null references public.applications(id) on delete restrict,
  mentee_person_id uuid null references public.people(id) on delete set null,

  outcome text not null,
  match_id uuid null references public.matches(id) on delete set null,

  -- The capacity arithmetic as it stood at the moment of the decision, so a
  -- refusal can still be explained after somebody grants an extra place.
  cap_at_decision smallint null,
  active_count_at_decision smallint null,

  reason text null,
  created_at timestamptz not null default now(),

  constraint mentor_mentee_selections_outcome_check
    check (outcome in (
      'created',
      'blocked_cap',
      'blocked_mentee_taken',
      'blocked_not_confirmed',
      'blocked_no_interview',
      'blocked_identity'
    )),

  constraint mentor_mentee_selections_cap_check
    check (cap_at_decision is null or cap_at_decision >= 0),

  constraint mentor_mentee_selections_active_count_check
    check (active_count_at_decision is null or active_count_at_decision >= 0)
);

comment on table public.mentor_mentee_selections is
  'Append-only record of a mentor choosing a mentee after the interview, including the attempts that were refused. UPDATE and DELETE are blocked by trigger, matching selection_run_log (migration 066).';
comment on column public.mentor_mentee_selections.outcome is
  'created = a match was made. blocked_cap = the mentor is already at their confirmed capacity and needs an extra place from core_team. blocked_mentee_taken = another mentor got there first. blocked_not_confirmed = the mentor has no confirmed place this season. blocked_no_interview = the caller has not submitted an interview score for this application. blocked_identity = the login could not be resolved to exactly one mentor.';

create index if not exists mentor_mentee_selections_season_idx
  on public.mentor_mentee_selections (season_id, created_at desc);

create index if not exists mentor_mentee_selections_mentor_idx
  on public.mentor_mentee_selections (mentor_person_id, created_at desc);

create index if not exists mentor_mentee_selections_application_idx
  on public.mentor_mentee_selections (application_id, created_at desc);

-- Blocked attempts are the ones the organisers act on, so they get their own
-- partial index rather than being filtered out of the full history every time.
create index if not exists mentor_mentee_selections_blocked_idx
  on public.mentor_mentee_selections (season_id, created_at desc)
  where outcome <> 'created';

create or replace function public.prevent_mentor_mentee_selection_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mentor_mentee_selections is append-only';
end;
$$;

drop trigger if exists mentor_mentee_selections_no_update on public.mentor_mentee_selections;
create trigger mentor_mentee_selections_no_update
before update on public.mentor_mentee_selections
for each row
execute function public.prevent_mentor_mentee_selection_mutation();

drop trigger if exists mentor_mentee_selections_no_delete on public.mentor_mentee_selections;
create trigger mentor_mentee_selections_no_delete
before delete on public.mentor_mentee_selections
for each row
execute function public.prevent_mentor_mentee_selection_mutation();

-- ------------------------------------------------------------
-- 4. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.mentor_mentee_selections enable row level security;

revoke all on public.mentor_mentee_selections from public, anon, authenticated;

grant select, insert on public.mentor_mentee_selections to service_role;

-- ------------------------------------------------------------
-- 5. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array['mentor_mentee_selections'];
  offending text;
  missing text;
begin
  -- 5a. The columns this migration exists to add must actually be there.
  select string_agg(format('%s.%s', expected.tbl, expected.col), ', ')
    into missing
  from (values
    ('application_reviews', 'interview_scheduled_at'),
    ('application_reviews', 'interview_mode'),
    ('application_reviews', 'interview_location'),
    ('admin_users', 'linked_person_id')
  ) as expected(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.tbl
      and c.column_name = expected.col
  );

  if missing is not null then
    raise exception 'COLUMN_CONTRACT_VIOLATION: expected columns are missing: %', missing;
  end if;

  -- 5b. RLS on, no policies, no client-role privileges on the new table.
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

  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename = any (target_tables);

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: unexpected policy present: %', offending;
  end if;

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
