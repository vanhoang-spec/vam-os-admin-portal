-- ============================================================
-- Mã ngắn 4 ký tự — đường lùi khi máy quét chịu thua
-- ============================================================
--
-- Mã QR giải quyết 99% các lần check-in. Còn lại là màn hình vỡ, độ sáng quá
-- thấp, camera hỏng, điện thoại hết pin, hoặc người tham dự chỉ có tấm vé in
-- ra giấy đã nhàu. Ở cửa, giữa một hàng người, cần một thứ gõ được trong ba
-- giây.
--
-- Mã đầy đủ dài 10 ký tự — gõ được nhưng chậm. Mã ngắn 4 ký tự là đường lùi
-- thật sự nhanh.
--
-- ------------------------------------------------------------
-- VÌ SAO 4 KÝ TỰ LÀ AN TOÀN Ở ĐÂY, VÀ CHỈ Ở ĐÂY
-- ------------------------------------------------------------
-- 4 ký tự trên bảng 31 ký tự là khoảng 923 nghìn tổ hợp. Với 200 người đăng
-- ký, đoán mò một mã bất kỳ trúng khoảng 1/4.600 — tức là đoán được.
--
-- Nên mã này KHÔNG BAO GIỜ được nhận qua một đường công khai. Nó chỉ dùng ở ô
-- gõ tay của máy quét: một trang đã đăng nhập, do người hỗ trợ được ghép vào
-- đúng buổi đó mở, với người tham dự đang đứng trước mặt và tên hiện lên màn
-- hình ngay sau khi gõ. Gõ trúng mã của người khác thì người đứng quét thấy
-- ngay một cái tên lạ.
--
-- Đường công khai — trang vé `/ve/<mã>` — vẫn chỉ nhận mã 10 ký tự.
--
-- ------------------------------------------------------------
-- DUY NHẤT TRONG TỪNG SỰ KIỆN, KHÔNG PHẢI TOÀN HỆ THỐNG
-- ------------------------------------------------------------
-- Người đứng quét luôn biết mình đang ở buổi nào, nên tra "mã ngắn này trong
-- buổi này" là đủ. Bắt 4 ký tự duy nhất trên toàn hệ thống thì sau vài nghìn
-- đăng ký sẽ không sinh nổi mã mới.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $short_code_prereq$
begin
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần public.event_registrations';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_registrations'
      and column_name = 'checkin_code'
  ) then
    raise exception 'PREREQ_MISSING: cần event_registrations.checkin_code (migration 20260910160000)';
  end if;
end;
$short_code_prereq$;

alter table public.event_registrations
  add column if not exists short_code text;

comment on column public.event_registrations.short_code is
  'Mã 4 ký tự gõ tay khi máy quét chịu thua. CHỈ nhận ở ô gõ tay của máy quét (trang đã đăng nhập, có người hỗ trợ đứng đối chiếu tên) — không bao giờ nhận qua đường công khai, vì 4 ký tự là đoán được. Duy nhất trong từng sự kiện, không phải toàn hệ thống.';

-- Duy nhất trong từng sự kiện. Partial index vì các đăng ký có trước tính năng
-- này chưa có mã.
create unique index if not exists event_registrations_event_short_code_uidx
  on public.event_registrations (event_id, short_code)
  where short_code is not null;

do $short_code_shape$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_registrations'::regclass
      and conname = 'event_registrations_short_code_check'
  ) then
    -- Đúng bốn ký tự, đúng bảng chữ cái không nhầm được bằng mắt: không có
    -- 0/O/1/I/L, vì mã này sinh ra để GÕ TAY và một mã mà `0` với `O` phân
    -- biệt bằng phông chữ là một mã sẽ bị gõ sai.
    alter table public.event_registrations
      add constraint event_registrations_short_code_check
      check (short_code is null or short_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');
  end if;
end;
$short_code_shape$;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $short_code_contract$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_registrations'
      and column_name = 'short_code'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu event_registrations.short_code';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_registrations_event_short_code_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mã ngắn chưa được ràng buộc duy nhất theo sự kiện';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_registrations'::regclass
      and conname = 'event_registrations_short_code_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc hình dạng mã ngắn';
  end if;

  -- Mã đầy đủ vẫn phải duy nhất TOÀN HỆ THỐNG: máy quét đọc được mã trước khi
  -- biết nó thuộc sự kiện nào. Hai ràng buộc có phạm vi khác nhau, và đổi nhầm
  -- phạm vi của cái nào cũng hỏng.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_registrations_checkin_code_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: ràng buộc duy nhất của mã đầy đủ đã biến mất';
  end if;
end;
$short_code_contract$;

notify pgrst, 'reload schema';

commit;
