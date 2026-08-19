-- ============================================================
-- VAM OS — programmes and seasons for the participant login (migration 071)
-- ============================================================
--
-- RUN THIS BY HAND, ON STAGING FIRST, WITH A BACKUP TAKEN.
-- It writes data, not schema. Migration 071 must already be applied.
--
-- ------------------------------------------------------------
-- WHY THIS EXISTS
-- ------------------------------------------------------------
-- The plan names five programmes. The database has seasons for one.
--
--   UEHM    programme + UEHM-S11 + UEHM-S12   ← the only complete one
--   HAM     programme; HAM-S6 exists on STAGING only, never on production
--   BK      programme row from migration 036, no seasons at all
--   HUFLIT  programme row from migration 036, no seasons at all
--   BAM     does not exist anywhere in the repository
--
-- Until a programme has a season, everybody entering it sees "chưa mở mùa
-- nào". That is a correct message and not a broken screen, but it is also not
-- what the owner asked for, so this script closes the gap.
--
-- ------------------------------------------------------------
-- WHAT IT DOES
-- ------------------------------------------------------------
--   1. Creates the BAM programme if it is missing.
--   2. Creates the five current seasons if they are missing.
--   3. Points programs.current_season_id at each of them.
--
-- Everything is `on conflict do nothing` or guarded, so running it twice
-- changes nothing the second time.
--
-- ------------------------------------------------------------
-- WHAT IT DOES NOT DO
-- ------------------------------------------------------------
--   * It creates no people, no memberships and no matches. Season 12 of UEHM
--     already has its own data; the four new seasons start empty by design.
--   * It does not touch UEHM-S11 or UEHM-S12, which already exist.
--   * It sets no season's status to anything but 'draft'. Opening a season for
--     applications is a separate decision made in the app.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — refuse to run against the wrong schema
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'programs' and column_name = 'current_season_id'
  ) then
    raise exception 'PREREQ_MISSING: migration 071 has not been applied (programs.current_season_id absent)';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. The one missing programme
-- ------------------------------------------------------------
insert into public.programs (code, name, is_active)
values ('BAM', 'Banking Mentoring')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2. The five current seasons
-- ------------------------------------------------------------
-- Season codes follow the convention migration 036 documents:
-- "<program_code>-S<n>". seasons.code is globally unique, which the convention
-- guarantees by construction.
insert into public.seasons (program_id, code, name, status)
select p.id, v.season_code, v.season_name, 'draft'::season_status
from (values
  ('UEHM',   'UEHM-S12',   'UEH Mentoring Season 12'),
  ('BK',     'BK-S11',     'BK Mentoring Season 11'),
  ('HAM',    'HAM-S7',     'Hanoi Alumni Mentoring Season 7'),
  ('BAM',    'BAM-S3',     'Banking Mentoring Season 3'),
  ('HUFLIT', 'HUFLIT-S2',  'HUFLIT Mentoring Season 2')
) as v(program_code, season_code, season_name)
join public.programs p on p.code = v.program_code
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 3. Point each programme at the season it is running
-- ------------------------------------------------------------
-- Without this the application falls back to the highest season code, which
-- gives the same answer today but stops being reliable the moment somebody
-- creates next season ahead of time.
update public.programs p
set current_season_id = s.id
from public.seasons s
where s.program_id = p.id
  and s.code = case p.code
    when 'UEHM'   then 'UEHM-S12'
    when 'BK'     then 'BK-S11'
    when 'HAM'    then 'HAM-S7'
    when 'BAM'    then 'BAM-S3'
    when 'HUFLIT' then 'HUFLIT-S2'
  end
  and p.code in ('UEHM', 'BK', 'HAM', 'BAM', 'HUFLIT');

-- ------------------------------------------------------------
-- 4. Self-check — fail the transaction if the result is not what was intended
-- ------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(code, ', ')
    into missing
  from (values ('UEHM'), ('BK'), ('HAM'), ('BAM'), ('HUFLIT')) as v(code)
  where not exists (select 1 from public.programs p where p.code = v.code);

  if missing is not null then
    raise exception 'SEED_INCOMPLETE: programme rows still missing: %', missing;
  end if;

  select string_agg(p.code, ', ')
    into missing
  from public.programs p
  where p.code in ('UEHM', 'BK', 'HAM', 'BAM', 'HUFLIT')
    and p.current_season_id is null;

  if missing is not null then
    raise exception 'SEED_INCOMPLETE: no current season set for: %', missing;
  end if;

  -- Every current season must belong to the programme pointing at it. Getting
  -- this wrong would put one school's participants into another's season with
  -- nothing visibly broken.
  select string_agg(p.code, ', ')
    into missing
  from public.programs p
  join public.seasons s on s.id = p.current_season_id
  where p.current_season_id is not null
    and s.program_id is distinct from p.id;

  if missing is not null then
    raise exception 'SEED_INVALID: current season belongs to another programme for: %', missing;
  end if;
end;
$$;

commit;

-- ------------------------------------------------------------
-- 5. Read back — run this after committing and keep the output
-- ------------------------------------------------------------
-- Expect five rows, each with a season name and no nulls.
--
--   select p.code, p.name, s.code as season_code, s.name as season_name
--   from public.programs p
--   left join public.seasons s on s.id = p.current_season_id
--   where p.code in ('UEHM', 'BK', 'HAM', 'BAM', 'HUFLIT')
--   order by p.code;
