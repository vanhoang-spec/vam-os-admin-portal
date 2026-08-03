-- VAM062_V3 deterministic rollback. Schema authentication only; never reads business rows.
-- Changes vs. the reviewed VAM062_V5 draft:
--  * state/manifest counts updated for 7 tracked tables (was 5) and 7
--    tracked policies (was 5), reflecting DEC-09's extension to
--    intake_batches and person_season_membership_log.
--  * drops the two new policies (vam062_intake_batches_program_ops,
--    vam062_membership_log_program_ops) alongside the original five.
--  * restores admin_audit_log_action_type_check to its exact pre-migration
--    (legacy, NOT VALID) definition — the reviewed draft never touched this
--    constraint, so rollback never needed to restore it; migration 062 V3
--    does alter it (DEC-10), so rollback now must reverse that too.
--  * restores anon/authenticated grants on all 7 write-path tables from
--    account_rls_package_state.prior_grants exactly, instead of leaving
--    them at whatever migration 062 V3 set them to — the reviewed draft
--    never touched grants on any pre-existing table, so this restoration
--    step did not previously exist either.
begin;
do $$
declare v_bad text;
begin
  if to_regclass('public.account_rls_package_state') is null or to_regclass('public.account_rls_package_manifest') is null then
    raise exception 'VAM062V3 provenance missing';
  end if;

  if (select count(*) from public.account_rls_package_state where package_version='VAM062_V5')<>7
     or exists(select 1 from public.account_rls_package_state where table_name not in('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','intake_batches','person_season_membership_log') or state_checksum<>encode(digest('VAM062_V5|'||table_name||'|'||rls_was_enabled||'|'||rls_was_forced,'sha256'),'hex'))
  then raise exception 'VAM062V3 rollback state invalid'; end if;

  if (select count(*) from public.account_rls_package_manifest)<>26
     or (select count(*) from public.account_rls_package_manifest where object_kind='table')<>8
     or (select count(*) from public.account_rls_package_manifest where object_kind='function')<>11
     or (select count(*) from public.account_rls_package_manifest where object_kind='policy')<>7
     or exists(select 1 from public.account_rls_package_manifest where package_version<>'VAM062_V5')
  then raise exception 'VAM062V3 manifest set invalid'; end if;

  if exists(
    select 1 from public.account_rls_package_manifest m
    left join pg_class c on m.object_kind='table' and c.oid=m.object_oid
    left join pg_namespace n on n.oid=c.relnamespace
    where m.object_kind='table' and (c.oid is null or n.nspname<>'public' or c.relname<>m.object_name or c.relkind<>'r' or m.table_name<>m.object_name or m.definition_hash<>'VAM062_V5_TABLE_PROVENANCE' or m.owner_name<>pg_get_userbyid(c.relowner))
  ) then raise exception 'VAM062V3 table identity/provenance mismatch'; end if;

  with expected(t,n)as(values('account_rls_package_state',7),('account_rls_package_manifest',7),('account_import_batches',7),('account_import_outcomes',7),('account_auth_reconciliation',8),('account_import_previews',8))
  select string_agg(e.t,',') into v_bad from expected e where (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t)<>e.n;
  if v_bad is not null then raise exception 'VAM062V3 column set mismatch: %',v_bad; end if;

  if exists(select 1 from (values
    ('account_rls_package_state',1,'table_name','text','NO'),('account_rls_package_state',2,'rls_was_enabled','bool','NO'),('account_rls_package_state',3,'rls_was_forced','bool','NO'),('account_rls_package_state',4,'prior_grants','jsonb','NO'),('account_rls_package_state',5,'package_version','text','NO'),('account_rls_package_state',6,'state_checksum','text','NO'),('account_rls_package_state',7,'recorded_at','timestamptz','NO'),
    ('account_rls_package_manifest',1,'object_kind','text','NO'),('account_rls_package_manifest',2,'object_name','text','NO'),('account_rls_package_manifest',3,'table_name','text','YES'),('account_rls_package_manifest',4,'object_oid','oid','YES'),('account_rls_package_manifest',5,'definition_hash','text','NO'),('account_rls_package_manifest',6,'owner_name','text','NO'),('account_rls_package_manifest',7,'package_version','text','NO'),
    ('account_import_batches',1,'id','uuid','NO'),('account_import_batches',2,'actor_admin_user_id','uuid','NO'),('account_import_batches',3,'source_sha256','text','NO'),('account_import_batches',4,'row_count','int4','NO'),('account_import_batches',5,'status','text','NO'),('account_import_batches',6,'created_at','timestamptz','NO'),('account_import_batches',7,'completed_at','timestamptz','YES'),
    ('account_import_outcomes',1,'id','uuid','NO'),('account_import_outcomes',2,'batch_id','uuid','NO'),('account_import_outcomes',3,'row_number','int4','NO'),('account_import_outcomes',4,'outcome_status','text','NO'),('account_import_outcomes',5,'reason_code','text','NO'),('account_import_outcomes',6,'auth_user_id_hash','text','YES'),('account_import_outcomes',7,'created_at','timestamptz','NO'),
    ('account_auth_reconciliation',1,'operation_id','uuid','NO'),('account_auth_reconciliation',2,'identifier_hash','text','NO'),('account_auth_reconciliation',3,'action_type','text','NO'),('account_auth_reconciliation',4,'failure_class','text','NO'),('account_auth_reconciliation',5,'retry_status','text','NO'),('account_auth_reconciliation',6,'correlation_metadata','jsonb','NO'),('account_auth_reconciliation',7,'created_at','timestamptz','NO'),('account_auth_reconciliation',8,'updated_at','timestamptz','NO'),
    ('account_import_previews',1,'id','uuid','NO'),('account_import_previews',2,'actor_admin_user_id','uuid','NO'),('account_import_previews',3,'secret_hash','text','NO'),('account_import_previews',4,'ciphertext','text','NO'),('account_import_previews',5,'iv','text','NO'),('account_import_previews',6,'auth_tag','text','NO'),('account_import_previews',7,'expires_at','timestamptz','NO'),('account_import_previews',8,'created_at','timestamptz','NO')
  )e(t,pos,c,typ,nullable) left join information_schema.columns a on a.table_schema='public' and a.table_name=e.t and a.ordinal_position=e.pos where a.column_name is null or a.column_name<>e.c or a.udt_name<>e.typ or a.is_nullable<>e.nullable or a.is_identity<>'NO' or a.is_generated<>'NEVER') then
    raise exception 'VAM062V3 ordered column/type/nullability/generation mismatch';
  end if;

  if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name like 'account_%' and c.column_default is distinct from case
    when c.table_name='account_rls_package_state' and c.column_name='recorded_at' then 'transaction_timestamp()'
    when c.table_name='account_rls_package_state' and c.column_name='prior_grants' then '''[]''::jsonb'
    when c.table_name in('account_import_batches','account_import_outcomes','account_import_previews') and c.column_name='id' then 'gen_random_uuid()'
    when c.column_name in('created_at','updated_at') then 'now()'
    when c.table_name='account_auth_reconciliation' and c.column_name='retry_status' then '''required''::text'
    when c.table_name='account_auth_reconciliation' and c.column_name='correlation_metadata' then '''{}''::jsonb'
    else null end)
  then raise exception 'VAM062V3 column default mismatch'; end if;

  if exists(select 1 from (values('account_rls_package_state',3),('account_rls_package_manifest',4),('account_import_batches',5),('account_import_outcomes',7),('account_auth_reconciliation',3),('account_import_previews',3))e(t,n) where (select count(*) from pg_constraint c where c.conrelid=to_regclass('public.'||e.t))<>e.n)
     or not exists(select 1 from pg_constraint where conrelid='public.account_import_batches'::regclass and contype='f' and pg_get_constraintdef(oid,true)='FOREIGN KEY (actor_admin_user_id) REFERENCES admin_users(id)')
     or not exists(select 1 from pg_constraint where conrelid='public.account_import_outcomes'::regclass and contype='f' and pg_get_constraintdef(oid,true)='FOREIGN KEY (batch_id) REFERENCES account_import_batches(id) ON DELETE CASCADE')
     or not exists(select 1 from pg_constraint where conrelid='public.account_import_outcomes'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (batch_id, row_number)')
     or not exists(select 1 from pg_constraint where conrelid='public.account_import_previews'::regclass and contype='f' and pg_get_constraintdef(oid,true)='FOREIGN KEY (actor_admin_user_id) REFERENCES admin_users(id)')
  then raise exception 'VAM062V3 key/constraint inventory mismatch'; end if;

  if exists(select 1 from (values('account_rls_package_state',false),('account_rls_package_manifest',false),('account_import_batches',true),('account_import_outcomes',true),('account_auth_reconciliation',true),('account_import_previews',true))e(t,rls) join pg_class c on c.oid=to_regclass('public.'||e.t) where c.relrowsecurity<>e.rls or c.relforcerowsecurity) then
    raise exception 'VAM062V3 RLS state mismatch';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename like 'account_%') then
    raise exception 'VAM062V3 unexpected package table policy';
  end if;
  if exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in('account_rls_package_state','account_rls_package_manifest','account_import_batches','account_import_outcomes','account_auth_reconciliation','account_auth_operations','account_person_auth_links','account_import_previews') and grantee not in(current_user,'service_role'))
     or exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in('account_rls_package_state','account_rls_package_manifest') and grantee='service_role')
  then raise exception 'VAM062V3 unexpected package grantee'; end if;
  if exists(select 1 from (values('account_import_batches'),('account_import_outcomes'),('account_auth_reconciliation'),('account_import_previews'))e(t) where (select count(*) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=e.t and g.grantee='service_role' and g.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))<>7) then
    raise exception 'VAM062V3 complete service grant mismatch';
  end if;

  if exists(
    select 1 from public.account_rls_package_manifest m
    left join pg_proc p on m.object_kind='function' and p.oid=m.object_oid
    left join pg_namespace n on n.oid=p.pronamespace
    where m.object_kind='function' and (p.oid is null or n.nspname<>'public' or p.proname<>m.object_name or m.owner_name<>pg_get_userbyid(p.proowner) or m.definition_hash<>md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')) or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute'))
  ) then raise exception 'VAM062V3 function identity/privilege mismatch'; end if;

  if exists(
    select 1 from public.account_rls_package_manifest m
    left join pg_policies p on m.object_kind='policy' and p.schemaname='public' and p.tablename=m.table_name and p.policyname=m.object_name
    where m.object_kind='policy' and (p.policyname is null or m.definition_hash<>md5(concat_ws('|',p.tablename,p.policyname,p.permissive,array_to_string(p.roles,','),p.cmd,coalesce(p.qual,''),coalesce(p.with_check,''))))
  ) then raise exception 'VAM062V3 policy identity mismatch'; end if;

  -- The action_type constraint currently on admin_audit_log must be exactly
  -- the DEC-10-expanded superset before rollback reverses it, so rollback
  -- never blindly overwrites an unexpected later edit either.
  if not exists(
    select 1 from pg_constraint c where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and c.contype='c' and c.convalidated=false
      and pg_get_constraintdef(c.oid, true)='CHECK (action_type = ANY (ARRAY[''create_admin_user''::text, ''update_admin_user''::text, ''reactivate_admin_user''::text, ''deactivate_admin_user''::text, ''remove_admin_access''::text, ''sync_auth''::text, ''unknown''::text, ''import_participant_membership''::text, ''link_person_auth''::text, ''reconcile_person_auth''::text, ''create_membership''::text, ''add_membership_role''::text, ''remove_membership_role''::text, ''pause_membership''::text, ''withdraw_membership''::text, ''opt_out_membership''::text, ''cancel_membership''::text, ''reactivate_membership''::text])) NOT VALID'
  ) then raise exception 'VAM062V3 action_type constraint does not match the expected post-migration definition; refusing to roll back an unexpected state'; end if;
end $$;

drop policy vam062_admin_users_self_or_super on public.admin_users;
drop policy vam062_scope_self_or_super on public.admin_scope_access;
drop policy vam062_audit_actor_or_super on public.admin_audit_log;
drop policy vam062_people_program_ops on public.people;
drop policy vam062_membership_program_ops on public.person_season_memberships;
drop policy vam062_intake_batches_program_ops on public.intake_batches;
drop policy vam062_membership_log_program_ops on public.person_season_membership_log;

drop function public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text);
drop function public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb);
-- Dropped only after both callers above (vam062_upsert_staff_account_atomic,
-- vam062_admin_mutation_atomic) are already gone.
drop function public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text);
drop function public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid);
drop function public.vam062_record_reconciliation(uuid,uuid,integer,text);
drop function public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb);
drop function public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid);
drop function public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text);
drop function public.vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamptz,integer);
drop function public.vam062_consume_account_preview(uuid,uuid,text);
drop function public.vam062_current_admin_id();

drop table public.account_import_previews;
drop table public.account_auth_operations;
drop table public.account_person_auth_links;
drop table public.account_auth_reconciliation;
drop table public.account_import_outcomes;
drop table public.account_import_batches;
drop table public.account_rls_package_manifest;

-- Restore RLS enable/force state exactly as captured, for all 7 tables.
do $$
declare r record;
begin
  for r in select * from public.account_rls_package_state where package_version='VAM062_V5' loop
    execute format('alter table public.%I %s row level security',r.table_name,case when r.rls_was_enabled then 'enable' else 'disable' end);
    execute format('alter table public.%I %s force row level security',r.table_name,case when r.rls_was_forced then '' else 'no' end);
  end loop;
end $$;

-- Restore anon/authenticated grants exactly as captured, for all 7 tables —
-- first strip whatever migration 062 V3 set, then re-apply exactly the
-- captured (grantee, privilege_type) pairs, so a table that previously had
-- broad anon grants (however undesirable) is restored to that same state
-- rather than left in the migration's hardened state.
do $$
declare r record; g record;
begin
  for r in select * from public.account_rls_package_state where package_version='VAM062_V5' loop
    execute format('revoke all on public.%I from anon, authenticated',r.table_name);
    for g in select * from jsonb_to_recordset(r.prior_grants) as x(grantee text,privilege_type text) loop
      execute format('grant %s on public.%I to %I',g.privilege_type,r.table_name,g.grantee);
    end loop;
  end loop;
end $$;

-- Restore admin_audit_log's action_type constraint to its exact
-- pre-migration (legacy, NOT VALID) definition.
alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_type_check check (
  action_type = any (array['create_admin_user','update_admin_user','reactivate_admin_user','deactivate_admin_user','remove_admin_access','sync_auth','unknown'])
) not valid;

drop table public.account_rls_package_state;
commit;
-- Residual limitation: legitimate business rows written after installation are intentionally preserved; schema authentication never reads their contents.
