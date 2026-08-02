-- VAM062_V3 catalog-only preflight. Source-controlled expected state; no business rows are read.
-- Changes vs. the reviewed VAM062_V5 draft:
--  * admin_scope_access arbiter check now matches the live partial +
--    expression unique index (CONFLICT-01) instead of a nonexistent plain
--    3-column UNIQUE constraint; the generic non-partial/non-expression
--    arbiter machinery below is kept for admin_users and
--    person_season_memberships (both still plain arbiters) and a dedicated
--    assertion is added for admin_scope_access.
--  * intake_batches->seasons relationship check is unchanged (it already
--    correctly required ON DELETE RESTRICT and matches live staging).
--  * lifecycle:admin_users now requires active+inactive only and explicitly
--    rejects a constraint that already contains 'invited' (DEC-04,
--    CONFLICT-07).
--  * lifecycle:memberships is split into independent role/status checks
--    (CONFLICT-03) instead of requiring one combined constraint.
--  * a new action_type_vocabulary assertion confirms the legacy
--    admin_audit_log constraint text before the migration replaces it.
--  * the "rls:<table>" assertions that required RLS to already be OFF on
--    all five original tables are removed: live staging evidence shows RLS
--    is already ON for four of the five, and migration 062 V3 enables RLS
--    idempotently and captures whatever the prior state was regardless —
--    that prior state was never actually a real precondition, and requiring
--    it "OFF" made this preflight fail against real staging today for
--    reasons unrelated to migration safety. Replaced with a non-blocking
--    informational rls_state_capturable check.
--  * "affected_table_grants" is likewise demoted from a blocking assertion
--    to non-blocking evidence, extended to all 7 write-path tables:
--    migration 062 V3 revokes/regrants these itself rather than assuming
--    they are already clean, and live evidence confirms admin_users already
--    carries anon grants this precondition would otherwise have required be
--    absent beforehand.
--  * all assertions now carry an explicit is_blocking flag; eligible/
--    overall_status are computed from blocking assertions only, while every
--    assertion (blocking or not) is still reported for full transparency.
with
required_rel(name) as (values ('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('programs'),('seasons'),('intake_batches'),('person_season_memberships'),('person_season_membership_log')),
expected_col(t,c,typ,nullable,identity_kind,generated_kind) as (values
 ('admin_users','id','uuid',false,'NO','NEVER'),('admin_users','auth_user_id','uuid',true,'NO','NEVER'),('admin_users','email','text',false,'NO','NEVER'),('admin_users','full_name','text',true,'NO','NEVER'),('admin_users','role','text',false,'NO','NEVER'),('admin_users','status','text',false,'NO','NEVER'),
 ('admin_scope_access','id','uuid',false,'NO','NEVER'),('admin_scope_access','user_id','uuid',false,'NO','NEVER'),('admin_scope_access','program_id','text',true,'NO','NEVER'),('admin_scope_access','season_id','text',true,'NO','NEVER'),('admin_scope_access','role','text',false,'NO','NEVER'),('admin_scope_access','status','text',false,'NO','NEVER'),
 ('admin_audit_log','actor_admin_user_id','uuid',true,'NO','NEVER'),('admin_audit_log','action_type','text',false,'NO','NEVER'),('admin_audit_log','target_admin_user_id','uuid',true,'NO','NEVER'),('admin_audit_log','before_data','jsonb',true,'NO','NEVER'),('admin_audit_log','after_data','jsonb',true,'NO','NEVER'),
 ('people','id','uuid',false,'NO','NEVER'),('people','email_primary','text',true,'NO','NEVER'),('people','full_name','text',false,'NO','NEVER'),('programs','id','uuid',false,'NO','NEVER'),('programs','code','text',false,'NO','NEVER'),('programs','is_active','bool',false,'NO','NEVER'),('seasons','id','uuid',false,'NO','NEVER'),('seasons','code','text',false,'NO','NEVER'),('seasons','program_id','uuid',false,'NO','NEVER'),('intake_batches','id','uuid',false,'NO','NEVER'),('intake_batches','code','text',false,'NO','NEVER'),('intake_batches','season_id','uuid',false,'NO','NEVER'),
 ('person_season_memberships','id','uuid',false,'NO','NEVER'),('person_season_memberships','person_id','uuid',false,'NO','NEVER'),('person_season_memberships','program_id','uuid',false,'NO','NEVER'),('person_season_memberships','season_id','uuid',false,'NO','NEVER'),('person_season_memberships','intake_batch_id','uuid',true,'NO','NEVER'),('person_season_memberships','role','text',false,'NO','NEVER'),('person_season_memberships','status','text',false,'NO','NEVER'),('person_season_memberships','source','text',false,'NO','NEVER'),('person_season_memberships','created_by','uuid',true,'NO','NEVER'),
 ('person_season_membership_log','membership_id','uuid',false,'NO','NEVER'),('person_season_membership_log','person_id','uuid',false,'NO','NEVER'),('person_season_membership_log','program_id','uuid',false,'NO','NEVER'),('person_season_membership_log','season_id','uuid',false,'NO','NEVER'),('person_season_membership_log','role','text',false,'NO','NEVER'),('person_season_membership_log','old_status','text',true,'NO','NEVER'),('person_season_membership_log','new_status','text',false,'NO','NEVER'),('person_season_membership_log','transition_type','text',false,'NO','NEVER'),('person_season_membership_log','reason','text',true,'NO','NEVER'),('person_season_membership_log','changed_by','uuid',true,'NO','NEVER')),
expected_policy(t,n,roles,cmd,qual) as(values
 ('admin_users','read_admin_users_super_admin_or_self',array['public'],'SELECT','((auth.uid() = auth_user_id) OR (current_admin_role() = ''super_admin''::text))'),
 ('admin_scope_access','read_admin_scope_access_self_or_super_admin',array['public'],'SELECT','((current_admin_role() = ''super_admin''::text) OR (is_active_admin() AND (user_id = auth.uid()) AND (status = ''active''::text)))'),
 ('admin_audit_log','read_admin_audit_log_super_admin_only',array['public'],'SELECT','(current_admin_role() = ''super_admin''::text)')),
expected_arbiter(t,cols) as(values('admin_users',array['email']),('person_season_memberships',array['person_id','season_id','role'])),
index_shape as(select c.relname t,i.indexrelid,i.indisunique,i.indisvalid,i.indisready,i.indpred is null nonpartial,i.indexprs is null nonexpression,i.indisnullsnotdistinct,array(select a.attname from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where k.ord<=i.indnkeyatts order by k.ord) cols,i.indnkeyatts from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
arbiter_assert as(select e.t,e.cols,case when count(s.*)=1 and bool_and(s.indisunique and s.indisvalid and s.indisready and s.nonpartial and s.nonexpression and not s.indisnullsnotdistinct and s.indnkeyatts=cardinality(e.cols)) then 'PASS' else 'FAIL' end status from expected_arbiter e left join index_shape s on s.t=e.t and s.cols=e.cols group by e.t,e.cols),
scope_arbiter_assert as(
 select case when exists(
   select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='admin_scope_access'
     and i.indisunique and i.indisvalid and i.indisready and not i.indisnullsnotdistinct and i.indnkeyatts=4
     and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'
     and i.indexprs is not null and pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
     and (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[0])='user_id'
     and (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[3])='role'
 ) then 'PASS' else 'FAIL' end status
),
column_assert as(select e.t||'.'||e.c assertion,case when count(c.*)=1 and bool_and(c.udt_name=e.typ and (c.is_nullable='YES')=e.nullable and c.is_identity=e.identity_kind and c.is_generated=e.generated_kind) then 'PASS' else 'FAIL' end status from expected_col e left join information_schema.columns c on c.table_schema='public' and c.table_name=e.t and c.column_name=e.c group by e.t,e.c),
policy_assert as(select e.t||'.'||e.n assertion,case when count(p.*)=1 and bool_and(p.permissive='PERMISSIVE' and p.roles=e.roles and p.cmd=e.cmd and p.qual=e.qual and p.with_check is null) then 'PASS' else 'FAIL' end status from expected_policy e left join pg_policies p on p.schemaname='public' and p.tablename=e.t and p.policyname=e.n group by e.t,e.n),
assertions as(
 select 'relation:'||r.name assertion,case when c.oid is not null and c.relkind='r' and pg_get_userbyid(c.relowner)=current_user then 'PASS' else 'FAIL' end status,true is_blocking from required_rel r left join pg_class c on c.oid=to_regclass('public.'||r.name)
 union all select 'column:'||assertion,status,true from column_assert
 union all select 'arbiter:'||t,status,true from arbiter_assert
 union all select 'arbiter:admin_scope_access',status,true from scope_arbiter_assert
 union all select 'relationship:seasons_program',case when exists(select 1 from pg_constraint where conrelid='public.seasons'::regclass and contype='f' and convalidated and pg_get_constraintdef(oid,true)='FOREIGN KEY (program_id) REFERENCES programs(id)') then 'PASS' else 'FAIL' end,true
 union all select 'relationship:intake_season',case when exists(select 1 from pg_constraint where conrelid='public.intake_batches'::regclass and contype='f' and convalidated and pg_get_constraintdef(oid,true)='FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT') then 'PASS' else 'FAIL' end,true
 union all select 'lifecycle:admin_users_vocabulary',case when exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and convalidated and pg_get_constraintdef(oid) like '%active%' and pg_get_constraintdef(oid) like '%inactive%') then 'PASS' else 'FAIL' end,true
 union all select 'lifecycle:admin_users_no_invited',case when not exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%invited%') then 'PASS' else 'FAIL' end,true
 union all select 'lifecycle:membership_role',case when exists(select 1 from pg_constraint where conrelid='public.person_season_memberships'::regclass and contype='c' and convalidated and pg_get_constraintdef(oid) like '%mentor%' and pg_get_constraintdef(oid) like '%mentee%') then 'PASS' else 'FAIL' end,true
 union all select 'lifecycle:membership_status',case when exists(select 1 from pg_constraint where conrelid='public.person_season_memberships'::regclass and contype='c' and convalidated and pg_get_constraintdef(oid) like '%invited%' and pg_get_constraintdef(oid) like '%paused%' and pg_get_constraintdef(oid) like '%withdrawn%' and pg_get_constraintdef(oid) like '%opted_out%' and pg_get_constraintdef(oid) like '%cancelled%') then 'PASS' else 'FAIL' end,true
 union all select 'action_type_vocabulary',case when exists(select 1 from pg_constraint where conrelid='public.admin_audit_log'::regclass and conname='admin_audit_log_action_type_check' and contype='c' and pg_get_constraintdef(oid)='CHECK (action_type = ANY (ARRAY[''create_admin_user''::text, ''update_admin_user''::text, ''reactivate_admin_user''::text, ''deactivate_admin_user''::text, ''remove_admin_access''::text, ''sync_auth''::text, ''unknown''::text])) NOT VALID') then 'PASS' else 'FAIL' end,true
 union all select 'defaults:generated_ids_and_timestamps',case when not exists(select 1 from (values('admin_users','id','gen_random_uuid()'),('admin_scope_access','id','gen_random_uuid()'),('admin_audit_log','id','gen_random_uuid()'),('admin_audit_log','created_at','now()'),('people','id','gen_random_uuid()'),('person_season_memberships','id','gen_random_uuid()'),('person_season_memberships','created_at','now()'),('person_season_memberships','updated_at','now()'),('person_season_membership_log','id','gen_random_uuid()'),('person_season_membership_log','changed_at','now()'))e(t,c,d) left join information_schema.columns a on a.table_schema='public' and a.table_name=e.t and a.column_name=e.c where a.column_name is null or a.column_default<>e.d) then 'PASS' else 'FAIL' end,true
 union all select 'primary_keys',case when not exists(select 1 from required_rel r where not exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.'||r.name) and c.contype='p' and c.convalidated and pg_get_constraintdef(c.oid,true)='PRIMARY KEY (id)')) then 'PASS' else 'FAIL' end,true
 union all select 'membership_foreign_keys',case when exists(select 1 from pg_constraint where conrelid='public.person_season_memberships'::regclass and contype='f' and convalidated and pg_get_constraintdef(oid,true)='FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE') and exists(select 1 from pg_constraint where conrelid='public.person_season_memberships'::regclass and contype='f' and convalidated and pg_get_constraintdef(oid,true)='FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT') and exists(select 1 from pg_constraint where conrelid='public.person_season_memberships'::regclass and contype='f' and convalidated and pg_get_constraintdef(oid,true)='FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT') then 'PASS' else 'FAIL' end,true
 -- Non-blocking evidence only: migration 062 V3 revokes/regrants these
 -- itself (DEC-09) rather than assuming a pre-clean state, so this is no
 -- longer a precondition for eligibility — reported for visibility only.
 union all select 'evidence:current_grant_hygiene:'||x.t,case when not (has_table_privilege('anon','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE') or not has_table_privilege('authenticated','public.'||x.t,'SELECT') or has_table_privilege('authenticated','public.'||x.t,'INSERT,UPDATE,DELETE') or not has_table_privilege('service_role','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE')) then 'PASS' else 'FAIL' end,false from (values('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('intake_batches'),('person_season_membership_log'))x(t)
 union all select 'helper:'||x.name,case when p.oid is not null and l.lanname='sql' and p.provolatile='s' and p.prosecdef and pg_get_userbyid(p.proowner)=current_user and p.proconfig@>array['search_path=public'] and not has_function_privilege('anon',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute') then 'PASS' else 'FAIL' end,true from (values('current_admin_role'),('is_active_admin'))x(name) left join pg_proc p on p.oid=to_regprocedure('public.'||x.name||'()') left join pg_language l on l.oid=p.prolang
 union all select 'policy:'||assertion,status,true from policy_assert
 union all select 'policy_inventory',case when (select count(*) from pg_policies where schemaname='public' and tablename in('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','intake_batches','person_season_membership_log'))=(select count(*) from expected_policy) then 'PASS' else 'FAIL' end,true
 -- Non-blocking evidence only: current RLS enable/force state is not a
 -- precondition (migration 062 V3 captures and enables idempotently
 -- regardless of the starting state); reported for visibility only.
 union all select 'evidence:rls_state_capturable:'||x.t,case when c.oid is not null then 'PASS' else 'FAIL' end,false from(values('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('intake_batches'),('person_season_membership_log'))x(t) left join pg_class c on c.oid=to_regclass('public.'||x.t)
 union all select 'package_name_collisions',case when not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('account_rls_package_state','account_rls_package_manifest','account_import_batches','account_import_outcomes','account_auth_reconciliation','account_auth_operations','account_person_auth_links','account_import_previews')) and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%') then 'PASS' else 'FAIL' end,true
 union all select 'import_compatibility',case when not exists(select 1 from arbiter_assert where status<>'PASS') and (select status from scope_arbiter_assert)='PASS' and to_regprocedure('gen_random_uuid()') is not null then 'PASS' else 'FAIL' end,true
 union all select 'rollback_compatibility',case when not exists(select 1 from required_rel r where to_regclass('public.'||r.name) is null) then 'PASS' else 'FAIL' end,true),
normalized as(select assertion,status::text,is_blocking from assertions)
select jsonb_build_object(
  'package','VAM062_V3',
  'read_only',true,
  'overall_status',case when bool_and(status='PASS' or not is_blocking) then 'PASS' else 'FAIL' end,
  'eligible',bool_and(status='PASS' or not is_blocking),
  'assertions',jsonb_agg(jsonb_build_object('assertion',assertion,'status',status,'is_blocking',is_blocking) order by assertion),
  'failed_blocking_assertions',coalesce(jsonb_agg(assertion order by assertion) filter (where status<>'PASS' and is_blocking),'[]'::jsonb),
  'failed_informational_assertions',coalesce(jsonb_agg(assertion order by assertion) filter (where status<>'PASS' and not is_blocking),'[]'::jsonb)
) account_rls_preflight_v3 from normalized;
