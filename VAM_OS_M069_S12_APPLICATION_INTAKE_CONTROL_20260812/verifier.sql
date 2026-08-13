-- =============================================================================
-- VAM OS — M069 SEASON 12 APPLICATION INTAKE CONTROL — VERIFIER
--
-- READ-ONLY. Run after apply.sql, in its own session, with
-- `set timezone = 'UTC'`. Every check must report PASS.
--
-- 24 checks. Any FAIL means the apply did not land as reviewed; do not open
-- any form until it is resolved.
--
-- WHAT THIS FILE PROVES, AND WHY IT IS NOT A NAME CHECK
-- A catalog name is not evidence. A CHECK constraint with the right name and a
-- weaker expression, a trigger with the right name pointing at a different
-- function, a SECURITY DEFINER function with the right name and a different
-- body, an audit vocabulary with the right size and a substituted value — all
-- of those would pass a name-and-count verifier while leaving Production
-- unsafe. So this file reads the actual definitions:
--   * V07/V08 parse pg_get_constraintdef() into the sets the CHECKs admit;
--   * V09/V19 prove the trigger's table, timing, events, enabled state and
--     function IDENTITY, and that the function is the intended definer body;
--   * V13/V14/V20/V21/V22/V23 prove the RPC's schema, name, argument
--     signature, result type, SECURITY DEFINER flag, pinned search_path,
--     owner, grants and authorization contract, and emit a body seal;
--   * V17 proves the audit vocabulary is SET-EQUAL to the canonical 52 plus
--     exactly set_application_form_state;
--   * V24 proves the control rows hang off the one UEHM / UEHM-S12 /
--     UEHM-S12-B1 chain and off nothing else.
-- =============================================================================

\echo '=== M069 VERIFIER — READ ONLY ==='

with

-- ══ CANONICAL PRE-M069 AUDIT VOCABULARY (52) ═══════════════════════════════
-- The exact list installed by the S12 release T1, Section 2. Shared verbatim
-- with preflight.sql, apply.sql Section 0 and apply.sql / migration 069
-- Section 4; __tests__/support/m069-audit-vocabulary.ts holds the same 52
-- values and a test proves every copy is set-equal to it. DO NOT EDIT ONE COPY.
expected_vocab(value) as (
  select unnest(array[
    'accept_registration_proof','add_event_participation','add_manual_recap','add_membership_role',
    'approve_application_as_mentee','approve_application_as_mentor','bulk_add_event_participants',
    'cancel_event','cancel_event_registration','cancel_match','cancel_membership',
    'close_event_registration','confirm_event_registration','confirm_registration_payment',
    'create_action_item','create_admin_user','create_event','create_event_checkin_link',
    'create_event_registration_link','create_manual_match','create_membership','create_mentee_profile',
    'create_mentor_profile','deactivate_admin_user','edit_recap','import_participant_membership',
    'link_person_auth','open_event_registration','opt_out_membership','pause_membership',
    'reactivate_admin_user','reactivate_membership','reconcile_person_auth','reject_event_registration',
    'reject_registration_payment','reject_registration_proof','remove_admin_access',
    'remove_event_participation','remove_membership_role','soft_delete_recap','sync_auth','unknown',
    'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
    'update_mentee_profile','update_mentor_profile','update_registration_review_note',
    'waitlist_event_registration','withdraw_membership'
  ])
),
expected_post(value) as (
  select value from expected_vocab
  union
  select 'set_application_form_state'
),

-- The action_type CHECK found by DEFINITION, not by name.
audit_check as (
  select c.conname, c.convalidated, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
),
actual_post(value) as (
  select distinct m[1]
  from audit_check
  cross join lateral regexp_matches(audit_check.def, '''([^'']*)''::text', 'g') m
),
-- raw_n counts elements INCLUDING duplicates; quote_n counts quote characters.
-- quote_n = 2 * raw_n proves every quoted literal in the definition was
-- captured, so the parsed set really is the admitted set.
audit_shape as (
  select
    (select count(*) from audit_check
       cross join lateral regexp_matches(audit_check.def, '''([^'']*)''::text', 'g') m) as raw_n,
    coalesce((select sum(length(def) - length(replace(def, '''', ''))) from audit_check), 0) as quote_n
),

-- The one program/season/intake chain, resolved by code.
chain as (
  select p.id as program_id, s.id as season_id, b.id as batch_id
  from public.programs p
  join public.seasons s on s.program_id = p.id and s.code = 'UEHM-S12'
  join public.intake_batches b on b.season_id = s.id and b.code = 'UEHM-S12-B1'
  where p.code = 'UEHM'
),

rpc as (
  select p.oid,
         n.nspname                                 as schema_name,
         p.proname                                 as fn_name,
         pg_get_function_identity_arguments(p.oid) as arg_signature,
         pg_get_function_result(p.oid)             as result_type,
         p.prosecdef,
         p.proconfig,
         p.prosrc,
         p.proacl,
         p.proowner,
         pg_get_userbyid(p.proowner)               as fn_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam069_set_application_form_state'
),
-- acldefault() is used when proacl is NULL, because a function that was never
-- REVOKEd carries the built-in default — which grants EXECUTE to PUBLIC.
rpc_acl as (
  select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee_name,
         a.privilege_type
  from rpc r
  cross join lateral aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a
),

checks as (

  -- V01 — the table exists
  select 'V01' as id, 'control table exists' as what,
         (to_regclass('public.application_form_controls') is not null) as ok,
         coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as detail

  -- V02 — exactly two control rows, both for UEHM-S12-B1
  union all
  select 'V02', 'exactly 2 control rows for UEHM-S12-B1',
         count(*) = 2, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1'

  -- V03 — mentor control exists
  union all
  select 'V03', 'mentor control row exists', count(*) = 1, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1' and c.applicant_role = 'mentor'

  -- V04 — mentee control exists
  union all
  select 'V04', 'mentee control row exists', count(*) = 1, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1' and c.applicant_role = 'mentee'

  -- V05 — BOTH are CLOSED. The single most important check in this file.
  union all
  select 'V05', 'every control row is CLOSED', count(*) = 0,
         coalesce(string_agg(c.applicant_role || '=' || c.state, ', ' order by c.applicant_role), '<none not-closed>')
  from public.application_form_controls c
  where c.state <> 'closed'

  -- V06 — uniqueness is enforced by an index, not by convention
  union all
  select 'V06', 'unique index on (intake_batch_id, applicant_role)',
         count(*) = 1, coalesce(string_agg(indexname, ', '), '<none>')
  from pg_indexes
  where schemaname = 'public' and tablename = 'application_form_controls'
    and indexname = 'application_form_controls_batch_role_key'

  -- V07 — role vocabulary is closed. The EXPRESSION is read, not the name: a
  -- same-named CHECK admitting a third role must FAIL here.
  union all
  select 'V07', 'applicant_role CHECK expression admits exactly mentor+mentee',
         count(*) = 1 and bool_and(v.vals = array['mentee','mentor']),
         coalesce(string_agg(v.conname || ' => {' || coalesce(array_to_string(v.vals, ','), '') || '}', '; '), '<absent>')
  from (
    select c.conname,
           (select array_agg(distinct m[1] order by m[1])
            from regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''::text', 'g') m) as vals
    from pg_constraint c
    where c.conrelid = to_regclass('public.application_form_controls')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%applicant_role%'
  ) v

  -- V08 — state vocabulary is closed, by expression
  union all
  select 'V08', 'state CHECK expression admits exactly closed+pilot+open',
         count(*) = 1 and bool_and(v.vals = array['closed','open','pilot']),
         coalesce(string_agg(v.conname || ' => {' || coalesce(array_to_string(v.vals, ','), '') || '}', '; '), '<absent>')
  from (
    select c.conname,
           (select array_agg(distinct m[1] order by m[1])
            from regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''::text', 'g') m) as vals
    from pg_constraint c
    where c.conrelid = to_regclass('public.application_form_controls')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%state%'
      and pg_get_constraintdef(c.oid) not ilike '%applicant_role%'
  ) v

  -- V09 — binding trigger IDENTITY: right table, BEFORE INSERT OR UPDATE FOR
  -- EACH ROW, enabled, and pointing at the intended function. A same-named
  -- trigger calling a different function must FAIL.
  union all
  select 'V09', 'binding trigger installed: right table, timing, events, function, enabled',
         count(*) = 1
         and bool_and((t.tgtype & 1) = 1)     -- FOR EACH ROW
         and bool_and((t.tgtype & 2) = 2)     -- BEFORE
         and bool_and((t.tgtype & 4) = 4)     -- INSERT
         and bool_and((t.tgtype & 16) = 16)   -- UPDATE
         and bool_and((t.tgtype & 8) = 0)     -- not DELETE
         and bool_and((t.tgtype & 32) = 0)    -- not TRUNCATE
         and bool_and((t.tgtype & 64) = 0)    -- not INSTEAD OF
         and bool_and(t.tgenabled = 'O')    -- fires in origin/local sessions
         and bool_and(fnn.nspname = 'public' and fn.proname = 'vam069_assert_control_binding'),
         coalesce(string_agg(t.tgname || ' -> ' || fnn.nspname || '.' || fn.proname
                             || ' type=' || t.tgtype::text || ' enabled=' || t.tgenabled, ', '), '<none>')
  from pg_trigger t
  join pg_proc fn on fn.oid = t.tgfoid
  join pg_namespace fnn on fnn.oid = fn.pronamespace
  where t.tgrelid = to_regclass('public.application_form_controls')
    and t.tgname = 'application_form_controls_binding' and not t.tgisinternal

  -- V10 — RLS is ON
  union all
  select 'V10', 'RLS enabled on the control table', bool_and(relrowsecurity),
         coalesce(string_agg(relrowsecurity::text, ','), '<none>')
  from pg_class
  where oid = to_regclass('public.application_form_controls')

  -- V11 — and there are ZERO policies. RLS with a permissive policy would be
  -- worse than no RLS, because it would look locked down.
  union all
  select 'V11', 'zero RLS policies on the control table', count(*) = 0,
         coalesce(string_agg(policyname, ', '), '<none>')
  from pg_policies
  where schemaname = 'public' and tablename = 'application_form_controls'

  -- V12 — no grant to any public web role
  union all
  select 'V12', 'no anon/authenticated/PUBLIC grant on the control table',
         count(*) = 0,
         coalesce(string_agg(grantee || ':' || privilege_type, ', '), '<none>')
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'application_form_controls'
    and grantee in ('anon', 'authenticated', 'PUBLIC')

  -- V13 — the mutation function exists exactly once, in the right schema,
  -- with the exact argument signature the runtime calls.
  union all
  select 'V13', 'vam069_set_application_form_state exists once with the exact signature',
         count(*) = 1
         and bool_and(r.schema_name = 'public')
         and bool_and(r.fn_name = 'vam069_set_application_form_state')
         and bool_and(r.arg_signature = 'uuid, text, text, text, text'),
         coalesce(string_agg(r.schema_name || '.' || r.fn_name || '(' || r.arg_signature || ')', ', '), '<none>')
  from rpc r

  -- V14 — it is SECURITY DEFINER with EXACTLY the pinned search_path, and no
  -- other per-function setting.
  union all
  select 'V14', 'mutation function is SECURITY DEFINER with pinned search_path',
         count(*) = 1
         and bool_and(r.prosecdef)
         and bool_and(coalesce(array_length(r.proconfig, 1), 0) = 1)
         and bool_and(replace(array_to_string(r.proconfig, '|'), ' ', '') = 'search_path=public,pg_temp'),
         coalesce(string_agg(r.prosecdef::text || '/' || coalesce(array_to_string(r.proconfig, ','), '<none>'), ' '), '<none>')
  from rpc r

  -- V15 — execute is not held by a public web role. Read from the ACL itself,
  -- so a function whose default PUBLIC grant was never revoked also FAILs.
  union all
  select 'V15', 'no anon/authenticated/PUBLIC execute on the mutation function',
         count(*) = 0,
         coalesce(string_agg(grantee_name || ':' || privilege_type, ', '), '<none>')
  from rpc_acl
  where privilege_type = 'EXECUTE'
    and grantee_name in ('anon', 'authenticated', 'PUBLIC')

  -- V16 — audit capability: the vocabulary now admits the M069 action
  union all
  select 'V16', 'audit vocabulary admits set_application_form_state',
         count(*) = 1,
         coalesce(string_agg(c.conname, ', '), '<none>')
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check'
    and pg_get_constraintdef(c.oid) like '%set_application_form_state%'

  -- V17 — EXACT SET EQUALITY, not a count. The post-M069 vocabulary must be
  -- the canonical 52 release values plus set_application_form_state and
  -- nothing else: none of the 52 disappeared, no extra value appeared, no
  -- value was substituted for another.
  union all
  select 'V17', 'audit vocabulary is exactly the 52 release values + set_application_form_state',
         (select count(*) from audit_check) = 1
         and (select count(*) from actual_post) = 53
         and (select raw_n = 53 and quote_n = 106 from audit_shape)
         and not exists (select value from expected_post except select value from actual_post)
         and not exists (select value from actual_post except select value from expected_post),
         'n=' || (select count(*) from actual_post)::text
         || ' missing=' || coalesce((select string_agg(value, ',' order by value)
              from (select value from expected_post except select value from actual_post) a), '<none>')
         || ' unexpected=' || coalesce((select string_agg(value, ',' order by value)
              from (select value from actual_post except select value from expected_post) b), '<none>')

  -- V18 — Season 11 is untouched. No control row anywhere may reference an
  -- S11 season, by any route.
  union all
  select 'V18', 'no control row references any Season 11 object', count(*) = 0,
         coalesce(string_agg(s.code, ', '), '<none>')
  from public.application_form_controls c
  join public.seasons s on s.id = c.season_id
  where s.code like '%S11%'

  -- V19 — the trigger FUNCTION is the intended one, not merely a function of
  -- that name: SECURITY DEFINER, pinned search_path, returns trigger, and its
  -- body still carries all three binding refusals. md5 is emitted as a seal
  -- so two environments can be compared directly.
  union all
  select 'V19', 'binding trigger function is the intended SECURITY DEFINER body',
         count(*) = 1
         and bool_and(f.prosecdef)
         and bool_and(replace(array_to_string(f.proconfig, '|'), ' ', '') = 'search_path=public,pg_temp')
         and bool_and(f.prorettype = 'pg_catalog.trigger'::regtype)
         and bool_and(f.prosrc like '%does not resolve to a season%')
         and bool_and(f.prosrc like '%does not own intake_batch%')
         and bool_and(f.prosrc like '%does not own season%')
         and bool_and(f.prosrc like '%23514%'),
         coalesce(string_agg('secdef=' || f.prosecdef::text
                             || ' cfg=' || coalesce(array_to_string(f.proconfig, ','), '<none>')
                             || ' seal=' || md5(f.prosrc), ', '), '<none>')
  from pg_proc f
  join pg_namespace fn on fn.oid = f.pronamespace
  where fn.nspname = 'public' and f.proname = 'vam069_assert_control_binding'

  -- V20 — the RPC's result type is part of the contract: app/actions reads
  -- outcome_status, previous_state, new_state, updated_at and actor_email off
  -- this shape.
  union all
  select 'V20', 'mutation function returns the exact TABLE contract',
         count(*) = 1
         and bool_and(r.result_type = 'TABLE(outcome_status text, previous_state text, new_state text, updated_at timestamp with time zone, actor_email text)'),
         coalesce(string_agg(r.result_type, ' | '), '<none>')
  from rpc r

  -- V21 — owner class. A SECURITY DEFINER function executes AS ITS OWNER, so
  -- the owner is part of the security contract: it must not be a web role,
  -- and it must be the same principal that owns the control table (the
  -- migration ran as one role and created both).
  union all
  select 'V21', 'mutation function owner is not a web role and owns the control table too',
         count(*) = 1
         and bool_and(r.fn_owner not in ('anon', 'authenticated', 'service_role'))
         and bool_and(r.fn_owner = t.table_owner),
         coalesce(string_agg('function=' || r.fn_owner || ' table=' || coalesce(t.table_owner, '<none>'), ', '), '<none>')
  from rpc r
  cross join (
    select pg_get_userbyid(relowner) as table_owner
    from pg_class where oid = to_regclass('public.application_form_controls')
  ) t

  -- V22 — the affirmative grant. Without it the Server Action path cannot
  -- call the RPC at all and the Admin screen is dead.
  union all
  select 'V22', 'service_role holds EXECUTE on the mutation function',
         count(*) = 1,
         coalesce(string_agg(grantee_name || ':' || privilege_type, ', '), '<none>')
  from rpc_acl
  where privilege_type = 'EXECUTE' and grantee_name = 'service_role'

  -- V23 — the RPC BODY still carries the authorization contract. This is what
  -- fails if someone replaces the function with an unsafe one of the same
  -- name and signature: no active-status check, no role allow-list, no row
  -- lock, no optimistic-concurrency compare, no atomic audit INSERT — or a
  -- core_team grant that was never reviewed. md5 is emitted as a body seal.
  union all
  select 'V23', 'mutation function body still carries the M069 authorization contract',
         count(*) = 1
         and bool_and(r.prosrc like '%''active''%')
         and bool_and(r.prosrc like '%super_admin%')
         and bool_and(r.prosrc like '%42501%')
         and bool_and(r.prosrc like '%for update%')
         and bool_and(r.prosrc like '%p_expected_state%')
         and bool_and(r.prosrc like '%40001%')
         and bool_and(r.prosrc like '%admin_audit_log%')
         and bool_and(r.prosrc like '%set_application_form_state%')
         and bool_and(r.prosrc not like '%core_team%'),
         coalesce(string_agg('seal=' || md5(r.prosrc) || ' len=' || length(r.prosrc)::text, ', '), '<none>')
  from rpc r

  -- V24 — DIRECT binding proof, independent of the batch code alone. Exactly
  -- one UEHM, exactly one UEHM-S12 under it, exactly one UEHM-S12-B1 under
  -- that season, and the two control rows reference THAT intake row — and are
  -- the only control rows that exist. A same-code batch under another
  -- program/season therefore FAILs here.
  union all
  select 'V24', 'UEHM -> UEHM-S12 -> UEHM-S12-B1 is one chain and owns both control rows',
         (select count(*) from public.programs where code = 'UEHM') = 1
         and (select count(*) from public.seasons where code = 'UEHM-S12') = 1
         and (select count(*) from public.intake_batches where code = 'UEHM-S12-B1') = 1
         and (select count(*) from chain) = 1
         and (select count(*) from public.application_form_controls) = 2
         and (select count(*)
                from public.application_form_controls c
                join chain ch on ch.batch_id = c.intake_batch_id
                             and ch.season_id = c.season_id
                             and ch.program_id = c.program_id) = 2,
         'programs=' || (select count(*) from public.programs where code = 'UEHM')::text
         || ' seasons=' || (select count(*) from public.seasons where code = 'UEHM-S12')::text
         || ' batches=' || (select count(*) from public.intake_batches where code = 'UEHM-S12-B1')::text
         || ' chains=' || (select count(*) from chain)::text
         || ' rows_total=' || (select count(*) from public.application_form_controls)::text
         || ' rows_on_chain=' || (select count(*)
                from public.application_form_controls c
                join chain ch on ch.batch_id = c.intake_batch_id
                             and ch.season_id = c.season_id
                             and ch.program_id = c.program_id)::text
)
select id,
       case when ok then 'PASS' else 'FAIL' end as result,
       what,
       detail
from checks
order by id;

-- Summary line. Expect: 24 checks, 0 failures.
with expected_vocab(value) as (
  select unnest(array[
    'accept_registration_proof','add_event_participation','add_manual_recap','add_membership_role',
    'approve_application_as_mentee','approve_application_as_mentor','bulk_add_event_participants',
    'cancel_event','cancel_event_registration','cancel_match','cancel_membership',
    'close_event_registration','confirm_event_registration','confirm_registration_payment',
    'create_action_item','create_admin_user','create_event','create_event_checkin_link',
    'create_event_registration_link','create_manual_match','create_membership','create_mentee_profile',
    'create_mentor_profile','deactivate_admin_user','edit_recap','import_participant_membership',
    'link_person_auth','open_event_registration','opt_out_membership','pause_membership',
    'reactivate_admin_user','reactivate_membership','reconcile_person_auth','reject_event_registration',
    'reject_registration_payment','reject_registration_proof','remove_admin_access',
    'remove_event_participation','remove_membership_role','soft_delete_recap','sync_auth','unknown',
    'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
    'update_mentee_profile','update_mentor_profile','update_registration_review_note',
    'waitlist_event_registration','withdraw_membership'
  ])
),
expected_post(value) as (
  select value from expected_vocab
  union
  select 'set_application_form_state'
),
actual_post(value) as (
  select distinct m[1]
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''::text', 'g') m
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
)
select
  (select count(*) from public.application_form_controls) as control_rows_total,
  (select count(*) from public.application_form_controls where state = 'closed') as control_rows_closed,
  (select count(*) from public.application_form_controls where state <> 'closed') as control_rows_not_closed,
  (select count(*) from public.admin_audit_log where action_type = 'set_application_form_state') as m069_audit_rows,
  (select count(*) from actual_post) as audit_vocab_size,
  coalesce((select string_agg(value, ', ' order by value)
              from (select value from expected_post except select value from actual_post) a),
           '<none>') as audit_vocab_missing,
  coalesce((select string_agg(value, ', ' order by value)
              from (select value from actual_post except select value from expected_post) b),
           '<none>') as audit_vocab_unexpected,
  md5(coalesce((select string_agg(value, ',' order by value) from actual_post), '<none>')) as audit_vocab_seal,
  now() at time zone 'UTC' as verified_at_utc;
