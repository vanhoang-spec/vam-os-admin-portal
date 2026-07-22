-- VAM OS Migration 061 - READ-ONLY SCHEMA PROBE
-- Owner-run only after confirming STAGING. SELECT/WITH only. No raw PII.

-- A. Environment identity
select 'A_ENVIRONMENT_IDENTITY' result_section,current_database() database_name,current_user current_user_name,
session_user session_user_name,current_schema() current_schema_name,version() postgres_version,
current_setting('TimeZone') timezone,pg_size_pretty(pg_database_size(current_database())) database_size,
current_setting('search_path') search_path,current_setting('app.settings.project_ref',true) project_ref_if_exposed,
current_setting('app.settings.environment',true) environment_if_exposed;

-- B. Table inventory
with r(s,t) as (values ('public','recruitment_campaigns'),('public','applications'),('public','programs'),
('public','seasons'),('public','intake_batches'),('public','admin_scope_access'),('public','admin_users'))
select 'B_TABLE_INVENTORY' result_section,r.s schema_name,r.t table_name,c.oid is not null exists,c.relkind,
pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,
c.reltuples::bigint estimated_rows,obj_description(c.oid,'pg_class') table_comment
from r left join pg_namespace n on n.nspname=r.s left join pg_class c on c.relnamespace=n.oid and c.relname=r.t order by r.t;

-- C. Column inventory
select 'C_COLUMN_INVENTORY' result_section,x.table_schema,x.table_name,x.column_name,x.ordinal_position,x.data_type,
x.udt_schema,x.udt_name,x.is_nullable,x.column_default,x.is_generated,x.generation_expression,x.is_identity,
x.identity_generation,x.collation_name,col_description(c.oid,x.ordinal_position) column_comment
from information_schema.columns x join pg_namespace n on n.nspname=x.table_schema
join pg_class c on c.relnamespace=n.oid and c.relname=x.table_name where x.table_schema='public' and
(x.table_name='recruitment_campaigns' or (x.table_name='applications' and x.column_name in
('id','season_id','intake_batch_id','role_applied','email_primary','status','submitted_at',
'recruitment_campaign_id','application_reference','consent_version','consented_at'))) order by x.table_name,x.ordinal_position;

-- D. Constraints
select 'D_CONSTRAINTS' result_section,n.nspname schema_name,t.relname table_name,k.conname constraint_name,
k.contype constraint_type,pg_get_constraintdef(k.oid,true) definition,k.convalidated validated,
k.condeferrable deferrable,k.condeferred initially_deferred,rn.nspname referenced_schema,rt.relname referenced_table,
case k.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end on_delete,
case k.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end on_update
from pg_constraint k join pg_class t on t.oid=k.conrelid join pg_namespace n on n.oid=t.relnamespace
left join pg_class rt on rt.oid=k.confrelid left join pg_namespace rn on rn.oid=rt.relnamespace
where n.nspname='public' and t.relname in ('recruitment_campaigns','applications','programs','seasons','intake_batches')
order by t.relname,k.conname;

-- E. Indexes
select 'E_INDEXES' result_section,n.nspname schema_name,t.relname table_name,ic.relname index_name,
i.indisunique is_unique,i.indisprimary is_primary,i.indisvalid is_valid,i.indisready is_ready,a.amname access_method,
pg_get_expr(i.indpred,i.indrelid,true) predicate,pg_get_expr(i.indexprs,i.indrelid,true) expression,
pg_get_indexdef(i.indexrelid,0,true) full_definition from pg_index i join pg_class t on t.oid=i.indrelid
join pg_namespace n on n.oid=t.relnamespace join pg_class ic on ic.oid=i.indexrelid join pg_am a on a.oid=ic.relam
where n.nspname='public' and t.relname in ('recruitment_campaigns','applications') order by t.relname,ic.relname;

-- F. Functions
select 'F_FUNCTIONS' result_section,n.nspname schema_name,p.proname function_name,
pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_result(p.oid) return_type,l.lanname language,
p.provolatile volatility,p.prosecdef security_definer,pg_get_userbyid(p.proowner) owner,p.proconfig function_config,
p.proacl acl,pg_get_functiondef(p.oid) full_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_language l on l.oid=p.prolang where n.nspname='public' and
(p.proname in ('validate_recruitment_campaign_scope','validate_application_campaign_scope','is_admin_role')
or p.proname ilike '%admin%scope%' or p.proname ilike '%program%access%' or p.proname ilike '%season%access%')
order by p.proname,identity_args;

-- G. Triggers
select 'G_TRIGGERS' result_section,n.nspname schema_name,t.relname table_name,g.tgname trigger_name,g.tgenabled enabled_state,
case when (g.tgtype&2)<>0 then 'BEFORE' when (g.tgtype&64)<>0 then 'INSTEAD OF' else 'AFTER' end timing,
concat_ws(', ',case when (g.tgtype&4)<>0 then 'INSERT' end,case when (g.tgtype&8)<>0 then 'DELETE' end,
case when (g.tgtype&16)<>0 then 'UPDATE' end,case when (g.tgtype&32)<>0 then 'TRUNCATE' end) events,
pn.nspname||'.'||p.proname function_name,pg_get_triggerdef(g.oid,true) full_definition
from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace
join pg_proc p on p.oid=g.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
where not g.tgisinternal and n.nspname='public' and t.relname in ('recruitment_campaigns','applications')
order by t.relname,g.tgname;

-- H. RLS policies
select 'H_RLS_POLICIES' result_section,schemaname schema_name,tablename table_name,policyname policy_name,
permissive,roles,cmd command,qual using_expression,with_check with_check_expression from pg_policies
where schemaname='public' and tablename in
('recruitment_campaigns','applications','programs','seasons','intake_batches','admin_scope_access')
order by tablename,policyname;

-- I. Table, sequence, and function grants
select 'I_TABLE_GRANTS' result_section,grantee,table_schema object_schema,table_name object_name,privilege_type,is_grantable
from information_schema.role_table_grants where table_schema='public' and table_name in
('recruitment_campaigns','applications','programs','seasons','intake_batches','admin_scope_access','admin_users')
and (grantee in ('anon','authenticated','service_role','postgres') or grantee not like 'pg_%') order by table_name,grantee,privilege_type;
select 'I_SEQUENCE_GRANTS' result_section,grantee,object_schema,object_name,privilege_type,is_grantable
from information_schema.role_usage_grants where object_type='SEQUENCE' and object_schema='public'
and (grantee in ('anon','authenticated','service_role','postgres') or grantee not like 'pg_%') order by object_name,grantee;
select 'I_FUNCTION_GRANTS' result_section,grantee,routine_schema,routine_name,privilege_type,is_grantable
from information_schema.role_routine_grants where routine_schema='public' and
(routine_name in ('validate_recruitment_campaign_scope','validate_application_campaign_scope','is_admin_role')
or routine_name ilike '%admin%scope%' or routine_name ilike '%program%access%' or routine_name ilike '%season%access%')
order by routine_name,grantee;

-- J. Migration provenance
select 'J_MIGRATION_HISTORY_TABLES' result_section,n.nspname schema_name,c.relname table_name,
pg_get_userbyid(c.relowner) owner,c.reltuples::bigint estimated_rows,
array_agg(a.attname order by a.attnum) filter(where a.attnum>0 and not a.attisdropped) columns
from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid
where c.relkind in ('r','p') and (n.nspname ilike '%migration%' or c.relname ilike '%migration%' or c.relname ilike '%schema_version%')
group by n.nspname,c.relname,c.relowner,c.reltuples order by n.nspname,c.relname;
select 'J_SUPABASE_MIGRATION_PROVENANCE' result_section,version,name migration_name,
null::timestamptz applied_timestamp_not_recorded,cardinality(statements) statement_count,
md5(array_to_string(statements,E'\n')) statement_checksum from supabase_migrations.schema_migrations
where version='061' or name ilike '%061%' or name ilike '%recruitment%campaign%' or
array_to_string(statements,E'\n') ilike any(array['%recruitment_campaigns%','%application_reference%',
'%consent_version%','%validate_recruitment_campaign_scope%','%applications_campaign_email_role_uniq%']) order by version;

-- K. Data-shape safety counts. Requires target table/columns; never returns raw email/name/phone.
select 'K_CAMPAIGN_TOTAL' result_section,count(*)::bigint row_count from public.recruitment_campaigns;
select 'K_CAMPAIGN_BY_STATUS' result_section,status,count(*)::bigint row_count from public.recruitment_campaigns group by status order by status;
select 'K_CAMPAIGN_BY_SCOPE' result_section,program_id,season_id,applicant_role,count(*)::bigint row_count
from public.recruitment_campaigns group by program_id,season_id,applicant_role order by program_id,season_id,applicant_role;
select 'K_APPLICATION_FIELD_COUNTS' result_section,
count(*) filter(where recruitment_campaign_id is not null)::bigint campaign_linked,
count(*) filter(where application_reference is not null)::bigint with_reference,
count(*) filter(where consent_version is not null or consented_at is not null)::bigint with_consent,
count(*) filter(where recruitment_campaign_id is not null and nullif(btrim(email_primary),'') is null)::bigint blank_or_null_email
from public.applications;
with d as (select recruitment_campaign_id,role_applied,lower(btrim(email_primary)) canonical_email from public.applications
where recruitment_campaign_id is not null and nullif(btrim(email_primary),'') is not null
group by recruitment_campaign_id,role_applied,lower(btrim(email_primary)) having count(*)>1)
select 'K_DUPLICATE_CAMPAIGN_ROLE_EMAIL_GROUPS' result_section,count(*)::bigint duplicate_group_count from d;
select 'K_DUPLICATE_APPLICATION_REFERENCES' result_section,count(*)::bigint duplicate_group_count from
(select application_reference from public.applications where application_reference is not null group by application_reference having count(*)>1) d;
select 'K_CAMPAIGN_SCOPE_MISMATCH' result_section,
count(*) filter(where s.id is null or s.program_id is distinct from c.program_id)::bigint season_program_mismatch,
count(*) filter(where b.id is null or b.season_id is distinct from c.season_id)::bigint batch_season_mismatch
from public.recruitment_campaigns c left join public.seasons s on s.id=c.season_id
left join public.intake_batches b on b.id=c.intake_batch_id;
select 'K_APPLICATION_CAMPAIGN_SCOPE_MISMATCH' result_section,
count(*) filter(where c.id is null)::bigint orphan_campaign_references,
count(*) filter(where c.id is not null and (a.season_id is distinct from c.season_id
or a.intake_batch_id is distinct from c.intake_batch_id or a.role_applied::text is distinct from c.applicant_role))::bigint scope_mismatch
from public.applications a left join public.recruitment_campaigns c on c.id=a.recruitment_campaign_id
where a.recruitment_campaign_id is not null;
