-- Ghép cặp Vòng 2 — mentor tự chọn mentee qua link riêng (BTC 07/10/2026).
--
-- Mỗi mentor còn chỗ nhận một link riêng (token), mở ra danh sách mentee cùng nhóm ngành
-- chưa có mentor, bấm "Chọn" là thành cặp vòng 2. Luật BTC:
--   - Số chỗ còn = min(2, sức nhận đăng ký) − số cặp đang hoạt động (tính cả vòng 1).
--   - Mentee đã có người chọn thì ẩn ngay; hai mentor bấm cùng lúc thì người trước được.
--   - Mentor tự bỏ chọn được trong 30 phút đầu; quá 30 phút thì BTC huỷ ở trang Ghép cặp.
--   - Vòng mở/đóng theo giờ BTC đặt; chưa đặt nghĩa là CHƯA MỞ (an toàn khi quên).
--
-- Hàm chọn/bỏ chọn chạy bằng quyền chủ hàm vì người bấm là mentor, không có tài khoản:
-- chỉ máy chủ VAM OS gọi được (vam063_trusted_api_role = service_role), và token là
-- thứ duy nhất xác định mentor — mọi điều kiện kiểm lại TRONG hàm, không tin trang web.
-- Thứ tự khoá: link → khoá cặp của mùa (VAM104_MATCH, cùng khoá với vam104 và trigger
-- sức chứa) → match. Trigger vam104_match_capacity_guard vẫn chạy như lớp đỡ thứ hai.
--
-- Kèm theo: nới outbound_emails_kind_check theo lối cộng thêm — + 'matching_round2_invite'.

do $prereq$
begin
  if to_regclass('public.matching_industry_assignments') is null then
    raise exception 'PREREQ_MISSING: dán migration 20261007140000_vong_2_phan_nhom_nganh.sql trước';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'matching_round') then
    raise exception 'PREREQ_MISSING: dán migration 20261007120000_vong_ghep_cap.sql trước';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role') then
    raise exception 'PREREQ_MISSING: chưa có vam063_trusted_api_role';
  end if;
end
$prereq$;

create table if not exists public.matching_round2_settings (
  season_id uuid primary key references public.seasons(id),
  opens_at timestamptz not null,
  closes_at timestamptz,
  current_send_wave smallint not null default 1 check (current_send_wave between 1 and 9),
  updated_by uuid references public.admin_users(id),
  updated_at timestamptz not null default now(),
  constraint matching_round2_window_order check (closes_at is null or closes_at > opens_at)
);

create table if not exists public.matching_round2_links (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  mentor_person_id uuid not null references public.people(id),
  token uuid not null unique default gen_random_uuid(),
  last_sent_wave smallint not null default 0,
  send_count integer not null default 0 check (send_count >= 0),
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  revoked_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  constraint matching_round2_links_mentor_uniq unique (season_id, mentor_person_id)
);

-- Mọi lượt bấm, kể cả bị từ chối: nguồn cho cảnh báo "một mentee được nhiều mentor chọn".
create table if not exists public.matching_round2_picks (
  id bigint generated always as identity primary key,
  link_id uuid references public.matching_round2_links(id),
  season_id uuid not null references public.seasons(id),
  mentor_person_id uuid,
  mentee_application_id uuid,
  mentee_person_id uuid,
  action text not null check (action in ('pick', 'unpick')),
  outcome text not null,
  match_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists matching_round2_picks_match_idx on public.matching_round2_picks(match_id);

alter table public.matching_round2_settings enable row level security;
alter table public.matching_round2_links enable row level security;
alter table public.matching_round2_picks enable row level security;
revoke all on public.matching_round2_settings from public, anon, authenticated, service_role;
revoke all on public.matching_round2_links from public, anon, authenticated, service_role;
revoke all on public.matching_round2_picks from public, anon, authenticated, service_role;
grant select, insert, update on public.matching_round2_settings to service_role;
grant select, insert, update on public.matching_round2_links to service_role;
-- Log chọn chỉ do hàm chọn/bỏ chọn ghi (chạy bằng quyền chủ hàm); máy chủ chỉ đọc.
grant select on public.matching_round2_picks to service_role;

-- BTC đặt giờ mở/đóng vòng 2 và đợt gửi thư hiện hành.
create or replace function public.vam113_set_round2_window(
  p_actor uuid, p_season uuid, p_opens_at timestamptz, p_closes_at timestamptz, p_send_wave smallint
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if p_opens_at is null then raise exception 'OPENS_AT_REQUIRED'; end if;
  if p_closes_at is not null and p_closes_at <= p_opens_at then raise exception 'WINDOW_ORDER'; end if;
  if p_send_wave is null or p_send_wave not between 1 and 9 then raise exception 'INVALID_WAVE'; end if;
  insert into public.matching_round2_settings(season_id, opens_at, closes_at, current_send_wave, updated_by, updated_at)
    values (p_season, p_opens_at, p_closes_at, p_send_wave, p_actor, now())
  on conflict (season_id) do update
    set opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        current_send_wave = excluded.current_send_wave,
        updated_by = excluded.updated_by,
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$function$;

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
    if v_mentee_group is distinct from v_mentor_group then v_code := 'mentee_not_in_group'; end if;
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

create or replace function public.vam113_round2_unpick(p_token uuid, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
  l public.matching_round2_links%rowtype;
  v_status text;
  v_picked_at timestamptz;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select * into l from public.matching_round2_links where token = p_token for update;
  if l.id is null then return jsonb_build_object('ok', false, 'code', 'invalid_token'); end if;
  if l.revoked_at is not null then return jsonb_build_object('ok', false, 'code', 'link_revoked'); end if;

  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || l.season_id::text, 0));
  select m.status::text into v_status from public.matches m
   where m.id = p_match and m.season_id = l.season_id and m.mentor_person_id = l.mentor_person_id
     and m.matching_round = 2
   for update;
  -- Chỉ cặp do CHÍNH link này chọn: cặp vòng 1 hay cặp BTC ghép tay không bỏ được từ đây.
  select p.created_at into v_picked_at from public.matching_round2_picks p
   where p.match_id = p_match and p.link_id = l.id and p.action = 'pick' and p.outcome = 'ok'
   order by p.id desc limit 1;
  if v_status is distinct from 'active' or v_picked_at is null then
    return jsonb_build_object('ok', false, 'code', 'match_not_found');
  end if;
  if now() > v_picked_at + interval '30 minutes' then
    insert into public.matching_round2_picks(link_id, season_id, mentor_person_id, action, outcome, match_id)
      values (l.id, l.season_id, l.mentor_person_id, 'unpick', 'undo_expired', p_match);
    return jsonb_build_object('ok', false, 'code', 'undo_expired');
  end if;

  update public.matches
     set status = 'dropped', ended_at = now(), end_reason = 'Mentor bỏ chọn trong 30 phút (Vòng 2)'
   where id = p_match;
  insert into public.matching_round2_picks(link_id, season_id, mentor_person_id, action, outcome, match_id)
    values (l.id, l.season_id, l.mentor_person_id, 'unpick', 'ok', p_match);
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.vam113_set_round2_window(uuid, uuid, timestamptz, timestamptz, smallint) from public, anon, authenticated;
revoke all on function public.vam113_round2_pick(uuid, uuid) from public, anon, authenticated;
revoke all on function public.vam113_round2_unpick(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam113_set_round2_window(uuid, uuid, timestamptz, timestamptz, smallint) to service_role;
grant execute on function public.vam113_round2_pick(uuid, uuid) to service_role;
grant execute on function public.vam113_round2_unpick(uuid, uuid) to service_role;

-- Loại thư mới, theo lối cộng thêm (khuôn 20260926100000_giai_doan_1_pv_mentee.sql).
do $kind$
declare
  v_existing text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
    from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không thấy outbound_emails_kind_check';
  end if;
  if position(quote_literal('matching_round2_invite') in v_existing) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''matching_round2_invite''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $$
declare
  t text;
  v_def text;
begin
  foreach t in array array['matching_round2_settings', 'matching_round2_links', 'matching_round2_picks'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'Bảng % chưa bật RLS', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'anon/authenticated còn đọc được %', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.matching_round2_picks', 'insert') then
    raise exception 'Máy chủ không được tự ghi log chọn';
  end if;
  if not exists (select 1 from pg_proc where proname = 'vam113_round2_pick' and prosecdef)
     or not exists (select 1 from pg_proc where proname = 'vam113_round2_unpick' and prosecdef) then
    raise exception 'Hàm chọn/bỏ chọn phải chạy bằng quyền chủ hàm';
  end if;
  if has_function_privilege('anon', 'public.vam113_round2_pick(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.vam113_round2_unpick(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam113_round2_pick(uuid, uuid)', 'execute') then
    raise exception 'anon/authenticated gọi được hàm chọn mentee';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('matching_round2_invite') in v_def) = 0 or position(quote_literal('mentee_session_invite') in v_def) = 0 then
    raise exception 'outbound_emails_kind_check thiếu loại thư';
  end if;
  raise notice 'Vòng 2 — link chọn mentee: sẵn sàng (chưa mở cho tới khi BTC đặt giờ mở)';
end $$;
