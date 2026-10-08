-- =============================================================================
-- Chiều Thứ Bảy 10/10: PHỎNG VẤN ONLINE — ghi vào địa điểm của 7 ca (BTC 08/10/2026)
-- =============================================================================
-- BTC chuyển chiều Thứ Bảy 10/10 (7 ca 13:30–17:00) sang phỏng vấn online. Mentee
-- đã giữ chỗ các ca này (78 bạn lúc soạn) chưa được báo: các ca chưa có địa điểm,
-- nên trang chọn ca của các bạn đang ghi "Địa điểm đang được ban tổ chức hoàn tất".
--
-- Ghi địa điểm là đủ để trang của mentee tự hiện, và thư "xác nhận ca" gửi khi
-- đặt/đổi ca sau lúc này cũng mang câu này. Mentee vào nhóm Zalo; Support Team
-- điều phối theo ca; mentor đang trống gửi link phòng online cho mentee.
--
-- Không đụng tới phòng/bàn: địa điểm không bắt đầu bằng "Phòng …" thì trigger
-- vam104_room_desk_bounds_guard dùng mặc định 6 phòng — y như khi địa điểm còn
-- trống. Thư xác nhận của MENTOR dùng hướng dẫn riêng (MENTOR_BLOCK_GUIDES), không
-- đọc câu này.
--
-- Chỉ ghi vào ca còn trống địa điểm hoặc đã mang đúng câu này: BTC đã tự điền một
-- địa điểm khác thì KHÔNG ghi đè. Chạy lại vô hại.
-- =============================================================================

with target as (
  select s.id
  from public.interview_sessions s
  where s.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and s.starts_at >= '2026-10-10 13:30:00+07'
    and s.starts_at <  '2026-10-10 17:00:00+07'
    and (s.venue is null or btrim(s.venue) = '' or s.venue like 'PHỎNG VẤN ONLINE%')
),
updated as (
  update public.interview_sessions s
     set venue = 'PHỎNG VẤN ONLINE — Bạn tham gia nhóm Zalo https://zalo.me/g/i2ppr7x3cj6kxchwtj16 trước giờ ca. Support Team điều phối theo ca; tới lượt, mentor sẽ gửi link phòng phỏng vấn online cho bạn.'
    from target t
   where s.id = t.id
  returning s.id, s.starts_at
)
select count(*) as so_ca_da_ghi,
       string_agg(to_char(starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), ', ' order by starts_at) as cac_ca
from updated;

-- Tự kiểm: đủ 7 ca chiều Thứ Bảy mang câu online; báo ca nào còn địa điểm khác.
do $t7_online$
declare
  v_online int;
  v_other text;
  v_booked int;
begin
  select count(*) into v_online
  from public.interview_sessions s
  where s.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and s.starts_at >= '2026-10-10 13:30:00+07' and s.starts_at < '2026-10-10 17:00:00+07'
    and s.venue like 'PHỎNG VẤN ONLINE%';

  select string_agg(to_char(s.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ': ' || left(s.venue, 40), '; ')
    into v_other
  from public.interview_sessions s
  where s.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and s.starts_at >= '2026-10-10 13:30:00+07' and s.starts_at < '2026-10-10 17:00:00+07'
    and coalesce(s.venue, '') not like 'PHỎNG VẤN ONLINE%';

  select count(*) into v_booked
  from public.mentee_interview_bookings b
  join public.interview_sessions s on s.id = b.session_id
  where b.status = 'booked'
    and s.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and s.starts_at >= '2026-10-10 13:30:00+07' and s.starts_at < '2026-10-10 17:00:00+07';

  if v_other is not null then
    raise notice 'Các ca này đã có địa điểm khác nên KHÔNG ghi đè: %', v_other;
  end if;
  raise notice '% ca chiều Thứ Bảy đang là phỏng vấn online; % mentee đang giữ chỗ các ca này.', v_online, v_booked;
end
$t7_online$;
