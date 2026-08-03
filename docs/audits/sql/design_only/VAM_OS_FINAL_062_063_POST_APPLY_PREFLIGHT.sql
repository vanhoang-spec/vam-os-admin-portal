-- VAM_FINAL_062_063_V1 combined post-apply final preflight. Catalog-only; no business rows are read.
-- Purpose: one read-only gate proving the FINAL intended database state after
-- both migration 062 V3 and migration 063 V1 have been applied. It is not a
-- replacement for either migration-specific verifier and does not weaken any
-- of their assertions: every check below is carried over at the same strength
-- and the same comparison form as the committed source it derives from.
--
-- Polarity note (important): the pre-apply readiness preflight
-- VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql asserts package_name_collision,
-- i.e. that NO vam063_% function exists. That is correct before 063 is
-- applied and necessarily FAILS afterwards. This file inverts that
-- expectation: the nine vam063_% functions must be PRESENT, and the inventory
-- must be exactly nine so no unexpected vam063_% object can hide.
--
-- Derivations:
--  * m062:* assertions carry over VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql,
--    including the whitespace-normalised policy comparison (pg_get_expr renders
--    sub-SELECTs multi-line) and the typed p/f/u/c constraint breakdown with an
--    independently derived total.
--  * m063:* assertions carry over VAM_OS_MEMBERSHIP_LIFECYCLE_POST_APPLY_VERIFY.sql.
--  * state:* assertions carry over the structural prerequisites from
--    VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql that must still hold.
with
expected_policy(t,n,q) as(values
 ('admin_users','vam062_admin_users_self_or_super','((auth_user_id = auth.uid()) OR (current_admin_role() = ''super_admin''::text))'),
 ('admin_scope_access','vam062_scope_self_or_super','((user_id = auth.uid()) OR (current_admin_role() = ''super_admin''::text))'),
 ('admin_audit_log','vam062_audit_actor_or_super','((actor_admin_user_id = vam062_current_admin_id()) OR (current_admin_role() = ''super_admin''::text))'),
 ('people','vam062_people_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM (person_season_memberships m JOIN admin_scope_access s ON (((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (m.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (m.season_id)::text)))) WHERE (m.person_id = people.id))))'),
 ('person_season_memberships','vam062_membership_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM admin_scope_access s WHERE ((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (person_season_memberships.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (person_season_memberships.season_id)::text)))))'),
 ('intake_batches','vam062_intake_batches_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM (seasons se JOIN admin_scope_access s ON (((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (se.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (se.id)::text)))) WHERE (se.id = intake_batches.season_id))))'),
 ('person_season_membership_log','vam062_membership_log_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM admin_scope_access s WHERE ((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (person_season_membership_log.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (person_season_membership_log.season_id)::text)))))')),
expected_table(t,cols,types,nulls,rls,forced,con_p,con_f,con_u,con_c)as(values
 ('account_rls_package_state',array['table_name','rls_was_enabled','rls_was_forced','prior_grants','package_version','state_checksum','recorded_at'],array['text','bool','bool','jsonb','text','text','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO'],false,false,1,0,0,2),
 ('account_rls_package_manifest',array['object_kind','object_name','table_name','object_oid','definition_hash','owner_name','package_version'],array['text','text','text','oid','text','text','text'],array['NO','NO','YES','YES','NO','NO','NO'],false,false,1,0,0,3),
 ('account_import_batches',array['id','actor_admin_user_id','source_sha256','row_count','status','created_at','completed_at'],array['uuid','uuid','text','int4','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','YES'],true,false,1,1,0,3),
 ('account_import_outcomes',array['id','batch_id','row_number','outcome_status','reason_code','auth_user_id_hash','created_at'],array['uuid','uuid','int4','text','text','text','timestamptz'],array['NO','NO','NO','NO','NO','YES','NO'],true,false,1,1,1,4),
 ('account_auth_reconciliation',array['operation_id','identifier_hash','action_type','failure_class','retry_status','correlation_metadata','created_at','updated_at'],array['uuid','text','text','text','text','jsonb','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,0,0,2),
 ('account_auth_operations',array['operation_id','actor_admin_user_id','operation_type','identifier_hash','pre_lookup_state','preexisting_auth_user_id_hash','provider_stage','provider_auth_user_id_hash','ownership_state','delete_allowed','application_stage','compensation_stage','reconciliation_state','retry_of','failure_class','created_at','updated_at'],array['uuid','uuid','text','text','text','text','text','text','text','bool','text','text','text','uuid','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','YES','NO','YES','NO','NO','NO','NO','NO','YES','YES','NO','NO'],true,false,1,2,0,11),
 ('account_person_auth_links',array['id','auth_user_id','person_id','program_id','season_id','role','status','created_at','updated_at'],array['uuid','uuid','uuid','uuid','uuid','text','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,3,3,2),
 ('account_import_previews',array['id','actor_admin_user_id','secret_hash','ciphertext','iv','auth_tag','expires_at','created_at'],array['uuid','uuid','text','text','text','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,1,0,1)),
expected_default(t,col,d)as(values
 ('account_rls_package_state','prior_grants','''[]''::jsonb'),
 ('account_rls_package_state','recorded_at','transaction_timestamp()'),
 ('account_import_batches','id','gen_random_uuid()'),
 ('account_import_batches','created_at','now()'),
 ('account_import_outcomes','id','gen_random_uuid()'),
 ('account_import_outcomes','created_at','now()'),
 ('account_auth_reconciliation','retry_status','''required''::text'),
 ('account_auth_reconciliation','correlation_metadata','''{}''::jsonb'),
 ('account_auth_reconciliation','created_at','now()'),
 ('account_auth_reconciliation','updated_at','now()'),
 ('account_auth_operations','pre_lookup_state','''pending''::text'),
 ('account_auth_operations','provider_stage','''not_started''::text'),
 ('account_auth_operations','ownership_state','''not_found''::text'),
 ('account_auth_operations','delete_allowed','false'),
 ('account_auth_operations','application_stage','''not_started''::text'),
 ('account_auth_operations','compensation_stage','''not_required''::text'),
 ('account_auth_operations','reconciliation_state','''not_required''::text'),
 ('account_auth_operations','created_at','now()'),
 ('account_auth_operations','updated_at','now()'),
 ('account_person_auth_links','id','gen_random_uuid()'),
 ('account_person_auth_links','created_at','now()'),
 ('account_person_auth_links','updated_at','now()'),
 ('account_import_previews','created_at','now()')),
expected_function_062(sig)as(values('vam062_current_admin_id()'),('vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)'),('vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)'),('vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text)'),('vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid)'),('vam062_record_reconciliation(uuid,uuid,integer,text)'),('vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)'),('vam062_begin_auth_operation(uuid,uuid,text,text,uuid)'),('vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)'),('vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamp with time zone,integer)'),('vam062_consume_account_preview(uuid,uuid,text)')),
-- internal=true means the function is only called by other SECURITY DEFINER
-- functions and must NOT carry a service_role EXECUTE grant.
expected_function_063(sig,internal)as(values
 ('vam063_authorized_for_scope(uuid,uuid,uuid)',true),
 ('vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)',true),
 ('vam063_pause_membership(uuid,uuid,text)',false),
 ('vam063_withdraw_membership(uuid,uuid,text)',false),
 ('vam063_opt_out_membership(uuid,uuid,text)',false),
 ('vam063_cancel_membership(uuid,uuid,text)',false),
 ('vam063_reactivate_membership(uuid,uuid,text)',false),
 ('vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',false),
 ('vam063_remove_membership_role(uuid,uuid,text)',false)),
membership_role_expected(v) as (values ('mentee'),('mentor'),('supporter'),('reviewer'),('interviewer'),('coreteam'),('advisor'),('alumni_mentee'),('guest')),
membership_status_expected(v) as (values ('invited'),('active'),('paused'),('withdrawn'),('completed'),('graduated'),('opted_out'),('cancelled')),
action_type_expected(v) as (values ('create_admin_user'),('update_admin_user'),('reactivate_admin_user'),('deactivate_admin_user'),('remove_admin_access'),('sync_auth'),('unknown'),('import_participant_membership'),('link_person_auth'),('reconcile_person_auth'),('create_membership'),('add_membership_role'),('remove_membership_role'),('pause_membership'),('withdraw_membership'),('opt_out_membership'),('cancel_membership'),('reactivate_membership')),
membership_role_actual as (
  select array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.person_season_memberships'::regclass and c.conname='person_season_memberships_role_check' and c.contype='c'
),
membership_status_actual as (
  select array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.person_season_memberships'::regclass and c.conname='person_season_memberships_status_check' and c.contype='c'
),
action_type_actual as (
  select c.convalidated,array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and c.contype='c'
),
table_actual as(select e.*,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,(select array_agg(x.column_name::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_cols,(select array_agg(x.udt_name::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_types,(select array_agg(x.is_nullable::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_nulls,(select count(*) from pg_constraint x where x.conrelid=c.oid) actual_constraints,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='p') actual_p,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='f') actual_f,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='u') actual_u,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='c') actual_c from expected_table e left join pg_class c on c.oid=to_regclass('public.'||e.t)),
assertions as(
 -- ---------- migration 062: package objects remain applied and intact ----------
 select 'm062:table:'||t assertion,case when oid is not null and relkind='r' and owner=current_user and actual_cols=cols and actual_types=types and actual_nulls=nulls and relrowsecurity=rls and relforcerowsecurity=forced and actual_p=con_p and actual_f=con_f and actual_u=con_u and actual_c=con_c and actual_constraints=con_p+con_f+con_u+con_c then 'PASS' else 'FAIL' end status from table_actual
 -- policy qual is compared after identical whitespace normalisation on both
 -- sides; every other component stays exact equality.
 union all select 'm062:policy:'||e.n,case when count(p.*)=1 and bool_and(p.permissive='PERMISSIVE' and p.roles::text[]=array['authenticated']::text[] and p.cmd='SELECT' and btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))=btrim(regexp_replace(e.q,'[[:space:]]+',' ','g')) and p.with_check is null) then 'PASS' else 'FAIL' end from expected_policy e left join pg_policies p on p.schemaname='public' and p.tablename=e.t and p.policyname=e.n group by e.t,e.n
 union all select 'm062:policy_inventory',case when (select count(*) from pg_policies where schemaname='public' and policyname like 'vam062_%')=7 and not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename in(select t from expected_policy) and p.permissive='PERMISSIVE' and p.policyname not in(select n from expected_policy) and p.policyname not in('read_admin_users_super_admin_or_self','active admins can read themselves','read_admin_scope_access_self_or_super_admin','read_admin_audit_log_super_admin_only')) then 'PASS' else 'FAIL' end
 union all select 'm062:function:'||e.sig,case when p.oid is not null and p.prosecdef and p.proconfig@>array['search_path=public'] and pg_get_userbyid(p.proowner)=current_user and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute') then 'PASS' else 'FAIL' end from expected_function_062 e left join pg_proc p on p.oid=to_regprocedure('public.'||e.sig)
 union all select 'm062:function_inventory',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%')=(select count(*) from expected_function_062) then 'PASS' else 'FAIL' end
 union all select 'm062:column_defaults',case when not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name in(select t from expected_table) and c.column_default::text is distinct from(select x.d from expected_default x where x.t=c.table_name::text and x.col=c.column_name::text)) and not exists(select 1 from expected_default x where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name::text=x.t and c.column_name::text=x.col)) then 'PASS' else 'FAIL' end
 union all select 'm062:affected_table_state_and_grants',case when not exists(select 1 from(values('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('intake_batches'),('person_season_membership_log'))x(t) join pg_class c on c.oid=to_regclass('public.'||x.t) where not c.relrowsecurity or c.relforcerowsecurity or pg_get_userbyid(c.relowner)<>current_user or has_table_privilege('anon','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE') or not has_table_privilege('authenticated','public.'||x.t,'SELECT') or has_table_privilege('authenticated','public.'||x.t,'INSERT,UPDATE,DELETE') or not has_table_privilege('service_role','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE')) then 'PASS' else 'FAIL' end
 union all select 'm062:package_grants',case when not exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in(select t from expected_table) and grantee not in(current_user,'service_role')) and not exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in('account_rls_package_state','account_rls_package_manifest') and grantee='service_role') then 'PASS' else 'FAIL' end
 -- ---------- migration 063: package objects present and guarantees held ----------
 union all select 'm063:function:'||e.sig,case when p.oid is not null and p.prosecdef and pg_get_userbyid(p.proowner)=current_user and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and (e.internal or has_function_privilege('service_role',p.oid,'execute')) then 'PASS' else 'FAIL' end from expected_function_063 e left join pg_proc p on p.oid=to_regprocedure('public.'||e.sig)
 -- inverted vs the pre-apply readiness preflight: the nine functions must now
 -- EXIST, and the inventory must be exactly nine so nothing unexpected hides.
 union all select 'm063:function_inventory_exact',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%')=(select count(*) from expected_function_063) and not exists(select 1 from expected_function_063 e where to_regprocedure('public.'||e.sig) is null) then 'PASS' else 'FAIL' end
 union all select 'm063:no_delete_in_any_function',case when not exists(select 1 from expected_function_063 e join pg_proc p on p.oid=to_regprocedure('public.'||e.sig) where pg_get_functiondef(p.oid) ~* '\mdelete\s+from\s+public\.(person_season_memberships|person_season_membership_log|people)\M') then 'PASS' else 'FAIL' end
 union all select 'm063:transitions_always_log',case when (select pg_get_functiondef(p.oid) from pg_proc p where p.oid=to_regprocedure('public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)')) like '%insert into public.person_season_membership_log%' and (select pg_get_functiondef(p.oid) from pg_proc p where p.oid=to_regprocedure('public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)')) like '%insert into public.person_season_membership_log%' then 'PASS' else 'FAIL' end
 union all select 'm063:prerequisite_062_v3_still_applied',case when to_regprocedure('public.vam062_current_admin_id()') is not null and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='person_season_memberships' and c.relrowsecurity) then 'PASS' else 'FAIL' end
 -- ---------- shared structural state that must still hold ----------
 union all select 'state:membership_rls_enabled',case when exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='person_season_memberships' and c.relrowsecurity) then 'PASS' else 'FAIL' end
 union all select 'state:admin_scope_access_corrected_arbiter',case when exists(
   select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='admin_scope_access'
     and i.indisunique and i.indisvalid and i.indisready and not i.indnullsnotdistinct and i.indnkeyatts=4
     and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'
     and i.indexprs is not null and pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
 ) then 'PASS' else 'FAIL' end
 union all select 'state:membership_role_vocabulary_full_exact',case when exists(select 1 from membership_role_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from membership_role_expected e)) then 'PASS' else 'FAIL' end
 union all select 'state:membership_status_vocabulary_full_exact',case when exists(select 1 from membership_status_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from membership_status_expected e)) then 'PASS' else 'FAIL' end
 union all select 'state:action_type_vocabulary_full_exact',case when exists(select 1 from action_type_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from action_type_expected e)) then 'PASS' else 'FAIL' end
 union all select 'state:action_type_not_valid',case when exists(select 1 from action_type_actual a where a.convalidated=false) then 'PASS' else 'FAIL' end
 union all select 'state:admin_users_status_vocabulary',case when exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%active%' and pg_get_constraintdef(oid) like '%inactive%') and not exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%invited%') then 'PASS' else 'FAIL' end
),
normalized as(select assertion,status::text status from assertions)
select jsonb_build_object(
  'package','VAM_FINAL_062_063_V1',
  'read_only',true,
  'overall_status',case when bool_and(status='PASS') then 'PASS' else 'FAIL' end,
  'final_ready',bool_and(status='PASS'),
  'failureCount',count(*) filter(where status<>'PASS'),
  'migration_062_verified',coalesce(bool_and(status='PASS') filter(where assertion like 'm062:%'),false),
  'migration_063_verified',coalesce(bool_and(status='PASS') filter(where assertion like 'm063:%'),false),
  'assertions',jsonb_agg(jsonb_build_object('assertion',assertion,'status',status) order by assertion),
  'failed_assertions',coalesce(jsonb_agg(assertion order by assertion)filter(where status<>'PASS'),'[]'::jsonb)
) final_062_063_post_apply_v1 from normalized;
