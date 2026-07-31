-- V2 READ ONLY structural verification with unexpected-policy detection.
with affected(t) as (values('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('account_import_batches'),('account_import_outcomes')),
expected_policy(n) as (values('read_admin_scope_access_self_or_super_admin'),('read_admin_users_super_admin_or_self'),('read_admin_audit_log_super_admin_only'),('vam062_admin_users_self_or_super'),('vam062_scope_self_or_super'),('vam062_audit_actor_or_super'),('vam062_people_program_ops'),('vam062_membership_program_ops')),
unexpected as (select p.* from pg_policies p join affected a on a.t=p.tablename where p.schemaname='public' and not exists(select 1 from expected_policy e where e.n=p.policyname))
select jsonb_build_object(
 'package','VAM062_V2',
 'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join affected a on a.t=c.relname where n.nspname='public'),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'cmd',cmd,'using',qual,'check',with_check) order by tablename,policyname) from pg_policies p join affected a on a.t=p.tablename where schemaname='public'),
 'unexpected_policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname)),'[]'::jsonb) from unexpected),
 'ordinary_import_table_access',jsonb_build_object('anon',has_table_privilege('anon','public.account_import_batches','select'), 'authenticated',has_table_privilege('authenticated','public.account_import_batches','select')),
 'package_functions_service_only',(select bool_and(not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%'),
 'pass',not exists(select 1 from unexpected) and not has_table_privilege('anon','public.account_import_batches','select') and not has_table_privilege('authenticated','public.account_import_batches','select')
) account_rls_post_apply_v2;
