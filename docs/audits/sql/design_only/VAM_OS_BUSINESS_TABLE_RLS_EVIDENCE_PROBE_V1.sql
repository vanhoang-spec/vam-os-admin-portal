-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Business Table RLS Evidence Probe
-- Probe: VAM_OS_BUSINESS_TABLE_RLS_EVIDENCE_PROBE_V1
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-30
--
-- Purpose:
--   The Emergency Admin RLS verification (run 2026-07-30) reported
--   business_tables_unaffected=false because public.matches,
--   public.mentee_profiles, and public.people have relrowsecurity=true on
--   staging. The emergency admin RLS migration contains no statement that
--   touches those tables (scope proof: TASK 1 forensic review, this session).
--   This probe retrieves the authoritative RLS state, full policy definitions,
--   and privilege inventory for the six business tables in scope, to establish
--   whether the enabled state predates the migration and which migration is
--   responsible.
--
-- Target tables:
--   public.people, public.mentor_profiles, public.mentee_profiles,
--   public.matches, public.mentoring_recaps, public.event_participations
--
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block anonymous-code-execution
--              ANALYZE VACUUM CLUSTER SAVEPOINT ROLLBACK COMMIT BEGIN
-- Catalog sources:
--   pg_policies (view), pg_policy, pg_class, pg_namespace, pg_roles
--   pg_get_expr(), pg_get_userbyid(), has_table_privilege()
--   public.admin_users (count(*) only — no row data, no PII)
-- Output: Exactly ONE row, ONE JSONB column named business_table_rls_evidence_result
-- PII exclusions:
--   No email, no auth_user_id values, no raw row data, no tokens or secrets.
--   Policy USING/WITH CHECK expressions (schema-level definitions) are
--   returned because proving their content is the probe's purpose.
-- No production project reference — probe is environment-agnostic.
-- =============================================================================

with

target_tables(tablename) as (
  values
    ('people'),
    ('mentor_profiles'),
    ('mentee_profiles'),
    ('matches'),
    ('mentoring_recaps'),
    ('event_participations')
),

-- ---------------------------------------------------------------------------
-- T1: Table existence, RLS flags, owner
-- ---------------------------------------------------------------------------
t1 as (
  select
    tt.tablename,
    cls.oid                                  as relid,
    cls.oid is not null                      as table_exists,
    coalesce(cls.relrowsecurity,     false)  as rls_enabled,
    coalesce(cls.relforcerowsecurity, false) as rls_forced,
    pg_get_userbyid(cls.relowner)            as table_owner
  from target_tables tt
  left join pg_class cls
    on cls.relnamespace = (select oid from pg_namespace where nspname = 'public')
    and cls.relname = tt.tablename
),

-- ---------------------------------------------------------------------------
-- T2: All policies on the six target tables with full USING and WITH CHECK
--     expressions via pg_get_expr — authoritative decompiled expression tree.
--     pg_policies.roles handles the PUBLIC (polroles = {0}) case correctly,
--     returning 'public' rather than null. pg_policy is joined for expression
--     retrieval because pg_policies.qual is already-formatted text, whereas
--     pg_get_expr(pol.polqual, pol.polrelid) returns the canonical decompiled
--     expression tree used by system views.
-- ---------------------------------------------------------------------------
t2 as (
  select
    cls.oid                                             as polrelid,
    pv.policyname,
    pv.cmd                                              as command,
    pv.permissive                                       as mode,
    coalesce(array_to_string(pv.roles, ', '), 'public') as roles,
    pg_get_expr(pol.polqual,      pol.polrelid)         as using_expression,
    pg_get_expr(pol.polwithcheck, pol.polrelid)         as with_check_expression
  from pg_policies pv
  join pg_class cls
    on cls.relname        = pv.tablename
    and cls.relnamespace  = (select oid from pg_namespace where nspname = 'public')
  join pg_policy pol
    on pol.polname   = pv.policyname
    and pol.polrelid = cls.oid
  where pv.schemaname = 'public'
    and pv.tablename  in (select tablename from target_tables)
),

-- ---------------------------------------------------------------------------
-- T3: Table-level SELECT privilege for authenticated and anon roles.
--     Note: privilege=true but rls_enabled_no_policy=true → zero rows visible
--     (PostgreSQL fail-closed default). privilege=false → query error.
-- ---------------------------------------------------------------------------
t3 as (
  select
    t1.tablename,
    t1.relid,
    case when t1.relid is not null
      then has_table_privilege('authenticated', t1.relid, 'SELECT')
      else null
    end as authenticated_can_select,
    case when t1.relid is not null
      then has_table_privilege('anon', t1.relid, 'SELECT')
      else null
    end as anon_can_select
  from t1
),

-- ---------------------------------------------------------------------------
-- T4: Exact active super_admin count — direct count(*), not pg_class.reltuples
-- ---------------------------------------------------------------------------
t4 as (
  select count(*)::int as active_super_admin_count
  from public.admin_users
  where role         = 'super_admin'
    and status       = 'active'
    and auth_user_id is not null
),

-- ---------------------------------------------------------------------------
-- T5: Per-table summary combining T1, T2, T3
-- ---------------------------------------------------------------------------
t5 as (
  select
    t1.tablename,
    t1.table_exists,
    t1.rls_enabled,
    t1.rls_forced,
    t1.table_owner,
    t3.authenticated_can_select,
    t3.anon_can_select,
    (select count(*)::int from t2 where t2.polrelid = t1.relid) as policy_count,
    -- true when RLS is enabled but zero policies exist: non-service-role callers
    -- see zero rows (PostgreSQL fail-closed default) even with table SELECT privilege
    (
      t1.rls_enabled
      and not exists(select 1 from t2 where t2.polrelid = t1.relid)
    )                                                            as rls_enabled_no_policy,
    -- true when authenticated lacks table-level SELECT privilege (results in a
    -- query error, distinct from the empty-result rls_enabled_no_policy case)
    coalesce(not t3.authenticated_can_select, false)             as authenticated_privilege_denied,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'policyname',            t2.policyname,
            'command',               t2.command,
            'mode',                  t2.mode,
            'roles',                 t2.roles,
            'using_expression',      t2.using_expression,
            'with_check_expression', t2.with_check_expression
          ) order by t2.policyname
        )
        from t2
        where t2.polrelid = t1.relid
      ),
      '[]'::jsonb
    )                                                            as policies
  from t1
  left join t3 on t3.relid = t1.relid
)

select jsonb_build_object(

  'probe_version',   'VAM_OS_BUSINESS_TABLE_RLS_EVIDENCE_PROBE_V1',
  'executed_at',     now()::text,
  'target_database', current_database(),

  -- Full per-table evidence — the primary payload
  'tables', (
    select jsonb_agg(
      jsonb_build_object(
        'tablename',                      t5.tablename,
        'table_exists',                   t5.table_exists,
        'rls_enabled',                    t5.rls_enabled,
        'rls_forced',                     t5.rls_forced,
        'table_owner',                    t5.table_owner,
        'authenticated_can_select',       t5.authenticated_can_select,
        'anon_can_select',                t5.anon_can_select,
        'policy_count',                   t5.policy_count,
        'rls_enabled_no_policy',          t5.rls_enabled_no_policy,
        'authenticated_privilege_denied', t5.authenticated_privilege_denied,
        'policies',                       t5.policies
      ) order by t5.tablename
    )
    from t5
  ),

  -- Cross-table summary counts
  'summary', jsonb_build_object(
    'target_table_count',           6,
    'tables_rls_enabled',           (select count(*)::int from t5 where t5.rls_enabled),
    'tables_rls_disabled',          (select count(*)::int from t5 where not t5.rls_enabled),
    'tables_rls_enabled_no_policy', (select count(*)::int from t5 where t5.rls_enabled_no_policy),
    'tables_with_policies',         (select count(*)::int from t5 where t5.policy_count > 0),
    'total_policies_found',         (select count(*)::int from t2)
  ),

  -- Exact active super_admin count — direct count(*) from admin_users, not reltuples
  'active_super_admin_count_exact', (select active_super_admin_count from t4),

  'probe_metadata', jsonb_build_object(
    'read_only',        true,
    'no_mutation',      true,
    'no_analyze',       true,
    'pii_excluded',     true,
    'sections_present', 3
  )

) as business_table_rls_evidence_result;
