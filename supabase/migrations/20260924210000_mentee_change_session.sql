-- ═══════════════════════════════════════════════════════════════════════════
-- Đổi ca phỏng vấn mentee — chuyển chỗ nguyên tử, không bao giờ mất chỗ cũ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Trang đặt ca (migration 20260924190000) cho ứng viên chọn một ca. Bấm nhầm
-- thì hiện phải nhờ ban tổ chức. Với ~500 người chọn trong bốn ngày, việc đó
-- sẽ xảy ra đủ nhiều để ngốn hết thời gian của người trực.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO LÀ MỘT HÀM ĐỔI, KHÔNG PHẢI "HUỶ RỒI ĐẶT LẠI"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Huỷ rồi đặt lại là hai transaction. Giữa hai bước đó, chỗ cũ đã nhả ra còn
-- chỗ mới thì chưa chắc có — một người khác lấy mất chỗ cuối của ca mới trong
-- đúng khoảnh khắc ấy là ứng viên mất cả hai, vì một cú bấm mà họ tưởng chỉ là
-- đổi giờ cho tiện.
--
-- Hàm này giữ nguyên chỗ cũ cho tới khi chắc chắn ca mới còn chỗ. Ca mới đầy
-- thì trả 'session_full' và ứng viên vẫn còn nguyên chỗ cũ.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO KHÔNG CÓ NÚT "HUỶ" TRƠN CHO ỨNG VIÊN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Thư báo kết quả đã tuyên: không đăng ký đúng hạn thì coi như không tiếp tục.
-- Một nút huỷ không kèm đặt lại là một cái bẫy — ứng viên bỏ chỗ định chọn lại
-- sau, rồi quên, rồi bị loại vì một luật họ đọc lướt từ tuần trước.
--
-- Ai thật sự không dự được ngày nào thì đó là quyết định về HỒ SƠ của họ, không
-- phải về một cái ghế, và nó phải đi qua ban tổ chức. Trang đã nói sẵn số Zalo.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THỨ TỰ KHOÁ
-- ═══════════════════════════════════════════════════════════════════════════
--
--   applications → interview_sessions (ca MỚI) → mentee_interview_bookings
--
-- Cùng chiều với vam101, nên hai hàm không tạo được vòng chờ. Ca CŨ không cần
-- khoá: hàm chỉ đổi dòng booking của chính ứng viên này, và số chỗ của ca cũ là
-- một phép đếm suy ra, không phải một giá trị lưu sẵn.
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $change_session_prereq$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'interview_sessions') then
    raise exception 'PREREQ_MISSING: chưa có bảng interview_sessions — dán 20260924190000 trước';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'mentee_interview_bookings') then
    raise exception 'PREREQ_MISSING: chưa có bảng mentee_interview_bookings — dán 20260924190000 trước';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam101_book_mentee_session') then
    raise exception 'PREREQ_MISSING: chưa có vam101_book_mentee_session — dán 20260924190000 trước';
  end if;
end
$change_session_prereq$;

-- ------------------------------------------------------------
-- 1. Đổi ca
-- ------------------------------------------------------------
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
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id into v_app_id
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

  if now() > v_moi.booking_closes_at then
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

-- ------------------------------------------------------------
-- 2. Chủ sở hữu và quyền gọi
-- ------------------------------------------------------------
alter function public.vam102_change_mentee_session(uuid, uuid) owner to postgres;
revoke all on function public.vam102_change_mentee_session(uuid, uuid) from public;
revoke all on function public.vam102_change_mentee_session(uuid, uuid) from anon, authenticated;
grant execute on function public.vam102_change_mentee_session(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 3. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $change_session_self_check$
declare
  v_fn  text;
  v_acl text;
  v_huy integer;
  v_ghi integer;
begin
  select prosrc into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam102_change_mentee_session';
  if v_fn is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất hàm vam102_change_mentee_session';
  end if;

  if position('vam063_trusted_api_role' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca mất cổng ngữ cảnh máy chủ';
  end if;
  if position('vam084_operator_for_season(' in v_fn) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca gọi vam084_operator_for_season trong security definer';
  end if;
  if position('for update' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca mất khoá hàng';
  end if;
  if position('v_moi.seat_limit is null' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca không còn coi ghế chưa cấu hình là đóng';
  end if;

  -- Điều quan trọng nhất của hàm này: phép đếm ghế của ca MỚI phải đứng TRƯỚC
  -- câu nhả chỗ cũ. Đảo hai câu này là ứng viên mất chỗ khi ca mới đã đầy.
  v_ghi := position('set status = ''cancelled''' in v_fn);
  v_huy := position('if v_taken >= v_moi.seat_limit' in v_fn);
  if v_huy = 0 or v_ghi = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca thiếu phép kiểm đầy chỗ hoặc phép nhả chỗ cũ';
  end if;
  if v_huy > v_ghi then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca nhả chỗ cũ TRƯỚC khi biết ca mới còn chỗ';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam102_change_mentee_session' and p.prosecdef
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam102_change_mentee_session phải là security definer';
  end if;

  select array_to_string(p.proacl, ' ') into v_acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam102_change_mentee_session';
  if v_acl is not null and (position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi ca còn cấp quyền gọi cho anon/authenticated';
  end if;
end
$change_session_self_check$;

notify pgrst, 'reload schema';

commit;
