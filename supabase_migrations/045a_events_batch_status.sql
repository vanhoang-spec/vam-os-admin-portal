-- =============================================================================
-- Phase 045A: Events foundation cleanup — batch linkage + status field
-- =============================================================================
-- Safe additions only. Uses IF NOT EXISTS throughout. No data deleted.
-- Existing events backfill to status = 'active' via column DEFAULT.
-- =============================================================================

-- 1. Add intake_batch_id (nullable FK to intake_batches)
alter table public.events
  add column if not exists intake_batch_id uuid
    references public.intake_batches(id) on delete set null;

-- 2. Add status with safe default so existing rows become 'active'
alter table public.events
  add column if not exists status text not null default 'active';

-- 3. Constrain allowed status values (skip if already present — idempotent via DO block)
do $$
begin
  if not exists (
    select 1
    from   pg_constraint
    where  conname = 'events_status_check'
      and  conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_status_check
      check (status in ('active', 'cancelled'));
  end if;
end;
$$;

-- 4. Indexes
create index if not exists events_intake_batch_idx
  on public.events (intake_batch_id)
  where intake_batch_id is not null;

create index if not exists events_status_idx
  on public.events (status);

-- 5. Column documentation
comment on column public.events.intake_batch_id is
  'Phase 045A: optional link to a specific intake batch (e.g. UEHM-S12-B1). NULL = applies to whole season.';
comment on column public.events.status is
  'Phase 045A: active (default) | cancelled. Cancelled events are hidden from normal view but not deleted.';
