-- ═══════════════════════════════════════════════════════════════════════════
-- Một người được đăng ký CẢ HAI buổi của một chuỗi
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Chủ dự án chốt 16/09/2026: với link đăng ký của chuỗi sự kiện, sinh viên được
-- đăng ký cả hai buổi, và nộp lại cho cùng một buổi thì bản mới ghi đè bản cũ.
--
-- Ràng buộc `event_registrations_series_lower_email_active_uidx` (tạo ở
-- 20260910200000_series_registration_link.sql) nói điều ngược lại: một email chỉ
-- giữ được một chỗ trong cả chuỗi. Nó chính là thứ chặn buổi thứ hai, nên bỏ.
--
-- GIỮ LẠI: `event_registrations_event_lower_email_active_uidx` — một email một
-- chỗ trong MỘT BUỔI. Đó vẫn là điều đúng, và là cái chặn hai lần bấm gửi gần
-- nhau tạo ra hai dòng; đường ghi đọc lỗi 23505 của nó rồi chuyển sang cập nhật
-- đúng dòng đã có (xem lib/events.ts, registerForEvent).
--
-- Không đụng tới một dòng dữ liệu nào: bỏ một chỉ số không xoá đăng ký nào cả.
-- Chạy lại vô hại.
--
-- LÙI LẠI NẾU CẦN (chỉ được khi chưa ai đăng ký hai buổi, nếu không sẽ lỗi trùng):
--   create unique index event_registrations_series_lower_email_active_uidx
--     on public.event_registrations (series_id, lower(email))
--     where series_id is not null and registration_status <> 'cancelled';
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.event_registrations';
  end if;
end;
$preflight$;

drop index if exists public.event_registrations_series_lower_email_active_uidx;

do $self_check$
declare
  v_event_idx text;
begin
  if to_regclass('public.event_registrations_series_lower_email_active_uidx') is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: ràng buộc một-email-một-chuỗi vẫn còn';
  end if;

  -- Ràng buộc theo từng buổi phải còn nguyên: bỏ nhầm nó là mở đường cho hai
  -- dòng trùng nhau của cùng một người trong cùng một buổi.
  select pg_get_indexdef(to_regclass('public.event_registrations_event_lower_email_active_uidx'))
    into v_event_idx;

  if v_event_idx is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc một-email-một-buổi';
  end if;
  if position('lower(email)' in v_event_idx) = 0 or position('event_id' in v_event_idx) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: ràng buộc một-email-một-buổi có dạng lạ: %', v_event_idx;
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
