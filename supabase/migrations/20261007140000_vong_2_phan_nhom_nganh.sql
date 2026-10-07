-- Ghép cặp Vòng 2 — phân nhóm ngành (BTC 07/10/2026).
--
-- Mỗi mentor và mentee đã duyệt của mùa thuộc đúng 1 trong 9 nhóm ngành; mentor chỉ thấy
-- mentee cùng nhóm. Luật phân loại nằm trong mã (lib/matching-round2-classify-core.ts)
-- để cùng dữ liệu luôn ra cùng nhóm; database giữ KẾT QUẢ và KHOÁ nó.
--
-- Khoá: nhóm đã gán giữ đến hết mùa. Lần chạy sau chỉ thêm người mới; người cũ nếu dữ liệu
-- hôm nay cho ra nhóm khác thì chỉ ghi drift_group để BTC thấy, nhóm không đổi. Đổi nhóm
-- chỉ đi qua vam112_set_industry_group (có lý do, có log) — trigger chặn mọi đường khác,
-- kể cả một lệnh update gõ tay.
--
-- Hai hàm chạy bằng quyền NGƯỜI GỌI (service_role của VAM OS), không bằng quyền chủ hàm:
-- phép kiểm vận hành mùa tự đòi current_user = 'service_role', nên trong một hàm chạy
-- bằng quyền chủ hàm nó luôn trả false.

create table if not exists public.matching_industry_assignments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  person_id uuid not null references public.people(id),
  role text not null check (role in ('mentor', 'mentee')),
  application_id uuid references public.applications(id),
  group_code smallint not null check (group_code between 1 and 9),
  confidence text not null check (confidence in ('cao', 'trung_binh', 'thap')),
  flags text[] not null default '{}',
  secondary_groups smallint[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  rule_version text not null,
  source text not null default 'auto' check (source in ('auto', 'btc')),
  reviewed_by uuid references public.admin_users(id),
  reviewed_at timestamptz,
  override_reason text,
  drift_group smallint check (drift_group between 1 and 9),
  drift_checked_at timestamptz,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_industry_assignments_person_uniq unique (season_id, person_id, role)
);

-- Khoá số tăng dần: log đọc đúng thứ tự ghi, kể cả nhiều dòng trong cùng một giao dịch
-- (created_at = thời điểm bắt đầu giao dịch, trùng nhau).
create table if not exists public.matching_industry_assignment_log (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.matching_industry_assignments(id),
  actor_id uuid references public.admin_users(id),
  action text not null check (action in ('auto_assign', 'drift', 'btc_confirm', 'btc_override')),
  old_group smallint,
  new_group smallint,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists matching_industry_assignment_log_assignment_idx
  on public.matching_industry_assignment_log(assignment_id, created_at);

-- Bảng mới trong public: khoá công khai nằm sẵn trong trang web, Supabase mặc định cấp
-- quyền bảng cho anon (xem 20260916090000_lock_down_public_api.sql).
alter table public.matching_industry_assignments enable row level security;
alter table public.matching_industry_assignment_log enable row level security;
revoke all on public.matching_industry_assignments from public, anon, authenticated, service_role;
revoke all on public.matching_industry_assignment_log from public, anon, authenticated, service_role;
grant select, insert, update on public.matching_industry_assignments to service_role;
grant select, insert on public.matching_industry_assignment_log to service_role;

create or replace function public.vam112_industry_lock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.season_id is distinct from old.season_id
     or new.person_id is distinct from old.person_id
     or new.role is distinct from old.role then
    raise exception 'INDUSTRY_ASSIGNMENT_IMMUTABLE';
  end if;
  if new.group_code is distinct from old.group_code
     and coalesce(current_setting('vam.industry_override', true), '') <> old.id::text then
    raise exception 'INDUSTRY_GROUP_LOCKED';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.vam112_industry_lock_guard() from public, anon, authenticated;

drop trigger if exists vam112_industry_lock_guard on public.matching_industry_assignments;
create trigger vam112_industry_lock_guard
  before update on public.matching_industry_assignments
  for each row execute function public.vam112_industry_lock_guard();

-- Lưu kết quả phân loại. Người chưa có nhóm → thêm (on conflict do nothing CHÍNH LÀ khoá).
-- Người đã có nhóm → chỉ ghi drift_group khi dữ liệu hôm nay cho ra nhóm khác.
create or replace function public.vam112_save_industry_assignments(
  p_actor uuid, p_season uuid, p_rows jsonb, p_rule_version text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_role text;
  v_person uuid;
  v_app uuid;
  v_group smallint;
  v_id uuid;
  v_old public.matching_industry_assignments%rowtype;
  v_new_mentors integer := 0;
  v_new_mentees integer := 0;
  v_drift integer := 0;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_ROWS'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'TOO_MANY_ROWS'; end if;
  if nullif(btrim(p_rule_version), '') is null then raise exception 'INVALID_ROWS'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_role := r->>'role';
    v_person := (r->>'personId')::uuid;
    v_app := (r->>'applicationId')::uuid;
    v_group := (r->>'group')::smallint;
    if v_role is null or v_role not in ('mentor', 'mentee') or v_group is null or v_group not between 1 and 9 then
      raise exception 'INVALID_ROW';
    end if;
    -- Dữ liệu từ máy chủ ứng dụng vẫn kiểm lại: chỉ người có đơn đã duyệt đúng vai trò,
    -- đúng mùa mới được gán nhóm.
    if not exists (
      select 1 from public.applications a
       where a.id = v_app and a.season_id = p_season and a.person_id = v_person
         and a.role_applied::text = v_role
         and a.status::text = case v_role when 'mentor' then 'approved_as_mentor' else 'approved_as_mentee' end
    ) then
      raise exception 'NOT_APPROVED';
    end if;

    v_id := null;
    insert into public.matching_industry_assignments(
      season_id, person_id, role, application_id, group_code, confidence, flags,
      secondary_groups, evidence, rule_version, created_by
    ) values (
      p_season, v_person, v_role, v_app, v_group, r->>'confidence',
      coalesce(array(select jsonb_array_elements_text(coalesce(r->'flags', '[]'::jsonb))), '{}'::text[]),
      coalesce(array(select (jsonb_array_elements_text(coalesce(r->'secondary', '[]'::jsonb)))::smallint), '{}'::smallint[]),
      coalesce(r->'evidence', '{}'::jsonb), p_rule_version, p_actor
    )
    on conflict (season_id, person_id, role) do nothing
    returning id into v_id;

    if v_id is not null then
      insert into public.matching_industry_assignment_log(assignment_id, actor_id, action, new_group)
        values (v_id, p_actor, 'auto_assign', v_group);
      if v_role = 'mentor' then v_new_mentors := v_new_mentors + 1; else v_new_mentees := v_new_mentees + 1; end if;
    else
      select * into v_old from public.matching_industry_assignments
       where season_id = p_season and person_id = v_person and role = v_role
       for update;
      if v_old.group_code = v_group then
        if v_old.drift_group is not null then
          update public.matching_industry_assignments set drift_group = null, drift_checked_at = now() where id = v_old.id;
        end if;
      elsif v_old.drift_group is distinct from v_group then
        update public.matching_industry_assignments set drift_group = v_group, drift_checked_at = now() where id = v_old.id;
        insert into public.matching_industry_assignment_log(assignment_id, actor_id, action, old_group, new_group)
          values (v_old.id, p_actor, 'drift', v_old.group_code, v_group);
        v_drift := v_drift + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'newMentors', v_new_mentors, 'newMentees', v_new_mentees, 'drift', v_drift);
end;
$$;

-- BTC đổi hoặc xác nhận nhóm của một người. p_expected_group là nhóm BTC đang nhìn trên
-- màn hình: người khác vừa đổi thì từ chối (STALE_GROUP), không ghi đè lên quyết định
-- mới hơn. Truyền đúng nhóm hiện tại = xác nhận, gỡ cờ CAN_BTC_XEM.
create or replace function public.vam112_set_industry_group(
  p_actor uuid, p_assignment uuid, p_expected_group smallint, p_new_group smallint, p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  a public.matching_industry_assignments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into a from public.matching_industry_assignments where id = p_assignment;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.vam084_operator_for_season(p_actor, a.season_id) then raise exception 'ACCESS_DENIED'; end if;
  if p_new_group is null or p_new_group not between 1 and 9 then raise exception 'INVALID_GROUP'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  -- Cùng khoá với mọi đường tạo cặp của mùa: không đổi nhóm giữa lúc một mentor đang chọn.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || a.season_id::text, 0));
  select * into a from public.matching_industry_assignments where id = p_assignment for update;
  if a.group_code is distinct from p_expected_group then raise exception 'STALE_GROUP'; end if;

  perform set_config('vam.industry_override', a.id::text, true);
  update public.matching_industry_assignments
     set group_code = p_new_group,
         source = 'btc',
         confidence = 'cao',
         flags = array_remove(flags, 'CAN_BTC_XEM'),
         reviewed_by = p_actor,
         reviewed_at = now(),
         override_reason = v_reason,
         drift_group = null,
         drift_checked_at = now()
   where id = a.id;
  perform set_config('vam.industry_override', '', true);

  insert into public.matching_industry_assignment_log(assignment_id, actor_id, action, old_group, new_group, reason)
    values (a.id, p_actor, case when p_new_group = a.group_code then 'btc_confirm' else 'btc_override' end,
            a.group_code, p_new_group, v_reason);
  return jsonb_build_object('ok', true, 'group', p_new_group);
end;
$$;

revoke all on function public.vam112_save_industry_assignments(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text) from public, anon, authenticated;
grant execute on function public.vam112_save_industry_assignments(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text) to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['matching_industry_assignments', 'matching_industry_assignment_log'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'Bảng % chưa bật RLS', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'anon/authenticated còn đọc được %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception 'service_role không được xoá %', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.matching_industry_assignment_log', 'update') then
    raise exception 'Log phân nhóm phải chỉ thêm, không sửa';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam112_industry_lock_guard' and not tgisinternal) then
    raise exception 'Thiếu trigger khoá nhóm vam112_industry_lock_guard';
  end if;
  if exists (select 1 from pg_proc where proname in ('vam112_save_industry_assignments', 'vam112_set_industry_group') and prosecdef) then
    raise exception 'Hàm vam112 phải chạy bằng quyền người gọi';
  end if;
  if has_function_privilege('anon', 'public.vam112_save_industry_assignments(uuid, uuid, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text)', 'execute') then
    raise exception 'anon gọi được hàm vam112';
  end if;
  raise notice 'Vòng 2 — phân nhóm ngành: sẵn sàng';
end $$;
