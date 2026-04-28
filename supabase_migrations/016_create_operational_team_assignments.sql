-- Phase 2 operational team assignments.
-- Records VAM operational assignments without creating duplicate people.
-- Coreteam/support team rows must map to existing people records.
-- Future Auth/RLS can use this table as one input for permission mapping, but not yet.

create table if not exists operational_team_assignments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  person_id uuid not null references people(id),
  source_role_group text not null,
  operational_role text not null,
  functional_team text null,
  team_name text null,
  assigned_scope text null,
  role_note text null,
  status text not null default 'active',
  source_sheet text null,
  source_row integer null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint operational_team_assignments_source_role_group_check
    check (source_role_group in ('coreteam', 'support_team')),

  constraint operational_team_assignments_operational_role_check
    check (
      operational_role in (
        'core_team',
        'ops_lead',
        'recap_steward',
        'event_steward',
        'data_quality_reviewer',
        'reviewer',
        'support_team_member',
        'event_support',
        'design_support',
        'communication_support',
        'project_coordination_support',
        'other'
      )
    ),

  constraint operational_team_assignments_functional_team_check
    check (
      functional_team is null
      or functional_team in (
        'project_coordination',
        'communication_media',
        'event',
        'design',
        'other',
        'unknown'
      )
    ),

  constraint operational_team_assignments_status_check
    check (status in ('active', 'inactive', 'needs_review')),

  constraint operational_team_assignments_unique_assignment
    unique (season_id, person_id, operational_role, functional_team)
);

comment on table operational_team_assignments is
  'Records VAM operational assignments for existing people. Does not create new people. Future Auth/RLS can use this table as one input, but not yet.';

comment on column operational_team_assignments.season_id is
  'Season for the operational assignment.';

comment on column operational_team_assignments.person_id is
  'Existing people.id. Coreteam/support team must map to existing people records; this table must not duplicate people.';

comment on column operational_team_assignments.source_role_group is
  'Source group from team workbook, such as coreteam or support_team.';

comment on column operational_team_assignments.operational_role is
  'Operational role used for internal operations, stewardship, and future permission mapping.';

comment on column operational_team_assignments.functional_team is
  'Functional team grouping such as project_coordination, communication_media, event, or design.';

comment on column operational_team_assignments.team_name is
  'Human-readable team name from the source workbook or reviewed assignment file.';

comment on column operational_team_assignments.assigned_scope is
  'Optional scope of assignment, such as event ownership, recap sweep, or data review area.';

comment on column operational_team_assignments.role_note is
  'Preserves source role notes such as lead, co-lead, or member.';

comment on column operational_team_assignments.status is
  'Current assignment status for internal operations.';

comment on column operational_team_assignments.source_sheet is
  'Source workbook sheet used for traceability.';

comment on column operational_team_assignments.source_row is
  'Source workbook row number used for traceability.';

create index if not exists operational_team_assignments_season_id_idx
  on operational_team_assignments(season_id);

create index if not exists operational_team_assignments_person_id_idx
  on operational_team_assignments(person_id);

create index if not exists operational_team_assignments_operational_role_idx
  on operational_team_assignments(operational_role);

create index if not exists operational_team_assignments_source_role_group_idx
  on operational_team_assignments(source_role_group);

create index if not exists operational_team_assignments_functional_team_idx
  on operational_team_assignments(functional_team);

create index if not exists operational_team_assignments_status_idx
  on operational_team_assignments(status);

drop trigger if exists operational_team_assignments_set_updated_at on operational_team_assignments;

create trigger operational_team_assignments_set_updated_at
before update on operational_team_assignments
for each row
execute function set_updated_at();
