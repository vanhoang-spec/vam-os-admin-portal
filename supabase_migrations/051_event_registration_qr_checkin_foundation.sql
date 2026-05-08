-- Migration 051: Event registration + QR check-in MVP foundation
--
-- Scope:
--   * Schema foundation only.
--   * No UI/public forms.
--   * No data import.
--   * No production data changes by itself.
--   * No RLS enable/disable/alter and no RLS policies.
--
-- Design notes:
--   * Public registration/check-in links live in event_links, not on events.
--   * MVP uses event_registrations for registration, walk-ins, and check-in state.
--   * No event_checkins table in MVP.
--   * Public writes must go through Server Actions/admin routes using server-side
--     service-role validation and explicit program/season scope checks.
--   * event_participations sync is intentionally deferred. The current repo
--     migrations define event_participations indexes, but no unique(event_id,
--     person_id) constraint. Phase 2 sync should use select-then-insert/update,
--     or add a dedicated reviewed migration for a safe uniqueness constraint.

create table if not exists public.event_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  link_type text not null,
  token uuid not null unique default gen_random_uuid(),
  is_active boolean not null default true,
  opens_at timestamptz null,
  closes_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_links_link_type_check
    check (link_type in ('registration', 'checkin')),
  constraint event_links_event_id_link_type_key
    unique (event_id, link_type)
);

create index if not exists event_links_event_id_idx
  on public.event_links(event_id);

create index if not exists event_links_token_idx
  on public.event_links(token);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_links_link_type_check'
      and conrelid = 'public.event_links'::regclass
  ) then
    alter table public.event_links
      add constraint event_links_link_type_check
      check (link_type in ('registration', 'checkin'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_links_event_id_link_type_key'
      and conrelid = 'public.event_links'::regclass
  ) then
    alter table public.event_links
      add constraint event_links_event_id_link_type_key
      unique (event_id, link_type);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_links_token_key'
      and conrelid = 'public.event_links'::regclass
  ) then
    alter table public.event_links
      add constraint event_links_token_key
      unique (token);
  end if;
end;
$$;

drop trigger if exists event_links_set_updated_at on public.event_links;

create trigger event_links_set_updated_at
before update on public.event_links
for each row
execute function public.set_updated_at();

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  event_link_id uuid null references public.event_links(id) on delete set null,
  linked_person_id uuid null references public.people(id) on delete set null,

  full_name text not null,
  email text not null,
  phone text null,
  student_id text null,
  school text null,
  program_of_study text null,
  role_text text null,
  notes text null,
  consent_given boolean not null default false,

  registration_source text not null default 'public_form',
  registration_status text not null default 'registered',
  attendance_status text not null default 'pending',
  is_walk_in boolean not null default false,
  registered_at timestamptz not null default now(),
  checked_in_at timestamptz null,
  checkin_source text null,

  match_method text not null default 'unlinked',
  match_review_status text not null default 'pending_review',
  matched_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_registrations_registration_source_check
    check (registration_source in ('public_form', 'admin_input', 'walk_in', 'imported')),
  constraint event_registrations_registration_status_check
    check (registration_status in ('registered', 'cancelled')),
  constraint event_registrations_attendance_status_check
    check (attendance_status in ('pending', 'checked_in', 'no_show', 'cancelled')),
  constraint event_registrations_checkin_source_check
    check (checkin_source is null or checkin_source in ('self_qr', 'admin_manual', 'imported')),
  constraint event_registrations_match_method_check
    check (match_method in ('exact_email', 'mssv', 'phone_pending', 'manual', 'unlinked')),
  constraint event_registrations_match_review_status_check
    check (match_review_status in ('auto_linked', 'pending_review', 'confirmed', 'rejected'))
);

create index if not exists event_registrations_event_id_idx
  on public.event_registrations(event_id);

create index if not exists event_registrations_linked_person_id_idx
  on public.event_registrations(linked_person_id);

create index if not exists event_registrations_email_idx
  on public.event_registrations(email);

create index if not exists event_registrations_student_id_idx
  on public.event_registrations(student_id);

create index if not exists event_registrations_phone_idx
  on public.event_registrations(phone);

create index if not exists event_registrations_attendance_status_idx
  on public.event_registrations(attendance_status);

create index if not exists event_registrations_match_review_status_idx
  on public.event_registrations(match_review_status);

create unique index if not exists event_registrations_event_lower_email_active_uidx
  on public.event_registrations(event_id, lower(email))
  where registration_status <> 'cancelled';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_registration_source_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_registration_source_check
      check (registration_source in ('public_form', 'admin_input', 'walk_in', 'imported'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_registration_status_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_registration_status_check
      check (registration_status in ('registered', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_attendance_status_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_attendance_status_check
      check (attendance_status in ('pending', 'checked_in', 'no_show', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_checkin_source_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_checkin_source_check
      check (checkin_source is null or checkin_source in ('self_qr', 'admin_manual', 'imported'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_match_method_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_match_method_check
      check (match_method in ('exact_email', 'mssv', 'phone_pending', 'manual', 'unlinked'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_match_review_status_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_match_review_status_check
      check (match_review_status in ('auto_linked', 'pending_review', 'confirmed', 'rejected'));
  end if;
end;
$$;

drop trigger if exists event_registrations_set_updated_at on public.event_registrations;

create trigger event_registrations_set_updated_at
before update on public.event_registrations
for each row
execute function public.set_updated_at();

comment on table public.event_links is
  'Public registration/check-in link tokens for events. Links are validated server-side; no RLS policy is added in migration 051.';

comment on column public.event_links.link_type is
  'registration or checkin. One active link row per event/link_type is expected by the MVP.';

comment on column public.event_links.token is
  'Opaque public token used by Server Actions/routes to resolve registration and QR check-in flows.';

comment on table public.event_registrations is
  'MVP registration, walk-in, and QR check-in state for events. Later sync to event_participations must be explicit and reviewed.';

comment on column public.event_registrations.linked_person_id is
  'Optional link to an existing person after automated or manual matching.';

comment on column public.event_registrations.registration_source is
  'public_form, admin_input, walk_in, or imported.';

comment on column public.event_registrations.attendance_status is
  'pending until check-in/no-show/cancelled state is known.';

comment on column public.event_registrations.match_review_status is
  'auto_linked, pending_review, confirmed, or rejected matching workflow state.';

comment on index public.event_registrations_event_lower_email_active_uidx is
  'Prevents duplicate non-cancelled registrations for the same event/email, case-insensitive.';

-- Verification helper for reviewers:
--   select to_regclass('public.event_links') as event_links_table;
--   select to_regclass('public.event_registrations') as event_registrations_table;
--
-- Constraint/index inspection:
--   select conname, contype
--   from pg_constraint
--   where conrelid in ('public.event_links'::regclass, 'public.event_registrations'::regclass)
--   order by conrelid::regclass::text, conname;
--
--   select indexname
--   from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('event_links', 'event_registrations', 'event_participations')
--   order by tablename, indexname;
--
-- Confirm this migration did not add event_participations uniqueness:
--   select conname, contype
--   from pg_constraint
--   where conrelid = 'public.event_participations'::regclass
--     and contype in ('u', 'p')
--   order by conname;
--
-- Confirm no existing events were modified by this schema-only migration:
--   select count(*)::int as event_count from public.events;

notify pgrst, 'reload schema';
