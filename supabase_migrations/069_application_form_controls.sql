-- =============================================================================
-- VAM OS — MIGRATION 069
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
do $vocab$
declare
  v_def text;
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
