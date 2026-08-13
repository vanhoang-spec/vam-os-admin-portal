-- =============================================================================
-- VAM OS — M069 SEASON 12 APPLICATION INTAKE CONTROL — PREFLIGHT
--
-- READ-ONLY. Makes no change of any kind. Run this first, in its own session,
-- and record the emitted token.
--
-- apply.sql does NOT depend on this file having been run: Section 0 of
-- apply.sql re-asserts every condition below inside its own transaction. This
-- preflight exists so the owner learns about a baseline mismatch BEFORE taking
-- any lock, and so the refusal diagnostics can be read at leisure.
--
-- Target : PRODUCTION (vam-os-mvp / qkkroesfiazsejkzflcd) after the S12
--          release R4.2 has been applied and verified.
-- Session: set `timezone = 'UTC'` or the emitted seals are not comparable.
--
-- THE AUDIT VOCABULARY PROOF IS AN EXACT SET COMPARISON, NOT A COUNT.
-- A count of 52 is not evidence: a different 52-value list would pass a count
-- check, and apply.sql would then replace it with its own hard-coded list,
-- silently deleting a legitimate Production action type. This file therefore
-- parses pg_get_constraintdef() into the actual admitted set and requires
--     actual == the canonical pre-M069 52-value vocabulary
-- in BOTH directions, reporting the missing and the unexpected values by name.
--
-- REFUSES on any of:
--   [ENV_NOT_PRODUCTION]      vam062_* functions exist — this is Staging
--   [ADMIN_USERS_MISSING]     admin_users absent (updated_by FK target)
--   [ADMIN_USERS_COLUMNS]     admin_users lacks id/email/role/status, or one of
--                             them has a type the SECURITY DEFINER
--                             authorization path cannot compare to text
--   [ADMIN_USERS_KEY]         admin_users.id is not a primary/unique key
--   [ALREADY_APPLIED]         application_form_controls already exists
--   [FUNCTION_PRESENT]        a vam069_* function already exists
--   [PARTIAL_M069]            any other M069 object (relation, trigger,
--                             constraint) already exists
--   [PROGRAM_MISSING]         no program with code UEHM
--   [PROGRAM_AMBIGUOUS]       more than one program with code UEHM
--   [SEASON_MISSING]          UEHM-S12 absent
--   [SEASON_AMBIGUOUS]        more than one season with code UEHM-S12
--   [SEASON_PARENT]           UEHM-S12 is not owned by program UEHM
--   [BATCH_MISSING]           UEHM-S12-B1 absent
--   [BATCH_AMBIGUOUS]         more than one intake batch with code UEHM-S12-B1
--   [BATCH_PARENT]            UEHM-S12-B1 is not owned by that exact UEHM-S12
--   [S11_BINDING]             the S12 intake resolves to a Season 11 season
--   [AUDIT_TABLE_MISSING]     admin_audit_log absent
--   [AUDIT_COLUMNS]           admin_audit_log is not the 13-column Production
--                             shape the release left behind
--   [AUDIT_ACTION_NOT_NULL]   action / actor_email / target_email / metadata is
--                             NOT NULL without a default, so the M069 audit
--                             INSERT would abort with 23502
--   [AUDIT_CONTRACT]          one of the 13 columns does not satisfy the M069
--                             audit INSERT contract: wrong type for a value the
--                             RPC writes, NOT NULL where the RPC writes NULL,
--                             omitted-and-NOT-NULL without a usable default, a
--                             default outside the expected family, or GENERATED
--                             / IDENTITY ALWAYS on a column the RPC supplies
--   [AUDIT_INSERT_BLOCKED]    admin_audit_log is not an ordinary table, or
--                             FORCE ROW LEVEL SECURITY is set on it, so the
--                             SECURITY DEFINER audit INSERT cannot land
--   [AUDIT_VOCAB_MISSING]     no action_type CHECK at all — the release T1 has
--                             not been applied here
--   [AUDIT_VOCAB_SHAPE]       more than one action_type CHECK, a CHECK under an
--                             unexpected name, an unparseable definition, or a
--                             duplicate value inside the list
--   [AUDIT_VOCAB_NOT_VALIDATED]  the CHECK exists but is NOT VALID
--   [AUDIT_VOCAB_M069_PRESENT]   the vocabulary already admits
--                             set_application_form_state
--   [AUDIT_VOCAB_UNEXPECTED]  the admitted set is not exactly the canonical 52
--                             (message names the missing and extra values)
--   [CONFLICTING_ROWS]        control rows exist without the table (impossible
--                             state, checked anyway)
-- =============================================================================

\echo '=== M069 PREFLIGHT — READ ONLY ==='

do $m069_preflight$
declare
  v_program_id        uuid;
  v_season_id         uuid;
  v_season_program_id uuid;
  v_batch_id          uuid;
  v_batch_season_id   uuid;
  v_cols              text[];
  v_txt               text;
  v_n                 integer;
  v_raw_n             integer;
  v_quote_n           integer;
  v_def               text;
  v_conname           text;
  v_validated         boolean;
  v_actual_vocab      text[];
  v_missing           text[];
  v_unexpected        text[];
  v_audit_cols constant text[] := array[
    'action','action_type','actor_admin_user_id','actor_email','after_data',
    'before_data','created_at','details','id','metadata','target_admin_user_id',
    'target_email','updated_at'
  ];
  -- ══ CANONICAL admin_audit_log INSERT CONTRACT (all 13 columns) ════════════
  -- Byte-identical to the array in apply.sql Section 0, and proven so by test.
  -- column # format_type # how the M069 audit INSERT treats it # default regex
  --
  --   value   an expression is written into the column
  --   null    the literal NULL is written into it, so it MUST be nullable
  --   omitted the column is not named in the INSERT at all, so it must either
  --           be nullable or carry a usable default / identity / generated value
  --
  -- The fourth field is set only for omitted NOT NULL columns, where the
  -- default is what makes the INSERT legal, and pins the family that default
  -- must belong to. `#` is the separator because the regexes contain `|`.
  --
  -- Derived from the accepted Production baseline — the 13-column shape in
  -- VAM_OS_PROD_S12_RELEASE_20260809/validation/prod_baseline_reproduction.sql
  -- with T1 Section 1's legacy NOT NULL drops applied — combined with what
  -- migration 069's audit INSERT actually writes into each column.
  v_audit_contract constant text[] := array[
    'action#text#value#',
    'action_type#text#value#',
    'actor_admin_user_id#uuid#value#',
    'actor_email#text#value#',
    'after_data#jsonb#value#',
    'before_data#jsonb#value#',
    'created_at#timestamp with time zone#omitted#^([a-z_]+\.)?(now\(\)|CURRENT_TIMESTAMP)$',
    'details#jsonb#value#',
    'id#uuid#omitted#^([a-z_]+\.)?(gen_random_uuid|uuid_generate_v4)\(\)$',
    'metadata#jsonb#omitted#',
    'target_admin_user_id#uuid#null#',
    'target_email#text#omitted#',
    'updated_at#timestamp with time zone#omitted#^([a-z_]+\.)?(now\(\)|CURRENT_TIMESTAMP)$'
  ];
  -- The four columns the SECURITY DEFINER authorization path reads, sorted.
  v_admin_user_cols constant text[] := array['email','id','role','status'];
  -- ══ CANONICAL PRE-M069 AUDIT VOCABULARY (52) ══════════════════════════════
  -- The exact list installed by the S12 release T1, Section 2. This array is
  -- the ONE canonical representation shared by preflight.sql, apply.sql
  -- Section 0, apply.sql / migration 069 Section 4 and verifier.sql.
  -- __tests__/support/m069-audit-vocabulary.ts carries the same 52 values and a
  -- test proves every copy is set-equal to it, so no two copies can drift.
  -- DO NOT EDIT ONE COPY. Edit all of them or the test fails.
  v_expected_vocab constant text[] := array[
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
  ];
  v_m069_value constant text := 'set_application_form_state';
  v_vocab_conname constant text := 'admin_audit_log_action_type_check';
begin
  -- ══ 1. Environment ════════════════════════════════════════════════════════
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M069 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  -- ══ 2. admin_users prerequisites for the SECURITY DEFINER path ════════════
  -- vam069_set_application_form_state selects id, email, role and status and
  -- compares role/status against text literals; application_form_controls
  -- references admin_users(id). All four facts are asserted, not assumed.
  if to_regclass('public.admin_users') is null then
    raise exception 'M069 PREFLIGHT REFUSED [ADMIN_USERS_MISSING]: admin_users does not exist; updated_by has no FK target.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_users'
    and column_name in ('id','email','role','status');
  if v_cols is distinct from v_admin_user_cols then
    raise exception 'M069 PREFLIGHT REFUSED [ADMIN_USERS_COLUMNS]: admin_users exposes %, expected all of %. The authorization path reads every one of them.',
      coalesce(v_cols::text, '<none>'), v_admin_user_cols::text;
  end if;

  select string_agg(column_name || ' is ' || data_type, ', ' order by column_name) into v_txt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_users'
    and ((column_name = 'id' and data_type <> 'uuid')
      or (column_name in ('email','role','status') and data_type not in ('text','character varying')));
  if v_txt is not null then
    raise exception 'M069 PREFLIGHT REFUSED [ADMIN_USERS_COLUMNS]: % — the authorization path compares role/status to text literals and passes id as uuid.', v_txt;
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_users')
      and c.contype in ('p','u')
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = to_regclass('public.admin_users')
                              and a.attname = 'id' and a.attnum > 0 and not a.attisdropped)]
  ) then
    raise exception 'M069 PREFLIGHT REFUSED [ADMIN_USERS_KEY]: admin_users.id carries no primary or unique key; application_form_controls.updated_by cannot reference it.';
  end if;

  -- ══ 3. Migration is completely unapplied ══════════════════════════════════
  if to_regclass('public.application_form_controls') is not null then
    raise exception 'M069 PREFLIGHT REFUSED [ALREADY_APPLIED]: application_form_controls already exists. Run verifier.sql instead.';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam069\_%';
  if v_n <> 0 then
    raise exception 'M069 PREFLIGHT REFUSED [FUNCTION_PRESENT]: % vam069_* function(s) already exist.', v_n;
  end if;

  -- Anything else M069 creates. A half-applied package — the trigger without
  -- the table, an index left behind by a failed rollback — is not a state
  -- apply.sql is written for.
  select string_agg(obj, ', ' order by obj) into v_txt from (
    select 'relation ' || c.relname as obj
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'application\_form\_controls%'
    union all
    select 'trigger ' || t.tgname
    from pg_trigger t
    where not t.tgisinternal and t.tgname like 'application\_form\_controls%'
    union all
    select 'constraint ' || c.conname
    from pg_constraint c
    where c.conname like 'application\_form\_controls%'
  ) s;
  if v_txt is not null then
    raise exception 'M069 PREFLIGHT REFUSED [PARTIAL_M069]: pre-existing M069 object(s): %. Roll the partial state back before applying.', v_txt;
  end if;

  -- ══ 4. Program / season / intake — exactly one row at every level ═════════
  -- The seed and the runtime both resolve the chain by code. If any level is
  -- ambiguous, "the" control row is not well defined.
  select count(*) into v_n from public.programs where code = 'UEHM';
  if v_n = 0 then
    raise exception 'M069 PREFLIGHT REFUSED [PROGRAM_MISSING]: no program with code UEHM.';
  end if;
  if v_n > 1 then
    raise exception 'M069 PREFLIGHT REFUSED [PROGRAM_AMBIGUOUS]: % programs with code UEHM, expected exactly 1.', v_n;
  end if;
  select id into v_program_id from public.programs where code = 'UEHM';

  select count(*) into v_n from public.seasons where code = 'UEHM-S12';
  if v_n = 0 then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_MISSING]: season UEHM-S12 not found.';
  end if;
  if v_n > 1 then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_AMBIGUOUS]: % rows with code UEHM-S12, expected exactly 1.', v_n;
  end if;
  select id, program_id into v_season_id, v_season_program_id
  from public.seasons where code = 'UEHM-S12';

  if v_season_program_id is distinct from v_program_id then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_PARENT]: UEHM-S12.program_id is %, expected the UEHM program %.',
      coalesce(v_season_program_id::text, '<null>'), v_program_id;
  end if;

  select count(*) into v_n from public.intake_batches where code = 'UEHM-S12-B1';
  if v_n = 0 then
    raise exception 'M069 PREFLIGHT REFUSED [BATCH_MISSING]: intake batch UEHM-S12-B1 not found.';
  end if;
  if v_n > 1 then
    raise exception 'M069 PREFLIGHT REFUSED [BATCH_AMBIGUOUS]: % rows with code UEHM-S12-B1, expected exactly 1.', v_n;
  end if;
  select id, season_id into v_batch_id, v_batch_season_id
  from public.intake_batches where code = 'UEHM-S12-B1';

  if v_batch_season_id is distinct from v_season_id then
    raise exception 'M069 PREFLIGHT REFUSED [BATCH_PARENT]: UEHM-S12-B1.season_id is %, expected the UEHM-S12 season %. A same-code batch under another season is not the M069 intake.',
      coalesce(v_batch_season_id::text, '<null>'), v_season_id;
  end if;

  -- Explicit S11 guard. The chain above is resolved by id, but this proves the
  -- resolved season is not a Season 11 row carrying an S12 code.
  if exists (
    select 1 from public.seasons s
    where s.id = v_batch_season_id and s.code like '%S11%'
  ) then
    raise exception 'M069 PREFLIGHT REFUSED [S11_BINDING]: UEHM-S12-B1 resolves to a Season 11 season.';
  end if;

  -- ══ 5. Audit prerequisites ════════════════════════════════════════════════
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_TABLE_MISSING]: admin_audit_log does not exist.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';
  if v_cols is distinct from v_audit_cols then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_COLUMNS]: admin_audit_log is %, expected the 13 post-release columns %.', v_cols, v_audit_cols;
  end if;

  -- The S12 release T1 dropped NOT NULL on these four legacy columns. If any
  -- of them is NOT NULL without a default here, the M069 audit INSERT aborts
  -- with 23502 — and because that INSERT shares a transaction with the state
  -- change, the toggle would fail entirely.
  select string_agg(a.attname, ', ' order by a.attname) into v_txt
  from pg_attribute a
  where a.attrelid = to_regclass('public.admin_audit_log')
    and a.attname in ('action','actor_email','target_email','metadata')
    and a.attnum > 0 and not a.attisdropped
    and a.attnotnull and a.atthasdef is false
    and a.attidentity = '' and a.attgenerated = '';
  if v_txt is not null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_ACTION_NOT_NULL]: legacy column(s) % are NOT NULL without a default. Apply the S12 release T1 first.', v_txt;
  end if;

  -- ── 5a0. The COMPLETE audit INSERT contract, not just the 13 names ───────
  -- Semantically identical to apply.sql Section 0 part E2, and refusing under
  -- the same two tags, so the two files cannot come to disagree about what a
  -- usable admin_audit_log is. Section 0 remains the security boundary: this
  -- block reports the same refusal earlier and without taking a lock.
  --
  -- Thirteen columns existing proves nothing about whether the M069 audit
  -- INSERT can succeed. Remove the default from NOT NULL id, created_at or
  -- updated_at and the name list is unchanged, while the first toggle after
  -- apply fails with 23502 — taking the state change down with it, because
  -- the two share a transaction. Every column is therefore checked in the
  -- class the INSERT puts it in: supplied directly (type must match what the
  -- RPC writes), supplied as NULL (must be nullable), or omitted (nullable,
  -- or NOT NULL with a default of the right family — a default of NULL::uuid
  -- satisfies "has a default" and still violates NOT NULL at INSERT time).
  if not exists (select 1 from pg_class
                  where oid = to_regclass('public.admin_audit_log') and relkind = 'r') then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_INSERT_BLOCKED]: admin_audit_log is not an ordinary table; the M069 audit INSERT is written against one.';
  end if;

  if exists (select 1 from pg_class
              where oid = to_regclass('public.admin_audit_log') and relforcerowsecurity) then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_INSERT_BLOCKED]: FORCE ROW LEVEL SECURITY is set on admin_audit_log, so the SECURITY DEFINER audit INSERT is filtered by policy even running as the table owner. RLS being merely ENABLED is the accepted baseline and is fine; FORCE is not.';
  end if;

  with expected as (
    select split_part(e, '#', 1)            as col,
           split_part(e, '#', 2)            as typ,
           split_part(e, '#', 3)            as supply,
           nullif(split_part(e, '#', 4), '') as default_re
    from unnest(v_audit_contract) e
  ),
  actual as (
    select a.attname::text                      as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull,
           a.attidentity,
           a.attgenerated,
           pg_get_expr(d.adbin, d.adrelid)      as defexpr
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('public.admin_audit_log')
      and a.attnum > 0 and not a.attisdropped
  ),
  violations(v) as (
    select e.col || ': absent from admin_audit_log'
      from expected e left join actual a on a.col = e.col
     where a.col is null
    union all
    select a.col || ': present but not part of the M069 audit INSERT contract'
      from actual a left join expected e on e.col = a.col
     where e.col is null
    union all
    select e.col || ': type is ' || a.typ || ', the contract requires ' || e.typ
      from expected e join actual a on a.col = e.col
     where a.typ <> e.typ
    union all
    select e.col || ': GENERATED/IDENTITY ALWAYS, but the M069 INSERT supplies it explicitly'
      from expected e join actual a on a.col = e.col
     where e.supply in ('value', 'null')
       and (a.attgenerated <> '' or a.attidentity = 'a')
    union all
    select e.col || ': NOT NULL, but the M069 INSERT writes NULL into it'
      from expected e join actual a on a.col = e.col
     where e.supply = 'null' and a.attnotnull
    union all
    select e.col || ': omitted by the M069 INSERT and NOT NULL with no usable default, identity or generated value'
      from expected e join actual a on a.col = e.col
     where e.supply = 'omitted' and a.attnotnull
       and a.attidentity = '' and a.attgenerated = ''
       and (a.defexpr is null or btrim(a.defexpr) ~* '^null(::[a-z ]+)?$')
    union all
    select e.col || ': default is ' || coalesce(a.defexpr, '<none>') || ', the contract requires ' || e.default_re
      from expected e join actual a on a.col = e.col
     where e.default_re is not null
       and a.attidentity = '' and a.attgenerated = ''
       and (a.defexpr is null or btrim(a.defexpr) !~ e.default_re)
  )
  select string_agg(v, '; ' order by v) into v_txt from violations;

  if v_txt is not null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_CONTRACT]: admin_audit_log does not satisfy the M069 audit INSERT contract: %. Re-derive this package against this database before applying.', v_txt;
  end if;

  -- ── 5a. Find the vocabulary constraint by DEFINITION, not by name ─────────
  -- Name alone is not evidence. A CHECK on action_type under a different name
  -- would still govern what the audit INSERT may write, and a second one would
  -- mean the effective vocabulary is an intersection this package does not
  -- model. Exactly one action_type CHECK must exist, and it must be the one
  -- apply.sql is going to drop.
  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_n = 0 then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_MISSING]: no CHECK constraint governs admin_audit_log.action_type. The S12 release T1 has not been applied to this database.';
  end if;
  if v_n > 1 then
    select string_agg(c.conname, ', ' order by c.conname) into v_txt
    from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%action_type%';
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % CHECK constraints govern action_type (%), expected exactly 1.', v_n, v_txt;
  end if;

  select c.conname, c.convalidated, pg_get_constraintdef(c.oid)
    into v_conname, v_validated, v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_conname is distinct from v_vocab_conname then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: the action_type CHECK is named %, expected %. apply.sql drops it by name.',
      coalesce(v_conname, '<null>'), v_vocab_conname;
  end if;
  if v_validated is not true then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_NOT_VALIDATED]: % is NOT VALID, so existing rows are not proven to satisfy it.', v_conname;
  end if;

  -- ── 5b. Parse the definition into the ACTUAL admitted set ────────────────
  -- Every admitted value appears as '<value>'::text. The quote-pairing check
  -- below proves the parse is complete: if any quoted literal in the
  -- definition was not captured as one of these elements, the definition is
  -- not the closed ANY(ARRAY[...]) shape this package understands and the
  -- parsed set is not evidence of anything.
  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % is not a closed ANY(ARRAY[...]) list: %.', v_conname, v_def;
  end if;

  select count(*) into v_raw_n
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  select array_agg(distinct m[1]) into v_actual_vocab
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  v_quote_n := length(v_def) - length(replace(v_def, '''', ''));
  if v_quote_n <> 2 * v_raw_n then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % contains % quote characters but only % parseable ''value''::text elements — part of the definition was not understood: %.',
      v_conname, v_quote_n, v_raw_n, v_def;
  end if;
  if v_raw_n <> coalesce(array_length(v_actual_vocab, 1), 0) then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % lists % elements but only % are distinct — the vocabulary contains duplicates.',
      v_conname, v_raw_n, coalesce(array_length(v_actual_vocab, 1), 0);
  end if;

  -- ── 5c. EXACT SET EQUALITY against the canonical 52 ──────────────────────
  if v_m069_value = any (v_actual_vocab) then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_M069_PRESENT]: the vocabulary already admits %. M069 has been applied here, or something else added the value. Re-derive this package.', v_m069_value;
  end if;

  select array_agg(x order by x) into v_missing
  from unnest(v_expected_vocab) x
  where x <> all (coalesce(v_actual_vocab, array[]::text[]));

  select array_agg(x order by x) into v_unexpected
  from unnest(coalesce(v_actual_vocab, array[]::text[])) x
  where x <> all (v_expected_vocab);

  if v_missing is not null or v_unexpected is not null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: % admits % value(s) but is not the canonical pre-M069 vocabulary. MISSING (expected, not present): %. UNEXPECTED (present, not expected): %. apply.sql would replace this list with its own and drop the unexpected value(s) — re-derive the package against this database first.',
      v_conname,
      coalesce(array_length(v_actual_vocab, 1), 0),
      coalesce(array_to_string(v_missing, ', '), '<none>'),
      coalesce(array_to_string(v_unexpected, ', '), '<none>');
  end if;

  -- Redundant given set equality, asserted anyway so the count appears in the
  -- transcript the owner keeps.
  if coalesce(array_length(v_actual_vocab, 1), 0) <> 52 then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: % admits % values, expected exactly 52.',
      v_conname, coalesce(array_length(v_actual_vocab, 1), 0);
  end if;

  -- ══ 6. No conflicting rows ════════════════════════════════════════════════
  -- The table does not exist (asserted above), so there can be no control
  -- rows. Asserted anyway so a partially-applied state cannot slip through.
  if to_regclass('public.application_form_controls') is not null then
    select count(*) into v_n from public.application_form_controls;
    if v_n <> 0 then
      raise exception 'M069 PREFLIGHT REFUSED [CONFLICTING_ROWS]: % pre-existing control row(s).', v_n;
    end if;
  end if;

  raise notice 'M069 PREFLIGHT PASSED. Program/season/intake chain is exactly one row deep at every level, admin_users carries the authorization columns, all 13 admin_audit_log columns satisfy the M069 audit INSERT contract, the audit vocabulary is set-equal to the canonical 52, and no M069 object exists. Record the emitted values below, then run apply.sql.';
end
$m069_preflight$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PASS TOKEN AND BASELINE SEALS
--
-- The third field is VOCAB52EXACT only when the admitted set is set-equal to
-- the canonical 52 — not when it merely holds 52 values. A different 52-value
-- list emits VOCABDRIFT, and the audit_vocab_missing / audit_vocab_unexpected
-- columns name the offending values.
--
-- The sixth field is AUDITCONTRACT13 only when all 13 admin_audit_log columns
-- satisfy the M069 audit INSERT contract in full — type, nullability, default
-- presence, default family and generated/identity behaviour, evaluated by the
-- SAME rules the guard above and apply.sql Section 0 apply. NULLABLE4 alone
-- was never that: it reported four legacy columns and said nothing about the
-- three omitted NOT NULL columns whose defaults the INSERT depends on.
-- Anything else emits AUDITCONTRACTDRIFT and audit_contract_violations names
-- the offending columns.
--
-- Expected token on the reviewed R4.2 Production baseline:
--   M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:AUDITCONTRACT13:S12OK
-- ═══════════════════════════════════════════════════════════════════════════
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
audit_check as (
  select c.conname, c.convalidated, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
),
actual_vocab(value) as (
  select distinct m[1]
  from audit_check
  cross join lateral regexp_matches(audit_check.def, '''([^'']*)''::text', 'g') m
),
drift as (
  select
    (select string_agg(value, ', ' order by value)
       from (select value from expected_vocab except select value from actual_vocab) a) as missing,
    (select string_agg(value, ', ' order by value)
       from (select value from actual_vocab except select value from expected_vocab) b) as unexpected
),

-- ══ The audit INSERT contract, re-evaluated for the token ══════════════════
-- Third copy of the contract array (guard, this CTE, apply.sql Section 0); a
-- test proves all three are identical, exactly as it does for the 52-value
-- vocabulary. The seven violation branches below are the same seven the guard
-- raises [AUDIT_CONTRACT] on.
audit_contract(spec) as (
  select unnest(array[
    'action#text#value#',
    'action_type#text#value#',
    'actor_admin_user_id#uuid#value#',
    'actor_email#text#value#',
    'after_data#jsonb#value#',
    'before_data#jsonb#value#',
    'created_at#timestamp with time zone#omitted#^([a-z_]+\.)?(now\(\)|CURRENT_TIMESTAMP)$',
    'details#jsonb#value#',
    'id#uuid#omitted#^([a-z_]+\.)?(gen_random_uuid|uuid_generate_v4)\(\)$',
    'metadata#jsonb#omitted#',
    'target_admin_user_id#uuid#null#',
    'target_email#text#omitted#',
    'updated_at#timestamp with time zone#omitted#^([a-z_]+\.)?(now\(\)|CURRENT_TIMESTAMP)$'
  ])
),
audit_expected as (
  select split_part(spec, '#', 1)            as col,
         split_part(spec, '#', 2)            as typ,
         split_part(spec, '#', 3)            as supply,
         nullif(split_part(spec, '#', 4), '') as default_re
  from audit_contract
),
audit_actual as (
  select a.attname::text                      as col,
         format_type(a.atttypid, a.atttypmod) as typ,
         a.attnotnull,
         a.attidentity,
         a.attgenerated,
         pg_get_expr(d.adbin, d.adrelid)      as defexpr
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = to_regclass('public.admin_audit_log')
    and a.attnum > 0 and not a.attisdropped
),
audit_violations(v) as (
  select e.col || ': absent'
    from audit_expected e left join audit_actual a on a.col = e.col
   where a.col is null
  union all
  select a.col || ': not in the contract'
    from audit_actual a left join audit_expected e on e.col = a.col
   where e.col is null
  union all
  select e.col || ': type ' || a.typ || ' <> ' || e.typ
    from audit_expected e join audit_actual a on a.col = e.col
   where a.typ <> e.typ
  union all
  select e.col || ': generated/identity always but supplied'
    from audit_expected e join audit_actual a on a.col = e.col
   where e.supply in ('value', 'null')
     and (a.attgenerated <> '' or a.attidentity = 'a')
  union all
  select e.col || ': not null but written NULL'
    from audit_expected e join audit_actual a on a.col = e.col
   where e.supply = 'null' and a.attnotnull
  union all
  select e.col || ': omitted, not null, no usable default'
    from audit_expected e join audit_actual a on a.col = e.col
   where e.supply = 'omitted' and a.attnotnull
     and a.attidentity = '' and a.attgenerated = ''
     and (a.defexpr is null or btrim(a.defexpr) ~* '^null(::[a-z ]+)?$')
  union all
  select e.col || ': default ' || coalesce(a.defexpr, '<none>') || ' outside the expected family'
    from audit_expected e join audit_actual a on a.col = e.col
   where e.default_re is not null
     and a.attidentity = '' and a.attgenerated = ''
     and (a.defexpr is null or btrim(a.defexpr) !~ e.default_re)
  union all
  select 'admin_audit_log: FORCE ROW LEVEL SECURITY blocks the definer INSERT'
    from pg_class
   where oid = to_regclass('public.admin_audit_log') and relforcerowsecurity
  union all
  select 'admin_audit_log: not an ordinary table'
    from pg_class
   where oid = to_regclass('public.admin_audit_log') and relkind <> 'r'
)
select
  'M069:'
  || case when to_regclass('public.application_form_controls') is null then 'ABSENT' else 'PRESENT' end
  || ':' || case
       when (select count(*) from audit_check) <> 1 then 'VOCABNOCHECK'
       when (select missing from drift) is null and (select unexpected from drift) is null
            and (select count(*) from actual_vocab) = 52 then 'VOCAB52EXACT'
       else 'VOCABDRIFT'
     end
  || ':' || coalesce((select case when convalidated then 'VALIDATED' else 'NOTVALID' end from audit_check), 'NOCHECK')
  || ':NULLABLE' || (
       select count(*)::text from pg_attribute a
       where a.attrelid = to_regclass('public.admin_audit_log')
         and a.attname in ('action','actor_email','target_email','metadata')
         and a.attnum > 0 and not a.attisdropped and not a.attnotnull
     )
  || ':' || case
       when (select count(*) from audit_violations) = 0
            and (select count(*) from audit_actual) = 13
       then 'AUDITCONTRACT13'
       else 'AUDITCONTRACTDRIFT'
     end
  || ':' || case when (
       select count(*) from public.intake_batches b
       join public.seasons s on s.id = b.season_id
       join public.programs p on p.id = s.program_id
       where b.code = 'UEHM-S12-B1' and s.code = 'UEHM-S12' and p.code = 'UEHM'
     ) = 1 then 'S12OK' else 'S12BAD' end
  as preflight_token,
  (select count(*) from actual_vocab) as audit_vocab_size,
  coalesce((select missing from drift), '<none>') as audit_vocab_missing,
  coalesce((select unexpected from drift), '<none>') as audit_vocab_unexpected,
  md5(coalesce((select string_agg(value, ',' order by value) from actual_vocab), '<none>')) as audit_vocab_seal,
  coalesce((select string_agg(v, '; ' order by v) from audit_violations), '<none>')
    as audit_contract_violations,
  md5(coalesce((
    select string_agg(column_name || ':' || data_type || ':' || is_nullable, '|' order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_audit_log'
  ), '<none>')) as audit_column_seal,
  -- The full per-column contract seal: name, exact type, nullability, default
  -- and generated/identity behaviour of all 13 columns. Diagnostic — the
  -- binding proof is the per-column refusal above, which names what is wrong
  -- instead of only reporting that something is.
  md5(coalesce((
    select string_agg(col || ':' || typ || ':' || attnotnull::text || ':'
                      || coalesce(defexpr, '<none>') || ':'
                      || coalesce(nullif(attidentity::text, ''), '-') || ':'
                      || coalesce(nullif(attgenerated::text, ''), '-'), '|' order by col)
    from audit_actual
  ), '<none>')) as audit_contract_seal,
  (select count(*) from public.admin_audit_log) as audit_rows_now,
  now() at time zone 'UTC' as captured_at_utc;
