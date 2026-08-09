-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — APPLY TRANSACTION 4 of 4
-- T4: enable lifecycle execution, AFTER Probe C has passed (Phase 3)
--
-- Target : PRODUCTION only. T1, T2 and T3 must have committed.
--
-- DO NOT RUN THIS UNTIL PROBE C HAS PASSED.
-- Probe C (PROBE_C_TRUSTED_CONTEXT_RUNBOOK.md) calls
-- public.vam069_trusted_context_probe() using the SAME key value Production
-- Vercel holds in SUPABASE_SERVICE_ROLE_KEY, and must return
-- is_trusted = true. Until it does, granting EXECUTE would enable a write path
-- whose first real use is also its first test.
--
-- HOW THIS TRANSACTION IS GATED
--   The database cannot observe an HTTP call, so the gate is an explicit,
--   recorded operator act: set vam.probe_c_claim_source to the claim_source
--   Probe C actually returned, in this session, before running the file.
--   A wrong or absent value aborts. The value is then stored, so the
--   verifier and any later forensic can see which resolution source was
--   load-bearing at launch.
--
--   Run this line FIRST, in the same SQL editor session, substituting the
--   claim_source Probe C returned ('legacy_guc' | 'claims_json' | 'set_role'):
--
--       select set_config('vam.probe_c_claim_source', 'claims_json', false);
--
-- No secret value is read, stored or logged by this transaction.
-- =============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

do $t4_gate$
declare
  v_src text;
  v_n   integer;
begin
  v_src := nullif(current_setting('vam.probe_c_claim_source', true), '');
  if v_src is null then
    raise exception 'T4 ABORTED [PROBE_C_NOT_RECORDED]: run Probe C first, then set_config(''vam.probe_c_claim_source'', ''<claim_source>'', false) in this session.';
  end if;
  if v_src not in ('legacy_guc','claims_json','set_role') then
    raise exception 'T4 ABORTED [PROBE_C_INVALID]: claim_source "%" is not one of legacy_guc / claims_json / set_role. Probe C did not pass.', v_src;
  end if;

  if to_regprocedure('public.vam069_trusted_context_probe()') is null then
    raise exception 'T4 ABORTED [T3_NOT_APPLIED]: the probe function does not exist.';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'vam063\_%' or p.proname like 'vam069\_%');
  if v_n <> 11 then
    raise exception 'T4 ABORTED [OBJECT_COUNT]: expected the 11 T3 functions, found %', v_n;
  end if;

  -- T2 must still be in force: enabling writes on a database whose PII tables
  -- were re-opened in the meantime is not a launch, it is an incident.
  select count(*) into v_n
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in ('applications','people','mentor_profiles','mentee_profiles','admin_users',
                         'intake_batches','person_season_memberships','person_season_membership_log',
                         'admin_audit_log','application_decisions')
    and g.grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then
    raise exception 'T4 ABORTED [T2_REGRESSED]: % anon/authenticated/PUBLIC grants have reappeared on Day-1 tables.', v_n;
  end if;
end
$t4_gate$;

-- ── Record the gate decision ────────────────────────────────────────────────
create table public.vam_prod_s12_release_gate (
  gate_name        text primary key,
  claim_source     text not null check (claim_source in ('legacy_guc','claims_json','set_role')),
  recorded_by      text not null,
  package_version  text not null check (package_version = 'VAM_PROD_S12_R1'),
  recorded_at      timestamptz not null default transaction_timestamp()
);
revoke all on public.vam_prod_s12_release_gate from public, anon, authenticated;

insert into public.vam_prod_s12_release_gate (gate_name, claim_source, recorded_by, package_version)
values ('probe_c_trusted_context', current_setting('vam.probe_c_claim_source'), current_user, 'VAM_PROD_S12_R1');

-- ── Grant execution on the seven entry points, and nothing else ─────────────
-- vam063_authorized_for_scope, vam063_transition_membership_atomic and
-- vam063_trusted_api_role stay ungranted: they are internal, and a
-- SECURITY DEFINER function does not need EXECUTE on what it calls internally.
grant execute on function
  public.vam063_pause_membership(uuid,uuid,text),
  public.vam063_withdraw_membership(uuid,uuid,text),
  public.vam063_opt_out_membership(uuid,uuid,text),
  public.vam063_cancel_membership(uuid,uuid,text),
  public.vam063_reactivate_membership(uuid,uuid,text),
  public.vam063_remove_membership_role(uuid,uuid,text),
  public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)
to service_role;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $t4_post$
declare
  v_txt text;
  v_entry constant text[] := array[
    'public.vam063_pause_membership(uuid,uuid,text)',
    'public.vam063_withdraw_membership(uuid,uuid,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)',
    'public.vam063_cancel_membership(uuid,uuid,text)',
    'public.vam063_reactivate_membership(uuid,uuid,text)',
    'public.vam063_remove_membership_role(uuid,uuid,text)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)'
  ];
  v_internal constant text[] := array[
    'public.vam063_authorized_for_scope(uuid,uuid,uuid)',
    'public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)',
    'public.vam063_trusted_api_role()'
  ];
begin
  select string_agg(x, ', ') into v_txt from unnest(v_entry) x
   where not has_function_privilege('service_role', x, 'execute');
  if v_txt is not null then
    raise exception 'T4 ABORTED [GRANT_INCOMPLETE]: service_role still cannot execute %', v_txt;
  end if;

  select string_agg(x, ', ') into v_txt from unnest(v_entry || v_internal) x
   where has_function_privilege('anon', x, 'execute') or has_function_privilege('authenticated', x, 'execute');
  if v_txt is not null then
    raise exception 'T4 ABORTED [API_ROLE_EXPOSED]: anon or authenticated can execute %', v_txt;
  end if;

  select string_agg(x, ', ') into v_txt from unnest(v_internal) x
   where has_function_privilege('service_role', x, 'execute');
  if v_txt is not null then
    raise exception 'T4 ABORTED [INTERNAL_GRANTED]: service_role was granted an internal helper: %', v_txt;
  end if;
end
$t4_post$;

notify pgrst, 'reload schema';

commit;
