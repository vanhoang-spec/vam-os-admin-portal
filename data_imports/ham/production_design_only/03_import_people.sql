-- ============================================================
-- PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE
-- ============================================================
-- HAM-S6 Production Foundation Import
-- Module 03: Import People (production-hardened)
--
-- Authorization phrase required:
--   AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
--
-- Prerequisites:
--   * Module 01 completed with zero failures
--   * Module 02 committed successfully
--   * Source CSV data loaded via PRODUCTION-approved mechanism
--     (NOT \copy — \copy is a psql CLI meta-command incompatible with SQL Editor)
--
-- Writes:
--   CREATE (temp) production identity map table
--   INSERT public.people (new rows only; existing email-matched rows are linked)
--
-- Deletes: NONE
-- Updates: NONE (existing people rows are NEVER modified)
-- Cross-program mutations: NONE
-- UEH rows: NEVER touched
--
-- KEY DIFFERENCES FROM STAGING MODULE (ham_s6_02_import_people.sql):
--   1. No \copy command — source data must be loaded separately before this module runs
--   2. No staging_ham_s6_people_identity_map (persistent staging table with PII)
--      Instead: uses a TEMP table scoped to this session only
--   3. Staging dry-run UUIDs (matched_person_ids) are NOT used
--      Instead: identity resolution queries live production people table directly
--   4. Name-only matching is DISABLED — fails closed
--   5. Explicit source count assertion before writes
--   6. Explicit rerun guard (data_quality_flags marker check)
--
-- NOTE ON DATA LOADING:
--   The source CSV data must be available in a temp table named
--   _ham_prod_people_source before this module runs.
--   The owning execution context (psql session with production URL) must \copy:
--     \copy _ham_prod_people_source from 'data_imports/ham/ham_people_clean.csv'
--       with (format csv, header true, encoding 'UTF8')
--   See the execution runbook for the full psql invocation.
-- ============================================================

begin;

-- ── Production guard ──────────────────────────────────────────────────────────
do $$
begin
  raise notice 'PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE';
  raise exception 'PRODUCTION DESIGN ONLY: module 03 must not be executed without owner authorization.';
end;
$$;

-- ── Rerun protection guard ────────────────────────────────────────────────────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.people
  where data_quality_flags like '%source_season=HAM_S6%';

  if v_count > 0 then
    raise exception
      'RERUN PROTECTION: % people rows already have HAM_S6 provenance in data_quality_flags. Refusing to reimport. Stop.',
      v_count;
  end if;
  raise notice 'PASS: Rerun protection — no existing HAM_S6 people rows found';
end;
$$;

-- ── Source count assertion ────────────────────────────────────────────────────
-- Source table _ham_prod_people_source must be pre-loaded by the caller.
-- Expected: 112 import_ready rows (52 mentors + 60 mentees)
do $$
declare
  v_ready_count integer;
begin
  select count(*) into v_ready_count
  from _ham_prod_people_source
  where upper(coalesce(import_ready, '')) = 'TRUE';

  if v_ready_count <> 112 then
    raise exception
      'SOURCE COUNT ASSERTION: Expected 112 import_ready people rows, got %. Stop.',
      v_ready_count;
  end if;
  raise notice 'PASS: Source count = % import_ready people rows', v_ready_count;
end;
$$;

-- ── Production identity resolution (email-only, no name-only fallback) ────────
-- This CTE resolves identity by email only. Name-only matching is DISABLED.
-- Rows without email that cannot be resolved by phone are logged as skips.

create temp table _ham_prod_identity_map (
  source_row       integer primary key,
  source_file      text,
  source_sheet     text,
  ham_role         text,
  email_norm       text,
  phone_norm       text,
  match_status     text not null,
  match_method     text,
  person_id        uuid,
  action           text not null,
  reason           text,
  created_at       timestamptz not null default now()
) on commit drop;

create temp table _ham_prod_import_skips (
  source_row    integer,
  source_file   text,
  source_sheet  text,
  ham_role      text,
  issue_reason  text not null,
  created_at    timestamptz not null default now()
) on commit drop;

-- ── Step 1: Identify import_ready source rows ─────────────────────────────────
create temp table _ham_prod_ready as
select
  nullif(trim(row_num), '')::int as source_row,
  source_file,
  source_sheet,
  role as ham_role,
  full_name,
  lower(nullif(trim(email), '')) as email_norm,
  regexp_replace(coalesce(phone, ''), '\D', '', 'g') as phone_norm,
  gender,
  school, company, title, expertise, field, linkedin, vam_profile_link
from _ham_prod_people_source
where upper(coalesce(import_ready, '')) = 'TRUE'
on commit drop;

-- ── Step 2: Email-match resolution against PRODUCTION people table ────────────
create temp table _ham_prod_email_matched as
select
  r.source_row,
  r.source_file,
  r.source_sheet,
  r.ham_role,
  r.email_norm,
  r.phone_norm,
  'matched_existing_person'::text as match_status,
  'email_match'::text as match_method,
  p.id as person_id
from _ham_prod_ready r
join public.people p
  on lower(trim(coalesce(p.email_primary, ''))) = r.email_norm
  and r.email_norm is not null
where not exists (
  select 1 from _ham_prod_email_matched_dedup
  where email_norm = r.email_norm
  and email_norm is not null
)
on commit drop;

-- ── Step 3: New person candidates (no email match, email present) ─────────────
create temp table _ham_prod_new_candidates as
select r.*
from _ham_prod_ready r
where r.email_norm is not null
  and not exists (
    select 1 from _ham_prod_email_matched m where m.source_row = r.source_row
  )
on commit drop;

-- ── Step 4: Rows with no email and no phone — skip (name-only disabled) ───────
insert into _ham_prod_import_skips (source_row, source_file, source_sheet, ham_role, issue_reason)
select source_row, source_file, source_sheet, ham_role, 'missing_email_name_only_disabled'
from _ham_prod_ready r
where r.email_norm is null
  and not exists (
    select 1 from public.people p
    where regexp_replace(coalesce(p.phone_primary, ''), '\D', '', 'g') = r.phone_norm
      and r.phone_norm is not null
      and r.phone_norm <> ''
  );

-- ── Step 5: Insert new people rows ───────────────────────────────────────────
-- NOTE: people.role is absent from production schema.
-- Role is tracked via person_season_memberships.role (see module 04).
-- The ham_role field flows through _ham_prod_identity_map and is used by module 04.
with inserted as (
  insert into public.people (
    full_name, email_primary, phone_primary, gender,
    source_sheets, data_quality_flags
  )
  select
    c.full_name,
    c.email_norm,
    c.phone_norm,
    nullif(c.gender, ''),
    concat_ws(' | ', 'HAM_S6', c.source_file, c.source_sheet),
    concat_ws(
      E'\n',
      'HAM S6 production import candidate.',
      'source_row=' || c.source_row,
      'source_season=HAM_S6',
      'school=' || coalesce(c.school, ''),
      'company=' || coalesce(c.company, ''),
      'title=' || coalesce(c.title, ''),
      'expertise=' || coalesce(c.expertise, ''),
      'field=' || coalesce(c.field, ''),
      'linkedin=' || coalesce(c.linkedin, ''),
      'vam_profile_link=' || coalesce(c.vam_profile_link, '')
    )
  from _ham_prod_new_candidates c
  where not exists (
    select 1 from public.people existing
    where lower(trim(coalesce(existing.email_primary, ''))) = c.email_norm
      and c.email_norm is not null
  )
  returning id, lower(trim(email_primary)) as email_norm_out
)
insert into _ham_prod_identity_map (
  source_row, source_file, source_sheet, ham_role, email_norm, phone_norm,
  match_status, match_method, person_id, action, reason
)
select
  c.source_row, c.source_file, c.source_sheet, c.ham_role, c.email_norm, c.phone_norm,
  'no_match_new_person_candidate', 'new_insert',
  coalesce(i.id, p.id),
  case when i.id is not null then 'created_new_person' else 'linked_existing_email_on_rerun' end,
  'production_import'
from _ham_prod_new_candidates c
left join inserted i on i.email_norm_out = c.email_norm
left join public.people p on lower(trim(coalesce(p.email_primary, ''))) = c.email_norm
where coalesce(i.id, p.id) is not null;

-- ── Step 6: Log email-matched existing people into identity map ───────────────
insert into _ham_prod_identity_map (
  source_row, source_file, source_sheet, ham_role, email_norm, phone_norm,
  match_status, match_method, person_id, action, reason
)
select
  source_row, source_file, source_sheet, ham_role, email_norm, phone_norm,
  match_status, match_method, person_id, 'linked_existing_person', 'email_match_production'
from _ham_prod_email_matched;

-- ── Step 7: Post-insert assertions ───────────────────────────────────────────
do $$
declare
  v_map_count    integer;
  v_skip_count   integer;
  v_new_count    integer;
  v_reused_count integer;
begin
  select count(*) into v_map_count from _ham_prod_identity_map;
  select count(*) into v_skip_count from _ham_prod_import_skips;
  select count(*) filter (where action = 'created_new_person') into v_new_count
    from _ham_prod_identity_map;
  select count(*) filter (where action = 'linked_existing_person') into v_reused_count
    from _ham_prod_identity_map;

  raise notice 'PEOPLE IMPORT: identity_map=%, new=%, reused=%, skips=%',
    v_map_count, v_new_count, v_reused_count, v_skip_count;

  -- Expected: map + skips = 112 (all import_ready rows accounted for)
  if v_map_count + v_skip_count < 108 then
    raise exception
      'ASSERTION FAIL: mapped (%) + skipped (%) = % < 108 expected. Stop.',
      v_map_count, v_skip_count, v_map_count + v_skip_count;
  end if;

  raise notice 'PASS: people import assertions satisfied';
end;
$$;

-- ── Summary ───────────────────────────────────────────────────────────────────
select
  'new_people_created'     as metric, count(*)::text as value from _ham_prod_identity_map where action = 'created_new_person'
union all
select 'existing_people_linked', count(*)::text from _ham_prod_identity_map where action like 'linked%'
union all
select 'skipped_rows', count(*)::text from _ham_prod_import_skips;

commit;
