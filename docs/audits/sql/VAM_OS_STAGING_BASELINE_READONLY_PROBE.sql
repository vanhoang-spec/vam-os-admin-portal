-- VAM OS STAGING BASELINE READ-ONLY PROBE
-- SELECT/WITH only. Metadata and aggregate catalog estimates; no business rows or PII.
with required(table_name) as (values
('programs'),('seasons'),('intake_batches'),('people'),('mentor_profiles'),('mentee_profiles'),
('applications'),('matches'),('events'),('event_registrations'),('admin_users'),('admin_scope_access'),
('admin_audit_log'),('activity_correction_log'),('event_participations'),('person_season_membership_log'))
select 'TABLE_BASELINE' result_section,r.table_name,c.oid is not null exists,c.relkind,
pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,
count(a.attname) filter(where a.attnum>0 and not a.attisdropped) column_count,
c.reltuples::bigint estimated_rows,obj_description(c.oid,'pg_class') table_comment
from required r left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=r.table_name
left join pg_attribute a on a.attrelid=c.oid group by r.table_name,c.oid,c.relkind,c.relowner,
c.relrowsecurity,c.relforcerowsecurity,c.reltuples order by r.table_name;

select 'SCHEMAS' result_section,nspname schema_name,pg_get_userbyid(nspowner) owner
from pg_namespace where nspname not like 'pg_temp_%' order by nspname;

select 'SAFE_TABLE_NAMES' result_section,n.nspname schema_name,c.relname table_name,c.relkind,
c.reltuples::bigint estimated_rows from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p','v','m') and n.nspname not in ('pg_catalog','information_schema')
order by n.nspname,c.relname;

select 'FUNCTIONS' result_section,n.nspname schema_name,p.proname function_name,
pg_get_function_identity_arguments(p.oid) identity_args,l.lanname language,p.prosecdef security_definer,
p.proconfig function_config from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_language l on l.oid=p.prolang where n.nspname not in ('pg_catalog','information_schema')
order by n.nspname,p.proname,identity_args;

select 'TRIGGERS' result_section,n.nspname schema_name,c.relname table_name,t.tgname trigger_name,
t.tgenabled enabled_state,p.proname function_name,pg_get_triggerdef(t.oid,true) definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal order by n.nspname,c.relname,t.tgname;

select 'POLICIES' result_section,schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies order by schemaname,tablename,policyname;

select 'MIGRATION_LEDGER_TABLES' result_section,n.nspname schema_name,c.relname table_name,
c.reltuples::bigint estimated_rows,array_agg(a.attname order by a.attnum)
filter(where a.attnum>0 and not a.attisdropped) columns
from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid
where c.relkind in ('r','p') and (n.nspname ilike '%migration%' or c.relname ilike '%migration%' or c.relname ilike '%schema_version%')
group by n.nspname,c.relname,c.reltuples order by n.nspname,c.relname;

select 'EXTENSIONS' result_section,e.extname extension_name,e.extversion installed_version,
n.nspname schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname;

with needed(extension_name) as (values ('pgcrypto'))
select 'REQUIRED_EXTENSIONS' result_section,n.extension_name,e.extversion installed_version,
e.oid is not null installed from needed n left join pg_extension e on e.extname=n.extension_name;
