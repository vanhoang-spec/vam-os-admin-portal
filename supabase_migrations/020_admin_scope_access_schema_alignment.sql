-- VAM OS Sprint 1B preview prep: admin_scope_access schema alignment.
-- This migration is additive/idempotent and does not delete or reset data.
-- Live DB inspection on 2026-04-29 found:
--   id uuid, user_id uuid, program_id text, season_id text, role text, created_at timestamp.
-- Keep program_id/season_id as text to avoid breaking the existing live table.

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

create index if not exists admin_scope_access_program_id_idx
  on public.admin_scope_access(program_id);

create index if not exists admin_scope_access_season_id_idx
  on public.admin_scope_access(season_id);

create index if not exists admin_scope_access_role_idx
  on public.admin_scope_access(role);

create index if not exists admin_scope_access_status_idx
  on public.admin_scope_access(status);

create unique index if not exists admin_scope_access_unique_active_scope_idx
  on public.admin_scope_access(
    user_id,
    coalesce(program_id, ''),
    coalesce(season_id, ''),
    role
  )
  where status = 'active';

drop trigger if exists admin_scope_access_set_updated_at on public.admin_scope_access;

create trigger admin_scope_access_set_updated_at
before update on public.admin_scope_access
for each row
execute function public.set_updated_at();

create or replace function public.current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select au.role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
  limit 1
$$;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.status = 'active'
  )
$$;

alter table public.admin_scope_access enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_scope_access'
      and policyname = 'read_admin_scope_access_self_or_super_admin'
  ) then
    create policy "read_admin_scope_access_self_or_super_admin"
    on public.admin_scope_access
    for select
    using (
      public.current_admin_role() = 'super_admin'
      or (
        public.is_active_admin()
        and user_id = auth.uid()
        and status = 'active'
      )
    );
  end if;
end;
$$;

comment on table public.admin_scope_access is
  'Program/season scope grants for VAM OS admins. user_id stores auth.users.id and is matched to admin_users.auth_user_id. program_id/season_id are text to match the current live schema and may store code or UUID text.';

comment on column public.admin_scope_access.user_id is
  'Supabase Auth user id. Must match admin_users.auth_user_id for the same admin.';

comment on column public.admin_scope_access.role is
  'Scope-level access role: full_access, operations, review, or read.';

-- Rollback, if this preview migration causes issues:
-- drop policy if exists "read_admin_scope_access_self_or_super_admin" on public.admin_scope_access;
-- drop trigger if exists admin_scope_access_set_updated_at on public.admin_scope_access;
-- drop index if exists public.admin_scope_access_unique_active_scope_idx;
-- alter table public.admin_scope_access drop column if exists updated_at;
-- alter table public.admin_scope_access drop column if exists status;
