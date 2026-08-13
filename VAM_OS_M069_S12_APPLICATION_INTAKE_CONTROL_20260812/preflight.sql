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

  raise notice 'M069 PREFLIGHT PASSED. Program/season/intake chain is exactly one row deep at every level, admin_users carries the authorization columns, the audit vocabulary is set-equal to the canonical 52, and no M069 object exists. Record the emitted values below, then run apply.sql.';
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
-- Expected token on the reviewed R4.2 Production baseline:
--   M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:S12OK
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
  md5(coalesce((
    select string_agg(column_name || ':' || data_type || ':' || is_nullable, '|' order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_audit_log'
  ), '<none>')) as audit_column_seal,
  (select count(*) from public.admin_audit_log) as audit_rows_now,
  now() at time zone 'UTC' as captured_at_utc;
