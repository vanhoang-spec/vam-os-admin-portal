-- =============================================================================
-- ROLLBACK R3 — undo T3. Drops the eleven release functions and restores the
-- 7-value migration-052 transition vocabulary.
--
-- RUN R4 FIRST. R3 refuses while execution is still granted.
--
-- R3 REFUSES ONCE LIFECYCLE HISTORY EXISTS.
--   The moment a real transition is recorded, person_season_membership_log
--   contains a transition_type the 7-value baseline does not admit. Restoring
--   that constraint would either fail on the scan or, worse, require deleting
--   audit history to succeed. History is never deleted to make a rollback fit.
--   If this refuses: you are past the point of rolling back. Use R4 (stop
--   lifecycle, keep history) and roll FORWARD. See RECOVERY.md, branch 3.
-- =============================================================================
begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';

do $r3_guard$
declare
  v_n     integer;
  v_bad   text;
  v_new   constant text[] := array['pause','withdraw','opt_out','cancel','reactivate','role_removed'];
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
    raise exception 'R3 REFUSED [T4_STILL_ACTIVE]: run R4 first.';
  end if;

  select string_agg(t.transition_type || '=' || t.n::text, ', ' order by t.transition_type) into v_bad
  from (select transition_type, count(*) n
          from public.person_season_membership_log
         where transition_type = any (v_new)
         group by transition_type) t;
  if v_bad is not null then
    raise exception 'R3 REFUSED [HISTORY_EXISTS]: person_season_membership_log already records lifecycle transitions (%). Restoring the 7-value vocabulary would require deleting audit history. Use R4 and roll forward — see RECOVERY.md branch 3.', v_bad;
  end if;

  -- Any membership row created by the add-role path is real operational data,
  -- not package state, and R3 must not orphan it behind a dropped RPC.
  select count(*) into v_n from public.person_season_memberships where source = 'manual';
  if v_n <> 0 then
    raise exception 'R3 REFUSED [MEMBERSHIPS_EXIST]: % membership row(s) with source=manual exist. Dropping the lifecycle functions would leave them with no supported transition path.', v_n;
  end if;
end
$r3_guard$;

drop function if exists public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text);
drop function if exists public.vam063_remove_membership_role(uuid,uuid,text);
drop function if exists public.vam063_reactivate_membership(uuid,uuid,text);
drop function if exists public.vam063_cancel_membership(uuid,uuid,text);
drop function if exists public.vam063_opt_out_membership(uuid,uuid,text);
drop function if exists public.vam063_withdraw_membership(uuid,uuid,text);
drop function if exists public.vam063_pause_membership(uuid,uuid,text);
drop function if exists public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean);
drop function if exists public.vam063_authorized_for_scope(uuid,uuid,uuid);
drop function if exists public.vam069_trusted_context_probe();
drop function if exists public.vam063_trusted_api_role();

alter table public.person_season_membership_log
  drop constraint person_season_membership_log_transition_type_check;

alter table public.person_season_membership_log
  add constraint person_season_membership_log_transition_type_check
  check (transition_type = any (array[
    'created'::text,'status_change'::text,'role_change'::text,
    'rollover'::text,'backfill'::text,'manual'::text,'system'::text
  ]));

do $r3_post$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname like 'vam063\_%' or p.proname like 'vam069\_%');
  if v_n <> 0 then raise exception 'R3 FAILED: % release functions remain', v_n; end if;

  select count(distinct m[1]) into v_n
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text','g') m
  where c.conrelid='public.person_season_membership_log'::regclass
    and c.conname='person_season_membership_log_transition_type_check';
  if v_n <> 7 then raise exception 'R3 FAILED: transition vocabulary has % values, expected 7', v_n; end if;
end
$r3_post$;

notify pgrst, 'reload schema';
commit;
