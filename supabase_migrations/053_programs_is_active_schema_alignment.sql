-- Migration 053: programs.is_active schema alignment
--
-- Context:
--   Migration 036 creates public.programs with is_active for fresh installs,
--   but environments where public.programs already existed before 036 can miss
--   the column because CREATE TABLE IF NOT EXISTS does not add missing columns.
--
-- Scope:
--   * Add programs.is_active when absent.
--   * Default existing and future rows to active.
--   * No data deletion, production backfill, or RLS changes.

alter table public.programs
  add column if not exists is_active boolean not null default true;

comment on column public.programs.is_active is
  'Active catalog flag. Added as schema alignment for environments where programs predated migration 036.';

notify pgrst, 'reload schema';
