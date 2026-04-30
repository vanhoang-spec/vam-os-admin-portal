-- VAM OS production schema sync for admin access and audit logging.
-- Purpose: make manual production hotfixes official and idempotent.
-- Safe to run on staging and production. Does not delete or rewrite business data.

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

create table if not exists public.admin_scope_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  program_id text null,
  season_id text null,
  role text not null default 'read',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_scope_access
  add column if not exists status text not null default 'active',
  add column if not exists updated_at timestamptz not null default now();

update public.admin_scope_access
set status = 'active'
where status is null;

update public.admin_scope_access
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_scope_access_status_check'
      and conrelid = 'public.admin_scope_access'::regclass
  ) then
    alter table public.admin_scope_access
      add constraint admin_scope_access_status_check
        check (status in ('active', 'inactive'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_scope_access_role_check'
      and conrelid = 'public.admin_scope_access'::regclass
  ) then
    alter table public.admin_scope_access
      add constraint admin_scope_access_role_check
        check (role in ('full_access', 'operations', 'review', 'read'));
  end if;
end;
$$;

create index if not exists admin_scope_access_user_id_idx
  on public.admin_scope_access(user_id);

create index if not exists admin_scope_access_status_idx
  on public.admin_scope_access(status);

drop trigger if exists admin_scope_access_set_updated_at on public.admin_scope_access;
create trigger admin_scope_access_set_updated_at
before update on public.admin_scope_access
for each row
execute function public.set_updated_at();

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_admin_user_id uuid null,
  target_admin_user_id uuid null,
  action_type text not null,
  before_data jsonb null,
  after_data jsonb null,
  details jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_audit_log
  add column if not exists actor_admin_user_id uuid null,
  add column if not exists target_admin_user_id uuid null,
  add column if not exists action_type text,
  add column if not exists before_data jsonb null,
  add column if not exists after_data jsonb null,
  add column if not exists details jsonb null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.admin_audit_log
set action_type = coalesce(nullif(action_type, ''), 'unknown')
where action_type is null or trim(action_type) = '';

update public.admin_audit_log
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.admin_audit_log
  alter column action_type set not null,
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_audit_log_actor_admin_user_id_fkey'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_actor_admin_user_id_fkey
      foreign key (actor_admin_user_id) references public.admin_users(id) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_audit_log_target_admin_user_id_fkey'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_target_admin_user_id_fkey
      foreign key (target_admin_user_id) references public.admin_users(id) not valid;
  end if;
end;
$$;

create index if not exists admin_audit_log_actor_admin_user_id_idx
  on public.admin_audit_log(actor_admin_user_id);

create index if not exists admin_audit_log_target_admin_user_id_idx
  on public.admin_audit_log(target_admin_user_id);

create index if not exists admin_audit_log_action_type_idx
  on public.admin_audit_log(action_type);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log(created_at desc);

drop trigger if exists admin_audit_log_set_updated_at on public.admin_audit_log;
create trigger admin_audit_log_set_updated_at
before update on public.admin_audit_log
for each row
execute function public.set_updated_at();

comment on table public.admin_audit_log is
  'Audit trail for Super Admin user, role, status, and scope changes in VAM OS.';

comment on column public.admin_audit_log.details is
  'Optional structured metadata for admin audit events. Do not store secrets.';

notify pgrst, 'reload schema';
