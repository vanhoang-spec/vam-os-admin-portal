-- =============================================================================
-- DESIGN ONLY
-- OWNER-RUN READ-ONLY VERIFICATION
-- NO DATABASE MUTATION
-- SAFE FOR SUPABASE SQL EDITOR
-- =============================================================================
-- VAM OS Auth RLS Readonly Verification V2
-- Prepared: 2026-07-29
-- Replaces: VAM_OS_AUTH_RLS_READONLY_VERIFICATION.sql (V1)
-- Reason:   Supabase SQL Editor shows only one result table when a script
--           contains multiple SELECT statements. V2 consolidates all
--           RV1-RV13 sections into a single WITH query that returns
--           EXACTLY ONE ROW and ONE JSONB column. Paste the JSONB value
--           back into this session for analysis.
-- =============================================================================
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block mutating-function-invocation
-- Sources: pg_tables pg_policies pg_proc pg_namespace pg_class pg_namespace
--          pg_constraint pg_indexes pg_roles pg_stats information_schema
--          has_function_privilege() pg_get_constraintdef()
-- All counts use pg_class.reltuples (catalog estimate) — no direct table scan
-- Policy expressions replaced by structural boolean flags — no raw SQL exposed
-- =============================================================================

with

-- -----------------------------------------------------------------------
-- RV1: Complete RLS status — all tables in public schema
-- -----------------------------------------------------------------------
rv1 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',   tablename,
      'rls_enabled', rowsecurity,
      'status',      case when rowsecurity then 'PROTECTED' else 'UNPROTECTED' end
    ) order by rowsecurity asc, tablename
  ), '[]'::jsonb) as data
  from pg_tables
  where schemaname = 'public'
),

-- -----------------------------------------------------------------------
-- RV2: Policy inventory — structural analysis only
--      Raw USING/WITH CHECK expressions are NOT returned.
--      Policy behaviour is represented as boolean flags only.
-- -----------------------------------------------------------------------
rv2 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',               tablename,
      'policyname',              policyname,
      'permissive',              permissive,
      'command',                 cmd,
      'using_present',           qual is not null,
      'with_check_present',      with_check is not null,
      'broad_true_condition',    qual in ('true', 'TRUE', '(true)'),
      'references_admin_helper',
        coalesce(qual like '%current_admin_role%', false)
        or coalesce(qual like '%is_active_admin%', false)
        or coalesce(qual like '%is_admin_role%', false)
        or coalesce(qual like '%current_admin_context%', false)
        or coalesce(qual like '%admin_can_access_season%', false),
      'references_program_scope', coalesce(qual like '%program%', false),
      'references_season_scope',  coalesce(qual like '%season%', false),
      'references_auth_uid',      coalesce(qual like '%auth.uid%', false)
    ) order by tablename, policyname
  ), '[]'::jsonb) as data
  from pg_policies
  where schemaname = 'public'
),

-- -----------------------------------------------------------------------
-- RV3: SECURITY DEFINER function inventory
-- -----------------------------------------------------------------------
rv3 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'function_name',        p.proname,
      'security_mode',        case p.prosecdef
                                when true then 'SECURITY_DEFINER'
                                else 'SECURITY_INVOKER'
                              end,
      'search_path_hardened', exists(
        select 1
        from unnest(p.proconfig) as cfg(item)
        where item like 'search_path=%'
      )
    ) order by p.proname
  ), '[]'::jsonb) as data
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
),

-- -----------------------------------------------------------------------
-- RV4: Execute privileges on SECURITY DEFINER functions
--      Roles checked: anon, authenticated, service_role
-- -----------------------------------------------------------------------
rv4 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'function_name', p.proname,
      'role',          r.rolname,
      'can_execute',   has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    ) order by p.proname, r.rolname
  ), '[]'::jsonb) as data
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (
    select rolname from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ) r
  where n.nspname = 'public'
    and p.prosecdef = true
    and p.prokind   = 'f'
),

-- -----------------------------------------------------------------------
-- RV5: people table column schema — metadata only, no row data
-- -----------------------------------------------------------------------
rv5 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'column_name',    column_name,
      'data_type',      data_type,
      'is_nullable',    is_nullable,
      'column_default', column_default
    ) order by ordinal_position
  ), '[]'::jsonb) as data
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'people'
),

-- -----------------------------------------------------------------------
-- RV6: admin_users RLS state and policy structural metadata
-- -----------------------------------------------------------------------
rv6 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',               t.tablename,
      'rls_enabled',             t.rowsecurity,
      'policyname',              p.policyname,
      'command',                 p.cmd,
      'using_present',           p.qual is not null,
      'with_check_present',      p.with_check is not null,
      'broad_true_condition',    p.qual in ('true', 'TRUE', '(true)'),
      'references_admin_helper', coalesce(p.qual like '%current_admin_role%', false)
                                 or coalesce(p.qual like '%is_active_admin%', false),
      'references_auth_uid',     coalesce(p.qual like '%auth.uid%', false)
    )
  ), '[]'::jsonb) as data
  from pg_tables t
  left join pg_policies p
    on p.tablename = t.tablename and p.schemaname = t.schemaname
  where t.schemaname = 'public'
    and t.tablename  = 'admin_users'
),

-- -----------------------------------------------------------------------
-- RV7: Tables expected to have RLS disabled after Sprint 1B
-- -----------------------------------------------------------------------
rv7 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',   t.tablename,
      'rls_enabled', t.rowsecurity,
      'note',        'Was enabled in migration 018; subsequently disabled'
    ) order by t.tablename
  ), '[]'::jsonb) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in ('mentoring_recaps', 'event_participations')
),

-- -----------------------------------------------------------------------
-- RV8: Tables with no RLS in any applied migration
-- -----------------------------------------------------------------------
rv8 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',   t.tablename,
      'rls_enabled', t.rowsecurity,
      'note',        'No RLS in any applied migration'
    ) order by t.tablename
  ), '[]'::jsonb) as data
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in (
      'admin_audit_log',
      'person_season_memberships',
      'person_season_membership_log',
      'crm_notes',
      'event_links',
      'event_registrations',
      'intake_batches'
    )
),

-- -----------------------------------------------------------------------
-- RV9: Constraints on admin_audit_log
--      Uses catalog JOIN — safe even if the table does not yet exist
-- -----------------------------------------------------------------------
rv9 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'constraint_name', c.conname,
      'definition',      pg_get_constraintdef(c.oid)
    ) order by c.conname
  ), '[]'::jsonb) as data
  from pg_constraint c
  join pg_class     cl on cl.oid = c.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  where ns.nspname = 'public'
    and cl.relname = 'admin_audit_log'
),

-- -----------------------------------------------------------------------
-- RV10: Indexes on people table
-- -----------------------------------------------------------------------
rv10 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'indexname', indexname,
      'tablename', tablename,
      'indexdef',  indexdef
    ) order by indexname
  ), '[]'::jsonb) as data
  from pg_indexes
  where schemaname = 'public'
    and tablename  = 'people'
),

-- -----------------------------------------------------------------------
-- RV11: Approximate row counts via pg_class.reltuples
--       Catalog-only — no direct table access, safe for any table state
--       Note: reltuples is an estimate; accurate after ANALYZE/autovacuum
-- -----------------------------------------------------------------------
rv11 as (
  select coalesce(jsonb_object_agg(
    c.relname,
    jsonb_build_object(
      'approx_row_count', c.reltuples::bigint,
      'note',             'pg_class.reltuples estimate'
    )
  ), '{}'::jsonb) as data
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind  = 'r'
    and c.relname in (
      'admin_users',
      'mentoring_recaps',
      'event_participations',
      'person_season_memberships',
      'admin_audit_log'
    )
),

-- -----------------------------------------------------------------------
-- RV12: Audit log action-type inventory
--       Uses pg_stats (catalog) and information_schema — no table scan
--       most_common_vals is populated by ANALYZE; may be null if not run
-- -----------------------------------------------------------------------
rv12 as (
  select jsonb_build_object(
    'table_exists', (
      select exists(
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'admin_audit_log'
      )
    ),
    'action_type_col_exists', (
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'admin_audit_log'
          and column_name  = 'action_type'
      )
    ),
    'action_type_most_common', (
      select most_common_vals::text
      from pg_stats
      where schemaname = 'public'
        and tablename  = 'admin_audit_log'
        and attname    = 'action_type'
      limit 1
    ),
    'note', 'values from pg_stats most_common_vals; run ANALYZE if null'
  ) as data
),

-- -----------------------------------------------------------------------
-- RV13: Sprint 1B RLS confirmation
-- -----------------------------------------------------------------------
rv13 as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tablename',      tablename,
      'rls_enabled',    rowsecurity,
      'sprint_1b_note', case when rowsecurity then 'confirmed' else 'UNEXPECTED_NOT_ENABLED' end
    ) order by tablename
  ), '[]'::jsonb) as data
  from pg_tables
  where schemaname = 'public'
    and tablename in (
      'programs',
      'seasons',
      'events',
      'people',
      'mentor_profiles',
      'mentee_profiles',
      'matches',
      'applications',
      'activity_correction_log',
      'operational_team_assignments',
      'admin_users',
      'admin_scope_access'
    )
)

-- =============================================================================
-- SINGLE-ROW RESULT — exactly one row, one JSONB column
-- Copy the entire value from the SQL Editor and return it to this session.
-- =============================================================================
select jsonb_build_object(
  'probe_version',            'VAM_OS_AUTH_RLS_READONLY_VERIFICATION_V2',
  'executed_at',              now()::text,
  'executed_database',        current_database(),
  'rv1_core_rls',             (select data from rv1),
  'rv2_policies',             (select data from rv2),
  'rv3_function_security',    (select data from rv3),
  'rv4_function_privileges',  (select data from rv4),
  'rv5_people_auth_column',   (select data from rv5),
  'rv6_admin_users_rls',      (select data from rv6),
  'rv7_disabled_tables',      (select data from rv7),
  'rv8_unprotected_tables',   (select data from rv8),
  'rv9_audit_constraints',    (select data from rv9),
  'rv10_people_indexes',      (select data from rv10),
  'rv11_approx_row_counts',   (select data from rv11),
  'rv12_audit_action_types',  (select data from rv12),
  'rv13_sprint1b_rls',        (select data from rv13),
  'summary', jsonb_build_object(
    'sections_present', 13,
    'read_only',        true
  )
) as verification_result;
