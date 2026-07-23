-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 07: Rollback Design
--
-- This module is a DESIGN DOCUMENT for post-commit rollback.
-- Automatic ROLLBACK (during transaction) occurs in modules 02–05
-- if any assertion fails — no manual action needed for mid-import failures.
--
-- This module covers the case where ALL modules committed successfully
-- but the owner later decides to remove the HAM-S6 import from production.
--
-- Authorization phrase required before any rollback:
--   (owner must define and issue a separate rollback authorization phrase)
--
-- Scope of this rollback:
--   * Deletes HAM-S6-specific matches
--   * Deletes HAM-S6-specific season memberships
--   * Deletes HAM-S6-specific mentor and mentee profiles (HAM-S6-B1 batch only)
--   * Deletes HAM-S6 intake batch (HAM-S6-B1)
--   * Deletes HAM-S6 season
--   * Deletes newly inserted HAM-only people (no other program references)
--   * Does NOT delete the HAM program row (seeded by migration 036)
--   * Does NOT touch UEH rows
--   * Does NOT touch shared-people (people who existed before this import
--     or who are referenced by UEH seasons)
--   * Does NOT delete audit logs
-- ============================================================

-- ── Production guard (must be removed by authorized execution plan only) ───────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: rollback module must not be executed without separate explicit owner authorization.';
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK DESIGN (not for direct execution — review carefully before adapting)
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ── Step R1: Identify HAM-S6 context ─────────────────────────────────────────
create temp table _rollback_context as
select
  s.id as season_id,
  ib.id as intake_batch_id
from public.seasons s
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where s.code = 'HAM-S6'
limit 1
on commit drop;

do $$
begin
  if not exists (select 1 from _rollback_context) then
    raise exception 'ROLLBACK: HAM-S6 context not found — nothing to roll back. Stop.';
  end if;
  raise notice 'ROLLBACK: HAM-S6 context found. Proceeding.';
end;
$$;

-- ── Step R2: Record pre-rollback counts ──────────────────────────────────────
select
  'pre_rollback_counts' as checkpoint,
  (select count(*) from public.matches m where m.season_id = (select season_id from _rollback_context))::int as matches,
  (select count(*) from public.person_season_memberships psm where psm.season_id = (select season_id from _rollback_context))::int as memberships,
  (
    select count(*) from public.mentor_profiles mp
    where mp.intake_batch_id = (select intake_batch_id from _rollback_context)
  )::int as mentor_profiles,
  (
    select count(*) from public.mentee_profiles mtp
    where mtp.intake_batch_id = (select intake_batch_id from _rollback_context)
  )::int as mentee_profiles;

-- ── Step R3: Delete HAM-S6 matches ───────────────────────────────────────────
delete from public.matches
where season_id = (select season_id from _rollback_context);

-- ── Step R4: Delete HAM-S6 season memberships ────────────────────────────────
delete from public.person_season_memberships
where season_id = (select season_id from _rollback_context);

-- ── Step R5: Delete HAM-S6-B1 mentor profiles ────────────────────────────────
delete from public.mentor_profiles
where intake_batch_id = (select intake_batch_id from _rollback_context);

-- ── Step R6: Delete HAM-S6-B1 mentee profiles ────────────────────────────────
delete from public.mentee_profiles
where intake_batch_id = (select intake_batch_id from _rollback_context);

-- ── Step R7: Delete HAM-only people (no other season memberships, not UEH) ────
-- A person is HAM-only if:
--   * Their data_quality_flags contains 'source_season=HAM_S6' (import provenance marker)
--   * They have NO other season memberships after R4
--   * They have NO UEH-linked profiles
-- Shared people (pre-existing before this import) are preserved.
delete from public.people
where data_quality_flags like '%source_season=HAM_S6%'
  and not exists (
    select 1 from public.person_season_memberships psm
    where psm.person_id = people.id
  )
  and not exists (
    select 1 from public.mentor_profiles mp
    where mp.person_id = people.id
  )
  and not exists (
    select 1 from public.mentee_profiles mtp
    where mtp.person_id = people.id
  );

-- ── Step R8: Delete HAM-S6-B1 intake batch ───────────────────────────────────
delete from public.intake_batches
where id = (select intake_batch_id from _rollback_context);

-- ── Step R9: Delete HAM-S6 season ────────────────────────────────────────────
delete from public.seasons
where id = (select season_id from _rollback_context);

-- ── Step R10: Assert clean state ──────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.seasons where code = 'HAM-S6') then
    raise exception 'ROLLBACK FAIL: HAM-S6 season still exists. Stop.';
  end if;
  if exists (select 1 from public.intake_batches where code = 'HAM-S6-B1') then
    raise exception 'ROLLBACK FAIL: HAM-S6-B1 batch still exists. Stop.';
  end if;
  raise notice 'ROLLBACK PASS: HAM-S6 season and batch removed';
end;
$$;

-- ── Step R11: Verify UEH rows are unchanged ───────────────────────────────────
-- Owner must compare to baseline_before_import recorded in module 01.
select
  'post_rollback_ueh_check' as checkpoint,
  (select count(*) from public.seasons where code in ('UEHM-S11','UEHM-S12'))::int as ueh_seasons,
  (select count(*) from public.matches m join public.seasons s on s.id = m.season_id where s.code in ('UEHM-S11','UEHM-S12'))::int as ueh_matches;

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SCOPE BOUNDARIES (what this rollback does NOT delete)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- PRESERVED:
--   * programs.code = 'HAM' (seeded by migration 036; not owned by this import)
--   * People with pre-existing season memberships or profiles (shared people)
--   * All UEHM-S11, UEHM-S12 rows
--   * admin_users, admin_scope_access rows (provisioned separately)
--   * mentoring_recaps for HAM-S6 (if recap import was run separately)
--   * Any audit/tracking tables not created by this import
--
-- NOT COVERED BY THIS ROLLBACK (require separate decision):
--   * HAM program row (safe to leave; does no harm)
--   * HAM admin accounts in auth and admin_users (provisioned separately)
--   * Production backup snapshots
-- ══════════════════════════════════════════════════════════════════════════════
