-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 02: Seed Program, Season, and Intake Batch
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- Prerequisites:
--   * Module 01 (preflight_assertions) completed with zero failures
--   * Production backup taken (Gate C in execution runbook)
--
-- Writes:
--   INSERT public.programs     (1 row, conflict = do nothing — row already exists)
--   INSERT public.seasons      (1 new row: HAM-S6)
--   INSERT public.intake_batches (1 new row: HAM-S6-B1)
--
-- Deletes: NONE
-- Updates: NONE
-- Cross-program mutations: NONE
-- ============================================================

begin;

-- ── Production guard ──────────────────────────────────────────────────────────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: module 02 must not be executed without owner authorization and completion of all preflight gates.';
end;
$$;

-- ── Insert HAM program (no-op if already exists from migration 036) ───────────
insert into public.programs (code, name)
values ('HAM', 'Hanoi Alumni Mentoring')
on conflict (code) do nothing;

-- ── Insert HAM-S6 season linked to HAM program ────────────────────────────────
insert into public.seasons (program_id, code, name)
select p.id, 'HAM-S6', 'HAM Season 6'
from public.programs p
where p.code = 'HAM'
on conflict (code) do nothing;

-- ── Insert HAM-S6-B1 intake batch linked to HAM-S6 ───────────────────────────
insert into public.intake_batches (season_id, code, name, is_active)
select s.id, 'HAM-S6-B1', 'HAM Season 6 - Main intake', true
from public.seasons s
where s.code = 'HAM-S6'
on conflict (season_id, code) do nothing;

-- ── Post-insert assertion ─────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from public.programs p
    join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
    join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
    where p.code = 'HAM'
  ) then
    raise exception 'ASSERTION FAIL: HAM / HAM-S6 / HAM-S6-B1 linkage not established after insert. Rolling back.';
  end if;
  raise notice 'PASS: HAM / HAM-S6 / HAM-S6-B1 linkage verified';
end;
$$;

-- ── Verification query (informational) ───────────────────────────────────────
select
  p.code as program_code,
  s.code as season_code,
  ib.code as batch_code,
  ib.is_active as batch_is_active
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM';

commit;

notify pgrst, 'reload schema';
