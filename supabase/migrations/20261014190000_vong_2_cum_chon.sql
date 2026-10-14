-- Ghép cặp Vòng 2 — "cụm chọn": cho phép gộp nhiều nhóm ngành vào chung một danh sách chọn.
--
-- Số liệu mùa 12 lúc 17:40 ngày 14/10: 548 chỗ cho 578 mentee đang chờ, lệch theo nhóm. BTC đã cân
-- nhắc gộp nhóm (1+2+3, 6+9) rồi chốt GIỮ 9 NHÓM RIÊNG cho Vòng 2 (BTC 14/10/2026, tối). Vì vậy
-- migration này KHÔNG gộp nhóm nào: bảng matching_round2_pools để trống, mỗi nhóm là một danh sách,
-- hành vi y hệt luật cũ "cùng nhóm". Nếu sau này BTC muốn gộp (ví dụ đợt mở rộng sau khi đóng vòng),
-- chỉ cần thêm dòng vào bảng bằng SQL có duyệt — không phải đổi hàm.
--
-- Gộp ở tầng CHỌN, không đổi nhóm của ai: nhóm ngành vẫn là căn cứ phân loại và báo cáo.
--
-- vam113_round2_pick giữ nguyên từng dòng, chỉ đổi bước "cùng nhóm" thành "cùng cụm" (test soát
-- diff thân hàm; bảng trống thì cụm = nhóm). vam123_round2_available trả mã đơn các bạn còn trống
-- trong danh sách của mentor, một truy vấn — để trang chọn tự cập nhật mà không tải lại cả hồ sơ.

do $prereq$
begin
  if to_regprocedure('public.vam113_round2_pick(uuid, uuid)') is null
     or to_regclass('public.matching_round2_links') is null
     or to_regclass('public.matching_round2_settings') is null then
    raise exception 'PREREQ_MISSING: dán migration 20261008080000_vong_2_mentor_chon_mentee.sql trước';
  end if;
end
$prereq$;

create table if not exists public.matching_round2_pools (
  season_id uuid not null references public.seasons(id),
  group_code smallint not null check (group_code between 1 and 9),
  pool_code smallint not null check (pool_code between 1 and 9),
  created_at timestamptz not null default now(),
  primary key (season_id, group_code)
);

alter table public.matching_round2_pools enable row level security;
revoke all on public.matching_round2_pools from public, anon, authenticated, service_role;
-- Máy chủ chỉ đọc; đổi cách gộp là quyết định của BTC, làm bằng SQL có duyệt.
grant select on public.matching_round2_pools to service_role;

-- Không nạp dòng nào: BTC chốt giữ 9 nhóm riêng cho Vòng 2 mùa 12 (14/10/2026).

create or replace function public.vam123_round2_pool(p_season uuid, p_group smallint)
returns smallint
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    (select p.pool_code from public.matching_round2_pools p where p.season_id = p_season and p.group_code = p_group),
    p_group
  );
$function$;

-- vam113_round2_pick: nguyên văn 20261008080000, chỉ khác bước "cùng nhóm" → "cùng cụm".
create or replace function public.vam113_round2_pick(p_token uuid, p_mentee_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
  l public.matching_round2_links%rowtype;
  s public.matching_round2_settings%rowtype;
  v_code text;
  v_mentor_group smallint;
  v_mentee_group smallint;
  v_mentee_person uuid;
  v_profiles integer;
  v_capacity integer;
  v_limit integer;
  v_active integer;
  v_match uuid;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select * into l from public.matching_round2_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'code', 'invalid_token'); end if;

  if l.revoked_at is not null then
    v_code := 'link_revoked';
  else
    select * into s from public.matching_round2_settings where season_id = l.season_id;
    if s.season_id is null or now() < s.opens_at then
      v_code := 'window_not_open';
    elsif s.closes_at is not null and now() >= s.closes_at then
      v_code := 'window_closed';
    end if;
  end if;

  if v_code is null then
    -- Người bấm trước được: mọi lượt chọn của cả mùa xếp hàng ở đây.
    perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || l.season_id::text, 0));
    if not exists (select 1 from public.applications a
                    where a.person_id = l.mentor_person_id and a.season_id = l.season_id
                      and a.status::text = 'approved_as_mentor')
       or exists (select 1 from public.person_season_memberships m
                   where m.person_id = l.mentor_person_id and m.season_id = l.season_id
                     and m.role::text = 'mentor' and m.status::text in ('withdrawn', 'opted_out')) then
      v_code := 'mentor_not_eligible';
    end if;
  end if;

  if v_code is null then
    select group_code into v_mentor_group from public.matching_industry_assignments
     where season_id = l.season_id and person_id = l.mentor_person_id and role = 'mentor';
    if v_mentor_group is null then v_code := 'mentor_not_classified'; end if;
  end if;

  if v_code is null then
    select count(*), max(capacity_target) into v_profiles, v_capacity
      from public.mentor_profiles where person_id = l.mentor_person_id;
    if v_profiles <> 1 then v_code := 'mentor_identity_ambiguous'; end if;
  end if;

  if v_code is null then
    select a.person_id into v_mentee_person from public.applications a
     where a.id = p_mentee_application and a.season_id = l.season_id
       and a.role_applied::text = 'mentee' and a.status::text = 'approved_as_mentee';
    if v_mentee_person is null
       or exists (select 1 from public.person_season_memberships m
                   where m.person_id = v_mentee_person and m.season_id = l.season_id
                     and m.role::text = 'mentee' and m.status::text in ('withdrawn', 'opted_out')) then
      v_code := 'mentee_not_found';
    end if;
  end if;

  if v_code is null then
    select group_code into v_mentee_group from public.matching_industry_assignments
     where season_id = l.season_id and person_id = v_mentee_person and role = 'mentee';
    -- Cùng CỤM chọn (20261014190000): nhóm không gộp thì cụm là chính nó, như luật cũ.
    if v_mentee_group is null
       or public.vam123_round2_pool(l.season_id, v_mentee_group) is distinct from public.vam123_round2_pool(l.season_id, v_mentor_group) then
      v_code := 'mentee_not_in_group';
    end if;
  end if;

  if v_code is null then
    if exists (select 1 from public.matches m
                where m.season_id = l.season_id and m.mentee_person_id = v_mentee_person and m.status::text = 'active') then
      v_code := 'mentee_taken';
    end if;
  end if;

  if v_code is null then
    v_limit := least(2, case when v_capacity > 0 then v_capacity else 3 end);
    select count(*) into v_active from public.matches m
     where m.season_id = l.season_id and m.mentor_person_id = l.mentor_person_id and m.status::text = 'active';
    if v_active >= v_limit then v_code := 'mentor_full'; end if;
  end if;

  if v_code is null then
    begin
      insert into public.matches(season_id, mentor_person_id, mentee_person_id, status, match_source_raw, match_type, matched_at, notes, matching_round)
        values (l.season_id, l.mentor_person_id, v_mentee_person, 'active', 'manual', 'primary', now(),
                'Mentor tự chọn ở Vòng 2 qua link riêng', 2)
        returning id into v_match;
    exception when others then
      -- Lớp đỡ thứ hai (trigger sức chứa) từ chối: trả mã, không để trang web vỡ.
      v_code := case
        when sqlerrm like '%MENTOR_FULL%' then 'mentor_full'
        when sqlerrm like '%OTHER_MATCH_REQUIRES_BTC%' then 'mentee_taken'
        when sqlerrm like '%MENTOR_IDENTITY_AMBIGUOUS%' then 'mentor_identity_ambiguous'
        else 'pick_failed'
      end;
    end;
  end if;

  insert into public.matching_round2_picks(link_id, season_id, mentor_person_id, mentee_application_id, mentee_person_id, action, outcome, match_id)
    values (l.id, l.season_id, l.mentor_person_id, p_mentee_application, v_mentee_person, 'pick', coalesce(v_code, 'ok'), v_match);

  if v_code is not null then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true, 'matchId', v_match, 'remaining', v_limit - v_active - 1);
end;
$function$;

create or replace function public.vam123_round2_available(p_token uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
  l public.matching_round2_links%rowtype;
  s public.matching_round2_settings%rowtype;
  v_group smallint;
  v_pool smallint;
  v_ids uuid[];
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  -- Mọi trường hợp không được xem đều trả mảng rỗng, cùng một câu trả lời: không lộ link nào tồn tại.
  select * into l from public.matching_round2_links where token = p_token;
  if l.id is null or l.revoked_at is not null then return '{}'::uuid[]; end if;

  select * into s from public.matching_round2_settings where season_id = l.season_id;
  if s.season_id is null or now() < s.opens_at or (s.closes_at is not null and now() >= s.closes_at) then
    return '{}'::uuid[];
  end if;

  if not exists (select 1 from public.applications a
                  where a.person_id = l.mentor_person_id and a.season_id = l.season_id
                    and a.status::text = 'approved_as_mentor')
     or exists (select 1 from public.person_season_memberships m
                 where m.person_id = l.mentor_person_id and m.season_id = l.season_id
                   and m.role::text = 'mentor' and m.status::text in ('withdrawn', 'opted_out')) then
    return '{}'::uuid[];
  end if;

  select group_code into v_group from public.matching_industry_assignments
   where season_id = l.season_id and person_id = l.mentor_person_id and role = 'mentor';
  if v_group is null then return '{}'::uuid[]; end if;
  v_pool := public.vam123_round2_pool(l.season_id, v_group);

  select coalesce(array_agg(a.application_id order by a.application_id), '{}'::uuid[]) into v_ids
    from public.matching_industry_assignments a
    join public.applications ap on ap.id = a.application_id
   where a.season_id = l.season_id and a.role = 'mentee'
     and public.vam123_round2_pool(l.season_id, a.group_code) = v_pool
     and ap.season_id = l.season_id and ap.person_id = a.person_id
     and ap.role_applied::text = 'mentee' and ap.status::text = 'approved_as_mentee'
     and not exists (select 1 from public.matches m
                      where m.season_id = l.season_id and m.mentee_person_id = a.person_id and m.status::text = 'active')
     and not exists (select 1 from public.person_season_memberships ms
                      where ms.person_id = a.person_id and ms.season_id = l.season_id
                        and ms.role::text = 'mentee' and ms.status::text in ('withdrawn', 'opted_out'));
  return v_ids;
end;
$function$;

revoke all on function public.vam123_round2_pool(uuid, smallint) from public, anon, authenticated;
revoke all on function public.vam123_round2_available(uuid) from public, anon, authenticated;
revoke all on function public.vam113_round2_pick(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam123_round2_pool(uuid, smallint) to service_role;
grant execute on function public.vam123_round2_available(uuid) to service_role;
grant execute on function public.vam113_round2_pick(uuid, uuid) to service_role;

do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'matching_round2_pools' and c.relrowsecurity) then
    raise exception 'Bảng matching_round2_pools chưa bật RLS';
  end if;
  if has_table_privilege('anon', 'public.matching_round2_pools', 'select')
     or has_table_privilege('authenticated', 'public.matching_round2_pools', 'select')
     or has_table_privilege('service_role', 'public.matching_round2_pools', 'insert') then
    raise exception 'Quyền bảng matching_round2_pools sai';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.vam113_round2_pick(uuid, uuid)'::regprocedure and prosecdef)
     or not exists (select 1 from pg_proc where oid = 'public.vam123_round2_available(uuid)'::regprocedure and prosecdef) then
    raise exception 'Hàm chọn / danh sách còn trống phải chạy bằng quyền chủ hàm';
  end if;
  if has_function_privilege('anon', 'public.vam113_round2_pick(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam113_round2_pick(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.vam123_round2_available(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam123_round2_available(uuid)', 'execute')
     or has_function_privilege('anon', 'public.vam123_round2_pool(uuid, smallint)', 'execute')
     or not has_function_privilege('service_role', 'public.vam113_round2_pick(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.vam123_round2_available(uuid)', 'execute') then
    raise exception 'Quyền gọi hàm cụm chọn sai';
  end if;
  if position('vam123_round2_pool' in (select prosrc from pg_proc where oid = 'public.vam113_round2_pick(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'vam113_round2_pick chưa so theo cụm';
  end if;
  raise notice 'Vòng 2 — cụm chọn: sẵn sàng';
end $$;

notify pgrst, 'reload schema';
