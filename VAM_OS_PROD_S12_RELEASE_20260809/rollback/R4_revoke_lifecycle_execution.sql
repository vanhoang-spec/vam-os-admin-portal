-- =============================================================================
-- ROLLBACK R4 — undo T4 only. Disables membership lifecycle; leaves everything
-- else (secured tables, audit vocabulary, applications, review, approval,
-- person/profile creation, decision/audit) fully operational.
--
-- This is the SAFE STOP. Prefer it to R3 whenever the problem is "lifecycle
-- misbehaves" rather than "lifecycle must not exist".
-- Reversible: re-run T4 after re-running Probe C.
-- =============================================================================
begin;
set local statement_timeout = '60s';
set local lock_timeout      = '10s';

revoke execute on function
  public.vam063_pause_membership(uuid,uuid,text),
  public.vam063_withdraw_membership(uuid,uuid,text),
  public.vam063_opt_out_membership(uuid,uuid,text),
  public.vam063_cancel_membership(uuid,uuid,text),
  public.vam063_reactivate_membership(uuid,uuid,text),
  public.vam063_remove_membership_role(uuid,uuid,text),
  public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)
from service_role;

drop table if exists public.vam_prod_s12_release_gate;

do $r4$
declare v_n integer;
begin
  select count(*) into v_n
  from unnest(array[
    'public.vam063_pause_membership(uuid,uuid,text)',
    'public.vam063_withdraw_membership(uuid,uuid,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)',
    'public.vam063_cancel_membership(uuid,uuid,text)',
    'public.vam063_reactivate_membership(uuid,uuid,text)',
    'public.vam063_remove_membership_role(uuid,uuid,text)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)']) f
  where has_function_privilege('service_role', to_regprocedure(f), 'execute');
  if v_n <> 0 then
    raise exception 'R4 FAILED: service_role can still execute % entry points', v_n;
  end if;
end
$r4$;

notify pgrst, 'reload schema';
commit;
