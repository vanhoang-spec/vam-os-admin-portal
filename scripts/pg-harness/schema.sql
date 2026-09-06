-- Minimal synthetic schema for the disposable PostgreSQL harness.
--
-- It is NOT the production schema and does not pretend to be. It contains only
-- the tables and helper functions the two migrations under test actually touch,
-- so those migrations can be loaded verbatim and their real bodies executed.
--
-- Anything the migrations do not read is absent on purpose: a fixture that
-- mirrors production drifts from it silently, while one that carries exactly
-- the columns under test fails loudly when a migration starts using more.

create table admin_users (
  id uuid primary key default gen_random_uuid(),
  email text,
  full_name text,
  role text not null,
  status text not null default 'active',
  auth_user_id uuid
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  code text,
  is_active boolean not null default true
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs(id),
  code text
);

create table intake_batches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id),
  code text
);

create table people (
  id uuid primary key default gen_random_uuid(),
  full_name text
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid,
  season_id uuid references seasons(id),
  intake_batch_id uuid references intake_batches(id),
  role_applied text,
  status text,
  submitted_at timestamptz default now()
);

create table application_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id),
  reviewer_admin_user_id uuid references admin_users(id),
  assigned_by uuid references admin_users(id),
  review_round text not null,
  assigned_at timestamptz,
  due_at timestamptz,
  status text not null,
  score_motivation integer,
  score_goal_clarity integer,
  score_commitment integer,
  score_fit integer,
  score_communication integer,
  total_score integer,
  recommendation text,
  reviewer_note text,
  submitted_at timestamptz,
  assignment_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id),
  decided_by uuid references admin_users(id),
  decided_by_name text,
  decision text not null,
  previous_status text,
  new_status text not null,
  decision_note text,
  created_at timestamptz not null default now()
);

create table recruitment_assignment_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id),
  review_round text not null,
  event_type text not null,
  previous_review_id uuid,
  replacement_review_id uuid,
  previous_reviewer_admin_user_id uuid,
  new_reviewer_admin_user_id uuid,
  actor_admin_user_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create table recruitment_stage_requirements (
  season_id uuid not null references seasons(id),
  review_stage text not null,
  minimum_submitted_reviews integer not null,
  primary key (season_id, review_stage)
);

create table review_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  intake_batch_id uuid,
  review_round text,
  created_by uuid,
  due_at timestamptz,
  assignment_note text,
  application_count integer,
  reviewer_count integer,
  created_at timestamptz not null default now()
);

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text,
  action_type text,
  actor_admin_user_id uuid,
  actor_email text,
  target_admin_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  details jsonb,
  created_at timestamptz not null default now()
);

create table admin_scope_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  program_id uuid,
  season_id text,
  role text,
  status text
);

create table vam063_trusted_api_role_result (api_role text);
insert into vam063_trusted_api_role_result values ('service_role');

create table person_season_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid,
  season_id uuid,
  role text,
  status text,
  created_at timestamptz not null default now()
);

create table person_season_invites (
  id uuid primary key default gen_random_uuid(),
  person_id uuid,
  season_id uuid,
  role text,
  revoked_at timestamptz,
  submitted_at timestamptz,
  outcome text
);
