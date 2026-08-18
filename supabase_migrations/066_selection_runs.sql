-- ============================================================
-- Migration 066 — Selection runs (ranking, main list, reserve list)
-- ============================================================
--
-- Purpose: after every mentee application in a batch has been scored, the
-- organisers rank them and cut the list at the number of mentee places that
-- actually exist — the sum of the capacities mentors confirmed for the season
-- (mentor_season_confirmations, migration 064) — plus a reserve group of about
-- 10% who are invited if somebody in the main list drops out.
--
-- That calculation is a proposal, not an action. A run is computed and stored
-- as `draft` so the organisers can look at it; only when someone applies the
-- run do application statuses change. Applying is recorded, so the list that
-- produced the invitations is still there afterwards.
--
-- Objects created:
--   1. public.selection_runs       — one ranking exercise
--   2. public.selection_run_items  — the ranked applications in that run
--   3. public.selection_run_log    — append-only audit of run transitions
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migration 064: RLS enabled, zero policies, every
-- privilege revoked from PUBLIC/anon/authenticated, and only what service_role
-- needs granted. All reads and writes go through lib/selection.ts, which checks
-- `canDecide` plus operations scope on the season before touching a row.
--
-- The items table stores an application id and a score, so it inherits the
-- sensitivity of the application itself.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It alters no existing table, column, constraint or CHECK. In particular
--     applications, application_reviews, admin_audit_log and the membership
--     tables are untouched, so the frozen release package still applies.
--   * It writes no data.
--   * It creates no function beyond the append-only guard below, and reuses
--     public.set_updated_at() from migration 052.
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
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 066';
  end if;
  if to_regclass('public.intake_batches') is null then
    raise exception 'PREREQ_MISSING: public.intake_batches is required by migration 066';
  end if;
  if to_regclass('public.applications') is null then
    raise exception 'PREREQ_MISSING: public.applications is required by migration 066';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 066';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() (migration 052) is required by migration 066';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. selection_runs
-- ------------------------------------------------------------
create table if not exists public.selection_runs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid null references public.intake_batches(id) on delete restrict,
  role_applied text not null default 'mentee',

  -- How the cut was computed
  capacity_total integer not null,
  reserve_pct smallint not null default 10,
  scored_count integer not null default 0,
  unscored_count integer not null default 0,
  main_count integer not null default 0,
  reserve_count integer not null default 0,

  status text not null default 'draft',
  params jsonb null,
  note text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  applied_by uuid null references public.admin_users(id) on delete set null,
  applied_at timestamptz null,
  discarded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint selection_runs_status_check
    check (status in ('draft', 'applied', 'discarded')),

  constraint selection_runs_capacity_check
    check (capacity_total >= 0),

  constraint selection_runs_reserve_pct_check
    check (reserve_pct >= 0 and reserve_pct <= 100),

  constraint selection_runs_counts_check
    check (main_count >= 0 and reserve_count >= 0 and scored_count >= 0 and unscored_count >= 0),

  constraint selection_runs_note_length_check
    check (note is null or char_length(note) <= 1000),

  -- An applied run must record who applied it and when; a draft must not.
  constraint selection_runs_applied_shape_check
    check (
      (status = 'applied' and applied_at is not null)
      or (status <> 'applied' and applied_at is null)
    )
);

comment on table public.selection_runs is
  'One ranking exercise over the scored applications of an intake batch. Draft until an operator applies it; applying is what changes application statuses.';
comment on column public.selection_runs.capacity_total is
  'Number of mentee places available: the sum of confirmed mentor capacities for the season at the moment the run was computed.';
comment on column public.selection_runs.reserve_pct is
  'Size of the standby group as a percentage of capacity_total, rounded up. Invited only when someone in the main list withdraws.';
comment on column public.selection_runs.unscored_count is
  'Applications in scope that had no submitted screening score when the run was computed. A run with unscored applications is incomplete by definition.';

create index if not exists selection_runs_season_status_idx
  on public.selection_runs (season_id, status, created_at desc);

create index if not exists selection_runs_batch_idx
  on public.selection_runs (intake_batch_id);

-- At most one draft per (batch, role): two operators must not build competing
-- proposals that each look authoritative.
create unique index if not exists selection_runs_one_draft_per_batch_role_idx
  on public.selection_runs (intake_batch_id, role_applied)
  where status = 'draft';

drop trigger if exists selection_runs_set_updated_at on public.selection_runs;

create trigger selection_runs_set_updated_at
before update on public.selection_runs
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. selection_run_items
-- ------------------------------------------------------------
create table if not exists public.selection_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.selection_runs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete restrict,

  rank integer not null,
  total_score numeric(6, 2) null,
  review_count smallint not null default 0,
  -- `group` is a reserved word in SQL, hence the prefix.
  selection_group text not null,
  tie_break_note text null,

  /** Status written onto the application when the run was applied, if any. */
  applied_status text null,
  promoted_at timestamptz null,

  created_at timestamptz not null default now(),

  constraint selection_run_items_unique_application unique (run_id, application_id),

  constraint selection_run_items_rank_check check (rank >= 1),

  constraint selection_run_items_group_check
    check (selection_group in ('main', 'reserve', 'below')),

  constraint selection_run_items_review_count_check check (review_count >= 0)
);

comment on table public.selection_run_items is
  'The ranked applications of one selection run. `main` are invited to interview, `reserve` are the standby group, `below` are the rest — recorded so the cut can be explained afterwards.';
comment on column public.selection_run_items.promoted_at is
  'Set when a reserve application was promoted into the main list because a place opened up.';

create index if not exists selection_run_items_run_rank_idx
  on public.selection_run_items (run_id, rank);

create index if not exists selection_run_items_application_idx
  on public.selection_run_items (application_id);

-- ------------------------------------------------------------
-- 3. selection_run_log (append-only)
-- ------------------------------------------------------------
create table if not exists public.selection_run_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.selection_runs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  action text not null,
  application_id uuid null references public.applications(id) on delete set null,
  detail jsonb null,
  reason text null,
  actor_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint selection_run_log_action_check
    check (action in ('created', 'applied', 'discarded', 'reserve_promoted'))
);

comment on table public.selection_run_log is
  'Append-only audit of selection-run transitions. UPDATE and DELETE are blocked by trigger, matching person_season_membership_log (migration 052).';

create index if not exists selection_run_log_run_idx
  on public.selection_run_log (run_id, created_at desc);

create or replace function public.prevent_selection_run_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'selection_run_log is append-only';
end;
$$;

drop trigger if exists selection_run_log_no_update on public.selection_run_log;
create trigger selection_run_log_no_update
before update on public.selection_run_log
for each row
execute function public.prevent_selection_run_log_mutation();

drop trigger if exists selection_run_log_no_delete on public.selection_run_log;
create trigger selection_run_log_no_delete
before delete on public.selection_run_log
for each row
execute function public.prevent_selection_run_log_mutation();

-- ------------------------------------------------------------
-- 4. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.selection_runs      enable row level security;
alter table public.selection_run_items enable row level security;
alter table public.selection_run_log   enable row level security;

revoke all on public.selection_runs      from public, anon, authenticated;
revoke all on public.selection_run_items from public, anon, authenticated;
revoke all on public.selection_run_log   from public, anon, authenticated;

grant select, insert, update, delete on public.selection_runs      to service_role;
grant select, insert, update, delete on public.selection_run_items to service_role;
grant select, insert                 on public.selection_run_log   to service_role;

-- ------------------------------------------------------------
-- 5. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array['selection_runs', 'selection_run_items', 'selection_run_log'];
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
