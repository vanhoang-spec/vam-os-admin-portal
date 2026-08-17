-- =============================================================================
-- VAM OS — M071 S12 RENEWAL TRUSTED RUNTIME FOUNDATION — PREFLIGHT
--
-- READ-ONLY. Makes no change of any kind. Both blocks run inside
-- `begin; set transaction read only; … rollback;`, so the session refuses a
-- write with SQLSTATE 25006 even if this file is later edited carelessly. It
-- takes no lock beyond the ordinary catalog reads and changes nothing.
--
-- Run this first, in its own session, with `set timezone = 'UTC'`, and record
-- both outputs in full together with the emitted token.
--
-- apply.sql does NOT depend on this file having been run: its Section 0 and
-- Section 1 re-assert every condition below inside their own transaction. This
-- preflight exists so the owner learns about a baseline mismatch BEFORE any
-- lock is taken, and so the refusal diagnostics can be read at leisure.
--
-- Target : PRODUCTION (vam-os-mvp / qkkroesfiazsejkzflcd) after the S12
--          release T1-T4 and after M070 has been applied and verified.
--
-- WHAT THIS PROVES THAT M070'S PREFLIGHT DELIBERATELY DID NOT
-- M070's preflight states, in its own header, that it does not check the
-- complete admin_audit_log INSERT contract because M070 installs no RPC and
-- writes no audit row. This package is the one whose audit writes are atomic
-- with the canonical mutations they record, so that contract is checked here
-- (BLOCK 1, section 6) and again inside apply.sql Section 1.
--
-- REFUSES on any of:
--   [ENV_NOT_PRODUCTION]        vam062_* functions exist — this is Staging
--   [UUID_FN_MISSING]           gen_random_uuid() does not resolve
--   [PREREQ_TABLE_MISSING]      a table read or written by the seven functions
--                               is absent
--   [M070_ARBITER_MISSING]      one of M070's three unique arbiters is absent
--                               or invalid — M070 is not applied here
--   [M070_CONTRACT_DRIFT]       person_season_invites no longer carries the
--                               CHECK constraints these functions rely on
--   [LIFECYCLE_MISSING]         a vam063 function this package calls does not
--                               exist — the S12 release T3 has not been run
--   [LIFECYCLE_NOT_EXECUTABLE]  service_role cannot execute the vam063 entry
--                               points — T4 has not been run
--   [LIFECYCLE_HARDENING]       a called vam063 function is not SECURITY
--                               DEFINER with a pinned search_path
--   [AUDIT_VOCAB_MISSING]       admin_audit_log does not admit one of the
--                               three action_type values this package writes
--   [AUDIT_CONTRACT]            admin_audit_log does not satisfy the M071
--                               audit INSERT contract
--   [FORCE_RLS_SET]             FORCE ROW LEVEL SECURITY is set on a table
--                               these definer functions write
--   [ALREADY_APPLIED]           a vam071_* function already exists
--   [PROFILE_COLUMN_CONTRACT]   mentor_profiles is missing one of the seven
--                               ceiling columns, or its type has drifted
--   [APPLICATION_COLUMN_CONTRACT] applications is missing a column the accept
--                               path writes
--   [APPLICATION_STATUS_VOCAB]  the applications status CHECK does not admit
--                               'submitted'
--   [APPLICATION_SOURCE_VOCAB]  the applications source CHECK does not admit
--                               's12_mentor_renewal'
--   [APPLICATION_ROLE_VOCAB]    role_applied is an enum with no 'mentor' label
--
-- REPORTED BUT NOT REFUSED, because it is an operational fact rather than a
-- defect: how many admins can currently pass vam063_authorized_for_scope for
-- the Season 12 scope. On today's Production, admin_scope_access stores CODES
-- where that function compares UUIDs, so the only route through it is an
-- active super_admin. That is the accepted state recorded by the S12 release
-- (Decision A) and by WP1-A2, which is authored but not executed. It means
-- create, revoke and confirm are super_admin-only until WP1-A2 lands. BLOCK 2
-- emits the count so the owner can see it rather than discover it.
--
-- SUPABASE SQL EDITOR COMPATIBILITY
-- ZERO psql meta-commands. The block markers are ordinary `select … as phase`
-- statements. Run BLOCK 1 and BLOCK 2 as SEPARATE editor runs: the editor
-- surfaces only the last row-returning statement, and `set transaction read
-- only` must be the first thing in its transaction, which a fresh run
-- guarantees.
-- =============================================================================

select 'M071 PREFLIGHT — READ ONLY — BLOCK 1: refusals' as phase;

begin;
set transaction read only;

do $m071_preflight$
declare
  v_txt     text;
  v_missing text;
  v_tables constant text[] := array[
    'person_season_invites', 'people', 'programs', 'seasons', 'admin_users',
    'applications', 'admin_audit_log', 'mentor_profiles',
    'person_season_memberships', 'person_season_membership_log'
  ];
  v_lifecycle constant text[] := array[
    'public.vam063_trusted_api_role()',
    'public.vam063_authorized_for_scope(uuid,uuid,uuid)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)'
  ];
  v_called constant text[] := array[
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)'
  ];
  v_actions constant text[] := array[
    'confirm_renewal', 'create_renewal_invite', 'revoke_renewal_invite'
  ];
  -- The M070 CHECK constraints this package's correctness rests on. Named
  -- rather than re-derived: the accept path relies on the application binding
  -- check to make "accepted ⇒ exactly one application" structural, and the
  -- decline path relies on it to make "declined ⇒ none" structural.
  v_m070_checks constant text[] := array[
    'person_season_invites_token_hash_format_check',
    'person_season_invites_outcome_binding_check',
    'person_season_invites_application_binding_check',
    'person_season_invites_role_check',
    'person_season_invites_outcome_check',
    'person_season_invites_expiry_check'
  ];
begin
  -- ── 1. Environment ────────────────────────────────────────────────────────
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M071 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging. This package is not adapted to run there.';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('gen_random_uuid()') is null then
    raise exception 'M071 PREFLIGHT REFUSED [UUID_FN_MISSING]: gen_random_uuid() does not resolve.';
  end if;

  -- ── 2. Tables ─────────────────────────────────────────────────────────────
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(v_tables) t where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'M071 PREFLIGHT REFUSED [PREREQ_TABLE_MISSING]: %.', v_missing;
  end if;

  -- ── 3. M070 ───────────────────────────────────────────────────────────────
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array[
    'person_season_invites_token_hash_key',
    'person_season_invites_live_key',
    'person_season_invites_accepted_key'
  ]::text[]) x
  where not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'person_season_invites'
      and c.relname = x and i.indisunique and i.indisvalid and i.indisready
  );
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [M070_ARBITER_MISSING]: %. M070 is not applied here, or its arbiters have been dropped.', v_txt;
  end if;

  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_m070_checks) x
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.person_season_invites')
      and c.conname = x and c.contype = 'c' and c.convalidated
  );
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [M070_CONTRACT_DRIFT]: absent or NOT VALID: %.', v_txt;
  end if;

  -- ── 4. The S12 release lifecycle surface ──────────────────────────────────
  select string_agg(f, ', ' order by f) into v_missing
  from unnest(v_lifecycle) f where to_regprocedure(f) is null;
  if v_missing is not null then
    raise exception 'M071 PREFLIGHT REFUSED [LIFECYCLE_MISSING]: %. The S12 release T3 has not been applied here.', v_missing;
  end if;

  select string_agg(f, ', ' order by f) into v_txt
  from unnest(v_called) f where not has_function_privilege('service_role', f, 'execute');
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [LIFECYCLE_NOT_EXECUTABLE]: service_role cannot execute %. The S12 release T4 has not been applied here.', v_txt;
  end if;

  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array['vam063_add_membership_role', 'vam063_opt_out_membership',
                               'vam063_authorized_for_scope']::text[])
    and (not p.prosecdef or p.proconfig is null
         or not (array_to_string(p.proconfig, ',') like '%search_path=public%'));
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [LIFECYCLE_HARDENING]: % is not SECURITY DEFINER with a pinned search_path.', v_txt;
  end if;

  -- ── 5. Audit vocabulary ───────────────────────────────────────────────────
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_actions) x
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = 'admin_audit_log_action_type_check'
      and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
  );
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [AUDIT_VOCAB_MISSING]: admin_audit_log does not admit: %. M070 adds all three and must be applied first.', v_txt;
  end if;

  -- ── 6. The admin_audit_log INSERT contract ────────────────────────────────
  -- Byte-identical in intent and in expectation to apply.sql Section 1; a test
  -- asserts the two arrays are set-equal.
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
    select a.col || ': not part of the M071 audit INSERT and NOT NULL with no usable default'
      from actual a left join expected e on e.col = a.col
     where e.col is null and a.attnotnull and a.ident = '' and a.gen = ''
       and (a.defexpr is null or btrim(a.defexpr) ~* '^null(::[a-z ]+)?$')
  ) s;
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [AUDIT_CONTRACT]: %. Re-derive this package against this database before applying.', v_txt;
  end if;

  -- ── 7. FORCE RLS ──────────────────────────────────────────────────────────
  select string_agg(c.relname::text, ', ' order by c.relname::text) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relforcerowsecurity
    and c.relname = any (array[
      'person_season_invites', 'applications', 'mentor_profiles',
      'admin_audit_log', 'person_season_memberships', 'person_season_membership_log'
    ]::text[]);
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [FORCE_RLS_SET]: FORCE ROW LEVEL SECURITY is set on %. A SECURITY DEFINER write is filtered by policy even running as the owner.', v_txt;
  end if;

  -- ── 8. Unapplied proof ────────────────────────────────────────────────────
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [ALREADY_APPLIED]: %. Run verifier.sql instead, or roll the partial state back.', v_txt;
  end if;

  -- ── 9. The column contracts the functions write ───────────────────────────
  select string_agg(spec, ', ' order by spec) into v_txt
  from unnest(array[
    'capacity_target#integer', 'company_current#text', 'function_area#text',
    'industry#text', 'title_current#text', 'years_experience_min#integer',
    'years_experience_text#text'
  ]::text[]) spec
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.mentor_profiles')
      and a.attname = split_part(spec, '#', 1)
      and a.attnum > 0 and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = split_part(spec, '#', 2)
  );
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [PROFILE_COLUMN_CONTRACT]: mentor_profiles does not carry: %. The confirm UPDATE names these columns statically.', v_txt;
  end if;

  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array[
    'person_id','season_id','intake_batch_id','role_applied','status','source',
    'full_name','email_primary','phone_primary','consent_data_storage',
    'raw_payload','submitted_at'
  ]::text[]) x
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.applications')
      and a.attname = x and a.attnum > 0 and not a.attisdropped
  );
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [APPLICATION_COLUMN_CONTRACT]: applications does not carry: %.', v_txt;
  end if;

  select string_agg(c.conname::text, ', ' order by c.conname::text) into v_txt
  from pg_constraint c
  where c.conrelid = to_regclass('public.applications') and c.contype = 'c'
    and array_length(c.conkey, 1) = 1
    and (select a.attname::text from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'status'
    and pg_get_constraintdef(c.oid) not like '%''submitted''%';
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [APPLICATION_STATUS_VOCAB]: % does not admit ''submitted''.', v_txt;
  end if;

  select string_agg(c.conname::text, ', ' order by c.conname::text) into v_txt
  from pg_constraint c
  where c.conrelid = to_regclass('public.applications') and c.contype = 'c'
    and array_length(c.conkey, 1) = 1
    and (select a.attname::text from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'source'
    and pg_get_constraintdef(c.oid) not like '%''s12_mentor_renewal''%';
  if v_txt is not null then
    raise exception 'M071 PREFLIGHT REFUSED [APPLICATION_SOURCE_VOCAB]: % does not admit ''s12_mentor_renewal''. The accept path writes that source on every renewal application row.', v_txt;
  end if;

  if exists (
    select 1 from pg_type t join pg_attribute a on a.atttypid = t.oid
    where a.attrelid = to_regclass('public.applications') and a.attname = 'role_applied'
      and t.typtype = 'e'
      and not exists (select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'mentor')
  ) then
    raise exception 'M071 PREFLIGHT REFUSED [APPLICATION_ROLE_VOCAB]: applications.role_applied is an enum with no ''mentor'' label.';
  end if;

  raise notice 'M071 PREFLIGHT PASSED. M070 is applied with its three arbiters and six CHECKs intact, the S12 release T3/T4 lifecycle surface exists and is executable by service_role, admin_audit_log satisfies the M071 audit INSERT contract, no table these functions write has FORCE RLS, no vam071_* object exists, and every column the accept and confirm paths write is present with the expected type. Record BLOCK 2 in full, then run apply.sql.';
end
$m071_preflight$;

rollback;

-- =============================================================================
-- BLOCK 2 — evidence. Run as a SEPARATE editor run.
--
-- Emits one row. The sixth field is AUDITCONTRACT13 only when all thirteen
-- admin_audit_log columns satisfy the M071 audit INSERT contract, and the
-- seventh reports how many ACTIVE admins can currently pass
-- vam063_authorized_for_scope for a UEHM-S12 scope. That last number is
-- REPORTED, NOT GATED: on today's Production it is expected to equal the
-- number of active super_admins, because admin_scope_access stores codes where
-- the function compares UUIDs. A zero there would mean nobody can create,
-- revoke or confirm a renewal, which is not a reason to refuse the apply but
-- is very much a reason not to announce the feature.
-- =============================================================================

select 'M071 PREFLIGHT — READ ONLY — BLOCK 2: evidence' as phase;

begin;
set transaction read only;

with
inv as (
  select count(*)::text as n from public.person_season_invites
),
arbiters as (
  select count(*)::text as n
  from pg_index i join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public' and t.relname = 'person_season_invites'
    and c.relname = any (array['person_season_invites_token_hash_key',
                               'person_season_invites_live_key',
                               'person_season_invites_accepted_key']::text[])
    and i.indisunique and i.indisvalid and i.indisready
),
lifecycle as (
  select count(*)::text as n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname like 'vam063\_%'
),
vocab as (
  select count(*)::text as n
  from unnest(array['confirm_renewal','create_renewal_invite','revoke_renewal_invite']::text[]) x
  where exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = 'admin_audit_log_action_type_check'
      and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
  )
),
auditcols as (
  select count(*)::text as n
  from pg_attribute a
  where a.attrelid = to_regclass('public.admin_audit_log')
    and a.attnum > 0 and not a.attisdropped
),
scoped as (
  -- ACTIVE admins who would pass vam063_authorized_for_scope for the UEHM-S12
  -- program/season pair, evaluated with the SAME predicate the function uses,
  -- so this is the number the runtime will actually see.
  select coalesce(count(*), 0)::text as n
  from public.admin_users a
  where a.status = 'active' and (
    a.role = 'super_admin'
    or exists (
      select 1 from public.admin_scope_access s
      join public.seasons se on se.code = 'UEHM-S12'
      where s.user_id = a.auth_user_id and s.status = 'active'
        and s.role in ('full_access', 'operations')
        and s.program_id = se.program_id::text and s.season_id = se.id::text
    )
  )
),
m071 as (
  select count(*)::text as n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname like 'vam071\_%'
)
select
  'M071_PREFLIGHT_EVIDENCE'                                  as token,
  'invites=' || (select n from inv)                          as live_invite_rows,
  'm070_arbiters=' || (select n from arbiters) || '/3'       as m070_arbiters,
  'vam063_functions=' || (select n from lifecycle)           as lifecycle_surface,
  'm070_vocab=' || (select n from vocab) || '/3'             as audit_vocabulary,
  case when (select n from auditcols) = '13'
       then 'AUDITCONTRACT13' else 'AUDITCOLS=' || (select n from auditcols) end as audit_contract,
  'admins_scoped_for_s12=' || (select n from scoped)         as authorized_admins,
  'vam071_objects=' || (select n from m071)                  as unapplied_proof,
  current_setting('server_version')                          as server_version,
  now()                                                      as observed_at;

rollback;
