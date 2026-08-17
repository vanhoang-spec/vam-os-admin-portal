-- =============================================================================
-- VAM OS — M070 RETURNING-MENTOR RENEWAL INVITE FOUNDATION — PREFLIGHT
--
-- READ-ONLY. Makes no change of any kind. Both blocks run inside
-- `begin; set transaction read only; … rollback;`, so the session refuses a
-- write with SQLSTATE 25006 even if this file is later edited carelessly.
--
-- Run this first, in its own session, with `set timezone = 'UTC'`, and record
-- both outputs in full together with the emitted token.
--
-- apply.sql does NOT depend on this file having been run: its Section 0
-- re-asserts every condition below inside its own transaction. This preflight
-- exists so the owner learns about a baseline mismatch BEFORE any lock is
-- taken, and so the refusal diagnostics can be read at leisure.
--
-- Target : PRODUCTION (vam-os-mvp / qkkroesfiazsejkzflcd) after the S12
--          release R4.2 has been applied and verified. M069 may or may not
--          have been applied — both are accepted, and the token says which.
--
-- THE VOCABULARY CHECK IS NOT THE SAME PROOF M069 NEEDED.
-- M069 replaces the action_type CHECK with a hard-coded list, so it must prove
-- by set equality that the list it is replacing is exactly what it expects.
-- M070 builds its replacement as (live admitted set) ∪ (three new values), so
-- no value can be lost no matter what the live set contains. What this file
-- proves instead is that the live set is one of the two baselines Production
-- can legitimately be in — BASE52 or BASE53 — because an unexplained
-- vocabulary is a reason to stop, not a thing to carry forward silently.
--
-- REFUSES on any of:
--   [ENV_NOT_PRODUCTION]        vam062_* functions exist — this is Staging
--   [UUID_FN_MISSING]           gen_random_uuid() does not resolve
--   [PREREQ_TABLE_MISSING]      a foreign-key target table or admin_audit_log
--                               is absent
--   [FK_TARGET_TYPE]            a foreign-key target column is not uuid
--   [FK_TARGET_KEY]             a foreign-key target column carries no
--                               single-column primary/unique key (42830)
--   [UPDATED_AT_FN_SHAPE]       public.set_updated_at() is absent or is not a
--                               zero-argument plpgsql trigger function
--   [ALREADY_APPLIED]           public.person_season_invites already exists
--   [PARTIAL_M070]              a leftover person_season_invites* relation,
--                               trigger or constraint exists
--   [AUDIT_TABLE_SHAPE]         admin_audit_log is not an ordinary table
--   [AUDIT_INSERT_BLOCKED]      FORCE ROW LEVEL SECURITY is set on it
--   [AUDIT_COLUMN_TYPE]         admin_audit_log.action_type is not text
--   [AUDIT_VOCAB_MISSING]       no CHECK governs action_type — release T1 has
--                               not been applied here
--   [AUDIT_VOCAB_SHAPE]         more than one action_type CHECK, an unexpected
--                               name, an unparseable definition, or duplicates
--   [AUDIT_VOCAB_NOT_VALIDATED] the CHECK exists but is NOT VALID
--   [AUDIT_VOCAB_M070_PRESENT]  the vocabulary already admits one of the three
--                               M070 values
--   [AUDIT_VOCAB_UNEXPECTED]    the admitted set is neither BASE52 nor BASE53
--                               (the message names the missing and the extra)
--
-- NOT CHECKED HERE, DELIBERATELY: the complete 13-column admin_audit_log INSERT
-- contract. M069 needs it because M069 installs an RPC whose audit INSERT is
-- atomic with the state change it records. M070 installs no RPC and writes no
-- audit row — it only widens the vocabulary a LATER runtime will use. The
-- INSERT contract is that runtime's precondition and belongs to its package,
-- not to this one. What M070 does need from admin_audit_log — ordinary table,
-- no FORCE RLS, text action_type, exactly one VALIDATED parseable CHECK — is
-- checked above.
--
-- SUPABASE SQL EDITOR COMPATIBILITY
-- This file contains ZERO psql meta-commands. The block markers below are
-- ordinary `select … as phase` statements, not `\echo`, because the owner's
-- execution path is the Supabase SQL Editor, which is not psql and rejects a
-- backslash line with `42601: syntax error at or near "\"` before executing
-- anything. A test fails the build if a backslash-leading line ever reappears
-- in any owner-executable M070 file.
--
-- Run BLOCK 1 and BLOCK 2 as SEPARATE editor runs. Two reasons, both real:
-- the editor surfaces the result of the last row-returning statement, so a
-- single run would hide BLOCK 1 behind BLOCK 2's evidence row; and
-- `set transaction read only` must be the first thing in its transaction, which
-- a fresh run guarantees.
-- =============================================================================

select 'M070 PREFLIGHT — READ ONLY — BLOCK 1: refusals' as phase;

begin;
set transaction read only;

do $m070_preflight$
declare
  v_txt        text;
  v_n          integer;
  v_def        text;
  v_validated  boolean;
  v_conname    constant text := 'admin_audit_log_action_type_check';
  v_actual     text[];
  v_missing    text[];
  v_unexpected text[];
  v_raw_n      integer;
  v_quote_n    integer;
  v_fk_targets constant text[] := array[
    'people.id', 'programs.id', 'seasons.id', 'admin_users.id', 'applications.id'
  ];
  -- BYTE-IDENTICAL to the arrays in apply.sql Section 0 / Section 6 and in the
  -- canonical migration, proven so by test. Canonical representation:
  -- __tests__/support/m069-audit-vocabulary.ts.
  v_m070 constant text[] := array[
    'confirm_renewal', 'create_renewal_invite', 'revoke_renewal_invite'
  ];
  v_base52 constant text[] := array[
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
  v_m069 constant text := 'set_application_form_state';
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M070 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  if to_regprocedure('gen_random_uuid()') is null
     and to_regprocedure('public.gen_random_uuid()') is null then
    raise exception 'M070 PREFLIGHT REFUSED [UUID_FN_MISSING]: gen_random_uuid() does not resolve.';
  end if;

  select string_agg(t, ', ' order by t) into v_txt
  from unnest(array['people','programs','seasons','admin_users','applications','admin_audit_log']) t
  where to_regclass('public.' || t) is null;
  if v_txt is not null then
    raise exception 'M070 PREFLIGHT REFUSED [PREREQ_TABLE_MISSING]: %.', v_txt;
  end if;

  select string_agg(t || ' is ' || coalesce(ft, '<absent>'), ', ' order by t) into v_txt
  from (
    select t,
           (select format_type(a.atttypid, a.atttypmod)
            from pg_attribute a
            where a.attrelid = to_regclass('public.' || split_part(t, '.', 1))
              and a.attname = split_part(t, '.', 2)
              and a.attnum > 0 and not a.attisdropped) as ft
    from unnest(v_fk_targets) t
  ) s
  where ft is distinct from 'uuid';
  if v_txt is not null then
    raise exception 'M070 PREFLIGHT REFUSED [FK_TARGET_TYPE]: %.', v_txt;
  end if;

  select string_agg(t, ', ' order by t) into v_txt
  from unnest(v_fk_targets) t
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.' || split_part(t, '.', 1))
      and c.contype in ('p', 'u')
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = to_regclass('public.' || split_part(t, '.', 1))
                              and a.attname = split_part(t, '.', 2)
                              and a.attnum > 0 and not a.attisdropped)]
  );
  if v_txt is not null then
    raise exception 'M070 PREFLIGHT REFUSED [FK_TARGET_KEY]: % carries no single-column primary or unique key.', v_txt;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname = 'set_updated_at'
      and p.pronargs = 0 and p.prorettype = 'trigger'::regtype and l.lanname = 'plpgsql'
  ) then
    raise exception 'M070 PREFLIGHT REFUSED [UPDATED_AT_FN_SHAPE]: public.set_updated_at() is absent or is not a zero-argument plpgsql trigger function.';
  end if;

  if to_regclass('public.person_season_invites') is not null then
    raise exception 'M070 PREFLIGHT REFUSED [ALREADY_APPLIED]: public.person_season_invites already exists. Run verifier.sql instead.';
  end if;

  select string_agg(obj, ', ' order by obj) into v_txt from (
    select 'relation ' || c.relname as obj
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'person\_season\_invites%'
    union all
    select 'trigger ' || t.tgname
    from pg_trigger t where not t.tgisinternal and t.tgname like 'person\_season\_invites%'
    union all
    select 'constraint ' || c.conname
    from pg_constraint c where c.conname like 'person\_season\_invites%'
  ) s;
  if v_txt is not null then
    raise exception 'M070 PREFLIGHT REFUSED [PARTIAL_M070]: %.', v_txt;
  end if;

  if not exists (select 1 from pg_class
                 where oid = to_regclass('public.admin_audit_log') and relkind = 'r') then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_TABLE_SHAPE]: admin_audit_log is not an ordinary table.';
  end if;
  if exists (select 1 from pg_class
             where oid = to_regclass('public.admin_audit_log') and relforcerowsecurity) then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_INSERT_BLOCKED]: FORCE ROW LEVEL SECURITY is set on admin_audit_log.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.admin_audit_log') and a.attname = 'action_type'
      and a.attnum > 0 and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = 'text'
  ) then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_COLUMN_TYPE]: admin_audit_log.action_type is not text.';
  end if;

  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';
  if v_n = 0 then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_MISSING]: no CHECK governs admin_audit_log.action_type. The S12 release T1 has not been applied here.';
  end if;
  if v_n > 1 then
    select string_agg(c.conname, ', ' order by c.conname) into v_txt
    from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%action_type%';
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % CHECKs govern action_type (%), expected exactly 1.', v_n, v_txt;
  end if;

  select c.conname, c.convalidated, pg_get_constraintdef(c.oid)
    into v_txt, v_validated, v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_txt is distinct from v_conname then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: the action_type CHECK is named %, expected %. apply.sql drops it by name.', coalesce(v_txt, '<null>'), v_conname;
  end if;
  if v_validated is not true then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_NOT_VALIDATED]: % is NOT VALID.', v_conname;
  end if;
  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % is not a closed ANY(ARRAY[...]) list: %.', v_conname, v_def;
  end if;

  select count(*) into v_raw_n from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;
  select array_agg(distinct m[1]) into v_actual from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;
  v_quote_n := length(v_def) - length(replace(v_def, '''', ''));
  if v_quote_n <> 2 * v_raw_n then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % contains % quote characters but only % parseable ''value''::text elements — part of the definition was not understood: %.', v_conname, v_quote_n, v_raw_n, v_def;
  end if;
  if v_raw_n <> coalesce(array_length(v_actual, 1), 0) then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_SHAPE]: % lists % elements but only % are distinct.', v_conname, v_raw_n, coalesce(array_length(v_actual, 1), 0);
  end if;

  select array_agg(x order by x) into v_unexpected from unnest(v_m070) x where x = any (v_actual);
  if v_unexpected is not null then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_M070_PRESENT]: the vocabulary already admits %. M070 has been applied here, or something else added the value(s).', array_to_string(v_unexpected, ', ');
  end if;

  select array_agg(x order by x) into v_missing
  from unnest(v_base52) x where x <> all (coalesce(v_actual, array[]::text[]));
  select array_agg(x order by x) into v_unexpected
  from unnest(coalesce(v_actual, array[]::text[])) x where x <> all (v_base52 || v_m069);
  if v_missing is not null or v_unexpected is not null then
    raise exception 'M070 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: % admits % value(s), which is neither BASE52 nor BASE53 (BASE52 + %). MISSING (expected, not present): %. UNEXPECTED (present, in neither baseline): %.',
      v_conname, coalesce(array_length(v_actual, 1), 0), v_m069,
      coalesce(array_to_string(v_missing, ', '), '<none>'),
      coalesce(array_to_string(v_unexpected, ', '), '<none>');
  end if;

  raise notice 'M070 PREFLIGHT PASSED. Live audit vocabulary: % value(s), baseline %.',
    array_length(v_actual, 1),
    case when v_m069 = any (v_actual) then 'BASE53 (M069 applied)' else 'BASE52 (M069 not applied)' end;
end
$m070_preflight$;

-- The PASS signal, as a ROW rather than only as a NOTICE.
--
-- `raise notice` output is not surfaced by the Supabase SQL Editor, so on that
-- execution path a passing BLOCK 1 previously produced no visible output at
-- all — indistinguishable, to the reader, from a file that did nothing. A
-- refusal is still unmissable (it raises, and the editor shows the error), but
-- "nothing happened" is a bad way to say PASS.
--
-- This is evidence, not a gate: it is only REACHED when the guard above did not
-- raise. If the guard raises, PostgreSQL aborts the whole batch at that
-- statement, this select never runs, and the refusal is what the owner sees.
-- The NOTICE is kept for psql users, who get both.
select
  'M070 PREFLIGHT — BLOCK 1'                                          as phase,
  'PASSED'                                                            as result,
  'every refusal condition was evaluated and none fired'              as detail,
  'Run BLOCK 2 (below) as a separate editor run for the evidence row and token.'
                                                                      as next_step;

rollback;

select 'M070 PREFLIGHT — READ ONLY — BLOCK 2: evidence + token' as phase;

begin;
set transaction read only;

with vocab as (
  select pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check'
),
parsed as (
  select array_agg(distinct m[1]) as vals
  from vocab, regexp_matches(vocab.def, '''([^'']*)''::text', 'g') m
),
base as (
  select array[
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
  ]::text[] as b52
)
select
  'M070'                                                              as package,
  current_database()                                                  as db,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'vam062\_%')         as vam062_functions,
  coalesce((select to_regclass('public.person_season_invites')::text), '<none>') as m070_table_present,
  coalesce((
    select string_agg(obj, ', ' order by obj) from (
      select 'relation ' || c.relname as obj
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'person\_season\_invites%'
      union all
      select 'trigger ' || t.tgname from pg_trigger t
      where not t.tgisinternal and t.tgname like 'person\_season\_invites%'
      union all
      select 'constraint ' || c.conname from pg_constraint c
      where c.conname like 'person\_season\_invites%'
    ) s), '<none>')                                                    as m070_owned_objects_present,
  (select coalesce(array_length(vals, 1), 0) from parsed)              as audit_vocab_size,
  case when (select 'set_application_form_state' = any (vals) from parsed)
       then 'BASE53' else 'BASE52' end                                 as audit_vocab_baseline,
  coalesce((select array_to_string(array_agg(x order by x), ', ')
            from base, unnest(b52) x
            where x <> all (coalesce((select vals from parsed), array[]::text[]))), '<none>')
                                                                       as audit_vocab_missing,
  coalesce((select array_to_string(array_agg(x order by x), ', ')
            from base, unnest(coalesce((select vals from parsed), array[]::text[])) x
            where x <> all (b52 || 'set_application_form_state')), '<none>')
                                                                       as audit_vocab_unexpected,
  (select convalidated from pg_constraint
    where conrelid = to_regclass('public.admin_audit_log')
      and conname = 'admin_audit_log_action_type_check')               as audit_vocab_validated,
  (select count(*) from unnest(array['people.id','programs.id','seasons.id','admin_users.id','applications.id']) t
    where (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
            where a.attrelid = to_regclass('public.' || split_part(t, '.', 1))
              and a.attname = split_part(t, '.', 2) and a.attnum > 0 and not a.attisdropped) = 'uuid')
                                                                       as fk_targets_uuid,
  (to_regprocedure('public.set_updated_at()') is not null)             as updated_at_fn_present,
  'M070:'
    || case when to_regclass('public.person_season_invites') is null then 'ABSENT' else 'PRESENT' end
    || ':' || case when (select 'set_application_form_state' = any (vals) from parsed)
                   then 'BASE53' else 'BASE52' end
    || ':' || case when (select convalidated from pg_constraint
                          where conrelid = to_regclass('public.admin_audit_log')
                            and conname = 'admin_audit_log_action_type_check')
                   then 'VALIDATED' else 'NOTVALID' end
    || ':FKTARGETS'
    || (select count(*) from unnest(array['people.id','programs.id','seasons.id','admin_users.id','applications.id']) t
         where (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                 where a.attrelid = to_regclass('public.' || split_part(t, '.', 1))
                   and a.attname = split_part(t, '.', 2) and a.attnum > 0 and not a.attisdropped) = 'uuid')
    || ':' || case when to_regprocedure('public.set_updated_at()') is not null
                   then 'UPDATEDAT' else 'NOUPDATEDAT' end             as preflight_token
from base;

rollback;
