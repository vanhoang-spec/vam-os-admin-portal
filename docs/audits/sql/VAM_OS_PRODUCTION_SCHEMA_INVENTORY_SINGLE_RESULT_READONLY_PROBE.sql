-- VAM OS production schema inventory - single-result read-only probe v1
-- Owner-run in confirmed production only under existing read-only metadata authorization.
-- One SELECT/WITH statement; metadata and aggregate counts only; no raw PII.
with
target_identity as (
 select jsonb_build_object('database',current_database(),'current_user',current_user,
 'session_user',session_user,'schema',current_schema(),'timezone',current_setting('TimeZone'),
 'search_path',current_setting('search_path'),'postgres_version',version()) value
),
schemas_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name),'[]'::jsonb) value from
 (select n.nspname schema_name,pg_get_userbyid(n.nspowner) owner
  from pg_namespace n where n.nspname not like 'pg_temp_%') x
),
extensions_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by extension_name),'[]'::jsonb) value from
 (select e.extname extension_name,e.extversion installed_version,n.nspname schema_name
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace) x
),
tables_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name),'[]'::jsonb) value from
 (select n.nspname schema_name,c.relname table_name,c.relkind,pg_get_userbyid(c.relowner) owner,
 c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,c.reltuples::bigint estimated_rows,
 obj_description(c.oid,'pg_class') table_comment
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema')) x
),
columns_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by table_schema,table_name,ordinal_position),'[]'::jsonb) value from
 (select c.table_schema,c.table_name,c.column_name,c.ordinal_position,c.data_type,c.udt_schema,c.udt_name,
 c.is_nullable,c.column_default,c.is_generated,c.generation_expression,c.is_identity,c.identity_generation,
 c.collation_name from information_schema.columns c
 where c.table_schema not in ('pg_catalog','information_schema')) x
),
constraints_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name,constraint_name),'[]'::jsonb) value from
 (select n.nspname schema_name,t.relname table_name,k.conname constraint_name,k.contype constraint_type,
 pg_get_constraintdef(k.oid,true) definition,k.convalidated validated,k.condeferrable deferrable,
 k.condeferred initially_deferred,rn.nspname referenced_schema,rt.relname referenced_table,
 k.confdeltype on_delete_code,k.confupdtype on_update_code
 from pg_constraint k join pg_class t on t.oid=k.conrelid join pg_namespace n on n.oid=t.relnamespace
 left join pg_class rt on rt.oid=k.confrelid left join pg_namespace rn on rn.oid=rt.relnamespace
 where n.nspname not in ('pg_catalog','information_schema')) x
),
indexes_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name,index_name),'[]'::jsonb) value from
 (select n.nspname schema_name,t.relname table_name,ic.relname index_name,i.indisunique is_unique,
 i.indisprimary is_primary,i.indisvalid is_valid,i.indisready is_ready,a.amname access_method,
 pg_get_expr(i.indpred,i.indrelid,true) predicate,pg_get_expr(i.indexprs,i.indrelid,true) expression,
 pg_get_indexdef(i.indexrelid,0,true) definition
 from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
 join pg_class ic on ic.oid=i.indexrelid join pg_am a on a.oid=ic.relam
 where n.nspname not in ('pg_catalog','information_schema')) x
),
functions_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,function_name,identity_args),'[]'::jsonb) value from
 (select n.nspname schema_name,p.proname function_name,pg_get_function_identity_arguments(p.oid) identity_args,
 pg_get_function_result(p.oid) return_type,l.lanname language,p.prokind,p.provolatile volatility,
 p.prosecdef security_definer,pg_get_userbyid(p.proowner) owner,p.proconfig function_config,p.proacl acl,
 pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname not in ('pg_catalog','information_schema') and p.prokind in ('f','p','w')) x
),
aggregates_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,aggregate_name,identity_args),'[]'::jsonb) value from
 (select n.nspname schema_name,p.proname aggregate_name,pg_get_function_identity_arguments(p.oid) identity_args,
 pg_get_function_result(p.oid) return_type,pg_get_userbyid(p.proowner) owner,p.proacl acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema') and p.prokind='a') x
),
triggers_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name,trigger_name),'[]'::jsonb) value from
 (select n.nspname schema_name,c.relname table_name,t.tgname trigger_name,t.tgenabled enabled_state,
 pn.nspname function_schema,p.proname function_name,pg_get_triggerdef(t.oid,true) definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
 where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema')) x
),
policies_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname),'[]'::jsonb) value
 from (select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname not in ('pg_catalog','information_schema')) x
),
table_grants_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by table_schema,table_name,grantee,privilege_type),'[]'::jsonb) value
 from (select grantee,table_schema,table_name,privilege_type,is_grantable
 from information_schema.role_table_grants where table_schema not in ('pg_catalog','information_schema')) x
),
sequence_grants_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by object_schema,object_name,grantee,privilege_type),'[]'::jsonb) value
 from (select grantee,object_schema,object_name,privilege_type,is_grantable
 from information_schema.role_usage_grants where object_type='SEQUENCE') x
),
function_grants_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by routine_schema,routine_name,grantee,privilege_type),'[]'::jsonb) value
 from (select grantee,routine_schema,routine_name,privilege_type,is_grantable
 from information_schema.role_routine_grants where routine_schema not in ('pg_catalog','information_schema')) x
),
migration_tables_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name),'[]'::jsonb) value from
 (select n.nspname schema_name,c.relname table_name,c.reltuples::bigint estimated_rows,
 array_agg(a.attname order by a.attnum) filter(where a.attnum>0 and not a.attisdropped) columns
 from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid
 where c.relkind in ('r','p') and (n.nspname ilike '%migration%' or c.relname ilike '%migration%' or c.relname ilike '%schema_version%')
 group by n.nspname,c.relname,c.reltuples) x
),
migration_provenance_j as (
 select jsonb_build_object(
  'ledger_tables',migration_tables_j.value,
  'rows','[]'::jsonb,
  'status',case when jsonb_array_length(migration_tables_j.value)=0
    then 'ledger_not_found_in_catalog'
    else 'ledger_tables_detected_catalog_only' end,
  'not_evaluated_reason','Ledger row contents were not evaluated because relation existence and column shape are not guaranteed; catalog metadata only.'
 ) value from migration_tables_j
),
estimates_j as (
 select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name),'[]'::jsonb) value from
 (select n.nspname schema_name,c.relname table_name,c.reltuples::bigint estimated_rows
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')) x
),
safety_counts_j as (
 select jsonb_build_object(
 'applications', (select count(*) from public.applications),
 'people', (select count(*) from public.people),
 'mentor_profiles', (select count(*) from public.mentor_profiles),
 'mentee_profiles', (select count(*) from public.mentee_profiles),
 'matches', (select count(*) from public.matches),
 'events', (select count(*) from public.events),
 'event_registrations', (select count(*) from public.event_registrations),
 'application_answers', (select count(*) from public.application_answers)
 ) value
)
select jsonb_build_object(
 'probe_version','vam-os-production-schema-inventory-single-result-v1',
 'target_identity',target_identity.value,'schemas',schemas_j.value,'extensions',extensions_j.value,
 'tables',tables_j.value,'columns',columns_j.value,'constraints',constraints_j.value,
 'indexes',indexes_j.value,'functions',functions_j.value,'aggregates',aggregates_j.value,
 'triggers',triggers_j.value,'policies',policies_j.value,'table_grants',table_grants_j.value,
 'sequence_grants',sequence_grants_j.value,'function_grants',function_grants_j.value,
 'migration_provenance',migration_provenance_j.value,
 'table_estimates',estimates_j.value,'safety_counts',safety_counts_j.value
) production_schema_inventory
from target_identity,schemas_j,extensions_j,tables_j,columns_j,constraints_j,indexes_j,functions_j,
aggregates_j,triggers_j,policies_j,table_grants_j,sequence_grants_j,function_grants_j,
migration_tables_j,migration_provenance_j,estimates_j,safety_counts_j;
