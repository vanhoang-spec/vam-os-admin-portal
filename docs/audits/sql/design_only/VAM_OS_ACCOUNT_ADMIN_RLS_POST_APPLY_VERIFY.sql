-- READ ONLY. Structural verification only.
select jsonb_build_object(
  'rls_enabled', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','account_import_batches','account_import_outcomes')),
  'policies', (select jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'roles',roles,'command',cmd) order by tablename,policyname) from pg_policies where schemaname='public' and tablename in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','account_import_batches','account_import_outcomes')),
  'anon_helper_execute', has_function_privilege('anon','public.current_admin_role()','execute') or has_function_privilege('anon','public.is_active_admin()','execute')
) as account_rls_post_apply;
