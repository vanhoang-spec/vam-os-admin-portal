-- REVIEW ONLY. STAGING AUTHORIZATION REQUIRED BEFORE APPLYING.
begin;

do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing from (values
    ('public.admin_users'), ('public.admin_scope_access'), ('public.admin_audit_log'),
    ('public.people'), ('public.programs'), ('public.seasons'),
    ('public.person_season_memberships'), ('public.person_season_membership_log')
  ) required(name) where to_regclass(name) is null;
  if missing is not null then raise exception 'Account RLS prerequisites missing: %', missing; end if;
  if to_regprocedure('public.current_admin_role()') is null or to_regprocedure('public.is_active_admin()') is null then
    raise exception 'Account RLS helper prerequisites missing';
  end if;
end $$;

create table if not exists public.account_rls_package_state (
  table_name text primary key,
  rls_was_enabled boolean not null,
  recorded_at timestamptz not null default now()
);
insert into public.account_rls_package_state(table_name, rls_was_enabled)
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships')
on conflict (table_name) do nothing;

create table if not exists public.account_import_batches (
  id uuid primary key default gen_random_uuid(), actor_admin_user_id uuid not null references public.admin_users(id),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'), row_count integer not null check (row_count between 1 and 500),
  status text not null check (status in ('processing','completed','completed_with_errors')), created_at timestamptz not null default now(), completed_at timestamptz null
);
create table if not exists public.account_import_outcomes (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.account_import_batches(id) on delete cascade,
  row_number integer not null check (row_number >= 2), outcome_status text not null check (outcome_status in ('created','updated','skipped','failed')),
  reason_code text not null check (length(reason_code) between 1 and 240), created_at timestamptz not null default now(), unique(batch_id,row_number)
);

create or replace function public.current_admin_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.admin_users where auth_user_id=auth.uid() and status='active' limit 1
$$;
revoke all on function public.current_admin_id() from public, anon;
grant execute on function public.current_admin_id() to authenticated, service_role;

alter table public.admin_users enable row level security;
alter table public.admin_scope_access enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.people enable row level security;
alter table public.person_season_memberships enable row level security;
alter table public.account_import_batches enable row level security;
alter table public.account_import_outcomes enable row level security;

drop policy if exists account_admin_users_self_or_super on public.admin_users;
create policy account_admin_users_self_or_super on public.admin_users for select to authenticated using (auth_user_id=auth.uid() or public.current_admin_role()='super_admin');
drop policy if exists account_scope_self_or_super on public.admin_scope_access;
create policy account_scope_self_or_super on public.admin_scope_access for select to authenticated using (user_id=auth.uid() or public.current_admin_role()='super_admin');
drop policy if exists account_audit_actor_or_super on public.admin_audit_log;
create policy account_audit_actor_or_super on public.admin_audit_log for select to authenticated using (actor_admin_user_id=public.current_admin_id() or public.current_admin_role()='super_admin');

drop policy if exists account_people_program_ops on public.people;
create policy account_people_program_ops on public.people for select to authenticated using (
  public.current_admin_role()='super_admin' or exists (
    select 1 from public.person_season_memberships m join public.admin_scope_access s
      on s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations')
      and (s.program_id=m.program_id::text or s.program_id=(select p.code from public.programs p where p.id=m.program_id))
      and (s.season_id is null or s.season_id=m.season_id::text or s.season_id=(select se.code from public.seasons se where se.id=m.season_id))
    where m.person_id=people.id
  )
);
drop policy if exists account_membership_program_ops on public.person_season_memberships;
create policy account_membership_program_ops on public.person_season_memberships for select to authenticated using (
  public.current_admin_role()='super_admin' or exists (
    select 1 from public.admin_scope_access s where s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations')
      and (s.program_id=person_season_memberships.program_id::text or s.program_id=(select p.code from public.programs p where p.id=person_season_memberships.program_id))
      and (s.season_id is null or s.season_id=person_season_memberships.season_id::text or s.season_id=(select se.code from public.seasons se where se.id=person_season_memberships.season_id))
  )
);

-- Import metadata is service-role only: intentionally no authenticated/anon policies.
revoke all on public.account_import_batches, public.account_import_outcomes from anon, authenticated;
grant all on public.account_import_batches, public.account_import_outcomes to service_role;
revoke execute on function public.current_admin_role(), public.is_active_admin() from anon;

commit;
