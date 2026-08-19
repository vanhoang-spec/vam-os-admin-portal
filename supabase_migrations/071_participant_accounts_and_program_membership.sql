-- ============================================================
-- Migration 071 — Participant logins, programme membership, current season
-- ============================================================
--
-- Purpose: until now VAM OS has been a staff-only portal. Mentors and mentees
-- have no accounts at all — they reach the system through per-person tokenised
-- links in email, and `admin_users` holds six staff roles, none of which means
-- "mentor" or "mentee".
--
-- This migration is the data model for giving them accounts: sign in with an
-- email and a password, land in the programme they belong to, and see the
-- season that programme is actually running.
--
-- ============================================================
-- THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM
-- ============================================================
-- Identity is separated from membership.
--
--   * participant_accounts        — one login  ↔ one person. 1:1, permanent.
--   * person_program_memberships  — one person ↔ many programmes. Toggleable.
--   * programs.current_season_id  — the season a programme is running.
--
-- A mentor who teaches at UEH and at BK is then two membership rows on one
-- identity, and a super admin can add or disable either one without touching
-- their login. Season is derived from the programme rather than stored on the
-- membership, so a programme rolling into its next season does not mean
-- rewriting a row per person.
--
-- This is also why `account_person_auth_links` (migration 062) is left alone:
-- its `auth_user_id UNIQUE` plus `person_id UNIQUE` allow a participant exactly
-- one (programme, season, role), which is the case this work exists to support.
--
-- ============================================================
-- WHY PARTICIPANTS DO NOT GO IN admin_users
-- ============================================================
-- Adding 'mentor'/'mentee' to admin_users.role would reuse every existing
-- mechanism — middleware, cookies, layout — and save a great deal of code. It
-- was rejected because of how it fails. `middleware.ts` admits any admin_users
-- row with status='active', and `app/layout.tsx` then renders the full staff
-- shell. A mentee who slipped through would be looking at /people, /matches and
-- /mentors: empty for want of scope, but rendered.
--
-- With a separate table, `getCurrentAdminUser()` returns null for a
-- participant, so the default failure is refusal rather than exposure. For the
-- records of eleven hundred people, that is the direction to fail in.
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064-070: RLS enabled, zero policies,
-- every privilege revoked from PUBLIC/anon/authenticated, and only what
-- service_role needs granted.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It creates no accounts and grants no memberships. Every table starts
--     empty; rows arrive from the backfill script and from the admin screen.
--   * It does not alter people, matches, person_season_memberships or
--     applications.
--   * It touches admin_users only to widen its own role vocabulary by one
--     value, and adds one nullable column to programs.
--   * It sets no programme's current season. Doing that is a data decision,
--     made in the app by a super admin.
--
-- Idempotent: create-if-not-exists / add-if-missing throughout.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 071';
  end if;
  if to_regclass('public.programs') is null then
    raise exception 'PREREQ_MISSING: public.programs is required by migration 071';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 071';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 071';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: public.outbound_emails (migration 064) is required by migration 071';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() is required by migration 071';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. participant_accounts — one login, one person
-- ------------------------------------------------------------
create table if not exists public.participant_accounts (
  id uuid primary key default gen_random_uuid(),

  -- The Supabase Auth user. Unique both ways: a login belongs to exactly one
  -- person, and a person has at most one login. Everything about which
  -- programmes they may enter lives in the membership table, not here.
  auth_user_id uuid not null,
  person_id uuid not null references public.people(id) on delete cascade,

  -- 'disabled' revokes access without deleting the link, so re-enabling later
  -- does not risk pointing the login at a different person.
  status text not null default 'active'
    constraint participant_accounts_status_check
    check (status in ('active', 'disabled')),

  -- How the link came to exist. 'self_register' means the address matched
  -- exactly one person in people.email_primary; anything ambiguous is refused
  -- in the application layer rather than guessed at here.
  link_source text not null default 'invite'
    constraint participant_accounts_link_source_check
    check (link_source in ('invite', 'self_register', 'admin')),

  invited_at timestamptz null,
  activated_at timestamptz null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint participant_accounts_auth_user_key unique (auth_user_id),
  constraint participant_accounts_person_key unique (person_id)
);

comment on table public.participant_accounts is
  'One Supabase Auth login mapped to one people row. Identity only — programme access lives in person_program_memberships.';
comment on column public.participant_accounts.person_id is
  'Unique: a person has at most one login, so a mentor in two programmes still signs in once.';
comment on column public.participant_accounts.link_source is
  'invite (staff sent one), self_register (email matched exactly one person), admin (linked by hand).';

create index if not exists participant_accounts_person_idx
  on public.participant_accounts (person_id);

create index if not exists participant_accounts_status_idx
  on public.participant_accounts (status)
  where status = 'active';

drop trigger if exists participant_accounts_set_updated_at on public.participant_accounts;
create trigger participant_accounts_set_updated_at
  before update on public.participant_accounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. person_program_memberships — who may enter which programme
-- ------------------------------------------------------------
create table if not exists public.person_program_memberships (
  id uuid primary key default gen_random_uuid(),

  person_id uuid not null references public.people(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete restrict,

  -- Two roles only, matching what the programme actually runs. The nine-value
  -- vocabulary on person_season_memberships is for season-level operations;
  -- this table answers a narrower question — which programmes appear on the
  -- picker after somebody signs in.
  role text not null
    constraint person_program_memberships_role_check
    check (role in ('mentor', 'mentee')),

  -- 'inactive' is how a super admin closes a programme for one person at a
  -- point in time without erasing that they were ever in it.
  status text not null default 'active'
    constraint person_program_memberships_status_check
    check (status in ('active', 'inactive')),

  source text not null default 'manual'
    constraint person_program_memberships_source_check
    check (source in ('backfill', 'manual', 'application', 'import')),

  notes text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per person per programme per role. A person can be a mentee at one
  -- school and a mentor at another, and the same person can even be both in one
  -- programme across different seasons.
  constraint person_program_memberships_person_program_role_key
    unique (person_id, program_id, role)
);

comment on table public.person_program_memberships is
  'Programme-level roster. Read by the post-login programme picker; season comes from programs.current_season_id, not from here.';
comment on column public.person_program_memberships.status is
  'inactive closes a programme for this person without erasing the history that they were in it.';
comment on column public.person_program_memberships.source is
  'backfill (derived from matches), manual (a super admin added it), application, import.';

create index if not exists person_program_memberships_person_idx
  on public.person_program_memberships (person_id)
  where status = 'active';

create index if not exists person_program_memberships_program_idx
  on public.person_program_memberships (program_id, role)
  where status = 'active';

drop trigger if exists person_program_memberships_set_updated_at on public.person_program_memberships;
create trigger person_program_memberships_set_updated_at
  before update on public.person_program_memberships
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. person_program_membership_log — append-only
-- ------------------------------------------------------------
-- Granting and revoking programme access decides what a person can see. That
-- has to be answerable after the fact, so every change is written here and
-- nothing is ever updated or deleted.
create table if not exists public.person_program_membership_log (
  id uuid primary key default gen_random_uuid(),

  membership_id uuid null references public.person_program_memberships(id) on delete set null,
  person_id uuid not null,
  program_id uuid not null,
  role text not null,

  old_status text null,
  new_status text not null,
  transition_type text not null
    constraint person_program_membership_log_transition_check
    check (transition_type in ('created', 'activated', 'deactivated', 'backfill', 'system')),

  reason text null,
  changed_by uuid null references public.admin_users(id) on delete set null,
  changed_at timestamptz not null default now()
);

comment on table public.person_program_membership_log is
  'Append-only record of programme access being granted or withdrawn. Never updated, never deleted.';

create index if not exists person_program_membership_log_person_idx
  on public.person_program_membership_log (person_id, changed_at desc);

-- ------------------------------------------------------------
-- 4. programs.current_season_id — the season a programme is running
-- ------------------------------------------------------------
-- Today "the current season" is one hardcoded string shared by the whole
-- system. Five programmes running out of step need one each, and it needs to be
-- something a super admin can change without a deploy.
--
-- A column on programs rather than a flag on seasons: exactly one current
-- season per programme is then guaranteed by construction, not by a constraint
-- somebody has to remember.
alter table public.programs
  add column if not exists current_season_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'programs_current_season_fkey'
      and conrelid = 'public.programs'::regclass
  ) then
    alter table public.programs
      add constraint programs_current_season_fkey
      foreign key (current_season_id) references public.seasons(id) on delete set null;
  end if;
end;
$$;

comment on column public.programs.current_season_id is
  'The season this programme is currently running. Null means not set — the app falls back to the highest season code.';

-- ------------------------------------------------------------
-- 5. admin_users.role — add vam_admin
-- ------------------------------------------------------------
-- Read-only across every programme: generates and exports reports, operates
-- nothing. Every existing permission predicate is an allow-list, so this role
-- is refused everywhere by default and has to be granted access explicitly.
alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (
    role in (
      'viewer',
      'reviewer',
      'support_team',
      'core_team',
      'admin',
      'super_admin',
      'vam_admin'
    )
  );

comment on constraint admin_users_role_check on public.admin_users is
  'Staff roles. vam_admin (migration 071) reads and exports across programmes and operates nothing.';

-- ------------------------------------------------------------
-- 6. outbound_emails.kind — the invitation
-- ------------------------------------------------------------
-- Roughly 1,100 mentors and mentees need an account, and every one of those
-- letters is logged like all the others, so a send that silently failed is
-- answerable afterwards rather than guessed at.
alter table public.outbound_emails
  drop constraint if exists outbound_emails_kind_check;

alter table public.outbound_emails
  add constraint outbound_emails_kind_check
  check (kind in (
    'mentor_confirmation_link',
    'mentee_application_confirmation',
    'mentor_application_confirmation',
    'review_batch_assigned',
    'interview_scheduled',
    'reviewer_invite',
    'mentee_selected',
    'mentee_mentor_intro',
    'mentor_mentee_package',
    'kickoff_invite',
    'recap_period_reminder',
    'participant_invite'
  ));

-- ------------------------------------------------------------
-- 7. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.participant_accounts            enable row level security;
alter table public.person_program_memberships      enable row level security;
alter table public.person_program_membership_log   enable row level security;

revoke all on public.participant_accounts          from public, anon, authenticated;
revoke all on public.person_program_memberships    from public, anon, authenticated;
revoke all on public.person_program_membership_log from public, anon, authenticated;

grant select, insert, update, delete on public.participant_accounts          to service_role;
grant select, insert, update, delete on public.person_program_memberships    to service_role;
-- Append-only: no update, no delete, not even for service_role.
grant select, insert                 on public.person_program_membership_log to service_role;

-- ------------------------------------------------------------
-- 8. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'participant_accounts',
    'person_program_memberships',
    'person_program_membership_log'
  ];
  offending text;
begin
  -- 8a. One login, one person — in both directions.
  if not exists (
    select 1 from pg_constraint
    where conname = 'participant_accounts_auth_user_key'
      and conrelid = 'public.participant_accounts'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: auth_user_id is not unique';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'participant_accounts_person_key'
      and conrelid = 'public.participant_accounts'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: person_id is not unique';
  end if;

  -- 8b. One membership row per person per programme per role.
  if not exists (
    select 1 from pg_constraint
    where conname = 'person_program_memberships_person_program_role_key'
      and conrelid = 'public.person_program_memberships'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: membership is not unique per person/program/role';
  end if;

  -- 8c. The new role must be accepted, and the six existing ones preserved.
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_users_role_check'
      and conrelid = 'public.admin_users'::regclass
      and pg_get_constraintdef(oid) like '%vam_admin%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: admin_users.role does not accept vam_admin';
  end if;

  if exists (
    select 1 from public.admin_users
    where role not in ('viewer', 'reviewer', 'support_team', 'core_team', 'admin', 'super_admin', 'vam_admin')
  ) then
    raise exception 'DATA_CONTRACT_VIOLATION: admin_users holds a role outside the new vocabulary';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_emails_kind_check'
      and conrelid = 'public.outbound_emails'::regclass
      and pg_get_constraintdef(oid) like '%participant_invite%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept participant_invite';
  end if;

  -- 8d. Every programme can name a season.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'programs' and column_name = 'current_season_id'
  ) then
    raise exception 'COLUMN_CONTRACT_VIOLATION: programs.current_season_id is missing';
  end if;

  -- 8e. RLS on, no policies, no client-role privileges.
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

  -- 8f. The log stays append-only even for the only role that can reach it.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
             x.privilege_type
      from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
    ) a(grantee_name, privilege_type)
    where n.nspname = 'public'
      and c.relname = 'person_program_membership_log'
      and a.grantee_name = 'service_role'
      and a.privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'GRANT_CONTRACT_VIOLATION: membership log must be append-only';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
