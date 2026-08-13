-- =============================================================================
-- VAM OS — M069 PRODUCTION APPLY
--
-- Identical in effect to supabase_migrations/069_application_form_controls.sql;
-- this copy adds the Section 0 re-assertion block below.
--
-- THIS FILE DOES NOT DEPEND ON preflight.sql HAVING BEEN RUN.
-- Section 0 re-asserts every material condition the standalone preflight
-- proves — environment, admin_users authorization prerequisites, complete
-- absence of M069, exact UEHM / UEHM-S12 / UEHM-S12-B1 cardinality and
-- parentage, the admin_audit_log column and nullability shape, and exact set
-- equality of the pre-M069 52-value audit vocabulary — INSIDE this
-- transaction, before the first mutation. Running the preflight is still
-- recommended (it reports the same refusals without taking a lock), but
-- skipping it, or a baseline that drifted after it passed, cannot make this
-- apply unsafe: the transaction aborts before it writes anything.
--
-- MIGRATION 069
-- Season 12 Application Intake Control
--
-- Adds the DB-backed, authoritative open/close state for the public
-- /apply/mentor and /apply/mentee forms, so the owner can control public
-- recruitment WITHOUT editing Vercel environment variables or redeploying.
--
-- PRODUCT MODEL — three states, not two:
--   'closed' : page renders a closed notice; the submission Server Action
--              rejects. This is the ONLY state this migration ever writes.
--   'pilot'  : reachable only with the correct ?token=<VAM_OS_APPLY_TOKEN>.
--              Page AND Server Action enforce the identical token contract.
--   'open'   : fully public, no token anywhere.
--
-- This preserves the semantics that already existed in lib/apply-gate.ts
-- (enable-flag + token, with a tokenless opt-in) rather than replacing them
-- with a weaker two-state model. See M069 README for the full reconstruction.
--
-- SAFETY CONTRACT
--   * No form is ever opened by a migration. Both seeded rows are 'closed'.
--   * Season 11 is never referenced, read, or written.
--   * No grant is issued to anon or authenticated. RLS on, zero policies:
--     only the service-role/definer path can see or change these rows.
--   * Re-running this file is a no-op (guarded by IF NOT EXISTS / ON CONFLICT).
-- =============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── Section 0. Re-assert the whole baseline inside this transaction ─────────
-- Self-contained by design. Every refusal condition preflight.sql tests is
-- re-tested here, under the same bracketed tags, before the first mutation.
-- The preflight and this block share ONE canonical expected vocabulary array
-- (see the comment on v_expected_vocab), and a test proves the two tag sets
-- and the two arrays match, so they cannot drift apart semantically.
do $m069_guard$
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
  v_admin_user_cols constant text[] := array['email','id','role','status'];
  -- ══ CANONICAL PRE-M069 AUDIT VOCABULARY (52) ══════════════════════════════
  -- The exact list installed by the S12 release T1, Section 2. This array is
  -- the ONE canonical representation shared by preflight.sql, this block,
  -- Section 4 below and verifier.sql.
  -- __tests__/support/m069-audit-vocabulary.ts carries the same 52 values and a
  -- test proves every copy is set-equal to it. DO NOT EDIT ONE COPY.
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
  -- ── A. Environment / Production identity ─────────────────────────────────
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M069 ABORTED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  -- ── B. admin_users prerequisites for the SECURITY DEFINER path ───────────
  if to_regclass('public.admin_users') is null then
    raise exception 'M069 ABORTED [ADMIN_USERS_MISSING]: admin_users does not exist; updated_by has no FK target.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_users'
    and column_name in ('id','email','role','status');
  if v_cols is distinct from v_admin_user_cols then
    raise exception 'M069 ABORTED [ADMIN_USERS_COLUMNS]: admin_users exposes %, expected all of %. The authorization path reads every one of them.',
      coalesce(v_cols::text, '<none>'), v_admin_user_cols::text;
  end if;

  select string_agg(column_name || ' is ' || data_type, ', ' order by column_name) into v_txt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_users'
    and ((column_name = 'id' and data_type <> 'uuid')
      or (column_name in ('email','role','status') and data_type not in ('text','character varying')));
  if v_txt is not null then
    raise exception 'M069 ABORTED [ADMIN_USERS_COLUMNS]: % — the authorization path compares role/status to text literals and passes id as uuid.', v_txt;
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_users')
      and c.contype in ('p','u')
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = to_regclass('public.admin_users')
                              and a.attname = 'id' and a.attnum > 0 and not a.attisdropped)]
  ) then
    raise exception 'M069 ABORTED [ADMIN_USERS_KEY]: admin_users.id carries no primary or unique key; updated_by cannot reference it.';
  end if;

  -- ── C. M069 is completely unapplied ──────────────────────────────────────
  if to_regclass('public.application_form_controls') is not null then
    raise exception 'M069 ABORTED [ALREADY_APPLIED]: application_form_controls already exists. Run verifier.sql instead.';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam069\_%';
  if v_n <> 0 then
    raise exception 'M069 ABORTED [FUNCTION_PRESENT]: % vam069_* function(s) already exist.', v_n;
  end if;

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
    raise exception 'M069 ABORTED [PARTIAL_M069]: pre-existing M069 object(s): %. Roll the partial state back before applying.', v_txt;
  end if;

  -- ── D. Exact UEHM / UEHM-S12 / UEHM-S12-B1 cardinality and chain ─────────
  select count(*) into v_n from public.programs where code = 'UEHM';
  if v_n = 0 then
    raise exception 'M069 ABORTED [PROGRAM_MISSING]: no program with code UEHM.';
  end if;
  if v_n > 1 then
    raise exception 'M069 ABORTED [PROGRAM_AMBIGUOUS]: % programs with code UEHM, expected exactly 1.', v_n;
  end if;
  select id into v_program_id from public.programs where code = 'UEHM';

  select count(*) into v_n from public.seasons where code = 'UEHM-S12';
  if v_n = 0 then
    raise exception 'M069 ABORTED [SEASON_MISSING]: season UEHM-S12 not found.';
  end if;
  if v_n > 1 then
    raise exception 'M069 ABORTED [SEASON_AMBIGUOUS]: % rows with code UEHM-S12, expected exactly 1.', v_n;
  end if;
  select id, program_id into v_season_id, v_season_program_id
  from public.seasons where code = 'UEHM-S12';

  if v_season_program_id is distinct from v_program_id then
    raise exception 'M069 ABORTED [SEASON_PARENT]: UEHM-S12.program_id is %, expected the UEHM program %.',
      coalesce(v_season_program_id::text, '<null>'), v_program_id;
  end if;

  select count(*) into v_n from public.intake_batches where code = 'UEHM-S12-B1';
  if v_n = 0 then
    raise exception 'M069 ABORTED [BATCH_MISSING]: intake batch UEHM-S12-B1 not found.';
  end if;
  if v_n > 1 then
    raise exception 'M069 ABORTED [BATCH_AMBIGUOUS]: % rows with code UEHM-S12-B1, expected exactly 1.', v_n;
  end if;
  select id, season_id into v_batch_id, v_batch_season_id
  from public.intake_batches where code = 'UEHM-S12-B1';

  if v_batch_season_id is distinct from v_season_id then
    raise exception 'M069 ABORTED [BATCH_PARENT]: UEHM-S12-B1.season_id is %, expected the UEHM-S12 season %. A same-code batch under another season is not the M069 intake.',
      coalesce(v_batch_season_id::text, '<null>'), v_season_id;
  end if;

  if exists (
    select 1 from public.seasons s
    where s.id = v_batch_season_id and s.code like '%S11%'
  ) then
    raise exception 'M069 ABORTED [S11_BINDING]: UEHM-S12-B1 resolves to a Season 11 season.';
  end if;

  -- The seed below joins on codes. This asserts the join it will perform
  -- resolves to exactly the one chain proven above.
  select count(*) into v_n
  from public.intake_batches b
  join public.seasons s on s.id = b.season_id
  join public.programs p on p.id = s.program_id
  where b.code = 'UEHM-S12-B1' and s.code = 'UEHM-S12' and p.code = 'UEHM';
  if v_n <> 1 then
    raise exception 'M069 ABORTED [S12_BINDING]: UEHM / UEHM-S12 / UEHM-S12-B1 resolves as % chain(s), expected exactly 1.', v_n;
  end if;

  -- ── E. admin_audit_log prerequisites for the M069 audit INSERT ───────────
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'M069 ABORTED [AUDIT_TABLE_MISSING]: admin_audit_log does not exist.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';
  if v_cols is distinct from v_audit_cols then
    raise exception 'M069 ABORTED [AUDIT_COLUMNS]: admin_audit_log is %, expected the 13 post-release columns %.', v_cols, v_audit_cols;
  end if;

  select string_agg(a.attname, ', ' order by a.attname) into v_txt
  from pg_attribute a
  where a.attrelid = to_regclass('public.admin_audit_log')
    and a.attname in ('action','actor_email','target_email','metadata')
    and a.attnum > 0 and not a.attisdropped
    and a.attnotnull and a.atthasdef is false
    and a.attidentity = '' and a.attgenerated = '';
  if v_txt is not null then
    raise exception 'M069 ABORTED [AUDIT_ACTION_NOT_NULL]: legacy column(s) % would abort the audit INSERT with 23502.', v_txt;
  end if;

  -- Find the vocabulary constraint by DEFINITION, not by name: a CHECK on
  -- action_type under any name still governs what the audit INSERT may write.
  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_n = 0 then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_MISSING]: no CHECK constraint governs admin_audit_log.action_type. The S12 release T1 has not been applied to this database.';
  end if;
  if v_n > 1 then
    select string_agg(c.conname, ', ' order by c.conname) into v_txt
    from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%action_type%';
    raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: % CHECK constraints govern action_type (%), expected exactly 1.', v_n, v_txt;
  end if;

  select c.conname, c.convalidated, pg_get_constraintdef(c.oid)
    into v_conname, v_validated, v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_conname is distinct from v_vocab_conname then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: the action_type CHECK is named %, expected %. Section 4 drops it by name.',
      coalesce(v_conname, '<null>'), v_vocab_conname;
  end if;
  if v_validated is not true then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_NOT_VALIDATED]: % is NOT VALID, so existing rows are not proven to satisfy it.', v_conname;
  end if;

  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: % is not a closed ANY(ARRAY[...]) list: %.', v_conname, v_def;
  end if;

  select count(*) into v_raw_n
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  select array_agg(distinct m[1]) into v_actual_vocab
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  -- Quote pairing proves the parse is COMPLETE: every quoted literal in the
  -- definition was captured as one of the elements below. Without this, a
  -- value the regex could not read would be invisible to the set comparison.
  v_quote_n := length(v_def) - length(replace(v_def, '''', ''));
  if v_quote_n <> 2 * v_raw_n then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: % contains % quote characters but only % parseable ''value''::text elements — part of the definition was not understood: %.',
      v_conname, v_quote_n, v_raw_n, v_def;
  end if;
  if v_raw_n <> coalesce(array_length(v_actual_vocab, 1), 0) then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: % lists % elements but only % are distinct — the vocabulary contains duplicates.',
      v_conname, v_raw_n, coalesce(array_length(v_actual_vocab, 1), 0);
  end if;

  if v_m069_value = any (v_actual_vocab) then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_M069_PRESENT]: the vocabulary already admits %. M069 has been applied here, or something else added the value.', v_m069_value;
  end if;

  select array_agg(x order by x) into v_missing
  from unnest(v_expected_vocab) x
  where x <> all (coalesce(v_actual_vocab, array[]::text[]));

  select array_agg(x order by x) into v_unexpected
  from unnest(coalesce(v_actual_vocab, array[]::text[])) x
  where x <> all (v_expected_vocab);

  if v_missing is not null or v_unexpected is not null then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_UNEXPECTED]: % admits % value(s) but is not the canonical pre-M069 vocabulary. MISSING (expected, not present): %. UNEXPECTED (present, not expected): %. Section 4 would replace this list with its own and drop the unexpected value(s).',
      v_conname,
      coalesce(array_length(v_actual_vocab, 1), 0),
      coalesce(array_to_string(v_missing, ', '), '<none>'),
      coalesce(array_to_string(v_unexpected, ', '), '<none>');
  end if;

  if coalesce(array_length(v_actual_vocab, 1), 0) <> 52 then
    raise exception 'M069 ABORTED [AUDIT_VOCAB_UNEXPECTED]: % admits % values, expected exactly 52.',
      v_conname, coalesce(array_length(v_actual_vocab, 1), 0);
  end if;

  -- ── F. No conflicting control rows ───────────────────────────────────────
  -- The table is proven absent above, so this cannot fire. Asserted anyway so
  -- that a state this package does not model can never be written over.
  if to_regclass('public.application_form_controls') is not null then
    select count(*) into v_n from public.application_form_controls;
    if v_n <> 0 then
      raise exception 'M069 ABORTED [CONFLICTING_ROWS]: % pre-existing control row(s).', v_n;
    end if;
  end if;

  raise notice 'M069 Section 0 passed: environment, admin_users authorization prerequisites, complete absence of M069, exact UEHM/UEHM-S12/UEHM-S12-B1 chain, audit schema and set-equal 52-value audit vocabulary all re-asserted inside this transaction.';
end
$m069_guard$;

-- ── 1. The control table ────────────────────────────────────────────────────
-- Keyed on (intake_batch_id, applicant_role). intake_batch_id already implies
-- exactly one season, and season implies exactly one program, so this key
-- cannot express a program/season/intake combination that disagrees with the
-- catalog. program_id and season_id are stored denormalised for auditability
-- and are re-verified against the catalog by the trigger below.
create table if not exists public.application_form_controls (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.programs(id),
  season_id         uuid not null references public.seasons(id),
  intake_batch_id   uuid not null references public.intake_batches(id),
  applicant_role    text not null,
  state             text not null default 'closed',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.admin_users(id),
  constraint application_form_controls_role_check
    check (applicant_role = any (array['mentor', 'mentee'])),
  constraint application_form_controls_state_check
    check (state = any (array['closed', 'pilot', 'open']))
);

-- Strong uniqueness: exactly one control row per intake batch per role.
-- This is what makes "read the control row" a total function with no
-- tie-breaking, and what makes the seed below exactly-once safe.
create unique index if not exists application_form_controls_batch_role_key
  on public.application_form_controls (intake_batch_id, applicant_role);

comment on table public.application_form_controls is
  'M069. Authoritative open/close/pilot state for the public application forms. '
  'One row per (intake_batch, applicant_role). Never opened by a migration.';

-- ── 2. Binding integrity ────────────────────────────────────────────────────
-- A composite FK would need UNIQUE(id, season_id) on intake_batches and
-- UNIQUE(id, program_id) on seasons, neither of which exists on the live
-- shape; adding them would be DDL on tables M069 has no business touching.
-- A constraint trigger enforces the same invariant without that reach.
create or replace function public.vam069_assert_control_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season_id  uuid;
  v_program_id uuid;
begin
  select b.season_id, s.program_id
    into v_season_id, v_program_id
  from public.intake_batches b
  join public.seasons s on s.id = b.season_id
  where b.id = new.intake_batch_id;

  if v_season_id is null then
    raise exception 'vam069: intake_batch % does not resolve to a season', new.intake_batch_id
      using errcode = '23514';
  end if;
  if new.season_id is distinct from v_season_id then
    raise exception 'vam069: season_id % does not own intake_batch %', new.season_id, new.intake_batch_id
      using errcode = '23514';
  end if;
  if new.program_id is distinct from v_program_id then
    raise exception 'vam069: program_id % does not own season %', new.program_id, new.season_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists application_form_controls_binding on public.application_form_controls;
create trigger application_form_controls_binding
  before insert or update on public.application_form_controls
  for each row execute function public.vam069_assert_control_binding();

-- ── 3. Lock the table down ──────────────────────────────────────────────────
-- RLS enabled with ZERO policies. service_role bypasses RLS; every other
-- Postgres role sees an empty table and cannot write. No grant is added here,
-- and any inherited grant to the public web roles is revoked.
alter table public.application_form_controls enable row level security;

revoke all on public.application_form_controls from public;
revoke all on public.application_form_controls from anon;
revoke all on public.application_form_controls from authenticated;

-- ── 4. Audit vocabulary ─────────────────────────────────────────────────────
-- Production's admin_audit_log_action_type_check is a CLOSED, VALIDATED
-- 52-value list installed by the S12 release T1. It admits no value for a
-- form state change, so an M069 audit INSERT would abort with 23514 — and
-- because the M069 toggle is atomic, that would abort the toggle itself.
-- Extend the vocabulary by exactly one value. Nothing is removed.
--
-- The replacement list below is hard-coded, so it is only safe if the list it
-- replaces is EXACTLY the canonical pre-M069 52. A count of 52 does not prove
-- that: a different 52-value list would pass a count check and this block would
-- then silently delete a legitimate Production action type. So the existing
-- definition is parsed into the set it actually admits and compared for SET
-- EQUALITY in both directions before the drop, and the installed definition is
-- compared again afterwards against the canonical 52 plus exactly
-- set_application_form_state.
do $vocab$
declare
  v_def           text;
  v_actual_vocab  text[];
  v_missing       text[];
  v_unexpected    text[];
  v_post_expected text[];
  v_raw_n         integer;
  v_quote_n       integer;
  -- CANONICAL PRE-M069 AUDIT VOCABULARY (52). The exact list installed by the
  -- S12 release T1, Section 2. Shared verbatim with preflight.sql, apply.sql
  -- Section 0 and verifier.sql; __tests__/support/m069-audit-vocabulary.ts
  -- holds the same 52 values and a test proves every copy is set-equal to it.
  -- DO NOT EDIT ONE COPY.
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
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise notice 'M069: no admin_audit_log_action_type_check present; nothing to extend.';
  elsif v_def like '%set_application_form_state%' then
    raise notice 'M069: audit vocabulary already admits set_application_form_state.';
  else
    -- Parse the list about to be replaced, and prove the parse is COMPLETE:
    -- every quote character in the definition must belong to one of the
    -- 'value'::text elements captured here, or the definition is not the closed
    -- ANY(ARRAY[...]) shape this block understands and the parsed set is not
    -- evidence of anything.
    select count(*) into v_raw_n
    from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

    select array_agg(distinct m[1]) into v_actual_vocab
    from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

    v_quote_n := length(v_def) - length(replace(v_def, '''', ''));
    if v_def not ilike '%= ANY (ARRAY[%' or v_quote_n <> 2 * v_raw_n
       or v_raw_n <> coalesce(array_length(v_actual_vocab, 1), 0) then
      raise exception 'M069 ABORTED [AUDIT_VOCAB_SHAPE]: admin_audit_log_action_type_check is not a parseable, duplicate-free ANY(ARRAY[...]) list: %.', v_def;
    end if;

    select array_agg(x order by x) into v_missing
    from unnest(v_expected_vocab) x where x <> all (coalesce(v_actual_vocab, array[]::text[]));
    select array_agg(x order by x) into v_unexpected
    from unnest(coalesce(v_actual_vocab, array[]::text[])) x where x <> all (v_expected_vocab);

    if v_missing is not null or v_unexpected is not null then
      raise exception 'M069 ABORTED [AUDIT_VOCAB_UNEXPECTED]: the vocabulary being replaced admits % value(s) but is not the canonical pre-M069 52. MISSING (expected, not present): %. UNEXPECTED (present, not expected): %. Replacing it would drop the unexpected value(s).',
        coalesce(array_length(v_actual_vocab, 1), 0),
        coalesce(array_to_string(v_missing, ', '), '<none>'),
        coalesce(array_to_string(v_unexpected, ', '), '<none>');
    end if;

    alter table public.admin_audit_log
      drop constraint admin_audit_log_action_type_check;
    alter table public.admin_audit_log
      add constraint admin_audit_log_action_type_check check (
        action_type = any (array[
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
          'remove_event_participation','remove_membership_role','set_application_form_state',
          'soft_delete_recap','sync_auth','unknown',
          'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
          'update_mentee_profile','update_mentor_profile','update_registration_review_note',
          'waitlist_event_registration','withdraw_membership'
        ])
      );

    -- Re-read what actually landed and prove it is the canonical 52 plus
    -- exactly one new value. Nothing lost, nothing extra.
    select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = 'admin_audit_log_action_type_check';

    select array_agg(distinct m[1]) into v_actual_vocab
    from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

    v_post_expected := v_expected_vocab || v_m069_value;

    select array_agg(x order by x) into v_missing
    from unnest(v_post_expected) x where x <> all (coalesce(v_actual_vocab, array[]::text[]));
    select array_agg(x order by x) into v_unexpected
    from unnest(coalesce(v_actual_vocab, array[]::text[])) x where x <> all (v_post_expected);

    if v_missing is not null or v_unexpected is not null
       or coalesce(array_length(v_actual_vocab, 1), 0) <> 53 then
      raise exception 'M069 ABORTED [AUDIT_VOCAB_POST]: the installed vocabulary is not the canonical 52 plus %. Size %. MISSING: %. UNEXPECTED: %.',
        v_m069_value,
        coalesce(array_length(v_actual_vocab, 1), 0),
        coalesce(array_to_string(v_missing, ', '), '<none>'),
        coalesce(array_to_string(v_unexpected, ', '), '<none>');
    end if;

    raise notice 'M069: audit vocabulary extended to 53 values (added set_application_form_state).';
  end if;
end
$vocab$;

-- ── 5. The one and only mutation path ───────────────────────────────────────
-- State change + audit row in ONE transaction. If the audit INSERT fails for
-- any reason the state change is rolled back with it, so a change can never
-- be applied unaudited. Requirement 12 is structural here, not best-effort.
--
-- Authorization is defence in depth: the caller (app/actions) has already
-- checked global role and season scope; this re-checks that the actor is an
-- ACTIVE admin_users row with a role permitted to change public recruitment.
create or replace function public.vam069_set_application_form_state(
  p_actor_admin_user_id uuid,
  p_intake_batch_code   text,
  p_applicant_role      text,
  p_expected_state      text,
  p_new_state           text
)
returns table (
  outcome_status text,
  previous_state text,
  new_state      text,
  updated_at     timestamptz,
  actor_email    text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    record;
  v_control  record;
  v_batch    record;
begin
  if p_new_state is null or p_new_state <> all (array['closed', 'pilot', 'open']) then
    raise exception 'vam069: unsupported target state' using errcode = '22023';
  end if;
  if p_applicant_role is null or p_applicant_role <> all (array['mentor', 'mentee']) then
    raise exception 'vam069: unsupported applicant role' using errcode = '22023';
  end if;

  -- Actor must exist, be active, and hold a role allowed to change public
  -- recruitment state. core_team, reviewer, support_team and viewer are NOT
  -- allowed — see M069 README, Phase 2.
  select u.id, u.email, u.role, u.status
    into v_actor
  from public.admin_users u
  where u.id = p_actor_admin_user_id;

  if v_actor.id is null or v_actor.status <> 'active'
     or v_actor.role <> all (array['super_admin', 'admin']) then
    raise exception 'vam069: actor not authorized to change application form state'
      using errcode = '42501';
  end if;

  select b.id, b.code, b.season_id, s.program_id
    into v_batch
  from public.intake_batches b
  join public.seasons s on s.id = b.season_id
  where b.code = p_intake_batch_code;

  if v_batch.id is null then
    raise exception 'vam069: intake batch % not found', p_intake_batch_code using errcode = 'P0002';
  end if;

  -- Serialise concurrent toggles on this exact control row.
  select c.* into v_control
  from public.application_form_controls c
  where c.intake_batch_id = v_batch.id
    and c.applicant_role = p_applicant_role
  for update;

  if v_control.id is null then
    raise exception 'vam069: no control row for % / %', p_intake_batch_code, p_applicant_role
      using errcode = 'P0002';
  end if;

  -- Optimistic concurrency. A stale Admin page that still believes the form
  -- is 'open' must not silently overwrite a change someone else just made.
  if p_expected_state is not null and v_control.state <> p_expected_state then
    raise exception 'vam069: state changed since page load (now %)', v_control.state
      using errcode = '40001';
  end if;

  if v_control.state = p_new_state then
    return query select 'noop'::text, v_control.state, v_control.state,
                        v_control.updated_at, v_actor.email;
    return;
  end if;

  update public.application_form_controls
     set state = p_new_state,
         updated_at = now(),
         updated_by = v_actor.id
   where id = v_control.id;

  -- Atomic audit. Legacy Production columns (action, actor_email,
  -- target_email, metadata) were made nullable by the S12 release T1; action
  -- is populated anyway because it is the human-readable column the existing
  -- Production rows are keyed on. No token or secret is recorded here.
  insert into public.admin_audit_log (
    action, action_type, actor_admin_user_id, actor_email,
    target_admin_user_id, before_data, after_data, details
  ) values (
    'set_application_form_state',
    'set_application_form_state',
    v_actor.id,
    v_actor.email,
    null,
    jsonb_build_object('state', v_control.state),
    jsonb_build_object('state', p_new_state),
    jsonb_build_object(
      'applicant_role',    p_applicant_role,
      'previous_state',    v_control.state,
      'new_state',         p_new_state,
      'program_id',        v_batch.program_id,
      'season_id',         v_batch.season_id,
      'intake_batch_id',   v_batch.id,
      'intake_batch_code', v_batch.code,
      'actor_admin_user_id', v_actor.id,
      'changed_at',        now()
    )
  );

  return query select 'changed'::text, v_control.state, p_new_state, now(), v_actor.email;
end;
$$;

revoke all on function public.vam069_set_application_form_state(uuid, text, text, text, text) from public;
revoke all on function public.vam069_set_application_form_state(uuid, text, text, text, text) from anon;
revoke all on function public.vam069_set_application_form_state(uuid, text, text, text, text) from authenticated;
grant execute on function public.vam069_set_application_form_state(uuid, text, text, text, text) to service_role;

-- ── 6. Seed — CLOSED, and only CLOSED ───────────────────────────────────────
-- ON CONFLICT DO NOTHING makes this exactly-once: re-running never resets a
-- state the owner has since changed, and never opens anything.
insert into public.application_form_controls (program_id, season_id, intake_batch_id, applicant_role, state)
select s.program_id, s.id, b.id, r.role, 'closed'
from public.seasons s
join public.intake_batches b on b.season_id = s.id
join public.programs p on p.id = s.program_id
cross join (values ('mentor'), ('mentee')) as r(role)
where p.code = 'UEHM'
  and s.code = 'UEHM-S12'
  and b.code = 'UEHM-S12-B1'
on conflict (intake_batch_id, applicant_role) do nothing;

-- ── 7. Post-conditions ──────────────────────────────────────────────────────
do $post$
declare
  v_rows int;
  v_open int;
begin
  select count(*) into v_rows
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1';
  if v_rows <> 2 then
    raise exception 'M069 ABORTED: expected 2 UEHM-S12-B1 control rows, found %', v_rows;
  end if;

  select count(*) into v_open
  from public.application_form_controls where state <> 'closed';
  if v_open <> 0 then
    raise exception 'M069 ABORTED: % control row(s) are not closed. A migration must never open a form.', v_open;
  end if;
end
$post$;

notify pgrst, 'reload schema';

commit;
