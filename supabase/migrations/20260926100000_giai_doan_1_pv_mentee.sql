-- ═══════════════════════════════════════════════════════════════════════════
-- Giai đoạn 1 phỏng vấn mentee, 03–04/10/2026: 24 ca 30 phút, 25 ghế mỗi ca.
--
-- Chủ dự án chốt 26/09/2026:
--   - Mỗi ngày 5 phòng, mỗi phòng tối đa 5 mentor phỏng vấn song song (1:1)
--     → 25 bàn cùng lúc.
--   - Một buổi cho một mentee tối đa 30 phút.
--   - Chia thành CA 30 PHÚT, mỗi ca 25 ghế: mỗi bạn có đúng một giờ vào,
--     không ai phải chờ tại chỗ, phòng không bao giờ quá 25 mentee cùng lúc.
--   - Giữ gói Brevo miễn phí (300 thư/ngày) và LÙI HẠN ĐẶT CA để thư mời
--     kịp đi hết.
--
-- Sức chứa: 2 ngày × 12 ca × 25 ghế = 600 chỗ, cho 334 mentee được người
-- chấm đề xuất mời phỏng vấn.
--
-- Giai đoạn 2 (10–11/10) cho những bạn đang chờ chấm sẽ là một migration
-- khác; file này chỉ chạm hai ngày 03–04/10.
--
-- Kèm theo: nới outbound_emails_kind_check theo lối cộng thêm —
--   + 'mentee_session_invite'     (thư mời kèm link đặt ca)
--   + 'mentee_session_confirmed'  (thư xác nhận ca đã đặt hoặc đổi)
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $gd1_prereq$
begin
  if to_regclass('public.interview_sessions') is null then
    raise exception 'PREREQ_MISSING: cần bảng interview_sessions (dán migration 20260924190000 trước)';
  end if;
  if to_regclass('public.mentee_interview_bookings') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_bookings (dán migration 20260924190000 trước)';
  end if;
  if not exists (select 1 from public.seasons where code = 'UEHM-S12') then
    raise exception 'PREREQ_MISSING: không có mùa UEHM-S12';
  end if;
end;
$gd1_prereq$;

-- ------------------------------------------------------------
-- 1. Chặn cứng: KHÔNG định hình lại một ca đã có người giữ chỗ
-- ------------------------------------------------------------
-- Đổi 08:00–09:00 thành 08:00–08:30 dưới chân một người đã đặt ca đó là nói
-- với họ một giờ khác với giờ họ đã chọn — và họ sẽ đến sai giờ. Trang đặt ca
-- chưa từng mở, nên hôm nay con số này là 0; phép kiểm ở đây để lần chạy lại
-- sau khi trang đã mở không âm thầm làm việc đó.
do $gd1_no_bookings$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.mentee_interview_bookings b
  join public.interview_sessions s on s.id = b.session_id
  join public.seasons se on se.id = s.season_id
  where se.code = 'UEHM-S12' and b.status = 'booked';

  if v_count > 0 then
    raise exception 'DA_CO_NGUOI_DAT: % chỗ đã được giữ — không định hình lại ca. Dừng lại và hỏi trước.', v_count;
  end if;
end;
$gd1_no_bookings$;

-- ------------------------------------------------------------
-- 2. 24 ca 30 phút, 25 ghế, hạn đặt mới
-- ------------------------------------------------------------
-- Lưới viết TƯỜNG MINH chứ không suy từ 12 ca cũ: đọc file là thấy ngay đủ
-- 24 mốc, và chạy lại không bao giờ sinh thêm ca 11:00 hay 17:00 từ một
-- phép cộng lặp.
--
-- Giờ dựng bằng chuỗi có '+07:00': database chạy UTC, và một ca "08:00" dựng
-- theo múi giờ phiên sẽ lệch bảy tiếng mà không ai thấy cho tới khi ứng viên
-- tới sai giờ.
--
-- HẠN ĐẶT CA: 23:59 thứ Tư 30/09/2026. Lùi từ 28/09 để bộ gửi thư mời kịp
-- đi hết 334 thư với trần 300 thư/ngày, và để ban tổ chức còn trọn hai ngày
-- 01–02/10 chốt người phỏng vấn cho từng ca. Muốn đổi hạn, sửa đúng MỘT chuỗi
-- ở câu insert dưới đây trước khi dán.
--
-- `on conflict ... do update`: 12 ca :00 đã có sẵn được đổi giờ kết thúc về
-- :30; 12 ca :30 được thêm mới. Ghi đè seat_limit của 12 ca cũ là có chủ ý —
-- chúng đang NULL (đóng), chưa ai điền.
insert into public.interview_sessions (season_id, starts_at, ends_at, seat_limit, booking_closes_at, status)
select s.id,
       (d.ngay || ' ' || t.gio || '+07:00')::timestamptz,
       (d.ngay || ' ' || t.gio || '+07:00')::timestamptz + interval '30 minutes',
       25,
       '2026-09-30 23:59:59+07:00'::timestamptz,
       'open'
from public.seasons s
cross join (values ('2026-10-03'), ('2026-10-04')) as d(ngay)
cross join (values
  ('08:00:00'), ('08:30:00'), ('09:00:00'), ('09:30:00'), ('10:00:00'), ('10:30:00'),
  ('14:00:00'), ('14:30:00'), ('15:00:00'), ('15:30:00'), ('16:00:00'), ('16:30:00')
) as t(gio)
where s.code = 'UEHM-S12'
on conflict (season_id, starts_at) do update
  set ends_at           = excluded.ends_at,
      seat_limit        = excluded.seat_limit,
      booking_closes_at = excluded.booking_closes_at,
      status            = excluded.status,
      updated_at        = now();

-- ------------------------------------------------------------
-- 3. Nới loại thư theo lối cộng thêm
-- ------------------------------------------------------------
-- Nối vào đuôi mảng, không viết đè cả danh sách: viết đè nghĩa là mỗi lần
-- thêm một loại lại phải chép đúng toàn bộ loại đã có, và chép thiếu một loại
-- thì những dòng loại đó lặng lẽ ngừng ghi được.
do $gd1_kind_invite$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('mentee_session_invite') in v_existing) > 0 then
    return;
  end if;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''mentee_session_invite''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$gd1_kind_invite$;

do $gd1_kind_confirmed$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('mentee_session_confirmed') in v_existing) > 0 then
    return;
  end if;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''mentee_session_confirmed''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$gd1_kind_confirmed$;

-- ------------------------------------------------------------
-- 4. Tự kiểm
-- ------------------------------------------------------------
-- Migration báo thành công trong khi lưới ca sai là thứ chỉ lộ ra vào sáng
-- 03/10, khi 25 bạn đứng trước một phòng chỉ có chỗ cho 12.
do $gd1_selfcheck$
declare
  v_total      integer;
  v_wrong_span integer;
  v_wrong_seat integer;
  v_wrong_han  integer;
  v_day3       integer;
  v_day4       integer;
  v_other      integer;
  v_kinds      text;
begin
  select count(*),
         count(*) filter (where ends_at - starts_at <> interval '30 minutes'),
         count(*) filter (where seat_limit is distinct from 25),
         count(*) filter (where booking_closes_at <> '2026-09-30 23:59:59+07:00'::timestamptz),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-03'),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-04'),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date not in (date '2026-10-03', date '2026-10-04'))
    into v_total, v_wrong_span, v_wrong_seat, v_wrong_han, v_day3, v_day4, v_other
  from public.interview_sessions s
  join public.seasons se on se.id = s.season_id
  where se.code = 'UEHM-S12';

  if v_total <> 24 then
    raise exception 'SELFCHECK: cần đúng 24 ca, đang có %', v_total;
  end if;
  if v_wrong_span > 0 then
    raise exception 'SELFCHECK: % ca không dài đúng 30 phút', v_wrong_span;
  end if;
  if v_wrong_seat > 0 then
    raise exception 'SELFCHECK: % ca không có đúng 25 ghế', v_wrong_seat;
  end if;
  if v_wrong_han > 0 then
    raise exception 'SELFCHECK: % ca có hạn đặt khác 30/09 23:59', v_wrong_han;
  end if;
  if v_day3 <> 12 or v_day4 <> 12 or v_other <> 0 then
    raise exception 'SELFCHECK: phải 12 ca mỗi ngày 03 và 04/10, đang là % / % / % ngày khác', v_day3, v_day4, v_other;
  end if;

  select pg_get_constraintdef(c.oid) into v_kinds
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('mentee_session_invite') in v_kinds) = 0
     or position(quote_literal('mentee_session_confirmed') in v_kinds) = 0 then
    raise exception 'SELFCHECK: outbound_emails_kind_check chưa có đủ hai loại thư mới';
  end if;
  -- Loại cũ không được rơi mất khi dựng lại ràng buộc.
  if position(quote_literal('interview_slot_invite') in v_kinds) = 0
     or position(quote_literal('mentee_application_confirmation') in v_kinds) = 0 then
    raise exception 'SELFCHECK: dựng lại outbound_emails_kind_check làm rơi mất loại thư cũ';
  end if;
end;
$gd1_selfcheck$;

commit;
