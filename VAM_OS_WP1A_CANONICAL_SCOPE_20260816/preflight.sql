-- =============================================================================
-- VAM OS — WP1-A2 CANONICAL STAFF SCOPE CONVERGENCE — PREFLIGHT
--
-- READ-ONLY. This file contains no INSERT, UPDATE, DELETE, MERGE, TRUNCATE,
-- COPY, DDL, GRANT, or function definition of any kind. Its executable body is
-- SELECT statements only, and each of the two blocks below is additionally
-- wrapped in an explicitly READ ONLY transaction ending in ROLLBACK, so the
-- session refuses a write with SQLSTATE 25006 even if this file is ever edited
-- carelessly.
--
-- Target : PRODUCTION (vam-os-admin-portal).
-- Run    : as the owner, before any WP1-A2 migration is authored or applied.
--          BLOCK 1 and BLOCK 2 are independent. Run them separately if the SQL
--          client returns only the last result set, which most do.
-- Session: `set timezone = 'UTC'` first, so any timestamp is comparable.
--
-- WHY EVERY PROOF BELOW EXISTS
--
--   Production `admin_scope_access` carries exactly one constraint — its
--   primary key. There is no foreign key on user_id, no foreign key or format
--   rule on program_id/season_id, no vocabulary CHECK on role or status, and no
--   uniqueness on active grants. Every invariant WP1-A2 wants to rely on must
--   therefore be MEASURED here, not assumed from a migration file:
--   `supabase_migrations/020_admin_scope_access_schema_alignment.sql` declares
--   most of them and was demonstrably never applied to Production.
--
--   The live UEH Admin grant stores a program NAME ("UEH Mentoring") and a
--   season CODE ("UEHM-S11"). The application's tolerant matching accepts the
--   season code; `public.vam063_authorized_for_scope` compares
--   `s.program_id = p_program_id::text` and accepts neither. WP1-A2 converts
--   that row to canonical UUIDs and adds the missing UEHM-S12 grant. Its safety
--   depends entirely on every identifier in the table resolving to exactly one
--   catalog row — which is what BLOCK 1 measures.
--
-- WHAT THIS DOES NOT DO
--   * It does not apply, author, or imply any migration.
--   * It does not create a program-wide (season_id IS NULL) grant. Program-wide
--     Admin scope is WP1-A3 and needs a change to vam063_authorized_for_scope
--     that WP1-A2 must not make.
--   * It does not modify vam063_authorized_for_scope or any other function.
--   * It does not touch person_season_memberships. Nguyễn Đức Thắng's Season 12
--     membership is already canonical and correct; the defect is scope
--     visibility, not participant data.
--
-- PRIVACY
--   No email, no full name and no auth identifier is emitted by BLOCK 1. Rows
--   are identified by admin_scope_access.id, and staff identity appears only as
--   a match COUNT against admin_users.auth_user_id. BLOCK 2 emits the UEH Admin
--   service-account identifiers named in the approved WP1-A2 target, and
--   nothing else about any person.
--
-- REFUSAL VOCABULARY (a FAIL on any of these means SAFE_TO_APPLY = false)
--   [SHAPE]           admin_scope_access is not the column shape WP1-A2 assumes
--   [PGVERSION]       server predates the NULLS NOT DISTINCT unique index
--   [NAME_COLLISION]  a planned constraint/index name is already taken
--   [ADMIN_IDENTITY]  the UEH Admin does not resolve to exactly one usable row,
--                     or does not hold exactly one active grant
--   [PROGRAM]         UEHM does not resolve to exactly one active program, or
--                     the name "UEH Mentoring" is not unique enough to convert
--   [SEASON_S11]      UEHM-S11 does not resolve once, or is not owned by UEHM
--   [SEASON_S12]      UEHM-S12 does not resolve once, or is not owned by UEHM
--   [UNCONVERTIBLE]   an ACTIVE grant cannot be resolved to canonical identity
--   [CONSTRAINT_ROW]  a row of ANY status would violate a planned constraint
--                     even after the planned conversion
--   [NULL_PROGRAM]    a grant carries no program identity at all
--   [DUPLICATE]       two grants canonicalize onto the same target scope key
--   [S12_CONFLICT]    more than one active grant already holds the S12 target
-- =============================================================================


-- #############################################################################
-- BLOCK 1 — PER-ROW CLASSIFICATION INVENTORY
--
-- Every row in admin_scope_access, active and inactive, classified into
-- CANONICAL / CONVERTIBLE / UNCONVERTIBLE.
--
-- Inactive rows are included deliberately. WP1-A2 rewrites ACTIVE grants only,
-- but the planned NOT NULL and CHECK constraints are TABLE-WIDE: a retired row
-- holding a non-canonical program identity would abort the migration at the
-- constraint step even though no live authority depends on it. Seeing those
-- rows here is what lets WP1-A2's write set be scoped correctly before it is
-- written, rather than discovered mid-transaction.
-- #############################################################################

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
raw as (
  select
    s.id                            as scope_id,
    s.user_id                       as user_id,
    s.status                        as status_raw,
    s.role                          as role_raw,
    nullif(btrim(s.program_id), '') as program_raw,
    nullif(btrim(s.season_id),  '') as season_raw
  from public.admin_scope_access s
),
-- USER LINKAGE. There is no FK on user_id, so the contract that
-- admin_scope_access.user_id is the Auth identity carried by
-- admin_users.auth_user_id — the identity vam063_authorized_for_scope joins on
-- — is unenforced and must be measured. Zero matches is an orphan grant; more
-- than one is an ambiguous identity. Either makes the grant unusable.
link as (
  select r.scope_id, count(a.id) as admin_matches
  from raw r
  left join public.admin_users a on a.auth_user_id = r.user_id
  group by r.scope_id
),
-- PROGRAM RESOLUTION. Canonical means the stored text IS a programs.id.
-- Otherwise the value is offered to the catalog as a code or a name, and it
-- converts only if exactly one program answers. Comparison is written as
-- p.id::text = value rather than value::uuid so a malformed identifier
-- classifies as UNCONVERTIBLE instead of raising 22P02 and killing the report.
prog as (
  select
    r.scope_id,
    (select p.id::text from public.programs p where p.id::text = r.program_raw) as canonical_program,
    (select count(*) from public.programs p
       where upper(btrim(p.code)) = upper(r.program_raw)
          or lower(btrim(p.name)) = lower(r.program_raw))                       as alias_matches,
    (select min(p.id::text) from public.programs p
       where upper(btrim(p.code)) = upper(r.program_raw)
          or lower(btrim(p.name)) = lower(r.program_raw))                       as alias_program
  from raw r
),
prog_resolved as (
  select
    p.scope_id,
    coalesce(p.canonical_program, case when p.alias_matches = 1 then p.alias_program end) as resolved_program,
    case
      when r.program_raw is null           then 'UNCONVERTIBLE'
      when p.canonical_program is not null then 'CANONICAL'
      when p.alias_matches = 1             then 'CONVERTIBLE'
      else                                      'UNCONVERTIBLE'
    end as program_class
  from prog p
  join raw r on r.scope_id = p.scope_id
),
-- SEASON RESOLUTION. A season converts only if it resolves once AND the season
-- it resolves to belongs to the program this same row resolved to. A grant
-- naming a season from another program is not a formatting defect — it is a
-- cross-program authority claim, and it is never silently repaired.
sea as (
  select
    r.scope_id,
    (select s2.id::text from public.seasons s2 where s2.id::text = r.season_raw)                       as canonical_season,
    (select count(*) from public.seasons s2 where upper(btrim(s2.code)) = upper(r.season_raw))         as code_matches,
    (select min(s2.id::text) from public.seasons s2 where upper(btrim(s2.code)) = upper(r.season_raw)) as code_season
  from raw r
),
sea_resolved as (
  select
    s.scope_id,
    coalesce(s.canonical_season, case when s.code_matches = 1 then s.code_season end) as resolved_season,
    s.canonical_season,
    s.code_matches
  from sea s
),
classified as (
  select
    r.scope_id,
    r.status_raw,
    r.role_raw,
    r.program_raw,
    r.season_raw,
    l.admin_matches,
    pr.resolved_program,
    pr.program_class,
    sr.resolved_season,
    (select s2.program_id::text from public.seasons s2 where s2.id::text = sr.resolved_season) as season_owner_program,
    case
      when r.season_raw is null                                     then 'CANONICAL_PROGRAM_WIDE'
      when sr.resolved_season is null                               then 'UNCONVERTIBLE'
      when pr.resolved_program is null                              then 'UNCONVERTIBLE'
      when (select s2.program_id::text from public.seasons s2 where s2.id::text = sr.resolved_season)
             is distinct from pr.resolved_program                   then 'UNCONVERTIBLE'
      when sr.canonical_season is not null                          then 'CANONICAL'
      when sr.code_matches = 1                                      then 'CONVERTIBLE'
      else                                                               'UNCONVERTIBLE'
    end as season_class,
    case
      when r.role_raw in ('full_access', 'operations', 'review', 'read') then 'CANONICAL'
      else 'UNCONVERTIBLE'
    end as role_class,
    case
      when r.status_raw in ('active', 'inactive') then 'CANONICAL'
      when r.status_raw is null                   then 'NULL_STATUS'
      else                                             'UNCONVERTIBLE'
    end as status_class,
    case when l.admin_matches = 1 then 'CANONICAL' else 'UNCONVERTIBLE' end as linkage_class
  from raw r
  join link l           on l.scope_id  = r.scope_id
  join prog_resolved pr on pr.scope_id = r.scope_id
  join sea_resolved sr  on sr.scope_id = r.scope_id
),
final as (
  select
    c.*,
    -- Overall row verdict. UNCONVERTIBLE anywhere dominates; a row needing any
    -- rewrite is CONVERTIBLE; otherwise it is already canonical.
    case
      when 'UNCONVERTIBLE' in (c.program_class, c.season_class, c.role_class, c.status_class, c.linkage_class)
        then 'UNCONVERTIBLE'
      when 'CONVERTIBLE' in (c.program_class, c.season_class)
        then 'CONVERTIBLE'
      else 'CANONICAL'
    end as row_class,
    -- Would this row still violate a PLANNED constraint after WP1-A2 has
    -- converted every convertible identifier? Deliberately independent of
    -- linkage: no foreign key on user_id is added by WP1-A2, so an orphan grant
    -- blocks authorization but not the constraint rollout.
    -- Note both planned CHECKs are NULL-permissive by SQL semantics — a NULL
    -- role or a NULL status SATISFIES `x in (...)`. Only program_id is
    -- protected against NULL, by its own NOT NULL constraint.
    (
      c.resolved_program is null
      or (c.season_raw is not null and c.resolved_season is null)
      or (c.role_raw   is not null and c.role_raw   not in ('full_access', 'operations', 'review', 'read'))
      or (c.status_raw is not null and c.status_raw not in ('active', 'inactive'))
    ) as violates_planned_constraint
  from classified c
)
select
  scope_id,
  status_raw                    as status,
  row_class,
  program_class,
  season_class,
  role_class,
  status_class,
  linkage_class,
  admin_matches                 as admin_users_matches,
  program_raw                   as stored_program,
  resolved_program              as target_program,
  season_raw                    as stored_season,
  resolved_season               as target_season,
  role_raw                      as scope_level,
  violates_planned_constraint,
  case
    when row_class = 'CANONICAL' and not violates_planned_constraint
      then 'no change required'
    when row_class = 'CONVERTIBLE'
      then 'rewrite stored identifiers to target_program / target_season'
    when linkage_class = 'UNCONVERTIBLE' and admin_matches = 0
      then 'orphan grant: user_id matches no admin_users.auth_user_id'
    when linkage_class = 'UNCONVERTIBLE'
      then 'ambiguous grant: user_id matches more than one admin_users row'
    when program_class = 'UNCONVERTIBLE'
      then 'program identity does not resolve to exactly one catalog program'
    when season_class = 'UNCONVERTIBLE'
      then 'season identity unresolvable, ambiguous, or owned by another program'
    when role_class = 'UNCONVERTIBLE'
      then 'scope level is not one of full_access/operations/review/read'
    when status_class = 'UNCONVERTIBLE'
      then 'status is outside active/inactive'
    else 'review manually'
  end as action
from final
order by
  case row_class when 'UNCONVERTIBLE' then 0 when 'CONVERTIBLE' then 1 else 2 end,
  status_raw nulls first,
  scope_id;

rollback;


-- #############################################################################
-- BLOCK 2 — NAMED CHECKS AND THE SAFE_TO_APPLY VERDICT
--
-- Every check emits check_name / expected / actual / result / details.
-- result is PASS, FAIL or INFO. INFO rows never gate the verdict; they are
-- observations WP1-A2 does not depend on but the owner must read. A check is
-- INFO only where its failure could not make the planned migration fail — every
-- condition that could is a FAIL.
-- #############################################################################

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
expected as (
  select
    '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text as uehm_program_id,
    '710f4ec9-1cf7-461e-98d4-f33799047add'::text as uehm_s11_id,
    '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text as uehm_s12_id,
    'uehmentoring@gmail.com'::text               as ueh_admin_email,
    'UEHM'::text                                 as uehm_code,
    'UEH Mentoring'::text                        as uehm_name
),
raw as (
  select
    s.id                            as scope_id,
    s.user_id                       as user_id,
    s.status                        as status_raw,
    s.role                          as role_raw,
    nullif(btrim(s.program_id), '') as program_raw,
    nullif(btrim(s.season_id),  '') as season_raw
  from public.admin_scope_access s
),
link as (
  select r.scope_id, count(a.id) as admin_matches
  from raw r
  left join public.admin_users a on a.auth_user_id = r.user_id
  group by r.scope_id
),
prog as (
  select
    r.scope_id,
    (select p.id::text from public.programs p where p.id::text = r.program_raw) as canonical_program,
    (select count(*) from public.programs p
       where upper(btrim(p.code)) = upper(r.program_raw)
          or lower(btrim(p.name)) = lower(r.program_raw))                       as alias_matches,
    (select min(p.id::text) from public.programs p
       where upper(btrim(p.code)) = upper(r.program_raw)
          or lower(btrim(p.name)) = lower(r.program_raw))                       as alias_program
  from raw r
),
prog_resolved as (
  select
    p.scope_id,
    coalesce(p.canonical_program, case when p.alias_matches = 1 then p.alias_program end) as resolved_program,
    case
      when r.program_raw is null           then 'UNCONVERTIBLE'
      when p.canonical_program is not null then 'CANONICAL'
      when p.alias_matches = 1             then 'CONVERTIBLE'
      else                                      'UNCONVERTIBLE'
    end as program_class
  from prog p
  join raw r on r.scope_id = p.scope_id
),
sea as (
  select
    r.scope_id,
    (select s2.id::text from public.seasons s2 where s2.id::text = r.season_raw)                       as canonical_season,
    (select count(*) from public.seasons s2 where upper(btrim(s2.code)) = upper(r.season_raw))         as code_matches,
    (select min(s2.id::text) from public.seasons s2 where upper(btrim(s2.code)) = upper(r.season_raw)) as code_season
  from raw r
),
sea_resolved as (
  select
    s.scope_id,
    coalesce(s.canonical_season, case when s.code_matches = 1 then s.code_season end) as resolved_season,
    s.canonical_season,
    s.code_matches
  from sea s
),
final as (
  select
    r.scope_id,
    r.user_id,
    r.status_raw,
    r.role_raw,
    r.program_raw,
    r.season_raw,
    l.admin_matches,
    pr.resolved_program,
    pr.program_class,
    sr.resolved_season,
    case
      when r.season_raw is null                                     then 'CANONICAL_PROGRAM_WIDE'
      when sr.resolved_season is null                               then 'UNCONVERTIBLE'
      when pr.resolved_program is null                              then 'UNCONVERTIBLE'
      when (select s2.program_id::text from public.seasons s2 where s2.id::text = sr.resolved_season)
             is distinct from pr.resolved_program                   then 'UNCONVERTIBLE'
      when sr.canonical_season is not null                          then 'CANONICAL'
      when sr.code_matches = 1                                      then 'CONVERTIBLE'
      else                                                               'UNCONVERTIBLE'
    end as season_class,
    case when r.role_raw in ('full_access','operations','review','read') then 'CANONICAL' else 'UNCONVERTIBLE' end as role_class,
    case when r.status_raw in ('active','inactive') then 'CANONICAL'
         when r.status_raw is null                  then 'NULL_STATUS'
         else                                            'UNCONVERTIBLE' end                                       as status_class,
    case when l.admin_matches = 1 then 'CANONICAL' else 'UNCONVERTIBLE' end                                        as linkage_class,
    (
      pr.resolved_program is null
      or (r.season_raw is not null and sr.resolved_season is null)
      or (r.role_raw   is not null and r.role_raw   not in ('full_access','operations','review','read'))
      or (r.status_raw is not null and r.status_raw not in ('active','inactive'))
    ) as violates_planned_constraint
  from raw r
  join link l           on l.scope_id  = r.scope_id
  join prog_resolved pr on pr.scope_id = r.scope_id
  join sea_resolved sr  on sr.scope_id = r.scope_id
),
rows_classed as (
  select
    f.*,
    case
      when 'UNCONVERTIBLE' in (f.program_class, f.season_class, f.role_class, f.status_class, f.linkage_class)
        then 'UNCONVERTIBLE'
      when 'CONVERTIBLE' in (f.program_class, f.season_class)
        then 'CONVERTIBLE'
      else 'CANONICAL'
    end as row_class
  from final f
),
-- TARGET-KEY DUPLICATES. The planned partial unique index keys on
-- (user_id, program_id, season_id) among active rows, with NULLS NOT DISTINCT
-- so two program-wide grants for one user collide as intended. Scope level is
-- NOT part of the key: two active grants differing only in level would
-- otherwise coexist and resolve silently to the stronger one.
-- Rows are grouped on their POST-conversion identity, because that is what the
-- index will see. Two rows that look different today ("UEHM-S11" and the S11
-- UUID) canonicalize onto one key and must be caught before the index is built.
target_keys as (
  select
    user_id,
    resolved_program,
    coalesce(resolved_season, '<program-wide>') as season_key,
    count(*)                                    as grants
  from rows_classed
  where status_raw = 'active'
    and row_class <> 'UNCONVERTIBLE'
  group by 1, 2, 3
),
ueh_admin as (
  select
    count(*)                                           as rows_found,
    count(*) filter (where a.status = 'active')        as active_rows,
    count(*) filter (where a.role = 'admin')           as admin_role_rows,
    count(*) filter (where a.auth_user_id is not null) as linked_rows,
    min(a.auth_user_id::text)                          as auth_user_id,
    min(a.id::text)                                    as admin_user_id
  from public.admin_users a, expected e
  where lower(btrim(a.email)) = lower(e.ueh_admin_email)
),
prog_catalog as (
  select
    (select count(*)               from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as code_matches,
    (select count(*)               from public.programs p, expected e where lower(btrim(p.name)) = lower(e.uehm_name)) as name_matches,
    (select min(p.id::text)        from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as resolved_id,
    (select min(p.is_active::text) from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as is_active
),
s11_catalog as (
  select
    (select count(*)                from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as code_matches,
    (select min(s.id::text)         from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as resolved_id,
    (select min(s.program_id::text) from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as owner_program
),
s12_catalog as (
  select
    (select count(*)                from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as code_matches,
    (select min(s.id::text)         from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as resolved_id,
    (select min(s.program_id::text) from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as owner_program
),
shape as (
  select
    count(*) filter (where column_name = 'id'         and data_type = 'uuid')                        as id_ok,
    count(*) filter (where column_name = 'user_id'    and data_type = 'uuid')                        as user_id_ok,
    count(*) filter (where column_name = 'program_id' and data_type in ('text','character varying')) as program_ok,
    count(*) filter (where column_name = 'season_id'  and data_type in ('text','character varying')) as season_ok,
    count(*) filter (where column_name = 'role'       and data_type in ('text','character varying')) as role_ok,
    count(*) filter (where column_name = 'status'     and data_type in ('text','character varying')) as status_ok,
    count(*)                                                                                         as column_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_scope_access'
),
planned_names as (
  select unnest(array[
    'admin_scope_access_program_id_not_null',
    'admin_scope_access_program_id_canonical_check',
    'admin_scope_access_season_id_canonical_check',
    'admin_scope_access_role_check',
    'admin_scope_access_status_check',
    'admin_scope_access_active_scope_key'
  ]) as object_name
),
name_collisions as (
  select count(*) as taken
  from planned_names n
  where exists (select 1 from pg_constraint c where c.conname = n.object_name)
     or exists (select 1 from pg_class r     where r.relname = n.object_name and r.relkind = 'i')
),
existing_integrity as (
  select
    (select count(*) from pg_constraint where conrelid = to_regclass('public.admin_scope_access')) as constraints_now,
    (select count(*) from pg_index i where i.indrelid = to_regclass('public.admin_scope_access'))  as indexes_now
),
s12_target as (
  select count(*) as grants
  from rows_classed rc, ueh_admin ua, expected e
  where rc.status_raw = 'active'
    and rc.user_id::text  = ua.auth_user_id
    and rc.resolved_program = e.uehm_program_id
    and rc.resolved_season  = e.uehm_s12_id
),
checks as (

  -- ── Section 1. Environment and table shape ────────────────────────────────
  select
    10 as seq,
    '[SHAPE] admin_scope_access column shape' as check_name,
    'id uuid, user_id uuid, program_id/season_id/role/status text' as expected,
    'id=' || sh.id_ok || ' user_id=' || sh.user_id_ok || ' program_id=' || sh.program_ok
          || ' season_id=' || sh.season_ok || ' role=' || sh.role_ok || ' status=' || sh.status_ok as actual,
    case when sh.id_ok = 1 and sh.user_id_ok = 1 and sh.program_ok = 1
              and sh.season_ok = 1 and sh.role_ok = 1 and sh.status_ok = 1
         then 'PASS' else 'FAIL' end as result,
    'Total columns: ' || sh.column_count
      || '. A 0 for any column means WP1-A2 would be writing into a shape it was not designed against.' as details
  from shape sh

  union all
  select
    11,
    '[PGVERSION] server supports a NULLS NOT DISTINCT unique index',
    '>= 150000',
    current_setting('server_version_num'),
    case when current_setting('server_version_num')::int >= 150000 then 'PASS' else 'FAIL' end,
    'The planned active-scope unique index uses NULLS NOT DISTINCT so two program-wide grants for one user collide as '
    'intended. Below PG15 a sentinel expression would be required instead — see README, "Unique index representation".'

  union all
  select
    12,
    '[NAME_COLLISION] planned constraint and index names are free',
    '0 taken',
    nc.taken || ' taken',
    case when nc.taken = 0 then 'PASS' else 'FAIL' end,
    'Existing constraints on the table: ' || ei.constraints_now || ', existing indexes: ' || ei.indexes_now
      || '. Production evidence expects 1 and 1 (the primary key). A higher count is not a failure by itself, but it means '
    'supabase_migrations/020 or something like it was partially applied and this baseline must be re-read before A2.'
  from name_collisions nc, existing_integrity ei

  -- ── Section 2. UEH Admin identity ─────────────────────────────────────────
  union all
  select
    20,
    '[ADMIN_IDENTITY] UEH Admin resolves to exactly one usable admin_users row',
    '1 row, status=active, role=admin, auth_user_id not null',
    'rows=' || ua.rows_found || ' active=' || ua.active_rows || ' admin_role=' || ua.admin_role_rows || ' linked=' || ua.linked_rows,
    case when ua.rows_found = 1 and ua.active_rows = 1 and ua.admin_role_rows = 1 and ua.linked_rows = 1
         then 'PASS' else 'FAIL' end,
    'admin_users.id=' || coalesce(ua.admin_user_id, '<none>') || ', auth_user_id=' || coalesce(ua.auth_user_id, '<none>')
      || '. WP1-A2 writes grants keyed on auth_user_id, which is the identity vam063_authorized_for_scope joins on.'
  from ueh_admin ua

  union all
  select
    21,
    '[ADMIN_IDENTITY] UEH Admin holds exactly one active grant today',
    '1 active grant',
    (select count(*)::text from rows_classed rc, ueh_admin ua where rc.status_raw = 'active' and rc.user_id::text = ua.auth_user_id) || ' active grant(s)',
    case when (select count(*) from rows_classed rc, ueh_admin ua where rc.status_raw = 'active' and rc.user_id::text = ua.auth_user_id) = 1
         then 'PASS' else 'FAIL' end,
    'The approved WP1-A2 conversion transforms ONE existing row in place, preserving its id and created_at. A different '
    'count means the conversion target is not unambiguous and the migration must be re-scoped before it is written.'

  union all
  -- Informational: identity equality is a fact of this one account, not a
  -- contract. The contract is admin_scope_access.user_id = admin_users.auth_user_id.
  select
    22,
    '[INFO] admin_users.id equals auth_user_id for this account',
    'informational',
    case when ua.admin_user_id is not distinct from ua.auth_user_id then 'equal' else 'different' end,
    'INFO',
    'Owner evidence records both as 0cbe980a-6027-4645-828d-d994a1a38869, so no identity backfill is required. The equality '
    'is incidental to this account: WP1-A2 must not treat the two columns as interchangeable for any other staff member.'
  from ueh_admin ua

  -- ── Section 3. Canonical catalog identity ─────────────────────────────────
  union all
  select
    30,
    '[PROGRAM] UEHM resolves to exactly one active program at the expected UUID',
    '1 code match, id=' || e.uehm_program_id || ', is_active=true',
    'code_matches=' || pc.code_matches || ' id=' || coalesce(pc.resolved_id, '<none>') || ' is_active=' || coalesce(pc.is_active, '<none>'),
    case when pc.code_matches = 1 and pc.resolved_id = e.uehm_program_id and pc.is_active = 'true'
         then 'PASS' else 'FAIL' end,
    'Resolved from the catalog by code and only then compared to the owner-supplied UUID. The literal is never trusted alone.'
  from prog_catalog pc, expected e

  union all
  select
    31,
    '[PROGRAM] the program NAME "UEH Mentoring" is unique enough to convert by',
    'exactly 1 program carries this name',
    pc.name_matches || ' name match(es)',
    case when pc.name_matches = 1 then 'PASS' else 'FAIL' end,
    'The live UEH Admin grant stores the program NAME, so the conversion has to resolve by name. Two programs sharing one '
    'name would make that resolution ambiguous and the grant UNCONVERTIBLE rather than merely non-canonical.'
  from prog_catalog pc

  union all
  select
    32,
    '[SEASON_S11] UEHM-S11 resolves once, at the expected UUID, owned by UEHM',
    '1 match, id=' || e.uehm_s11_id || ', program=' || e.uehm_program_id,
    'matches=' || s11.code_matches || ' id=' || coalesce(s11.resolved_id, '<none>') || ' program=' || coalesce(s11.owner_program, '<none>'),
    case when s11.code_matches = 1 and s11.resolved_id = e.uehm_s11_id and s11.owner_program = e.uehm_program_id
         then 'PASS' else 'FAIL' end,
    'This is the season the existing grant converts TO. Season 11 history must stay readable to the UEH Admin afterwards.'
  from s11_catalog s11, expected e

  union all
  select
    33,
    '[SEASON_S12] UEHM-S12 resolves once, at the expected UUID, owned by UEHM',
    '1 match, id=' || e.uehm_s12_id || ', program=' || e.uehm_program_id,
    'matches=' || s12.code_matches || ' id=' || coalesce(s12.resolved_id, '<none>') || ' program=' || coalesce(s12.owner_program, '<none>'),
    case when s12.code_matches = 1 and s12.resolved_id = e.uehm_s12_id and s12.owner_program = e.uehm_program_id
         then 'PASS' else 'FAIL' end,
    'This is the season the NEW grant is created for — the grant whose absence makes Season 12 invisible to the Admin today.'
  from s12_catalog s12, expected e

  -- ── Section 4. Row classification ─────────────────────────────────────────
  union all
  select
    40,
    '[UNCONVERTIBLE] every ACTIVE grant resolves to canonical identity',
    '0 unconvertible active grants',
    (select count(*)::text from rows_classed where status_raw = 'active' and row_class = 'UNCONVERTIBLE') || ' unconvertible',
    case when (select count(*) from rows_classed where status_raw = 'active' and row_class = 'UNCONVERTIBLE') = 0
         then 'PASS' else 'FAIL' end,
    'Active totals — canonical: '   || (select count(*) from rows_classed where status_raw = 'active' and row_class = 'CANONICAL')
      || ', convertible: '          || (select count(*) from rows_classed where status_raw = 'active' and row_class = 'CONVERTIBLE')
      || ', unconvertible: '        || (select count(*) from rows_classed where status_raw = 'active' and row_class = 'UNCONVERTIBLE')
      || '. See BLOCK 1 for the offending rows and the reason each failed.'

  union all
  select
    41,
    '[CONSTRAINT_ROW] no row of ANY status blocks a planned constraint after conversion',
    '0 blocking rows',
    (select count(*)::text from rows_classed where violates_planned_constraint) || ' blocking row(s)',
    case when (select count(*) from rows_classed where violates_planned_constraint) = 0
         then 'PASS' else 'FAIL' end,
    'The planned NOT NULL and CHECK constraints are TABLE-WIDE, while WP1-A2 rewrites active grants only, so an INACTIVE row '
    'holding a non-canonical identifier would abort the migration at the constraint step. Non-active rows counted here: '
      || (select count(*) from rows_classed where violates_planned_constraint and status_raw is distinct from 'active')
      || '. If that is above zero, WP1-A2 must either widen its conversion to those rows or defer the constraints.'

  union all
  select
    42,
    '[NULL_PROGRAM] no ACTIVE grant carries a null or blank program identity',
    '0 rows',
    (select count(*)::text from rows_classed where status_raw = 'active' and program_raw is null) || ' row(s)',
    case when (select count(*) from rows_classed where status_raw = 'active' and program_raw is null) = 0
         then 'PASS' else 'FAIL' end,
    'A grant naming no program is the shape that satisfies the scope-blind canOperateAnyScope family while authorizing no '
    'program at all. WP1-A1 now drops it at read time; the planned NOT NULL constraint makes it unrepresentable.'

  union all
  select
    43,
    '[NULL_PROGRAM] no row of ANY status carries a null or blank program identity',
    '0 rows',
    (select count(*)::text from rows_classed where program_raw is null) || ' row(s)',
    case when (select count(*) from rows_classed where program_raw is null) = 0
         then 'PASS' else 'FAIL' end,
    'program_id NOT NULL applies to every row regardless of status, so a retired grant with a null program blocks it too.'

  union all
  select
    44,
    '[INFO] active grants that are already program-wide (season_id IS NULL)',
    'expected 0 before WP1-A3',
    (select count(*)::text from rows_classed where status_raw = 'active' and season_raw is null) || ' row(s)',
    'INFO',
    'The planned CHECK permits a NULL season, so such a row does not block WP1-A2. It is surfaced because it is currently '
    'REFUSED by vam063_authorized_for_scope (NULL = uuid yields NULL): the holder would read across the program and be '
    'denied every lifecycle mutation. Program-wide semantics are WP1-A3 and are not introduced here.'

  union all
  select
    45,
    '[INFO] rows with a NULL status',
    'expected 0',
    (select count(*)::text from rows_classed where status_raw is null) || ' row(s)',
    'INFO',
    'A NULL status SATISFIES `status in (''active'',''inactive'')` by SQL null semantics, so it does not block the planned '
    'CHECK, and the application already excludes such rows by filtering status = ''active''. Reported so the owner can decide '
    'whether that CHECK should be paired with SET NOT NULL in a follow-up.'

  -- ── Section 5. Uniqueness and the S12 target ──────────────────────────────
  union all
  select
    50,
    '[DUPLICATE] no two active grants canonicalize onto one target scope key',
    '0 conflicting keys',
    (select count(*)::text from target_keys where grants > 1) || ' conflicting key(s)',
    case when (select count(*) from target_keys where grants > 1) = 0 then 'PASS' else 'FAIL' end,
    'Key is (user_id, program_id, season_id) with NULLS NOT DISTINCT, scope level excluded on purpose: two active grants '
    'differing only in level would otherwise coexist and resolve silently to the stronger one. Rows are grouped on their '
    'POST-conversion identity, so "UEHM-S11" and the S11 UUID are recognised as one target key rather than two.'

  union all
  select
    51,
    '[S12_CONFLICT] the UEHM-S12 grant WP1-A2 creates does not already exist more than once',
    '0 or 1 existing active grant',
    (select grants::text from s12_target) || ' existing active grant(s)',
    case when (select grants from s12_target) <= 1 then 'PASS' else 'FAIL' end,
    '0 means WP1-A2 inserts it. 1 means WP1-A2''s insert must be a no-op so the migration stays idempotent. More than one '
    'means the table already violates the uniqueness the migration is about to enforce.'

  union all
  select
    52,
    '[INFO] planned conversion summary for the UEH Admin',
    'S11 grant rewritten in place, S12 grant created',
    'convertible active grants for this account: '
      || (select count(*)::text from rows_classed rc, ueh_admin ua
           where rc.status_raw = 'active' and rc.user_id::text = ua.auth_user_id and rc.row_class = 'CONVERTIBLE'),
    'INFO',
    'Target after WP1-A2 — row 1: program=' || e.uehm_program_id || ' season=' || e.uehm_s11_id
      || ' role=full_access status=active (id and created_at preserved); row 2 (new): program=' || e.uehm_program_id
      || ' season=' || e.uehm_s12_id || ' role=full_access status=active. No program-wide grant is created; that is WP1-A3.'
  from expected e
)
select seq, check_name, expected, actual, result, details from checks
union all
select
  999,
  'SAFE_TO_APPLY',
  'true',
  case when exists (select 1 from checks where result = 'FAIL') then 'false' else 'true' end,
  case when exists (select 1 from checks where result = 'FAIL') then 'FAIL' else 'PASS' end,
  case
    when exists (select 1 from checks where result = 'FAIL')
      then 'BLOCKED by ' || (select count(*)::text from checks where result = 'FAIL') || ' failing check(s): '
           || (select string_agg(check_name, '; ' order by seq) from checks where result = 'FAIL')
           || '. Do not author or apply the WP1-A2 migration until every one is resolved.'
    else 'All gating checks passed. The WP1-A2 migration may be authored against this baseline. INFO rows are still owner '
         'decisions and must be read before applying.'
  end
order by 1;

rollback;

-- =============================================================================
-- END. Both transactions above are READ ONLY and end in ROLLBACK. Running this
-- file changes nothing, holds no lock beyond the read, and leaves no trace
-- other than the two result sets.
-- =============================================================================
