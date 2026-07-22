-- VAM OS PRODUCTION SCHEMA INVENTORY - READ ONLY
-- DO NOT RUN without the exact phrase: AUTHORIZE READ-ONLY PRODUCTION SCHEMA INVENTORY
-- Metadata and aggregate counts only. No raw names, emails, phones, tokens or form contents.
with core(table_name) as (values ('programs'),('seasons'),('intake_batches'),('people'),('mentor_profiles'),
('mentee_profiles'),('applications'),('matches'),('events'),('event_registrations'),('admin_users'),('admin_scope_access'))
select 'PRODUCTION_TABLE_METADATA' result_section,r.table_name,c.oid is not null exists,c.relkind,
c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,c.reltuples::bigint estimated_rows,
count(a.attname) filter(where a.attnum>0 and not a.attisdropped) column_count
from core r left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=r.table_name
left join pg_attribute a on a.attrelid=c.oid group by r.table_name,c.oid,c.relkind,c.relrowsecurity,
c.relforcerowsecurity,c.reltuples order by r.table_name;
select 'PRODUCTION_COLUMNS' result_section,table_schema,table_name,column_name,ordinal_position,data_type,
udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position;
select 'PRODUCTION_CONSTRAINTS' result_section,n.nspname schema_name,c.relname table_name,k.conname,
k.contype,pg_get_constraintdef(k.oid,true) definition from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,k.conname;
select 'PRODUCTION_INDEXES' result_section,schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname='public' order by tablename,indexname;
select 'PRODUCTION_POLICIES' result_section,schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' order by tablename,policyname;
select 'PRODUCTION_FUNCTIONS' result_section,n.nspname schema_name,p.proname,
pg_get_function_identity_arguments(p.oid) identity_args,p.prosecdef security_definer,p.proconfig,
pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind in ('f','p','w') order by p.proname,identity_args;
select 'PRODUCTION_AGGREGATES' result_section,n.nspname schema_name,p.proname,
pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_result(p.oid) return_type,
p.prokind,pg_get_userbyid(p.proowner) owner,p.proacl acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='a' order by p.proname,identity_args;
select 'PRODUCTION_TRIGGERS' result_section,n.nspname schema_name,c.relname table_name,t.tgname,
t.tgenabled,pg_get_triggerdef(t.oid,true) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public' order by c.relname,t.tgname;
select 'PRODUCTION_EXTENSIONS' result_section,extname,extversion from pg_extension order by extname;
select 'PRODUCTION_TABLE_ESTIMATES' result_section,n.nspname schema_name,c.relname table_name,
c.reltuples::bigint estimated_rows from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname='public' order by c.relname;
