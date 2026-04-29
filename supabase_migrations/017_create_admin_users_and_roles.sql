-- Sprint 1A Auth/Roles foundation.
-- Creates internal admin role mapping for Supabase Auth-based access control.
-- This migration does not enable RLS and does not create policies.

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null,
  email text not null unique,
  full_name text null,
  role text not null default 'viewer',
  status text not null default 'active',
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint admin_users_role_check
    check (role in ('viewer', 'reviewer', 'admin', 'super_admin')),

  constraint admin_users_status_check
    check (status in ('invited', 'active', 'suspended', 'inactive'))
);

comment on table admin_users is
  'admin_users maps Supabase Auth users/emails to VAM OS roles. This table is used for app-level role checks in Sprint 1A. RLS will be implemented later after app auth is stable.';

comment on column admin_users.auth_user_id is
  'Supabase Auth user id. May be null initially if user is pre-seeded before login.';

comment on column admin_users.email is
  'Admin user email address used for lookup and invite/pre-seed workflows.';

comment on column admin_users.role is
  'VAM OS internal role for app-level access control: viewer, reviewer, admin, or super_admin.';

comment on column admin_users.status is
  'Admin user access status: invited, active, suspended, or inactive.';

create index if not exists admin_users_auth_user_id_idx
  on admin_users(auth_user_id);

create index if not exists admin_users_email_idx
  on admin_users(email);

create index if not exists admin_users_role_idx
  on admin_users(role);

create index if not exists admin_users_status_idx
  on admin_users(status);

drop trigger if exists admin_users_set_updated_at on admin_users;

create trigger admin_users_set_updated_at
before update on admin_users
for each row
execute function set_updated_at();

insert into admin_users (
  email,
  full_name,
  role,
  status,
  notes
)
values (
  'thangnguyen@redsquarevietnam.com',
  'Nguyễn Đức Thắng',
  'super_admin',
  'active',
  'Seeded as first Sprint 1A super_admin.'
)
on conflict (email) do update
set
  full_name = excluded.full_name,
  role = 'super_admin',
  status = 'active',
  updated_at = now();
