-- VAM063_V1 — review-only membership lifecycle operations package.
-- Implements DEC-06/DEC-07: pause, withdraw, opt out, cancel, reactivate,
-- add role, remove role for public.person_season_memberships. Depends on
-- migration 062 V3 having already been applied (admin_scope_access's
-- corrected arbiter, the hardened RLS/grants on person_season_memberships,
-- and the expanded admin_audit_log action_type vocabulary this package's
-- own writes require). Review-only: not applied by this task.
begin;

do $$
begin
  if to_regclass('public.person_season_memberships') is null or to_regclass('public.person_season_membership_log') is null or to_regclass('public.admin_scope_access') is null or to_regclass('public.admin_audit_log') is null then
    raise exception 'VAM063 prerequisite tables missing';
  end if;
  if to_regprocedure('public.current_admin_role()') is null then
    raise exception 'VAM063 admin helper missing';
  end if;
  if to_regprocedure('public.vam062_current_admin_id()') is null then
    raise exception 'VAM063 requires migration 062 V3 to already be applied (vam062_current_admin_id missing)';
  end if;

  -- migration 062 V3's corrected admin_scope_access arbiter must be in
  -- place: this package's authorization logic depends on admin_scope_access
  -- rows correctly identifying one program + one season + role, with no
  -- nullable/sentinel scope (DEC-01/DEC-02).
  if not exists(
    select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='admin_scope_access'
      and i.indisunique and i.indisvalid and i.indisready and not i.indisnullsnotdistinct and i.indnkeyatts=4
      and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'
      and i.indexprs is not null and pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
  ) then raise exception 'VAM063 requires migration 062 V3''s corrected admin_scope_access arbiter'; end if;

  -- RLS must already be enabled on person_season_memberships (062 V3's job,
  -- not this package's) — this package only adds write-path functions, it
  -- does not itself touch RLS/grants on any pre-existing table.
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='person_season_memberships' and c.relrowsecurity) then
    raise exception 'VAM063 requires person_season_memberships RLS to already be enabled by migration 062 V3';
  end if;

  -- Every action_type this package writes must already be permitted —
  -- migration 062 V3 is responsible for expanding the vocabulary; this
  -- package only ever needs to check it, never alter it again.
  if exists(
    select x from unnest(array['create_membership','add_membership_role','remove_membership_role','pause_membership','withdraw_membership','opt_out_membership','cancel_membership','reactivate_membership']) x
    where not exists(select 1 from pg_constraint c where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and pg_get_constraintdef(c.oid) like '%'||x||'%')
  ) then raise exception 'VAM063 admin_audit_log action_type vocabulary missing required lifecycle values'; end if;

  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%') then
    raise exception 'VAM063 package function name collision';
  end if;
end $$;

-- Shared authorization check: super_admin, or an active admin_scope_access
-- row for the exact program+season with an operations-capable role. Not a
-- table — a helper function, so every vam063_* entry point applies the
-- identical rule (DEC-07: "actor authorization and scope verification").
create function public.vam063_authorized_for_scope(p_actor_admin_user_id uuid,p_program_id uuid,p_season_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.admin_users a
    where a.id=p_actor_admin_user_id and a.status='active' and (
      a.role='super_admin'
      or exists(
        select 1 from public.admin_scope_access s
        where s.user_id=a.auth_user_id and s.status='active' and s.role in ('full_access','operations')
          and s.program_id=p_program_id::text and s.season_id=p_season_id::text
      )
    )
  )
$$;

-- Single internal transition core. Every public vam063_* lifecycle function
-- below is a thin, status-specific wrapper around this: it is the only
-- place that writes person_season_memberships, person_season_membership_log
-- and the corresponding admin_audit_log row, so every transition gets
-- identical authorization, idempotency, history-preservation and audit
-- behavior. Never issues a DELETE (DEC-08).
create function public.vam063_transition_membership_atomic(
  p_actor_admin_user_id uuid,
  p_membership_id uuid,
  p_allowed_from_statuses text[],
  p_to_status text,
  p_transition_type text,
  p_action_type text,
  p_reason text,
  p_reason_required boolean
) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language plpgsql security definer set search_path=public as $$
declare
  v_person_id uuid; v_program_id uuid; v_season_id uuid; v_role text; v_old_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'VAM063 trusted server context required';
  end if;
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and status='active') then
    raise exception 'VAM063 unauthorized actor';
  end if;
  if p_reason_required and nullif(btrim(p_reason),'') is null then
    raise exception 'VAM063 reason required for this transition';
  end if;

  select person_id,program_id,season_id,role,status into v_person_id,v_program_id,v_season_id,v_role,v_old_status
  from public.person_season_memberships where id=p_membership_id for update;
  if v_person_id is null then
    raise exception 'VAM063 membership not found';
  end if;

  if not public.vam063_authorized_for_scope(p_actor_admin_user_id,v_program_id,v_season_id) then
    raise exception 'VAM063 actor not authorized for this program-season scope';
  end if;

  -- Idempotent repeated requests: already in the target state is a no-op,
  -- not an error, and writes no duplicate log/audit row.
  if v_old_status=p_to_status then
    return query select 'noop'::text,p_membership_id,v_old_status,v_old_status;
    return;
  end if;

  if not (v_old_status=any(p_allowed_from_statuses)) then
    raise exception 'VAM063 invalid status transition: % -> %',v_old_status,p_to_status;
  end if;

  update public.person_season_memberships set status=p_to_status, updated_at=now() where id=p_membership_id;

  insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
    values(p_membership_id,v_person_id,v_program_id,v_season_id,v_role,v_old_status,p_to_status,p_transition_type,p_reason,p_actor_admin_user_id);

  insert into public.admin_audit_log(actor_admin_user_id,action_type,before_data,after_data)
    values(p_actor_admin_user_id,p_action_type,jsonb_build_object('membership_id',p_membership_id,'status',v_old_status),jsonb_build_object('membership_id',p_membership_id,'status',p_to_status,'role',v_role,'program_id',v_program_id,'season_id',v_season_id,'reason',p_reason));

  return query select 'transitioned'::text,p_membership_id,v_old_status,p_to_status;
end $$;

create function public.vam063_pause_membership(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['active'],'paused','pause','pause_membership',p_reason,false)
$$;

create function public.vam063_withdraw_membership(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['active','paused','invited'],'withdrawn','withdraw','withdraw_membership',p_reason,false)
$$;

create function public.vam063_opt_out_membership(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['active','paused','invited'],'opted_out','opt_out','opt_out_membership',p_reason,false)
$$;

-- Administrative cancellation. DEC-07 requires a reason for administrative
-- removal/cancellation.
create function public.vam063_cancel_membership(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['active','paused','withdrawn','opted_out','invited'],'cancelled','cancel','cancel_membership',p_reason,true)
$$;

create function public.vam063_reactivate_membership(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['paused','withdrawn','opted_out','cancelled'],'active','reactivate','reactivate_membership',p_reason,false)
$$;

-- Add role: creates a NEW membership row for the additional role, status
-- active, and never touches the person's other active roles (DEC-07,
-- multi-role preservation). Cross-program isolation matches
-- vam062_import_participant_membership_atomic's existing guard.
create function public.vam063_add_membership_role(p_actor_admin_user_id uuid,p_person_id uuid,p_program_id uuid,p_season_id uuid,p_role text,p_reason text) returns table(outcome_status text,membership_id uuid) language plpgsql security definer set search_path=public as $$
declare v_membership uuid; v_existing boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'VAM063 trusted server context required';
  end if;
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and status='active') then
    raise exception 'VAM063 unauthorized actor';
  end if;
  if not public.vam063_authorized_for_scope(p_actor_admin_user_id,p_program_id,p_season_id) then
    raise exception 'VAM063 actor not authorized for this program-season scope';
  end if;
  if not exists(select 1 from public.programs p join public.seasons s on s.program_id=p.id where p.id=p_program_id and p.is_active and s.id=p_season_id) then
    raise exception 'VAM063 invalid active program-season relationship';
  end if;
  if p_role not in ('mentor','mentee') then
    raise exception 'VAM063 unsupported participant role';
  end if;
  if exists(select 1 from public.person_season_memberships where person_id=p_person_id and program_id<>p_program_id and season_id=p_season_id) then
    raise exception 'VAM063 cross-program reassignment denied';
  end if;

  select exists(select 1 from public.person_season_memberships where person_id=p_person_id and season_id=p_season_id and role=p_role) into v_existing;
  if v_existing then
    select id into v_membership from public.person_season_memberships where person_id=p_person_id and season_id=p_season_id and role=p_role;
    return query select 'noop'::text,v_membership;
    return;
  end if;

  insert into public.person_season_memberships(person_id,program_id,season_id,role,status,source,created_by)
    values(p_person_id,p_program_id,p_season_id,p_role,'active','manual',p_actor_admin_user_id)
    returning id into v_membership;

  insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
    values(v_membership,p_person_id,p_program_id,p_season_id,p_role,null,'active','created',p_reason,p_actor_admin_user_id);
  insert into public.admin_audit_log(actor_admin_user_id,action_type,before_data,after_data)
    values(p_actor_admin_user_id,'add_membership_role',null,jsonb_build_object('membership_id',v_membership,'person_id',p_person_id,'program_id',p_program_id,'season_id',p_season_id,'role',p_role));

  return query select 'created'::text,v_membership;
end $$;

-- Remove role: never deletes the row — transitions that one role's
-- membership to cancelled, leaving every other role's membership row for
-- the same person+season untouched (DEC-07).
create function public.vam063_remove_membership_role(p_actor_admin_user_id uuid,p_membership_id uuid,p_reason text) returns table(outcome_status text,membership_id uuid,old_status text,new_status text) language sql security definer set search_path=public as $$
  select * from public.vam063_transition_membership_atomic(p_actor_admin_user_id,p_membership_id,array['active','paused','invited'],'cancelled','role_removed','remove_membership_role',p_reason,true)
$$;

revoke all on function public.vam063_authorized_for_scope(uuid,uuid,uuid),public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean),public.vam063_pause_membership(uuid,uuid,text),public.vam063_withdraw_membership(uuid,uuid,text),public.vam063_opt_out_membership(uuid,uuid,text),public.vam063_cancel_membership(uuid,uuid,text),public.vam063_reactivate_membership(uuid,uuid,text),public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text),public.vam063_remove_membership_role(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.vam063_pause_membership(uuid,uuid,text),public.vam063_withdraw_membership(uuid,uuid,text),public.vam063_opt_out_membership(uuid,uuid,text),public.vam063_cancel_membership(uuid,uuid,text),public.vam063_reactivate_membership(uuid,uuid,text),public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text),public.vam063_remove_membership_role(uuid,uuid,text) to service_role;
-- vam063_authorized_for_scope and vam063_transition_membership_atomic are
-- internal helpers, never called directly by the application layer; only
-- service_role reaches them, and only indirectly through the seven entry
-- points above, which is why they get no direct EXECUTE grant even to
-- service_role beyond what calling the wrapper functions already requires
-- (SECURITY DEFINER functions do not need EXECUTE on the functions they
-- call internally).

commit;
