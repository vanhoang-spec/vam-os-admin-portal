-- ============================================================
-- Migration 068 — Assisted matching: recommendations awaiting approval
-- ============================================================
--
-- Purpose: the last step of the Season 12 process. After the mentors have
-- taken the mentees they interviewed, the leftovers have to be paired by hand:
-- dozens of mentees against hundreds of mentors, read one profile at a time.
--
-- A language model can propose those pairings, but it must never make them.
-- This migration therefore stores a PROPOSAL: one run, its pairs, and the
-- decision an organiser took on each pair. A match is created only by the
-- existing manual-matching path (lib/matches.ts), which re-checks the mentor's
-- capacity — so an approval cannot exceed what the mentor confirmed, however
-- confident the model was.
--
-- Objects created:
--   1. public.match_recommendation_runs — one assisted-matching exercise
--   2. public.match_recommendations     — the proposed pairs of that run
--   3. public.match_recommendation_log  — append-only audit of the decisions
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064, 066 and 067: RLS enabled, zero
-- policies, every privilege revoked from PUBLIC/anon/authenticated, and only
-- what service_role needs granted. All access goes through lib/ai-matching.ts,
-- which checks `canManageMatches` plus operations scope on the season.
--
-- The run row records which provider, model and prompt version produced the
-- pairs, so a proposal can always be traced back to how it was generated. What
-- it does NOT store is the prompt text: the payload sent to the provider holds
-- no names, addresses, phone numbers or student ids (lib/ai-matching-core.ts
-- builds it from an allow-list and redacts free text), and keeping a copy of
-- it here would re-create the identifiable record the anonymisation removed.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It alters no existing table, column, constraint or CHECK. applications,
--     matches, people, admin_audit_log and the membership tables are untouched,
--     so the frozen release package still applies.
--   * It writes no data.
--   * It adds no value to admin_audit_log.action_type: approving a pair goes
--     through createManualMatch, which already logs 'create_manual_match'.
--
-- Idempotent: create-if-not-exists / drop-then-create throughout.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 068';
  end if;
  if to_regclass('public.intake_batches') is null then
    raise exception 'PREREQ_MISSING: public.intake_batches is required by migration 068';
  end if;
  if to_regclass('public.applications') is null then
    raise exception 'PREREQ_MISSING: public.applications is required by migration 068';
  end if;
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 068';
  end if;
  if to_regclass('public.matches') is null then
    raise exception 'PREREQ_MISSING: public.matches is required by migration 068';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 068';
  end if;
  if to_regclass('public.mentor_season_confirmations') is null then
    raise exception 'PREREQ_MISSING: public.mentor_season_confirmations (migration 064) is required by migration 068';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. match_recommendation_runs
-- ------------------------------------------------------------
create table if not exists public.match_recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid null references public.intake_batches(id) on delete set null,

  -- How this proposal was produced, so it can be judged later
  provider text not null default 'deepseek',
  model text not null,
  prompt_version text not null,

  status text not null default 'running',

  -- What it worked from and what it produced
  mentee_count integer not null default 0,
  mentor_count integer not null default 0,
  pair_count integer not null default 0,
  round_count smallint not null default 0,

  -- Cost, so an operator can see what a run is worth
  prompt_tokens integer null,
  completion_tokens integer null,

  params jsonb null,
  error text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint match_recommendation_runs_status_check
    check (status in ('running', 'completed', 'failed', 'discarded')),

  constraint match_recommendation_runs_counts_check
    check (
      mentee_count >= 0 and mentor_count >= 0 and pair_count >= 0 and round_count >= 0
    ),

  constraint match_recommendation_runs_tokens_check
    check (
      (prompt_tokens is null or prompt_tokens >= 0)
      and (completion_tokens is null or completion_tokens >= 0)
    ),

  -- A finished run says when it finished; a running one has not.
  constraint match_recommendation_runs_completed_shape_check
    check (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null)
    ),

  -- Only a failed run carries an error message.
  constraint match_recommendation_runs_error_shape_check
    check (status = 'failed' or error is null)
);

comment on table public.match_recommendation_runs is
  'One assisted-matching exercise: which provider and prompt version proposed which pairs, for which season. A run proposes; it never creates a match.';
comment on column public.match_recommendation_runs.params is
  'Run settings (rounds, shortlist size, batch size). Never the prompt text: the payload sent to the provider is anonymised, and storing it here would re-create the identifiable record.';

create index if not exists match_recommendation_runs_season_idx
  on public.match_recommendation_runs (season_id, created_at desc);

create index if not exists match_recommendation_runs_batch_idx
  on public.match_recommendation_runs (intake_batch_id)
  where intake_batch_id is not null;

-- One run at a time per season: two runs proposing different pairs from the
-- same free slots would both look authoritative and would double-book mentors.
create unique index if not exists match_recommendation_runs_one_active_idx
  on public.match_recommendation_runs (season_id)
  where status = 'running';

-- ------------------------------------------------------------
-- 2. match_recommendations
-- ------------------------------------------------------------
create table if not exists public.match_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.match_recommendation_runs(id) on delete cascade,
  round smallint not null default 1,

  mentor_person_id uuid not null references public.people(id) on delete restrict,
  -- The mentee is still an application at this point: a profile is created only
  -- when an organiser approves the pair.
  mentee_application_id uuid not null references public.applications(id) on delete restrict,
  mentee_person_id uuid null references public.people(id) on delete set null,

  score numeric(4, 3) null,
  rationale text null,

  status text not null default 'pending',
  decided_by uuid null references public.admin_users(id) on delete set null,
  decided_at timestamptz null,
  match_id uuid null references public.matches(id) on delete set null,

  created_at timestamptz not null default now(),

  -- One proposal per mentee per run: the run proposes a pairing, not a menu.
  constraint match_recommendations_unique_mentee unique (run_id, mentee_application_id),

  constraint match_recommendations_round_check check (round >= 1 and round <= 5),

  constraint match_recommendations_score_check
    check (score is null or (score >= 0 and score <= 1)),

  constraint match_recommendations_status_check
    check (status in ('pending', 'approved', 'rejected', 'superseded')),

  -- A decided pair records when it was decided; a pending one has not been.
  constraint match_recommendations_decided_shape_check
    check (
      (status = 'pending' and decided_at is null)
      or (status <> 'pending' and decided_at is not null)
    ),

  -- A match id may only exist on a pair somebody approved.
  constraint match_recommendations_match_shape_check
    check (match_id is null or status = 'approved')
);

comment on table public.match_recommendations is
  'The proposed mentor-mentee pairs of one run. Every row starts pending: a match exists only after an organiser approves the pair, and creating it re-checks the mentor capacity.';
comment on column public.match_recommendations.score is
  'The provider fit score, 0..1. Advisory only — the order pairs are offered in, never a threshold that acts on its own.';
comment on column public.match_recommendations.status is
  'pending = waiting for an organiser. approved = a match was created. rejected = an organiser said no. superseded = a later run replaced this proposal.';

create index if not exists match_recommendations_run_status_idx
  on public.match_recommendations (run_id, status, score desc);

create index if not exists match_recommendations_application_idx
  on public.match_recommendations (mentee_application_id, created_at desc);

create index if not exists match_recommendations_mentor_idx
  on public.match_recommendations (mentor_person_id, status);

-- ------------------------------------------------------------
-- 3. match_recommendation_log (append-only)
-- ------------------------------------------------------------
create table if not exists public.match_recommendation_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.match_recommendation_runs(id) on delete restrict,
  recommendation_id uuid null references public.match_recommendations(id) on delete set null,
  action text not null,
  detail jsonb null,
  reason text null,
  actor_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint match_recommendation_log_action_check
    check (action in (
      'run_created',
      'run_completed',
      'run_failed',
      'approved',
      'rejected',
      'superseded',
      'discarded'
    ))
);

comment on table public.match_recommendation_log is
  'Append-only audit of assisted-matching runs and the decisions taken on their pairs. UPDATE and DELETE are blocked by trigger, matching selection_run_log (migration 066).';

create index if not exists match_recommendation_log_run_idx
  on public.match_recommendation_log (run_id, created_at desc);

create or replace function public.prevent_match_recommendation_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'match_recommendation_log is append-only';
end;
$$;

drop trigger if exists match_recommendation_log_no_update on public.match_recommendation_log;
create trigger match_recommendation_log_no_update
before update on public.match_recommendation_log
for each row
execute function public.prevent_match_recommendation_log_mutation();

drop trigger if exists match_recommendation_log_no_delete on public.match_recommendation_log;
create trigger match_recommendation_log_no_delete
before delete on public.match_recommendation_log
for each row
execute function public.prevent_match_recommendation_log_mutation();

-- ------------------------------------------------------------
-- 4. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.match_recommendation_runs enable row level security;
alter table public.match_recommendations     enable row level security;
alter table public.match_recommendation_log  enable row level security;

revoke all on public.match_recommendation_runs from public, anon, authenticated;
revoke all on public.match_recommendations     from public, anon, authenticated;
revoke all on public.match_recommendation_log  from public, anon, authenticated;

grant select, insert, update, delete on public.match_recommendation_runs to service_role;
grant select, insert, update, delete on public.match_recommendations     to service_role;
grant select, insert                 on public.match_recommendation_log  to service_role;

-- ------------------------------------------------------------
-- 5. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'match_recommendation_runs',
    'match_recommendations',
    'match_recommendation_log'
  ];
  offending text;
begin
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
