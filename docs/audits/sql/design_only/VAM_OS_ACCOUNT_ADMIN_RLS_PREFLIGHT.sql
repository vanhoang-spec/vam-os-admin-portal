-- V2 READ ONLY. Structural metadata only; no business rows, PII, secrets, or environment values.
with affected(table_name) as (values ('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('person_season_membership_log'),('programs'),('seasons'),('intake_batches')),
columns_inventory as (
 select c.table_name,c.column_name,c.data_type,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.identity_generation,c.is_generated,c.generation_expression
 from information_schema.columns c join affected a using(table_name) where c.table_schema='public'
), constraints_inventory as (
 select cl.relname table_name,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid,true) definition
 from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace join affected a on a.table_name=cl.relname where n.nspname='public'
), policies_inventory as (
 select p.tablename,p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check from pg_policies p join affected a on a.table_name=p.tablename where p.schemaname='public'
), function_inventory as (
 select n.nspname schema_name,p.proname,pg_get_function_identity_arguments(p.oid) signature,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,
        pg_get_userbyid(p.proowner) owner_name,md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')) definition_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.proname in ('current_admin_role','is_active_admin','vam062_current_admin_id','vam062_admin_mutation_atomic','vam062_upsert_staff_account_atomic','vam062_import_participant_membership_atomic','vam062_record_reconciliation')
), function_privileges as (
 select r.rolname role_name,p.proname,has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute
 from pg_roles r cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where r.rolname in ('anon','authenticated','service_role') and n.nspname='public' and p.proname in ('current_admin_role','is_active_admin','vam062_current_admin_id','vam062_admin_mutation_atomic','vam062_upsert_staff_account_atomic','vam062_import_participant_membership_atomic','vam062_record_reconciliation')
), table_privileges as (
 select a.table_name,r.rolname role_name,
   has_table_privilege(r.oid,format('public.%I',a.table_name),'SELECT') can_select,
   has_table_privilege(r.oid,format('public.%I',a.table_name),'INSERT') can_insert,
   has_table_privilege(r.oid,format('public.%I',a.table_name),'UPDATE') can_update,
   has_table_privilege(r.oid,format('public.%I',a.table_name),'DELETE') can_delete
 from affected a cross join pg_roles r where r.rolname in ('anon','authenticated','service_role') and to_regclass(format('public.%I',a.table_name)) is not null
), relations as (
 select c.relname table_name,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,pg_get_userbyid(c.relowner) owner_name
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join affected a on a.table_name=c.relname where n.nspname='public'
), conflicts as (
 select name,exists_flag from (values
 ('table:account_rls_package_state',to_regclass('public.account_rls_package_state') is not null),
 ('table:account_import_batches',to_regclass('public.account_import_batches') is not null),
 ('table:account_import_outcomes',to_regclass('public.account_import_outcomes') is not null),
('function:vam062_current_admin_id',to_regprocedure('public.vam062_current_admin_id()') is not null),
 ('function:vam062_admin_mutation_atomic',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='vam062_admin_mutation_atomic')),
 ('function:vam062_upsert_staff_account_atomic',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='vam062_upsert_staff_account_atomic')),
 ('function:vam062_import_participant_membership_atomic',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='vam062_import_participant_membership_atomic')),
 ('function:vam062_record_reconciliation',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='vam062_record_reconciliation'))
 ) v(name,exists_flag)
), unexpected_policies as (
 select * from policies_inventory where not (
   (tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin') or
   (tablename='admin_users' and policyname='read_admin_users_super_admin_or_self') or
   (tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only')
 )
), incompatible_expected_policies as (
 select * from policies_inventory where
  (tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual not ilike '%auth.uid%')) or
  (tablename='admin_users' and policyname='read_admin_users_super_admin_or_self' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual not ilike '%auth.uid%')) or
  (tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual ilike '%reviewer%' or qual ilike '%viewer%'))
)
select jsonb_build_object(
 'package','VAM062_V2','read_only',true,
 'schemas',jsonb_build_object('public_exists',to_regnamespace('public') is not null,'auth_exists',to_regnamespace('auth') is not null),
 'relations',(select jsonb_agg(to_jsonb(r) order by table_name) from relations r),
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from columns_inventory c),
 'constraints',(select jsonb_agg(to_jsonb(c) order by table_name,conname) from constraints_inventory c),
 'lifecycle_checks',(select jsonb_agg(to_jsonb(c) order by table_name,conname) from constraints_inventory c where contype='c' and table_name in ('admin_users','admin_scope_access','person_season_memberships')),
 'extensions',jsonb_build_object('pgcrypto_installed',exists(select 1 from pg_extension where extname='pgcrypto'),'gen_random_uuid_available',to_regprocedure('gen_random_uuid()') is not null),
 'functions',(select jsonb_agg(to_jsonb(f) order by proname,signature) from function_inventory f),
 'function_privileges',(select jsonb_agg(to_jsonb(f) order by proname,role_name) from function_privileges f),
 'table_privileges',(select jsonb_agg(to_jsonb(t) order by table_name,role_name) from table_privileges t),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]'::jsonb) from policies_inventory p),
 'unexpected_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]'::jsonb) from unexpected_policies p),
 'incompatible_expected_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by tablename,policyname),'[]'::jsonb) from incompatible_expected_policies p),
 'package_name_conflicts',(select jsonb_agg(to_jsonb(c) order by name) from conflicts c),
 'relationships',(select jsonb_agg(to_jsonb(c) order by table_name,conname) from constraints_inventory c where contype='f' and table_name in ('seasons','intake_batches','person_season_memberships')),
 'eligible',not exists(select 1 from conflicts where exists_flag) and not exists(select 1 from unexpected_policies) and not exists(select 1 from incompatible_expected_policies)
) as account_rls_preflight_v2;
