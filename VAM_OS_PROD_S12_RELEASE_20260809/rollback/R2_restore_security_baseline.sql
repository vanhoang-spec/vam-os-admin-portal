-- =============================================================================
-- ROLLBACK R2 — undo T2. Restores the exact pre-release RLS flags and the exact
-- pre-release anon / authenticated / PUBLIC grants from the capture T2 took.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ READ THIS BEFORE RUNNING.                                                │
-- │ R2 RE-OPENS DIRECT ANONYMOUS ACCESS to Production PII: 902 applications,  │
-- │ 656 mentee profiles, 450 mentor profiles, the full people table and the   │
-- │ admin roster. That is not a neutral rollback — it is a deliberate return  │
-- │ to the P0 exposure this release exists to close.                          │
-- │                                                                          │
-- │ Do not run R2 to fix an application error. No Day-1 path uses the anon or │
-- │ authenticated role: every one of them goes through the service-role       │
-- │ client. If something broke after T2, the cause is almost certainly        │
-- │ SUPABASE_SERVICE_ROLE_KEY not reaching the server, and re-opening the     │
-- │ database to the public internet does not fix that — it only hides it.     │
-- │ See RECOVERY.md branch 2 before choosing this file.                       │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- RUN R4 AND R3 FIRST if T3/T4 were applied: the lifecycle functions depend on
-- person_season_memberships RLS being enabled.
-- =============================================================================
begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';

do $r2$
declare
  r        record;
  g        jsonb;
  v_priv   text;
  v_grantee text;
  v_n      integer;
  v_allowed constant text[] := array[
    'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
  ];
begin
  if to_regclass('public.vam_prod_s12_release_state') is null then
    raise exception 'R2 REFUSED [NO_CAPTURE]: public.vam_prod_s12_release_state does not exist. Without T2''s capture there is no authoritative record of the prior grants, and guessing them is not a rollback.';
  end if;

  select count(*) into v_n from public.vam_prod_s12_release_state;
  if v_n <> 10 then
    raise exception 'R2 REFUSED [CAPTURE_INCOMPLETE]: capture holds % of 10 tables', v_n;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname like 'vam063\_%') then
    raise exception 'R2 REFUSED [T3_STILL_APPLIED]: run R4 then R3 first — the lifecycle functions require person_season_memberships RLS to be enabled.';
  end if;

  for r in select * from public.vam_prod_s12_release_state order by table_name loop
    -- 1. RLS flag exactly as captured.
    if r.rls_was_enabled then
      execute format('alter table public.%I enable row level security', r.table_name);
    else
      execute format('alter table public.%I disable row level security', r.table_name);
    end if;
    if r.rls_was_forced then
      execute format('alter table public.%I force row level security', r.table_name);
    else
      execute format('alter table public.%I no force row level security', r.table_name);
    end if;

    -- 2. Every captured (grantee, privilege) triple, replayed verbatim.
    for g in select jsonb_array_elements(r.prior_grants) loop
      v_priv    := g ->> 'privilege_type';
      v_grantee := g ->> 'grantee';
      if not (v_priv = any (v_allowed)) then
        raise exception 'R2 ABORTED [UNKNOWN_PRIVILEGE]: % on %', v_priv, r.table_name;
      end if;
      if v_grantee not in ('anon','authenticated','PUBLIC') then
        raise exception 'R2 ABORTED [UNKNOWN_GRANTEE]: % on %', v_grantee, r.table_name;
      end if;
      execute format('grant %s on public.%I to %s%s',
                     v_priv,
                     r.table_name,
                     case when v_grantee = 'PUBLIC' then 'public' else quote_ident(v_grantee) end,
                     case when (g ->> 'is_grantable') = 'YES' then ' with grant option' else '' end);
    end loop;
  end loop;

  -- 3. Prove the restore matched the capture, table by table.
  select count(*) into v_n
  from public.vam_prod_s12_release_state s
  join pg_class c on c.oid = to_regclass('public.' || s.table_name)
  where c.relrowsecurity is distinct from s.rls_was_enabled
     or c.relforcerowsecurity is distinct from s.rls_was_forced;
  if v_n <> 0 then
    raise exception 'R2 FAILED [RLS_MISMATCH]: % table(s) did not return to their captured RLS state', v_n;
  end if;

  -- The lateral alias is deliberately NOT named g: a PL/pgSQL variable of the
  -- same name makes every reference to it ambiguous and aborts the rollback
  -- at its final verification step, which is the worst possible place.
  select count(*) into v_n
  from public.vam_prod_s12_release_state s
  cross join lateral jsonb_array_elements(s.prior_grants) as gr
  where not exists (
    select 1 from information_schema.role_table_grants t
    where t.table_schema='public' and t.table_name = s.table_name
      and t.grantee = (gr ->> 'grantee') and t.privilege_type = (gr ->> 'privilege_type')
  );
  if v_n <> 0 then
    raise exception 'R2 FAILED [GRANT_MISMATCH]: % captured grant(s) were not restored', v_n;
  end if;

  raise notice 'R2 COMPLETE. Production Day-1 PII is once again directly reachable by the anon role. Close this exposure again as soon as the blocking issue is resolved.';
end
$r2$;

drop table public.vam_prod_s12_release_state;

notify pgrst, 'reload schema';
commit;
