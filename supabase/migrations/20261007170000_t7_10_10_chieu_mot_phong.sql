-- Chiều Thứ Bảy 10/10/2026 chỉ còn 1 phòng (BTC 07/10/2026).
--
--   - Sáng Thứ Bảy (3 phòng): giữ nguyên.
--   - Chiều Thứ Bảy: chỉ phỏng vấn 13:30–15:00, 3 ca × 10 mentee (tối đa 30).
--   - Các ca từ 15:00 trở đi đóng (BTC đã đóng trên trang Ca lúc 16:16 07/10; file này
--     giữ chúng đóng nếu chạy lại).
--   - 18 bạn đã giữ chỗ ở các ca từ 15:00: huỷ chỗ, đưa vào hàng chờ thư "Mở lại chọn ca"
--     (hạn 17:00 09/10). Đường dẫn cũ của các bạn vẫn chọn được ca khác tới hạn đó.
--
-- Mỗi bước là MỘT câu lệnh (không bảng tạm), chạy lại vô hại:
--   - ca đã 10 chỗ / đã đóng thì không ghi gì;
--   - chỗ đã huỷ không còn 'booked' nên không huỷ lại;
--   - dấu "đã gửi thư mở lại" chỉ bị xoá khi thư cũ gửi TRƯỚC lúc huỷ chỗ — chạy lại sau
--     khi BTC đã gửi thư mới không làm ai nhận thư hai lần.

do $prereq$
begin
  if exists (
    select 1
      from public.interview_sessions s
      join public.seasons se on se.id = s.season_id and se.code = 'UEHM-S12'
     where (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
       and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time in (time '13:30', time '14:00', time '14:30')
       and (select count(*) from public.mentee_interview_bookings b where b.session_id = s.id and b.status = 'booked') > 10
  ) then
    raise exception 'DỪNG: một ca 13:30–14:30 Thứ Bảy đã có hơn 10 bạn giữ chỗ — không hạ xuống 10 được, cần BTC quyết định.';
  end if;
end
$prereq$;

-- 1. Ba ca chiều còn mở: 10 chỗ mỗi ca.
update public.interview_sessions s
   set seat_limit = 10, updated_at = now()
  from public.seasons se
 where se.id = s.season_id and se.code = 'UEHM-S12'
   and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
   and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time in (time '13:30', time '14:00', time '14:30')
   and s.seat_limit is distinct from 10;

-- 2. Từ 15:00 trở đi: đóng.
update public.interview_sessions s
   set status = 'closed', updated_at = now()
  from public.seasons se
 where se.id = s.season_id and se.code = 'UEHM-S12'
   and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
   and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time >= time '15:00'
   and s.status <> 'closed';

-- 3. Huỷ chỗ của người đã giữ các ca vừa đóng (chưa check-in), kèm nhật ký như khi BTC
-- huỷ lịch ở màn hình phỏng vấn. Trạng thái đơn giữ nguyên.
with dong as (
  select b.id as booking_id, b.application_id, b.session_id
    from public.mentee_interview_bookings b
    join public.interview_sessions s on s.id = b.session_id
    join public.seasons se on se.id = b.season_id and se.code = 'UEHM-S12'
    left join public.mentee_interview_operations o on o.id = b.application_id
   where b.status = 'booked'
     and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
     and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time >= time '15:00'
     and o.checked_in_at is null
), huy as (
  update public.mentee_interview_bookings b
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'a3f45586-8747-49d9-860a-4b903cfdc7bc',
         cancel_note = 'Chiều Thứ Bảy 10/10 chỉ còn 1 phòng — đóng các ca từ 15:00, mở lại chọn ca'
    from dong d
   where b.id = d.booking_id and b.status = 'booked'
  returning b.id as booking_id, b.application_id, b.session_id
)
insert into public.mentee_interview_operation_log (application_id, actor_id, action, reason, before_data, after_data)
select h.application_id, 'a3f45586-8747-49d9-860a-4b903cfdc7bc', 'cancel_booking',
       'Chiều Thứ Bảy 10/10 chỉ còn 1 phòng — đóng các ca từ 15:00, mở lại chọn ca',
       jsonb_build_object('booking', jsonb_build_object('id', h.booking_id, 'session_id', h.session_id, 'status', 'booked')),
       jsonb_build_object('booking', jsonb_build_object('id', h.booking_id, 'status', 'cancelled'))
  from huy h;

-- 4. Đưa những bạn vừa bị huỷ chỗ vào hàng chờ thư "Mở lại chọn ca" (hạn 17:00 09/10).
-- Ba bạn từng nhận thư mở lại đợt 2 TRƯỚC khi bị huỷ chỗ: xoá dấu đã gửi để nhận thư mới.
update public.mentee_interview_invites i
   set booking_open_until = '2026-10-09 17:00:00+07:00',
       reopen_notified_at = null
  from public.mentee_interview_bookings b
 where b.application_id = i.application_id
   and b.status = 'cancelled'
   and b.cancel_note = 'Chiều Thứ Bảy 10/10 chỉ còn 1 phòng — đóng các ca từ 15:00, mở lại chọn ca'
   and not exists (
     select 1 from public.mentee_interview_bookings b2
      where b2.application_id = i.application_id and b2.status = 'booked'
   )
   and (
     i.booking_open_until is distinct from '2026-10-09 17:00:00+07:00'::timestamptz
     or (i.reopen_notified_at is not null and i.reopen_notified_at < b.cancelled_at)
   );

do $$
declare
  v_left integer;
  v_seats integer;
  v_queue integer;
  v_cancelled integer;
begin
  select count(*) into v_left
    from public.mentee_interview_bookings b
    join public.interview_sessions s on s.id = b.session_id
    join public.seasons se on se.id = b.season_id and se.code = 'UEHM-S12'
   where b.status = 'booked'
     and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
     and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time >= time '15:00';
  if v_left <> 0 then raise exception 'SELF_CHECK: còn % chỗ ở các ca Thứ Bảy từ 15:00', v_left; end if;

  select count(*) into v_seats
    from public.interview_sessions s
    join public.seasons se on se.id = s.season_id and se.code = 'UEHM-S12'
   where (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-10'
     and (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::time in (time '13:30', time '14:00', time '14:30')
     and s.seat_limit = 10 and s.status = 'open';
  if v_seats <> 3 then raise exception 'SELF_CHECK: ba ca 13:30–14:30 Thứ Bảy chưa đủ 10 chỗ và đang mở (thấy %)', v_seats; end if;

  select count(*) into v_cancelled from public.mentee_interview_bookings
   where status = 'cancelled' and cancel_note = 'Chiều Thứ Bảy 10/10 chỉ còn 1 phòng — đóng các ca từ 15:00, mở lại chọn ca';
  select count(*) into v_queue from public.mentee_interview_invites
   where booking_open_until is not null and reopen_notified_at is null;
  raise notice 'Thứ Bảy 10/10: đã huỷ % chỗ ca từ 15:00; hàng chờ thư "Mở lại chọn ca" hiện có % bạn', v_cancelled, v_queue;
end $$;
