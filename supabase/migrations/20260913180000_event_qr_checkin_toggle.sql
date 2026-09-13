-- ═══════════════════════════════════════════════════════════════════════════
-- Mã QR check-in thành tuỳ chọn của từng sự kiện
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tới trước migration này, MỌI lượt đăng ký đều được cấp một mã điểm danh cá
-- nhân, và thư xác nhận luôn đính kèm ảnh QR, đường dẫn vé và mã dự phòng.
--
-- Không phải buổi nào cũng cần thế. Một buổi nhỏ trong phòng họp, BTC điểm danh
-- theo danh sách, thì tấm vé QR chỉ làm người nhận tưởng phải mang theo một thứ
-- mà không ai ở cửa quét — và làm lá thư dài gấp đôi chỗ cần.
--
-- Cột mới `qr_checkin_enabled` để BTC chọn khi tạo hoặc sửa sự kiện.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO MẶC ĐỊNH LÀ TRUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mọi sự kiện đang có đều đang chạy với QR. Mặc định false nghĩa là chạy xong
-- migration, các buổi sắp tới lặng lẽ ngừng cấp vé cho người đăng ký mới — một
-- quyết định không ai đưa ra. Mặc định true giữ nguyên mọi thứ, và tắt là việc
-- BTC chủ động làm cho từng buổi.
--
-- Mã đã phát ra KHÔNG bị thu hồi khi tắt về sau: người đã cầm vé vẫn quét được.
-- Cột này chỉ quyết định có cấp vé cho lượt đăng ký MỚI hay không.
--
-- Không đụng tới dữ liệu nào. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

do $preflight$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREFLIGHT_FAILED: chưa có bảng public.events';
  end if;
end;
$preflight$;

alter table public.events
  add column if not exists qr_checkin_enabled boolean not null default true;

comment on column public.events.qr_checkin_enabled is
  'Có cấp mã QR check-in cá nhân cho lượt đăng ký mới không. Tắt thì thư xác nhận không kèm vé, BTC điểm danh theo danh sách. Mã đã phát ra trước đó vẫn quét được. Mặc định true để mọi sự kiện có sẵn giữ nguyên hành vi.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kiểm cả kiểu, NOT NULL lẫn mặc định. Một cột boolean cho phép null mà mã đọc
-- theo lối `!== false` thì vẫn chạy — nhưng một cột mặc định false thì lặng lẽ
-- tắt QR cho mọi sự kiện tạo bằng đường nào đó không đi qua form.
do $self_check$
declare
  v_type     text;
  v_nullable text;
  v_default  text;
begin
  select data_type, is_nullable, column_default
    into v_type, v_nullable, v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'events' and column_name = 'qr_checkin_enabled';

  if v_type is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: events.qr_checkin_enabled chưa được thêm';
  end if;

  if v_type <> 'boolean' or v_nullable <> 'NO' or coalesce(v_default, '') <> 'true' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: events.qr_checkin_enabled sai định nghĩa (kiểu %, nullable %, mặc định %)',
      v_type, v_nullable, v_default;
  end if;
end;
$self_check$;
