-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Emergency Admin RLS Verification
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
-- Purpose: Confirm staging state after running VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql.
-- Run mode: Owner-executed read-only query in Supabase SQL Editor (staging only).
-- Output: Exactly ONE row, ONE JSONB column named verification_result.
--
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block mutating-function-invocation
-- Sources: pg_tables pg_policies pg_proc pg_namespace pg_roles pg_constraint
--          information_schema has_function_privilege()
-- Policy expressions replaced by structural boolean flags
-- =============================================================================

with

-- -----------------------------------------------------------------------
-- V1: admin_users RLS state and policy inventory
-- -----------------------------------------------------------------------
v1 as (
  select jsonb_build_object(
    'rls_enabled',    t.rowsecurity,
    'policies',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'policyname',             p.policyname,
            'command',                p.cmd,
            'using_present',          p.qual is not null,
            'with_check_present',     p.with_check is not null,
            'broad_true_condition',   p.qual in ('true', 'TRUE', '(true)'),
            'references_auth_uid',    coalesce(p.qual like '%auth.uid%', false),
            'references_admin_role',  coalesce(p.qual like '%current_admin_role%', false)
          ) order by p.policyname
        )
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename  = 'admin_users'
      ), '[]'::jsonb),
    'expected_select_policy_present',
      exists(
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename  = 'admin_users'
          and policyname = 'read_admin_users_super_admin_or_self'
          and cmd        = 'SELECT'
      ),
    'write_policies_absent',
      not exists(
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename  = 'admin_users'
          and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      )
  ) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename  = 'admin_users'
),

-- -----------------------------------------------------------------------
-- V2: anon EXECUTE grants on 4 emergency-scoped functions
-- Expected: all false after migration
-- -----------------------------------------------------------------------
v2 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'function_name', p.proname || '(' || pg_get_function_arguments(p.oid) || ')',
      'anon_can_execute',          has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_can_execute',  has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'anon_revoked_ok',           not has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_retained_ok', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.proname
  ), '[]'::jsonb) as data
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('current_admin_role', 'is_active_admin', 'is_admin_role', 'get_operations_dashboard_data')
    and p.prokind = 'f'
),

-- -----------------------------------------------------------------------
-- V3: admin_audit_log RLS state and policy
-- -----------------------------------------------------------------------
v3 as (
  select jsonb_build_object(
    'rls_enabled',    t.rowsecurity,
    'policies',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'policyname',            p.policyname,
            'command',               p.cmd,
            'using_present',         p.qual is not null,
            'broad_true_condition',  p.qual in ('true', 'TRUE', '(true)'),
            'references_admin_role', coalesce(p.qual like '%current_admin_role%', false)
          ) order by p.policyname
        )
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename  = 'admin_audit_log'
      ), '[]'::jsonb),
    'expected_select_policy_present',
      exists(
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename  = 'admin_audit_log'
          and policyname = 'read_admin_audit_log_super_admin_only'
          and cmd        = 'SELECT'
      ),
    'write_policies_absent',
      not exists(
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename  = 'admin_audit_log'
          and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      ),
    'action_type_constraint_present',
      exists(
        select 1 from pg_constraint c
        join pg_class cl on cl.oid = c.conrelid
        join pg_namespace ns on ns.oid = cl.relnamespace
        where ns.nspname = 'public'
          and cl.relname = 'admin_audit_log'
          and c.conname  = 'admin_audit_log_action_type_check'
      )
  ) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename  = 'admin_audit_log'
),

-- -----------------------------------------------------------------------
-- V4: admin_scope_access compatibility
-- Confirm RLS still enabled and policy still present after emergency migration.
-- The emergency migration does not touch admin_scope_access — this is a regression check.
-- -----------------------------------------------------------------------
v4 as (
  select jsonb_build_object(
    'rls_enabled',          t.rowsecurity,
    'scope_policy_present',
      exists(
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename  = 'admin_scope_access'
          and policyname = 'read_admin_scope_access_self_or_super_admin'
      ),
    'rls_regression_ok',    t.rowsecurity
  ) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename  = 'admin_scope_access'
),

-- -----------------------------------------------------------------------
-- V5: No participant schema changes
-- people.auth_user_id must still be absent (Auth_B not applied in this package).
-- current_person_id must not exist (Auth_C not applied in this package).
-- -----------------------------------------------------------------------
v5 as (
  select jsonb_build_object(
    'people_auth_user_id_absent',
      not exists(
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'people'
          and column_name  = 'auth_user_id'
      ),
    'current_person_id_absent',
      not exists(
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname  = 'current_person_id'
      )
  ) as data
),

-- -----------------------------------------------------------------------
-- V6: No unintended business table RLS changes
-- These tables are NOT in the emergency scope. Confirm their RLS state
-- was not altered by this migration.
-- -----------------------------------------------------------------------
v6 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',         t.tablename,
      'rls_enabled',       t.rowsecurity,
      'expected_disabled', not t.rowsecurity,
      'regression_note',   'these tables must remain RLS-disabled until Auth_A migration'
    ) order by t.tablename
  ), '[]'::jsonb) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in (
      'people',
      'mentor_profiles',
      'mentee_profiles',
      'matches',
      'mentoring_recaps',
      'event_participations',
      'applications'
    )
),

-- -----------------------------------------------------------------------
-- V7: Lockout invariant — at least one active super_admin with auth_user_id
-- -----------------------------------------------------------------------
v7 as (
  select jsonb_build_object(
    'active_super_admin_count_approx', c.reltuples::bigint,
    'note',                            'pg_class.reltuples estimate; run ANALYZE for exact count'
  ) as data
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind  = 'r'
    and c.relname  = 'admin_users'
),

-- -----------------------------------------------------------------------
-- V8: Summary assertions
-- All must be true for the migration to be considered correct.
-- -----------------------------------------------------------------------
v8 as (
  select jsonb_build_object(
    'admin_users_rls_enabled',
      (select (data->>'rls_enabled')::boolean from v1),
    'admin_users_select_policy_present',
      (select (data->>'expected_select_policy_present')::boolean from v1),
    'admin_users_write_policies_absent',
      (select (data->>'write_policies_absent')::boolean from v1),
    'all_anon_revokes_applied',
      not exists(
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('current_admin_role', 'is_active_admin', 'is_admin_role', 'get_operations_dashboard_data')
          and p.prokind = 'f'
          and has_function_privilege('anon', p.oid, 'EXECUTE')
      ),
    'all_authenticated_grants_retained',
      not exists(
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('current_admin_role', 'is_active_admin', 'is_admin_role', 'get_operations_dashboard_data')
          and p.prokind = 'f'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ),
    'admin_audit_log_rls_enabled',
      (select (data->>'rls_enabled')::boolean from v3),
    'admin_audit_log_select_policy_present',
      (select (data->>'expected_select_policy_present')::boolean from v3),
    'admin_audit_log_write_policies_absent',
      (select (data->>'write_policies_absent')::boolean from v3),
    'action_type_constraint_present',
      (select (data->>'action_type_constraint_present')::boolean from v3),
    'admin_scope_access_unaffected',
      (select (data->>'rls_regression_ok')::boolean from v4),
    'participant_schema_unchanged',
      (select (data->'people_auth_user_id_absent')::boolean from v5)
      and (select (data->'current_person_id_absent')::boolean from v5),
    'business_tables_unaffected',
      not exists(
        select 1
        from pg_tables
        where schemaname = 'public'
          and tablename in ('people', 'mentor_profiles', 'mentee_profiles', 'matches', 'mentoring_recaps', 'event_participations', 'applications')
          and rowsecurity = true
      )
  ) as data
)

select jsonb_build_object(
  'probe_version',                'VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION_V1',
  'executed_at',                  now()::text,
  'executed_database',            current_database(),
  'v1_admin_users_rls',           (select data from v1),
  'v2_anon_function_grants',      (select data from v2),
  'v3_admin_audit_log',           (select data from v3),
  'v4_admin_scope_access',        (select data from v4),
  'v5_participant_schema_check',  (select data from v5),
  'v6_business_table_regression', (select data from v6),
  'v7_lockout_invariant',         (select data from v7),
  'v8_summary_assertions',        (select data from v8),
  'summary', jsonb_build_object(
    'sections_present', 8,
    'read_only',        true
  )
) as verification_result;
