-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — IMMUTABLE PREFLIGHT
--
-- Target      : PRODUCTION Supabase project vam-os-mvp (ref qkkroesfiazsejkzflcd)
-- Execution   : OWNER-RUN in the Supabase SQL Editor. No agent connection.
-- Read-only   : YES. REPEATABLE READ READ ONLY transaction, always ROLLBACK.
--               Any accidental DML raises 25006 instead of writing.
-- PII         : none. Counts, catalog metadata and business codes only.
--
-- PURPOSE
--   Prove that live Production is EXACTLY the baseline this release package was
--   designed against — the baseline captured by owner-run Probe A / Probe A2 /
--   Probe B on 2026-08-09 — and REFUSE on any drift. There is no migration
--   ledger on Production (Probe A2: ERROR 42P01, supabase_migrations.
--   schema_migrations does not exist) and this preflight deliberately does not
--   look for one. Live object state is the only authority.
--
-- EXIT CONTRACT
--   * any RAISE EXCEPTION -> STOP. Do not run any apply transaction.
--                            The bracketed code names the failed assertion.
--   * final SELECT        -> copy token + seals verbatim into verifier.sql and
--                            rollback/*.sql before applying anything.
--
-- This file is IMMUTABLE. If Production drifts, do not edit the preflight to
-- accommodate it — re-run Probe A/B, and re-derive the package.
-- =============================================================================

begin isolation level repeatable read read only;
set local statement_timeout = '180s';
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';

do $prod_s12$
declare
  v_txt        text;
  v_n          integer;
  v_b          bigint;
  v_cols       text[];
  v_owner      text;
  v_me         text := current_user;

  -- Day-1 relation set, exactly the 13 relations Probe A inventoried.
  v_day1 constant text[] := array[
    'applications','people','mentor_profiles','mentee_profiles',
    'application_decisions','admin_audit_log',
    'person_season_memberships','person_season_membership_log',
    'admin_users','admin_scope_access','intake_batches','seasons','programs'
  ];

  -- Probe A live RLS baseline. Any deviation means the security section of
  -- this release is reasoning about a database that no longer exists.
  v_rls_on constant text[] := array[
    'admin_audit_log','application_decisions','programs','seasons','admin_scope_access'
  ];
  v_rls_off constant text[] := array[
    'admin_users','applications','people','mentor_profiles','mentee_profiles',
    'intake_batches','person_season_memberships','person_season_membership_log'
  ];

  -- The exact 13 columns Probe A reported on Production admin_audit_log:
  -- the 9 canonical columns from migrations 024/026 plus four legacy columns
  -- that no repository migration creates. All 13 are PRESERVED by this release.
  v_audit_cols constant text[] := array[
    'action','action_type','actor_admin_user_id','actor_email','after_data',
    'before_data','created_at','details','id','metadata','target_admin_user_id',
    'target_email','updated_at'
  ];

  -- The four legacy Production-only columns. This release never drops them.
  v_legacy constant text[] := array['action','actor_email','target_email','metadata'];

  -- Production person_season_membership_log transition vocabulary as reported
  -- by Probe A — the untouched migration-052 baseline.
  v_tt_base constant text[] := array[
    'backfill','created','manual','role_change','rollover','status_change','system'
  ];

  -- Membership status values the lifecycle functions transition between.
  v_ms_need constant text[] := array[
    'active','invited','paused','withdrawn','opted_out','cancelled'
  ];
begin
  -- ══════════════════════════════════════════════════════════════════════════
  -- 0. TARGET IDENTITY — refuse to run anywhere that is not this Production
  -- ══════════════════════════════════════════════════════════════════════════
  -- There is no in-database project-ref oracle, so identity is asserted from
  -- structural facts that separate Production from Staging beyond doubt.

  -- Staging carries the VAM062 V3 package. Production does not, and this
  -- release deliberately does not install it (see README section 3).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: vam062_* functions exist. This is Staging, or Production has changed. This package must never run against Staging.';
  end if;
  if to_regclass('public.account_rls_package_state') is not null
     or to_regclass('public.account_rls_package_manifest') is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: VAM062 package state tables exist. This is Staging.';
  end if;

  -- Probe A2 fact: Production has no migration ledger. Its sudden appearance
  -- means the target is not the database this package was derived from.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: a migration ledger exists. Probe A2 proved Production has none (42P01). Re-run Probe A/A2 and re-derive.';
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. RELATION PRESENCE, KIND AND OWNERSHIP
  -- ══════════════════════════════════════════════════════════════════════════
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_day1) x where to_regclass('public.' || x) is null;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [REL_MISSING]: %', v_txt;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (v_day1) and c.relkind <> 'r';
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [REL_NOT_TABLE]: %', v_txt;
  end if;

  -- Every ALTER TABLE / CREATE FUNCTION in this release requires ownership.
  -- Running the preflight as anyone else proves nothing about the apply.
  select string_agg(c.relname || '(owner=' || pg_get_userbyid(c.relowner) || ')', ', ' order by c.relname)
    into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (v_day1)
    and pg_get_userbyid(c.relowner) <> v_me;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [OWNER_MISMATCH]: current_user=% cannot ALTER: %', v_me, v_txt;
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. AUDIT BASELINE (Phase 4) — 13 columns, zero rows, no action_type CHECK
  -- ══════════════════════════════════════════════════════════════════════════
  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';

  if v_cols is distinct from v_audit_cols then
    raise exception 'PROD S12 PREFLIGHT REFUSED [AUDIT_COLUMNS]: expected exactly the 13 Probe A columns %, found %', v_audit_cols, v_cols;
  end if;

  -- action_type is NOT NULL (migration 026) and every runtime writer supplies
  -- it. The 52-value CHECK installed by T1 is meaningless if this drifted.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='admin_audit_log'
                and column_name='action_type' and is_nullable <> 'NO') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [AUDIT_ACTION_TYPE_NULLABLE]: action_type must be NOT NULL (migration 026 contract).';
  end if;

  -- Probe A: no canonical action_type CHECK exists. T1 ADDs one; it never
  -- replaces one. If a CHECK appeared since Probe A, stop and re-derive.
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.admin_audit_log'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%action_type%') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [AUDIT_CHECK_PRESENT]: an action_type CHECK already exists. Probe A showed none. T1 only ever ADDs.';
  end if;

  -- Probe B: audit_rows_total = 0. Zero rows is what makes the new CHECK
  -- safely VALIDATED and makes historical backfill unnecessary (Phase 4).
  select count(*) into v_b from public.admin_audit_log;
  if v_b <> 0 then
    raise exception 'PROD S12 PREFLIGHT REFUSED [AUDIT_ROWS]: expected 0 rows (Probe B), found %. A VALIDATED 52-value CHECK is only provably safe at zero rows; re-run Probe B and re-derive.', v_b;
  end if;

  -- The four legacy columns must still exist (this release preserves them) and
  -- must not be able to block an INSERT that omits them. T1 repairs a NOT NULL
  -- legacy column without a default; anything else here is unexpected drift.
  select string_agg(a.attname, ', ' order by a.attname) into v_txt
  from pg_attribute a
  where a.attrelid = 'public.admin_audit_log'::regclass
    and a.attname = any (v_legacy) and a.attnum > 0 and not a.attisdropped
    and a.attnotnull and a.atthasdef is false and a.attidentity = '' and a.attgenerated = '';
  if v_txt is not null then
    raise notice 'PROD S12 PREFLIGHT NOTICE [AUDIT_LEGACY_NOT_NULL]: legacy column(s) % are NOT NULL without a default. T1 section 1 will DROP NOT NULL on exactly these; the app never writes them. This is expected-and-handled, not a refusal.', v_txt;
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. PROFILE CONTRACTS (Phase 1) — proves M066 and M067 are NOT REQUIRED
  -- ══════════════════════════════════════════════════════════════════════════
  -- These are ASSERTIONS, not changes. If they hold, the M066/M067 packages
  -- stay out of this release entirely. If they fail, this release is wrong.
  foreach v_txt in array array['mentor_profiles','mentee_profiles'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_txt and column_name='source_application_id') then
      raise exception 'PROD S12 PREFLIGHT REFUSED [PROFILE_SOURCE_APP_MISSING]: %.source_application_id absent. Probe A showed it present; M066 was classified NOT REQUIRED on that evidence.', v_txt;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_txt and column_name='intake_batch_id') then
      raise exception 'PROD S12 PREFLIGHT REFUSED [PROFILE_INTAKE_BATCH_MISSING]: %.intake_batch_id absent.', v_txt;
    end if;

    -- Probe A: person_id FK already canonical — CASCADE / NO ACTION /
    -- DEFERRABLE INITIALLY DEFERRED / VALID. This is the whole of M067.
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = ('public.' || v_txt)::regclass and k.contype = 'f'
        and k.confrelid = 'public.people'::regclass
        and k.confdeltype = 'c' and k.confupdtype = 'a'
        and k.condeferrable and k.condeferred and k.convalidated
        and (select a.attname from pg_attribute a where a.attrelid = k.conrelid and a.attnum = k.conkey[1]) = 'person_id'
    ) then
      raise exception 'PROD S12 PREFLIGHT REFUSED [PROFILE_PERSON_FK_DRIFT]: %.person_id FK is not the canonical CASCADE / NO ACTION / DEFERRABLE INITIALLY DEFERRED / VALID shape Probe A reported. M067 was classified NOT REQUIRED on that evidence.', v_txt;
    end if;
  end loop;

  -- Probe B: zero orphans on both sides. Re-asserted because the release
  -- creates profiles on approval and must not start from a broken graph.
  select count(*) into v_b from public.mentor_profiles m
    where m.person_id is not null and not exists (select 1 from public.people p where p.id = m.person_id);
  if v_b <> 0 then raise exception 'PROD S12 PREFLIGHT REFUSED [PROFILE_ORPHANS]: mentor_profiles person_id orphans = % (Probe B: 0)', v_b; end if;
  select count(*) into v_b from public.mentee_profiles m
    where m.person_id is not null and not exists (select 1 from public.people p where p.id = m.person_id);
  if v_b <> 0 then raise exception 'PROD S12 PREFLIGHT REFUSED [PROFILE_ORPHANS]: mentee_profiles person_id orphans = % (Probe B: 0)', v_b; end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 4. MEMBERSHIP LIFECYCLE BASELINE (Phase 3)
  -- ══════════════════════════════════════════════════════════════════════════
  -- Probe B: both membership tables are empty. T3's functions are therefore
  -- installed against a clean slate and T2's RLS enable cannot hide rows.
  select count(*) into v_b from public.person_season_memberships;
  if v_b <> 0 then raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_ROWS]: person_season_memberships expected 0 (Probe B), found %', v_b; end if;
  select count(*) into v_b from public.person_season_membership_log;
  if v_b <> 0 then raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_LOG_ROWS]: person_season_membership_log expected 0 (Probe B), found %', v_b; end if;

  -- Exact columns the lifecycle functions read and write. Missing any one of
  -- them turns a lifecycle call into a runtime failure after launch.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array['id','person_id','program_id','season_id','role','status','source','created_by','updated_at']) x
  where not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='person_season_memberships' and column_name = x);
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_COLUMNS]: person_season_memberships missing %', v_txt;
  end if;

  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array['membership_id','person_id','program_id','season_id','role','old_status','new_status','transition_type','reason','changed_by']) x
  where not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='person_season_membership_log' and column_name = x);
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_LOG_COLUMNS]: person_season_membership_log missing %', v_txt;
  end if;

  -- The UNIQUE(person_id, season_id, role) arbiter is the database-level
  -- integrity backstop behind vam063p_add_membership_role's advisory lock.
  if not exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid = c.conindid
    where c.conrelid = 'public.person_season_memberships'::regclass and c.contype = 'u' and c.convalidated
      and pg_get_constraintdef(c.oid, true) = 'UNIQUE (person_id, season_id, role)'
      and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts = 3
      and i.indpred is null and i.indexprs is null and not i.indnullsnotdistinct
  ) then
    raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_UNIQUE]: UNIQUE (person_id, season_id, role) missing, partial, or invalid.';
  end if;

  -- Membership status vocabulary must admit every status the six wrappers
  -- transition to. Checked value-by-value against the live CHECK definition.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_ms_need) x
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.person_season_memberships'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
  );
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [MEMBERSHIP_STATUS_VOCAB]: person_season_memberships status CHECK does not admit: %', v_txt;
  end if;

  -- transition_type CHECK must be EXACTLY the 7-value migration-052 baseline
  -- Probe A reported. T3 replaces it with a 13-value superset; replacing an
  -- unknown constraint would silently discard someone else's change.
  select count(*) into v_n from pg_constraint c
  where c.conrelid = 'public.person_season_membership_log'::regclass and c.contype = 'c'
    and c.conname = 'person_season_membership_log_transition_type_check';
  if v_n <> 1 then
    raise exception 'PROD S12 PREFLIGHT REFUSED [TRANSITION_CHECK_ABSENT]: expected exactly 1 person_season_membership_log_transition_type_check, found %', v_n;
  end if;

  select array_agg(distinct m[1] order by m[1]) into v_cols
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
  where c.conrelid = 'public.person_season_membership_log'::regclass
    and c.conname = 'person_season_membership_log_transition_type_check';
  if v_cols is distinct from v_tt_base then
    raise exception 'PROD S12 PREFLIGHT REFUSED [TRANSITION_VOCAB_DRIFT]: expected the 7-value migration-052 baseline %, found %', v_tt_base, v_cols;
  end if;

  -- programs.is_active is read by the add-role guard (migration 053).
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='programs' and column_name='is_active') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [PROGRAMS_IS_ACTIVE]: programs.is_active absent; the add-role program guard cannot be installed.';
  end if;

  -- Probe A showed no VAM063 lifecycle RPC family. T3 CREATEs; it never
  -- replaces. A name collision means someone else installed a lifecycle path.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'vam063%' or p.proname like 'vam069%')) then
    raise exception 'PROD S12 PREFLIGHT REFUSED [LIFECYCLE_COLLISION]: vam063*/vam069* functions already exist. Probe A showed none.';
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 5. SECURITY BASELINE (Phase 2) — exact Probe A RLS state
  -- ══════════════════════════════════════════════════════════════════════════
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_rls_on) x
  join pg_class c on c.oid = to_regclass('public.' || x)
  where not c.relrowsecurity;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [RLS_BASELINE]: expected RLS ENABLED (Probe A) on: %', v_txt;
  end if;

  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_rls_off) x
  join pg_class c on c.oid = to_regclass('public.' || x)
  where c.relrowsecurity;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [RLS_BASELINE]: expected RLS DISABLED (Probe A) on: %. Someone has already enabled it; T2 would then be reasoning about the wrong baseline and its rollback would be wrong.', v_txt;
  end if;

  -- FORCE RLS is not part of any baseline and T2 never sets it. Its presence
  -- would mean the table owner is also subject to policies — a different world.
  select string_agg(c.relname, ', ' order by c.relname) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (v_day1) and c.relforcerowsecurity;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [RLS_FORCED]: FORCE ROW LEVEL SECURITY is set on: %', v_txt;
  end if;

  -- T2 revokes and re-grants at table level only. A column-level ACL would
  -- survive a table-level REVOKE and silently keep a column readable.
  select string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname) into v_txt
  from pg_attribute a
  join pg_class t on t.oid = a.attrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = any (v_day1)
    and a.attnum > 0 and not a.attisdropped and a.attacl is not null;
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [COLUMN_ACL]: column-level grants present on %. A table-level REVOKE would not remove them.', v_txt;
  end if;

  -- No policy may already exist on the 8 tables T2 hardens: T2 installs none,
  -- and an unknown pre-existing policy would become load-bearing the instant
  -- RLS is enabled.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname) into v_txt
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = any (v_rls_off);
  if v_txt is not null then
    raise exception 'PROD S12 PREFLIGHT REFUSED [UNEXPECTED_POLICY]: % already carry policies. T2 enables RLS with no policies by design (fail closed); review before proceeding.', v_txt;
  end if;

  -- The whole security remediation rests on service_role bypassing RLS,
  -- because every Day-1 write path in the RC runs through the service-role
  -- client. If service_role cannot bypass RLS, T2 breaks Day-1 instead of
  -- securing it.
  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'PROD S12 PREFLIGHT REFUSED [SERVICE_ROLE_BYPASSRLS]: service_role lacks BYPASSRLS. Enabling RLS would break every Day-1 server write path.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [ROLES_MISSING]: anon and/or authenticated role absent; T2 cannot express its grant contract.';
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 6. SEASON 12 SHAPE (Phase 5) — assertions only, this release seeds nothing
  -- ══════════════════════════════════════════════════════════════════════════
  if not exists (
    select 1 from public.seasons s join public.programs p on p.id = s.program_id
    where s.code = 'UEHM-S12' and p.code = 'UEHM'
  ) then
    raise exception 'PROD S12 PREFLIGHT REFUSED [SEASON_S12]: UEHM-S12 missing or not attached to program UEHM (Probe B showed both).';
  end if;
  if not exists (
    select 1 from public.intake_batches b join public.seasons s on s.id = b.season_id
    where b.code = 'UEHM-S12-B1' and s.code = 'UEHM-S12' and b.is_active
  ) then
    raise exception 'PROD S12 PREFLIGHT REFUSED [BATCH_S12_B1]: UEHM-S12-B1 missing, mis-parented, or not is_active (Probe B showed active and correctly parented).';
  end if;
  -- S11 must remain intact and distinct: UEHM/HAM + S11/S12 isolation is a
  -- Day-1 requirement, and this release must not disturb S11.
  if not exists (select 1 from public.seasons where code = 'UEHM-S11') then
    raise exception 'PROD S12 PREFLIGHT REFUSED [SEASON_S11]: UEHM-S11 absent; season isolation cannot be asserted.';
  end if;
  select count(*) into v_n from public.seasons where code in ('UEHM-S11','UEHM-S12');
  if v_n <> 2 then
    raise exception 'PROD S12 PREFLIGHT REFUSED [SEASON_COLLISION]: expected exactly 2 rows for UEHM-S11/UEHM-S12, found %', v_n;
  end if;

  -- Phase 5 decision A: the initial controlled S12 approval operator runs as
  -- super_admin. That branch is the ONLY authorization branch that can succeed
  -- on Production, because live admin_scope_access stores season/program CODES
  -- ('UEHM-S11', 'UEHM', ...) while the scope-row branch compares them against
  -- season/program UUIDs. At least one active super_admin must therefore exist.
  select count(*) into v_n from public.admin_users where role = 'super_admin' and status = 'active';
  if v_n < 1 then
    raise exception 'PROD S12 PREFLIGHT REFUSED [NO_SUPER_ADMIN]: no active super_admin. Decision A (no UEHM-S12 scope seed) requires exactly one controlled super_admin operator.';
  end if;
  if v_n > 1 then
    raise notice 'PROD S12 PREFLIGHT NOTICE [SUPER_ADMIN_COUNT]: % active super_admin users. Decision A asks for ONE controlled launch operator; confirm the roster before opening the forms.', v_n;
  end if;

  -- Corroborates the code-form finding above from live data rather than
  -- from the read of lib/program-scope.ts alone.
  if exists (
    select 1 from public.admin_scope_access s
    where s.season_id is not null
      and s.season_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise notice 'PROD S12 PREFLIGHT NOTICE [SCOPE_CODE_FORM]: admin_scope_access.season_id holds season CODES, not UUIDs. Confirms Phase 5 Decision A: a UEHM-S12 scope row would NOT satisfy the lifecycle scope branch. Do not seed one.';
  end if;

  raise notice 'PROD S12 PREFLIGHT PASSED. Record the token and seals from the final SELECT before applying anything.';
end
$prod_s12$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BASELINE TOKEN AND SEALS
-- Copy all five values verbatim into verifier.sql and rollback/*.sql.
-- ═══════════════════════════════════════════════════════════════════════════
select
  'PRODS12:'
  || (select count(*)::text from information_schema.columns
       where table_schema='public' and table_name='admin_audit_log')
  || ':' || (select count(*)::text from public.admin_audit_log)
  || ':' || (select count(*)::text from public.person_season_memberships)
  || ':' || (select count(*)::text from public.person_season_membership_log)
  || ':' || (select count(*)::text from public.applications)
  || ':' || (select count(*)::text from public.mentor_profiles)
  || ':' || (select count(*)::text from public.mentee_profiles)
  || ':' || (select count(*)::text from public.application_decisions)
  || ':NOCHECK:RLS5-8'
    as baseline_token,

  -- Seal 1: RLS + ownership + table ACL across the 13 Day-1 relations. T2 is
  -- the only thing in this release that may change it.
  md5(coalesce((
    select string_agg(c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
                      || '|' || pg_get_userbyid(c.relowner) || '|' || coalesce(c.relacl::text, '<null>'),
                      ';' order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('applications','people','mentor_profiles','mentee_profiles',
                        'application_decisions','admin_audit_log','person_season_memberships',
                        'person_season_membership_log','admin_users','admin_scope_access',
                        'intake_batches','seasons','programs')
  ), '<none>')) as security_seal,

  -- Seal 2: the full constraint set on the two tables this release constrains,
  -- excluding the two constraints it installs, so it stays comparable after.
  md5(coalesce((
    select string_agg(t.relname || '.' || k.conname || '=' || pg_get_constraintdef(k.oid)
                      || '/' || k.convalidated::text, ';' order by t.relname, k.conname)
    from pg_constraint k join pg_class t on t.oid = k.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('admin_audit_log','person_season_membership_log')
      and k.conname not in ('admin_audit_log_action_type_check',
                            'person_season_membership_log_transition_type_check')
  ), '<none>')) as constraint_seal,

  -- Seal 3: the exact admin_audit_log column contract, all 13 columns, so the
  -- verifier can prove nothing was dropped, renamed or retyped.
  md5(coalesce((
    select string_agg(column_name || '|' || data_type || '|' || is_nullable
                      || '|' || coalesce(column_default, '<null>'), ';' order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_audit_log'
  ), '<none>')) as audit_column_seal,

  current_database() as database,
  current_user      as run_as,
  now()             as captured_at;

rollback;
