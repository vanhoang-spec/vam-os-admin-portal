-- =============================================================================
-- VAM OS — WP1-A2 STAFF SCOPE CONVERGENCE — VERIFIER
--
-- 100% READ ONLY. Run IMMEDIATELY after apply.sql commits, in the same session
-- or a new one, against the same database.
--
-- No INSERT, UPDATE, DELETE, MERGE, TRUNCATE, COPY, DDL, GRANT or function
-- definition. The executable body is SELECT statements only, inside
-- `begin; set transaction read only; ... rollback;`, so the session refuses a
-- write with SQLSTATE 25006 even if this file is ever edited carelessly. No
-- function is INVOKED either: vam063_authorized_for_scope is read from the
-- catalog with pg_get_functiondef, never called.
--
-- OUTPUT
--   seq | check_name | expected | actual | result | details
--   ...and a final row: [A2_VERIFIED] with result PASS/FAIL and the count of
--   failing checks.
--
--   A2_VERIFIED is DERIVED. Nothing in this file asserts it. It is true only
--   when every material invariant is PASS; a check is INFO only where its
--   failure could not mean the convergence was wrong.
--
-- IF A2_VERIFIED IS FALSE
--   STOP. Do not deploy WP1-A1. Do not share the demo credentials. Read the
--   failing rows, then evaluate rollback eligibility per README §14 — rollback
--   has its own guards and will refuse if the state is no longer exactly
--   rollback-compatible.
-- =============================================================================

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
expected as (
  select
    '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text as uehm,
    '710f4ec9-1cf7-461e-98d4-f33799047add'::text as s11,
    '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text as s12,
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text as uuid_re,
    'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql'::text as apply_source
),
-- The six rows A2 CONVERTED in place, with the exact values it wrote.
converted(scope_id, email, program_id, season_id, scope_role, scope_status, label) as (
  values
    ('68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid, 'uehmentoring@gmail.com'::text,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text, '710f4ec9-1cf7-461e-98d4-f33799047add'::text,
     'full_access'::text, 'active'::text, 'ueh_shared_admin/S11'::text),
    ('17a86485-c241-4cff-9bd5-60efe75b802a', 'lieu.nguyen@hoatay.com.vn',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', null, 'full_access', 'inactive', 'lieu/LEGACY'),
    ('60ef3d0b-8f41-4c76-aad7-dc91f26a470a', 'hoang.nguyen@embassy.edu.vn',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active', 'hoang/S11'),
    ('1e58beb9-b7ce-4392-ac81-429743f61534', 'lyductoan@gmail.com',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active', 'toan/S11'),
    ('487a7562-bb40-4c5c-9dc1-0fe363f1158a', 'viewer.vam.test@redsquarevietnam.com',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'operations', 'inactive', 'demo_viewer/S11_RETIRE'),
    ('eaa60d5c-66eb-4ef8-a8c0-0db0bc701028', 'admin.vam.test@redsquarevietnam.com',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'inactive', 'historical_admin_test/CANONICALIZE')
),
-- The six rows A2 CREATED, at the deterministic ids authored in apply.sql.
created(scope_id, email, program_id, season_id, scope_role, label) as (
  values
    ('a2000001-0000-4a20-8a20-000000000001'::uuid, 'uehmentoring@gmail.com'::text,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text, '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text,
     'full_access'::text, 'ueh_shared_admin/S12'::text),
    ('a2000002-0000-4a20-8a20-000000000002', 'lieu.nguyen@hoatay.com.vn',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'lieu/S11'),
    ('a2000003-0000-4a20-8a20-000000000003', 'lieu.nguyen@hoatay.com.vn',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'lieu/S12'),
    ('a2000004-0000-4a20-8a20-000000000004', 'hoang.nguyen@embassy.edu.vn',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'hoang/S12'),
    ('a2000005-0000-4a20-8a20-000000000005', 'lyductoan@gmail.com',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'toan/S12'),
    ('a2000006-0000-4a20-8a20-000000000006', 'viewer.vam.test@redsquarevietnam.com',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'read', 'demo_viewer/S12')
),
all_known as (
  select scope_id from converted
  union all
  select scope_id from created
),
staff(email, want_role, want_status, is_real_admin) as (
  values
    ('uehmentoring@gmail.com'::text,               'admin'::text,  'active'::text,   true),
    ('lieu.nguyen@hoatay.com.vn',                   'admin',        'active',         true),
    ('hoang.nguyen@embassy.edu.vn',                 'admin',        'active',         true),
    ('lyductoan@gmail.com',                         'admin',        'active',         true),
    ('viewer.vam.test@redsquarevietnam.com',        'viewer',       'active',         false),
    ('admin.vam.test@redsquarevietnam.com',         'admin',        'inactive',       false)
),
demo as (
  select u.id, u.auth_user_id, u.role, u.status
  from public.admin_users u
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
),
hist as (
  select u.id, u.auth_user_id, u.role, u.status
  from public.admin_users u
  where lower(btrim(u.email)) = 'admin.vam.test@redsquarevietnam.com'
),
idx as (
  select
    count(*) as idx_count,
    min(pg_get_indexdef(i.indexrelid)) as idx_def,
    bool_and(i.indisunique)            as is_unique,
    bool_and(i.indnullsnotdistinct)    as nulls_not_distinct,
    bool_and(i.indpred is not null)    as is_partial
  from pg_index i
  join pg_class r on r.oid = i.indexrelid
  where i.indrelid = to_regclass('public.admin_scope_access')
    and r.relname = 'admin_scope_access_active_scope_key'
),
rpc as (
  select
    count(*) as fn_count,
    min(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) as fn_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_authorized_for_scope'
),
audit as (
  select
    (select count(*) from public.admin_audit_log a, expected e
      where a.before_data->>'source' = e.apply_source and a.action_type = 'update_admin_user') as apply_rows,
    (select count(*) from public.admin_audit_log a, expected e,
            lateral jsonb_array_elements(a.before_data->'scopes') as el
      where a.before_data->>'source' = e.apply_source
        and el->>'id' = '17a86485-c241-4cff-9bd5-60efe75b802a'
        and el->>'role' = 'admin' and el->>'program_id' = 'UEHM'
        and el->>'status' = 'active' and el->>'season_id' is null)                              as lieu_preimage,
    (select count(*) from public.admin_audit_log a, expected e,
            lateral jsonb_array_elements(a.before_data->'scopes') as el
      where a.before_data->>'source' = e.apply_source
        and el->>'id' = '487a7562-bb40-4c5c-9dc1-0fe363f1158a'
        and el->>'role' = 'operations' and el->>'status' = 'active')                            as demo_preimage
),
shape as (
  select
    count(*) filter (where column_name = 'program_id' and data_type in ('text','character varying')) as program_text,
    count(*) filter (where column_name = 'season_id'  and data_type in ('text','character varying')) as season_text,
    count(*) filter (where column_name = 'role'       and data_type in ('text','character varying')) as role_text,
    count(*) filter (where column_name = 'status'     and data_type in ('text','character varying')) as status_text
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_scope_access'
),
checks as (

  -- ── Section 1. The table as a whole ───────────────────────────────────────
  select
    10 as seq,
    '[ROWCOUNT] the table holds exactly the converged set' as check_name,
    '12 rows: 9 active, 3 inactive' as expected,
    (select count(*)::text from public.admin_scope_access) || ' rows: '
      || (select count(*)::text from public.admin_scope_access where status = 'active') || ' active, '
      || (select count(*)::text from public.admin_scope_access where status = 'inactive') || ' inactive' as actual,
    case when (select count(*) from public.admin_scope_access) = 12
          and (select count(*) from public.admin_scope_access where status = 'active') = 9
          and (select count(*) from public.admin_scope_access where status = 'inactive') = 3
         then 'PASS' else 'FAIL' end as result,
    'Six inventoried rows converted in place plus six rows created by A2. Nothing was deleted, so the six original ids must all still be here.' as details

  union all
  select
    11,
    '[NO_DELETION] every inventoried row still exists',
    '6 of 6 original scope_ids present',
    (select count(*)::text from converted c where exists (select 1 from public.admin_scope_access s where s.id = c.scope_id)) || ' of 6',
    case when (select count(*) from converted c where exists (select 1 from public.admin_scope_access s where s.id = c.scope_id)) = 6
         then 'PASS' else 'FAIL' end,
    'History is retired, never removed. A missing id means a DELETE happened somewhere, which no file in this package issues.'

  union all
  select
    12,
    '[UNKNOWN_ROW] no scope row exists that A2 did not account for',
    '0 unknown rows',
    (select count(*)::text from public.admin_scope_access s where not exists (select 1 from all_known k where k.scope_id = s.id)) || ' unknown',
    case when (select count(*) from public.admin_scope_access s where not exists (select 1 from all_known k where k.scope_id = s.id)) = 0
         then 'PASS' else 'FAIL' end,
    'Unknown ids: ' || coalesce((select string_agg(s.id::text, ', ' order by s.id) from public.admin_scope_access s
                                  where not exists (select 1 from all_known k where k.scope_id = s.id)), '<none>')
      || '. A row appearing after the apply is organic operational change, and it makes rollback ineligible.'

  union all
  select
    13,
    '[INFO] the physical column types are unchanged',
    'program_id/season_id/role/status still TEXT',
    'program_id=' || sh.program_text || ' season_id=' || sh.season_text || ' role=' || sh.role_text || ' status=' || sh.status_text,
    'INFO',
    'A2 deliberately does not convert program_id/season_id to uuid columns. That is a separate, later change.'
  from shape sh

  -- ── Section 2. The six converted rows ─────────────────────────────────────
  union all
  select
    20,
    '[CONVERTED] each inventoried row holds its exact approved target',
    '6 of 6 exact',
    (select count(*)::text
       from converted c
       join public.admin_scope_access s on s.id = c.scope_id
       join public.admin_users u        on u.auth_user_id = s.user_id
      where lower(btrim(u.email)) = c.email
        and s.program_id is not distinct from c.program_id
        and s.season_id  is not distinct from c.season_id
        and s.role       is not distinct from c.scope_role
        and s.status     is not distinct from c.scope_status) || ' of 6 exact',
    case when (select count(*)
                 from converted c
                 join public.admin_scope_access s on s.id = c.scope_id
                 join public.admin_users u        on u.auth_user_id = s.user_id
                where lower(btrim(u.email)) = c.email
                  and s.program_id is not distinct from c.program_id
                  and s.season_id  is not distinct from c.season_id
                  and s.role       is not distinct from c.scope_role
                  and s.status     is not distinct from c.scope_status) = 6
         then 'PASS' else 'FAIL' end,
    'Each row is checked by exact scope_id AND by the account that owns it, so a row that moved to another identity fails here. Mismatched: '
      || coalesce((select string_agg(c.label, ', ' order by c.label)
                     from converted c
                     left join public.admin_scope_access s on s.id = c.scope_id
                    where s.id is null
                       or s.program_id is distinct from c.program_id
                       or s.season_id  is distinct from c.season_id
                       or s.role       is distinct from c.scope_role
                       or s.status     is distinct from c.scope_status), '<none>')

  union all
  select
    21,
    '[LIEU_LEGACY] the program-wide legacy row is retained as history',
    'present, inactive, season_id NULL, canonical program',
    coalesce((select 'status=' || s.status || ' season=' || coalesce(s.season_id, 'NULL') || ' program=' || coalesce(s.program_id, 'NULL') || ' level=' || coalesce(s.role, 'NULL')
                from public.admin_scope_access s where s.id = '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid), '<row missing>'),
    case when (select count(*) from public.admin_scope_access s, expected e
                where s.id = '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid
                  and s.status = 'inactive' and s.season_id is null and s.program_id = e.uehm) = 1
         then 'PASS' else 'FAIL' end,
    'It was a program-wide claim and it still says so: season_id stays NULL and the row was never rewritten into a season grant. The one value that could not survive the table-wide role CHECK — the literal "admin" — is preserved in admin_audit_log, checked at [AUDIT_TRAIL].'

  -- ── Section 3. The six created rows ───────────────────────────────────────
  union all
  select
    30,
    '[CREATED] the six A2-created grants exist at their authored ids',
    '6 of 6 exact, active, correctly owned',
    (select count(*)::text
       from created c
       join public.admin_scope_access s on s.id = c.scope_id
       join public.admin_users u        on u.auth_user_id = s.user_id
      where lower(btrim(u.email)) = c.email
        and s.program_id = c.program_id and s.season_id = c.season_id
        and s.role = c.scope_role and s.status = 'active') || ' of 6 exact',
    case when (select count(*)
                 from created c
                 join public.admin_scope_access s on s.id = c.scope_id
                 join public.admin_users u        on u.auth_user_id = s.user_id
                where lower(btrim(u.email)) = c.email
                  and s.program_id = c.program_id and s.season_id = c.season_id
                  and s.role = c.scope_role and s.status = 'active') = 6
         then 'PASS' else 'FAIL' end,
    'The ids are literals authored into apply.sql, not generated, so this check proves the exact rows rather than "a row that looks like this". Rollback removes precisely these ids. Missing or wrong: '
      || coalesce((select string_agg(c.label, ', ' order by c.label)
                     from created c
                     left join public.admin_scope_access s on s.id = c.scope_id
                    where s.id is null or s.program_id is distinct from c.program_id
                       or s.season_id is distinct from c.season_id
                       or s.role is distinct from c.scope_role or s.status is distinct from 'active'), '<none>')

  -- ── Section 4. Accounts and their authority ───────────────────────────────
  union all
  select
    40,
    '[ACCOUNT_ROLES] every account holds exactly its intended platform role and status',
    '6 of 6 as intended (4 admin/active, 1 viewer/active, 1 admin/inactive)',
    (select count(*)::text from staff t join public.admin_users u on lower(btrim(u.email)) = t.email
      where u.role = t.want_role and u.status = t.want_status) || ' of 6',
    case when (select count(*) from staff t join public.admin_users u on lower(btrim(u.email)) = t.email
                where u.role = t.want_role and u.status = t.want_status) = 6
         then 'PASS' else 'FAIL' end,
    'A2 changes exactly ONE platform role: viewer.vam.test, reviewer -> viewer. Observed: '
      || coalesce((select string_agg(t.email || '=' || coalesce(u.role,'<missing>') || '/' || coalesce(u.status,'<missing>'), '; ' order by t.email)
                     from staff t left join public.admin_users u on lower(btrim(u.email)) = t.email), '<none>')

  union all
  select
    41,
    '[ADMIN_GRANTS] each real Admin holds exactly S11 + S12 full_access, active',
    '4 of 4, with no extra active scope',
    (select count(*)::text from staff t join public.admin_users u on lower(btrim(u.email)) = t.email, expected e
      where t.is_real_admin
        and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active') = 2
        and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active'
              and s.program_id = e.uehm and s.season_id = e.s11 and s.role = 'full_access') = 1
        and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active'
              and s.program_id = e.uehm and s.season_id = e.s12 and s.role = 'full_access') = 1) || ' of 4',
    case when (select count(*) from staff t join public.admin_users u on lower(btrim(u.email)) = t.email, expected e
                where t.is_real_admin
                  and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active') = 2
                  and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active'
                        and s.program_id = e.uehm and s.season_id = e.s11 and s.role = 'full_access') = 1
                  and (select count(*) from public.admin_scope_access s where s.user_id = u.auth_user_id and s.status = 'active'
                        and s.program_id = e.uehm and s.season_id = e.s12 and s.role = 'full_access') = 1) = 4
         then 'PASS' else 'FAIL' end,
    'The "exactly 2" clause is what makes this a proof rather than a spot check: an extra active grant on any other scope fails it. Both grants are season-bearing, canonical-UUID and full_access, which is every predicate vam063_authorized_for_scope applies.'

  union all
  select
    42,
    '[PROGRAM_WIDE] no ACTIVE program-wide grant exists anywhere',
    '0',
    (select count(*)::text from public.admin_scope_access where status = 'active' and season_id is null),
    case when (select count(*) from public.admin_scope_access where status = 'active' and season_id is null) = 0
         then 'PASS' else 'FAIL' end,
    'A season_id IS NULL grant is refused by vam063_authorized_for_scope (NULL = uuid yields NULL). Program-wide semantics are WP1-A3 and A2 creates none.'

  union all
  select
    43,
    '[NO_FOREIGN_AUTHORITY] every active grant belongs to a manifest account, at UEHM S11 or S12',
    '0 active grants outside the manifest set',
    (select count(*)::text from public.admin_scope_access s, expected e
      where s.status = 'active'
        and (s.program_id is distinct from e.uehm
          or s.season_id not in (e.s11, e.s12)
          or not exists (select 1 from public.admin_users u join staff t on lower(btrim(u.email)) = t.email
                          where u.auth_user_id = s.user_id))),
    case when (select count(*) from public.admin_scope_access s, expected e
                where s.status = 'active'
                  and (s.program_id is distinct from e.uehm
                    or s.season_id not in (e.s11, e.s12)
                    or not exists (select 1 from public.admin_users u join staff t on lower(btrim(u.email)) = t.email
                                    where u.auth_user_id = s.user_id))) = 0
         then 'PASS' else 'FAIL' end,
    'Answers the question the per-account checks cannot: does anyone hold authority this package never granted? Any active row on another program, another season, or another identity fails here.'

  -- ── Section 5. The controlled demo viewer ─────────────────────────────────
  union all
  select
    50,
    '[DEMO_VIEWER_ROLE] the demo account is platform role viewer',
    'viewer',
    coalesce((select d.role from demo d), '<account missing>'),
    case when (select count(*) from demo d where d.role = 'viewer') = 1 then 'PASS' else 'FAIL' end,
    'Dropped from reviewer. The reviewer PII gap on /matches is still open, and this shared credential is about to be handed to exactly the population that must not see reviewer-level PII.'

  union all
  select
    51,
    '[DEMO_VIEWER_ACCOUNT_STATUS] the demo account is still active',
    'active',
    coalesce((select d.status from demo d), '<account missing>'),
    case when (select count(*) from demo d where d.status = 'active') = 1 then 'PASS' else 'FAIL' end,
    'The owner kept the account alive deliberately, as a shared view-only demonstration login. A2 changed its role, never its status.'

  union all
  select
    52,
    '[DEMO_VIEWER_S12_SCOPE] its entire authority is one UEHM/S12 read grant',
    'exactly 1 active grant, and it is UEHM/S12 read',
    (select count(*)::text from public.admin_scope_access s, demo d where s.user_id = d.auth_user_id and s.status = 'active')
      || ' active; UEHM/S12 read = '
      || (select count(*)::text from public.admin_scope_access s, demo d, expected e
           where s.user_id = d.auth_user_id and s.status = 'active'
             and s.program_id = e.uehm and s.season_id = e.s12 and s.role = 'read'),
    case when (select count(*) from public.admin_scope_access s, demo d where s.user_id = d.auth_user_id and s.status = 'active') = 1
          and (select count(*) from public.admin_scope_access s, demo d, expected e
                where s.user_id = d.auth_user_id and s.status = 'active'
                  and s.program_id = e.uehm and s.season_id = e.s12 and s.role = 'read') = 1
         then 'PASS' else 'FAIL' end,
    'read is inert at three layers: vam063_authorized_for_scope filters role in (full_access, operations); lib/program-scope.ts canOperateSeason and canReviewSeason both refuse read; and the viewer platform role renders /matches PII-suppressed. Active detail: '
      || coalesce((select string_agg(coalesce(s.season_id,'<program-wide>') || '/' || coalesce(s.role,'<null>'), ', ')
                     from public.admin_scope_access s, demo d where s.user_id = d.auth_user_id and s.status = 'active'), '<none>')

  union all
  select
    53,
    '[DEMO_VIEWER_S11_ACTIVE] no active Season 11 authority survives, and the old row is retired',
    '0 active S11; the S11 row present, inactive, canonical, level operations',
    (select count(*)::text from public.admin_scope_access s, demo d, expected e
      where s.user_id = d.auth_user_id and s.status = 'active' and s.season_id = e.s11) || ' active S11; retired row = '
      || (select count(*)::text from public.admin_scope_access s, expected e
           where s.id = '487a7562-bb40-4c5c-9dc1-0fe363f1158a'::uuid and s.status = 'inactive'
             and s.program_id = e.uehm and s.season_id = e.s11 and s.role = 'operations'),
    case when (select count(*) from public.admin_scope_access s, demo d, expected e
                where s.user_id = d.auth_user_id and s.status = 'active' and s.season_id = e.s11) = 0
          and (select count(*) from public.admin_scope_access s, expected e
                where s.id = '487a7562-bb40-4c5c-9dc1-0fe363f1158a'::uuid and s.status = 'inactive'
                  and s.program_id = e.uehm and s.season_id = e.s11 and s.role = 'operations') = 1
         then 'PASS' else 'FAIL' end,
    'The row was retired in place rather than rewritten into the S12 grant, so the record that this account once held S11 operations authority still exists — and its level operations is preserved, because unlike "admin" it is already canonical. Season 11 is excluded deliberately: the demo shows the operating season, not historical cohorts.'

  union all
  select
    54,
    '[DEMO_VIEWER_MUTATION_SCOPE] it holds no active operations / full_access / review grant',
    '0',
    (select count(*)::text from public.admin_scope_access s, demo d
      where s.user_id = d.auth_user_id and s.status = 'active' and s.role in ('full_access','operations','review')),
    case when (select count(*) from public.admin_scope_access s, demo d
                where s.user_id = d.auth_user_id and s.status = 'active' and s.role in ('full_access','operations','review')) = 0
         then 'PASS' else 'FAIL' end,
    'PROVES WHAT THE DATABASE GRANTS. IT DOES NOT PROVE EVERY APPLICATION ROUTE IS PII-SAFE FOR A VIEWER. Browser role UAT with Anti is required separately, before the credentials are shared with anyone.'

  -- ── Section 6. The historical identity ────────────────────────────────────
  union all
  select
    60,
    '[HISTORICAL_INACTIVE] the historical admin test identity gained nothing',
    'account inactive, scope inactive, 0 active grants',
    coalesce((select 'account=' || h.status from hist h), '<account missing>')
      || '; scope=' || coalesce((select s.status from public.admin_scope_access s where s.id = 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028'::uuid), '<missing>')
      || '; active grants=' || (select count(*)::text from public.admin_scope_access s, hist h where s.user_id = h.auth_user_id and s.status = 'active'),
    case when (select count(*) from hist h where h.status = 'inactive') = 1
          and (select count(*) from public.admin_scope_access s where s.id = 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028'::uuid and s.status = 'inactive') = 1
          and (select count(*) from public.admin_scope_access s, hist h where s.user_id = h.auth_user_id and s.status = 'active') = 0
         then 'PASS' else 'FAIL' end,
    'Its identifiers were canonicalized only because the planned constraints are table-wide. Changing a stored identifier is not the same act as restoring authority, and this check is what keeps the two apart.'

  -- ── Section 7. The constraints ────────────────────────────────────────────
  union all
  select
    70,
    '[CONSTRAINTS] the five planned CHECK constraints are installed and validated',
    '5 of 5',
    (select count(*)::text from pg_constraint c
      where c.conrelid = to_regclass('public.admin_scope_access') and c.contype = 'c' and c.convalidated
        and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_program_id_canonical_check',
                          'admin_scope_access_season_id_canonical_check','admin_scope_access_role_check',
                          'admin_scope_access_status_check')) || ' of 5',
    case when (select count(*) from pg_constraint c
                where c.conrelid = to_regclass('public.admin_scope_access') and c.contype = 'c' and c.convalidated
                  and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_program_id_canonical_check',
                                    'admin_scope_access_season_id_canonical_check','admin_scope_access_role_check',
                                    'admin_scope_access_status_check')) = 5
         then 'PASS' else 'FAIL' end,
    'Installed: ' || coalesce((select string_agg(c.conname, ', ' order by c.conname) from pg_constraint c
                                where c.conrelid = to_regclass('public.admin_scope_access') and c.contype = 'c'), '<none>')
      || '. VALIDATED matters: a NOT VALID constraint would leave the existing rows unchecked.'

  union all
  select
    71,
    '[NOT_NULL] role, status and program_id are enforced non-null',
    'all three enforced',
    coalesce((select string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ' | ' order by c.conname)
                from pg_constraint c
               where c.conrelid = to_regclass('public.admin_scope_access') and c.contype = 'c'
                 and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_role_check','admin_scope_access_status_check')), '<none>'),
    case when (select count(*) from pg_constraint c
                where c.conrelid = to_regclass('public.admin_scope_access') and c.contype = 'c' and c.convalidated
                  and ((c.conname = 'admin_scope_access_program_id_not_null' and pg_get_constraintdef(c.oid) ilike '%is not null%')
                    or (c.conname = 'admin_scope_access_role_check'          and pg_get_constraintdef(c.oid) ilike '%is not null%')
                    or (c.conname = 'admin_scope_access_status_check'        and pg_get_constraintdef(c.oid) ilike '%is not null%'))) = 3
         then 'PASS' else 'FAIL' end,
    'A bare `x in (...)` CHECK is NULL-PERMISSIVE by SQL semantics — a NULL satisfies it. The IS NOT NULL conjunct is what closes that, and it is inside the same named constraint so rollback can remove exactly what A2 added.'

  union all
  select
    72,
    '[ROLE_VOCABULARY] the role CHECK admits exactly the four canonical levels',
    'full_access, operations, review, read — and not admin',
    coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
               where c.conrelid = to_regclass('public.admin_scope_access') and c.conname = 'admin_scope_access_role_check'), '<missing>'),
    case when (select count(*) from pg_constraint c
                where c.conrelid = to_regclass('public.admin_scope_access') and c.conname = 'admin_scope_access_role_check'
                  and pg_get_constraintdef(c.oid) ilike '%full_access%' and pg_get_constraintdef(c.oid) ilike '%operations%'
                  and pg_get_constraintdef(c.oid) ilike '%review%'      and pg_get_constraintdef(c.oid) ilike '%read%'
                  and pg_get_constraintdef(c.oid) not ilike '%''admin''%') = 1
         then 'PASS' else 'FAIL' end,
    'The legacy level "admin" must not become canonical. WP1-A1 drops it at read time; this constraint makes it unrepresentable in the column at all.'

  union all
  select
    73,
    '[ACTIVE_KEY_INDEX] the active-scope unique index is installed as specified',
    'unique, partial on status=active, NULLS NOT DISTINCT, keyed on (user_id, program_id, season_id)',
    coalesce((select i.idx_def from idx i), '<index missing>'),
    case when (select count(*) from idx i
                where i.idx_count = 1 and i.is_unique and i.nulls_not_distinct and i.is_partial
                  and i.idx_def ilike '%(user_id, program_id, season_id)%'
                  and i.idx_def ilike '%nulls not distinct%'
                  and i.idx_def ilike '%where (status = ''active''::text)%') = 1
         then 'PASS' else 'FAIL' end,
    'NULLS NOT DISTINCT states the rule directly: two program-wide grants for one user collide. A coalesce(season_id, '''') sentinel would instead depend on a value that is only unrepresentable BECAUSE another constraint forbids it.'

  union all
  select
    74,
    '[ACTIVE_KEY_EXCLUDES_ROLE] scope level is not part of the uniqueness key',
    'role absent from the index definition',
    case when (select i.idx_def from idx i) ilike '%role%' then 'role present' else 'role absent' end,
    case when (select count(*) from idx i where i.idx_def not ilike '%role%') = 1 then 'PASS' else 'FAIL' end,
    'Migration 020 keys its equivalent index on (user_id, program_id, season_id, role), which permits an active read grant and an active full_access grant on the identical scope, resolving silently to the stronger one. That index was never applied to Production and is not carried forward.'

  union all
  select
    75,
    '[ACTIVE_KEY_UNIQUE] no duplicate active scope key exists',
    '0',
    (select count(*)::text from (select user_id, program_id, coalesce(season_id, '<program-wide>') as sk
                                   from public.admin_scope_access where status = 'active'
                                  group by 1,2,3 having count(*) > 1) d),
    case when (select count(*) from (select user_id, program_id, coalesce(season_id, '<program-wide>') as sk
                                       from public.admin_scope_access where status = 'active'
                                      group by 1,2,3 having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end,
    'Measured independently of the index, so a dropped or invalid index cannot make this check pass by accident.'

  union all
  select
    76,
    '[CONSTRAINT_ROW] every row of every status satisfies the new contract',
    '0 violating rows',
    (select count(*)::text from public.admin_scope_access s, expected e
      where s.program_id is null or s.program_id !~* e.uuid_re
         or (s.season_id is not null and s.season_id !~* e.uuid_re)
         or s.role is null or s.role not in ('full_access','operations','review','read')
         or s.status is null or s.status not in ('active','inactive')),
    case when (select count(*) from public.admin_scope_access s, expected e
                where s.program_id is null or s.program_id !~* e.uuid_re
                   or (s.season_id is not null and s.season_id !~* e.uuid_re)
                   or s.role is null or s.role not in ('full_access','operations','review','read')
                   or s.status is null or s.status not in ('active','inactive')) = 0
         then 'PASS' else 'FAIL' end,
    'Evaluated over inactive rows too, because the constraints are table-wide. This is the check that would catch a retired row still carrying a legacy identity.'

  -- ── Section 8. The live RPC, read and not invoked ─────────────────────────
  union all
  select
    80,
    '[RPC_UNCHANGED] vam063_authorized_for_scope still carries its own predicates',
    '1 function; season equality, full_access/operations, active grant required',
    (select r.fn_count::text from rpc r) || ' function(s); season_eq='
      || (select coalesce((r.fn_src ~* 'season_id\s*=\s*p_season_id')::text, 'false') from rpc r)
      || ' full_access=' || (select coalesce((r.fn_src ~* 'role\s+in\s*\([^)]*full_access')::text, 'false') from rpc r)
      || ' operations='  || (select coalesce((r.fn_src ~* 'role\s+in\s*\([^)]*operations')::text, 'false') from rpc r)
      || ' active='      || (select coalesce((r.fn_src ~* 'status\s*=\s*.active.')::text, 'false') from rpc r),
    case when (select count(*) from rpc r
                where r.fn_count = 1
                  and r.fn_src ~* 'season_id\s*=\s*p_season_id'
                  and r.fn_src ~* 'role\s+in\s*\([^)]*full_access'
                  and r.fn_src ~* 'role\s+in\s*\([^)]*operations'
                  and r.fn_src ~* 'status\s*=\s*.active.') = 1
         then 'PASS' else 'FAIL' end,
    'Read from pg_get_functiondef, never called. A2 makes no function change; this proves none was made, and proves the grants it wrote are the shape the live function already accepts.'

  union all
  select
    81,
    '[RPC_REFUSES_READ] the RPC still refuses the demo viewer''s level',
    'read absent from the function''s level filter',
    case when (select r.fn_src from rpc r) ~* 'role\s+in\s*\([^)]*''read''' then 'read accepted' else 'read refused' end,
    case when (select count(*) from rpc r where r.fn_src !~* 'role\s+in\s*\([^)]*''read''') = 1 then 'PASS' else 'FAIL' end,
    'This is the database half of the demo account being inert. If a later change widened the filter to include read, the shared demo login would silently gain mutation authority.'

  -- ── Section 9. The audit trail ────────────────────────────────────────────
  union all
  select
    90,
    '[AUDIT_TRAIL] the convergence left an auditable record',
    '6 audit rows from the apply, using the existing vocabulary',
    (select a.apply_rows::text from audit a) || ' rows',
    case when (select a.apply_rows from audit a) = 6 then 'PASS' else 'FAIL' end,
    'One row per affected account, action_type update_admin_user — the value lib/admin-users.ts already writes when an account''s role and scope change together. No new event vocabulary was invented and no audit constraint was weakened.'

  union all
  select
    91,
    '[AUDIT_PREIMAGE] the two unrepresentable pre-images were recorded',
    'Lieu UEHM/NULL/admin/active = 1; demo S11 operations active = 1',
    'lieu=' || (select a.lieu_preimage::text from audit a) || ' demo=' || (select a.demo_preimage::text from audit a),
    case when (select a.lieu_preimage from audit a) = 1 and (select a.demo_preimage from audit a) >= 1
         then 'PASS' else 'FAIL' end,
    'Lieu''s scope level "admin" cannot exist in the column after the role CHECK, so admin_audit_log is the only place the pre-A2 truth survives. It is also what makes the rollback''s restoration of that value provable rather than remembered.'

  -- ── Section 10. What did NOT happen ───────────────────────────────────────
  union all
  select
    100,
    '[INFO] rows created by A2, for the rollback record',
    '6 rows at the ids authored in apply.sql',
    (select count(*)::text from created c join public.admin_scope_access s on s.id = c.scope_id) || ' present',
    'INFO',
    coalesce((select string_agg(c.scope_id::text || ' = ' || c.label, '; ' order by c.scope_id) from created c), '<none>')
),
verdict as (
  select count(*) filter (where result = 'FAIL') as failures, count(*) filter (where result <> 'INFO') as gating
  from checks
)
select seq, check_name, expected, actual, result, details from checks
union all
select
  9999,
  '[A2_VERIFIED] WP1-A2 convergence is exactly the owner-approved state',
  'A2_VERIFIED = true',
  'A2_VERIFIED = ' || case when v.failures = 0 then 'true' else 'false' end,
  case when v.failures > 0 then 'FAIL' else 'PASS' end,
  v.failures || ' failing check(s) of ' || v.gating || ' gating. '
    || case when v.failures = 0
            then 'The database now grants exactly what the owner approved. It does NOT prove every application route renders PII-safely for a viewer: browser role UAT with Anti is still required before the demo credentials are shared with anyone.'
            else 'STOP. Do not deploy WP1-A1 and do not share the demo credentials. Read the failing rows above, then evaluate rollback eligibility — rollback.sql has its own guards and refuses if the state is no longer exactly rollback-compatible.' end
from verdict v
order by 1;

rollback;
