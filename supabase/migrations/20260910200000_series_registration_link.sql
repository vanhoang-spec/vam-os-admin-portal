-- ============================================================
-- Một link đăng ký cho cả chuỗi, người đăng ký chọn buổi
-- ============================================================
--
-- Chuỗi Mentor Orientation có hai buổi: 20/09 và 27/09. Nội dung giống hệt
-- nhau, chỉ khác ngày. Bắt BTC phát hai link — và bắt người được mời đọc xem
-- link nào là buổi nào — là để cấu trúc dữ liệu quyết định thay cho người dùng.
--
-- Một link, một ô chọn buổi. Và nó chặn được đúng thứ hai link KHÔNG chặn nổi:
-- cùng một người đăng ký cả hai buổi, chiếm hai chỗ trong khi mỗi buổi chỉ có
-- một trăm.
--
-- ------------------------------------------------------------
-- VÌ SAO KHÔNG CHO event_links.event_id THÀNH NULL
-- ------------------------------------------------------------
-- Cách "đúng sách vở" là để link trỏ tới chuỗi thay vì tới buổi, tức bỏ NOT
-- NULL trên `event_id` và nới ràng buộc duy nhất `(event_id, link_type)`. Cả
-- hai đều là thao tác nới lỏng trên một bảng đang chạy thật, để đổi lấy một
-- cách mô hình hoá gọn hơn trên giấy.
--
-- Ở đây link vẫn NEO vào một buổi — buổi đầu của chuỗi — và mang thêm cờ nói
-- rằng nó nhận đăng ký cho cả chuỗi. Mọi ràng buộc cũ giữ nguyên hiệu lực, và
-- "mỗi buổi một link đăng ký" vẫn đúng.
--
-- ------------------------------------------------------------
-- KHOÁ MỘT NGƯỜI MỘT BUỔI: BẰNG DATABASE, KHÔNG BẰNG NIỀM TIN
-- ------------------------------------------------------------
-- `event_registrations.series_id` được sao xuống từ buổi lúc ghi. Nó là dữ
-- liệu lặp — và có chủ ý: một ràng buộc duy nhất không bắc qua được phép nối
-- bảng, nên muốn "một email một chuỗi" là ràng buộc THẬT thì cột đó phải nằm
-- ngay trên dòng đăng ký.
--
-- Kiểm ở tầng ứng dụng thôi thì hai lần bấm gần nhau vẫn lọt cả hai.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $series_link_prereq$
begin
  if to_regclass('public.event_links') is null then
    raise exception 'PREREQ_MISSING: cần public.event_links';
  end if;
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần public.event_registrations';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'series_id'
  ) then
    raise exception 'PREREQ_MISSING: cần events.series_id (migration 20260910140000)';
  end if;
end;
$series_link_prereq$;

-- ------------------------------------------------------------
-- 1. Link nhận đăng ký cho cả chuỗi
-- ------------------------------------------------------------
alter table public.event_links
  add column if not exists covers_series boolean not null default false;

-- Chuỗi mà link này phục vụ, sao xuống từ buổi neo. Có nó thì kiểm được một
-- buổi người dùng chọn có thuộc chuỗi này không, mà không phải nối sang bảng
-- events giữa một luồng công khai.
alter table public.event_links
  add column if not exists series_id uuid;

do $event_links_series_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_links'::regclass
      and conname = 'event_links_covers_series_check'
  ) then
    -- Một link nhận đăng ký cho "cả chuỗi" mà không biết chuỗi nào là một link
    -- hứa điều nó không làm được.
    alter table public.event_links
      add constraint event_links_covers_series_check
      check (covers_series = false or series_id is not null);
  end if;
end;
$event_links_series_check$;

comment on column public.event_links.covers_series is
  'True: link này nhận đăng ký cho MỌI buổi trong chuỗi, người đăng ký chọn buổi trên form. False: chỉ nhận cho đúng buổi mà event_id trỏ tới.';

comment on column public.event_links.series_id is
  'Chuỗi mà link phục vụ, sao xuống từ buổi neo. Dùng để kiểm buổi người dùng chọn có thuộc chuỗi này không.';

-- ------------------------------------------------------------
-- 2. Một người một buổi trong mỗi chuỗi
-- ------------------------------------------------------------
alter table public.event_registrations
  add column if not exists series_id uuid;

comment on column public.event_registrations.series_id is
  'Chuỗi của buổi đã đăng ký, sao xuống từ events.series_id lúc ghi. Dữ liệu lặp có chủ ý: một ràng buộc duy nhất không bắc qua được phép nối bảng, nên muốn "một email một chuỗi" là ràng buộc thật thì cột này phải nằm ngay trên dòng đăng ký.';

-- Cùng hình dạng với ràng buộc chống trùng theo buổi đã có
-- (`event_registrations_event_lower_email_active_uidx`): so email không phân
-- biệt hoa thường, và dòng đã huỷ thì không tính.
create unique index if not exists event_registrations_series_lower_email_active_uidx
  on public.event_registrations (series_id, lower(email))
  where series_id is not null and registration_status <> 'cancelled';

comment on index public.event_registrations_series_lower_email_active_uidx is
  'Một email chỉ giữ một chỗ trong mỗi chuỗi. Đây là thứ hai link riêng lẻ không chặn được: với hai link, cùng một người đăng ký cả hai buổi và chiếm hai chỗ.';

create index if not exists event_registrations_series_idx
  on public.event_registrations (series_id)
  where series_id is not null;

-- ------------------------------------------------------------
-- 3. Tự kiểm
-- ------------------------------------------------------------
do $series_link_contract$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
  from (values
    ('event_links', 'covers_series'),
    ('event_links', 'series_id'),
    ('event_registrations', 'series_id')
  ) as wanted(tbl, want)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = wanted.tbl
      and column_name = wanted.want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột: %', missing;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_links'::regclass
      and conname = 'event_links_covers_series_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu event_links_covers_series_check';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'event_registrations_series_lower_email_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc một email một chuỗi';
  end if;

  -- Ràng buộc chống trùng THEO BUỔI phải còn nguyên: ràng buộc mới đứng cạnh
  -- nó chứ không thay nó. Một sự kiện đơn lẻ không có series_id, và khi đó chỉ
  -- ràng buộc cũ giữ chỗ.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'event_registrations_event_lower_email_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: ràng buộc chống trùng theo buổi đã biến mất';
  end if;

  -- Mọi link đang có đều phải hợp lệ với ràng buộc mới. Kiểm luôn thay vì tin
  -- vào giá trị mặc định.
  if exists (
    select 1 from public.event_links where covers_series and series_id is null
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: có link nhận cả chuỗi mà không ghi chuỗi nào';
  end if;
end;
$series_link_contract$;

notify pgrst, 'reload schema';

commit;
