-- 036_mentor_taxonomy_and_programs.sql
-- Adds first-class catalog tables (programs, industries, function_areas) and
-- many-to-many joins for mentor profiles. Also seeds initial program rows and
-- backfills existing mentor_profiles.industry / .function_area free-text values
-- into the new normalized structure.
--
-- SAFETY:
--   * Idempotent: every DDL uses `if not exists`, every seed/backfill is
--     `on conflict do nothing` or guarded.
--   * No destructive operations: no DROP, no RENAME, no ALTER ... DROP COLUMN.
--   * mentor_profiles.industry and mentor_profiles.function_area are KEPT as
--     backward-compat fields. Application layer continues to write the primary
--     selected value into them so the founder intelligence dashboard and
--     existing list filters keep working unchanged.
--   * audit-only programs_participating data from previous create flow is NOT
--     auto-parsed here (per product decision). Document any backfill before
--     retiring those audit notes.

-- ---------------------------------------------------------------------------
-- 1. Catalog tables
-- ---------------------------------------------------------------------------

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_code_unique unique (code),
  constraint programs_code_not_blank check (length(trim(code)) > 0),
  constraint programs_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.programs is
  'First-class mentoring program (e.g. UEH, HAM, FTU). One program may host many seasons; the program -> seasons link will be added in a follow-up migration.';

create table if not exists public.industries (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industries_code_unique unique (code),
  constraint industries_code_not_blank check (length(trim(code)) > 0),
  constraint industries_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.industries is
  'Industry catalog backing mentor_industries many-to-many. Backfilled from existing mentor_profiles.industry distinct values.';

create table if not exists public.function_areas (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint function_areas_code_unique unique (code),
  constraint function_areas_code_not_blank check (length(trim(code)) > 0),
  constraint function_areas_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.function_areas is
  'Function/specialty catalog backing mentor_function_areas many-to-many. Named function_areas to avoid name collisions with the SQL keyword `function`.';

-- ---------------------------------------------------------------------------
-- 2. Triggers to keep updated_at fresh on catalog rows
-- ---------------------------------------------------------------------------

drop trigger if exists programs_set_updated_at on public.programs;
create trigger programs_set_updated_at
before update on public.programs
for each row execute function set_updated_at();

drop trigger if exists industries_set_updated_at on public.industries;
create trigger industries_set_updated_at
before update on public.industries
for each row execute function set_updated_at();

drop trigger if exists function_areas_set_updated_at on public.function_areas;
create trigger function_areas_set_updated_at
before update on public.function_areas
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Join tables
-- ---------------------------------------------------------------------------

create table if not exists public.mentor_program_participations (
  id uuid primary key default gen_random_uuid(),
  mentor_profile_id uuid not null references public.mentor_profiles(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete restrict,
  status text not null default 'active',
  role text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mentor_program_participations_unique unique (mentor_profile_id, program_id),
  constraint mentor_program_participations_status_check
    check (status in ('active', 'inactive', 'paused', 'ended'))
);

comment on table public.mentor_program_participations is
  'Many-to-many: a mentor can participate in multiple programs (UEH, HAM, FTU, ...). status tracks current engagement per program.';

create index if not exists mentor_program_participations_mentor_idx
  on public.mentor_program_participations(mentor_profile_id);

create index if not exists mentor_program_participations_program_idx
  on public.mentor_program_participations(program_id);

drop trigger if exists mentor_program_participations_set_updated_at on public.mentor_program_participations;
create trigger mentor_program_participations_set_updated_at
before update on public.mentor_program_participations
for each row execute function set_updated_at();

create table if not exists public.mentor_industries (
  mentor_profile_id uuid not null references public.mentor_profiles(id) on delete cascade,
  industry_id uuid not null references public.industries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (mentor_profile_id, industry_id)
);

comment on table public.mentor_industries is
  'Many-to-many between mentor_profiles and industries. Source of truth for mentor industry coverage. mentor_profiles.industry kept as backward-compat primary value.';

create index if not exists mentor_industries_industry_idx
  on public.mentor_industries(industry_id);

create table if not exists public.mentor_function_areas (
  mentor_profile_id uuid not null references public.mentor_profiles(id) on delete cascade,
  function_area_id uuid not null references public.function_areas(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (mentor_profile_id, function_area_id)
);

comment on table public.mentor_function_areas is
  'Many-to-many between mentor_profiles and function_areas. Source of truth for mentor function/specialty coverage. mentor_profiles.function_area kept as backward-compat primary value.';

create index if not exists mentor_function_areas_function_idx
  on public.mentor_function_areas(function_area_id);

-- ---------------------------------------------------------------------------
-- 4. Naming convention (PROGRAM -> SEASON -> BATCH hierarchy)
-- ---------------------------------------------------------------------------
-- programs.code is the stable short identifier for a mentoring program.
-- One program hosts many seasons; one season can be split into batches.
--
--   programs.code        -> short program identifier (no season suffix)
--                           UEHM, HAM, FTU, BK, HUFLIT, HUB, DUE
--   seasons.code         -> "<program_code>-S<n>" (e.g. UEHM-S12)
--   intake_batches.code  -> "<season_code>-B<n>" (e.g. UEHM-S12-B1, UEHM-S12-B2)
--                           "B" = batch. Do NOT use "W" for wave.
--
-- Storage hierarchy:
--   programs (1) -> seasons (many) -> intake_batches (many)
--
-- This migration defines the catalog table for intake_batches but does NOT
-- seed any batch rows. The intake intake/application form is intentionally
-- out of scope; it will be wired in a follow-up migration. Until then,
-- intake_batches.code follows the "<season_code>-B<n>" convention above.
--
-- ---------------------------------------------------------------------------
-- 5. Seed initial programs catalog
-- ---------------------------------------------------------------------------

insert into public.programs (code, name) values
  ('UEHM',   'UEH Mentoring'),
  ('HAM',    'Hanoi Alumni Mentoring'),
  ('FTU',    'FTU Mentoring'),
  ('BK',     'BK Mentoring'),
  ('HUFLIT', 'HUFLIT Mentoring'),
  ('HUB',    'HUB Mentoring'),
  ('DUE',    'DUE Mentoring')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Backfill industries catalog and mentor_industries from free text
-- ---------------------------------------------------------------------------

insert into public.industries (code, name)
select distinct
  lower(regexp_replace(trim(industry), '\s+', '_', 'g')) as code,
  trim(industry) as name
from public.mentor_profiles
where industry is not null
  and length(trim(industry)) > 0
on conflict (code) do nothing;

insert into public.mentor_industries (mentor_profile_id, industry_id)
select mp.id, i.id
from public.mentor_profiles mp
join public.industries i
  on i.code = lower(regexp_replace(trim(mp.industry), '\s+', '_', 'g'))
where mp.industry is not null
  and length(trim(mp.industry)) > 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Backfill function_areas catalog and mentor_function_areas from free text
-- ---------------------------------------------------------------------------

insert into public.function_areas (code, name)
select distinct
  lower(regexp_replace(trim(function_area), '\s+', '_', 'g')) as code,
  trim(function_area) as name
from public.mentor_profiles
where function_area is not null
  and length(trim(function_area)) > 0
on conflict (code) do nothing;

insert into public.mentor_function_areas (mentor_profile_id, function_area_id)
select mp.id, f.id
from public.mentor_profiles mp
join public.function_areas f
  on f.code = lower(regexp_replace(trim(mp.function_area), '\s+', '_', 'g'))
where mp.function_area is not null
  and length(trim(mp.function_area)) > 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Intake batch catalog (program -> season -> batch hierarchy)
-- ---------------------------------------------------------------------------
-- A season may be split into one or more intake batches (B1, B2, ...).
-- This migration only defines the catalog table; no rows are seeded.
-- The intake/application form will be added in a follow-up migration.

create table if not exists public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_batches_season_code_unique unique (season_id, code),
  constraint intake_batches_code_not_blank check (length(trim(code)) > 0),
  constraint intake_batches_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.intake_batches is
  'Intake batches inside a season. Code follows "<season_code>-B<n>" convention (e.g. UEHM-S12-B1). Unique per (season_id, code). No rows seeded by this migration.';

create index if not exists intake_batches_season_idx
  on public.intake_batches(season_id);

drop trigger if exists intake_batches_set_updated_at on public.intake_batches;
create trigger intake_batches_set_updated_at
before update on public.intake_batches
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. (Intentionally NOT done here)
--    * No backfill from admin_audit_log.programs_participating.
--      Those rows were stored as audit-only free text and may contain
--      ambiguous values. Backfill by hand or via a follow-up migration once
--      the program code mapping is reviewed.
--    * No DROP / RENAME of mentor_profiles.industry or .function_area.
--      They remain populated with the primary selected value for
--      backward-compat with the founder intelligence dashboard and the
--      mentors-list industry/function filters.
--    * No seed rows for intake_batches. Batch creation will be driven by the
--      intake form in a follow-up migration.
-- ---------------------------------------------------------------------------
