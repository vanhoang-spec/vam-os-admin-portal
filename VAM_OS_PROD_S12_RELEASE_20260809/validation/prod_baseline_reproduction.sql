-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — BASELINE REPRODUCTION
--
-- NOT PART OF THE RELEASE. Never run against any Supabase project.
--
-- Builds a disposable local reproduction of the live Production baseline that
-- owner-run Probe A / Probe B captured on 2026-08-09, so preflight.sql, the
-- four apply transactions, verifier.sql and tests.sql can be EXECUTED before
-- any of them is proposed for Production. See VALIDATION.md.
--
-- Reproduced deliberately, because each one changes the outcome:
--   * admin_audit_log with all 13 Production columns, including the four
--     legacy ones, and with `action` NOT NULL and no default — the worst case
--     T1 section 1 exists for.
--   * NO action_type CHECK, and zero audit rows.
--   * RLS enabled on exactly {admin_audit_log, application_decisions, programs,
--     seasons, admin_scope_access} and disabled on the other eight.
--   * broad anon/authenticated grants on the Day-1 tables.
--   * the untouched 7-value migration-052 transition_type vocabulary.
--   * profile person_id FKs already canonical (CASCADE / NO ACTION /
--     DEFERRABLE INITIALLY DEFERRED / VALID) — the M067 NOT REQUIRED evidence.
--   * admin_scope_access holding season/program CODES, not UUIDs — the
--     Phase 5 Decision A evidence.
--   * no supabase_migrations.schema_migrations (Probe A2's 42P01).
-- =============================================================================

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

-- ── Reference ───────────────────────────────────────────────────────────────
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  is_active boolean not null default true
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  program_id uuid references public.programs(id)
);

create table public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  season_id uuid not null references public.seasons(id) on delete restrict,
  is_active boolean not null default true
);

-- ── Identity ────────────────────────────────────────────────────────────────
create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email_primary text,
  phone_primary text,
  gender text,
  created_at timestamptz not null default now()
);

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  email text not null unique,
  full_name text,
  role text not null check (role in ('viewer','reviewer','support_team','core_team','admin','super_admin')),
  status text not null check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- program_id / season_id are TEXT and, on live Production, hold CODES.
create table public.admin_scope_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  program_id text,
  season_id text,
  role text not null default 'read' check (role in ('full_access','operations','review','read')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Applications and profiles ───────────────────────────────────────────────
-- Column names follow the RC's own queries (lib/data.ts getApplications /
-- getInterviewCandidates, app/applications/page.tsx): season_id, role_applied,
-- status, final_status, sbd, submitted_at. Probe D is written against these.
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id),
  intake_batch_id uuid references public.intake_batches(id),
  role_applied text,
  status text,
  final_status text,
  person_id uuid references public.people(id),
  full_name text,
  email_primary text,
  sbd text,
  submitted_at timestamptz not null default now()
);

create table public.mentor_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid,
  source_application_id uuid references public.applications(id),
  intake_batch_id uuid references public.intake_batches(id),
  created_at timestamptz not null default now(),
  constraint mentor_profiles_person_id_fkey foreign key (person_id)
    references public.people(id) on delete cascade on update no action
    deferrable initially deferred
);

create table public.mentee_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid,
  source_application_id uuid references public.applications(id),
  intake_batch_id uuid references public.intake_batches(id),
  created_at timestamptz not null default now(),
  constraint mentee_profiles_person_id_fkey foreign key (person_id)
    references public.people(id) on delete cascade on update no action
    deferrable initially deferred
);

create index mentor_profiles_source_application_id_idx on public.mentor_profiles(source_application_id)
  where source_application_id is not null;
create index mentee_profiles_source_application_id_idx on public.mentee_profiles(source_application_id)
  where source_application_id is not null;
create index mentor_profiles_intake_batch_id_idx on public.mentor_profiles(intake_batch_id)
  where intake_batch_id is not null;
create index mentee_profiles_intake_batch_id_idx on public.mentee_profiles(intake_batch_id)
  where intake_batch_id is not null;

create table public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  decided_by uuid,
  decided_by_name text,
  decision text,
  previous_status text,
  new_status text,
  decision_note text,
  created_at timestamptz not null default now()
);

-- ── Audit: the 13-column Production shape ───────────────────────────────────
-- Column order matches Probe A's report. `action` is NOT NULL with no default
-- on purpose: it is the worst case T1 section 1 exists to repair.
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_email text,
  target_email text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  actor_admin_user_id uuid references public.admin_users(id),
  target_admin_user_id uuid references public.admin_users(id),
  updated_at timestamptz not null default now(),
  action_type text not null,
  details jsonb,
  before_data jsonb,
  after_data jsonb
);

-- ── Membership ──────────────────────────────────────────────────────────────
create table public.person_season_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  program_id uuid not null references public.programs(id),
  season_id uuid not null references public.seasons(id),
  intake_batch_id uuid references public.intake_batches(id),
  role text not null check (role in ('mentor','mentee')),
  status text not null check (status in ('invited','active','paused','withdrawn','opted_out','cancelled')),
  source text not null default 'manual' check (source in ('manual','import','system')),
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, season_id, role)
);

create table public.person_season_membership_log (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.person_season_memberships(id),
  person_id uuid not null,
  program_id uuid not null,
  season_id uuid not null,
  role text not null,
  old_status text,
  new_status text not null,
  transition_type text not null,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now(),
  constraint person_season_membership_log_transition_type_check
    check (transition_type = any (array['created','status_change','role_change','rollover','backfill','manual','system']))
);

-- ── Live RLS baseline (Probe A) ─────────────────────────────────────────────
alter table public.admin_audit_log        enable row level security;
alter table public.application_decisions  enable row level security;
alter table public.programs               enable row level security;
alter table public.seasons                enable row level security;
alter table public.admin_scope_access     enable row level security;
-- the other eight are left with RLS DISABLED, as Probe A reports.

-- ── Live grant baseline (Probe A: broad anon/authenticated table grants) ────
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger
  on all tables in schema public to anon, authenticated, service_role;

-- ── Seed (Probe B business codes; no PII) ───────────────────────────────────
insert into public.programs (code, name, is_active) values
  ('UEHM','UEH Mentoring', true), ('VAM','VAM', true);

insert into public.seasons (code, name, program_id)
select v.code, v.code, p.id from (values ('UEHM-S11'),('UEHM-S12')) v(code)
cross join public.programs p where p.code = 'UEHM';

insert into public.intake_batches (code, season_id, is_active)
select 'UEHM-S12-B1', s.id, true from public.seasons s where s.code = 'UEHM-S12';

insert into public.admin_users (auth_user_id, email, full_name, role, status)
values (gen_random_uuid(), 'launch-operator@example.invalid', 'Launch operator', 'super_admin', 'active');

-- Scope rows in CODE form, exactly as Probe B reports for Production.
insert into public.admin_scope_access (user_id, program_id, season_id, role, status)
select a.auth_user_id, 'UEHM', 'UEHM-S11', 'full_access', 'active'
from public.admin_users a where a.email = 'launch-operator@example.invalid';

-- A handful of applications so Probe D has something to order and count.
-- No PII: synthetic local parts on the reserved .invalid domain.
insert into public.applications (season_id, intake_batch_id, role_applied, status, person_id, full_name, email_primary, sbd, submitted_at)
select s.id, b.id,
       case when g % 2 = 0 then 'mentor' else 'mentee' end,
       'submitted', null,
       'Repro applicant ' || g,
       'repro-' || g || '@example.invalid',
       case when g <= 14 then null else 'SBD' || lpad(g::text, 4, '0') end,
       now() - ((40 - g) || ' days')::interval
from generate_series(1, 40) g
cross join public.seasons s
join public.intake_batches b on b.season_id = s.id
where s.code = 'UEHM-S12';
