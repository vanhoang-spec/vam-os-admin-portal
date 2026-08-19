-- =============================================================================
-- VAM OS — M073 S12 RENEWAL DECLINE FEEDBACK — PREFLIGHT (READ ONLY)
--
-- Target : STAGING (ljfneyuvpxrmejpxsmpz) ONLY.
--
-- Mutates NOTHING. Opens a transaction and ROLLS BACK unconditionally at the
-- end, so even a future edit that accidentally introduced a write could not
-- commit one. Safe to run any number of times.
--
-- Run this BEFORE apply.sql. Every check here is re-asserted inside apply.sql's
-- own transaction; this file exists so the owner learns about a baseline
-- mismatch before a lock is taken, and so the BEFORE state is on the record.
--
-- A refusal raises. Reaching the final report means every gate passed.
-- =============================================================================

begin;

-- ── 1. Gates ────────────────────────────────────────────────────────────────
do $m073_pre$
declare
  v_n    integer;
  v_src  text;
  v_name text;
  v_nargs     integer;
  v_ndefaults integer;
  v_argtypes  oidvector;
  v_argnames  text[];
  v_retset    boolean;
  v_types     text;
begin
  -- 1.1 Environment. Staging carries the vam062_* lineage; Production does not.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M073 PREFLIGHT REFUSED [ENV_NOT_STAGING]: vam062_* functions absent. This package targets Staging (ljfneyuvpxrmejpxsmpz) only and must never be run on Production.';
  end if;

  -- 1.2 M070 baseline: the table and the invariants M073 must preserve.
  if to_regclass('public.person_season_invites') is null then
    raise exception 'M073 PREFLIGHT REFUSED [M070_MISSING]: public.person_season_invites does not exist.';
  end if;
  foreach v_name in array array[
    'person_season_invites_role_check',
    'person_season_invites_outcome_check',
    'person_season_invites_token_hash_format_check',
    'person_season_invites_outcome_binding_check',
    'person_season_invites_application_binding_check',
    'person_season_invites_expiry_check'
  ] loop
    if not exists (select 1 from pg_constraint
                   where conname = v_name and conrelid = 'public.person_season_invites'::regclass) then
      raise exception 'M073 PREFLIGHT REFUSED [M070_MISSING]: constraint % not found on person_season_invites.', v_name;
    end if;
  end loop;

  -- 1.3 M071 baseline: seven functions, all hardened definers.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M073 PREFLIGHT REFUSED [M071_MISSING]: expected the 7 M071 functions, found %.', v_n;
  end if;

  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%'
    and (not p.prosecdef
         or p.proconfig is null
         or not (array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'));
  if v_src is not null then
    raise exception 'M073 PREFLIGHT REFUSED [M071_HARDENING]: not a pinned-search_path SECURITY DEFINER: %.', v_src;
  end if;


  -- 1.4 M072 compatibility — the ONLY M072 object M073 depends on.
  -- The decline function's FIRST statement resolves the trusted context through
  -- public.vam063_trusted_api_role(), and M073 RECREATES that function. On
  -- Staging the resolver exists only because M072 created it; before M072 it was
  -- absent and M071 refused with [LIFECYCLE_MISSING]. PL/pgSQL validates bodies
  -- syntactically, not by resolving what they call, so a missing resolver would
  -- let apply.sql succeed and every decline fail afterwards at runtime.
  --
  -- Nothing else about M072 is asserted, deliberately. M072 also replaced the
  -- bodies of vam063_transition_membership_atomic and vam063_add_membership_role;
  -- the decline path calls NEITHER, so pinning them here would be unrelated
  -- coupling. Its security properties are M072's business and are NOT asserted:
  -- the resolver is SECURITY INVOKER and STABLE by design, so a definer-hardening
  -- assertion would refuse a correct database.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role';
  if v_n <> 1 then
    raise exception 'M073 PREFLIGHT REFUSED [M072_MISSING]: expected exactly 1 public.vam063_trusted_api_role(), found %. Apply and verify M072 on Staging first.', v_n;
  end if;

  select p.pronargs, p.proargnames, p.proretset
    into v_nargs, v_argnames, v_retset
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role';

  if v_nargs <> 0 then
    raise exception 'M073 PREFLIGHT REFUSED [M072_SIGNATURE]: expected vam063_trusted_api_role() with no arguments, found %.', v_nargs;
  end if;
  if not coalesce(v_retset, false) then
    raise exception 'M073 PREFLIGHT REFUSED [M072_SHAPE]: vam063_trusted_api_role() does not return a set; the decline body selects FROM it.';
  end if;
  if v_argnames is null or not ('api_role' = any (v_argnames)) then
    raise exception 'M073 PREFLIGHT REFUSED [M072_SHAPE]: vam063_trusted_api_role() does not expose an api_role column; the decline body reads r.api_role.';
  end if;

  -- 1.5 Exactly one decline signature, and it is the reviewed predecessor.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if v_n <> 1 then
    raise exception 'M073 PREFLIGHT REFUSED [UNEXPECTED_OVERLOAD]: expected exactly 1 decline signature, found %. Resolve by hand before applying.', v_n;
  end if;

  -- Catalog identity, NOT a rendered string.
  -- pg_get_function_identity_arguments() renders PARAMETER NAMES as well as
  -- types ("p_token_hash text"), so comparing it against a bare type list
  -- refuses a perfectly correct database — which is exactly what the first
  -- Staging preflight hit. pronargs / proargtypes / pronargdefaults are the
  -- catalog's own notion of a signature and carry no formatting whatsoever.
  select p.pronargs, p.pronargdefaults, p.proargtypes, p.proargnames, p.prosrc
    into v_nargs, v_ndefaults, v_argtypes, v_argnames, v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';

  v_types := coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                       from unnest(v_argtypes::oid[]) with ordinality u(t, ord)), '<none>');
  if v_nargs <> 1
     or v_argtypes[0] is distinct from 'pg_catalog.text'::regtype::oid
     or v_ndefaults <> 0
  then
    raise exception 'M073 PREFLIGHT REFUSED [PREDECESSOR_SIGNATURE]: expected exactly one text argument with no default; found % argument(s) [%] and % default(s).',
      v_nargs, v_types, v_ndefaults;
  end if;

  -- The parameter NAME is part of the contract, asserted separately from type
  -- identity so a failure says which of the two moved: PostgREST resolves this
  -- RPC by NAMED argument, so a rename breaks the runtime while leaving the
  -- type identity untouched.
  if v_argnames is null or v_argnames[1] is distinct from 'p_token_hash' then
    raise exception 'M073 PREFLIGHT REFUSED [PREDECESSOR_PARAM_NAME]: expected the first parameter to be named p_token_hash, found %.',
      coalesce(v_argnames[1], '<unnamed>');
  end if;

  if v_src is null
     or position('VAM071 decline refused [CLAIM_LOST]' in v_src) = 0
     or position('vam071_accepted_renewal_exists' in v_src) = 0
     or position('vam071_renewal_identity_lock' in v_src) = 0
     or position('vam063_opt_out_membership' in v_src) = 0
     or position('deferred_actor_unauthorized' in v_src) = 0
  then
    raise exception 'M073 PREFLIGHT REFUSED [PREDECESSOR_BODY]: the decline body is not the reviewed M071 predecessor.';
  end if;
  if position('decline_feedback' in v_src) > 0 then
    raise exception 'M073 PREFLIGHT REFUSED [PREDECESSOR_BODY]: the decline body already references decline_feedback — M073 may already be applied.';
  end if;

  -- 1.6 The predecessor must not already be reachable by a web role.
  select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ', ') into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
    and acl.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated');
  if v_src is not null then
    raise exception 'M073 PREFLIGHT REFUSED [ACL_BASELINE]: the decline function is already executable by %. The trusted boundary has diverged.', v_src;
  end if;

  -- 1.7 The column must be absent.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'person_season_invites'
               and column_name = 'decline_feedback') then
    raise exception 'M073 PREFLIGHT REFUSED [COLUMN_PRESENT]: person_season_invites.decline_feedback already exists.';
  end if;
  if exists (select 1 from pg_constraint
             where conname = 'person_season_invites_decline_feedback_binding_check'
               and conrelid = 'public.person_season_invites'::regclass) then
    raise exception 'M073 PREFLIGHT REFUSED [CONSTRAINT_PRESENT]: the M073 binding constraint already exists.';
  end if;

  -- 1.8 No incompatible existing data.
  if to_regclass('public.applications') is not null then
    execute 'select count(*) from public.applications where status = ''declined_renewal''' into v_n;
    if v_n <> 0 then
      raise exception 'M073 PREFLIGHT REFUSED [GHOST_ROWS]: % applications rows carry status declined_renewal. applications_status_check should have made this impossible; triage before applying.', v_n;
    end if;
  end if;

  select count(*) into v_n
  from public.person_season_invites
  where (outcome is not distinct from 'accepted') <> (application_id is not null);
  if v_n <> 0 then
    raise exception 'M073 PREFLIGHT REFUSED [INVARIANT_BROKEN]: % invites violate the accepted/declined application binding.', v_n;
  end if;

  select count(*) into v_n
  from public.person_season_invites
  where (submitted_at is null) <> (outcome is null);
  if v_n <> 0 then
    raise exception 'M073 PREFLIGHT REFUSED [INVARIANT_BROKEN]: % invites violate the outcome binding.', v_n;
  end if;

  raise notice 'M073 PREFLIGHT: all gates passed.';
end
$m073_pre$;

-- ── 2. BEFORE-state report, for the record ──────────────────────────────────
select
  current_database()                                                        as db,
  current_user                                                              as run_as,
  now()                                                                     as checked_at,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'vam062\_%')         as is_staging,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'vam071\_%')                as vam071_function_count,
  -- DISPLAY ONLY, never a gate: pg_get_function_identity_arguments() renders
  -- parameter NAMES alongside types, so it is useful to a human and unusable
  -- as a comparison. The catalog identity beside it is what the gates assert.
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_signature_rendered_before,
  (select p.pronargs || ' arg(s) [' ||
          coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                    from unnest(p.proargtypes::oid[]) with ordinality u(t, ord)), '<none>') ||
          '] ' || p.pronargdefaults || ' default(s)'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_identity_before,
  (select array_to_string(p.proargnames[1:p.pronargs], ', ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_param_names_before,
  (select md5(p.prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined')
                                                                            as decline_body_md5_before,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                                  as decline_feedback_column_before,
  (select count(*) from public.person_season_invites)                       as invites_total,
  (select count(*) from public.person_season_invites where outcome = 'accepted')  as invites_accepted,
  (select count(*) from public.person_season_invites where outcome = 'declined')  as invites_declined,
  (select count(*) from public.person_season_invites
   where submitted_at is null and revoked_at is null and expires_at > now())      as invites_live;

-- ── 3. Grants on the decline entry point, BEFORE ────────────────────────────
select
  coalesce(r.rolname, 'PUBLIC') as grantee,
  acl.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
order by 1, 2;

-- Nothing above writes. This is belt and braces.
rollback;
