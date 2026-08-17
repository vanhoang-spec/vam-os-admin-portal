-- =============================================================================
-- VAM OS — M071 S12 RENEWAL TRUSTED RUNTIME FOUNDATION — APPLY
--
-- ONE transaction. Installs SEVEN functions and nothing else. No table, no
-- column, no index, no policy, no grant on any pre-existing table, no seed
-- row, no audit-vocabulary change, no invite.
--
-- Target : PRODUCTION (vam-os-mvp / qkkroesfiazsejkzflcd), after the S12
--          release T1-T4 and after M070 has been applied and verified.
--
-- RELATIONSHIP TO supabase_migrations/071_renewal_trusted_runtime.sql
-- From the "-- ── 1. Prerequisites and unapplied proof" marker onward, this
-- file is BYTE-IDENTICAL to the canonical migration, and a test fails the
-- build if it ever stops being. What this file adds above that marker is
-- Section 0: guards that belong to an owner-executed apply rather than to a
-- migration, re-asserted INSIDE this transaction so that a baseline which
-- changed between the preflight and now aborts before any function is created.
--
-- preflight.sql is NOT a prerequisite of this file. Section 0 re-checks
-- everything it checks. The preflight exists so the owner learns about a
-- baseline mismatch before a lock is taken.
--
-- REFUSES on any of:
--   [ENV_NOT_PRODUCTION]     vam062_* functions exist — this is Staging
--   [UUID_FN_MISSING]        gen_random_uuid() does not resolve
--   [LIFECYCLE_NOT_EXECUTABLE]
--                            service_role cannot execute the two vam063 entry
--                            points the renewal orchestration calls, so the
--                            S12 release T4 has not been run here
--   [LIFECYCLE_HARDENING]    a vam063 function this package calls is not
--                            SECURITY DEFINER with a pinned search_path
--   plus every refusal of Section 1, listed in the canonical migration.
--
-- SUPABASE SQL EDITOR COMPATIBILITY
-- ZERO psql meta-commands. Nothing in this file begins with a backslash; the
-- phase marker below is an ordinary `select … as phase` statement, because the
-- owner's execution path is the Supabase SQL Editor, which is not psql and
-- rejects a backslash-leading line with 42601 before executing anything. A
-- test fails the build if one ever reappears in any owner-executable file of
-- this package.
--
-- THE FOUR M070 EXECUTION DEFECTS, AND HOW EACH IS AVOIDED HERE
--   array || untyped literal   every array concatenation in this package is
--                              either array_append() or carries an explicit
--                              ::text[] cast on the literal operand.
--   catalog "char" in text     relname, proname, conname, attidentity,
--                              attgenerated, relkind and confdeltype are cast
--                              ::text at every point they are concatenated or
--                              compared with text.
--   owner SQL that is not SQL  no meta-command, no client-side construct.
--   verifier type instability  every branch of every CASE in verifier.sql
--                              returns text, and every diagnostic is wrapped
--                              in coalesce(…, '<absent>').
-- =============================================================================

select 'M071 APPLY — ONE TRANSACTION' as phase;

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── 0. Section 0 — environment and executability guard ──────────────────────
-- Re-asserted inside this transaction. Section 1 below covers the object and
-- contract baseline; this section covers the two things that are properties of
-- the ENVIRONMENT rather than of the schema.
do $m071_guard$
declare
  v_txt text;
  -- The two vam063 entry points the renewal orchestration calls. The DECLINE
  -- path calls vam063_opt_out_membership internally, as the owner, and needs
  -- no grant for that. The CONFIRM orchestration calls
  -- vam063_add_membership_role from the Node process over PostgREST, and that
  -- one does need the service_role EXECUTE grant the S12 release T4 installs.
  v_called constant text[] := array[
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)'
  ];
begin
  -- The established Production marker, unchanged from M070 and from the S12
  -- release T3. Staging carries the vam062_* lineage and a different audit
  -- vocabulary history; this package is not adapted to run there, and no
  -- artifact in it has a Staging mode.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M071 ABORTED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('gen_random_uuid()') is null then
    raise exception 'M071 ABORTED [UUID_FN_MISSING]: gen_random_uuid() does not resolve; person_season_invites.id has no default.';
  end if;

  select string_agg(f, ', ' order by f) into v_txt
  from unnest(v_called) f
  where not has_function_privilege('service_role', f, 'execute');
  if v_txt is not null then
    raise exception 'M071 ABORTED [LIFECYCLE_NOT_EXECUTABLE]: service_role cannot execute %. The S12 release T4 has not been applied here, and the renewal confirm and decline paths would fail at their first real use.', v_txt;
  end if;

  -- A vam063 function this package calls must still be a hardened definer. If
  -- one has been redefined as SECURITY INVOKER, calling it from inside a
  -- definer function would run it with the caller's privileges instead of the
  -- owner's and its own authorization checks would be evaluated against the
  -- wrong identity.
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array['vam063_add_membership_role', 'vam063_opt_out_membership',
                               'vam063_authorized_for_scope']::text[])
    and (not p.prosecdef
         or p.proconfig is null
         or not (array_to_string(p.proconfig, ',') like '%search_path=public%'));
  if v_txt is not null then
    raise exception 'M071 ABORTED [LIFECYCLE_HARDENING]: % is not SECURITY DEFINER with a pinned search_path.', v_txt;
  end if;
end
$m071_guard$;

-- ── 1. Prerequisites and unapplied proof ────────────────────────────────────
-- Every object these functions call or write, plus the complete absence of
-- anything this migration owns. This block refuses rather than adapting: a
-- missing prerequisite means the package was derived against a different
-- database, and the correct response is to re-derive it, not to install a
-- function whose first real call is also its first test.
do $m071_pre$
declare
  v_txt     text;
  v_missing text;
  -- Tables read or written by the seven functions below.
  v_tables constant text[] := array[
    'person_season_invites', 'people', 'programs', 'seasons', 'admin_users',
    'applications', 'admin_audit_log', 'mentor_profiles',
    'person_season_memberships', 'person_season_membership_log'
  ];
  -- The Production membership-lifecycle surface installed by the S12 release
  -- T3/T4. These functions are CALLED by this package; none is modified.
  v_lifecycle constant text[] := array[
    'public.vam063_trusted_api_role()',
    'public.vam063_authorized_for_scope(uuid,uuid,uuid)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)'
  ];
  -- Every action_type this package writes. M070 added the first two; the
  -- third is pre-existing. If any is inadmissible, the audit INSERT raises
  -- 23514 inside the same transaction as the mutation and takes it down.
  v_actions constant text[] := array[
    'confirm_renewal', 'create_renewal_invite', 'revoke_renewal_invite'
  ];
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(v_tables) t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'M071 ABORTED [PREREQ_TABLE_MISSING]: %. Every one of them is read or written by a function this migration installs.', v_missing;
  end if;

  -- M070 must be applied. Its three arbiters are what make this package's
  -- single-winner claims and its accepted-once refusal enforceable at all.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array[
    'person_season_invites_token_hash_key',
    'person_season_invites_live_key',
    'person_season_invites_accepted_key'
  ]) x
  where not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'person_season_invites'
      and c.relname = x and i.indisunique and i.indisvalid and i.indisready
  );
  if v_txt is not null then
    raise exception 'M071 ABORTED [M070_ARBITER_MISSING]: %. M070 is not applied, or its unique arbiters have been dropped; this package''s single-winner and accepted-once guarantees rest on them.', v_txt;
  end if;

  select string_agg(f, ', ' order by f) into v_missing
  from unnest(v_lifecycle) f
  where to_regprocedure(f) is null;
  if v_missing is not null then
    raise exception 'M071 ABORTED [LIFECYCLE_MISSING]: %. The S12 release T3 has not been applied here; the decline and confirm paths call these functions by name and would fail at their first real use.', v_missing;
  end if;

  -- The audit vocabulary must already admit every value written below.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_actions) x
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = 'admin_audit_log_action_type_check'
      and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
  );
  if v_txt is not null then
    raise exception 'M071 ABORTED [AUDIT_VOCAB_MISSING]: admin_audit_log does not admit: %. M070 adds create_renewal_invite / revoke_renewal_invite / confirm_renewal and must be applied first.', v_txt;
  end if;

  -- ══ THE admin_audit_log INSERT CONTRACT ═══════════════════════════════════
  -- M070's preflight deliberately did NOT check this and said why: M070
  -- installs no RPC and writes no audit row, so the INSERT contract belongs to
  -- the package whose audit writes are atomic with the mutations they record.
  -- That is this package. Three of its five entry points perform an
  -- admin_audit_log INSERT inside the same transaction as a canonical write,
  -- so a column that is absent, wrongly typed, NOT NULL where NULL is written,
  -- or omitted-and-NOT-NULL-with-no-default does not degrade the audit — it
  -- aborts the mutation.
  --
  --   value   an expression is written into the column
  --   null    the literal NULL is written, so the column MUST be nullable
  --   omitted not named in the INSERT, so it must be nullable or carry a
  --           usable default / identity / generated value
  select string_agg(v, '; ' order by v) into v_txt from (
    with expected as (
      select split_part(e, '#', 1) as col,
             split_part(e, '#', 2) as typ,
             split_part(e, '#', 3) as supply
      from unnest(array[
        'action#text#value',
        'action_type#text#value',
        'actor_admin_user_id#uuid#value',
        'actor_email#text#value',
        'after_data#jsonb#value',
        'before_data#jsonb#value',
        'created_at#timestamp with time zone#omitted',
        'details#jsonb#value',
        'id#uuid#omitted',
        'metadata#jsonb#omitted',
        'target_admin_user_id#uuid#null',
        'target_email#text#omitted',
        'updated_at#timestamp with time zone#omitted'
      ]) e
    ),
    actual as (
      select a.attname::text                      as col,
             format_type(a.atttypid, a.atttypmod) as typ,
             a.attnotnull,
             a.attidentity::text                  as ident,
             a.attgenerated::text                 as gen,
             pg_get_expr(d.adbin, d.adrelid)      as defexpr
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = to_regclass('public.admin_audit_log')
        and a.attnum > 0 and not a.attisdropped
    )
    select e.col || ': absent from admin_audit_log' as v
      from expected e left join actual a on a.col = e.col
     where a.col is null
    union all
    select e.col || ': type is ' || a.typ || ', the M071 audit INSERT requires ' || e.typ
      from expected e join actual a on a.col = e.col
     where a.typ <> e.typ
    union all
    select e.col || ': GENERATED/IDENTITY ALWAYS, but the M071 INSERT supplies it explicitly'
      from expected e join actual a on a.col = e.col
     where e.supply in ('value', 'null') and (a.gen <> '' or a.ident = 'a')
    union all
    select e.col || ': NOT NULL, but the M071 INSERT writes NULL into it'
      from expected e join actual a on a.col = e.col
     where e.supply = 'null' and a.attnotnull
    union all
    select e.col || ': omitted by the M071 INSERT and NOT NULL with no usable default'
      from expected e join actual a on a.col = e.col
     where e.supply = 'omitted' and a.attnotnull and a.ident = '' and a.gen = ''
       and (a.defexpr is null or btrim(a.defexpr) ~* '^null(::[a-z ]+)?$')
    union all
    -- A column this contract does not know about is fine while it is
    -- nullable or defaulted: the INSERT simply does not name it. One that is
    -- NOT NULL with nothing to fill it is not fine, and it would surface as a
    -- 23502 that takes a canonical mutation down with it. This is stated as a
    -- REQUIREMENT ON THE INSERT rather than as set equality on the table,
    -- because admin_audit_log gaining a nullable column is not this package's
    -- business.
    select a.col || ': not part of the M071 audit INSERT and NOT NULL with no usable default'
      from actual a left join expected e on e.col = a.col
     where e.col is null and a.attnotnull and a.ident = '' and a.gen = ''
       and (a.defexpr is null or btrim(a.defexpr) ~* '^null(::[a-z ]+)?$')
  ) s;
  if v_txt is not null then
    raise exception 'M071 ABORTED [AUDIT_CONTRACT]: admin_audit_log does not satisfy the M071 audit INSERT contract: %. Re-derive this package against this database before applying.', v_txt;
  end if;

  -- FORCE ROW LEVEL SECURITY subjects the table OWNER to policies, so a
  -- SECURITY DEFINER function owned by postgres would be filtered by a policy
  -- set that is deliberately empty on person_season_invites. Every table these
  -- functions write must be free of it, or the write silently affects zero
  -- rows or is refused outright.
  select string_agg(c.relname::text, ', ' order by c.relname::text) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relforcerowsecurity
    and c.relname = any (array[
      'person_season_invites', 'applications', 'mentor_profiles',
      'admin_audit_log', 'person_season_memberships', 'person_season_membership_log'
    ]);
  if v_txt is not null then
    raise exception 'M071 ABORTED [FORCE_RLS_SET]: FORCE ROW LEVEL SECURITY is set on %. A SECURITY DEFINER write is filtered by policy even running as the owner.', v_txt;
  end if;

  -- vam071_% is this migration's own object namespace. A hit means a
  -- half-applied package, which must be reconciled before applying.
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_txt is not null then
    raise exception 'M071 ABORTED [ALREADY_APPLIED]: pre-existing vam071_* function(s): %. Run verifier.sql, or roll the partial state back before applying.', v_txt;
  end if;

  -- The seven mentor_profiles columns the confirm path may write, and nothing
  -- else. If one is absent or has drifted type, the static UPDATE in Section 7
  -- would fail at its first real call.
  select string_agg(spec, ', ' order by spec) into v_txt
  from unnest(array[
    'capacity_target#integer', 'company_current#text', 'function_area#text',
    'industry#text', 'title_current#text', 'years_experience_min#integer',
    'years_experience_text#text'
  ]) spec
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.mentor_profiles')
      and a.attname = split_part(spec, '#', 1)
      and a.attnum > 0 and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = split_part(spec, '#', 2)
  );
  if v_txt is not null then
    raise exception 'M071 ABORTED [PROFILE_COLUMN_CONTRACT]: mentor_profiles does not carry the expected column(s)/type(s): %. The renewal confirm UPDATE names these columns statically.', v_txt;
  end if;

  -- The applications columns the accept path writes.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array[
    'person_id','season_id','intake_batch_id','role_applied','status','source',
    'full_name','email_primary','phone_primary','consent_data_storage',
    'raw_payload','submitted_at'
  ]) x
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.applications')
      and a.attname = x and a.attnum > 0 and not a.attisdropped
  );
  if v_txt is not null then
    raise exception 'M071 ABORTED [APPLICATION_COLUMN_CONTRACT]: applications does not carry: %.', v_txt;
  end if;

  -- 'submitted' and 's12_mentor_renewal' must both be writable. A CHECK that
  -- refuses either would fail every renewal AFTER the invite had been claimed.
  --
  -- The constraint is located by the COLUMN it governs — conkey[1] resolved
  -- through pg_attribute — rather than by matching the word "status" or
  -- "source" anywhere in its definition. applications carries a legacy
  -- final_status column, and a definition-text scan would pick its CHECK up
  -- and abort this migration over a constraint that has nothing to do with
  -- the column being written.
  select string_agg(c.conname::text, ', ' order by c.conname::text) into v_txt
  from pg_constraint c
  where c.conrelid = to_regclass('public.applications') and c.contype = 'c'
    and array_length(c.conkey, 1) = 1
    and (select a.attname::text from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'status'
    and pg_get_constraintdef(c.oid) not like '%''submitted''%';
  if v_txt is not null then
    raise exception 'M071 ABORTED [APPLICATION_STATUS_VOCAB]: % does not admit ''submitted'', which every renewal application row is created with.', v_txt;
  end if;

  select string_agg(c.conname::text, ', ' order by c.conname::text) into v_txt
  from pg_constraint c
  where c.conrelid = to_regclass('public.applications') and c.contype = 'c'
    and array_length(c.conkey, 1) = 1
    and (select a.attname::text from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'source'
    and pg_get_constraintdef(c.oid) not like '%''s12_mentor_renewal''%';
  if v_txt is not null then
    raise exception 'M071 ABORTED [APPLICATION_SOURCE_VOCAB]: % does not admit ''s12_mentor_renewal'', which is the source every renewal application row is created with.', v_txt;
  end if;

  -- 'mentor' must be writable into role_applied. The accept path writes it as
  -- a bare literal so the column may be either text or an enum, but the value
  -- itself still has to be admissible.
  if exists (
    select 1 from pg_type t
    join pg_attribute a on a.atttypid = t.oid
    where a.attrelid = to_regclass('public.applications') and a.attname = 'role_applied'
      and t.typtype = 'e'
      and not exists (
        select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'mentor'
      )
  ) then
    raise exception 'M071 ABORTED [APPLICATION_ROLE_VOCAB]: applications.role_applied is an enum that has no ''mentor'' label.';
  end if;
end
$m071_pre$;

-- ── 2. Internal helpers ─────────────────────────────────────────────────────
-- Two of them, and both exist so that a rule which must be IDENTICAL at three
-- or four call sites is written once. Neither is granted to any role: they are
-- reached only from the five entry points below, and a SECURITY DEFINER
-- function needs no EXECUTE privilege on what it calls internally.

-- THE IDENTITY LOCK. Every path that decides something about a
-- person+season+role — create, accept, decline — takes this lock before it
-- evaluates that decision, so the three of them serialise against each other
-- even when they are operating on DIFFERENT invite rows for the same human.
--
-- This is what closes P0-RT-1 and P0-RT-2 against concurrency rather than
-- merely against sequence. The FOR UPDATE row lock on an invite serialises two
-- callers holding the SAME token; it does nothing about an accept on invite A
-- committing while a decline on invite B for the same mentor is deciding
-- whether an accepted renewal exists. The advisory lock is keyed on exactly
-- the tuple that question is asked about, so the answer cannot go stale
-- between being read and being acted on.
--
-- Key shape mirrors vam063_add_membership_role's own advisory lock, which is
-- keyed on the same three values with a different prefix. The prefixes differ
-- deliberately: these are different questions and must not block each other.
create function public.vam071_renewal_identity_lock(
  p_person_id uuid,
  p_season_id uuid,
  p_role      text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext('VAM071_RENEWAL|' || p_person_id::text || '|' || p_season_id::text || '|' || p_role)
  );
end
$$;

-- THE ACCEPTED-ONCE PREDICATE. One reading of "this person has already
-- renewed", used by create (P0-RT-1), accept and decline (P0-RT-2). Written
-- once so the three cannot drift; called only while the identity lock above is
-- held, which is what makes its answer authoritative rather than advisory.
create function public.vam071_accepted_renewal_exists(
  p_person_id uuid,
  p_season_id uuid,
  p_role      text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.person_season_invites i
    where i.person_id = p_person_id
      and i.season_id = p_season_id
      and i.role      = p_role
      and i.outcome   = 'accepted'
  )
$$;

-- ── 3. Create a renewal invite ──────────────────────────────────────────────
-- The ONLY path that may mint a person-bound bearer token.
--
-- The raw token is generated in Node and never arrives here; this function
-- receives only its digest. What it contributes that application code cannot
-- is that the accepted-renewal refusal, the one-live-invite refusal, the INSERT
-- and the create_renewal_invite audit row are one transaction. Sequential
-- writes from Node would leave, on a partial failure, a live bearer token with
-- no audit record of who issued it to whom — a credential nobody can account
-- for, which is precisely the state an audit trail exists to make impossible.
--
-- REGENERATION IS NOT A PARAMETER HERE. A lost or mis-sent link is fixed by
-- calling vam071_revoke_renewal_invite and then this function again. That emits
-- revoke_renewal_invite followed by create_renewal_invite, which is a truthful
-- account of what happened, and it needs no third audit value that would make
-- the same event queryable two incompatible ways.
--
-- Errors here are NAMED, unlike the two submit paths. The caller is an
-- authenticated admin who must be told why the system refused; P0-RT-1
-- requires exactly that.
create function public.vam071_create_renewal_invite(
  p_actor_admin_user_id uuid,
  p_person_id           uuid,
  p_program_id          uuid,
  p_season_id           uuid,
  p_role                text,
  p_token_hash          text,
  p_expires_at          timestamptz
) returns table (
  outcome_status text,
  invite_id      uuid,
  expires_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role    text;
  v_actor       record;
  v_season_code text;
  v_invite_id   uuid;
  -- A bearer token that outlives the season it renews into is a credential
  -- nobody is tracking. 60 days is the ceiling, not the policy: the caller
  -- chooses the expiry and this refuses only the unbounded ones.
  v_max_life    constant interval := interval '60 days';
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  select u.id, u.email, u.role, u.status into v_actor
  from public.admin_users u where u.id = p_actor_admin_user_id;
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'VAM071 unauthorized actor' using errcode = '42501';
  end if;
  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, p_program_id, p_season_id) then
    raise exception 'VAM071 actor not authorized for this program-season scope' using errcode = '42501';
  end if;

  -- P0 scope. The invite table admits 'mentee'; no runtime services it, and
  -- minting a token nothing can redeem is a defect, not a feature flag.
  if p_role is distinct from 'mentor' then
    raise exception 'VAM071 renewal is mentor-only in P0' using errcode = '22023';
  end if;

  -- Structural proof at the boundary that no raw token can be persisted. The
  -- column CHECK says the same thing; this says it before a row is attempted,
  -- so the caller gets a named refusal instead of a 23514.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VAM071 token_hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'VAM071 expiry must be in the future' using errcode = '22023';
  end if;
  if p_expires_at > now() + v_max_life then
    raise exception 'VAM071 expiry exceeds the maximum renewal invite lifetime' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.programs p join public.seasons s on s.program_id = p.id
    where p.id = p_program_id and p.is_active and s.id = p_season_id
  ) then
    raise exception 'VAM071 invalid active program-season relationship' using errcode = '22023';
  end if;

  -- Season 11 is never addressed by a renewal. This is the only place an
  -- invite is born, so refusing here is what makes "S11 is never touched" a
  -- property of the data rather than a promise about the callers. It mirrors
  -- M070 verifier check V23, which fails if any invite row ever points at an
  -- S11-coded season.
  select s.code into v_season_code from public.seasons s where s.id = p_season_id;
  if v_season_code is null or v_season_code like '%S11%' then
    raise exception 'VAM071 renewal invites are never issued against Season 11' using errcode = '22023';
  end if;

  if not exists (select 1 from public.people pe where pe.id = p_person_id) then
    raise exception 'VAM071 person not found' using errcode = 'P0002';
  end if;

  -- Everything above is a cheap read that needs no serialisation. Only the
  -- create-or-refuse decision itself does.
  perform public.vam071_renewal_identity_lock(p_person_id, p_season_id, p_role);

  -- P0-RT-1. The accepted arbiter blocks the second ACCEPTANCE; it does not
  -- block the second INVITATION. Without this refusal an admin can mint and
  -- email a valid-looking link to a mentor who has already renewed, and the
  -- mismatch surfaces only when that mentor has filled the form in and hits a
  -- 23505 reported as the uniform public failure. This is the first line; the
  -- index is the last.
  if public.vam071_accepted_renewal_exists(p_person_id, p_season_id, p_role) then
    raise exception 'VAM071 an accepted renewal already exists for this person, season and role'
      using errcode = '23505';
  end if;

  -- One live token at a time. Regeneration is revoke-then-create, so this
  -- refusal is a named instruction rather than an obstacle.
  if exists (
    select 1 from public.person_season_invites i
    where i.person_id = p_person_id and i.season_id = p_season_id and i.role = p_role
      and i.revoked_at is null and i.submitted_at is null
  ) then
    raise exception 'VAM071 a live renewal invite already exists for this person, season and role; revoke it before issuing another'
      using errcode = '23505';
  end if;

  insert into public.person_season_invites
    (token_hash, person_id, program_id, season_id, role, created_by, expires_at)
  values
    (p_token_hash, p_person_id, p_program_id, p_season_id, p_role, v_actor.id, p_expires_at)
  returning id into v_invite_id;

  -- Atomic audit. NEITHER the raw token NOR its digest is recorded: the digest
  -- is the lookup key for a live credential, and an audit row is a far more
  -- widely readable object than the invite table it would be copied from.
  insert into public.admin_audit_log (
    action, action_type, actor_admin_user_id, actor_email,
    target_admin_user_id, before_data, after_data, details
  ) values (
    'create_renewal_invite',
    'create_renewal_invite',
    v_actor.id,
    v_actor.email,
    null,
    null,
    jsonb_build_object(
      'invite_id',  v_invite_id,
      'person_id',  p_person_id,
      'program_id', p_program_id,
      'season_id',  p_season_id,
      'role',       p_role,
      'expires_at', p_expires_at
    ),
    jsonb_build_object(
      'season_code',         v_season_code,
      'actor_admin_user_id', v_actor.id,
      'created_at',          now()
    )
  );

  return query select 'created'::text, v_invite_id, p_expires_at;
end
$$;

-- ── 4. Revoke a renewal invite ──────────────────────────────────────────────
-- The administrative kill BEFORE use. Never a side effect of a successful or
-- declined renewal — M070's live-invite arbiter depends on revoked_at meaning
-- "cancelled before use" and nothing else.
--
-- The invite is located by id and its program/season scope is read FROM THE
-- ROW, never from the caller, so an admin cannot revoke outside their scope by
-- naming a scope they do hold.
create function public.vam071_revoke_renewal_invite(
  p_actor_admin_user_id uuid,
  p_invite_id           uuid,
  p_reason              text
) returns table (
  outcome_status text,
  invite_id      uuid,
  revoked_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role text;
  v_actor    record;
  v_inv      record;
  v_now      timestamptz;
  v_rows     integer;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  select u.id, u.email, u.role, u.status into v_actor
  from public.admin_users u where u.id = p_actor_admin_user_id;
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'VAM071 unauthorized actor' using errcode = '42501';
  end if;

  -- The lock is taken before authorization deliberately: the scope this admin
  -- must be authorized FOR is read out of this row, so the row has to be
  -- pinned before the question can be asked.
  select i.* into v_inv
  from public.person_season_invites i
  where i.id = p_invite_id
  for update;

  if v_inv.id is null then
    raise exception 'VAM071 renewal invite not found' using errcode = 'P0002';
  end if;

  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, v_inv.program_id, v_inv.season_id) then
    raise exception 'VAM071 actor not authorized for this program-season scope' using errcode = '42501';
  end if;

  -- A submitted invite is NOT revocable. Writing revoked_at onto a completed
  -- renewal would overload "revoked" with "used", destroy the distinction the
  -- live arbiter is built on, and record an administrative cancellation of
  -- something that was actually answered.
  if v_inv.submitted_at is not null then
    raise exception 'VAM071 this renewal invite has already been answered and cannot be revoked'
      using errcode = '22023';
  end if;

  -- Idempotent: already revoked is a no-op and writes no second audit row.
  if v_inv.revoked_at is not null then
    return query select 'noop'::text, v_inv.id, v_inv.revoked_at;
    return;
  end if;

  v_now := now();

  -- The table is aliased and every WHERE reference is qualified, because this
  -- function's OUT parameter is also called revoked_at: an unqualified
  -- `revoked_at is null` here resolves against the PL/pgSQL variable, not the
  -- column, and PostgreSQL raises 42702 rather than guessing.
  update public.person_season_invites i
     set revoked_at = v_now
   where i.id = v_inv.id and i.revoked_at is null and i.submitted_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'VAM071 renewal invite revocation claimed % rows, expected exactly 1', v_rows
      using errcode = '40001';
  end if;

  insert into public.admin_audit_log (
    action, action_type, actor_admin_user_id, actor_email,
    target_admin_user_id, before_data, after_data, details
  ) values (
    'revoke_renewal_invite',
    'revoke_renewal_invite',
    v_actor.id,
    v_actor.email,
    null,
    jsonb_build_object('invite_id', v_inv.id, 'revoked_at', null),
    jsonb_build_object('invite_id', v_inv.id, 'revoked_at', v_now),
    jsonb_build_object(
      'person_id',           v_inv.person_id,
      'program_id',          v_inv.program_id,
      'season_id',           v_inv.season_id,
      'role',                v_inv.role,
      'reason',              nullif(btrim(coalesce(p_reason, '')), ''),
      'actor_admin_user_id', v_actor.id,
      'revoked_at',          v_now
    )
  );

  return query select 'revoked'::text, v_inv.id, v_now;
end
$$;

-- ── 5. Accept a renewal ─────────────────────────────────────────────────────
-- P0-RT-3. The whole point of this function is that the gate decision and the
-- write are the same transaction.
--
-- evaluateRenewalInviteGate reads, decides and returns; between that return and
-- the write, a second request can pass the identical gate against the identical
-- not-yet-submitted row. The gate is documented as pure precisely so nobody
-- mistakes it for a claim. This function re-applies the ENTIRE gate predicate
-- under a row lock and is the only thing that claims anything.
--
-- WHY EVERY REFUSAL BELOW SHARES ONE MESSAGE AND ONE SQLSTATE
-- The caller is an unauthenticated bearer-token holder. PostgREST returns both
-- the message and the SQLSTATE of a raised exception, so a per-reason message
-- or a per-reason errcode would let a probe distinguish "no such token" from
-- "revoked" from "already submitted" from "already renewed" — free
-- reconnaissance on which links exist and what happened to them. Every refusal
-- therefore raises the identical message with the identical code, and the
-- distinguishing reason goes to the PostgreSQL log via RAISE LOG, which is
-- emitted immediately and survives the rollback that follows it.
--
-- RAW PAYLOAD NESTING — LOAD BEARING, NOT COSMETIC
-- The submitted answers are stored under raw_payload -> 'renewal', and the
-- only other top-level keys are the four this function writes itself. That is
-- what keeps lib/application-approvals.ts's buildMentorProfileRefresh — which
-- reads TOP-LEVEL keys of raw_payload and emits first_vam_season among them —
-- from finding anything at all when approveApplication later runs over this
-- row. Without the nesting, approveApplication would refresh canonical
-- mentor_profiles columns straight from an unauthenticated submission,
-- bypassing the admin's field-level confirmation entirely and writing the one
-- lineage field the renewal path must never write. P0-RT-5 and P0-RT-6 are
-- structural because of this shape; see README section 5.
create function public.vam071_submit_renewal_accepted(
  p_token_hash           text,
  p_raw_payload          jsonb,
  p_consent_data_storage boolean
) returns table (
  outcome_status text,
  invite_id      uuid,
  application_id uuid,
  person_id      uuid,
  season_id      uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role text;
  v_inv      record;
  v_person   record;
  v_app_id   uuid;
  v_now      timestamptz;
  v_rows     integer;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise log 'VAM071 accept refused [TOKEN_MALFORMED]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if p_raw_payload is null or jsonb_typeof(p_raw_payload) <> 'object' then
    raise log 'VAM071 accept refused [PAYLOAD_SHAPE]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  -- consent_data_storage is NOT NULL on applications. Writing false for
  -- somebody who did consent, or true for somebody who did not, are both
  -- misrecords; the form must have collected it and must say so here.
  if p_consent_data_storage is not true then
    raise log 'VAM071 accept refused [CONSENT_ABSENT]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- STEP 1 — resolve and LOCK the authoritative row. This lock, not the gate,
  -- is what serialises two concurrent submits of the same token.
  select i.* into v_inv
  from public.person_season_invites i
  where i.token_hash = p_token_hash
  for update;

  if v_inv.id is null then
    raise log 'VAM071 accept refused [TOKEN_NOT_FOUND]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  if v_inv.role is distinct from 'mentor' then
    raise log 'VAM071 accept refused [ROLE_NOT_MENTOR] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- Serialise the identity as well as the row, so a concurrent accept or
  -- decline on a DIFFERENT invite for this same mentor cannot interleave with
  -- the accepted-renewal check below.
  perform public.vam071_renewal_identity_lock(v_inv.person_id, v_inv.season_id, v_inv.role);

  -- STEP 2 — re-apply the COMPLETE gate predicate inside the transaction. The
  -- pre-transaction gate decision is advisory; this one is authoritative.
  if v_inv.revoked_at is not null then
    raise log 'VAM071 accept refused [INVITE_REVOKED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    raise log 'VAM071 accept refused [INVITE_EXPIRED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.submitted_at is not null then
    raise log 'VAM071 accept refused [ALREADY_SUBMITTED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- STEP 3 — P0-RT-1's condition, re-checked here under the identity lock.
  if public.vam071_accepted_renewal_exists(v_inv.person_id, v_inv.season_id, v_inv.role) then
    raise log 'VAM071 accept refused [ACCEPTED_RENEWAL_EXISTS] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- STEP 4 — identity derives from the invite and from public.people. Nothing
  -- here comes from the client: the payload contributes answers, never who the
  -- submitter is.
  select pe.id, pe.full_name, pe.email_primary, pe.phone_primary into v_person
  from public.people pe where pe.id = v_inv.person_id;
  if v_person.id is null then
    raise log 'VAM071 accept refused [PERSON_MISSING] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  v_now := now();

  -- STEP 5 — the applications row, with person_id known AT INSERT. The bare
  -- 'mentor' literal is resolved to whatever type role_applied carries (text
  -- in the Production baseline, an enum elsewhere), and it is provably the
  -- invite's own role because the check above refused anything else.
  insert into public.applications (
    person_id, season_id, intake_batch_id, role_applied, status, source,
    full_name, email_primary, phone_primary,
    consent_data_storage, raw_payload, submitted_at
  ) values (
    v_inv.person_id,
    v_inv.season_id,
    null,
    'mentor',
    'submitted',
    's12_mentor_renewal',
    v_person.full_name,
    v_person.email_primary,
    v_person.phone_primary,
    true,
    jsonb_build_object(
      'source',               's12_mentor_renewal',
      'renewal_invite_id',    v_inv.id,
      'renewal_submitted_at', v_now,
      'renewal',              p_raw_payload
    ),
    current_date
  )
  returning id into v_app_id;

  -- STEP 6 — claim the invite, and ONLY if it is still unclaimed. This
  -- predicate is what makes replay incapable of overwriting submitted_at,
  -- outcome or application_id: once written, no later UPDATE can match.
  update public.person_season_invites i
     set submitted_at   = v_now,
         outcome        = 'accepted',
         application_id = v_app_id
   where i.id = v_inv.id
     and i.submitted_at is null;

  -- STEP 7 — exactly one claim, or nothing happened at all. A loser that
  -- somehow reached here matches zero rows; raising rolls its applications
  -- INSERT back with it, so no orphan duplicate application can survive.
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise log 'VAM071 accept refused [CLAIM_LOST] invite=% rows=%', v_inv.id, v_rows;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- No admin_audit_log row is written here, and that is deliberate: the actor
  -- is an unauthenticated token holder, not an admin, and an admin audit row
  -- with a NULL admin actor both pollutes the trail and opens an anonymous
  -- write path into it. The durable record of this submission is stronger than
  -- an audit line would be — the invite's own submitted_at/outcome/
  -- application_id, plus the applications row itself.
  return query select 'accepted'::text, v_inv.id, v_app_id, v_inv.person_id, v_inv.season_id;
end
$$;

-- ── 6. Decline a renewal ────────────────────────────────────────────────────
-- P0-RT-2, made structural. A decline is a submit: it takes the same slot,
-- runs the same single-winner claim, and carries one extra obligation the
-- accept path does not — it may reach an existing Season 12 membership.
--
-- THE REQUIREMENT THIS FUNCTION EXISTS FOR
-- Suppose a second live invite for an already-renewed mentor reaches an inbox.
-- Clicking NO on that stale link must NEVER opt the mentor out of a Season 12
-- membership an admin has already confirmed. The refusal is evaluated here,
-- under the identity lock, in the same transaction as the write it guards —
-- not before it, where a concurrent accept could land in between.
--
-- NO PAYLOAD PARAMETER. A decline creates no applications row, so a submitted
-- reason would have nowhere durable to live except the membership log, and
-- writing unauthenticated free text into a lifecycle narrative is not
-- something P0 offers. The decline records that it happened, and when.
--
-- ATTRIBUTION FOR THE MEMBERSHIP MUTATION. vam063_opt_out_membership requires
-- an active, scope-authorized admin actor, and a self-service decline has no
-- admin in the room. The actor is therefore the invite's created_by — the
-- admin who issued this specific invitation to this specific person, which is
-- the only admin who has actually made a decision about this renewal — and the
-- membership log reason states plainly that the mentor initiated it. If that
-- admin is no longer active or no longer scope-authorized, the opt-out is
-- DEFERRED rather than forced: the decline is still recorded, the membership
-- is left untouched, and the returned membership_outcome says so. Leaving a
-- membership active is the safe direction; refusing the whole decline would
-- leave the invite live and tell the mentor their link is broken.
create function public.vam071_submit_renewal_declined(
  p_token_hash text
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
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise log 'VAM071 decline refused [TOKEN_MALFORMED]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

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
  update public.person_season_invites i
     set submitted_at = v_now,
         outcome      = 'declined'
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

-- ── 7. Admin confirmation of the canonical profile change ───────────────────
-- P0-RT-4 and P0-RT-6. The single human gate between a bearer-token submission
-- and a canonical mentor_profiles row.
--
-- WHAT THIS FUNCTION IS FOR
-- buildRenewalProfileDiff is a pure function over whatever it is handed, so it
-- cannot tell a profile read taken seconds ago from one taken at submit time
-- weeks ago. Between submit and confirm an admin can edit the same profile
-- through /mentors/[id]/edit. This function is the enforcement of the freshness
-- the diff cannot enforce for itself: it re-locks the profile, compares the
-- CURRENT value of every field against the value the admin was actually shown,
-- and refuses the whole confirmation if any of them disagrees. The admin never
-- approves a "before" that is no longer true, and a colleague's edit is never
-- silently reverted.
--
-- WHY OPTIONAL CONCURRENCY RATHER THAN RECOMPUTING THE DIFF IN SQL
-- Recomputing inside the transaction (P0-RT-4 option a) would require the
-- renewal allowlist to exist a second time, in SQL. M070 section 6.2 rejected
-- a second allowlist for exactly the reason that applies here: two allowlists
-- drift, and the copy nobody updates is the one that silently widens. This
-- function therefore takes option (b) — and takes it in the strong form: the
-- expected before-state is carried per field, not as a single updated_at
-- token, so a drift refusal names the field that moved.
--
-- THE COLUMN CEILING IS A CEILING, NOT A SECOND ALLOWLIST
-- The UPDATE below names seven columns statically. That list is not the source
-- of truth for what a renewal may change — lib/renewal-profile-safety.ts is,
-- and it is derived from the reviewed approval allowlist by subtraction. This
-- list is the outer bound: a field the TypeScript layer narrows away is simply
-- never sent, while a field it grows to emit that is NOT here is refused
-- loudly instead of written quietly. The only direction the two can disagree
-- in silence is the safe one. first_vam_season and prior_vam_involvement are
-- refused by name as well as being absent, so P0-RT-5 holds even if this
-- ceiling is widened carelessly later.
--
-- IDEMPOTENCE, AND WHY THE DRIFT CHECK ACCEPTS TWO VALUES
-- The orchestration around this function is retry-safe by design (P0-RT-8),
-- which means this function must be re-callable after a downstream step has
-- failed. A field whose current value already equals the CONFIRMED AFTER value
-- is treated as already applied by this same confirmation rather than as
-- drift; it is reported as skipped and not rewritten. A field that matches
-- neither the shown before nor the confirmed after has genuinely moved, and
-- the confirmation is refused.
create function public.vam071_confirm_renewal_profile(
  p_actor_admin_user_id uuid,
  p_application_id      uuid,
  p_expected_profile    jsonb,
  p_profile_update      jsonb,
  p_diff                jsonb
) returns table (
  outcome_status    text,
  invite_id         uuid,
  person_id         uuid,
  mentor_profile_id uuid,
  applied_fields    text[],
  skipped_fields    text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role   text;
  v_actor      record;
  v_inv        record;
  v_app        record;
  v_row        jsonb;
  v_profile_id uuid;
  v_n          integer;
  v_key        text;
  v_expected   text;
  v_after      text;
  v_current    text;
  v_applied    text[] := array[]::text[];
  v_skipped    text[] := array[]::text[];
  v_before_js  jsonb  := '{}'::jsonb;
  v_after_js   jsonb  := '{}'::jsonb;
  v_drift      text[] := array[]::text[];
  -- The outer bound on what a renewal confirmation may write. See the note
  -- above: this is a ceiling, not the allowlist.
  v_ceiling constant text[] := array[
    'capacity_target', 'company_current', 'function_area', 'industry',
    'title_current', 'years_experience_min', 'years_experience_text'
  ];
  -- Historical lineage. Never writable through a renewal, whatever the payload
  -- contains and whatever the ceiling above grows to.
  v_forbidden constant text[] := array[
    'first_vam_season', 'prior_vam_involvement'
  ];
  -- The two ceiling columns that are integer. Anything non-numeric arriving
  -- for one of them is a named refusal here rather than a 22P02 mid-UPDATE.
  v_integer_fields constant text[] := array[
    'capacity_target', 'years_experience_min'
  ];
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  select u.id, u.email, u.role, u.status into v_actor
  from public.admin_users u where u.id = p_actor_admin_user_id;
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'VAM071 unauthorized actor' using errcode = '42501';
  end if;

  if p_expected_profile is null or jsonb_typeof(p_expected_profile) <> 'object'
     or p_profile_update is null or jsonb_typeof(p_profile_update) <> 'object'
     or p_diff is null or jsonb_typeof(p_diff) <> 'array' then
    raise exception 'VAM071 confirmation payload is malformed' using errcode = '22023';
  end if;

  -- STEP 1 — the invite is resolved FROM the application being confirmed, and
  -- locked. Everything downstream derives from this row.
  select count(*) into v_n
  from public.person_season_invites i where i.application_id = p_application_id;
  if v_n <> 1 then
    raise exception 'VAM071 application % is not bound to exactly one renewal invite (found %)', p_application_id, v_n
      using errcode = 'P0002';
  end if;

  select i.* into v_inv
  from public.person_season_invites i
  where i.application_id = p_application_id
  for update;

  if v_inv.outcome is distinct from 'accepted' or v_inv.submitted_at is null then
    raise exception 'VAM071 renewal invite is not in the accepted state' using errcode = '22023';
  end if;
  if v_inv.role is distinct from 'mentor' then
    raise exception 'VAM071 renewal confirmation is mentor-only in P0' using errcode = '22023';
  end if;

  -- P0-RT-7. The scope check applies to the admin performing THIS
  -- confirmation, resolved server-side, and never to the invite's issuer.
  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, v_inv.program_id, v_inv.season_id) then
    raise exception 'VAM071 actor not authorized for this program-season scope' using errcode = '42501';
  end if;

  -- STEP 2 — the application, locked, and its binding verified EXACTLY. A
  -- mismatch here means the invite and the application disagree about who
  -- renewed, which is not something to reconcile automatically.
  select a.id, a.person_id, a.season_id, a.source, a.status into v_app
  from public.applications a where a.id = p_application_id
  for update;

  if v_app.id is null then
    raise exception 'VAM071 application not found' using errcode = 'P0002';
  end if;
  if v_app.person_id is distinct from v_inv.person_id
     or v_app.season_id is distinct from v_inv.season_id
     or v_app.source is distinct from 's12_mentor_renewal' then
    raise exception 'VAM071 application does not match its renewal invite binding' using errcode = '22023';
  end if;

  -- STEP 3 — payload shape. The write set must be a subset of what was shown,
  -- every key must be inside the ceiling, and no lineage field may appear in
  -- either object.
  for v_key in select k from jsonb_object_keys(p_profile_update) k loop
    if not (p_expected_profile ? v_key) then
      raise exception 'VAM071 field % is written but was not part of the confirmed before-state', v_key
        using errcode = '22023';
    end if;
  end loop;

  for v_key in
    select k from jsonb_object_keys(p_expected_profile) k
    union
    select k from jsonb_object_keys(p_profile_update) k
  loop
    if v_key = any (v_forbidden) then
      raise exception 'VAM071 field % is historical lineage and is never writable through a renewal', v_key
        using errcode = '42501';
    end if;
    if v_key <> all (v_ceiling) then
      raise exception 'VAM071 field % is outside the renewal profile column ceiling', v_key
        using errcode = '42501';
    end if;
  end loop;

  for v_key in select k from jsonb_object_keys(p_profile_update) k loop
    if v_key = any (v_integer_fields)
       and nullif(btrim(coalesce(p_profile_update ->> v_key, '')), '') !~ '^[0-9]+$' then
      raise exception 'VAM071 field % must be a non-negative integer', v_key using errcode = '22023';
    end if;
  end loop;

  -- STEP 4 — the canonical profile, locked, and required to be unambiguous.
  -- mentor_profiles.person_id carries no unique constraint in the Production
  -- baseline, so "the profile for this person" is a claim that has to be
  -- proven rather than assumed. A returning mentor with no profile row, or
  -- with two, is a data anomaly and this refuses instead of guessing.
  select count(*) into v_n
  from public.mentor_profiles mp where mp.person_id = v_inv.person_id;
  if v_n <> 1 then
    raise exception 'VAM071 person % does not have exactly one mentor profile (found %)', v_inv.person_id, v_n
      using errcode = 'P0002';
  end if;

  -- The row is captured as jsonb in the SAME locked read, rather than into a
  -- RECORD that is converted afterwards: every field comparison below is by
  -- NAME against a value the caller supplied, so a jsonb rendering of the
  -- locked row is what the comparison actually needs, and taking it here means
  -- there is exactly one read and no window between the lock and the snapshot.
  select mp.id, to_jsonb(mp.*) into v_profile_id, v_row
  from public.mentor_profiles mp
  where mp.person_id = v_inv.person_id
  for update;

  if v_profile_id is null then
    raise exception 'VAM071 mentor profile disappeared between the count and the lock' using errcode = '40001';
  end if;

  -- STEP 5 — the drift refusal, per field. Comparison is on the normalised
  -- text rendering of both sides, which is the same normalisation
  -- buildRenewalProfileDiff applies: trimmed, and empty treated as absent.
  for v_key in select k from jsonb_object_keys(p_expected_profile) k loop
    v_current  := nullif(btrim(coalesce(v_row ->> v_key, '')), '');
    v_expected := nullif(btrim(coalesce(p_expected_profile ->> v_key, '')), '');
    v_after    := nullif(btrim(coalesce(p_profile_update ->> v_key, '')), '');

    if v_current is not distinct from v_expected then
      null;                                   -- unchanged since it was shown
    elsif v_after is not null and v_current is not distinct from v_after then
      null;                                   -- already applied by this same confirmation
    else
      -- array_append, not `v_drift || v_key`. The concatenation operator is
      -- the shape that produced M070's BLOCK 2 execution failure; the named
      -- function has exactly one candidate and cannot be resolved wrongly.
      v_drift := array_append(v_drift, v_key);
    end if;
  end loop;

  if array_length(v_drift, 1) is not null then
    raise exception 'VAM071 the mentor profile changed since this diff was shown (%); re-review the renewal before confirming',
      array_to_string(v_drift, ', ')
      using errcode = '40001';
  end if;

  -- STEP 6 — the write set, recomputed from the FRESH read. A field already
  -- carrying the confirmed value is not rewritten, so updated_at and any
  -- future column-level audit never claim a change that did not happen.
  for v_key in select k from jsonb_object_keys(p_profile_update) k loop
    v_current := nullif(btrim(coalesce(v_row ->> v_key, '')), '');
    v_after   := nullif(btrim(coalesce(p_profile_update ->> v_key, '')), '');
    if v_current is distinct from v_after then
      v_applied   := array_append(v_applied, v_key);
      v_before_js := v_before_js || jsonb_build_object(v_key, v_row -> v_key);
      v_after_js  := v_after_js  || jsonb_build_object(v_key, to_jsonb(v_after));
    else
      v_skipped := array_append(v_skipped, v_key);
    end if;
  end loop;

  -- STEP 7 — the canonical write. Static column list, no dynamic SQL, and
  -- skipped entirely when there is nothing to apply: an empty fresh diff must
  -- write no profile columns rather than proceed on the list first displayed.
  if array_length(v_applied, 1) is not null then
    update public.mentor_profiles mp set
      capacity_target = case when p_profile_update ? 'capacity_target'
                             then (p_profile_update ->> 'capacity_target')::integer
                             else mp.capacity_target end,
      company_current = case when p_profile_update ? 'company_current'
                             then p_profile_update ->> 'company_current'
                             else mp.company_current end,
      function_area   = case when p_profile_update ? 'function_area'
                             then p_profile_update ->> 'function_area'
                             else mp.function_area end,
      industry        = case when p_profile_update ? 'industry'
                             then p_profile_update ->> 'industry'
                             else mp.industry end,
      title_current   = case when p_profile_update ? 'title_current'
                             then p_profile_update ->> 'title_current'
                             else mp.title_current end,
      years_experience_min  = case when p_profile_update ? 'years_experience_min'
                                   then (p_profile_update ->> 'years_experience_min')::integer
                                   else mp.years_experience_min end,
      years_experience_text = case when p_profile_update ? 'years_experience_text'
                                   then p_profile_update ->> 'years_experience_text'
                                   else mp.years_experience_text end
    where mp.id = v_profile_id;

    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'VAM071 renewal profile update affected % rows, expected exactly 1', v_n
        using errcode = '40001';
    end if;
  end if;

  -- STEP 8 — the audit row, in the SAME transaction as the mutation it
  -- attests. before_data is the FRESH state that was actually overwritten, not
  -- the snapshot first displayed; p_diff is retained separately as the record
  -- of what the admin was shown and agreed to. An unaudited canonical renewal
  -- write is not representable, because this INSERT failing rolls the UPDATE
  -- back with it.
  insert into public.admin_audit_log (
    action, action_type, actor_admin_user_id, actor_email,
    target_admin_user_id, before_data, after_data, details
  ) values (
    'confirm_renewal',
    'confirm_renewal',
    v_actor.id,
    v_actor.email,
    null,
    v_before_js,
    v_after_js,
    jsonb_build_object(
      'invite_id',            v_inv.id,
      'application_id',       p_application_id,
      'person_id',            v_inv.person_id,
      'program_id',           v_inv.program_id,
      'season_id',            v_inv.season_id,
      'mentor_profile_id',    v_profile_id,
      'confirmed_diff',       p_diff,
      'applied_fields',       to_jsonb(v_applied),
      'skipped_fields',       to_jsonb(v_skipped),
      'actor_admin_user_id',  v_actor.id,
      'confirmed_at',         now()
    )
  );

  return query select
    case when array_length(v_applied, 1) is null then 'noop'::text else 'applied'::text end,
    v_inv.id, v_inv.person_id, v_profile_id, v_applied, v_skipped;
end
$$;

-- ── 8. Privileges ───────────────────────────────────────────────────────────
-- Everything is revoked from every role first, including service_role, so no
-- privilege survives from a default or from PUBLIC. The five entry points are
-- then granted to service_role and to nothing else. The two helpers in Section
-- 2 are granted to NOBODY: they are reached only from the definer functions
-- above, and a SECURITY DEFINER function needs no EXECUTE privilege on what it
-- calls internally.
revoke all on function
  public.vam071_renewal_identity_lock(uuid, uuid, text),
  public.vam071_accepted_renewal_exists(uuid, uuid, text),
  public.vam071_create_renewal_invite(uuid, uuid, uuid, uuid, text, text, timestamptz),
  public.vam071_revoke_renewal_invite(uuid, uuid, text),
  public.vam071_submit_renewal_accepted(text, jsonb, boolean),
  public.vam071_submit_renewal_declined(text),
  public.vam071_confirm_renewal_profile(uuid, uuid, jsonb, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.vam071_create_renewal_invite(uuid, uuid, uuid, uuid, text, text, timestamptz),
  public.vam071_revoke_renewal_invite(uuid, uuid, text),
  public.vam071_submit_renewal_accepted(text, jsonb, boolean),
  public.vam071_submit_renewal_declined(text),
  public.vam071_confirm_renewal_profile(uuid, uuid, jsonb, jsonb, jsonb)
to service_role;

-- ── 9. Post-conditions ──────────────────────────────────────────────────────
do $m071_post$
declare
  v_txt   text;
  v_n     integer;
  v_entry constant text[] := array[
    'public.vam071_create_renewal_invite(uuid,uuid,uuid,uuid,text,text,timestamptz)',
    'public.vam071_revoke_renewal_invite(uuid,uuid,text)',
    'public.vam071_submit_renewal_accepted(text,jsonb,boolean)',
    'public.vam071_submit_renewal_declined(text)',
    'public.vam071_confirm_renewal_profile(uuid,uuid,jsonb,jsonb,jsonb)'
  ];
  v_helper constant text[] := array[
    'public.vam071_renewal_identity_lock(uuid,uuid,text)',
    'public.vam071_accepted_renewal_exists(uuid,uuid,text)'
  ];
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M071 ABORTED [OBJECT_COUNT]: expected the 7 M071 functions, found %.', v_n;
  end if;

  -- Every one of them must be SECURITY DEFINER with a pinned search_path, or
  -- it is not safe to grant to anything. A definer function with a mutable
  -- search_path is a privilege-escalation primitive.
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%'
    and (not p.prosecdef
         or p.proconfig is null
         or not (array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'));
  if v_txt is not null then
    raise exception 'M071 ABORTED [FUNCTION_HARDENING]: % is not SECURITY DEFINER with SET search_path = public, pg_temp.', v_txt;
  end if;

  -- The five entry points must be executable by service_role and by nothing
  -- else that the web tier can reach.
  select string_agg(f, ', ' order by f) into v_txt
  from unnest(v_entry) f
  where not has_function_privilege('service_role', f, 'execute');
  if v_txt is not null then
    raise exception 'M071 ABORTED [EXECUTE_MISSING]: service_role cannot execute %.', v_txt;
  end if;

  select string_agg(f || ' -> ' || r, ', ' order by f, r) into v_txt
  from unnest(v_entry) f, unnest(array['anon', 'authenticated']::text[]) r
  where has_function_privilege(r, f, 'execute');
  if v_txt is not null then
    raise exception 'M071 ABORTED [EXECUTE_EXPOSED]: %.', v_txt;
  end if;

  -- The helpers stay unreachable from every named role, service_role included.
  select string_agg(f || ' -> ' || r, ', ' order by f, r) into v_txt
  from unnest(v_helper) f, unnest(array['anon', 'authenticated', 'service_role']::text[]) r
  where has_function_privilege(r, f, 'execute');
  if v_txt is not null then
    raise exception 'M071 ABORTED [HELPER_EXPOSED]: %.', v_txt;
  end if;

  -- PUBLIC is checked through the ACL rather than has_function_privilege,
  -- which takes a ROLE NAME and errors on 'public' — PUBLIC is not a role.
  -- aclexplode reports a PUBLIC grant as grantee = 0, and acldefault('f', ...)
  -- supplies the implicit default ACL that pg_proc.proacl leaves NULL for,
  -- which is EXECUTE to PUBLIC — the exact grant Section 8's REVOKE removes
  -- and the exact one that would silently come back if it were dropped.
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where n.nspname = 'public' and p.proname like 'vam071\_%'
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE';
  if v_txt is not null then
    raise exception 'M071 ABORTED [PUBLIC_EXECUTE]: PUBLIC can execute %.', v_txt;
  end if;

  -- This migration installs functions. It must not have created, altered or
  -- seeded anything on the invite table, and above all must not have minted a
  -- token: a migration that produces a live bearer credential is not a
  -- migration.
  select count(*) into v_n from public.person_season_invites;
  if v_n <> 0 then
    raise notice 'M071: person_season_invites already holds % row(s); this migration created none of them.', v_n;
  end if;

  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'person_season_invites'
  ) then
    raise exception 'M071 ABORTED [POLICY_APPEARED]: person_season_invites is RLS-on with ZERO policies by design.';
  end if;

  select string_agg(g.grantee || '/' || g.privilege_type, ', ' order by g.grantee, g.privilege_type)
    into v_txt
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name = 'person_season_invites'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_txt is not null then
    raise exception 'M071 ABORTED [GRANTS_APPEARED]: %.', v_txt;
  end if;
end
$m071_post$;

notify pgrst, 'reload schema';

commit;
