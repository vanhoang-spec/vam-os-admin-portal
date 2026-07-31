-- REVIEW ONLY. STAGING rollback for migration 062.
begin;
drop policy if exists account_admin_users_self_or_super on public.admin_users;
drop policy if exists account_scope_self_or_super on public.admin_scope_access;
drop policy if exists account_audit_actor_or_super on public.admin_audit_log;
drop policy if exists account_people_program_ops on public.people;
drop policy if exists account_membership_program_ops on public.person_season_memberships;
do $$ declare r record; begin
  for r in select table_name,rls_was_enabled from public.account_rls_package_state loop
    execute format('alter table public.%I %s row level security',r.table_name,case when r.rls_was_enabled then 'enable' else 'disable' end);
  end loop;
end $$;
drop function if exists public.current_admin_id();
drop table if exists public.account_import_outcomes;
drop table if exists public.account_import_batches;
drop table if exists public.account_rls_package_state;
commit;
