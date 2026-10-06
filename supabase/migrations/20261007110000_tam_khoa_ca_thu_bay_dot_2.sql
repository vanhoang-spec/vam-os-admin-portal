-- Tạm khoá 14 ca Thứ Bảy 10/10/2026 của đợt 2 (BTC 07/10/2026): chưa chốt được địa
-- điểm nên chưa có số chỗ. Migration 20261007100000 đã tạm đặt 18 chỗ/ca như Thứ
-- Bảy đợt 1 — giữ vậy thì mentee giữ chỗ được ở một ngày chưa có phòng.
--
-- Bỏ số chỗ (seat_limit = null), không đổi trạng thái ca:
--   * trang chọn ca hiện các ca Thứ Bảy là "Chưa mở", không ai giữ chỗ được
--     (vam101/vam102 từ chối ca chưa có số chỗ);
--   * thư mời và thư mở lại đọc ngày từ các ca CÒN ĐẶT ĐƯỢC, nên chỉ ghi Chủ nhật 11/10.
-- Mở lại: BTC điền địa điểm + số chỗ cho các ca Thứ Bảy ở trang Ca phỏng vấn mentee.
--
-- Dán vào Supabase SQL Editor (Production). Mỗi bước là một câu lệnh; chạy lại an toàn.

begin;
set local lock_timeout = '10s';

-- Đã có người giữ chỗ Thứ Bảy thì dừng: bỏ số chỗ dưới chân người đã giữ là để họ
-- cầm một vé của ca "chưa mở". Trường hợp đó BTC đổi ca từng người trước.
do $$
begin
  if exists (
    select 1
    from public.mentee_interview_bookings b
    join public.interview_sessions s on s.id = b.session_id
    where b.status = 'booked'
      and s.starts_at >= '2026-10-10 00:00:00+07:00'
      and s.starts_at < '2026-10-11 00:00:00+07:00'
  ) then
    raise exception 'Đã có người giữ chỗ ca Thứ Bảy 10/10 — không khoá bằng file này; BTC đổi ca từng người trước';
  end if;
end $$;

update public.interview_sessions s
   set seat_limit = null,
       updated_at = now()
  from public.seasons se
 where se.id = s.season_id
   and se.code = 'UEHM-S12'
   and s.starts_at >= '2026-10-10 00:00:00+07:00'
   and s.starts_at < '2026-10-11 00:00:00+07:00'
   and s.seat_limit is not null;

do $$
declare
  v_sat_open integer;
  v_sat_total integer;
  v_sun_open integer;
begin
  select count(*) filter (where seat_limit is not null), count(*)
    into v_sat_open, v_sat_total
    from public.interview_sessions
   where starts_at >= '2026-10-10 00:00:00+07:00' and starts_at < '2026-10-11 00:00:00+07:00';
  select count(*) into v_sun_open
    from public.interview_sessions
   where starts_at >= '2026-10-11 00:00:00+07:00' and starts_at < '2026-10-12 00:00:00+07:00'
     and seat_limit = 28 and status = 'open';
  if v_sat_total <> 14 or v_sat_open <> 0 then
    raise exception 'SELF_CHECK: Thứ Bảy còn % / % ca có số chỗ', v_sat_open, v_sat_total;
  end if;
  if v_sun_open <> 14 then
    raise exception 'SELF_CHECK: Chủ nhật chỉ còn % ca mở 28 chỗ, cần 14', v_sun_open;
  end if;
  raise notice 'Đã tạm khoá 14 ca Thứ Bảy 10/10; Chủ nhật 11/10 vẫn mở 14 ca × 28 chỗ.';
end $$;

commit;
