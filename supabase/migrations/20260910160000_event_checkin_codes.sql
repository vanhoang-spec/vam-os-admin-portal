-- ============================================================
-- Mã điểm danh cá nhân, và lịch sử từng lần quét
-- ============================================================
--
-- Hôm nay check-in đi như thế này: người tham dự tự quét mã QR CỦA SỰ KIỆN
-- (một mã dùng chung, dán ở cửa), trang web mở ra, rồi họ **gõ email của mình**
-- để hệ thống biết ai vừa tới. Gõ email trên điện thoại, trong hàng người
-- chờ, với một địa chỉ có thể sai chính tả — đó là chỗ hỏng của cả luồng.
--
-- Đảo lại: mỗi người đăng ký có mã QR CỦA RIÊNG MÌNH, nhận qua email xác
-- nhận. Tại sự kiện, máy của event supporter quét mã trên điện thoại người
-- tham dự. Không ai phải gõ gì, và hệ thống biết chính xác đó là ai vì mã đó
-- chỉ thuộc về đúng một dòng đăng ký.
--
-- Thêm:
--   1. event_registrations.checkin_code — mã cá nhân, duy nhất toàn hệ thống
--   2. public.event_scans               — lịch sử TỪNG lần quét
--
-- ------------------------------------------------------------
-- VÌ SAO CẦN MỘT BẢNG LỊCH SỬ QUÉT
-- ------------------------------------------------------------
-- `event_registrations.checked_in_at` là MỘT cột: nó trả lời được "người này
-- đã vào chưa" và không trả lời được gì thêm. Nhưng cùng một mã QR còn được
-- quét ở các trạm bên lề — booth của chương trình, booth của nhà tài trợ — và
-- mỗi lần quét ở đó là một sự kiện riêng cần đếm riêng.
--
-- `event_scans` ghi lại từng lần: ở trạm nào, ai quét, lúc nào. Cột
-- `checked_in_at` vẫn giữ nguyên vai trò cũ của nó cho trạm cửa vào, nên mọi
-- màn hình đang đọc nó không phải sửa gì.
--
-- ------------------------------------------------------------
-- HỢP ĐỒNG BẢO MẬT
-- ------------------------------------------------------------
-- Server-only: bật RLS, không policy nào, thu hồi mọi quyền của
-- PUBLIC/anon/authenticated. Mã QR đi qua máy chủ để đổi lấy một lần điểm
-- danh; trình duyệt không bao giờ đọc thẳng bảng này.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $event_scans_prereq$
begin
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần public.event_registrations';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần public.admin_users';
  end if;
end;
$event_scans_prereq$;

-- ------------------------------------------------------------
-- 1. Mã điểm danh cá nhân
-- ------------------------------------------------------------
-- Không dùng chính `id` của dòng đăng ký làm mã: id xuất hiện trong đường dẫn
-- quản trị và trong nhật ký, còn mã này nằm trên màn hình điện thoại của người
-- tham dự và được người khác quét. Tách ra thì thu hồi hoặc cấp lại một mã
-- không đụng gì tới dòng dữ liệu, và một id lộ ra ở đâu đó không trở thành một
-- lượt điểm danh giả.
alter table public.event_registrations
  add column if not exists checkin_code text;

-- Duy nhất toàn hệ thống, không chỉ trong một sự kiện: máy quét đọc được mã
-- trước khi biết nó thuộc sự kiện nào, nên tra ngược từ mã phải cho đúng một
-- kết quả. Partial index vì các dòng cũ chưa có mã.
create unique index if not exists event_registrations_checkin_code_uidx
  on public.event_registrations (checkin_code)
  where checkin_code is not null;

comment on column public.event_registrations.checkin_code is
  'Mã điểm danh cá nhân, in thành QR và gửi trong email xác nhận. Duy nhất toàn hệ thống vì máy quét tra ngược từ mã. Null với các đăng ký có trước tính năng này.';

-- ------------------------------------------------------------
-- 2. Lịch sử từng lần quét
-- ------------------------------------------------------------
create table if not exists public.event_scans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,

  -- Trạm quét. 'entrance' là cửa vào — lần quét đồng nghĩa với "đã dự". Các
  -- giá trị khác là các hoạt động bên lề, đếm riêng, không ảnh hưởng tới việc
  -- người đó có được tính là đã tham dự hay không.
  station text not null default 'entrance',

  scanned_by uuid null references public.admin_users(id) on delete set null,
  scanned_at timestamptz not null default now(),
  note text null,

  constraint event_scans_station_check
    check (btrim(station) <> '' and length(station) <= 60)
);

comment on table public.event_scans is
  'Từng lần một mã QR được quét: ở trạm nào, ai quét, lúc nào. Cửa vào chỉ là một trạm; các booth bên lề dùng chung mã đó và được đếm riêng.';

comment on column public.event_scans.station is
  'entrance = cửa vào (tính là đã tham dự). Các giá trị khác là hoạt động bên lề, đếm riêng.';

-- Đếm số lượt quét theo trạm cho một sự kiện — truy vấn của bảng điều khiển.
create index if not exists event_scans_event_station_idx
  on public.event_scans (event_id, station, scanned_at desc);

-- "Người này đã quét ở những trạm nào" — truy vấn của huy hiệu.
create index if not exists event_scans_registration_idx
  on public.event_scans (registration_id, scanned_at desc);

-- Mỗi người mỗi trạm chỉ đếm một lần. Quét lại ở cùng một trạm là chuyện bình
-- thường — máy không đọc được lần đầu, hay hàng người dồn lại — và nó phải là
-- một thao tác vô hại chứ không phải một dòng đếm thêm.
create unique index if not exists event_scans_once_per_station_uidx
  on public.event_scans (registration_id, station);

-- ------------------------------------------------------------
-- 3. Hợp đồng quyền
-- ------------------------------------------------------------
alter table public.event_scans enable row level security;

revoke all on public.event_scans from public, anon, authenticated;

-- THU HỒI CỦA service_role TRƯỚC KHI CẤP LẠI.
--
-- Supabase đặt `alter default privileges` trên schema public, nên một bảng vừa
-- tạo ĐÃ mang sẵn ALL cho service_role — DELETE nằm trong đó. Chỉ viết
-- `grant select, insert` là chồng thêm lên một quyền vốn đã bao trọn, và
-- DELETE sống sót trên một bảng chỉ-ghi-thêm mà không gì nói ra điều đó.
--
-- Đây là lỗ hổng có thật trong các migration của nhánh chưa merge; ở đây nó
-- được bịt, và khối tự kiểm cuối file khẳng định lại.
revoke all on public.event_scans from service_role;

-- Không cấp DELETE: một lượt quét là một sự việc đã xảy ra tại sự kiện, và
-- xoá nó là xoá bằng chứng ai đã có mặt — chính là thứ danh sách này sinh ra
-- để trả lời (kể cả cho việc cộng điểm rèn luyện).
grant select, insert on public.event_scans to service_role;

-- ------------------------------------------------------------
-- 4. Thư xác nhận đăng ký, mang theo mã QR
-- ------------------------------------------------------------
-- Nới từ vựng `outbound_emails.kind` thêm đúng một giá trị, bằng cách ĐỌC
-- ràng buộc hiện có rồi nối vào — chép cứng danh sách nghĩa là mọi giá trị
-- một migration khác thêm vào giữa hai lần deploy sẽ lặng lẽ biến mất, và mọi
-- dòng đang mang giá trị đó làm CHECK gãy ngay lúc `add constraint`.
do $outbound_emails_kind_event$
declare
  existing text;
  rebuilt text;
begin
  if to_regclass('public.outbound_emails') is null then
    return;
  end if;

  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy outbound_emails_kind_check';
  end if;

  if position('''event_registration_confirmation''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(
    existing,
    '\]\)\)\)$',
    ', ''event_registration_confirmation''::text])))'
  );

  if rebuilt = existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check có dạng lạ, không nới được: %',
      existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$outbound_emails_kind_event$;

-- ------------------------------------------------------------
-- 5. Tự kiểm
-- ------------------------------------------------------------
do $event_scans_contract$
declare
  leaked text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_registrations'
      and column_name = 'checkin_code'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu event_registrations.checkin_code';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_registrations_checkin_code_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mã điểm danh chưa được ràng buộc duy nhất';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_scans_once_per_station_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc mỗi người mỗi trạm một lần';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'event_scans' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_scans chưa bật RLS';
  end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'event_scans'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_scans là bảng server-only mà lại có policy';
  end if;

  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'event_scans'
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài: %', leaked;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'event_scans'
      and grantee = 'service_role'
      and privilege_type = 'DELETE'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_scans không được phép xoá';
  end if;

  -- Loại thư mới đã vào từ vựng, và các loại cũ vẫn còn nguyên.
  if to_regclass('public.outbound_emails') is not null then
    if position('''event_registration_confirmation''' in (
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid = 'public.outbound_emails'::regclass
        and c.conname = 'outbound_emails_kind_check'
    )) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận event_registration_confirmation';
    end if;

    if position('''mentee_application_confirmation''' in (
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid = 'public.outbound_emails'::regclass
        and c.conname = 'outbound_emails_kind_check'
    )) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: nới từ vựng đã làm mất giá trị cũ';
    end if;
  end if;
end;
$event_scans_contract$;

notify pgrst, 'reload schema';

commit;
