-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — FOCUSED TESTS
--
-- Scope     : the behaviour this release introduces, and nothing else.
-- Isolation : ONE transaction that ALWAYS ends in ROLLBACK. Nothing survives.
-- Prereq    : T1..T4 applied. Run after Probe C and T4.
-- Opt-in    : refuses unless you first run, in the same session,
--                 select set_config('vam.allow_tests','true',false);
--
-- WHERE TO RUN THIS
--   Primarily against the disposable Postgres reproduction described in
--   VALIDATION.md, which is where it was developed. It is safe by construction
--   on Production — every statement is inside a transaction that rolls back —
--   but it does take row locks, consume sequence values and write WAL, so
--   running it on Production is a deliberate choice, not a routine one. If you
--   do, run it BEFORE the public forms open.
--
-- It creates its fixtures from rows Production already has (the UEHM program,
-- the UEHM-S12 season, an existing active super_admin) plus one throwaway
-- person and one throwaway admin row, so it does not depend on guessing the
-- NOT NULL contract of tables this release never touches.
-- =============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

do $tests$
declare
  v_prog     uuid;
  v_season   uuid;
  v_season11 uuid;
  v_super    uuid;
  v_plain    uuid;
  v_person   uuid;
  v_m1       uuid;
  v_m2       uuid;
  v_out      text;
  v_n        integer;
  v_pass     integer := 0;
  v_msg      text;

  procedure_note text := 'assertions raise on failure; reaching the end is the pass';
begin
  if coalesce(nullif(current_setting('vam.allow_tests', true), ''), 'false') <> 'true' then
    raise exception 'TESTS REFUSED: run select set_config(''vam.allow_tests'',''true'',false); first, and read the header.';
  end if;

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  select p.id, s.id into v_prog, v_season
  from public.programs p join public.seasons s on s.program_id = p.id
  where p.code = 'UEHM' and s.code = 'UEHM-S12';
  if v_prog is null then raise exception 'TEST SETUP: UEHM / UEHM-S12 not found'; end if;

  select id into v_season11 from public.seasons where code = 'UEHM-S11';

  select id into v_super from public.admin_users
   where role = 'super_admin' and status = 'active' order by id limit 1;
  if v_super is null then raise exception 'TEST SETUP: no active super_admin'; end if;

  insert into public.admin_users (email, full_name, role, status)
  values ('vam-s12-test-nonsuper@example.invalid', 'S12 test non-super', 'admin', 'active')
  returning id into v_plain;

  insert into public.people (email_primary, full_name)
  values ('vam-s12-test-person@example.invalid', 'S12 test person')
  returning id into v_person;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group A — trusted server context (Phase 3)
  -- ══════════════════════════════════════════════════════════════════════════

  -- A1. Without any service_role context the guard denies. This is the owner
  --     session in the SQL editor: current_setting('role') is 'none'.
  begin
    perform public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'mentor', null);
    raise exception 'A1 FAILED: add_membership_role ran without a trusted context';
  exception when others then
    if sqlerrm not like '%trusted server context required%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- A2. The JSON-claims source (PostgREST v10+) satisfies the guard. This is
  --     the M064 remediation, proven rather than assumed.
  --     set_config(..., true) rather than SET LOCAL: it is the idiom PL/pgSQL
  --     accepts unconditionally for a dotted custom GUC.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select r.api_role || '/' || r.claim_source into v_out from public.vam063_trusted_api_role() r;
  if v_out <> 'service_role/claims_json' then
    raise exception 'A2 FAILED: expected service_role/claims_json, got %', v_out;
  end if;
  v_pass := v_pass + 1;

  -- A3. A non-service_role claim is rejected, so the resolver is a gate and
  --     not merely a reader.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  select coalesce(r.api_role,'<null>') into v_out from public.vam063_trusted_api_role() r;
  if v_out <> 'authenticated' then raise exception 'A3 FAILED: got %', v_out; end if;
  begin
    perform public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'mentor', null);
    raise exception 'A3 FAILED: an authenticated claim was accepted as trusted';
  exception when others then
    if sqlerrm not like '%trusted server context required%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- A4. The probe reports the same answer the guard uses — otherwise Probe C
  --     would be proving something other than what T4 gates on.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select (p.api_role || '/' || p.claim_source || '/' || p.is_trusted::text)
    into v_out from public.vam069_trusted_context_probe() p;
  if v_out <> 'service_role/claims_json/true' then
    raise exception 'A4 FAILED: probe reported %', v_out;
  end if;
  v_pass := v_pass + 1;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group B — authorization (Phase 5, Decision A)
  -- ══════════════════════════════════════════════════════════════════════════

  -- B1. An active non-super_admin with no matching scope row is denied.
  begin
    perform public.vam063_add_membership_role(v_plain, v_person, v_prog, v_season, 'mentor', null);
    raise exception 'B1 FAILED: a non-super_admin was authorized';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- B2. A CODE-form admin_scope_access row — which is what live Production
  --     actually stores — does NOT authorize. This is the evidence behind
  --     Decision A: seeding a UEHM-S12 scope row in the existing code form
  --     would not have worked.
  insert into public.admin_scope_access (user_id, program_id, season_id, role, status)
  values (coalesce((select auth_user_id from public.admin_users where id = v_plain),
                   gen_random_uuid()),
          'UEHM', 'UEHM-S12', 'operations', 'active');
  begin
    perform public.vam063_add_membership_role(v_plain, v_person, v_prog, v_season, 'mentor', null);
    raise exception 'B2 FAILED: a code-form scope row authorized a lifecycle write';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group C — add role, idempotency, isolation
  -- ══════════════════════════════════════════════════════════════════════════

  -- C1. super_admin creates the membership, the log row and the audit row.
  select a.outcome_status, a.membership_id into v_out, v_m1
  from public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'mentee', 'S12 approval') a;
  if v_out <> 'created' then raise exception 'C1 FAILED: outcome %', v_out; end if;
  if not exists (select 1 from public.person_season_memberships
                  where id = v_m1 and status = 'active' and role = 'mentee'
                    and season_id = v_season and program_id = v_prog and source = 'manual') then
    raise exception 'C1 FAILED: membership row wrong';
  end if;
  if not exists (select 1 from public.person_season_membership_log
                  where membership_id = v_m1 and transition_type = 'created'
                    and old_status is null and new_status = 'active') then
    raise exception 'C1 FAILED: log row wrong';
  end if;
  if not exists (select 1 from public.admin_audit_log
                  where action_type = 'add_membership_role' and actor_admin_user_id = v_super
                    and after_data ->> 'membership_id' = v_m1::text) then
    raise exception 'C1 FAILED: audit row missing — the 52-value vocabulary must admit add_membership_role';
  end if;
  v_pass := v_pass + 1;

  -- C2. Repeating it is a controlled no-op, not a unique_violation and not a
  --     duplicate log row.
  select a.outcome_status, a.membership_id into v_out, v_m2
  from public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'mentee', null) a;
  if v_out <> 'noop' or v_m2 <> v_m1 then raise exception 'C2 FAILED: outcome %', v_out; end if;
  select count(*) into v_n from public.person_season_membership_log where membership_id = v_m1;
  if v_n <> 1 then raise exception 'C2 FAILED: % log rows for one creation', v_n; end if;
  v_pass := v_pass + 1;

  -- C3. A second role for the same person+season is a separate membership and
  --     leaves the first untouched (multi-role preservation).
  select a.outcome_status, a.membership_id into v_out, v_m2
  from public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'mentor', null) a;
  if v_out <> 'created' or v_m2 = v_m1 then raise exception 'C3 FAILED: outcome %', v_out; end if;
  if (select status from public.person_season_memberships where id = v_m1) <> 'active' then
    raise exception 'C3 FAILED: adding a role disturbed the existing one';
  end if;
  v_pass := v_pass + 1;

  -- C4. An unsupported participant role is rejected.
  begin
    perform public.vam063_add_membership_role(v_super, v_person, v_prog, v_season, 'staff', null);
    raise exception 'C4 FAILED: role "staff" was accepted';
  exception when others then
    if sqlerrm not like '%unsupported participant role%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group D — transitions (this is what the M065 delta unblocks)
  -- ══════════════════════════════════════════════════════════════════════════

  -- D1. pause writes transition_type 'pause', which Production's untouched
  --     migration-052 vocabulary would have rejected with 23514.
  select t.outcome_status into v_out
  from public.vam063_pause_membership(v_super, v_m1, 'test pause') t;
  if v_out <> 'transitioned' then raise exception 'D1 FAILED: outcome %', v_out; end if;
  if not exists (select 1 from public.person_season_membership_log
                  where membership_id = v_m1 and transition_type = 'pause'
                    and old_status = 'active' and new_status = 'paused') then
    raise exception 'D1 FAILED: pause log row missing — the 13-value vocabulary is not in force';
  end if;
  if not exists (select 1 from public.admin_audit_log
                  where action_type = 'pause_membership' and after_data ->> 'membership_id' = v_m1::text) then
    raise exception 'D1 FAILED: pause audit row missing';
  end if;
  v_pass := v_pass + 1;

  -- D2. Pausing an already paused membership is a no-op with no extra rows.
  select count(*) into v_n from public.person_season_membership_log where membership_id = v_m1;
  select t.outcome_status into v_out from public.vam063_pause_membership(v_super, v_m1, null) t;
  if v_out <> 'noop' then raise exception 'D2 FAILED: outcome %', v_out; end if;
  if (select count(*) from public.person_season_membership_log where membership_id = v_m1) <> v_n then
    raise exception 'D2 FAILED: a no-op wrote a log row';
  end if;
  v_pass := v_pass + 1;

  -- D3. reactivate returns paused -> active. This is the exact cycle the
  --     staging UAT passed, and the one the P1 stale-lock UX note refers to.
  select t.outcome_status into v_out from public.vam063_reactivate_membership(v_super, v_m1, null) t;
  if v_out <> 'transitioned'
     or (select status from public.person_season_memberships where id = v_m1) <> 'active' then
    raise exception 'D3 FAILED: outcome %', v_out;
  end if;
  if not exists (select 1 from public.person_season_membership_log
                  where membership_id = v_m1 and transition_type = 'reactivate') then
    raise exception 'D3 FAILED: reactivate log row missing';
  end if;
  v_pass := v_pass + 1;

  -- D4. cancel requires a reason, and a blank one does not count as given.
  begin
    perform public.vam063_cancel_membership(v_super, v_m1, '   ');
    raise exception 'D4 FAILED: cancel accepted a blank reason';
  exception when others then
    if sqlerrm not like '%reason required%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- D5. A membership that no longer exists is reported as such rather than
  --     silently succeeding.
  begin
    perform public.vam063_pause_membership(v_super, gen_random_uuid(), null);
    raise exception 'D5 FAILED: pausing a non-existent membership succeeded';
  exception when others then
    if sqlerrm not like '%membership not found%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- D6. remove_role cancels exactly one role and leaves the other alone.
  select t.outcome_status into v_out
  from public.vam063_remove_membership_role(v_super, v_m2, 'test removal') t;
  if v_out <> 'transitioned'
     or (select status from public.person_season_memberships where id = v_m2) <> 'cancelled' then
    raise exception 'D6 FAILED: outcome %', v_out;
  end if;
  if (select status from public.person_season_memberships where id = v_m1) <> 'active' then
    raise exception 'D6 FAILED: removing one role changed the other';
  end if;
  if not exists (select 1 from public.person_season_membership_log
                  where membership_id = v_m2 and transition_type = 'role_removed') then
    raise exception 'D6 FAILED: role_removed log row missing';
  end if;
  v_pass := v_pass + 1;

  -- D7. Nothing in the lifecycle ever DELETEs. Both memberships still exist.
  select count(*) into v_n from public.person_season_memberships where person_id = v_person;
  if v_n <> 2 then raise exception 'D7 FAILED: expected 2 membership rows, found %', v_n; end if;
  v_pass := v_pass + 1;

  -- D8. An illegal transition is refused with the substring the UI translates
  --     ("invalid status transition" -> safeRpcMessage). v_m2 is cancelled
  --     after D6, and pause admits only 'active', so this is a genuine
  --     violation rather than the idempotent no-op path.
  begin
    perform public.vam063_pause_membership(v_super, v_m2, null);
    raise exception 'D8 FAILED: cancelled -> paused was accepted';
  exception when others then
    if sqlerrm not like '%invalid status transition%' then raise; end if;
    v_pass := v_pass + 1;
  end;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group E — season / program isolation (Day-1 requirement 7)
  -- ══════════════════════════════════════════════════════════════════════════

  -- E1. S11 is a different season: adding an S11 role does not touch S12 rows.
  if v_season11 is not null then
    select a.outcome_status into v_out
    from public.vam063_add_membership_role(v_super, v_person, v_prog, v_season11, 'mentee', null) a;
    if v_out <> 'created' then raise exception 'E1 FAILED: outcome %', v_out; end if;
    if (select status from public.person_season_memberships where id = v_m1) <> 'active' then
      raise exception 'E1 FAILED: an S11 write disturbed an S12 membership';
    end if;
    v_pass := v_pass + 1;
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group F — audit vocabulary (Phase 4)
  -- ══════════════════════════════════════════════════════════════════════════

  -- F1. Both approval verbs the Day-1 approval path writes are admitted, and
  --     an INSERT that omits all four legacy Production-only columns succeeds.
  --     This is the whole point of T1 for Day-1: lib/application-approvals.ts
  --     never sets action, actor_email, target_email or metadata.
  insert into public.admin_audit_log (actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data, details)
  values (v_super, 'approve_application_as_mentor', null, null, '{"t":1}'::jsonb, null);
  insert into public.admin_audit_log (actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data, details)
  values (v_super, 'approve_application_as_mentee', null, null, '{"t":1}'::jsonb, null);
  v_pass := v_pass + 1;

  -- F2. A value outside the canonical 52 is rejected.
  begin
    insert into public.admin_audit_log (actor_admin_user_id, action_type)
    values (v_super, 'definitely_not_a_canonical_verb');
    raise exception 'F2 FAILED: a non-canonical action_type was accepted';
  exception when check_violation then
    v_pass := v_pass + 1;
  end;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Group G — security posture (Phase 2)
  -- ══════════════════════════════════════════════════════════════════════════

  -- G1. Neither API role holds any privilege on the Day-1 tables.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('applications','people','mentor_profiles','mentee_profiles','admin_users',
                        'intake_batches','person_season_memberships','person_season_membership_log',
                        'admin_audit_log','application_decisions')
     and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then raise exception 'G1 FAILED: % residual API grants', v_n; end if;
  v_pass := v_pass + 1;

  -- G2. Neither API role can execute a lifecycle entry point.
  select count(*) into v_n
  from unnest(array[
    'public.vam063_pause_membership(uuid,uuid,text)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)']) f
  cross join unnest(array['anon','authenticated']) r
  where has_function_privilege(r, to_regprocedure(f), 'execute');
  if v_n <> 0 then raise exception 'G2 FAILED: % API execute grants', v_n; end if;
  v_pass := v_pass + 1;

  raise notice 'PROD S12 TESTS: % assertions passed (%). Rolling back — nothing is persisted.', v_pass, procedure_note;
end
$tests$;

rollback;
