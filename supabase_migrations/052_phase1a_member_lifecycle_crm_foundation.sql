-- Migration 052: Phase 1A member lifecycle + CRM foundation
--
-- Scope:
--   * Create person_season_memberships.
--   * Create append-only person_season_membership_log.
--   * Create crm_notes with lightweight next-action fields.
--   * No crm_follow_ups, opportunities, scholarships, CEP, mentor
--     certification, mentoring hours, identity merge, or rollover tables.
--   * No production data backfill and no RLS enable/disable/policies.
--   * App-layer auth remains the active permission model for this MVP.

create table if not exists public.person_season_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  intake_batch_id uuid null references public.intake_batches(id) on delete set null,
  role text not null,
  status text not null default 'active',
  source text not null default 'manual',
  start_date date null,
  end_date date null,
  notes text null,
  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint person_season_memberships_role_check
    check (role in (
      'mentee',
      'mentor',
      'supporter',
      'reviewer',
      'interviewer',
      'coreteam',
      'advisor',
      'alumni_mentee',
      'guest'
    )),
  constraint person_season_memberships_status_check
    check (status in (
      'invited',
      'active',
      'paused',
      'withdrawn',
      'completed',
      'graduated',
      'opted_out',
      'cancelled'
    )),
  constraint person_season_memberships_source_check
    check (source in (
      'manual',
      'application',
      'profile',
      'match',
      'event',
      'backfill',
      'rollover',
      'system'
    )),
  constraint person_season_memberships_dates_check
    check (end_date is null or start_date is null or end_date >= start_date),
  constraint person_season_memberships_person_season_role_key
    unique (person_id, season_id, role)
);

create index if not exists person_season_memberships_person_id_idx
  on public.person_season_memberships(person_id);

create index if not exists person_season_memberships_program_season_idx
  on public.person_season_memberships(program_id, season_id);

create index if not exists person_season_memberships_season_role_status_idx
  on public.person_season_memberships(season_id, role, status);

create index if not exists person_season_memberships_intake_batch_id_idx
  on public.person_season_memberships(intake_batch_id)
  where intake_batch_id is not null;

create or replace function public.validate_person_season_membership_scope()
returns trigger
language plpgsql
as $$
declare
  season_program_id uuid;
  batch_season_id uuid;
begin
  select program_id into season_program_id
  from public.seasons
  where id = new.season_id;

  if season_program_id is null or season_program_id <> new.program_id then
    raise exception 'person_season_memberships.program_id must match seasons.program_id';
  end if;

  if new.intake_batch_id is not null then
    select season_id into batch_season_id
    from public.intake_batches
    where id = new.intake_batch_id;

    if batch_season_id is null or batch_season_id <> new.season_id then
      raise exception 'person_season_memberships.intake_batch_id must belong to season_id';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists person_season_memberships_validate_scope on public.person_season_memberships;

create trigger person_season_memberships_validate_scope
before insert or update on public.person_season_memberships
for each row
execute function public.validate_person_season_membership_scope();

drop trigger if exists person_season_memberships_set_updated_at on public.person_season_memberships;

create trigger person_season_memberships_set_updated_at
before update on public.person_season_memberships
for each row
execute function public.set_updated_at();

create table if not exists public.person_season_membership_log (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.person_season_memberships(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  program_id uuid not null references public.programs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  role text not null,
  old_status text null,
  new_status text not null,
  transition_type text not null default 'manual',
  reason text null,
  changed_by uuid null references public.admin_users(id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint person_season_membership_log_role_check
    check (role in (
      'mentee',
      'mentor',
      'supporter',
      'reviewer',
      'interviewer',
      'coreteam',
      'advisor',
      'alumni_mentee',
      'guest'
    )),
  constraint person_season_membership_log_old_status_check
    check (old_status is null or old_status in (
      'invited',
      'active',
      'paused',
      'withdrawn',
      'completed',
      'graduated',
      'opted_out',
      'cancelled'
    )),
  constraint person_season_membership_log_new_status_check
    check (new_status in (
      'invited',
      'active',
      'paused',
      'withdrawn',
      'completed',
      'graduated',
      'opted_out',
      'cancelled'
    )),
  constraint person_season_membership_log_transition_type_check
    check (transition_type in (
      'created',
      'status_change',
      'role_change',
      'rollover',
      'backfill',
      'manual',
      'system'
    ))
);

create index if not exists person_season_membership_log_membership_id_idx
  on public.person_season_membership_log(membership_id);

create index if not exists person_season_membership_log_person_id_idx
  on public.person_season_membership_log(person_id);

create index if not exists person_season_membership_log_program_season_idx
  on public.person_season_membership_log(program_id, season_id);

create index if not exists person_season_membership_log_changed_at_idx
  on public.person_season_membership_log(changed_at desc);

create or replace function public.prevent_person_season_membership_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'person_season_membership_log is append-only';
end;
$$;

drop trigger if exists person_season_membership_log_no_update on public.person_season_membership_log;
create trigger person_season_membership_log_no_update
before update on public.person_season_membership_log
for each row
execute function public.prevent_person_season_membership_log_mutation();

drop trigger if exists person_season_membership_log_no_delete on public.person_season_membership_log;
create trigger person_season_membership_log_no_delete
before delete on public.person_season_membership_log
for each row
execute function public.prevent_person_season_membership_log_mutation();

create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  match_id uuid null references public.matches(id) on delete set null,
  program_id uuid null references public.programs(id) on delete set null,
  season_id uuid null references public.seasons(id) on delete set null,
  note_type text not null,
  visibility text not null default 'ops_only',
  channel text null,
  sentiment text null,
  priority text not null default 'normal',
  content text not null,
  next_action_text text null,
  next_action_due_date date null,
  owner_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_notes_note_type_check
    check (note_type in (
      'contact_outbound',
      'contact_inbound',
      're_engagement',
      'feedback_from_mentor',
      'feedback_from_mentee',
      'feedback_about_mentor',
      'feedback_about_mentee',
      'program_feedback',
      'pause_intent',
      'withdrawal_intent',
      'return_intent',
      'application_intent',
      'observation',
      'escalation',
      'resolution',
      'handover',
      'system_status_change',
      'system_rollover',
      'system_match_created',
      'system_match_closed'
    )),
  constraint crm_notes_visibility_check
    check (visibility in ('private', 'ops_only', 'team', 'system')),
  constraint crm_notes_channel_check
    check (channel is null or channel in (
      'zalo',
      'phone',
      'email',
      'in_person',
      'video_call',
      'form',
      'event',
      'other'
    )),
  constraint crm_notes_sentiment_check
    check (sentiment is null or sentiment in (
      'positive',
      'neutral',
      'concern',
      'critical'
    )),
  constraint crm_notes_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint crm_notes_content_not_blank_check
    check (length(btrim(content)) > 0),
  constraint crm_notes_system_visibility_check
    check (
      (visibility = 'system' and note_type like 'system_%')
      or (visibility <> 'system' and note_type not like 'system_%')
    )
);

create index if not exists crm_notes_person_created_at_idx
  on public.crm_notes(person_id, created_at desc);

create index if not exists crm_notes_match_id_idx
  on public.crm_notes(match_id)
  where match_id is not null;

create index if not exists crm_notes_program_season_idx
  on public.crm_notes(program_id, season_id);

create index if not exists crm_notes_visibility_idx
  on public.crm_notes(visibility);

create index if not exists crm_notes_owner_due_idx
  on public.crm_notes(owner_admin_user_id, next_action_due_date)
  where next_action_due_date is not null;

drop trigger if exists crm_notes_set_updated_at on public.crm_notes;

create trigger crm_notes_set_updated_at
before update on public.crm_notes
for each row
execute function public.set_updated_at();

comment on table public.person_season_memberships is
  'Phase 1A lifecycle table: one row per person x season x community role. Status is season-specific and never disables a person or mentor profile globally.';

comment on table public.person_season_membership_log is
  'Append-only audit log for lifecycle membership creation and status transitions.';

comment on table public.crm_notes is
  'Phase 1A CRM note table with app-layer visibility enforcement and lightweight next-action fields. RLS is intentionally not enabled in this migration.';

comment on column public.crm_notes.visibility is
  'private, ops_only, team, or system. The app layer enforces visibility until a later RLS design is reviewed.';

comment on column public.crm_notes.next_action_text is
  'Lightweight Phase 1A follow-up text. No crm_follow_ups table is created yet.';

notify pgrst, 'reload schema';
