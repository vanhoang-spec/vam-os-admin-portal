-- =============================================================================
-- VAM OS — M073 S12 RENEWAL DECLINE FEEDBACK — VERIFIER (READ ONLY)
--
-- Target : STAGING (ljfneyuvpxrmejpxsmpz) ONLY. Run AFTER apply.sql.
--
-- Mutates NOTHING and ROLLS BACK unconditionally. The one place it needs to
-- prove a constraint actually rejects a row, it does so inside a SAVEPOINT that
-- is released by ROLLBACK TO, so no row is ever left behind and no sequence,
-- trigger or audit row is disturbed. It never calls the decline RPC, so no
-- invite is consumed and no membership is touched.
--
-- Raises on the first failure. Reaching the final PASS report means every
-- assertion held.
-- =============================================================================

begin;

do $m073_verify$
declare
  v_n      integer;
  v_txt    text;
  v_args   text;
  v_ok     boolean;
  v_invite uuid;
  v_nargs     integer;
  v_ndefaults integer;
  v_argtypes  oidvector;
  v_argnames  text[];
  v_retset    boolean;
  v_types     text;
begin
  -- ── 1. Environment is still Staging ──────────────────────────────────────
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M073 VERIFY FAILED [ENV_NOT_STAGING]: vam062_* functions absent.';
  end if;

  -- ── 2. Column exists with the correct type and nullability ───────────────
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'person_season_invites'
      and column_name = 'decline_feedback'
      and data_type = 'text'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'M073 VERIFY FAILED [COLUMN]: decline_feedback is not a nullable text column with no default.';
  end if;

  -- ── 3. Binding constraint exists AND actually rejects ────────────────────
  if not exists (
    select 1 from pg_constraint
    where conname = 'person_season_invites_decline_feedback_binding_check'
      and conrelid = 'public.person_season_invites'::regclass
      and contype = 'c'
  ) then
    raise exception 'M073 VERIFY FAILED [CONSTRAINT]: the binding constraint is absent.';
  end if;

  -- Prove it bites. An UPDATE that would attach feedback to a NON-declined
  -- invite must raise 23514. Done under a savepoint and rolled straight back,
  -- so the row is unchanged whether the constraint works or not.
  select id into v_invite
  from public.person_season_invites
  where outcome is distinct from 'declined'
  limit 1;

  if v_invite is null then
    raise notice 'M073 VERIFY: no non-declined invite available; constraint enforcement proved by definition only.';
  else
    v_ok := false;
    begin
      update public.person_season_invites
         set decline_feedback = 'M073_VERIFIER_MUST_NOT_PERSIST'
       where id = v_invite;
    exception when check_violation then
      v_ok := true;
    end;
    -- Undo unconditionally: if the constraint did NOT fire, the row was
    -- modified and must not survive this verifier even for the rest of the
    -- transaction.
    update public.person_season_invites
       set decline_feedback = null
     where id = v_invite and decline_feedback = 'M073_VERIFIER_MUST_NOT_PERSIST';

    if not v_ok then
      raise exception 'M073 VERIFY FAILED [CONSTRAINT_INERT]: feedback was accepted on a non-declined invite.';
    end if;
  end if;

  -- ── 3b. The M072 resolver the recreated body calls is still present ──────
  -- M073's decline body resolves the trusted context through this function.
  -- Asserted after apply because the recreate is what re-binds the call, and a
  -- resolver dropped between apply and verify would leave a decline path that
  -- fails only when a real mentor uses it. Scope is deliberately this one
  -- object: M073 calls neither body M072 replaced.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role';
  if v_n <> 1 then
    raise exception 'M073 VERIFY FAILED [M072_MISSING]: expected exactly 1 public.vam063_trusted_api_role(), found %.', v_n;
  end if;

  select p.pronargs, p.proargnames, p.proretset
    into v_nargs, v_argnames, v_retset
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role';

  if v_nargs <> 0 then
    raise exception 'M073 VERIFY FAILED [M072_SIGNATURE]: expected vam063_trusted_api_role() with no arguments, found %.', v_nargs;
  end if;
  if not coalesce(v_retset, false) then
    raise exception 'M073 VERIFY FAILED [M072_SHAPE]: vam063_trusted_api_role() does not return a set; the decline body selects FROM it.';
  end if;
  if v_argnames is null or not ('api_role' = any (v_argnames)) then
    raise exception 'M073 VERIFY FAILED [M072_SHAPE]: vam063_trusted_api_role() does not expose an api_role column; the decline body reads r.api_role.';
  end if;

  -- The recreated body must still route through it rather than reading a GUC
  -- directly — that indirection is the whole point of M072.
  select p.prosrc into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if position('vam063_trusted_api_role' in coalesce(v_args, '')) = 0 then
    raise exception 'M073 VERIFY FAILED [M072_BINDING]: the recreated decline body does not resolve the trusted context through vam063_trusted_api_role().';
  end if;

  -- ── 4. Exactly the intended decline signature is callable ────────────────
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if v_n <> 1 then
    raise exception 'M073 VERIFY FAILED [OVERLOAD]: % decline signatures exist; exactly 1 is intended.', v_n;
  end if;

  -- Catalog identity, for the same reason the predecessor gate uses it.
  select p.pronargs, p.pronargdefaults, p.proargtypes, p.proargnames
    into v_nargs, v_ndefaults, v_argtypes, v_argnames
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';

  v_types := coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                       from unnest(v_argtypes::oid[]) with ordinality u(t, ord)), '<none>');
  if v_nargs <> 2
     or v_argtypes[0] is distinct from 'pg_catalog.text'::regtype::oid
     or v_argtypes[1] is distinct from 'pg_catalog.text'::regtype::oid
     or v_ndefaults <> 1
  then
    raise exception 'M073 VERIFY FAILED [SIGNATURE]: expected two text arguments with exactly one default; found % argument(s) [%] and % default(s).',
      v_nargs, v_types, v_ndefaults;
  end if;

  -- Both parameter names are part of the contract: the runtime calls this RPC
  -- with named arguments p_token_hash and p_decline_feedback.
  if v_argnames is null
     or v_argnames[1] is distinct from 'p_token_hash'
     or v_argnames[2] is distinct from 'p_decline_feedback'
  then
    raise exception 'M073 VERIFY FAILED [PARAM_NAMES]: expected (p_token_hash, p_decline_feedback), found (%, %).',
      coalesce(v_argnames[1], '<unnamed>'), coalesce(v_argnames[2], '<unnamed>');
  end if;

  -- The obsolete one-argument form must be gone, not merely shadowed.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
      and p.pronargs = 1
      and p.proargtypes[0] = 'pg_catalog.text'::regtype::oid
  ) then
    raise exception 'M073 VERIFY FAILED [OBSOLETE_SIGNATURE]: the one-argument decline function still exists.';
  end if;

  -- ── 5. The new body writes feedback in the claim UPDATE and nowhere else ─
  select p.prosrc into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';

  if position('decline_feedback = v_feedback' in v_txt) = 0 then
    raise exception 'M073 VERIFY FAILED [BODY]: the claim UPDATE does not set decline_feedback.';
  end if;
  if position('nullif(btrim(coalesce(p_decline_feedback' in v_txt) = 0 then
    raise exception 'M073 VERIFY FAILED [BODY]: feedback is not normalised inside the function.';
  end if;
  -- Exactly one UPDATE of the invites table: the single winner claim.
  select count(*) into v_n
  from regexp_matches(v_txt, 'update\s+public\.person_season_invites', 'gi') m;
  if v_n <> 1 then
    raise exception 'M073 VERIFY FAILED [BODY]: expected exactly 1 UPDATE of person_season_invites, found %.', v_n;
  end if;
  -- The single-winner predicate must still be there.
  if position('and i.submitted_at is null' in v_txt) = 0 then
    raise exception 'M073 VERIFY FAILED [BODY]: the single-winner claim predicate is missing.';
  end if;
  -- It must not have grown an applications write.
  if position('insert into public.applications' in lower(v_txt)) > 0
     or position('declined_renewal' in v_txt) > 0 then
    raise exception 'M073 VERIFY FAILED [BODY]: the decline path writes to applications.';
  end if;

  -- ── 6. Security properties survived the recreate ─────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
      and p.prosecdef
      and p.proconfig is not null
      and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'
      and p.provolatile = 'v'
      and not p.proisstrict
  ) then
    raise exception 'M073 VERIFY FAILED [HARDENING]: expected a VOLATILE, non-STRICT SECURITY DEFINER with search_path=public, pg_temp.';
  end if;

  -- STRICT would be a silent correctness bug, not merely a style issue: a NULL
  -- p_decline_feedback would return NULL without declining anything.
  -- Asserted above; called out here because it is the non-obvious one.

  -- ── 7. Web roles cannot reach the entry point or the helpers ─────────────
  select string_agg(distinct p.proname || ' -> ' || coalesce(r.rolname, 'PUBLIC'), ', ') into v_txt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and p.proname like 'vam071\_%'
    and acl.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated');
  if v_txt is not null then
    raise exception 'M073 VERIFY FAILED [ACL]: web-reachable M071 functions: %.', v_txt;
  end if;

  -- The two helpers must be unreachable from the principals M071 FORBIDS:
  -- anon, authenticated and service_role — plus PUBLIC, checked separately
  -- below. This is written the way M071's own post-condition writes it,
  -- because M071 is the contract and this package must not invent a stricter
  -- one.
  --
  -- postgres / the function OWNER is deliberately NOT in that list. The
  -- previous form of this assertion flagged ANY principal holding EXECUTE,
  -- which no PostgreSQL database can satisfy: REVOKE ... FROM public, anon,
  -- authenticated, service_role leaves proacl non-null with the owner's own
  -- entry (postgres=X/postgres) intact, and acldefault('f', proowner)
  -- supplies that same owner grant when proacl is NULL. Owner EXECUTE is a
  -- property of OWNERSHIP, not a grant M071 made or M073 could remove, and it
  -- is not web reachability. Testing 'any executable principal' conflated the
  -- two and would have failed on a pristine post-M071 database.
  --
  -- has_function_privilege is used for named roles rather than aclexplode
  -- because it answers the question that matters — can this role execute it,
  -- including through role membership — rather than only listing direct ACL
  -- entries.
  if to_regprocedure('public.vam071_renewal_identity_lock(uuid,uuid,text)') is null
     or to_regprocedure('public.vam071_accepted_renewal_exists(uuid,uuid,text)') is null then
    raise exception 'M073 VERIFY FAILED [HELPER_MISSING]: an M071 helper is absent; its ACL cannot be evaluated.';
  end if;

  select string_agg(f || ' -> ' || r, ', ' order by f, r) into v_txt
  from unnest(array[
         'public.vam071_renewal_identity_lock(uuid,uuid,text)',
         'public.vam071_accepted_renewal_exists(uuid,uuid,text)'
       ]::text[]) f,
       unnest(array['anon', 'authenticated', 'service_role']::text[]) r
  where has_function_privilege(r, f, 'execute');
  if v_txt is not null then
    raise exception 'M073 VERIFY FAILED [ACL_HELPERS]: helpers are executable by %.', v_txt;
  end if;

  -- PUBLIC separately: has_function_privilege takes a ROLE NAME and PUBLIC is
  -- not a role. aclexplode reports a PUBLIC grant as grantee = 0.
  select string_agg(distinct p.proname::text, ', ') into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where n.nspname = 'public'
    and p.proname in ('vam071_renewal_identity_lock', 'vam071_accepted_renewal_exists')
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE';
  if v_txt is not null then
    raise exception 'M073 VERIFY FAILED [ACL_HELPERS_PUBLIC]: PUBLIC can execute %.', v_txt;
  end if;

  -- service_role must still be able to execute the decline entry point.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
      and acl.privilege_type = 'EXECUTE' and r.rolname = 'service_role'
  ) then
    raise exception 'M073 VERIFY FAILED [ACL]: service_role cannot execute the decline entry point.';
  end if;

  -- ── 8. M070 / M071 invariants intact ─────────────────────────────────────
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M073 VERIFY FAILED [OBJECT_COUNT]: expected 7 vam071_* functions, found %.', v_n;
  end if;

  foreach v_txt in array array[
    'person_season_invites_role_check',
    'person_season_invites_outcome_check',
    'person_season_invites_token_hash_format_check',
    'person_season_invites_outcome_binding_check',
    'person_season_invites_application_binding_check',
    'person_season_invites_expiry_check',
    'person_season_invites_decline_feedback_binding_check'
  ] loop
    if not exists (select 1 from pg_constraint
                   where conname = v_txt and conrelid = 'public.person_season_invites'::regclass) then
      raise exception 'M073 VERIFY FAILED [CONSTRAINT]: % is absent.', v_txt;
    end if;
  end loop;

  select count(*) into v_n
  from public.person_season_invites
  where (outcome is not distinct from 'accepted') <> (application_id is not null)
     or (submitted_at is null) <> (outcome is null)
     or (decline_feedback is not null and outcome is distinct from 'declined');
  if v_n <> 0 then
    raise exception 'M073 VERIFY FAILED [INVARIANT_BROKEN]: % invites violate a binding.', v_n;
  end if;

  -- No ghost applications row was created by anything.
  if to_regclass('public.applications') is not null then
    execute 'select count(*) from public.applications where status = ''declined_renewal''' into v_n;
    if v_n <> 0 then
      raise exception 'M073 VERIFY FAILED [GHOST_ROWS]: % applications rows carry status declined_renewal.', v_n;
    end if;
  end if;

  raise notice 'M073 VERIFY: PASS.';
end
$m073_verify$;

-- ── 9. AFTER-state report ───────────────────────────────────────────────────
select
  current_database()                                                        as db,
  now()                                                                     as verified_at,
  -- DISPLAY ONLY, never a gate: pg_get_function_identity_arguments() renders
  -- parameter NAMES alongside types, so it is useful to a human and unusable
  -- as a comparison. The catalog identity beside it is what the gates assert.
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_signature_rendered_after,
  (select p.pronargs || ' arg(s) [' ||
          coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                    from unnest(p.proargtypes::oid[]) with ordinality u(t, ord)), '<none>') ||
          '] ' || p.pronargdefaults || ' default(s)'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_identity_after,
  (select array_to_string(p.proargnames[1:p.pronargs], ', ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_param_names_after,
  (select md5(p.prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_body_md5_after,
  (select data_type || '/' || is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                                  as decline_feedback_column,
  (select count(*) from public.person_season_invites)                       as invites_total,
  (select count(*) from public.person_season_invites where outcome = 'declined')   as invites_declined,
  (select count(*) from public.person_season_invites where decline_feedback is not null) as invites_with_feedback,
  (select count(*) from public.person_season_invites
   where submitted_at is null and revoked_at is null and expires_at > now())      as invites_still_live,
  -- Helper reachability by principal, as evidence rather than as a verdict.
  (select string_agg(f || '/' || r, ', ' order by f, r)
   from unnest(array['public.vam071_renewal_identity_lock(uuid,uuid,text)',
                     'public.vam071_accepted_renewal_exists(uuid,uuid,text)']::text[]) f,
        unnest(array['anon', 'authenticated', 'service_role']::text[]) r
   where has_function_privilege(r, f, 'execute'))                          as helpers_reachable_by_forbidden_roles;

-- Read-only by construction; this makes it read-only by force.
rollback;
