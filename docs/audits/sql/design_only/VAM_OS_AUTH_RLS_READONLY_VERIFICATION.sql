-- =============================================================================
-- READ-ONLY VERIFICATION — SAFE TO RUN AGAINST PRODUCTION AT ANY TIME
-- NO MUTATIONS — SELECT ONLY
-- =============================================================================
-- VAM OS Auth RLS Readonly Verification
-- Prepared: 2026-07-29
-- Purpose: Audit current RLS state in production WITHOUT any changes.
--          Run this to establish baseline BEFORE applying hardening migrations.
--          See also: VAM_OS_AUTH_VERIFICATION.sql for post-hardening checks.
-- =============================================================================

-- =============================================================================
-- RV1. COMPLETE RLS STATUS — All tables in public schema
-- =============================================================================
-- Run first to see which tables are currently protected vs unprotected.
-- =============================================================================

select
  tablename,
  rowsecurity as rls_enabled,
  case
    when rowsecurity then '✅ PROTECTED'
    else '⚠  UNPROTECTED'
  end as protection_status
from pg_tables
where schemaname = 'public'
order by
  rowsecurity asc,  -- show unprotected first
  tablename;

-- =============================================================================
-- RV2. COMPLETE POLICY INVENTORY — What policies exist
-- =============================================================================

select
  tablename,
  policyname,
  permissive,
  cmd as command,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- =============================================================================
-- RV3. SECURITY DEFINER FUNCTION INVENTORY
-- =============================================================================

select
  n.nspname as schema,
  p.proname as function_name,
  case p.prosecdef when true then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
  p.proconfig as config  -- shows set search_path = public if present
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
order by p.proname;

-- =============================================================================
-- RV4. FUNCTION EXECUTE GRANTS — Check anon/public access
-- =============================================================================

select
  p.proname as function_name,
  r.rolname as role,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (
  select rolname from pg_roles
  where rolname in ('anon', 'public', 'authenticated', 'service_role')
) r
where n.nspname = 'public'
  and p.prosecdef = true  -- only SECURITY DEFINER functions
order by p.proname, r.rolname;

-- =============================================================================
-- RV5. PEOPLE TABLE — Check if auth_user_id column exists
-- =============================================================================

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'people'
order by ordinal_position;

-- =============================================================================
-- RV6. ADMIN_USERS TABLE — Check RLS and policy state
-- =============================================================================

select
  t.tablename,
  t.rowsecurity as rls_enabled,
  p.policyname,
  p.cmd as command,
  p.qual as using_expression
from pg_tables t
left join pg_policies p on p.tablename = t.tablename and p.schemaname = t.schemaname
where t.schemaname = 'public'
  and t.tablename = 'admin_users';

-- =============================================================================
-- RV7. EXPLICITLY DISABLED TABLES — Identify tables where RLS was disabled
-- =============================================================================
-- These tables had RLS enabled in migration 018 but were subsequently disabled.

select
  t.tablename,
  t.rowsecurity as rls_enabled,
  'Was enabled in migration 018; subsequently disabled' as note
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in (
    'mentoring_recaps',
    'event_participations'
  );

-- =============================================================================
-- RV8. TABLES WITH NO RLS EVER APPLIED
-- =============================================================================

select
  t.tablename,
  t.rowsecurity as rls_enabled,
  'No RLS in any applied migration' as note
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
order by t.tablename;

-- =============================================================================
-- RV9. CONSTRAINTS ON AUDIT TABLE
-- =============================================================================

select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.admin_audit_log'::regclass
order by conname;

-- =============================================================================
-- RV10. INDEXES ON PEOPLE TABLE
-- =============================================================================

select
  indexname,
  tablename,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'people'
order by indexname;

-- =============================================================================
-- RV11. ROW COUNTS — For context (does not affect security)
-- =============================================================================

select 'admin_users' as table_name, count(*) as row_count from public.admin_users
union all
select 'mentoring_recaps', count(*) from public.mentoring_recaps
union all
select 'event_participations', count(*) from public.event_participations
union all
select 'person_season_memberships', count(*) from public.person_season_memberships
union all
select 'admin_audit_log', count(*) from public.admin_audit_log
order by table_name;

-- =============================================================================
-- RV12. DISTINCT ACTION TYPES IN AUDIT LOG
-- =============================================================================
-- Run this BEFORE applying the action_type constraint (Migration A9).
-- If any non-canonical values appear, add them to the constraint or backfill.
-- =============================================================================

select distinct action_type, count(*) as occurrences
from public.admin_audit_log
group by action_type
order by action_type;

-- Expected canonical values:
--   create_admin_user, update_admin_user, remove_admin_access,
--   reactivate_admin_user, deactivate_admin_user, sync_auth

-- =============================================================================
-- RV13. SPRINT 1B CONFIRMATION — Verify tables that should have RLS enabled
-- =============================================================================
-- Sprint 1B Steps 1+2 reportedly passed. Verify:

select
  tablename,
  rowsecurity as rls_enabled,
  case when rowsecurity then '✅ Sprint 1B confirmed' else '⚠ UNEXPECTED — Sprint 1B step may have rolled back' end as note
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
order by tablename;
