-- VAM OS Phase 2D: Admin Correction Workflow.
-- Additive/idempotent. Supports the lightweight admin queue requested for
-- data issues, follow-up, and recap correction without requiring manual DB edits.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'data_issue',
  target_person_id uuid null references public.people(id),
  season_code text null,
  status text not null default 'open',
  owner_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text null
);

alter table public.action_items
  add column if not exists type text not null default 'data_issue',
  add column if not exists target_person_id uuid null references public.people(id),
  add column if not exists season_code text null,
  add column if not exists status text not null default 'open',
  add column if not exists owner_email text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists notes text null;

-- Compatibility with the broader Phase 4 action_items table, if it already exists.
alter table public.action_items
  add column if not exists action_type text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists priority text default 'medium',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists source text,
  add column if not exists metadata jsonb default '{}'::jsonb;

update public.action_items
set
  type = coalesce(nullif(type, ''), nullif(action_type, ''), 'data_issue'),
  action_type = coalesce(nullif(action_type, ''), nullif(type, ''), 'data_issue'),
  title = coalesce(nullif(title, ''), 'Admin correction workflow item'),
  metadata = coalesce(metadata, '{}'::jsonb),
  updated_at = coalesce(updated_at, created_at, now())
where type is null
   or action_type is null
   or title is null
   or metadata is null
   or updated_at is null;

alter table public.action_items
  alter column type set not null,
  alter column action_type set default 'data_issue',
  alter column title set default 'Admin correction workflow item',
  alter column status set default 'open',
  alter column updated_at set default now();

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'action_items_status_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items drop constraint action_items_status_check;
  end if;

  alter table public.action_items
    add constraint action_items_status_check
      check (status in ('open', 'in_progress', 'resolved', 'dropped', 'no_response', 'parked'));

  if exists (
    select 1
    from pg_constraint
    where conname = 'action_items_action_type_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items drop constraint action_items_action_type_check;
  end if;

  alter table public.action_items
    add constraint action_items_action_type_check
      check (
        action_type is null
        or action_type in (
          'followup_no_recap',
          'data_issue',
          'correction_request',
          'event_attendance_issue',
          'manual_task',
          'unmatched_recap',
          'missing_mentee',
          'missing_mentor',
          'invalid_date',
          'duplicate_recap'
        )
      );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'action_items_type_check'
      and conrelid = 'public.action_items'::regclass
  ) then
    alter table public.action_items
      add constraint action_items_type_check
        check (
          type in (
            'followup_no_recap',
            'data_issue',
            'correction_request',
            'event_attendance_issue',
            'manual_task',
            'unmatched_recap',
            'missing_mentee',
            'missing_mentor',
            'invalid_date',
            'duplicate_recap'
          )
        );
  end if;
end;
$$;

create index if not exists action_items_type_idx on public.action_items(type);
create index if not exists action_items_target_person_id_idx on public.action_items(target_person_id);
create index if not exists action_items_season_code_idx on public.action_items(season_code);
create index if not exists action_items_status_idx on public.action_items(status);
create index if not exists action_items_owner_email_idx on public.action_items(owner_email);
create index if not exists action_items_updated_at_idx on public.action_items(updated_at desc);

drop trigger if exists action_items_set_updated_at on public.action_items;
create trigger action_items_set_updated_at
before update on public.action_items
for each row
execute function public.set_updated_at();

-- Allow soft delete for recaps without physically deleting evidence.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'mentoring_recaps_status_check'
      and conrelid = 'public.mentoring_recaps'::regclass
  ) then
    alter table public.mentoring_recaps drop constraint mentoring_recaps_status_check;
  end if;

  alter table public.mentoring_recaps
    add constraint mentoring_recaps_status_check
      check (status in ('submitted', 'needs_review', 'invalid', 'duplicate', 'deleted'));
end;
$$;

comment on table public.action_items is
  'Lightweight admin correction workflow queue for data issues, follow-up, and manual operations.';

comment on column public.action_items.type is
  'Simple workflow type used by the Phase 2D admin UI.';

comment on column public.action_items.target_person_id is
  'Optional person linked to the workflow item.';

comment on column public.action_items.season_code is
  'Season code such as UEHM-S11. Kept as text for simple admin workflow filters.';

comment on column public.action_items.notes is
  'Admin notes and resolution context. Do not store secrets.';

notify pgrst, 'reload schema';
