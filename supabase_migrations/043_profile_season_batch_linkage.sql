-- ============================================================
-- Migration 043 — Profile season/batch linkage
--
-- Adds source_application_id and intake_batch_id to both
-- mentor_profiles and mentee_profiles so approved S12
-- applications can be traced back to the intake batch they
-- came from.
--
-- Backfills existing approved profiles by matching on person_id
-- against applications with status approved_as_mentor /
-- approved_as_mentee.
--
-- Idempotent: all DDL uses `if not exists`; backfill WHERE clauses
-- only update rows whose columns are still NULL, so re-running is safe.
--
-- Dependencies (must already exist):
--   - public.applications       (predates migration history)
--   - public.intake_batches     (036_mentor_taxonomy_and_programs)
--   - public.mentor_profiles    (predates migration history)
--   - public.mentee_profiles    (predates migration history)
-- ============================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. mentor_profiles — source linkage columns
-- ---------------------------------------------------------------------------

alter table public.mentor_profiles
  add column if not exists source_application_id uuid references public.applications(id);

alter table public.mentor_profiles
  add column if not exists intake_batch_id uuid references public.intake_batches(id);

create index if not exists mentor_profiles_source_application_idx
  on public.mentor_profiles(source_application_id)
  where source_application_id is not null;

create index if not exists mentor_profiles_intake_batch_idx
  on public.mentor_profiles(intake_batch_id)
  where intake_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 2. mentee_profiles — source linkage columns
-- ---------------------------------------------------------------------------

alter table public.mentee_profiles
  add column if not exists source_application_id uuid references public.applications(id);

alter table public.mentee_profiles
  add column if not exists intake_batch_id uuid references public.intake_batches(id);

create index if not exists mentee_profiles_source_application_idx
  on public.mentee_profiles(source_application_id)
  where source_application_id is not null;

create index if not exists mentee_profiles_intake_batch_idx
  on public.mentee_profiles(intake_batch_id)
  where intake_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Backfill mentor_profiles
--    Join approved_as_mentor applications to profiles via person_id.
--    Guard: only fills rows whose linkage columns are still NULL so
--    re-running this migration never overwrites manually-set values.
-- ---------------------------------------------------------------------------

update public.mentor_profiles mp
set
  source_application_id = a.id,
  intake_batch_id       = a.intake_batch_id
from public.applications a
where a.person_id               = mp.person_id
  and a.status                  = 'approved_as_mentor'
  and mp.source_application_id is null
  and mp.intake_batch_id        is null;

-- ---------------------------------------------------------------------------
-- 4. Backfill mentee_profiles — same pattern
-- ---------------------------------------------------------------------------

update public.mentee_profiles mtp
set
  source_application_id = a.id,
  intake_batch_id       = a.intake_batch_id
from public.applications a
where a.person_id                = mtp.person_id
  and a.status                   = 'approved_as_mentee'
  and mtp.source_application_id is null
  and mtp.intake_batch_id        is null;

commit;
