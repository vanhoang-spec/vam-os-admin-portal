-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — APPLY TRANSACTION 1 of 4
-- T1: admin_audit_log Day-1 compatibility (Phase 4)
--
-- Target : PRODUCTION only. preflight.sql MUST have passed in this same session.
-- Scope  : ONE table. ONE new constraint. Zero column adds. Zero column drops.
--
-- WHAT THIS IS NOT
--   This is NOT M068 R2. M068 R2 targets Staging's 7-column table: it ADDS
--   details and updated_at, reproduces the migration-026 trigger, and replaces
--   an existing 18-value NOT VALID constraint. Production already has details
--   and updated_at, has no action_type CHECK at all, and carries four further
--   legacy columns M068 R2 explicitly refuses. Production needs exactly one
--   thing from that package — the canonical 52-value vocabulary — and nothing
--   else. Copying the rest would be making Production look like Staging for
--   consistency, which this release does not do.
--
-- WHY NO TRIGGER, NO DEFAULTS, NO NOT NULL CHANGES BEYOND SECTION 2
--   Every Day-1 runtime writer INSERTs into admin_audit_log and none of them
--   ever UPDATEs a row, so an updated_at trigger is not exercised by any Day-1
--   path. It is therefore NOT REQUIRED and is not installed. If Production
--   already has the migration-026 trigger, it is left exactly as it is.
--
-- WHY NO BACKFILL
--   Probe B: audit_rows_total = 0, out_of_canonical_rows = 0. There is no
--   history to reconcile, which is also what makes the new CHECK safely
--   VALIDATED rather than NOT VALID.
-- =============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── Section 0. Re-assert the load-bearing baseline inside this transaction ──
-- The preflight ran in its own transaction. Anything could have changed
-- between then and now; these are the four facts T1 cannot be wrong about.
do $t1_guard$
declare
  v_cols text[];
  v_rows bigint;
  v_audit_cols constant text[] := array[
    'action','action_type','actor_admin_user_id','actor_email','after_data',
    'before_data','created_at','details','id','metadata','target_admin_user_id',
    'target_email','updated_at'
  ];
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'T1 ABORTED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';
  if v_cols is distinct from v_audit_cols then
    raise exception 'T1 ABORTED [AUDIT_COLUMNS]: expected the 13 Probe A columns, found %', v_cols;
  end if;

  select count(*) into v_rows from public.admin_audit_log;
  if v_rows <> 0 then
    raise exception 'T1 ABORTED [AUDIT_ROWS]: expected 0 rows, found %. A VALIDATED vocabulary is only provably safe at zero rows.', v_rows;
  end if;

  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.admin_audit_log'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%action_type%') then
    raise exception 'T1 ABORTED [AUDIT_CHECK_PRESENT]: an action_type CHECK already exists. T1 only ever ADDs.';
  end if;
end
$t1_guard$;

-- ── Section 1. Legacy-column write compatibility ────────────────────────────
-- Production carries four legacy columns (action, actor_email, target_email,
-- metadata) that no repository migration creates and no runtime writer sets.
-- This release PRESERVES all four. But if any of them is NOT NULL without a
-- default, every Day-1 audit INSERT — approval, profile creation, membership
-- lifecycle — fails with 23502, and six of the eight audit writers swallow
-- that failure silently. Dropping NOT NULL is the smallest change that makes
-- the column harmless; the column, its type and any data stay untouched.
--
-- This loop is a no-op if the columns are already nullable or defaulted.
do $t1_legacy$
declare r record;
begin
  for r in
    select a.attname
    from pg_attribute a
    where a.attrelid = 'public.admin_audit_log'::regclass
      and a.attname in ('action','actor_email','target_email','metadata')
      and a.attnum > 0 and not a.attisdropped
      and a.attnotnull and a.atthasdef is false
      and a.attidentity = '' and a.attgenerated = ''
    order by a.attname
  loop
    execute format('alter table public.admin_audit_log alter column %I drop not null', r.attname);
    raise notice 'T1: dropped NOT NULL on legacy column admin_audit_log.% (no runtime writer sets it)', r.attname;
  end loop;
end
$t1_legacy$;

-- ── Section 2. The canonical 52-value action_type vocabulary ────────────────
-- Byte-identical to the v_canon array in
-- VAM_OS_M068_R2_ADMIN_AUDIT_SCHEMA_COMPAT_20260809/preflight.sql, which is
-- also the array Probe B classified Production's (empty) audit table against.
-- Sorted, closed, and VALIDATED: with zero rows the validation scan is free
-- and there is no deferral to justify, so the constraint is trustworthy from
-- the first row Production ever writes.
--
-- 'approve_application_as_mentor' and 'approve_application_as_mentee' are the
-- two values the Day-1 approval path writes (lib/application-approvals.ts);
-- the eight membership values are what T3's lifecycle functions write.
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
      'remove_event_participation','remove_membership_role','soft_delete_recap','sync_auth','unknown',
      'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
      'update_mentee_profile','update_mentor_profile','update_registration_review_note',
      'waitlist_event_registration','withdraw_membership'
    ])
  );

-- ── Section 3. Post-conditions, still inside the transaction ────────────────
do $t1_post$
declare v_n integer;
begin
  select count(distinct m[1]) into v_n
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';
  if v_n <> 52 then
    raise exception 'T1 ABORTED [VOCAB_SIZE]: installed vocabulary has % distinct values, expected 52', v_n;
  end if;

  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.admin_audit_log'::regclass
                    and c.conname = 'admin_audit_log_action_type_check' and c.convalidated) then
    raise exception 'T1 ABORTED [VOCAB_NOT_VALIDATED]: the constraint was not created VALIDATED.';
  end if;

  -- The 13 columns must still all be there. Nothing in T1 drops a column;
  -- this asserts it rather than trusting it.
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';
  if v_n <> 13 then
    raise exception 'T1 ABORTED [COLUMN_LOSS]: admin_audit_log has % columns, expected 13', v_n;
  end if;
end
$t1_post$;

-- PostgREST caches the schema. Without this the runtime can keep rejecting
-- writes against a stale cache after the constraint exists.
notify pgrst, 'reload schema';

commit;
