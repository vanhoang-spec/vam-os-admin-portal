-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE MUTATIONS
-- READ-ONLY VERIFICATION QUERIES — SAFE TO RUN AGAINST PRODUCTION
-- =============================================================================
-- VAM OS Auth Hardening — Verification Queries
-- Prepared: 2026-07-29
-- Purpose: Post-deployment verification for Auth hardening migrations A–D.
--          All queries are SELECT only. Safe to run in production.
-- =============================================================================

-- =============================================================================
-- V1. RLS STATUS — All tables
-- =============================================================================
-- Expected post-hardening:
--   mentoring_recaps:          rowsecurity = true
--   event_participations:      rowsecurity = true
--   admin_audit_log:           rowsecurity = true
--   person_season_memberships: rowsecurity = true
--   event_links:               rowsecurity = true  (if these tables exist)
--   event_registrations:       rowsecurity = true
--   crm_notes:                 rowsecurity = true
-- =============================================================================

select
  tablename,
  rowsecurity as rls_enabled,
  case when rowsecurity then 'PROTECTED' else '⚠ UNPROTECTED' end as status
from pg_tables
where schemaname = 'public'
order by tablename;

-- =============================================================================
-- V2. POLICY INVENTORY — All policies in public schema
-- =============================================================================
-- Expected after hardening A:
--   admin_audit_log: read_admin_audit_log_super_admin_only
--   mentoring_recaps: read_mentoring_recaps_internal_roles
--   event_participations: read_event_participations_internal_roles
--   person_season_memberships: read_person_season_memberships_internal_roles
--   applications: read_applications_review_roles (updated to include core_team)
--   event_links: read_event_links_admin_roles
--   event_registrations: read_event_registrations_admin_roles
-- =============================================================================

select
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd as command,
  roles,
  qual as using_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- =============================================================================
-- V3. FUNCTION EXECUTE GRANTS — Verify revoke from anon/public
-- =============================================================================
-- Expected after hardening D:
--   anon: can_execute = false for all listed functions
--   public: can_execute = false for all listed functions
--   authenticated: can_execute = true for all listed functions
-- =============================================================================

select
  p.proname as function_name,
  r.rolname as role,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated', 'service_role')
) r
where n.nspname = 'public'
  and p.proname in (
    'current_admin_role',
    'is_admin_role',
    'is_active_admin',
    'current_admin_context',
    'admin_can_access_season',
    'current_person_id',
    'get_operations_dashboard_data',
    'get_mentor_profile_data_by_id'
  )
order by p.proname, r.rolname;

-- =============================================================================
-- V4. COLUMN EXISTENCE — people.auth_user_id (migration B)
-- =============================================================================
-- Expected after hardening B:
--   column_name = auth_user_id should appear for table 'people'
-- =============================================================================

select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'people'
order by ordinal_position;

-- =============================================================================
-- V5. INDEX EXISTENCE — people.auth_user_id unique index (migration B)
-- =============================================================================
-- Expected after hardening B:
--   people_auth_user_id_unique_idx should appear with is_unique = true
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
-- V6. CONSTRAINT CHECK — admin_audit_log.action_type (migration A9)
-- =============================================================================
-- Expected after hardening A:
--   constraint admin_audit_log_action_type_check should exist
-- =============================================================================

select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.admin_audit_log'::regclass
order by conname;

-- =============================================================================
-- V7. STALE LINKAGE CHECK — people rows with non-null auth_user_id (migration B)
-- =============================================================================
-- Read-only diagnostic. Run after linkage column is added.
-- Shows how many people rows are linked to auth accounts.
-- Does NOT verify whether the linked auth users still exist.
-- =============================================================================

select
  count(*) as total_people,
  count(auth_user_id) as linked_to_auth,
  count(*) - count(auth_user_id) as unlinked
from public.people;

-- =============================================================================
-- V8. UNPROTECTED TABLE CHECK — Tables without RLS (sentinel check)
-- =============================================================================
-- Expected post-hardening: the following tables should NOT appear in the
-- unprotected list (they should all have rowsecurity = true):
--   mentoring_recaps, event_participations, admin_audit_log,
--   person_season_memberships, event_links, event_registrations, crm_notes
-- =============================================================================

select
  tablename,
  '⚠ NO RLS' as status
from pg_tables
where schemaname = 'public'
  and not rowsecurity
  and tablename in (
    'mentoring_recaps',
    'event_participations',
    'admin_audit_log',
    'person_season_memberships',
    'person_season_membership_log',
    'event_links',
    'event_registrations',
    'crm_notes',
    'admin_users',
    'admin_scope_access'
  )
order by tablename;
-- Expected: zero rows returned (all listed tables should be protected)

-- =============================================================================
-- V9. APPLICATION BEHAVIOR TEST CHECKLIST (manual tests — not SQL)
-- =============================================================================
-- After deploying hardening migrations, run these manual tests:
--
-- 1. Log in as viewer role admin. Confirm:
--    a. Dashboard loads normally (programs, seasons, events visible)
--    b. People list loads normally
--    c. Operations dashboard loads normally
--    d. No "0 rows" or "permission denied" errors in server logs
--
-- 2. Log in as reviewer role admin. Confirm:
--    a. Applications page loads
--    b. Reviews page loads
--    c. No regressions vs. pre-migration behavior
--
-- 3. Log in as super_admin. Confirm:
--    a. Admin users page loads all users
--    b. Audit log loads (admin_audit_log)
--    c. All operations accessible
--
-- 4. Using Supabase Dashboard or psql, attempt direct API calls as
--    authenticated (non-super_admin) JWT:
--    a. SELECT from mentoring_recaps → expect rows only matching policy
--    b. SELECT from admin_audit_log → expect 0 rows (not super_admin)
--    c. INSERT into admin_users → expect permission denied
--    d. RPC current_admin_role() → expect own role returned
--    e. RPC is_active_admin() as anon → expect "permission denied" or false
-- =============================================================================
