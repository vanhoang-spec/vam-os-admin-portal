-- ============================================================
-- 20261002230000_mentee_mo_lai_chon_ca.sql
-- ============================================================
--
-- MỞ LẠI CHỌN CA cho mentee CHƯA chọn ca trước hạn 17:00 02/10/2026 (BTC
-- 02/10/2026 tối: 72 bạn). Hạn mới: 20:00 ngày 03/10/2026, chỉ cho những bạn đó.
--
-- Vì sao không sửa booking_closes_at của ca: cột đó là hạn CHUNG — nới nó là mở
-- lại cho cả 404 bạn đã chọn tự đổi ca qua đêm trước ngày phỏng vấn. Hạn riêng
-- nằm trên dòng thư mời của từng người (mentee_interview_invites), nên chỉ đúng
-- người được mở lại mới đặt/đổi được.
--
--   1. Cột mới: booking_open_until (hạn riêng) + reopen_notified_at (đã gửi thư
--      báo mở lại — để nút gửi thư không gửi trùng).
--   2. Đặt hạn riêng cho mọi mentee Mùa 12 đã nhận thư mời mà chưa có ca.
--   3. vam101 (đặt ca) + vam102 (tự đổi ca): CHÉP NGUYÊN VĂN bản đang chạy, chỉ đổi
--      phép so hạn thành GREATEST(hạn của ca, hạn riêng). Mọi chặn khác giữ nguyên:
--      hồ sơ đủ điều kiện, ca mở, chưa bắt đầu, còn chỗ (khoá dòng ca rồi mới đếm).
--   4. Tự kiểm.
--
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge PR: mã mới đọc cột
-- booking_open_until — merge trước thì trang chọn ca của MỌI mentee báo lỗi.

begin;

-- ------------------------------------------------------------
-- 1. Cột
-- ------------------------------------------------------------
-- Bảng đã bật RLS và thu hồi anon/authenticated từ 20260924190000; quyền
-- select/insert/update của service_role ở mức bảng nên phủ luôn hai cột mới.
alter table public.mentee_interview_invites
  add column if not exists booking_open_until timestamptz,
  add column if not exists reopen_notified_at timestamptz;

-- ------------------------------------------------------------
-- 2. Ai được mở lại
-- ------------------------------------------------------------
-- Đúng những người vam101 vẫn coi là đủ điều kiện đặt ca, đã nhận thư mời, và
-- KHÔNG có ca nào đang giữ. Người đã chọn ca không được chạm tới.
update public.mentee_interview_invites i
   set booking_open_until = timestamptz '2026-10-03 20:00:00+07'
  from public.applications a
 where a.id = i.application_id
   and a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
   and lower(coalesce(a.role_applied::text, '')) = 'mentee'
   and coalesce(a.source, '') = 'vam_os_form'
   and a.status in ('screening_passed', 'invited_to_interview', 'interview_scheduled')
   and i.first_sent_at is not null
   and not exists (
     select 1 from public.mentee_interview_bookings b
      where b.application_id = a.id and b.status = 'booked'
   );

-- ------------------------------------------------------------
-- 3. Đặt ca / tự đổi ca theo hạn riêng
-- ------------------------------------------------------------
create or replace function public.vam101_book_mentee_session(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_app_id     uuid;
  v_app        public.applications%rowtype;
  v_session    public.interview_sessions%rowtype;
  v_taken      integer;
  v_booking_id uuid;
  -- Hạn riêng của người được BTC mở lại chọn ca (NULL = theo hạn chung của ca).
  v_open_until timestamptz;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id, i.booking_open_until into v_app_id, v_open_until
  from public.mentee_interview_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Khoá dòng đơn TRƯỚC mọi phép kiểm: hai tab của cùng một ứng viên bấm hai ca
  -- khác nhau sẽ nối đuôi ở đây, tab sau thấy 'already_booked'.
  select a.* into v_app from public.applications a where a.id = v_app_id for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Luật đối tượng: đơn mentee nộp qua form, ĐÃ QUA vòng hồ sơ. Ba trạng thái
  -- này khớp từng chữ với BOOKING_ELIGIBLE_STATUSES ở tầng TypeScript.
  if lower(coalesce(v_app.role_applied::text, '')) <> 'mentee'
     or coalesce(v_app.source, '') <> 'vam_os_form'
     or v_app.status not in (
       'screening_passed', 'invited_to_interview', 'interview_scheduled'
     ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if exists (
    select 1 from public.mentee_interview_bookings b
    where b.application_id = v_app_id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_booked');
  end if;

  -- Khoá dòng ca rồi mới đếm. Đếm trước khi khoá là đúng cái lỗi khiến ca vượt
  -- ghế: hai người cùng đọc "còn 1 chỗ" rồi cùng ghi.
  select se.* into v_session
  from public.interview_sessions se
  where se.id = p_session_id and se.season_id = v_app.season_id
  for update;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_found');
  end if;

  -- Hạn riêng chỉ NỚI hạn chung, không bao giờ siết: GREATEST bỏ qua NULL, nên
  -- người không được mở lại vẫn theo đúng booking_closes_at của ca.
  if now() > greatest(v_session.booking_closes_at, v_open_until) then
    return jsonb_build_object('ok', false, 'code', 'deadline_passed');
  end if;

  if v_session.status <> 'open' or v_session.seat_limit is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_open');
  end if;

  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'session_in_past');
  end if;

  select count(*) into v_taken
  from public.mentee_interview_bookings b
  where b.session_id = v_session.id and b.status = 'booked';

  if v_taken >= v_session.seat_limit then
    return jsonb_build_object('ok', false, 'code', 'session_full');
  end if;

  insert into public.mentee_interview_bookings (
    session_id, application_id, season_id, previous_application_status
  ) values (
    v_session.id, v_app_id, v_app.season_id, v_app.status
  )
  returning id into v_booking_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app_id, null, 'Hệ thống đặt ca phỏng vấn mentee', 'interview_scheduled',
    v_app.status, 'interview_scheduled',
    'Ứng viên tự chọn ca qua link cá nhân — '
      || to_char(v_session.starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'session_id', v_session.id,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'venue', v_session.venue,
    'previous_status', v_app.status,
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

alter function public.vam101_book_mentee_session(uuid, uuid) owner to postgres;
revoke all on function public.vam101_book_mentee_session(uuid, uuid) from public;
revoke all on function public.vam101_book_mentee_session(uuid, uuid) from anon, authenticated;
grant execute on function public.vam101_book_mentee_session(uuid, uuid) to service_role;

create or replace function public.vam102_change_mentee_session(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_app_id     uuid;
  v_app        public.applications%rowtype;
  v_cu         public.mentee_interview_bookings%rowtype;
  v_moi        public.interview_sessions%rowtype;
  v_ca_cu      public.interview_sessions%rowtype;
  v_taken      integer;
  v_booking_id uuid;
  -- Hạn riêng của người được BTC mở lại chọn ca (NULL = theo hạn chung của ca).
  v_open_until timestamptz;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id, i.booking_open_until into v_app_id, v_open_until
  from public.mentee_interview_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Khoá dòng đơn trước: hai tab của cùng một ứng viên bấm hai ca khác nhau sẽ
  -- nối đuôi ở đây thay vì cùng nhả chỗ cũ.
  select a.* into v_app from public.applications a where a.id = v_app_id for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select b.* into v_cu
  from public.mentee_interview_bookings b
  where b.application_id = v_app_id and b.status = 'booked';
  if v_cu.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_booking');
  end if;

  if v_cu.session_id = p_session_id then
    return jsonb_build_object('ok', false, 'code', 'same_session');
  end if;

  -- Ca MỚI được khoá; ca cũ thì không cần — xem đầu file.
  select se.* into v_moi
  from public.interview_sessions se
  where se.id = p_session_id and se.season_id = v_app.season_id
  for update;
  if v_moi.id is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_found');
  end if;

  -- Hạn riêng chỉ NỚI hạn chung, không bao giờ siết: GREATEST bỏ qua NULL, nên
  -- người không được mở lại vẫn theo đúng booking_closes_at của ca.
  if now() > greatest(v_moi.booking_closes_at, v_open_until) then
    return jsonb_build_object('ok', false, 'code', 'deadline_passed');
  end if;

  if v_moi.status <> 'open' or v_moi.seat_limit is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_open');
  end if;

  if v_moi.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'session_in_past');
  end if;

  select count(*) into v_taken
  from public.mentee_interview_bookings b
  where b.session_id = v_moi.id and b.status = 'booked';

  -- Ca mới đầy thì DỪNG TẠI ĐÂY, chỗ cũ chưa hề bị chạm tới.
  if v_taken >= v_moi.seat_limit then
    return jsonb_build_object('ok', false, 'code', 'session_full');
  end if;

  -- Nhả chỗ cũ rồi ghi chỗ mới, trong cùng một transaction. Chỉ số bộ phận
  -- mentee_interview_bookings_active_uidx đòi đúng thứ tự này: một ứng viên
  -- không được có hai dòng 'booked' dù chỉ trong một câu lệnh.
  update public.mentee_interview_bookings
     set status = 'cancelled', cancelled_at = now()
   where id = v_cu.id;

  insert into public.mentee_interview_bookings (
    session_id, application_id, season_id, previous_application_status
  ) values (
    v_moi.id, v_app_id, v_app.season_id, v_cu.previous_application_status
  )
  returning id into v_booking_id;

  select se.* into v_ca_cu from public.interview_sessions se where se.id = v_cu.session_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app_id, null, 'Hệ thống đặt ca phỏng vấn mentee', 'interview_scheduled',
    v_app.status, v_app.status,
    'Ứng viên tự đổi ca qua link cá nhân: '
      || coalesce(to_char(v_ca_cu.starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), '?')
      || ' → '
      || to_char(v_moi.starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'session_id', v_moi.id,
    'starts_at', v_moi.starts_at,
    'ends_at', v_moi.ends_at,
    'venue', v_moi.venue,
    'previous_session_starts_at', v_ca_cu.starts_at,
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

alter function public.vam102_change_mentee_session(uuid, uuid) owner to postgres;
revoke all on function public.vam102_change_mentee_session(uuid, uuid) from public;
revoke all on function public.vam102_change_mentee_session(uuid, uuid) from anon, authenticated;
grant execute on function public.vam102_change_mentee_session(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 4. Tự kiểm — sai một điều là huỷ cả transaction
-- ------------------------------------------------------------
do $mo_lai_self_check$
declare
  v_fn text;
  v_src text;
  v_definer boolean;
  v_n integer;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'mentee_interview_invites'
         and column_name in ('booking_open_until', 'reopen_notified_at')) <> 2 then
    raise exception 'Tự kiểm: thiếu cột booking_open_until / reopen_notified_at';
  end if;

  foreach v_fn in array array['vam101_book_mentee_session', 'vam102_change_mentee_session'] loop
    select p.prosrc, p.prosecdef into v_src, v_definer
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_src is null or position('booking_open_until' in v_src) = 0 or position('greatest(' in v_src) = 0 then
      raise exception 'Tự kiểm: % chưa xét hạn riêng', v_fn;
    end if;
    if not v_definer then raise exception 'Tự kiểm: % mất security definer', v_fn; end if;
    if has_function_privilege('anon', 'public.' || v_fn || '(uuid, uuid)', 'execute')
       or has_function_privilege('authenticated', 'public.' || v_fn || '(uuid, uuid)', 'execute') then
      raise exception 'Tự kiểm: anon/authenticated gọi được %', v_fn;
    end if;
  end loop;

  if exists (select 1 from public.mentee_interview_invites i
              join public.mentee_interview_bookings b on b.application_id = i.application_id and b.status = 'booked'
             where i.booking_open_until is not null) then
    raise exception 'Tự kiểm: có người ĐÃ có ca mà vẫn được mở lại';
  end if;

  -- Chỉ trên database có Mùa 12 thật: không mở lại cho ai là điều kiện chọn người sai.
  if exists (select 1 from public.seasons where id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1') then
    select count(*) into v_n from public.mentee_interview_invites
     where booking_open_until = timestamptz '2026-10-03 20:00:00+07';
    if v_n = 0 then raise exception 'Tự kiểm: không mở lại cho ai — kiểm lại điều kiện chọn người'; end if;
    raise notice 'Đã mở lại chọn ca cho % bạn, hạn 20:00 ngày 03/10/2026', v_n;
  end if;
end
$mo_lai_self_check$;

commit;
