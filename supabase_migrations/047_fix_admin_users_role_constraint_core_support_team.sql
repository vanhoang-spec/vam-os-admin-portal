-- Migration 047: Fix admin_users role constraint for core/support team roles
--
-- Align DB role constraint with VAM OS app-level permission model before RLS rollout.
--
-- Purpose:
--   * Make core_team and support_team official internal admin_users.role values.
--   * Preserve existing admin_users data.
--   * Avoid altering unrelated columns or permissions semantics.
--
-- Rollback note:
--   Before rolling back this constraint, first ensure no admin_users rows have
--   role in ('support_team', 'core_team'). Then drop this constraint and recreate
--   admin_users_role_check with only ('viewer', 'reviewer', 'admin', 'super_admin').

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (
    role in (
      'viewer',
      'reviewer',
      'support_team',
      'core_team',
      'admin',
      'super_admin'
    )
  );

comment on constraint admin_users_role_check on public.admin_users is
  'Align DB role constraint with VAM OS app-level permission model before RLS rollout.';

notify pgrst, 'reload schema';
