-- VAM063_V1 deterministic rollback. Schema authentication only; never reads business rows.
-- This package creates no tables and touches no RLS/grants on any
-- pre-existing table — it only adds nine functions — so rollback is just a
-- guarded drop of exactly those nine, in dependent-then-core order. It never
-- touches person_season_memberships, person_season_membership_log,
-- admin_audit_log, or any row they contain: no membership, log entry, or
-- audit record written by this package's functions is ever deleted by
-- rolling the package back.
begin;
do $$
declare
  v_expected text[] := array[
    'vam063_authorized_for_scope(uuid,uuid,uuid)',
    'vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)',
    'vam063_pause_membership(uuid,uuid,text)',
    'vam063_withdraw_membership(uuid,uuid,text)',
    'vam063_opt_out_membership(uuid,uuid,text)',
    'vam063_cancel_membership(uuid,uuid,text)',
    'vam063_reactivate_membership(uuid,uuid,text)',
    'vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'vam063_remove_membership_role(uuid,uuid,text)'
  ];
  v_actual_count integer;
begin
  select count(*) into v_actual_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%';
  if v_actual_count<>array_length(v_expected,1) then
    raise exception 'VAM063 unexpected function set: found % functions, expected %',v_actual_count,array_length(v_expected,1);
  end if;
  if exists(select 1 from unnest(v_expected) sig where to_regprocedure('public.'||sig) is null) then
    raise exception 'VAM063 one or more expected functions missing — refusing to drop a partial/unknown package state';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'vam063_%'
      and (p.prosecdef is false or pg_get_userbyid(p.proowner)<>current_user or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))
  ) then raise exception 'VAM063 function ownership or privilege drift — refusing to drop'; end if;
end $$;

drop function public.vam063_remove_membership_role(uuid,uuid,text);
drop function public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text);
drop function public.vam063_reactivate_membership(uuid,uuid,text);
drop function public.vam063_cancel_membership(uuid,uuid,text);
drop function public.vam063_opt_out_membership(uuid,uuid,text);
drop function public.vam063_withdraw_membership(uuid,uuid,text);
drop function public.vam063_pause_membership(uuid,uuid,text);
drop function public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean);
drop function public.vam063_authorized_for_scope(uuid,uuid,uuid);

do $$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%') then raise exception 'VAM063 rollback incomplete'; end if; end $$;
commit;
-- Residual limitation: memberships, membership_log entries, and audit_log
-- entries created by this package's functions before rollback are
-- intentionally preserved — rollback removes the operations, never the
-- history they already wrote (DEC-08, no hard delete extends to rollback
-- itself).
