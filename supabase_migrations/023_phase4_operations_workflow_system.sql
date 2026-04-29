-- VAM OS Phase 4: Operations workflow system.
-- Additive/idempotent. Does not enable RLS on activity tables.

create extension if not exists pgcrypto;

alter table public.admin_users
  add column if not exists id uuid default gen_random_uuid();

update public.admin_users
set id = gen_random_uuid()
where id is null;

create unique index if not exists admin_users_id_unique_idx
  on public.admin_users(id);

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id),
  action_type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  description text,
  priority text default 'medium',
  status text default 'open',
  owner_admin_user_id uuid references public.admin_users(id),
  created_by_admin_user_id uuid references public.admin_users(id),
  resolved_by_admin_user_id uuid references public.admin_users(id),
  due_date date,
  resolved_at timestamptz,
  source text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint action_items_action_type_check
    check (action_type in ('followup_no_recap', 'data_issue', 'correction_request', 'event_attendance_issue', 'manual_task')),
  constraint action_items_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint action_items_status_check
    check (status in ('open', 'in_progress', 'resolved', 'dropped', 'no_response', 'parked'))
);

create table if not exists public.action_item_comments (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid references public.action_items(id) on delete cascade,
  admin_user_id uuid references public.admin_users(id),
  comment_text text not null,
  created_at timestamptz default now()
);

alter table public.activity_correction_log
  add column if not exists season_id uuid references public.seasons(id),
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists requested_by_admin_user_id uuid references public.admin_users(id),
  add column if not exists reviewed_by_admin_user_id uuid references public.admin_users(id),
  add column if not exists status text default 'applied',
  add column if not exists reviewed_at timestamptz;

create index if not exists action_items_season_id_idx on public.action_items(season_id);
create index if not exists action_items_action_type_idx on public.action_items(action_type);
create index if not exists action_items_status_idx on public.action_items(status);
create index if not exists action_items_owner_admin_user_id_idx on public.action_items(owner_admin_user_id);
create index if not exists action_items_due_date_idx on public.action_items(due_date);
create index if not exists action_items_created_at_idx on public.action_items(created_at desc);
create index if not exists action_items_entity_idx on public.action_items(entity_type, entity_id);
create index if not exists action_item_comments_action_item_id_idx on public.action_item_comments(action_item_id);
create index if not exists activity_correction_log_season_id_idx on public.activity_correction_log(season_id);
create index if not exists activity_correction_log_entity_idx on public.activity_correction_log(entity_type, entity_id);
create index if not exists activity_correction_log_status_idx on public.activity_correction_log(status);
create index if not exists activity_correction_log_created_at_idx on public.activity_correction_log(created_at desc);

create unique index if not exists action_items_followup_month_unique_idx
  on public.action_items(season_id, action_type, entity_type, entity_id, ((metadata->>'selected_month')))
  where action_type = 'followup_no_recap'
    and source = 'auto_monthly_check'
    and entity_id is not null
    and metadata ? 'selected_month';

create or replace function public.set_action_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_action_items_updated_at on public.action_items;
create trigger trg_action_items_updated_at
before update on public.action_items
for each row
execute function public.set_action_items_updated_at();

create or replace function public.current_admin_context()
returns table(admin_user_id uuid, auth_user_id uuid, role text, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select au.id, au.auth_user_id, au.role, au.full_name, au.email
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
    and au.role in ('viewer', 'reviewer', 'admin', 'super_admin')
  limit 1
$$;

create or replace function public.admin_can_access_season(p_season_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin public.admin_users%rowtype;
  v_season_id uuid;
  v_program_id uuid;
  v_program_code text;
  v_has_scope boolean;
begin
  select *
    into v_admin
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
    and au.role in ('viewer', 'reviewer', 'admin', 'super_admin')
  limit 1;

  if v_admin.id is null then
    return false;
  end if;

  if v_admin.role = 'super_admin' then
    return true;
  end if;

  select s.id, s.program_id, p.code
    into v_season_id, v_program_id, v_program_code
  from public.seasons s
  left join public.programs p on p.id = s.program_id
  where s.code = p_season_code
  limit 1;

  if v_season_id is null then
    return false;
  end if;

  select exists (
    select 1
    from public.admin_scope_access asa
    where asa.user_id = v_admin.auth_user_id
      and asa.status = 'active'
      and asa.role in ('full_access', 'operations', 'review', 'read')
      and (asa.season_id = p_season_code or asa.season_id = v_season_id::text or asa.season_id is null)
      and (asa.program_id is not distinct from v_program_code or asa.program_id is not distinct from v_program_id::text or asa.program_id is null)
  )
    into v_has_scope;

  return coalesce(v_has_scope, false);
end;
$$;

create or replace view public.v_operations_workflow_summary as
select
  ai.season_id,
  ai.action_month,
  count(*) filter (where ai.status in ('open', 'in_progress', 'parked'))::int as open_actions,
  count(*) filter (where ai.status in ('open', 'in_progress', 'parked') and ai.due_date < current_date)::int as overdue_actions,
  count(*) filter (where ai.action_type = 'followup_no_recap' and ai.status in ('open', 'in_progress', 'parked'))::int as followup_open,
  count(*) filter (where ai.action_type = 'followup_no_recap' and ai.status = 'resolved')::int as followup_resolved,
  count(*) filter (where ai.action_type = 'data_issue' and ai.status in ('open', 'in_progress', 'parked'))::int as data_issues_open,
  (
    select count(*)::int
    from public.activity_correction_log acl
    where acl.season_id = ai.season_id
      and date_trunc('month', acl.created_at)::date = ai.action_month
  ) as corrections_this_month,
  avg(extract(epoch from (coalesce(ai.resolved_at, now()) - ai.created_at)) / 86400)
    filter (where ai.resolved_at is not null) as avg_resolution_days
from (
  select action_items.*, date_trunc('month', created_at)::date as action_month
  from public.action_items
) ai
group by ai.season_id, ai.action_month;

create or replace function public.get_operations_workflow_data(
  p_season_code text default 'UEHM-S11',
  p_selected_month text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_admin_role text;
  v_season_id uuid;
  v_month text := coalesce(p_selected_month, to_char(now(), 'YYYY-MM'));
  v_month_start date;
  v_month_end date;
begin
  select admin_user_id, role
    into v_admin_id, v_admin_role
  from public.current_admin_context();

  if v_admin_id is null or not public.admin_can_access_season(p_season_code) then
    raise exception 'VAM OS admin access required'
      using errcode = '42501';
  end if;

  select id into v_season_id from public.seasons where code = p_season_code limit 1;
  if v_season_id is null then
    raise exception 'Season % was not found', p_season_code
      using errcode = 'P0001';
  end if;

  v_month_start := (v_month || '-01')::date;
  v_month_end := v_month_start + interval '1 month';

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'openActionCount', (select count(*)::int from public.action_items where season_id = v_season_id and status in ('open', 'in_progress', 'parked')),
      'overdueActionCount', (select count(*)::int from public.action_items where season_id = v_season_id and status in ('open', 'in_progress', 'parked') and due_date < current_date),
      'followUpOpenCount', (select count(*)::int from public.action_items where season_id = v_season_id and action_type = 'followup_no_recap' and status in ('open', 'in_progress', 'parked')),
      'followUpResolvedCount', (select count(*)::int from public.action_items where season_id = v_season_id and action_type = 'followup_no_recap' and status = 'resolved'),
      'dataIssueOpenCount', (select count(*)::int from public.action_items where season_id = v_season_id and action_type = 'data_issue' and status in ('open', 'in_progress', 'parked')),
      'correctionsThisMonth', (select count(*)::int from public.activity_correction_log where season_id = v_season_id and created_at >= v_month_start and created_at < v_month_end)
    ),
    'followUpQueue', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.due_date nulls last, row_data.created_at desc)
      from (
        select
          ai.id,
          ai.action_type,
          ai.title,
          ai.description,
          ai.status,
          ai.priority,
          owner.full_name as owner_name,
          ai.due_date,
          ai.entity_type,
          ai.entity_id,
          mentee.full_name as mentee_name,
          mentee.email_primary as mentee_email,
          mentor.full_name as mentor_name,
          ai.created_at,
          ai.updated_at,
          ai.metadata
        from public.action_items ai
        left join public.admin_users owner on owner.id = ai.owner_admin_user_id
        left join public.people mentee on mentee.id = ai.entity_id
        left join public.matches m on m.season_id = ai.season_id and m.mentee_person_id = ai.entity_id and lower(coalesce(m.status, '')) = 'active'
        left join public.people mentor on mentor.id = m.mentor_person_id
        where ai.season_id = v_season_id
          and ai.action_type = 'followup_no_recap'
      ) row_data
    ), '[]'::jsonb),
    'dataIssuesQueue', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.priority desc, row_data.created_at desc)
      from (
        select
          ai.id,
          ai.action_type,
          ai.title,
          ai.description,
          ai.status,
          ai.priority,
          owner.full_name as owner_name,
          ai.due_date,
          ai.entity_type,
          ai.entity_id,
          ai.created_at,
          ai.updated_at,
          ai.metadata
        from public.action_items ai
        left join public.admin_users owner on owner.id = ai.owner_admin_user_id
        where ai.season_id = v_season_id
          and ai.action_type in ('data_issue', 'event_attendance_issue', 'correction_request')
      ) row_data
    ), '[]'::jsonb),
    'correctionLog', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc)
      from (
        select
          acl.id,
          acl.entity_type,
          acl.entity_id,
          acl.correction_type,
          acl.reason,
          acl.status,
          requester.full_name as requested_by_name,
          reviewer.full_name as reviewed_by_name,
          acl.created_at,
          acl.reviewed_at
        from public.activity_correction_log acl
        left join public.admin_users requester on requester.id = acl.requested_by_admin_user_id
        left join public.admin_users reviewer on reviewer.id = acl.reviewed_by_admin_user_id
        where acl.season_id = v_season_id or acl.season_id is null
        order by acl.created_at desc
        limit 40
      ) row_data
    ), '[]'::jsonb),
    'myTasks', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.due_date nulls last, row_data.created_at desc)
      from (
        select
          ai.id,
          ai.action_type,
          ai.title,
          ai.description,
          ai.status,
          ai.priority,
          owner.full_name as owner_name,
          ai.due_date,
          ai.entity_type,
          ai.entity_id,
          ai.created_at,
          ai.updated_at,
          ai.metadata
        from public.action_items ai
        left join public.admin_users owner on owner.id = ai.owner_admin_user_id
        where ai.season_id = v_season_id
          and ai.owner_admin_user_id = v_admin_id
      ) row_data
    ), '[]'::jsonb),
    'owners', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.role desc, row_data.full_name nulls last, row_data.email)
      from (
        select id, full_name, email, role
        from public.admin_users
        where status = 'active'
          and role in ('reviewer', 'admin', 'super_admin')
      ) row_data
    ), '[]'::jsonb),
    'currentAdmin', jsonb_build_object('id', v_admin_id, 'role', v_admin_role)
  );
end;
$$;

create or replace function public.create_action_item(
  p_season_code text,
  p_action_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_owner_admin_user_id uuid default null,
  p_due_date date default null,
  p_source text default 'manual',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_admin_role text;
  v_season_id uuid;
  v_row public.action_items%rowtype;
begin
  select admin_user_id, role into v_admin_id, v_admin_role from public.current_admin_context();
  if v_admin_id is null or v_admin_role not in ('admin', 'super_admin') or not public.admin_can_access_season(p_season_code) then
    raise exception 'VAM OS admin action required' using errcode = '42501';
  end if;

  select id into v_season_id from public.seasons where code = p_season_code limit 1;
  if v_season_id is null then
    raise exception 'Season % was not found', p_season_code using errcode = 'P0001';
  end if;

  insert into public.action_items (
    season_id, action_type, entity_type, entity_id, title, description, priority,
    owner_admin_user_id, created_by_admin_user_id, due_date, source, metadata
  )
  values (
    v_season_id, p_action_type, p_entity_type, p_entity_id, p_title, p_description,
    coalesce(p_priority, 'medium'), p_owner_admin_user_id, v_admin_id, p_due_date,
    coalesce(p_source, 'manual'), coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.update_action_item(
  p_action_item_id uuid,
  p_status text default null,
  p_owner_admin_user_id uuid default null,
  p_priority text default null,
  p_due_date date default null,
  p_description text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_admin_role text;
  v_season_code text;
  v_row public.action_items%rowtype;
begin
  select admin_user_id, role into v_admin_id, v_admin_role from public.current_admin_context();

  select s.code
    into v_season_code
  from public.action_items ai
  join public.seasons s on s.id = ai.season_id
  where ai.id = p_action_item_id;

  if v_admin_id is null or v_admin_role not in ('admin', 'super_admin') or not public.admin_can_access_season(v_season_code) then
    raise exception 'VAM OS admin action required' using errcode = '42501';
  end if;

  update public.action_items
  set
    status = coalesce(p_status, status),
    owner_admin_user_id = coalesce(p_owner_admin_user_id, owner_admin_user_id),
    priority = coalesce(p_priority, priority),
    due_date = coalesce(p_due_date, due_date),
    description = coalesce(p_description, description),
    metadata = coalesce(p_metadata, metadata),
    resolved_at = case
      when coalesce(p_status, status) in ('resolved', 'dropped', 'no_response') and resolved_at is null then now()
      when coalesce(p_status, status) not in ('resolved', 'dropped', 'no_response') then null
      else resolved_at
    end,
    resolved_by_admin_user_id = case
      when coalesce(p_status, status) in ('resolved', 'dropped', 'no_response') then v_admin_id
      when coalesce(p_status, status) not in ('resolved', 'dropped', 'no_response') then null
      else resolved_by_admin_user_id
    end
  where id = p_action_item_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Action item was not found' using errcode = 'P0001';
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.add_action_item_comment(
  p_action_item_id uuid,
  p_comment_text text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_admin_role text;
  v_season_code text;
  v_row public.action_item_comments%rowtype;
begin
  select admin_user_id, role into v_admin_id, v_admin_role from public.current_admin_context();

  select s.code
    into v_season_code
  from public.action_items ai
  join public.seasons s on s.id = ai.season_id
  where ai.id = p_action_item_id;

  if v_admin_id is null or v_admin_role not in ('admin', 'super_admin') or not public.admin_can_access_season(v_season_code) then
    raise exception 'VAM OS admin action required' using errcode = '42501';
  end if;

  insert into public.action_item_comments (action_item_id, admin_user_id, comment_text)
  values (p_action_item_id, v_admin_id, trim(p_comment_text))
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.generate_monthly_followup_actions(
  p_season_code text,
  p_selected_month text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_admin_role text;
  v_season_id uuid;
  v_previous_month text;
  v_due_date date;
  v_created_count int := 0;
  v_skipped_count int := 0;
  v_affected jsonb := '[]'::jsonb;
begin
  select admin_user_id, role into v_admin_id, v_admin_role from public.current_admin_context();
  if v_admin_id is null or v_admin_role not in ('admin', 'super_admin') or not public.admin_can_access_season(p_season_code) then
    raise exception 'VAM OS admin action required' using errcode = '42501';
  end if;

  if p_selected_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'selected_month must use YYYY-MM' using errcode = '22023';
  end if;

  select id into v_season_id from public.seasons where code = p_season_code limit 1;
  if v_season_id is null then
    raise exception 'Season % was not found', p_season_code using errcode = 'P0001';
  end if;

  v_previous_month := to_char((p_selected_month || '-01')::date - interval '1 month', 'YYYY-MM');
  v_due_date := (p_selected_month || '-01')::date + interval '14 days';

  with active_mentees as (
    select distinct m.mentee_person_id, m.mentor_person_id
    from public.matches m
    where m.season_id = v_season_id
      and lower(coalesce(m.status, '')) = 'active'
      and m.mentee_person_id is not null
      and m.mentor_person_id is not null
  ),
  selected_mentees as (
    select distinct mr.mentee_person_id
    from public.mentoring_recaps mr
    where mr.season_id = v_season_id
      and mr.meeting_month = p_selected_month
      and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') not in ('rejected', 'deleted', 'invalid', 'duplicate')
  ),
  previous_mentees as (
    select distinct mr.mentee_person_id
    from public.mentoring_recaps mr
    where mr.season_id = v_season_id
      and mr.meeting_month = v_previous_month
      and mr.mentee_person_id is not null
      and coalesce(trim(lower(mr.status)), '') not in ('rejected', 'deleted', 'invalid', 'duplicate')
  ),
  candidates as (
    select am.mentee_person_id, am.mentor_person_id, mentee.full_name as mentee_name, mentor.full_name as mentor_name
    from active_mentees am
    left join public.people mentee on mentee.id = am.mentee_person_id
    left join public.people mentor on mentor.id = am.mentor_person_id
    where not exists (select 1 from selected_mentees sm where sm.mentee_person_id = am.mentee_person_id)
      and not exists (select 1 from previous_mentees pm where pm.mentee_person_id = am.mentee_person_id)
  ),
  inserted as (
    insert into public.action_items (
      season_id,
      action_type,
      entity_type,
      entity_id,
      title,
      description,
      priority,
      status,
      created_by_admin_user_id,
      due_date,
      source,
      metadata
    )
    select
      v_season_id,
      'followup_no_recap',
      'mentee',
      c.mentee_person_id,
      'Follow up mentee missing recap for 2 months',
      concat('Mentee ', coalesce(c.mentee_name, c.mentee_person_id::text), ' chưa có recap trong ', p_selected_month, ' và ', v_previous_month, '. Đây là tín hiệu hỗ trợ nội bộ, không phải đánh giá tiêu cực.'),
      'high',
      'open',
      v_admin_id,
      v_due_date,
      'auto_monthly_check',
      jsonb_build_object(
        'selected_month', p_selected_month,
        'previous_month', v_previous_month,
        'mentee_name', c.mentee_name,
        'mentor_name', c.mentor_name
      )
    from candidates c
    on conflict do nothing
    returning entity_id
  )
  select
    (select count(*)::int from inserted),
    (select count(*)::int from candidates) - (select count(*)::int from inserted),
    coalesce((
      select jsonb_agg(jsonb_build_object('mentee_id', c.mentee_person_id, 'mentee_name', c.mentee_name, 'mentor_name', c.mentor_name) order by c.mentee_name)
      from candidates c
    ), '[]'::jsonb)
  into v_created_count, v_skipped_count, v_affected;

  return jsonb_build_object(
    'createdCount', v_created_count,
    'skippedDuplicateCount', v_skipped_count,
    'selectedMonth', p_selected_month,
    'previousMonth', v_previous_month,
    'affectedMentees', v_affected
  );
end;
$$;

revoke all on function public.current_admin_context() from public, anon;
grant execute on function public.current_admin_context() to authenticated;
revoke all on function public.admin_can_access_season(text) from public, anon;
grant execute on function public.admin_can_access_season(text) to authenticated;
revoke all on function public.get_operations_workflow_data(text, text) from public, anon;
grant execute on function public.get_operations_workflow_data(text, text) to authenticated;
revoke all on function public.create_action_item(text, text, text, uuid, text, text, text, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_action_item(text, text, text, uuid, text, text, text, uuid, date, text, jsonb) to authenticated;
revoke all on function public.update_action_item(uuid, text, uuid, text, date, text, jsonb) from public, anon;
grant execute on function public.update_action_item(uuid, text, uuid, text, date, text, jsonb) to authenticated;
revoke all on function public.add_action_item_comment(uuid, text) from public, anon;
grant execute on function public.add_action_item_comment(uuid, text) to authenticated;
revoke all on function public.generate_monthly_followup_actions(text, text) from public, anon;
grant execute on function public.generate_monthly_followup_actions(text, text) to authenticated;

alter table public.mentoring_recaps disable row level security;
alter table public.event_participations disable row level security;

notify pgrst, 'reload schema';
