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

-- NOTE: admin_audit_log RLS was already enabled in production before this migration
-- (confirmed by V2 probe). This rollback does NOT disable admin_audit_log RLS,
-- because it was NOT disabled before. Disabling would be over-rollback.
-- If admin_audit_log RLS was NOT enabled on staging before the migration,
-- uncomment the line below:
-- alter table public.admin_audit_log disable row level security;

-- =============================================================================
-- ROLLBACK STEP 3 (undo STAGING STEP 3): Drop admin_users SELECT policy
-- =============================================================================

drop policy if exists "read_admin_users_super_admin_or_self" on public.admin_users;

-- =============================================================================
-- ROLLBACK STEP 2 (undo STAGING STEP 2): Disable RLS on admin_users
-- admin_users was RLS-disabled before the migration. This restores that state.
-- Service-role paths continue to work regardless.
-- WARNING: After this step, any JWT holder can enumerate admin_users via
--          direct Supabase REST API again. Run this only when rollback is needed.
-- =============================================================================

alter table public.admin_users disable row level security;

-- =============================================================================
-- ROLLBACK STEP 1 (undo STAGING STEP 1): Restore anon EXECUTE grants
-- These grants existed in production before this migration.
-- After rollback, anon callers can call these functions again as RPCs.
-- The functions still fail closed for anon (return null/false/exception).
-- =============================================================================

grant execute on function public.current_admin_role() to anon;
grant execute on function public.is_active_admin() to anon;
grant execute on function public.is_admin_role(text[]) to anon;
grant execute on function public.get_operations_dashboard_data(text) to anon;

notify pgrst, 'reload schema';

-- =============================================================================
-- AFTER ROLLBACK:
-- Run VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql to confirm rollback state.
-- The following assertions should NOW be FALSE (migration undone):
--   v8.admin_users_rls_enabled              → false
--   v8.admin_users_select_policy_present    → false
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
--   DROP CONSTRAINT IF EXISTS — safe if constraint does not exist
--   DROP POLICY IF EXISTS     — safe if policy does not exist
--   DISABLE RLS               — safe if RLS is already disabled
--   GRANT                     — safe if grant already exists
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
--      ALTER TABLE public.admin_users DISABLE ROW LEVEL SECURITY;
-- =============================================================================
