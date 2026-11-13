-- ============================================================
-- Giới hạn đăng ký theo email: một cấu hình chung cho cả chuỗi (báo lỗi VAM00028, 09/11/2026)
-- ============================================================
--
-- Sửa trigger `vam_enforce_event_registration_limit` của migration 20261103230000 (VAM00015).
--
-- ------------------------------------------------------------
-- LỖI
-- ------------------------------------------------------------
-- Trigger cũ đọc giới hạn trên CHÍNH buổi đang được đăng ký (`new.event_id`). Nhưng giới hạn theo chuỗi
-- được lưu trên từng dòng `events`, và các buổi của một chuỗi có thể mang cấu hình khác nhau:
--   - sửa một buổi mà không tick "áp cho mọi buổi" thì chỉ buổi đó mang giới hạn;
--   - sự kiện lẻ chọn "Toàn bộ chuỗi" bị hạ về "Một sự kiện" lúc lưu, rồi "Thêm buổi" chép nguyên
--     "Một sự kiện" sang buổi mới, nên buổi thêm sau chỉ tự giới hạn cho riêng nó.
-- Khi đó kết quả phụ thuộc thứ tự: đăng ký buổi KHÔNG mang giới hạn trước thì trigger không đếm gì và
-- cho qua; đăng ký buổi MANG giới hạn sau thì trigger đếm cả chuỗi, thấy đủ lượt và chặn. Đảo thứ tự lại
-- thì lọt. Buổi không mang giới hạn cũng không xin khoá tư vấn, nên hai lần bấm gần nhau lọt cả hai.
--
-- ------------------------------------------------------------
-- SỬA
-- ------------------------------------------------------------
-- Giới hạn của buổi thuộc chuỗi là giới hạn CỦA CHUỖI: số nhỏ nhất trong các buổi cùng `series_id` có
-- số. Một buổi mang giới hạn là đủ để mọi buổi của chuỗi, kể cả buổi thêm sau, cùng chịu một giới hạn;
-- không phụ thuộc buổi nào được đăng ký trước hay tạo trước.
--
-- Cột `registration_limit_scope` KHÔNG còn được đọc (BTC chốt 11/11/2026: chỉ có giới hạn toàn chuỗi,
-- bỏ lựa chọn "Một sự kiện"). Dữ liệu production lúc viết (13/11/2026): mọi chuỗi đang mang giới hạn
-- đều đã có ít nhất một buổi phạm vi 'series', nên với dữ liệu hiện có, bỏ cột phạm vi không đổi con
-- số nào so với bản đọc 'series'; nó chỉ khác ở chuỗi CHỈ có dòng 'event' mang số (hiện không có).
-- Sự kiện lẻ là chuỗi một buổi: ràng buộc một-email-một-buổi đã giữ nó, trigger không làm gì thêm.
-- Lấy số nhỏ nhất vì đó là hướng an toàn khi các buổi lệch nhau: không ai đăng ký được nhiều hơn mức
-- chặt nhất BTC đã đặt. TypeScript đọc cùng luật ở `seriesRegistrationLimit` (lib/event-registration-limit-core.ts).
--
-- Không đổi:
--   - luật đếm (`vam_registration_counts_toward_limit`): huỷ / bị từ chối hoàn lượt, còn lại đều tính;
--   - chỉ chặn đăng ký công khai; vãng lai, BTC nhập tay, import không bị chặn; vãng lai không bị tính;
--   - sửa một đăng ký đang tính (cùng email, cùng buổi) không phải lượt mới, nên ai ĐANG vượt giới hạn
--     trên dữ liệu có sẵn vẫn sửa được đăng ký của mình, không đăng ký nào bị huỷ hay chặn ngược;
--   - sự kiện lẻ và chuỗi mà không buổi nào có số giới hạn: trigger không làm gì (ràng buộc
--     một-email-một-buổi `event_registrations_event_lower_email_active_uidx` vẫn đứng nguyên);
--   - khoá tư vấn theo (chuỗi, email), cùng một khoá như trước, nay xin ở MỌI buổi của chuỗi có giới hạn.
--
-- Thêm: khi đếm, bỏ đăng ký khác ở CHÍNH buổi đang ghi (ràng buộc một-email-một-buổi đã lo phần đó), để
-- hai lần bấm gần nhau ở cùng buổi vẫn đi đường "ghi đè" (lỗi 23505) như với sự kiện lẻ.
--
-- Migration này KHÔNG sửa dòng dữ liệu nào: không đổi cấu hình sự kiện, không đụng đăng ký.
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

set local lock_timeout = '10s';

do $prereq$
begin
  if to_regprocedure('public.vam_registration_counts_toward_limit(text)') is null then
    raise exception 'PREREQ_MISSING: cần migration 20261103230000 (vam_registration_counts_toward_limit)';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'registration_limit_scope'
  ) then
    raise exception 'PREREQ_MISSING: cần events.registration_limit_scope (migration 20261103230000)';
  end if;
end;
$prereq$;

create or replace function public.vam_enforce_event_registration_limit()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_limit integer;
  v_series uuid;
  v_email text;
  v_count integer;
begin
  -- Chỉ đăng ký công khai. Vãng lai, BTC nhập tay, import không bị giới hạn.
  if coalesce(new.is_walk_in, false) or coalesce(new.registration_source, '') <> 'public_form' then
    return new;
  end if;
  if not public.vam_registration_counts_toward_limit(new.registration_status) then
    return new;
  end if;
  v_email := lower(btrim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Cùng người, cùng buổi, vẫn đang tính: sửa tên, sửa số điện thoại, hay đổi giữa các trạng thái
    -- còn hiệu lực không phải một lượt mới.
    if public.vam_registration_counts_toward_limit(old.registration_status)
       and lower(btrim(coalesce(old.email, ''))) = v_email
       and old.event_id = new.event_id then
      return new;
    end if;
  end if;

  select e.series_id into v_series from public.events e where e.id = new.event_id;
  -- Sự kiện lẻ: trong một buổi một email vốn chỉ giữ một đăng ký còn hiệu lực.
  if v_series is null then
    return new;
  end if;

  -- VAM00028: giới hạn của CHUỖI, không phải của buổi đang đăng ký. Không đọc cột phạm vi: BTC chốt
  -- 11/11/2026 giới hạn luôn tính trên toàn chuỗi, nên dòng cũ ghi 'event' trong chuỗi cũng là giới hạn chung.
  select min(s.registration_limit_per_email) into v_limit
    from public.events s
   where s.series_id = v_series
     and s.registration_limit_per_email is not null;

  if v_limit is null then
    return new;
  end if;

  -- Xếp hàng mọi yêu cầu của cùng một email trong cùng một chuỗi. Khoá nhả khi giao dịch kết thúc,
  -- nên yêu cầu sau chỉ đếm khi yêu cầu trước đã ghi xong (READ COMMITTED đọc lại từng câu lệnh).
  perform pg_advisory_xact_lock(hashtextextended('event_registration_limit:' || v_series::text || ':' || v_email, 0));

  select count(*) into v_count
    from public.event_registrations r
    join public.events ev on ev.id = r.event_id
   where ev.series_id = v_series
     and lower(btrim(coalesce(r.email, ''))) = v_email
     and r.is_walk_in is not true
     and r.id <> new.id
     -- Đăng ký khác ở CHÍNH buổi này không tính: ràng buộc một-email-một-buổi đã bảo đảm một lần ghi vào
     -- buổi này không thêm lượt nào. Hai lần bấm gần nhau ở cùng buổi vì thế rơi vào lỗi trùng khoá 23505
     -- mà ứng dụng xử lý bằng ghi đè, thay vì bị báo "đã đủ lượt" oan.
     and r.event_id <> new.event_id
     and public.vam_registration_counts_toward_limit(r.registration_status);

  if v_count >= v_limit then
    raise exception 'EVENT_REGISTRATION_LIMIT_REACHED'
      using detail = format('scope=series; limit=%s; count=%s', v_limit, v_count);
  end if;

  return new;
end
$fn$;

-- Trigger giữ nguyên tên và cột theo dõi; tạo lại để chắc nó trỏ vào hàm trên.
create or replace trigger event_registrations_limit_per_email
  before insert or update of email, registration_status, event_id
  on public.event_registrations
  for each row
  execute function public.vam_enforce_event_registration_limit();

revoke all on function public.vam_enforce_event_registration_limit() from public, anon, authenticated;

comment on column public.events.registration_limit_scope is
  'Cũ, không còn được đọc (VAM00028, 11/2026). Giới hạn registration_limit_per_email luôn là của cả chuỗi (mọi buổi cùng events.series_id, kể cả buổi thêm sau; các buổi lệch nhau thì lấy số nhỏ nhất). Ứng dụng ghi "series" cho mọi giới hạn mới.';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $contract$
declare
  v_src text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.event_registrations'::regclass
      and tgname = 'event_registrations_limit_per_email'
      and tgfoid = 'public.vam_enforce_event_registration_limit()'::regprocedure
      and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: trigger event_registrations_limit_per_email không trỏ vào hàm giới hạn';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = 'public.vam_enforce_event_registration_limit()'::regprocedure;
  if v_src not like '%min(s.registration_limit_per_email)%' then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giới hạn chưa đọc giới hạn chung của chuỗi';
  end if;
  if v_src like '%registration_limit_scope%' then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giới hạn còn đọc cột phạm vi (giới hạn phải luôn là của chuỗi)';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_registrations_event_lower_email_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc một-email-một-buổi';
  end if;

  if has_function_privilege('anon', 'public.vam_enforce_event_registration_limit()', 'execute')
     or has_function_privilege('authenticated', 'public.vam_enforce_event_registration_limit()', 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon hoặc authenticated gọi được hàm giới hạn đăng ký';
  end if;
end;
$contract$;

notify pgrst, 'reload schema';

commit;
