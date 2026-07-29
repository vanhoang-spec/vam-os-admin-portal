-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 05: Import Matches
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- Prerequisites:
--   * Modules 02, 03, 04 committed in the SAME SESSION
--   * _ham_prod_identity_map and _ham_prod_context temp tables still exist
--   * Source CSV _ham_prod_matches_source must be pre-loaded:
--       \copy _ham_prod_matches_source from 'data_imports/ham/ham_matches_clean.csv'
--         with (format csv, header true, encoding 'UTF8')
--
-- Writes:
--   INSERT public.matches (new rows only; conflict-guarded by season + people pair)
--
-- Deletes: NONE
-- Updates: NONE
-- UEH rows: NEVER touched
--
-- KEY DIFFERENCES FROM STAGING MODULE:
--   * Name-key fallback is DISABLED. Match resolution uses email only.
--   * Rows where mentor_email or mentee_email is missing are logged as skips.
--   * No staging UUID reuse.
-- ============================================================

begin;

-- ── Production guard ──────────────────────────────────────────────────────────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: module 05 must not be executed without owner authorization.';
end;
$$;

-- ── Context check ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from _ham_prod_context) then
    raise exception 'CONTEXT FAIL: _ham_prod_context is empty. Run module 02 first. Stop.';
  end if;
end;
$$;

-- ── Source count assertion ─────────────────────────────────────────────────────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from _ham_prod_matches_source
  where upper(coalesce(import_ready, '')) = 'TRUE';

  if v_count <> 60 then
    raise exception
      'SOURCE COUNT ASSERTION: Expected 60 import_ready match rows, got %. Stop.',
      v_count;
  end if;
  raise notice 'PASS: match source count = %', v_count;
end;
$$;

-- ── Match resolution ──────────────────────────────────────────────────────────
-- Resolution priority:
--   1. Email match (authoritative) — when mentor_email or mentee_email is present
--   2. Name-key fallback — when email is absent, use normalized name-key
--      (name-key = lower, strip diacritics Đđ→Dd, strip parentheticals, collapse non-alnum to space)
--
-- Source data note: ham_matches_clean.csv has mentor_email absent for all 60 rows.
-- All 52 mentor names are unique in the people source — name-key fallback is safe.
-- 2 source rows reference a mentor name not found in the people source (same name, 2 mentees);
-- those 2 rows will be skipped and logged (reason: unresolved_mentor_name).
-- Expected resolved: 58. Expected skipped: 2.

create temp table _ham_prod_match_ready as
with mentor_by_email as (
  select
    m.person_id as mentor_person_id,
    lower(trim(coalesce(p.email_primary, ''))) as email_norm,
    lower(
      regexp_replace(
        regexp_replace(
          translate(p.full_name, 'Đđ', 'Dd'),
          '\([^)]*\)', ' ', 'g'
        ),
        '[^[:alnum:]]+', ' ', 'g'
      )
    ) as name_key
  from _ham_prod_identity_map m
  join public.people p on p.id = m.person_id
  where m.ham_role = 'mentor' and m.person_id is not null
),
mentee_by_email as (
  select
    m.person_id as mentee_person_id,
    lower(trim(coalesce(p.email_primary, ''))) as email_norm
  from _ham_prod_identity_map m
  join public.people p on p.id = m.person_id
  where m.ham_role = 'mentee' and m.person_id is not null
)
select
  ms.*,
  ml.mentor_person_id,
  mtl.mentee_person_id
from _ham_prod_matches_source ms
left join mentor_by_email ml
  on (
    -- Email match (authoritative): use when mentor_email is present
    lower(nullif(trim(ms.mentor_email), '')) is not null
    and ml.email_norm = lower(nullif(trim(ms.mentor_email), ''))
  )
  or (
    -- Name-key fallback: use when mentor_email is absent
    lower(nullif(trim(ms.mentor_email), '')) is null
    and ml.name_key = lower(
      regexp_replace(
        regexp_replace(
          translate(ms.mentor_name, 'Đđ', 'Dd'),
          '\([^)]*\)', ' ', 'g'
        ),
        '[^[:alnum:]]+', ' ', 'g'
      )
    )
  )
left join mentee_by_email mtl
  on lower(nullif(trim(ms.mentee_email), '')) is not null
  and mtl.email_norm = lower(nullif(trim(ms.mentee_email), ''))
where upper(coalesce(ms.import_ready, '')) = 'TRUE'
on commit drop;

-- ── Log unresolved matches ────────────────────────────────────────────────────
create temp table _ham_prod_match_skips as
select
  nullif(row_num, '')::int as source_row,
  source_file, source_sheet,
  case
    when mentor_person_id is null and mentee_person_id is null then 'unresolved_both_endpoints'
    when mentor_person_id is null and lower(nullif(trim(mentor_email), '')) is null
      then 'unresolved_mentor_name'
    when mentor_person_id is null then 'unresolved_mentor_email'
    when mentee_person_id is null then 'unresolved_mentee_email'
    else 'unknown'
  end as reason
from _ham_prod_match_ready
where mentor_person_id is null or mentee_person_id is null
on commit drop;

-- ── Assert skip count ──────────────────────────────────────────────────────────
-- Expected: exactly 2 rows skipped (same mentor name not in people source, 2 mentees)
do $$
declare
  v_skip_count integer;
begin
  select count(*) into v_skip_count from _ham_prod_match_skips;
  if v_skip_count <> 2 then
    raise exception
      'ASSERTION FAIL: Expected exactly 2 skipped match rows, got %. Investigate before proceeding. Stop.',
      v_skip_count;
  end if;
  raise notice 'PASS: match skip count = % (expected 2)', v_skip_count;
end;
$$;

-- ── Insert matches ────────────────────────────────────────────────────────────
-- NOTE: matches.season_code is absent from production schema.
-- Season is linked canonically via season_id (UUID FK to seasons table).
-- season_id is resolved from _ham_prod_context (seasons.code = 'HAM-S6').
insert into public.matches (
  mentor_id,
  mentee_id,
  season_id,
  status,
  mentor_person_id,
  mentee_person_id,
  match_type,
  match_source_raw,
  match_confidence,
  notes,
  match_reason,
  primary_match
)
select
  ready.mentor_person_id,
  ready.mentee_person_id,
  ctx.season_id,
  'active',
  ready.mentor_person_id,
  ready.mentee_person_id,
  'primary',
  'HAM_S6 production import',
  1.0,
  concat_ws(E'\n',
    'HAM-S6 production import.',
    'source_file=' || coalesce(ready.source_file, ''),
    'source_sheet=' || coalesce(ready.source_sheet, ''),
    'source_row=' || coalesce(ready.row_num, ''),
    'direction=' || coalesce(ready.direction, '')
  ),
  nullif(ready.direction, ''),
  true
from _ham_prod_match_ready ready
cross join _ham_prod_context ctx
where ready.mentor_person_id is not null
  and ready.mentee_person_id is not null
  and not exists (
    select 1 from public.matches existing
    where existing.season_id = ctx.season_id
      and existing.mentor_person_id = ready.mentor_person_id
      and existing.mentee_person_id = ready.mentee_person_id
  );

-- ── Assertions ────────────────────────────────────────────────────────────────
do $$
declare
  v_match_count integer;
  v_skip_count  integer;
begin
  select count(*) into v_match_count
  from public.matches
  where season_id = (select season_id from _ham_prod_context);

  select count(*) into v_skip_count from _ham_prod_match_skips;

  raise notice 'MATCHES: inserted=%, skipped=%', v_match_count, v_skip_count;

  if v_match_count <> 58 then
    raise exception
      'ASSERTION FAIL: Expected exactly 58 active HAM-S6 matches, got %. Stop.',
      v_match_count;
  end if;

  raise notice 'PASS: match assertions satisfied';
end;
$$;

-- ── Summary ───────────────────────────────────────────────────────────────────
select
  'matches_imported' as metric,
  (select count(*)::text from public.matches where season_id = (select season_id from _ham_prod_context)) as value
union all
select 'matches_skipped', count(*)::text from _ham_prod_match_skips;

commit;
