-- =============================================================================
-- VAM OS — M071 S12 RENEWAL TRUSTED RUNTIME FOUNDATION — VERIFIER
--
-- READ-ONLY. Run after apply.sql, in its own session, with
-- `set timezone = 'UTC'`. EVERY check must report PASS, and M071_VERIFIED must
-- be PASS. Runs inside `begin; set transaction read only; … rollback;`.
--
-- WHY THIS IS NOT A NAME-AND-COUNT VERIFIER
-- A function name is not evidence. A function with the right name and
-- SECURITY INVOKER, the right name and a mutable search_path, the right name
-- and no FOR UPDATE, the right name and a missing `and submitted_at is null`
-- predicate — every one of those passes a name check while the invariant it
-- was installed for is gone. Each check below reads what is actually
-- installed: the catalog metadata for hardening and privileges, and the stored
-- function body (pg_proc.prosrc) for the security properties that live inside
-- the body and nowhere else.
--
-- HOW BODY PROPERTIES ARE PINNED, AND THE LIMIT OF THAT
-- No database was contacted while authoring this package, so a hard-coded
-- expected body hash would be a guess wearing the costume of a proof and its
-- first FAIL would be indistinguishable from a real defect. Instead each
-- security property is pinned by an anchored-enough regex over the
-- whitespace-normalised body — the row lock, the conditional claim, the exact
-- row-count assertion, the identity lock, the accepted-renewal predicate, the
-- payload nesting, the forbidden lineage fields — and V22 emits the sha256 of
-- every body as EVIDENCE. The seals are what a second environment is diffed
-- against and what a future re-verification compares to; they are not asserted
-- against a literal here, and this file says so rather than implying more
-- proof than it has.
--
-- SUPABASE SQL EDITOR COMPATIBILITY
-- ZERO psql meta-commands. The marker below is an ordinary `select … as phase`
-- statement. The check table is the LAST row-returning statement, so it is what
-- the editor displays. Read every row.
--
-- WHAT IS VERIFIED BEYOND THIS PACKAGE'S OWN OBJECTS
-- Two checks read state this package does not own, because two of its
-- guarantees rest on that state and would fail silently if it drifted:
--   V27  applications.submitted_at is still date or timestamp with time zone,
--        the only two shapes the accept path's v_now write supports.
--   V28  vam063_reactivate_membership still exists, is still a hardened
--        definer and is still executable by service_role, which is what makes
--        P0-RT-10's membership restoration implementable with no new SQL.
--
-- POSTGRESQL 15 TYPE STABILITY
-- Every branch of every CASE returns text, every catalog "char" value is cast
-- ::text before it is concatenated, and every diagnostic is wrapped in
-- coalesce(…, '<absent>') so a NULL never collapses a whole detail string.
-- =============================================================================

select 'M071 VERIFIER — READ ONLY' as phase;

begin;
set transaction read only;

with
fns as (
  select p.oid,
         p.proname::text                                          as name,
         p.prosecdef                                              as secdef,
         p.provolatile::text                                      as vol,
         p.prokind::text                                          as kind,
         coalesce(array_to_string(p.proconfig, ','), '')           as cfg,
         pg_get_function_identity_arguments(p.oid)                as args,
         pg_get_function_result(p.oid)                            as result,
         regexp_replace(p.prosrc, '\s+', ' ', 'g')                as body,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')      as seal,
         p.proacl,
         p.proowner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%'
),
-- name # identity arguments # SECURITY DEFINER # volatility (v/s/i)
expected_fns(spec) as (
  select unnest(array[
    'vam071_accepted_renewal_exists#p_person_id uuid, p_season_id uuid, p_role text#t#s',
    'vam071_confirm_renewal_profile#p_actor_admin_user_id uuid, p_application_id uuid, p_expected_profile jsonb, p_profile_update jsonb, p_diff jsonb#t#v',
    'vam071_create_renewal_invite#p_actor_admin_user_id uuid, p_person_id uuid, p_program_id uuid, p_season_id uuid, p_role text, p_token_hash text, p_expires_at timestamp with time zone#t#v',
    'vam071_renewal_identity_lock#p_person_id uuid, p_season_id uuid, p_role text#t#v',
    'vam071_revoke_renewal_invite#p_actor_admin_user_id uuid, p_invite_id uuid, p_reason text#t#v',
    'vam071_submit_renewal_accepted#p_token_hash text, p_raw_payload jsonb, p_consent_data_storage boolean#t#v',
    'vam071_submit_renewal_declined#p_token_hash text#t#v'
  ]::text[])
),
entry(name) as (
  select unnest(array[
    'vam071_create_renewal_invite', 'vam071_revoke_renewal_invite',
    'vam071_submit_renewal_accepted', 'vam071_submit_renewal_declined',
    'vam071_confirm_renewal_profile'
  ]::text[])
),
helper(name) as (
  select unnest(array[
    'vam071_renewal_identity_lock', 'vam071_accepted_renewal_exists'
  ]::text[])
),
acl as (
  select f.name, a.grantee, a.privilege_type
  from fns f
  cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
),
invite_tbl as (
  select to_regclass('public.person_season_invites') as oid
),
results(check_id, check_name, status, detail) as (

  -- V01 ─ exactly seven functions, no more and no fewer. An eighth vam071_*
  -- function nobody reviewed is as much a change to this package's surface as
  -- a missing one.
  select 'V01', 'function_inventory',
    case when (select count(*) from fns) = 7
          and not exists (
            select 1 from expected_fns e
            where split_part(e.spec, '#', 1) not in (select name from fns)
          )
          and not exists (
            select 1 from fns f
            where f.name not in (select split_part(spec, '#', 1) from expected_fns)
          )
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name, ', ' order by f.name) from fns f), '<none>')

  -- V02 ─ the COMPLETE signature contract. A changed argument list is a
  -- different function that PostgREST would still resolve by name, and an
  -- added parameter is exactly how client-supplied identity gets back in.
  union all
  select 'V02', 'signature_contract',
    case when not exists (
      select 1 from expected_fns e
      left join fns f on f.name = split_part(e.spec, '#', 1)
      where f.name is null
         or f.args <> split_part(e.spec, '#', 2)
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '(' || f.args || ')', ' | ' order by f.name) from fns f), '<none>')

  -- V03 ─ SECURITY DEFINER everywhere. A definer function that became an
  -- invoker would run vam063's authorization checks against the wrong
  -- identity and would lose access to the RLS-enabled invite table entirely.
  union all
  select 'V03', 'security_definer',
    case when not exists (select 1 from fns where not secdef) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '=' || f.secdef::text, ', ' order by f.name) from fns f), '<none>')

  -- V04 ─ the pinned search_path. A SECURITY DEFINER function with a mutable
  -- search_path is a privilege-escalation primitive: anything it calls
  -- unqualified can be shadowed by a schema the caller controls.
  union all
  select 'V04', 'search_path_pinned',
    case when not exists (
      select 1 from fns where cfg not like '%search_path=public, pg_temp%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '=[' || f.cfg || ']', ', ' order by f.name) from fns f), '<none>')

  -- V05 ─ volatility. vam071_accepted_renewal_exists must be STABLE (it is
  -- read-only); every other function must be VOLATILE, because a mutating
  -- function marked STABLE can be executed against a stale snapshot.
  union all
  select 'V05', 'volatility_contract',
    case when not exists (
      select 1 from expected_fns e join fns f on f.name = split_part(e.spec, '#', 1)
      where f.vol <> split_part(e.spec, '#', 4)
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '=' || f.vol, ', ' order by f.name) from fns f), '<none>')

  -- V06 ─ the five entry points are executable by service_role
  union all
  select 'V06', 'entry_points_executable_by_service_role',
    case when not exists (
      select 1 from entry e
      where not has_function_privilege('service_role',
        (select f.oid from fns f where f.name = e.name), 'execute')
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(e.name || '=' ||
        coalesce(has_function_privilege('service_role',
          (select f.oid from fns f where f.name = e.name), 'execute')::text, '?'),
      ', ' order by e.name) from entry e), '<none>')

  -- V07 ─ and by NOTHING the web tier can reach. anon and authenticated are
  -- checked by name; PUBLIC is checked through the ACL, because
  -- has_function_privilege takes a role name and PUBLIC is not a role.
  union all
  select 'V07', 'no_web_role_execute',
    case when not exists (
      select 1 from fns f, unnest(array['anon','authenticated']::text[]) r
      where has_function_privilege(r, f.oid, 'execute')
    ) and not exists (
      select 1 from acl where grantee = 0 and privilege_type = 'EXECUTE'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '->' || r, ', ' order by f.name, r)
              from fns f, unnest(array['anon','authenticated']::text[]) r
              where has_function_privilege(r, f.oid, 'execute')), '<none>')
      || ' public_execute=' ||
    coalesce((select string_agg(distinct name, ', ') from acl
              where grantee = 0 and privilege_type = 'EXECUTE'), '<none>')

  -- V08 ─ the two internal helpers are reachable by NO role at all, including
  -- service_role. They are called only from inside the definer functions
  -- above, which need no privilege to do so.
  union all
  select 'V08', 'helpers_unreachable',
    case when not exists (
      select 1 from helper h, unnest(array['anon','authenticated','service_role']::text[]) r
      where has_function_privilege(r, (select f.oid from fns f where f.name = h.name), 'execute')
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(h.name || '->' || r, ', ' order by h.name, r)
              from helper h, unnest(array['anon','authenticated','service_role']::text[]) r
              where has_function_privilege(r, (select f.oid from fns f where f.name = h.name), 'execute')),
             '<none reachable — correct>')

  -- ── The body properties. P0-RT-3's seven steps live inside these bodies and
  -- nowhere else; the catalog cannot see any of them. ─────────────────────────

  -- V09 ─ NO function anywhere in this package accepts a raw token. The whole
  -- token boundary rests on this: a parameter named p_token (43 base64url
  -- characters) instead of p_token_hash would put a live bearer credential
  -- into pg_stat_statements and into every statement log.
  union all
  select 'V09', 'no_raw_token_parameter',
    -- `\mp_token\M` is a WHOLE-WORD match: in `p_token_hash` the underscore is
    -- a word character, so `\M` does not hold after `p_token` and the pattern
    -- correctly matches only a parameter literally named p_token. Three
    -- functions take the digest — create, accept, decline — and none takes the
    -- token itself.
    case when not exists (
      select 1 from fns f where f.args ~ '\mp_token\M'
    ) and (select count(*) from fns f where f.args like '%p_token_hash text%') = 3
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '(' || f.args || ')', ' | ' order by f.name)
              from fns f where f.args like '%token%'), '<no token parameter anywhere>')

  -- V10 ─ both submit paths pin the hash format before they use it. A value
  -- that is not 64 lowercase hex characters never reaches a query.
  union all
  select 'V10', 'submit_paths_pin_token_hash_format',
    case when not exists (
      select 1 from fns f
      where f.name in ('vam071_submit_renewal_accepted', 'vam071_submit_renewal_declined',
                       'vam071_create_renewal_invite')
        and f.body !~ '\^\[0-9a-f\]\{64\}\$'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name, ', ' order by f.name) from fns f
              where f.body ~ '\^\[0-9a-f\]\{64\}\$'), '<none>')

  -- V11 ─ P0-RT-3 step 1. Every path that decides something about an invite
  -- LOCKS it first. Without FOR UPDATE the two concurrent submitters both read
  -- an unclaimed row and the whole single-winner argument collapses.
  union all
  select 'V11', 'invite_row_locked_for_update',
    case when not exists (
      select 1 from fns f
      where f.name in ('vam071_submit_renewal_accepted', 'vam071_submit_renewal_declined',
                       'vam071_revoke_renewal_invite', 'vam071_confirm_renewal_profile')
        and f.body !~* 'from public\.person_season_invites i where [^;]*for update'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name, ', ' order by f.name) from fns f
              where f.body ~* 'from public\.person_season_invites i where [^;]*for update'), '<none>')

  -- V12 ─ P0-RT-3 steps 5 and 6, the two halves that make replay incapable of
  -- overwriting a claim: the conditional UPDATE and the exact row-count
  -- assertion. Either one alone is insufficient.
  union all
  select 'V12', 'single_winner_claim_and_rowcount',
    case when (select count(*) from fns f
               where f.name in ('vam071_submit_renewal_accepted', 'vam071_submit_renewal_declined')
                 and f.body ~* 'update public\.person_season_invites i set [^;]*where i\.id = v_inv\.id and i\.submitted_at is null'
                 and f.body ~* 'get diagnostics v_rows = row_count'
                 and f.body ~* 'if v_rows <> 1 then') = 2
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '=' ||
        case when f.body ~* 'where i\.id = v_inv\.id and i\.submitted_at is null' then 'claim' else 'NO-CLAIM' end
        || '/' ||
        case when f.body ~* 'if v_rows <> 1 then' then 'rowcount' else 'NO-ROWCOUNT' end,
      ', ' order by f.name)
      from fns f where f.name in ('vam071_submit_renewal_accepted','vam071_submit_renewal_declined')), '<absent>')

  -- V13 ─ P0-RT-1 and P0-RT-2. The identity lock is taken, and the
  -- accepted-renewal predicate is evaluated, in all three deciding paths. The
  -- lock is what makes the predicate's answer authoritative rather than
  -- advisory: without it, an accept on invite A can commit while a decline on
  -- invite B for the same mentor is still deciding.
  union all
  select 'V13', 'identity_lock_and_accepted_predicate',
    case when (select count(*) from fns f
               where f.name in ('vam071_create_renewal_invite', 'vam071_submit_renewal_accepted',
                                'vam071_submit_renewal_declined')
                 and f.body ~* 'vam071_renewal_identity_lock\('
                 and f.body ~* 'vam071_accepted_renewal_exists\(') = 3
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(f.name || '=' ||
        case when f.body ~* 'vam071_renewal_identity_lock\(' then 'lock' else 'NO-LOCK' end
        || '/' ||
        case when f.body ~* 'vam071_accepted_renewal_exists\(' then 'predicate' else 'NO-PREDICATE' end,
      ', ' order by f.name)
      from fns f where f.name in ('vam071_create_renewal_invite','vam071_submit_renewal_accepted',
                                  'vam071_submit_renewal_declined')), '<absent>')

  -- V14 ─ the accepted-renewal predicate reads what it claims to read. A
  -- helper rewritten to check something else would leave V13 passing.
  union all
  select 'V14', 'accepted_predicate_definition',
    case when (select f.body from fns f where f.name = 'vam071_accepted_renewal_exists')
              ~* 'from public\.person_season_invites i where i\.person_id = p_person_id and i\.season_id = p_season_id and i\.role = p_role and i\.outcome = ''accepted'''
    then 'PASS' else 'FAIL' end,
    coalesce((select f.body from fns f where f.name = 'vam071_accepted_renewal_exists'), '<absent>')

  -- V15 ─ the identity lock is transaction-scoped and keyed on exactly
  -- person+season+role. A session-scoped lock would leak across a pooled
  -- connection; a differently-keyed one would serialise the wrong things.
  union all
  select 'V15', 'identity_lock_definition',
    case when (select f.body from fns f where f.name = 'vam071_renewal_identity_lock')
              ~* 'pg_advisory_xact_lock\( hashtext\(''VAM071_RENEWAL\|'' \|\| p_person_id::text \|\| ''\|'' \|\| p_season_id::text \|\| ''\|'' \|\| p_role\) \)'
    then 'PASS' else 'FAIL' end,
    coalesce((select f.body from fns f where f.name = 'vam071_renewal_identity_lock'), '<absent>')

  -- V16 ─ P0-RT-5, structural. The accept path nests the submitted answers
  -- under raw_payload -> 'renewal'. That nesting is what stops
  -- buildMentorProfileRefresh — which reads TOP-LEVEL keys and emits
  -- first_vam_season among them — from finding anything when approveApplication
  -- later runs over the renewal application row. Lose the nesting and an
  -- unauthenticated submission refreshes canonical profile columns with no
  -- admin confirmation at all.
  union all
  select 'V16', 'accept_nests_raw_payload_under_renewal',
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_accepted')
              ~* 'jsonb_build_object\( ''source'', ''s12_mentor_renewal'', ''renewal_invite_id'', v_inv\.id, ''renewal_submitted_at'', v_now, ''renewal'', p_raw_payload \)'
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_accepted')
              ~* '''renewal'', p_raw_payload'
         then 'nested under ''renewal''' else 'NOT NESTED — approveApplication would read the payload' end

  -- V17 ─ the accept path derives identity from the invite and from people,
  -- and writes person_id AT INSERT. An applications row created without
  -- person_id, to be linked later, is the shape P0-RT-3 step 4 forbids.
  union all
  select 'V17', 'accept_writes_person_id_at_insert',
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_accepted')
              ~* 'insert into public\.applications \( person_id, season_id, intake_batch_id, role_applied, status, source,'
         and (select f.body from fns f where f.name = 'vam071_submit_renewal_accepted')
              ~* 'values \( v_inv\.person_id, v_inv\.season_id,'
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_accepted')
              ~* 'values \( v_inv\.person_id,'
         then 'person_id = v_inv.person_id at INSERT' else 'NOT derived from the locked invite' end

  -- V18 ─ P0-RT-5, again, at the confirm boundary. The lineage fields are
  -- refused by name, so widening the column ceiling carelessly later cannot
  -- open them.
  union all
  select 'V18', 'confirm_refuses_lineage_fields',
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'v_forbidden constant text\[\] := array\[ ''first_vam_season'', ''prior_vam_involvement'' \]'
         and (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'if v_key = any \(v_forbidden\) then'
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'first_vam_season' then 'lineage fields named and refused'
         else 'LINEAGE REFUSAL ABSENT' end

  -- V19 ─ P0-RT-4. The confirm path locks the profile and refuses on drift.
  -- Without the 40001 refusal the admin approves a "before" that is no longer
  -- true and silently reverts a colleague's edit.
  union all
  select 'V19', 'confirm_locks_profile_and_refuses_drift',
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'from public\.mentor_profiles mp where mp\.person_id = v_inv\.person_id for update'
         and (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'changed since this diff was shown'
         and (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'errcode = ''40001'''
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'for update' then 'profile locked; drift refusal present' else 'NOT LOCKED' end

  -- V20 ─ P0-RT-6/P0-RT-7. The confirm path writes its audit row in the same
  -- transaction as the mutation, and attributes it to the CURRENT confirming
  -- admin resolved from admin_users, never to the invite's created_by.
  union all
  select 'V20', 'confirm_audits_atomically_as_current_admin',
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'insert into public\.admin_audit_log'
         and (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* '''confirm_renewal'', ''confirm_renewal'', v_actor\.id'
         and (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              !~* 'v_inv\.created_by'
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_confirm_renewal_profile')
              ~* 'v_inv\.created_by'
         then 'FAIL: confirm references the invite issuer'
         else 'actor = v_actor.id (current confirming admin)' end

  -- V21 ─ the decline path never addresses Season 11, never invents a
  -- membership status, and resolves the membership strictly by the invite's
  -- own season. The negative half matters most: a literal S11 code or a
  -- status vocabulary of its own would both be visible here.
  union all
  select 'V21', 'decline_season_bound_and_no_new_status',
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_declined')
              ~* 'where m\.person_id = v_inv\.person_id and m\.season_id = v_inv\.season_id and m\.role = v_inv\.role'
         and (select f.body from fns f where f.name = 'vam071_submit_renewal_declined')
              ~* 'vam063_opt_out_membership\('
         and (select f.body from fns f where f.name = 'vam071_submit_renewal_declined')
              !~* 'S11'
         and (select f.body from fns f where f.name = 'vam071_submit_renewal_declined')
              !~* 'insert into public\.person_season_memberships'
    then 'PASS' else 'FAIL' end,
    case when (select f.body from fns f where f.name = 'vam071_submit_renewal_declined') ~* 'S11'
         then 'FAIL: the decline body references S11'
         else 'season from invite; opt-out delegated to vam063; no membership INSERT' end

  -- V22 ─ EVIDENCE, not an assertion. The sha256 of each stored body, so this
  -- environment can be diffed against another and against a future
  -- re-verification. Always PASS; read the seals.
  union all
  select 'V22', 'body_seals_evidence',
    'PASS',
    coalesce((select string_agg(f.name || '=' || left(f.seal, 16), ', ' order by f.name) from fns f), '<none>')

  -- V23 ─ M070 is untouched. This package installs functions; if it had
  -- altered the invite table, dropped an arbiter, added a policy or granted a
  -- web role, that would show here rather than in a later incident.
  union all
  select 'V23', 'm070_table_contract_intact',
    case when (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
               where i.indrelid = (select oid from invite_tbl)
                 and c.relname = any (array['person_season_invites_token_hash_key',
                                            'person_season_invites_live_key',
                                            'person_season_invites_accepted_key']::text[])
                 and i.indisunique and i.indisvalid and i.indisready) = 3
         and (select count(*) from pg_constraint c
              where c.conrelid = (select oid from invite_tbl) and c.contype = 'c' and c.convalidated) = 6
         and exists (select 1 from pg_class where oid = (select oid from invite_tbl) and relrowsecurity)
         and not exists (select 1 from pg_class where oid = (select oid from invite_tbl) and relforcerowsecurity)
         and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = 'person_season_invites')
         and not exists (select 1 from information_schema.role_table_grants g
                         where g.table_schema = 'public' and g.table_name = 'person_season_invites'
                           and g.grantee in ('anon','authenticated','PUBLIC'))
    then 'PASS' else 'FAIL' end,
    'arbiters=' || (select count(*)::text from pg_index i join pg_class c on c.oid = i.indexrelid
                    where i.indrelid = (select oid from invite_tbl)
                      and c.relname = any (array['person_season_invites_token_hash_key',
                                                 'person_season_invites_live_key',
                                                 'person_season_invites_accepted_key']::text[])
                      and i.indisunique and i.indisvalid and i.indisready)
      || ' checks=' || (select count(*)::text from pg_constraint c
                        where c.conrelid = (select oid from invite_tbl) and c.contype = 'c')
      || ' rls=' || coalesce((select relrowsecurity::text from pg_class where oid = (select oid from invite_tbl)), '?')
      || ' force=' || coalesce((select relforcerowsecurity::text from pg_class where oid = (select oid from invite_tbl)), '?')
      || ' policies=' || (select count(*)::text from pg_policies p
                          where p.schemaname = 'public' and p.tablename = 'person_season_invites')

  -- V24 ─ the audit vocabulary still admits every value this package writes.
  -- A vocabulary that lost one would turn each audited mutation into a 23514
  -- that rolls the mutation back with it.
  union all
  select 'V24', 'audit_vocabulary_admits_m071_writes',
    case when not exists (
      select 1 from unnest(array['confirm_renewal','create_renewal_invite',
                                 'revoke_renewal_invite','add_membership_role',
                                 'opt_out_membership']::text[]) x
      where not exists (
        select 1 from pg_constraint c
        where c.conrelid = to_regclass('public.admin_audit_log')
          and c.conname = 'admin_audit_log_action_type_check'
          and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
      )
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(x, ', ' order by x)
              from unnest(array['confirm_renewal','create_renewal_invite',
                                'revoke_renewal_invite','add_membership_role',
                                'opt_out_membership']::text[]) x
              where not exists (
                select 1 from pg_constraint c
                where c.conrelid = to_regclass('public.admin_audit_log')
                  and c.conname = 'admin_audit_log_action_type_check'
                  and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
              )), '<none missing>')

  -- V25 ─ no table these definer functions write has acquired FORCE RLS, and
  -- the vam063 surface this package calls is still hardened and executable.
  union all
  select 'V25', 'write_surface_still_usable',
    case when not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relforcerowsecurity
        and c.relname = any (array['person_season_invites','applications','mentor_profiles',
                                   'admin_audit_log','person_season_memberships',
                                   'person_season_membership_log']::text[])
    ) and has_function_privilege('service_role',
          'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)', 'execute')
    then 'PASS' else 'FAIL' end,
    'force_rls_on=' || coalesce((select string_agg(c.relname::text, ', ' order by c.relname::text)
                                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                 where n.nspname = 'public' and c.relforcerowsecurity
                                   and c.relname = any (array['person_season_invites','applications',
                                       'mentor_profiles','admin_audit_log','person_season_memberships',
                                       'person_season_membership_log']::text[])), '<none>')
      || ' add_role_executable=' ||
      has_function_privilege('service_role',
        'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)', 'execute')::text

  -- V26 ─ the DATA invariants, re-proved. Every claimed invite has a coherent
  -- outcome, every accepted one has exactly one application, every declined
  -- one has none, and no invite anywhere points at Season 11.
  union all
  select 'V26', 'renewal_row_invariants_hold',
    case when not exists (
      select 1 from public.person_season_invites i
      where (i.submitted_at is null) <> (i.outcome is null)
         or (i.outcome is not distinct from 'accepted') <> (i.application_id is not null)
    ) and not exists (
      select 1 from public.person_season_invites i
      join public.seasons s on s.id = i.season_id
      where s.code like '%S11%'
    ) and not exists (
      select 1 from public.person_season_invites i
      join public.applications a on a.id = i.application_id
      where a.person_id is distinct from i.person_id
         or a.season_id is distinct from i.season_id
         or a.source is distinct from 's12_mentor_renewal'
    ) then 'PASS' else 'FAIL' end,
    (select count(*)::text from public.person_season_invites) || ' invite row(s); '
      || (select count(*)::text from public.person_season_invites where outcome = 'accepted') || ' accepted; '
      || (select count(*)::text from public.person_season_invites where outcome = 'declined') || ' declined'

  -- V27 ─ the applications.submitted_at TYPE contract, re-proved after apply.
  -- The accept path writes v_now — the transaction timestamp — into this
  -- column, and what that MEANS depends on the column's type. Two shapes are
  -- supported and only two: `date`, the legacy Production column migration 038
  -- documents and the 059 bootstrap declares, and `timestamp with time zone`,
  -- which the S12 release baseline reproduction declares. On timestamptz the
  -- real submission instant survives; on date PostgreSQL applies the ordinary
  -- assignment cast and stores the calendar day. A third shape means the
  -- column drifted after apply and every renewal submitted since then recorded
  -- something nobody specified, so this FAILS rather than reporting.
  union all
  select 'V27', 'applications_submitted_at_type_contract',
    case when coalesce((
           select format_type(a.atttypid, a.atttypmod) from pg_attribute a
           where a.attrelid = to_regclass('public.applications')
             and a.attname = 'submitted_at' and a.attnum > 0 and not a.attisdropped
         ), '<absent>') = any (array['date', 'timestamp with time zone']::text[])
    then 'PASS' else 'FAIL' end,
    'applications.submitted_at=' || coalesce((
      select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = to_regclass('public.applications')
        and a.attname = 'submitted_at' and a.attnum > 0 and not a.attisdropped
    ), '<absent>') || '; supported=date|timestamp with time zone'

  -- V28 ─ the lifecycle surface P0-RT-10 depends on. The confirm orchestration
  -- restores an opted_out membership through vam063_reactivate_membership
  -- rather than inventing a status or a second membership row, which is only
  -- possible while that function exists, is a hardened definer, and is
  -- executable by service_role. Verified here so P0-RT-10's "no new SQL" claim
  -- is a checked property of this database rather than a note in a README.
  union all
  -- The function is located by OID rather than by name, and every property is
  -- read from the SAME pg_proc row, so has_function_privilege is never handed a
  -- function that does not exist: an absent function yields no row, the exists
  -- is false, and the detail reads <absent>. PostgreSQL does not promise to
  -- short-circuit AND, so a guard written as a conjunct would not have been one.
  select 'V28', 'p0_rt_10_lifecycle_surface_available',
    case when exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure('public.vam063_reactivate_membership(uuid,uuid,text)')::oid
        and p.prosecdef
        and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%'
        and has_function_privilege('service_role', p.oid, 'execute')
    ) then 'PASS' else 'FAIL' end,
    coalesce((
      select 'definer=' || p.prosecdef::text
          || ' path=[' || coalesce(array_to_string(p.proconfig, ','), '') || ']'
          || ' service_role_execute=' || has_function_privilege('service_role', p.oid, 'execute')::text
      from pg_proc p
      where p.oid = to_regprocedure('public.vam063_reactivate_membership(uuid,uuid,text)')::oid
    ), '<absent>')
)
select check_id, check_name, status, detail from results
union all
select 'V**', 'M071_VERIFIED',
       case when exists (select 1 from results where status <> 'PASS') then 'FAIL' else 'PASS' end,
       'failing=' || coalesce((select string_agg(check_id || ' ' || check_name, ', ' order by check_id)
                               from results where status <> 'PASS'), '<none>')
order by 1;

rollback;
