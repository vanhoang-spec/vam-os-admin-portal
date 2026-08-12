-- =============================================================================
-- VAM OS — M069 SEASON 12 APPLICATION INTAKE CONTROL — ROLLBACK
--
-- Removes everything apply.sql created and restores the 52-value audit
-- vocabulary. Run in its own session with `set timezone = 'UTC'`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- READ THIS BEFORE RUNNING
--
-- Rolling M069 back does NOT re-open the forms and does not close them either.
-- It removes the only mechanism that can open them. After rollback:
--
--   * `readApplicationFormControls` finds no table, returns
--     `control_rows_unreadable`, and the gate resolves CLOSED for both roles.
--   * Both public forms therefore serve the closed notice.
--   * /admin/seasons-forms renders the "migration not applied" error.
--
-- That is a SAFE end state — it is the same state as before M069 — but if
-- recruitment is live at the time, rolling back CLOSES IT. Do not run this to
-- fix a UI problem while a form is open. Close the form through the UI first,
-- confirm the audit row landed, and only then roll back.
--
-- REFUSES if any control row is not 'closed', so a live recruitment cannot be
-- silently terminated by this script. Override deliberately by closing the
-- forms first.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

do $m069_rollback_guard$
declare
  v_open int;
  v_txt  text;
begin
  if to_regclass('public.application_form_controls') is null then
    raise notice 'M069 ROLLBACK: control table already absent; only the audit vocabulary will be considered.';
  else
    select count(*), string_agg(applicant_role || '=' || state, ', ' order by applicant_role)
      into v_open, v_txt
    from public.application_form_controls
    where state <> 'closed';

    if v_open > 0 then
      raise exception 'M069 ROLLBACK REFUSED [FORM_NOT_CLOSED]: % control row(s) are not closed (%). Close them through Quản trị → Mùa & Form đăng ký first so the change is audited, then re-run.', v_open, v_txt;
    end if;
  end if;
end
$m069_rollback_guard$;

-- ── 1. Drop the mutation function ───────────────────────────────────────────
drop function if exists public.vam069_set_application_form_state(uuid, text, text, text, text);

-- ── 2. Drop the table (takes its trigger, index and constraints with it) ────
drop trigger if exists application_form_controls_binding on public.application_form_controls;
drop table if exists public.application_form_controls;
drop function if exists public.vam069_assert_control_binding();

-- ── 3. Restore the 52-value audit vocabulary ────────────────────────────────
-- Only if no row is actually using the M069 value. Historical audit rows are
-- evidence and are never deleted to satisfy a constraint — if any exist, the
-- 53-value vocabulary stays and this is reported rather than forced.
do $m069_vocab$
declare
  v_rows int;
  v_def  text;
begin
  select count(*) into v_rows
  from public.admin_audit_log
  where action_type = 'set_application_form_state';

  if v_rows > 0 then
    raise notice 'M069 ROLLBACK: % audit row(s) use set_application_form_state. The 53-value vocabulary is LEFT IN PLACE — audit history is not deleted to satisfy a constraint.', v_rows;
    return;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise notice 'M069 ROLLBACK: no action_type CHECK present; nothing to restore.';
    return;
  end if;
  if v_def not like '%set_application_form_state%' then
    raise notice 'M069 ROLLBACK: the vocabulary does not contain set_application_form_state; leaving it untouched.';
    return;
  end if;

  alter table public.admin_audit_log
    drop constraint admin_audit_log_action_type_check;

  -- The exact 52-value list installed by the S12 release T1.
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
  raise notice 'M069 ROLLBACK: audit vocabulary restored to the 52-value release T1 list.';
end
$m069_vocab$;

-- ── 4. Post-conditions ──────────────────────────────────────────────────────
do $m069_rollback_post$
begin
  if to_regclass('public.application_form_controls') is not null then
    raise exception 'M069 ROLLBACK FAILED: application_form_controls still exists.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam069\_%') then
    raise exception 'M069 ROLLBACK FAILED: a vam069_* function still exists.';
  end if;
  raise notice 'M069 ROLLBACK COMPLETE. Both public forms now resolve CLOSED via the gate fail-closed path.';
end
$m069_rollback_post$;

notify pgrst, 'reload schema';

commit;
