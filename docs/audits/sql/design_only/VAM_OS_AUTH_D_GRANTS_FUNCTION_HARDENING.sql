-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- PRODUCTION AND STAGING MUTATION NOT AUTHORIZED
-- =============================================================================
-- VAM OS Auth Hardening — D: SECURITY DEFINER Function Grants Hardening
-- Prepared: 2026-07-29
-- Purpose: Revoke EXECUTE on all SECURITY DEFINER helper functions from anon
--          and public roles. Grant EXECUTE to authenticated only.
-- Pre-requisites:
--   Migration 018 applied (defines is_admin_role, is_active_admin, current_admin_role)
--   Migration 020 applied (redefines current_admin_role, is_active_admin)
--   Migration 019 applied (defines get_operations_dashboard_data, get_mentor_profile_data_by_id)
-- Note: migration 057 (DESIGN ONLY, never applied) intended partial revokes for
--   current_admin_context(), is_active_admin(), admin_can_access_season().
--   This file extends and completes that work.
-- =============================================================================

-- --------------------------------------------------------------------------
-- D1. Revoke from admin helper functions (migrations 018, 020)
-- --------------------------------------------------------------------------
-- These functions are used by RLS policies. RLS policies call them at query
-- evaluation time, using the function definer's privileges. The authenticated
-- role retains EXECUTE because it's the role JWT callers operate as.
-- anon callers should NOT be able to call these as RPCs.
-- --------------------------------------------------------------------------

-- current_admin_role() — returns caller's admin role or NULL
revoke execute on function public.current_admin_role() from anon, public;
grant execute on function public.current_admin_role() to authenticated;

-- is_admin_role(text[]) — returns boolean; delegates to current_admin_role()
revoke execute on function public.is_admin_role(text[]) from anon, public;
grant execute on function public.is_admin_role(text[]) to authenticated;

-- is_active_admin() — returns boolean; queries admin_users
revoke execute on function public.is_active_admin() from anon, public;
grant execute on function public.is_active_admin() to authenticated;

-- --------------------------------------------------------------------------
-- D2. Revoke from context/scope helper functions
-- --------------------------------------------------------------------------
-- These were partially addressed in migration 057 (DESIGN ONLY, never applied).
-- current_admin_context() — returns program/season context for auth.uid()
-- admin_can_access_season(text) — probes season access for a JWT holder
-- --------------------------------------------------------------------------

-- Verify these functions exist before revoking (they may not be defined if
-- migration 019 or similar was not applied):
do $$
begin
  if exists (
    select 1 from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'current_admin_context'
  ) then
    execute 'revoke execute on function public.current_admin_context() from anon, public';
    execute 'grant execute on function public.current_admin_context() to authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_can_access_season'
  ) then
    execute 'revoke execute on function public.admin_can_access_season(text) from anon, public';
    execute 'grant execute on function public.admin_can_access_season(text) to authenticated';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- D3. Revoke from participant helper function (if C was applied)
-- --------------------------------------------------------------------------
-- current_person_id() is defined in VAM_OS_AUTH_C_PARTICIPANT_RLS.sql.
-- This revoke applies IF AND ONLY IF that file was applied first.
-- --------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'current_person_id'
  ) then
    execute 'revoke execute on function public.current_person_id() from anon, public';
    execute 'grant execute on function public.current_person_id() to authenticated';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- D4. Revoke from operations dashboard RPC functions (read-only, lower risk)
-- --------------------------------------------------------------------------
-- These functions aggregate data for the dashboard. They are not auth helpers.
-- However, if they query tables without RLS, they leak data to anon callers.
-- Revoke anon EXECUTE as defense-in-depth.
-- --------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_operations_dashboard_data'
  ) then
    execute 'revoke execute on function public.get_operations_dashboard_data() from anon, public';
    execute 'grant execute on function public.get_operations_dashboard_data() to authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_mentor_profile_data_by_id'
  ) then
    execute 'revoke execute on function public.get_mentor_profile_data_by_id(text) from anon, public';
    execute 'grant execute on function public.get_mentor_profile_data_by_id(text) to authenticated';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- D5. set_updated_at() trigger function — leave public EXECUTE
-- --------------------------------------------------------------------------
-- set_updated_at() is a trigger function, not called via RPC. Trigger
-- functions are called by PostgreSQL's trigger mechanism, not by callers.
-- EXECUTE permissions on trigger functions are not evaluated the same way.
-- Leave this function as-is.
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- VERIFICATION QUERY (read-only, run after applying):
-- --------------------------------------------------------------------------
-- select
--   n.nspname as schema,
--   p.proname as function_name,
--   r.rolname as role,
--   has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join (
--   select rolname from pg_roles where rolname in ('anon', 'public', 'authenticated', 'service_role')
-- ) r
-- where n.nspname = 'public'
--   and p.proname in (
--     'current_admin_role',
--     'is_admin_role',
--     'is_active_admin',
--     'current_admin_context',
--     'admin_can_access_season',
--     'current_person_id',
--     'get_operations_dashboard_data',
--     'get_mentor_profile_data_by_id'
--   )
-- order by p.proname, r.rolname;
--
-- Expected for anon: can_execute = false for all listed functions
-- Expected for authenticated: can_execute = true for all listed functions
-- --------------------------------------------------------------------------

-- =============================================================================
-- ROLLBACK — run to undo this file:
-- =============================================================================
-- Note: reverting grants is complex. The safest rollback is to restore the
-- prior state (GRANT to public) explicitly:
-- grant execute on function public.current_admin_role() to anon, public;
-- grant execute on function public.is_admin_role(text[]) to anon, public;
-- grant execute on function public.is_active_admin() to anon, public;
-- (extend for other functions as needed)
-- =============================================================================
