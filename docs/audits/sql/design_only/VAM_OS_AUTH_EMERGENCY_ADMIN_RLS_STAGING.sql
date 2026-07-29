-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Emergency Admin RLS Staging Migration
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
-- Target: STAGING environment only — not authorized for production
--
-- Scope (emergency subset only):
--   STEP 0  Lockout preflight — abort if no active super_admin linked to auth.users
--   STEP 1  Revoke anon EXECUTE from 4 SECURITY DEFINER functions
--   STEP 2  Enable RLS on admin_users
--   STEP 3  Create admin_users SELECT policy
--   STEP 4  Ensure RLS enabled on admin_audit_log
--   STEP 5  Create admin_audit_log SELECT policy (super_admin only)
--   STEP 6  Add action_type CHECK constraint (NOT VALID — no row scan)
--
-- Excluded from this package:
--   people.auth_user_id (Auth_B scope)
--   participant RLS — current_person_id (Auth_C scope)
--   people, mentor_profiles, mentee_profiles, matches, events (Auth_A scope)
--   mentoring_recaps, event_participations (Auth_A scope)
--   event_links, event_registrations, crm_notes (Auth_A scope)
--
-- Pre-requisites:
--   migration 017 applied (admin_users table)
--   migration 018 applied (helper functions: current_admin_role, is_active_admin, is_admin_role)
--   migration 020 applied (admin_scope_access RLS; redefines helper functions)
--   migration 022 applied (get_operations_dashboard_data with text param)
--   migration 024 or 026 applied (admin_audit_log table)
--
-- How to run:
--   1. Owner executes in Supabase SQL Editor on STAGING project only.
--   2. Immediately run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql to confirm.
--   3. If any assertion fails: run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_ROLLBACK.sql.
-- =============================================================================

-- =============================================================================
-- STEP 0: LOCKOUT PREFLIGHT
-- Aborts the entire migration if no active super_admin has an auth_user_id.
-- This ensures at least one human can authenticate after RLS is enabled.
-- =============================================================================

do $$
declare
  v_sa_count int;
begin
  select count(*)::int
    into v_sa_count
  from public.admin_users
  where role = 'super_admin'
    and status = 'active'
    and auth_user_id is not null;

  if v_sa_count < 1 then
    raise exception
      'PREFLIGHT FAILED: No active super_admin with auth_user_id found. '
      'At least one super_admin must have auth_user_id set before enabling RLS '
      'on admin_users. Set auth_user_id for the owner account first. '
      'Run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql to diagnose.'
      using errcode = 'P0001';
  end if;

  raise notice 'PREFLIGHT PASSED: % active super_admin(s) with auth_user_id found.', v_sa_count;
end;
$$;

-- =============================================================================
-- STEP 1: REVOKE anon EXECUTE FROM 4 SECURITY DEFINER FUNCTIONS
-- These functions fail closed for anon callers (return null / false / exception)
-- but the EXECUTE grants are unnecessary and widen the attack surface.
-- authenticated role retains EXECUTE — required for RLS policy evaluation
-- on admin_scope_access, programs, seasons, and other protected tables.
-- service_role bypasses RLS and does not need EXECUTE for policy evaluation.
-- =============================================================================

-- current_admin_role() — returns active VAM OS role for auth.uid() or null
revoke execute on function public.current_admin_role() from anon, public;
grant execute on function public.current_admin_role() to authenticated;

-- is_active_admin() — returns true if auth.uid() has an active admin_users row
revoke execute on function public.is_active_admin() from anon, public;
grant execute on function public.is_active_admin() to authenticated;

-- is_admin_role(text[]) — returns true if current_admin_role() is in the list
revoke execute on function public.is_admin_role(text[]) from anon, public;
grant execute on function public.is_admin_role(text[]) to authenticated;

-- get_operations_dashboard_data(text) — operations RPC; checked internally
-- NOTE: Migration 022 included REVOKE ALL FROM anon but did not take effect in production.
-- This revoke explicitly targets the correct function signature (text param).
revoke execute on function public.get_operations_dashboard_data(text) from anon, public;
grant execute on function public.get_operations_dashboard_data(text) to authenticated;

-- =============================================================================
-- STEP 2: ENABLE RLS ON admin_users
-- Production state: RLS=false, no policy.
-- After this step: RLS=true. Without any policy, non-service-role callers see
-- zero rows (fail-closed). STEP 3 immediately adds the SELECT policy.
-- Service-role paths (lib/admin-auth.ts, lib/admin-users.ts) are unaffected
-- because service-role bypasses RLS entirely.
-- =============================================================================

alter table public.admin_users enable row level security;

-- =============================================================================
-- STEP 3: admin_users SELECT POLICY
-- Policy: own row (any active admin reading their own record) OR super_admin.
-- current_admin_role() is SECURITY DEFINER and reads admin_users without
-- triggering RLS recursion — this is the correct and intended design.
--
-- Access matrix:
--   anon                    auth.uid() = null → no row match → DENIED
--   participant JWT (future) no admin_users row → current_admin_role() = null → DENIED unless own row
--   viewer/reviewer/admin   sees only their own row via auth.uid() = auth_user_id
--   super_admin             sees all rows via current_admin_role() = 'super_admin'
--   service_role            bypasses RLS → full access (no change from current behavior)
--
-- No INSERT/UPDATE/DELETE policy: writes are fail-closed for all non-service-role.
-- All application writes use service-role (lib/admin-users.ts) — unaffected.
-- No self-promotion possible via direct API: INSERT/UPDATE fail-closed.
-- No cross-role promotion: super_admin check uses current_admin_role() which
--   reads the authenticated user's own role — cannot be spoofed via API params.
-- =============================================================================

drop policy if exists "read_admin_users_super_admin_or_self" on public.admin_users;

create policy "read_admin_users_super_admin_or_self"
on public.admin_users
for select
using (
  auth.uid() = auth_user_id
  or public.current_admin_role() = 'super_admin'
);

-- =============================================================================
-- STEP 4: ENSURE RLS ENABLED ON admin_audit_log
-- Production state: RLS=true (confirmed by V2 probe). This step is a no-op
-- if already enabled but is required for idempotency on staging.
-- =============================================================================

alter table public.admin_audit_log enable row level security;

-- =============================================================================
-- STEP 5: admin_audit_log SELECT POLICY (super_admin only)
-- Audit log contains before/after JSON blobs of admin_users changes including
-- role, status, email, and auth_user_id. Super_admin only.
-- Direct INSERT via JWT: blocked by fail-closed (no INSERT policy).
-- Application writes go via service-role (lib/admin-users.ts:writeAuditLog).
-- =============================================================================

drop policy if exists "read_admin_audit_log_super_admin_only" on public.admin_audit_log;

create policy "read_admin_audit_log_super_admin_only"
on public.admin_audit_log
for select
using (public.current_admin_role() = 'super_admin');

-- =============================================================================
-- STEP 6: admin_audit_log action_type CHECK CONSTRAINT (NOT VALID)
-- NOT VALID: constraint applies to future inserts/updates only, does not scan
-- existing rows. This is safe for staging where existing data is unknown.
-- Known application action_type values (from lib/admin-users.ts):
--   create_admin_user, update_admin_user, reactivate_admin_user,
--   deactivate_admin_user, remove_admin_access, sync_auth, unknown
-- Owner must verify DISTINCT action_type values in staging before applying
-- VALIDATE CONSTRAINT (separate step, not included here).
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_audit_log_action_type_check'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_action_type_check
        check (action_type in (
          'create_admin_user',
          'update_admin_user',
          'reactivate_admin_user',
          'deactivate_admin_user',
          'remove_admin_access',
          'sync_auth',
          'unknown'
        ))
      not valid;
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- IMMEDIATE NEXT STEP AFTER RUNNING:
-- Run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql in the same SQL Editor
-- session. All assertions must pass before any other work proceeds.
-- If any assertion fails: run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_ROLLBACK.sql.
-- =============================================================================
