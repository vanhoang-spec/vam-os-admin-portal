-- READ ONLY. One sanitized JSON result; no business rows or PII.
select jsonb_build_object(
  'tables', (select jsonb_object_agg(v.name, to_regclass(v.name) is not null) from (values
    ('public.admin_users'),('public.admin_scope_access'),('public.admin_audit_log'),('public.people'),('public.programs'),('public.seasons'),('public.person_season_memberships'),('public.person_season_membership_log')
  ) v(name)),
  'helpers', jsonb_build_object('current_admin_role',to_regprocedure('public.current_admin_role()') is not null,'is_active_admin',to_regprocedure('public.is_active_admin()') is not null),
  'rls', (select jsonb_object_agg(c.relname,c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships'))
) as account_rls_preflight;
