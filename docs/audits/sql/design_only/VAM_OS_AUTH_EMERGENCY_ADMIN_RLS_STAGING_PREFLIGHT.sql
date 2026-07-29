-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Emergency Admin RLS Staging Preflight
-- Probe: VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V1
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
-- Purpose: Owner-authorized read-only staging preflight before applying
--          VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql.
--
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block mutating-function-invocation
-- Sources: pg_tables pg_policies pg_proc pg_namespace pg_roles
--          pg_constraint information_schema auth.users (count only)
-- Output: Exactly ONE row, ONE JSONB column named preflight_result
-- PII exclusions: no email, no name, no auth_user_id values, no tokens,
--                 no raw rows — counts and boolean flags only
-- =============================================================================

with

-- -----------------------------------------------------------------------
-- P1: admin_users — RLS state and policy inventory
-- -----------------------------------------------------------------------
p1 as (
  select jsonb_build_object(
    'table_exists',  exists(
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'admin_users'
    ),
    'rls_enabled',   t.rowsecurity,
    'policy_count',  (
      select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'admin_users'
    ),
    'policies',      coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyname',            p.policyname,
        'command',               p.cmd,
        'using_present',         p.qual is not null,
        'references_auth_uid',   coalesce(p.qual like '%auth.uid%', false),
        'references_admin_role', coalesce(p.qual like '%current_admin_role%', false)
      ) order by p.policyname)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'admin_users'
    ), '[]'::jsonb)
  ) as data
  from pg_tables t
  where t.schemaname = 'public' and t.tablename = 'admin_users'
),

-- -----------------------------------------------------------------------
-- P2: admin_audit_log — RLS state and policy inventory
-- -----------------------------------------------------------------------
p2 as (
  select jsonb_build_object(
    'table_exists',  exists(
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'admin_audit_log'
    ),
    'rls_enabled',   t.rowsecurity,
    'policy_count',  (
      select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'admin_audit_log'
    ),
    'policies',      coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyname',            p.policyname,
        'command',               p.cmd,
        'using_present',         p.qual is not null,
        'broad_true_condition',  p.qual in ('true', 'TRUE', '(true)'),
        'references_admin_role', coalesce(p.qual like '%current_admin_role%', false)
      ) order by p.policyname)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'admin_audit_log'
    ), '[]'::jsonb),
    'action_type_constraint_present', exists(
      select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      where ns.nspname = 'public'
        and cl.relname = 'admin_audit_log'
        and c.conname  = 'admin_audit_log_action_type_check'
    )
  ) as data
  from pg_tables t
  where t.schemaname = 'public' and t.tablename = 'admin_audit_log'
),

-- -----------------------------------------------------------------------
-- P3: Continuity invariant — super_admin count, auth linkage, Auth user
-- No email, name, UUID, or raw row is returned — counts only.
-- -----------------------------------------------------------------------
p3 as (
  select jsonb_build_object(
    'active_super_admin_count',
      (select count(*)::int from public.admin_users
       where role = 'super_admin' and status = 'active'),
    'active_super_admin_with_auth_user_id_count',
      (select count(*)::int from public.admin_users
       where role = 'super_admin' and status = 'active' and auth_user_id is not null),
    'linked_auth_user_count',
      (select count(*)::int
       from public.admin_users au
       join auth.users u on u.id = au.auth_user_id
       where au.role = 'super_admin' and au.status = 'active'),
    'duplicate_auth_user_id_count',
      (select count(*)::int from (
        select auth_user_id from public.admin_users
        where auth_user_id is not null
        group by auth_user_id having count(*) > 1
      ) dupes),
    'continuity_pass',
      (select count(*)::int from public.admin_users au
       join auth.users u on u.id = au.auth_user_id
       where au.role = 'super_admin' and au.status = 'active') >= 1
  ) as data
),

-- -----------------------------------------------------------------------
-- P4: Function EXECUTE privileges — 4 emergency-scoped functions
-- -----------------------------------------------------------------------
p4 as (
  select jsonb_build_object(
    'current_admin_role_anon',
      has_function_privilege('anon',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'current_admin_role' limit 1),
        'EXECUTE'),
    'is_active_admin_anon',
      has_function_privilege('anon',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_active_admin' limit 1),
        'EXECUTE'),
    'is_admin_role_anon',
      has_function_privilege('anon',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_admin_role' limit 1),
        'EXECUTE'),
    'get_operations_dashboard_data_anon',
      has_function_privilege('anon',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'get_operations_dashboard_data' limit 1),
        'EXECUTE'),
    'current_admin_role_authenticated',
      has_function_privilege('authenticated',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'current_admin_role' limit 1),
        'EXECUTE'),
    'is_active_admin_authenticated',
      has_function_privilege('authenticated',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_active_admin' limit 1),
        'EXECUTE'),
    'is_admin_role_authenticated',
      has_function_privilege('authenticated',
        (select oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_admin_role' limit 1),
        'EXECUTE')
  ) as data
),

-- -----------------------------------------------------------------------
-- P5: Package compatibility — required columns, functions, tables
-- -----------------------------------------------------------------------
p5 as (
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
      exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'current_admin_role')
      and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'is_active_admin')
      and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'is_admin_role')
      and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'get_operations_dashboard_data'),
    'people_auth_user_id_absent',
      not exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'people' and column_name = 'auth_user_id'),
    'admin_scope_access_rls_enabled',
      (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'admin_scope_access'),
    'summary_pass',
      (
        exists(select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'admin_users' and column_name = 'auth_user_id')
        and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'current_admin_role')
        and (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'admin_scope_access')
      )
  ) as data
)

select jsonb_build_object(
  'probe_version',         'VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V1',
  'executed_at',           now()::text,
  'target_database',       current_database(),
  'admin_users',           (select data from p1),
  'admin_audit_log',       (select data from p2),
  'continuity',            (select data from p3),
  'function_privileges',   (select data from p4),
  'package_compatibility', (select data from p5),
  'summary', jsonb_build_object(
    'sections_present', 5,
    'read_only',        true,
    'pii_excluded',     true
  )
) as preflight_result;
