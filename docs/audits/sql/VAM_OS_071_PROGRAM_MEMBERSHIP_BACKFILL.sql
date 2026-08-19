-- ============================================================
-- VAM OS — backfilling programme membership from the pairs (migration 071)
-- ============================================================
--
-- RUN THIS BY HAND, ON STAGING FIRST, WITH A BACKUP TAKEN.
-- Migration 071 must already be applied, and the programmes-and-seasons seed
-- should have run first.
--
-- ------------------------------------------------------------
-- WHY IT READS FROM `matches` AND NOT FROM `person_season_memberships`
-- ------------------------------------------------------------
-- `person_season_memberships` is the table that ought to answer "who was in
-- which programme". On production it holds ZERO rows — the S12 release
-- preflight refuses to run if it holds any, and that is the recorded state.
--
-- `matches` is the only reliable record of who was actually paired, and every
-- pair carries a season, and every season carries a programme. So the chain
--
--     matches → seasons → programs
--
-- reconstructs the roster from what the programme actually did rather than from
-- a table nobody has populated yet.
--
-- ------------------------------------------------------------
-- WHAT IT DOES
-- ------------------------------------------------------------
-- One row per (person, programme, role), marked `source = 'backfill'`, for
-- every person who has ever been on either side of a pair. A mentor at UEH and
-- at BK gets two rows, which is the whole point.
--
-- ------------------------------------------------------------
-- WHAT IT DOES NOT DO
-- ------------------------------------------------------------
--   * It creates no logins. Membership says which programmes somebody may
--     enter; `participant_accounts` says whether they can sign in at all, and
--     those rows come from invitations or from self-registration.
--   * It never overwrites a membership somebody set by hand. A row that already
--     exists is left exactly as it is, including one deliberately set to
--     'inactive' — re-running this must not silently re-admit somebody an
--     organiser removed.
--   * It writes nothing for a pair whose season has no programme.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.person_program_memberships') is null then
    raise exception 'PREREQ_MISSING: migration 071 has not been applied';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. Count what is there before, so the change is measurable
-- ------------------------------------------------------------
-- Keep this output. It is the "before" half of the reconciliation.
--
--   select count(*) as memberships_before from public.person_program_memberships;

-- ------------------------------------------------------------
-- 2. Mentors
-- ------------------------------------------------------------
insert into public.person_program_memberships (person_id, program_id, role, status, source, notes)
select distinct
  m.mentor_person_id,
  s.program_id,
  'mentor',
  'active',
  'backfill',
  'Suy ra từ bảng cặp ghép khi mở đăng nhập cho mentor và mentee.'
from public.matches m
join public.seasons s on s.id = m.season_id
where m.mentor_person_id is not null
  and s.program_id is not null
on conflict (person_id, program_id, role) do nothing;

-- ------------------------------------------------------------
-- 3. Mentees
-- ------------------------------------------------------------
insert into public.person_program_memberships (person_id, program_id, role, status, source, notes)
select distinct
  m.mentee_person_id,
  s.program_id,
  'mentee',
  'active',
  'backfill',
  'Suy ra từ bảng cặp ghép khi mở đăng nhập cho mentor và mentee.'
from public.matches m
join public.seasons s on s.id = m.season_id
where m.mentee_person_id is not null
  and s.program_id is not null
on conflict (person_id, program_id, role) do nothing;

-- ------------------------------------------------------------
-- 4. Record every row this produced
-- ------------------------------------------------------------
-- The log is append-only and is how "why can this person see UEH?" stays
-- answerable a year from now.
insert into public.person_program_membership_log
  (membership_id, person_id, program_id, role, old_status, new_status, transition_type, reason)
select
  ppm.id, ppm.person_id, ppm.program_id, ppm.role, null, ppm.status, 'backfill',
  'Backfill từ bảng cặp ghép, migration 071.'
from public.person_program_memberships ppm
where ppm.source = 'backfill'
  and not exists (
    select 1 from public.person_program_membership_log l
    where l.membership_id = ppm.id and l.transition_type = 'backfill'
  );

-- ------------------------------------------------------------
-- 5. Self-check
-- ------------------------------------------------------------
do $$
declare
  orphaned bigint;
  unlogged bigint;
begin
  -- Nothing may point at a programme or a person that does not exist. The
  -- foreign keys already guarantee this; the check is here so a failed
  -- assumption stops the transaction rather than surfacing months later.
  select count(*)
    into orphaned
  from public.person_program_memberships ppm
  left join public.programs p on p.id = ppm.program_id
  left join public.people pe on pe.id = ppm.person_id
  where p.id is null or pe.id is null;

  if orphaned > 0 then
    raise exception 'BACKFILL_INVALID: % membership rows point at a missing person or programme', orphaned;
  end if;

  select count(*)
    into unlogged
  from public.person_program_memberships ppm
  where ppm.source = 'backfill'
    and not exists (
      select 1 from public.person_program_membership_log l
      where l.membership_id = ppm.id
    );

  if unlogged > 0 then
    raise exception 'BACKFILL_INVALID: % backfilled rows have no log entry', unlogged;
  end if;
end;
$$;

commit;

-- ------------------------------------------------------------
-- 6. Read back — run after committing and keep the output
-- ------------------------------------------------------------
-- The "after" half of the reconciliation. Compare the totals against what the
-- programme believes it has; a large gap means pairs are missing a season, or a
-- season is missing its programme.
--
--   select p.code,
--          count(*) filter (where ppm.role = 'mentor') as mentors,
--          count(*) filter (where ppm.role = 'mentee') as mentees
--   from public.person_program_memberships ppm
--   join public.programs p on p.id = ppm.program_id
--   where ppm.status = 'active'
--   group by p.code
--   order by p.code;
--
-- Pairs that could not be attributed to a programme — expect zero, and
-- investigate before inviting anybody if it is not:
--
--   select count(*) as pairs_without_programme
--   from public.matches m
--   left join public.seasons s on s.id = m.season_id
--   where s.program_id is null;
