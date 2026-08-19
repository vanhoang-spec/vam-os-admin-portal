-- =============================================================================
-- VAM OS — M073 S12 RENEWAL DECLINE FEEDBACK — APPLY
--
-- Target : STAGING (ljfneyuvpxrmejpxsmpz) ONLY.
--
-- ONE transaction. Adds ONE nullable column, ONE binding constraint, and
-- REPLACES the decline entry point with a two-argument signature. It creates no
-- table, no index, no policy, no seed row, no invite, and touches no row of
-- application or membership data.
--
-- WHY THIS EXISTS
-- The S12 renewal UI collects optional decline feedback. The implementation
-- under review persisted it by INSERTing an unlinked public.applications row
-- with status 'declined_renewal'. That value is not in applications_status_check
-- (migration 060 fixes the list at 20 values and no migration adds it), so the
-- INSERT could never succeed; the runtime discarded the result, so the loss was
-- silent. Even had the status been admitted, M070's
-- person_season_invites_application_binding_check makes application_id NOT NULL
-- if and only if outcome = 'accepted', so a decline's row could never be linked
-- and would be orphaned by construction.
--
-- The feedback therefore belongs on the invite, written by the same single
-- winner UPDATE that claims it.
--
-- WHY THE OLD SIGNATURE IS DROPPED RATHER THAN OVERLOADED
-- Adding p_decline_feedback with a DEFAULT to a second function would leave
-- vam071_submit_renewal_declined(text) and (text, text) both resolvable, and a
-- one-argument call would then fail as ambiguous rather than pick one. Worse,
-- the one-argument version would remain a callable trusted entry point that
-- silently discards feedback. Section 3 DROPs it, so exactly one decline
-- signature exists on the database when this transaction commits.
--
-- REFUSES on any of:
--   [ENV_NOT_STAGING]        vam062_* functions absent — this is not Staging
--   [M070_MISSING]           person_season_invites or its binding constraints
--                            are not present
--   [M071_MISSING]           the five M071 entry points are not all present
--   [M072_MISSING]           public.vam063_trusted_api_role() is absent — the
--                            resolver the recreated decline body calls
--   [M072_SIGNATURE]         the resolver does not take zero arguments
--   [M072_SHAPE]             the resolver does not expose api_role
--   [PREDECESSOR_SIGNATURE]  the decline function is not exactly the reviewed
--                            one-argument predecessor
--   [PREDECESSOR_BODY]       the decline body is not the reviewed predecessor
--   [UNEXPECTED_OVERLOAD]    more than one decline signature already exists
--   [COLUMN_PRESENT]         decline_feedback already exists
--   [GHOST_ROWS]             applications rows with status 'declined_renewal'
--                            exist and must be triaged by a human first
--   [INVARIANT_BROKEN]       an existing invite violates the accepted/declined
--                            application binding
--
-- Section 0 re-asserts every preflight check INSIDE this transaction, so a
-- baseline that changed between preflight and apply aborts before any DDL.
-- preflight.sql is therefore not a prerequisite; it exists so the owner learns
-- about a mismatch before a lock is taken.
--
-- LOCK IMPLICATIONS
-- ADD COLUMN with no default and no rewrite is metadata-only in PostgreSQL 11+.
-- ADD CONSTRAINT ... CHECK takes ACCESS EXCLUSIVE on person_season_invites and
-- scans it; the table holds one row per renewal invite, so the scan is trivial.
-- DROP/CREATE FUNCTION takes no table lock.
--
-- Authorization phrase for staging: AUTHORIZE STAGING RENEWAL DECLINE FEEDBACK
-- =============================================================================

begin;

-- ── 0. Guards, re-asserted inside the transaction ───────────────────────────
do $m073_guard$
declare
  v_n       integer;
  v_src     text;
  v_nargs     integer;
  v_ndefaults integer;
  v_argtypes  oidvector;
  v_argnames  text[];
  v_retset    boolean;
  v_types     text;
begin
  -- Staging carries the vam062_* lineage; Production does not. This is the same
  -- marker M070 and M071 use, with the sense inverted because this package is
  -- the Staging one.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M073 ABORTED [ENV_NOT_STAGING]: vam062_* functions absent — this is not Staging.';
  end if;

  -- M070 baseline.
  if to_regclass('public.person_season_invites') is null then
    raise exception 'M073 ABORTED [M070_MISSING]: public.person_season_invites does not exist.';
  end if;
  foreach v_src in array array[
    'person_season_invites_outcome_binding_check',
    'person_season_invites_application_binding_check',
    'person_season_invites_token_hash_format_check'
  ] loop
    if not exists (select 1 from pg_constraint
                   where conname = v_src and conrelid = 'public.person_season_invites'::regclass) then
      raise exception 'M073 ABORTED [M070_MISSING]: constraint % not found.', v_src;
    end if;
  end loop;

  -- M071 baseline: the five entry points and the two helpers.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M073 ABORTED [M071_MISSING]: expected the 7 M071 functions, found %.', v_n;
  end if;


  -- M072 compatibility — the ONLY M072 object M073 depends on.
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
    raise exception 'M073 ABORTED [M072_MISSING]: expected exactly 1 public.vam063_trusted_api_role(), found %. Apply and verify M072 on Staging first.', v_n;
  end if;

  select p.pronargs, p.proargnames, p.proretset
    into v_nargs, v_argnames, v_retset
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role';

  if v_nargs <> 0 then
    raise exception 'M073 ABORTED [M072_SIGNATURE]: expected vam063_trusted_api_role() with no arguments, found %.', v_nargs;
  end if;
  if not coalesce(v_retset, false) then
    raise exception 'M073 ABORTED [M072_SHAPE]: vam063_trusted_api_role() does not return a set; the decline body selects FROM it.';
  end if;
  if v_argnames is null or not ('api_role' = any (v_argnames)) then
    raise exception 'M073 ABORTED [M072_SHAPE]: vam063_trusted_api_role() does not expose an api_role column; the decline body reads r.api_role.';
  end if;

  -- Exactly one decline signature, and it is the reviewed one-argument form.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if v_n <> 1 then
    raise exception 'M073 ABORTED [UNEXPECTED_OVERLOAD]: expected exactly 1 decline signature, found %.', v_n;
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
    raise exception 'M073 ABORTED [PREDECESSOR_SIGNATURE]: expected exactly one text argument with no default; found % argument(s) [%] and % default(s).',
      v_nargs, v_types, v_ndefaults;
  end if;

  -- The parameter NAME is part of the contract, asserted separately from type
  -- identity so a failure says which of the two moved: PostgREST resolves this
  -- RPC by NAMED argument, so a rename breaks the runtime while leaving the
  -- type identity untouched.
  if v_argnames is null or v_argnames[1] is distinct from 'p_token_hash' then
    raise exception 'M073 ABORTED [PREDECESSOR_PARAM_NAME]: expected the first parameter to be named p_token_hash, found %.',
      coalesce(v_argnames[1], '<unnamed>');
  end if;

  -- Structural pin on the reviewed predecessor. Deliberately not a whole-body
  -- hash: a hash refuses on a line ending or a comment reflow and teaches the
  -- operator to bypass the check. These markers are the behaviour that matters.
  if v_src is null
     or position('VAM071 decline refused [CLAIM_LOST]' in v_src) = 0
     or position('vam071_accepted_renewal_exists' in v_src) = 0
     or position('vam071_renewal_identity_lock' in v_src) = 0
     or position('vam063_opt_out_membership' in v_src) = 0
     or position('deferred_actor_unauthorized' in v_src) = 0
  then
    raise exception 'M073 ABORTED [PREDECESSOR_BODY]: decline body is not the reviewed M071 predecessor.';
  end if;
  if position('decline_feedback' in v_src) > 0 then
    raise exception 'M073 ABORTED [PREDECESSOR_BODY]: decline body already references decline_feedback.';
  end if;

  -- The column must not already exist.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'person_season_invites'
               and column_name = 'decline_feedback') then
    raise exception 'M073 ABORTED [COLUMN_PRESENT]: decline_feedback already exists.';
  end if;

  -- The ghost rows the previous implementation tried to write must not exist.
  -- They cannot (applications_status_check forbids the status), so a non-zero
  -- count means the constraint itself has diverged and a human must look.
  if to_regclass('public.applications') is not null then
    execute 'select count(*) from public.applications where status = ''declined_renewal''' into v_n;
    if v_n <> 0 then
      raise exception 'M073 ABORTED [GHOST_ROWS]: % applications rows carry status declined_renewal.', v_n;
    end if;
  end if;

  -- Existing invites must already satisfy the binding this package preserves.
  select count(*) into v_n
  from public.person_season_invites
  where (outcome is not distinct from 'accepted') <> (application_id is not null);
  if v_n <> 0 then
    raise exception 'M073 ABORTED [INVARIANT_BROKEN]: % invites violate the application binding.', v_n;
  end if;
end
$m073_guard$;

-- ── 1. The column ───────────────────────────────────────────────────────────
-- Nullable text. NULL means "the mentor said nothing", which is the common
-- case and is deliberately distinguishable from '' — see the runtime's
-- normalizeOptionalFeedback, which folds blank input to NULL before it ever
-- reaches this column so the two can never both appear.
alter table public.person_season_invites
  add column decline_feedback text;

comment on column public.person_season_invites.decline_feedback is
  'M073. Optional free text a mentor may leave when DECLINING a Season 12 renewal. Written only by vam071_submit_renewal_declined, in the same UPDATE that claims the invite. NULL when nothing was said; never an empty string. Operational evidence — never a mentor_profiles field and never part of the renewal profile diff.';

-- ── 2. The binding constraint ───────────────────────────────────────────────
-- Feedback is meaningless on an invite that was not declined. Written in the
-- same shape as M070's sibling bindings so the table keeps stating its contract
-- structurally rather than relying on the one function that writes it.
alter table public.person_season_invites
  add constraint person_season_invites_decline_feedback_binding_check
  check (decline_feedback is null or outcome is not distinct from 'declined');

-- ── 3. The decline entry point ──────────────────────────────────────────────
-- DROP then CREATE, never CREATE OR REPLACE: the argument list changes, so a
-- replace would leave the old signature callable alongside the new one.
drop function public.vam071_submit_renewal_declined(text);

create function public.vam071_submit_renewal_declined(
  p_token_hash       text,
  p_decline_feedback text default null
) returns table (
  outcome_status     text,
  invite_id          uuid,
  membership_outcome text,
  membership_id      uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role   text;
  v_inv        record;
  v_mem        record;
  v_now        timestamptz;
  v_rows       integer;
  v_mem_out    text;
  v_mem_id     uuid;
  v_feedback   text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise log 'VAM071 decline refused [TOKEN_MALFORMED]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- M073. Normalised HERE as well as in the runtime, because the runtime is not
  -- the only thing that can reach a trusted entry point. '' and whitespace mean
  -- "nothing was said" and are stored as NULL; anything else is preserved
  -- exactly, including internal newlines. No length ceiling is imposed: the
  -- column is `text`, the repository sets no free-text limit anywhere else, and
  -- inventing one here would silently truncate a mentor's parting explanation.
  v_feedback := nullif(btrim(coalesce(p_decline_feedback, '')), '');

  select i.* into v_inv
  from public.person_season_invites i
  where i.token_hash = p_token_hash
  for update;

  if v_inv.id is null then
    raise log 'VAM071 decline refused [TOKEN_NOT_FOUND]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  if v_inv.role is distinct from 'mentor' then
    raise log 'VAM071 decline refused [ROLE_NOT_MENTOR] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  perform public.vam071_renewal_identity_lock(v_inv.person_id, v_inv.season_id, v_inv.role);

  if v_inv.revoked_at is not null then
    raise log 'VAM071 decline refused [INVITE_REVOKED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    raise log 'VAM071 decline refused [INVITE_EXPIRED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.submitted_at is not null then
    raise log 'VAM071 decline refused [ALREADY_SUBMITTED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- P0-RT-2. Refuses BOTH the decline record AND the membership mutation,
  -- because it refuses before either is attempted.
  if public.vam071_accepted_renewal_exists(v_inv.person_id, v_inv.season_id, v_inv.role) then
    raise log 'VAM071 decline refused [ACCEPTED_RENEWAL_EXISTS] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  v_now := now();

  -- The same single-winner claim the accept path uses. application_id stays
  -- NULL, which person_season_invites_application_binding_check requires for
  -- a declined outcome and would refuse for any other combination.
  --
  -- M073 adds decline_feedback to THIS statement and to no other. The claim
  -- predicate `submitted_at is null` is therefore the feedback's concurrency
  -- control too: a replay matches zero rows and raises [CLAIM_LOST], so the
  -- feedback cannot be written twice, cannot be appended to a claimed invite,
  -- and cannot survive a decline that did not win.
  update public.person_season_invites i
     set submitted_at     = v_now,
         outcome          = 'declined',
         decline_feedback = v_feedback
   where i.id = v_inv.id
     and i.submitted_at is null;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise log 'VAM071 decline refused [CLAIM_LOST] invite=% rows=%', v_inv.id, v_rows;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- The membership half. Resolved strictly by the INVITE's season, so Season
  -- 11 is unreachable from here by construction rather than by a filter that
  -- could be edited out.
  select m.id, m.status into v_mem
  from public.person_season_memberships m
  where m.person_id = v_inv.person_id
    and m.season_id = v_inv.season_id
    and m.role      = v_inv.role
  for update;

  if v_mem.id is null then
    v_mem_out := 'no_membership';
    v_mem_id  := null;
  elsif v_mem.status = 'opted_out' then
    -- Already where a decline would put it. vam063 would return noop; not
    -- calling it at all avoids a second identical log entry.
    v_mem_out := 'already_opted_out';
    v_mem_id  := v_mem.id;
  elsif v_mem.status <> all (array['active', 'paused', 'invited']) then
    -- withdrawn / completed / graduated / cancelled. vam063_opt_out_membership
    -- admits none of these as a source state and would raise, taking the
    -- decline down with it. A terminal membership is left exactly as it is.
    v_mem_out := 'not_eligible';
    v_mem_id  := v_mem.id;
  elsif not exists (
      select 1 from public.admin_users u
      where u.id = v_inv.created_by and u.status = 'active'
    )
    or not public.vam063_authorized_for_scope(v_inv.created_by, v_inv.program_id, v_inv.season_id)
  then
    v_mem_out := 'deferred_actor_unauthorized';
    v_mem_id  := v_mem.id;
    raise log 'VAM071 decline recorded, membership opt-out deferred [ACTOR_UNAUTHORIZED] invite=% membership=% created_by=%',
      v_inv.id, v_mem.id, v_inv.created_by;
  else
    perform public.vam063_opt_out_membership(
      v_inv.created_by,
      v_mem.id,
      'Season 12 renewal declined by the mentor through renewal invite ' || v_inv.id::text
    );
    v_mem_out := 'opted_out';
    v_mem_id  := v_mem.id;
  end if;

  -- vam063 writes its own audited opt_out_membership row under a value the
  -- vocabulary already admits. Nothing further is written here: no new
  -- lifecycle status, no new action_type, and no admin_audit_log row for an
  -- action no admin performed.
  return query select 'declined'::text, v_inv.id, v_mem_out, v_mem_id;
end
$$;

-- ── 4. Grants ───────────────────────────────────────────────────────────────
-- The new signature inherits nothing. Everything is revoked from every role
-- first, including service_role and the PUBLIC default, and EXECUTE is then
-- granted to service_role alone — exactly the boundary M071 section 8 sets for
-- the signature this one replaces.
revoke all on function
  public.vam071_submit_renewal_declined(text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.vam071_submit_renewal_declined(text, text)
to service_role;

-- ── 5. Post-conditions ──────────────────────────────────────────────────────
do $m073_post$
declare
  v_n    integer;
  v_txt  text;
  v_nargs     integer;
  v_ndefaults integer;
  v_argtypes  oidvector;
  v_argnames  text[];
  v_types     text;
begin
  -- Exactly one decline signature, and it is the two-argument one.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if v_n <> 1 then
    raise exception 'M073 ABORTED [OVERLOAD_SURVIVED]: % decline signatures exist after apply.', v_n;
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
    raise exception 'M073 ABORTED [SIGNATURE]: expected two text arguments with exactly one default; found % argument(s) [%] and % default(s).',
      v_nargs, v_types, v_ndefaults;
  end if;

  -- Both parameter names are part of the contract: the runtime calls this RPC
  -- with named arguments p_token_hash and p_decline_feedback.
  if v_argnames is null
     or v_argnames[1] is distinct from 'p_token_hash'
     or v_argnames[2] is distinct from 'p_decline_feedback'
  then
    raise exception 'M073 ABORTED [PARAM_NAMES]: expected (p_token_hash, p_decline_feedback), found (%, %).',
      coalesce(v_argnames[1], '<unnamed>'), coalesce(v_argnames[2], '<unnamed>');
  end if;

  -- Still 7 M071 functions: one was replaced, none added or lost.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M073 ABORTED [OBJECT_COUNT]: expected 7 vam071_* functions, found %.', v_n;
  end if;

  -- Definer hardening survived the recreate.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
      and p.prosecdef
      and p.proconfig is not null
      and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'
      and not p.proisstrict
  ) then
    raise exception 'M073 ABORTED [DEFINER_HARDENING]: decline function is not a pinned-search_path SECURITY DEFINER.';
  end if;

  -- No web role may execute it. aclexplode reports a PUBLIC grant as grantee 0.
  select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ', ') into v_txt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
    and acl.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated');
  if v_txt is not null then
    raise exception 'M073 ABORTED [ACL]: decline function is executable by %.', v_txt;
  end if;

  -- The column and its binding exist and the table still satisfies both
  -- bindings for every existing row.
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'person_season_invites'
                   and column_name = 'decline_feedback' and data_type = 'text'
                   and is_nullable = 'YES') then
    raise exception 'M073 ABORTED [COLUMN]: decline_feedback is not a nullable text column.';
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'person_season_invites_decline_feedback_binding_check'
                   and conrelid = 'public.person_season_invites'::regclass) then
    raise exception 'M073 ABORTED [CONSTRAINT]: the decline_feedback binding constraint is absent.';
  end if;

  select count(*) into v_n
  from public.person_season_invites
  where (outcome is not distinct from 'accepted') <> (application_id is not null)
     or (decline_feedback is not null and outcome is distinct from 'declined');
  if v_n <> 0 then
    raise exception 'M073 ABORTED [INVARIANT_BROKEN]: % invites violate a binding after apply.', v_n;
  end if;
end
$m073_post$;

-- PostgREST caches the function signature. Without this the first decline after
-- apply fails with "Could not find the function ... (p_decline_feedback)".
notify pgrst, 'reload schema';

commit;
