-- =============================================================================
-- ROLLBACK R1 — undo T1. Drops the canonical 52-value action_type CHECK and
-- returns admin_audit_log to having no action_type vocabulary at all, which is
-- the exact Probe A baseline.
--
-- R1 REFUSES ONCE AUDIT HISTORY EXISTS.
--   Dropping the constraint cannot corrupt existing rows, but a release that
--   has already written audited approvals is a release you are rolling back
--   for a reason that the constraint is very unlikely to be. Refusing forces
--   that to be a conscious decision rather than a reflex. To override, read
--   RECOVERY.md branch 1 and re-run with the override line uncommented.
--
-- THE LEGACY NOT NULL DROPS ARE NOT REVERSED.
--   T1 section 1 may have dropped NOT NULL on legacy columns (action,
--   actor_email, target_email, metadata) that no runtime writer sets.
--   Restoring NOT NULL would re-break every future audit INSERT, so R1 leaves
--   them nullable by design. The statements are given below, commented out,
--   for the case where a reviewer decides the original nullability must be
--   restored exactly — check the preflight's audit_column_seal first to see
--   which columns were actually changed.
-- =============================================================================
begin;
set local statement_timeout = '60s';
set local lock_timeout      = '10s';

do $r1$
declare
  v_rows bigint;
  v_override boolean := coalesce(nullif(current_setting('vam.r1_override_audit_rows', true), ''), 'false')::boolean;
begin
  if to_regclass('public.vam_prod_s12_release_gate') is not null then
    raise exception 'R1 REFUSED [T4_STILL_ACTIVE]: run R4, R3 and R2 first.';
  end if;
  -- Enforce the documented R4 -> R3 -> R2 -> R1 order. Without this, R1 will
  -- happily run while T2 is still applied, leaving a half-reversed release
  -- whose preflight cannot pass again.
  if to_regclass('public.vam_prod_s12_release_state') is not null then
    raise exception 'R1 REFUSED [T2_STILL_APPLIED]: run R2 first — the rollback order is R4, R3, R2, R1.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam063\_%') then
    raise exception 'R1 REFUSED [T3_STILL_APPLIED]: run R3 first — the lifecycle functions write action_type values this constraint governs.';
  end if;

  select count(*) into v_rows from public.admin_audit_log;
  if v_rows <> 0 and not v_override then
    raise exception 'R1 REFUSED [AUDIT_HISTORY]: % audit row(s) exist. Dropping the vocabulary would leave Production writing unvalidated action_type values again. To proceed deliberately: select set_config(''vam.r1_override_audit_rows'',''true'',false); then re-run.', v_rows;
  end if;
end
$r1$;

alter table public.admin_audit_log
  drop constraint admin_audit_log_action_type_check;

-- Restore original legacy-column nullability ONLY if a reviewer requires it.
-- alter table public.admin_audit_log alter column action       set not null;
-- alter table public.admin_audit_log alter column actor_email  set not null;
-- alter table public.admin_audit_log alter column target_email set not null;
-- alter table public.admin_audit_log alter column metadata     set not null;

do $r1_post$
begin
  if exists (select 1 from pg_constraint
              where conrelid='public.admin_audit_log'::regclass
                and conname='admin_audit_log_action_type_check') then
    raise exception 'R1 FAILED: the constraint still exists';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='admin_audit_log') <> 13 then
    raise exception 'R1 FAILED: admin_audit_log no longer has its 13 columns';
  end if;
end
$r1_post$;

notify pgrst, 'reload schema';
commit;
