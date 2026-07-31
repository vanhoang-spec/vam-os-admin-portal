begin;

do $$
declare v_missing text; v_unexpected text;
begin
  select string_agg(x,', ') into v_missing from unnest(array[
    'public.admin_users','public.admin_scope_access','public.admin_audit_log','public.people','public.programs','public.seasons','public.intake_batches','public.person_season_memberships','public.person_season_membership_log'
  ]) x where to_regclass(x) is null;
  if v_missing is not null then raise exception 'VAM062 prerequisite tables missing: %',v_missing; end if;
  if to_regnamespace('auth') is null or to_regprocedure('gen_random_uuid()') is null then raise exception 'VAM062 required schema/function missing'; end if;
  if to_regprocedure('public.current_admin_role()') is null or to_regprocedure('public.is_active_admin()') is null then raise exception 'VAM062 admin helpers missing'; end if;
  if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='admin_users' and c.column_name in ('id','auth_user_id','email','full_name','role','status') having count(*)<>6) then raise exception 'VAM062 admin_users columns incompatible'; end if;
  if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='person_season_memberships' and c.column_name in ('id','person_id','program_id','season_id','intake_batch_id','role','status','source','created_by') having count(*)<>9) then raise exception 'VAM062 membership columns incompatible'; end if;
  if to_regclass('public.account_rls_package_state') is not null or to_regclass('public.account_import_batches') is not null or to_regclass('public.account_import_outcomes') is not null then raise exception 'VAM062 package table name collision'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%') then raise exception 'VAM062 package function name collision'; end if;
  select string_agg(tablename||'.'||policyname,', ') into v_unexpected from pg_policies where schemaname='public' and tablename in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships') and not (
    (tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin') or
    (tablename='admin_users' and policyname='read_admin_users_super_admin_or_self') or
    (tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only'));
  if v_unexpected is not null then raise exception 'VAM062 unexpected existing policies: %',v_unexpected; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual not ilike '%user_id%' or qual not ilike '%auth.uid%' or qual not ilike '%status%')) then raise exception 'VAM062 known scope policy definition mismatch'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='admin_users' and policyname='read_admin_users_super_admin_or_self' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual not ilike '%auth_user_id%' or qual not ilike '%auth.uid%')) then raise exception 'VAM062 known admin policy definition mismatch'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only' and (cmd<>'SELECT' or with_check is not null or qual not ilike '%current_admin_role%' or qual ilike '%reviewer%' or qual ilike '%viewer%')) then raise exception 'VAM062 known audit policy definition mismatch'; end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.admin_users'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%invited%' and pg_get_constraintdef(c.oid) ilike '%active%' and pg_get_constraintdef(c.oid) ilike '%suspended%' and pg_get_constraintdef(c.oid) ilike '%inactive%') then raise exception 'VAM062 account lifecycle constraint mismatch'; end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.person_season_memberships'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%mentor%' and pg_get_constraintdef(c.oid) ilike '%mentee%' and pg_get_constraintdef(c.oid) ilike '%invited%') then raise exception 'VAM062 membership lifecycle constraint mismatch'; end if;
end $$;

create table public.account_rls_package_state(table_name text primary key,rls_was_enabled boolean not null,rls_was_forced boolean not null,package_version text not null check(package_version='VAM062_V2'),recorded_at timestamptz not null default now());
insert into public.account_rls_package_state
select c.relname,c.relrowsecurity,c.relforcerowsecurity,'VAM062_V2',now() from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships');
do $$ begin if (select count(*) from public.account_rls_package_state)<>5 then raise exception 'VAM062 incomplete RLS state capture'; end if; end $$;

create table public.account_import_batches(id uuid primary key default gen_random_uuid(),actor_admin_user_id uuid not null references public.admin_users(id),source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),row_count integer not null check(row_count between 1 and 500),status text not null check(status in ('processing','completed','completed_with_errors')),created_at timestamptz not null default now(),completed_at timestamptz);
create table public.account_import_outcomes(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.account_import_batches(id) on delete cascade,row_number integer not null check(row_number>=2),outcome_status text not null check(outcome_status in ('created','updated','skipped','failed')),reason_code text not null check(length(reason_code) between 1 and 240),auth_user_id_hash text null check(auth_user_id_hash is null or auth_user_id_hash~'^[0-9a-f]{64}$'),created_at timestamptz not null default now(),unique(batch_id,row_number));

create function public.vam062_current_admin_id() returns uuid language sql stable security definer set search_path=public as $$select id from public.admin_users where auth_user_id=auth.uid() and status='active' limit 1$$;
create function public.vam062_admin_mutation_atomic(p_actor_admin_user_id uuid,p_operation text,p_target_admin_user_id uuid,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_auth uuid; v_before jsonb; v_after jsonb; v_action text;
begin
 if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then raise exception 'VAM062 unauthorized actor'; end if;
 if p_operation='upsert' then
   if p_payload->>'role' not in ('viewer','reviewer','support_team','core_team','admin','super_admin') then raise exception 'VAM062 invalid role'; end if;
   select id,to_jsonb(a) into v_target,v_before from public.admin_users a where email=lower(btrim(p_payload->>'email'));
   insert into public.admin_users(auth_user_id,email,full_name,role,status) values((p_payload->>'auth_user_id')::uuid,lower(btrim(p_payload->>'email')),nullif(btrim(p_payload->>'full_name'),''),p_payload->>'role',p_payload->>'status') on conflict(email) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,role=excluded.role,status=excluded.status returning id,auth_user_id into v_target,v_auth;
   insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(v_auth,p_payload->>'program_id',p_payload->>'season_id',p_payload->>'scope_role',p_payload->>'scope_status') on conflict do nothing;
   v_action:=case when v_before is null then 'create_admin_user' else 'update_admin_user' end;
 elsif p_operation='update' then
   select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update; if v_before is null then raise exception 'VAM062 target missing'; end if;
   update public.admin_users set full_name=nullif(btrim(p_payload->>'full_name'),''),role=p_payload->>'role',status=p_payload->>'status' where id=p_target_admin_user_id returning id into v_target;
   if nullif(p_payload->>'scope_id','') is not null then update public.admin_scope_access set program_id=p_payload->>'program_id',season_id=p_payload->>'season_id',role=p_payload->>'scope_role',status=p_payload->>'scope_status' where id=(p_payload->>'scope_id')::uuid and user_id=v_auth; else insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(v_auth,p_payload->>'program_id',p_payload->>'season_id',p_payload->>'scope_role',p_payload->>'scope_status') on conflict do nothing; end if;
   v_action:='update_admin_user';
 elsif p_operation='link_auth' then
   select to_jsonb(a) into v_before from public.admin_users a where id=p_target_admin_user_id for update; if v_before is null then raise exception 'VAM062 target missing'; end if;
   update public.admin_users set auth_user_id=(p_payload->>'auth_user_id')::uuid where id=p_target_admin_user_id returning id,auth_user_id into v_target,v_auth;
   insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(v_auth,p_payload->>'program_id',p_payload->>'season_id',p_payload->>'scope_role',p_payload->>'scope_status') on conflict do nothing;
   v_action:='sync_auth';
 elsif p_operation in ('status','remove') then
   select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update; if v_before is null then raise exception 'VAM062 target missing'; end if;
   update public.admin_users set status=case when p_operation='remove' then 'inactive' else p_payload->>'status' end where id=p_target_admin_user_id returning id into v_target;
   update public.admin_scope_access set status=case when p_operation='status' and p_payload->>'status'='active' then 'active' else 'inactive' end where user_id=v_auth;
   v_action:=case when p_operation='remove' then 'remove_admin_access' when p_payload->>'status'='active' then 'reactivate_admin_user' else 'deactivate_admin_user' end;
 else raise exception 'VAM062 unsupported operation'; end if;
 select to_jsonb(a) into v_after from public.admin_users a where id=v_target;
 insert into public.admin_audit_log(actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data) values(p_actor_admin_user_id,v_action,v_target,v_before,v_after);
end $$;

create function public.vam062_upsert_staff_account_atomic(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_auth_user_id uuid,p_email text,p_display_name text,p_role text,p_program_id uuid,p_season_id uuid,p_scope_role text) returns void language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_existing boolean;
begin
 if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then raise exception 'VAM062 unauthorized actor'; end if;
 if p_role not in ('viewer','reviewer','support_team','core_team','admin') then raise exception 'VAM062 unsupported staff role'; end if;
 select exists(select 1 from public.admin_users where email=lower(btrim(p_email))) into v_existing;
 insert into public.admin_users(auth_user_id,email,full_name,role,status) values(p_auth_user_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,'invited') on conflict(email) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,role=excluded.role returning id into v_target;
 insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(p_auth_user_id,p_program_id::text,p_season_id::text,p_scope_role,'inactive') on conflict do nothing;
 insert into public.admin_audit_log(actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data) values(p_actor_admin_user_id,case when v_existing then 'update_admin_user' else 'create_admin_user' end,v_target,null,jsonb_build_object('program_id',p_program_id,'season_id',p_season_id,'role',p_role,'status','invited'));
 insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code) values(p_batch_id,p_row_number,case when v_existing then 'updated' else 'created' end,case when v_existing then 'staff_account_updated' else 'staff_account_invited' end);
end $$;

create function public.vam062_import_participant_membership_atomic(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_email text,p_display_name text,p_role text,p_program_id uuid,p_season_id uuid,p_intake_batch_id uuid) returns table(outcome_status text,reason_code text) language plpgsql security definer set search_path=public as $$
declare v_person uuid; v_membership uuid; v_existing boolean; v_old_status text;
begin
 if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then raise exception 'VAM062 unauthorized actor'; end if;
 if p_role not in ('mentor','mentee') then raise exception 'VAM062 unsupported participant role'; end if;
 select id into v_person from public.people where email_primary=lower(btrim(p_email));
 if v_person is null then insert into public.people(email_primary,full_name) values(lower(btrim(p_email)),btrim(p_display_name)) returning id into v_person; end if;
 select id,status into v_membership,v_old_status from public.person_season_memberships where person_id=v_person and season_id=p_season_id and role=p_role;
 v_existing:=v_membership is not null;
 if v_existing and v_old_status='invited' and coalesce((select intake_batch_id from public.person_season_memberships where id=v_membership),'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_intake_batch_id,'00000000-0000-0000-0000-000000000000'::uuid) then
   insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code) values(p_batch_id,p_row_number,'skipped','membership_already_current'); return query select 'skipped','membership_already_current'; return;
 end if;
 insert into public.person_season_memberships(person_id,program_id,season_id,intake_batch_id,role,status,source,created_by) values(v_person,p_program_id,p_season_id,p_intake_batch_id,p_role,'invited','manual',p_actor_admin_user_id) on conflict(person_id,season_id,role) do update set intake_batch_id=excluded.intake_batch_id,status='invited' returning id into v_membership;
 insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by) values(v_membership,v_person,p_program_id,p_season_id,p_role,v_old_status,'invited',case when v_existing then 'status_change' else 'created' end,'account_csv_import',p_actor_admin_user_id);
 insert into public.admin_audit_log(actor_admin_user_id,action_type,before_data,after_data) values(p_actor_admin_user_id,'unknown',null,jsonb_build_object('operation','participant_membership_import','program_id',p_program_id,'season_id',p_season_id,'role',p_role,'participant_auth_created',false));
 insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code) values(p_batch_id,p_row_number,case when v_existing then 'updated' else 'created' end,case when v_existing then 'membership_updated' else 'membership_created_no_auth' end);
 return query select case when v_existing then 'updated' else 'created' end,case when v_existing then 'membership_updated' else 'membership_created_no_auth' end;
end $$;

create function public.vam062_record_reconciliation(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_auth_user_id_hash text) returns void language plpgsql security definer set search_path=public as $$begin if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then raise exception 'VAM062 unauthorized actor'; end if; insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code,auth_user_id_hash) values(p_batch_id,p_row_number,'failed','reconciliation_required',p_auth_user_id_hash) on conflict(batch_id,row_number) do update set outcome_status='failed',reason_code='reconciliation_required',auth_user_id_hash=excluded.auth_user_id_hash; end$$;

alter table public.admin_users enable row level security; alter table public.admin_scope_access enable row level security; alter table public.admin_audit_log enable row level security; alter table public.people enable row level security; alter table public.person_season_memberships enable row level security; alter table public.account_import_batches enable row level security; alter table public.account_import_outcomes enable row level security;
create policy vam062_admin_users_self_or_super on public.admin_users for select to authenticated using(auth_user_id=auth.uid() or public.current_admin_role()='super_admin');
create policy vam062_scope_self_or_super on public.admin_scope_access for select to authenticated using(user_id=auth.uid() or public.current_admin_role()='super_admin');
create policy vam062_audit_actor_or_super on public.admin_audit_log for select to authenticated using(actor_admin_user_id=public.vam062_current_admin_id() or public.current_admin_role()='super_admin');
create policy vam062_people_program_ops on public.people for select to authenticated using(public.current_admin_role()='super_admin' or exists(select 1 from public.person_season_memberships m join public.admin_scope_access s on s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=m.program_id::text and (s.season_id is null or s.season_id=m.season_id::text) where m.person_id=people.id));
create policy vam062_membership_program_ops on public.person_season_memberships for select to authenticated using(public.current_admin_role()='super_admin' or exists(select 1 from public.admin_scope_access s where s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=person_season_memberships.program_id::text and (s.season_id is null or s.season_id=person_season_memberships.season_id::text)));

revoke all on public.account_rls_package_state,public.account_import_batches,public.account_import_outcomes from public,anon,authenticated;
revoke all on function public.vam062_current_admin_id(),public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb),public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text),public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid),public.vam062_record_reconciliation(uuid,uuid,integer,text) from public,anon,authenticated;
grant all on public.account_rls_package_state,public.account_import_batches,public.account_import_outcomes to service_role;
grant execute on function public.vam062_current_admin_id(),public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb),public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text),public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid),public.vam062_record_reconciliation(uuid,uuid,integer,text) to service_role;
commit;
