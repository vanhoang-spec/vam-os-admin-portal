-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Emergency Admin RLS Rollback
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
-- Purpose: Undo VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql if staging validation fails.
-- Run mode: Owner-executed in Supabase SQL Editor (staging only) AFTER the staging
--           migration is confirmed to need rollback.
--
-- Rollback philosophy:
--   - Data is never deleted or overwritten.
--   - Rollback restores the pre-migration state exactly.
--   - Each step is the inverse of the corresponding STAGING step.
--   - Steps are ordered from least-disruptive to most-disruptive (constraint
--     removal before policy drops before RLS disable before grant restoration).
--
-- When to run:
--   - VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql shows a failed assertion.
--   - Staging login is broken after the migration.
--   - Application errors appear that were not present before.
--   - Owner decides to abort staging validation.
--
-- When NOT to run:
--   - Do not run on production (not authorized).
--   - Do not run if the staging migration was never applied.
--   - Do not run if the verification passed and no regression is detected.
-- =============================================================================

-- =============================================================================
-- ROLLBACK STEP 6 (undo STAGING STEP 6): Drop action_type CHECK constraint
-- Only present if STAGING STEP 6 created it.
-- =============================================================================

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_type_check;

-- =============================================================================
-- ROLLBACK STEP 5 (undo STAGING STEP 5): Drop admin_audit_log SELECT policy
-- If admin_audit_log already had a different policy before the migration,
-- the owner must verify what that policy was and recreate it manually.
-- This rollback drops the policy created by STAGING STEP 5.
-- =============================================================================

drop policy if exists "read_admin_audit_log_super_admin_only" on public.admin_audit_log;

-- NOTE: Production admin_audit_log had RLS=true before this migration.
-- STAGING NOTE: Staging admin_audit_log had RLS=false before this migration
-- (confirmed by V2 preflight 2026-07-29: admin_audit_log.rls_enabled = false).
-- The statement below restores the pre-migration staging state.
alter table public.admin_audit_log disable row level security;

-- =============================================================================
-- ROLLBACK STEP 3 (undo STAGING STEP 3): Drop admin_users SELECT policy
-- =============================================================================

drop policy if exists "read_admin_users_super_admin_or_self" on public.admin_users;

-- =============================================================================
-- ROLLBACK STEP 2 — admin_users RLS state (STAGING ONLY)
-- Staging admin_users had RLS=true before the migration (V2 preflight 2026-07-29).
-- STAGING STEP 2 was a no-op (RLS was already enabled). Disabling RLS here would
-- leave staging MORE permissive than its proven pre-migration state.
--
-- Correct staging rollback: keep RLS enabled. No SQL required here.
-- The pre-existing "active admins can read themselves" policy was never dropped
-- by the migration (STEP 3 only affects "read_admin_users_super_admin_or_self")
-- and is preserved throughout — no manual reconstruction needed.
--
-- Post-rollback admin_users state (staging):
--   RLS:    enabled (same as pre-migration)
--   Policy: "active admins can read themselves" (same as pre-migration)
-- =============================================================================
-- (no SQL — admin_users RLS remains enabled per staging pre-migration baseline)

-- =============================================================================
-- ROLLBACK STEP 1 (undo STAGING STEP 1): Restore anon EXECUTE grants
-- These grants existed in production before this migration.
-- After rollback, anon callers can call these functions again as RPCs.
-- The functions still fail closed for anon (return null/false/exception).
-- =============================================================================

grant execute on function public.current_admin_role() to anon;
grant execute on function public.is_active_admin() to anon;
do $$
begin
  if exists(
    select 1 from pg_proc fn
    join pg_namespace ns on ns.oid = fn.pronamespace
    where ns.nspname = 'public' and fn.proname = 'is_admin_role'
  ) then
    execute 'grant execute on function public.is_admin_role(text[]) to anon';
    raise notice 'is_admin_role: anon EXECUTE restored';
  else
    raise notice 'is_admin_role: not found in public schema — grant skipped';
  end if;
end;
$$;
grant execute on function public.get_operations_dashboard_data(text) to anon;

notify pgrst, 'reload schema';

-- =============================================================================
-- AFTER ROLLBACK:
-- Run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql to confirm rollback state.
-- The following assertions should NOW be FALSE (migration undone):
--   v8.admin_users_rls_enabled              → TRUE (staging had RLS=true before migration)
--   v8.admin_users_select_policy_present    → false ("read_admin_users_super_admin_or_self" dropped)
--   v8.all_anon_revokes_applied             → false (anon grants restored)
-- The following should remain TRUE (regression check):
--   v8.admin_scope_access_unaffected        → true
--   v8.participant_schema_unchanged         → true
--   v8.business_tables_unaffected           → true
-- =============================================================================

-- =============================================================================
-- PARTIAL FAILURE RECOVERY:
-- If the staging migration failed mid-way and not all steps ran, each
-- ROLLBACK step is safe to run independently. Each is idempotent:
--   DROP CONSTRAINT IF EXISTS          — safe if constraint does not exist
--   DROP POLICY IF EXISTS              — safe if policy does not exist
--   DISABLE RLS (admin_audit_log only) — safe if RLS is already disabled
--   admin_users RLS: not disabled (staging pre-migration baseline was RLS=true)
--   GRANT (bare)                       — safe if grant already exists
--   DO block (is_admin_role)           — skips gracefully if function is absent
-- Run all rollback steps in order even if some are no-ops.
-- =============================================================================

-- =============================================================================
-- TOTAL ADMIN LOCKOUT RECOVERY:
-- If all admins are locked out after the migration (cannot log in to the
-- Supabase dashboard), the service-role client in Vercel server actions
-- still bypasses RLS. The application itself can still authenticate admins
-- because lib/admin-auth.ts uses service-role (reads admin_users bypassing RLS).
-- The lockout risk is for DIRECT API callers only.
-- If the Supabase dashboard is unavailable: contact Supabase support or
-- use the Management API with the service-role key to drop the policy:
--   DELETE https://api.supabase.com/v1/projects/{ref}/database/query
-- Run: DROP POLICY "read_admin_users_super_admin_or_self" ON public.admin_users;
-- NOTE: Do NOT disable admin_users RLS — staging had RLS=true before migration.
-- =============================================================================
