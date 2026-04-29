-- VAM OS Super Admin Console support.
-- Additive/idempotent. Does not modify mentoring_recaps/event_participations RLS and does not touch production data by itself.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_admin_user_id uuid null references public.admin_users(id),
  action_type text not null,
  target_admin_user_id uuid null references public.admin_users(id),
  before_data jsonb null,
  after_data jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_admin_user_id_idx
  on public.admin_audit_log(actor_admin_user_id);

create index if not exists admin_audit_log_target_admin_user_id_idx
  on public.admin_audit_log(target_admin_user_id);

create index if not exists admin_audit_log_action_type_idx
  on public.admin_audit_log(action_type);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log(created_at desc);

comment on table public.admin_audit_log is
  'Audit trail for Super Admin user, role, status, and scope changes in VAM OS.';

comment on column public.admin_audit_log.before_data is
  'JSON snapshot before the admin user/scope change.';

comment on column public.admin_audit_log.after_data is
  'JSON snapshot after the admin user/scope change.';
