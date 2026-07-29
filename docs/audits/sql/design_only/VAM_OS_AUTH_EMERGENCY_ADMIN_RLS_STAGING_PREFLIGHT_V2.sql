-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Emergency Admin RLS Staging Preflight V2
-- Probe: VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V2
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
-- Replaces: VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V1
--   V1 failed with: ERROR 42702 column reference "oid" is ambiguous
--   Root cause: bare `select oid` in P4 with pg_proc JOIN pg_namespace —
--               both tables expose `oid` as a system column.
--   V2 correction: all pg_proc OID references use fn.oid; all
--               pg_namespace OID references use ns.oid; every catalog
--               column is fully table-qualified.
--   Additional corrections:
--     - add get_operations_dashboard_data_authenticated to function_privileges
--     - add dedicated admin_scope_access section (was absent from V1)
--     - update sections_present from 5 to 6
--
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block mutating-function-invocation
-- Sources: pg_tables pg_policies pg_proc pg_namespace pg_constraint
--          pg_class information_schema auth.users (count only)
--          has_function_privilege() current_database() now()
-- Output: Exactly ONE row, ONE JSONB column named preflight_result
-- PII exclusions: no email, no name, no auth_user_id values, no UUIDs,
--                 no tokens, no raw rows — counts and boolean flags only
-- =============================================================================

with

-- -----------------------------------------------------------------------
-- P1: admin_users — RLS state and policy inventory
-- Alias legend: t = pg_tables, pol = pg_policies (inner subquery)
-- -----------------------------------------------------------------------
p1 as (
  select jsonb_build_object(
    'table_exists',  exists(
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'admin_users'
    ),
    'rls_enabled',   t.rowsecurity,
    'policy_count',  (
      select count(pol.policyname)::int
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_users'
    ),
    'policies',      coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyname',            pol.policyname,
        'command',               pol.cmd,
        'using_present',         pol.qual is not null,
        'references_auth_uid',   coalesce(pol.qual like '%auth.uid%', false),
        'references_admin_role', coalesce(pol.qual like '%current_admin_role%', false)
      ) order by pol.policyname)
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_users'
    ), '[]'::jsonb)
  ) as data
  from pg_tables t
  where t.schemaname = 'public' and t.tablename = 'admin_users'
),

-- -----------------------------------------------------------------------
-- P2: admin_audit_log — RLS state, policy inventory, constraint check
-- Alias legend: t = pg_tables, pol = pg_policies, con = pg_constraint,
--               cls = pg_class, ns = pg_namespace
-- -----------------------------------------------------------------------
p2 as (
  select jsonb_build_object(
    'table_exists',  exists(
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'admin_audit_log'
    ),
    'rls_enabled',   t.rowsecurity,
    'policy_count',  (
      select count(pol.policyname)::int
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_audit_log'
    ),
    'policies',      coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyname',            pol.policyname,
        'command',               pol.cmd,
        'using_present',         pol.qual is not null,
        'broad_true_condition',  pol.qual in ('true', 'TRUE', '(true)'),
        'references_admin_role', coalesce(pol.qual like '%current_admin_role%', false)
      ) order by pol.policyname)
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_audit_log'
    ), '[]'::jsonb),
    'action_type_constraint_present', exists(
      select 1
      from pg_constraint con
      join pg_class cls on cls.oid = con.conrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
      where ns.nspname = 'public'
        and cls.relname = 'admin_audit_log'
        and con.conname = 'admin_audit_log_action_type_check'
    )
  ) as data
  from pg_tables t
  where t.schemaname = 'public' and t.tablename = 'admin_audit_log'
),

-- -----------------------------------------------------------------------
-- P3: admin_scope_access — RLS state and policy inventory (NEW in V2)
-- Confirms the regression invariant: this table's RLS must be unaffected
-- by the emergency migration (which does not touch admin_scope_access).
-- Alias legend: t = pg_tables, pol = pg_policies (inner subquery)
-- -----------------------------------------------------------------------
p3 as (
  select jsonb_build_object(
    'table_exists',         exists(
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'admin_scope_access'
    ),
    'rls_enabled',          t.rowsecurity,
    'policy_count',         (
      select count(pol.policyname)::int
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_scope_access'
    ),
    'scope_policy_present', exists(
      select 1 from pg_policies pol
      where pol.schemaname = 'public'
        and pol.tablename  = 'admin_scope_access'
        and pol.policyname = 'read_admin_scope_access_self_or_super_admin'
    ),
    'policies',             coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyname',  pol.policyname,
        'command',     pol.cmd,
        'using_present', pol.qual is not null
      ) order by pol.policyname)
      from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = 'admin_scope_access'
    ), '[]'::jsonb)
  ) as data
  from pg_tables t
  where t.schemaname = 'public' and t.tablename = 'admin_scope_access'
),

-- -----------------------------------------------------------------------
-- P4: Continuity invariant — super_admin count, auth linkage
-- No email, name, UUID, or raw row is returned — counts only.
-- -----------------------------------------------------------------------
p4 as (
  select jsonb_build_object(
    'active_super_admin_count',
      (select count(*)::int from public.admin_users au
       where au.role = 'super_admin' and au.status = 'active'),
    'active_super_admin_with_auth_user_id_count',
      (select count(*)::int from public.admin_users au
       where au.role = 'super_admin' and au.status = 'active' and au.auth_user_id is not null),
    'linked_auth_user_count',
      (select count(*)::int
       from public.admin_users au
       join auth.users u on u.id = au.auth_user_id
       where au.role = 'super_admin' and au.status = 'active'),
    'duplicate_auth_user_id_count',
      (select count(*)::int from (
        select au2.auth_user_id
        from public.admin_users au2
        where au2.auth_user_id is not null
        group by au2.auth_user_id having count(*) > 1
      ) dupes),
    'continuity_pass',
      (select count(*)::int
       from public.admin_users au
       join auth.users u on u.id = au.auth_user_id
       where au.role = 'super_admin' and au.status = 'active') >= 1
  ) as data
),

-- -----------------------------------------------------------------------
-- P5: Function EXECUTE privileges — 4 emergency-scoped functions × 2 roles
-- V2 FIX: bare `oid` replaced by fn.oid throughout (42702 root cause).
-- V2 ADDITION: get_operations_dashboard_data_authenticated (was absent).
-- Alias legend: fn = pg_proc, ns = pg_namespace
-- -----------------------------------------------------------------------
p5 as (
  select jsonb_build_object(
    'current_admin_role_anon',
      has_function_privilege('anon',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'current_admin_role' limit 1),
        'EXECUTE'),
    'is_active_admin_anon',
      has_function_privilege('anon',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'is_active_admin' limit 1),
        'EXECUTE'),
    'is_admin_role_anon',
      has_function_privilege('anon',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'is_admin_role' limit 1),
        'EXECUTE'),
    'get_operations_dashboard_data_anon',
      has_function_privilege('anon',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'get_operations_dashboard_data' limit 1),
        'EXECUTE'),
    'current_admin_role_authenticated',
      has_function_privilege('authenticated',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'current_admin_role' limit 1),
        'EXECUTE'),
    'is_active_admin_authenticated',
      has_function_privilege('authenticated',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'is_active_admin' limit 1),
        'EXECUTE'),
    'is_admin_role_authenticated',
      has_function_privilege('authenticated',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'is_admin_role' limit 1),
        'EXECUTE'),
    'get_operations_dashboard_data_authenticated',
      has_function_privilege('authenticated',
        (select fn.oid from pg_proc fn
         join pg_namespace ns on ns.oid = fn.pronamespace
         where ns.nspname = 'public' and fn.proname = 'get_operations_dashboard_data' limit 1),
        'EXECUTE')
  ) as data
),

-- -----------------------------------------------------------------------
-- P6: Package compatibility — required columns, functions, regression checks
-- Alias legend: fn = pg_proc, ns = pg_namespace (inner subqueries)
-- -----------------------------------------------------------------------
p6 as (
  select jsonb_build_object(
    'required_columns_present',
      exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'admin_users' and column_name = 'auth_user_id')
      and exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'admin_users' and column_name = 'role')
      and exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'admin_users' and column_name = 'status')
      and exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'admin_audit_log' and column_name = 'action_type'),
    'required_functions_present',
      exists(select 1 from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
             where ns.nspname = 'public' and fn.proname = 'current_admin_role')
      and exists(select 1 from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
             where ns.nspname = 'public' and fn.proname = 'is_active_admin')
      and exists(select 1 from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
             where ns.nspname = 'public' and fn.proname = 'is_admin_role')
      and exists(select 1 from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
             where ns.nspname = 'public' and fn.proname = 'get_operations_dashboard_data'),
    'people_auth_user_id_absent',
      not exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'people' and column_name = 'auth_user_id'),
    'admin_scope_access_rls_enabled',
      (select t.rowsecurity from pg_tables t
       where t.schemaname = 'public' and t.tablename = 'admin_scope_access'),
    'summary_pass',
      (
        exists(select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'admin_users' and column_name = 'auth_user_id')
        and exists(select 1 from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
               where ns.nspname = 'public' and fn.proname = 'current_admin_role')
        and coalesce(
          (select t.rowsecurity from pg_tables t
           where t.schemaname = 'public' and t.tablename = 'admin_scope_access'),
          false
        )
      )
  ) as data
)

select jsonb_build_object(
  'probe_version',         'VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V2',
  'executed_at',           now()::text,
  'target_database',       current_database(),
  'admin_users',           (select data from p1),
  'admin_audit_log',       (select data from p2),
  'admin_scope_access',    (select data from p3),
  'continuity',            (select data from p4),
  'function_privileges',   (select data from p5),
  'package_compatibility', (select data from p6),
  'summary', jsonb_build_object(
    'sections_present', 6,
    'read_only',        true,
    'pii_excluded',     true
  )
) as preflight_result;
