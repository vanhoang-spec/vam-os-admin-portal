-- ============================================================
-- Sự kiện: hình thức, giờ kết thúc, địa điểm
-- ============================================================
--
-- Bảng `events` hôm nay không trả lời được ba câu hỏi đầu tiên mà ai được mời
-- cũng hỏi: **ở đâu**, **online hay tới nơi**, và **mấy giờ thì xong**.
--
-- Thiếu địa điểm không phải chuyện nhỏ đã cản người khác thật: migration
-- `072_cross_mentoring` phải tự thêm cột `location` vào bảng của riêng nó, kèm
-- comment ghi thẳng *"đặt ở đây vì public.events không có cột địa điểm nào"*.
-- Một chương trình có hai chỗ ghi địa điểm là một chương trình sắp gửi nhầm
-- địa chỉ cho ai đó.
--
-- Thêm:
--   * event_format      — offline / online / hybrid
--   * ends_at           — giờ kết thúc
--   * location_name     — tên nơi tổ chức ("Hội trường A")
--   * location_address  — địa chỉ đầy đủ, dùng để dựng đường dẫn bản đồ
--   * location_map_url  — đường dẫn Google Maps do BTC tự dán, nếu có
--   * online_join_url   — đường dẫn vào phòng họp trực tuyến
--   plus: bốn loại sự kiện mới.
--
-- ------------------------------------------------------------
-- VÌ SAO KHÔNG BỌC TRONG MỘT TRANSACTION
-- ------------------------------------------------------------
-- `alter type ... add value` không dùng được giá trị mới trong cùng
-- transaction đã thêm nó. Migration 048 vì thế chạy từng khối một, và file này
-- theo đúng cách đó. Bù lại là khối tự kiểm ở cuối: chạy xong mà thiếu thứ gì
-- thì nó nói ra, thay vì để lỗi hiện ra ở tận màn hình.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

-- ------------------------------------------------------------
-- Phase 0 — điều kiện tiên quyết
-- ------------------------------------------------------------
do $events_location_prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần public.events';
  end if;
end;
$events_location_prereq$;

-- ------------------------------------------------------------
-- 1. Bốn loại sự kiện mới
-- ------------------------------------------------------------
-- `orientation` cũ được GIỮ NGUYÊN, không đổi tên và không xoá: các sự kiện đã
-- diễn ra đang mang giá trị đó, và đổi nghĩa một giá trị cũ là viết lại lịch sử.
-- Hai giá trị mới đứng cạnh nó cho những mùa sau, khi hai buổi định hướng của
-- mentor và mentee được tổ chức riêng.
--
-- `interview_day` là NGÀY phỏng vấn — một buổi có địa điểm, có sức chứa, có
-- điểm danh. Nó KHÔNG thay cho module /interviews, nơi quản lý từng ca phỏng
-- vấn của từng ứng viên; hai thứ đó là hai khái niệm khác nhau và nhân bản
-- khái niệm thứ hai vào đây sẽ tạo ra hai nguồn sự thật.
do $events_event_type_enum$
declare
  wanted text;
begin
  if to_regtype('public.event_type') is null then
    return;
  end if;

  foreach wanted in array array[
    'mentee_orientation', 'mentor_orientation', 'interview_day', 'cross_mentoring'
  ] loop
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'event_type'
        and e.enumlabel = wanted
    ) then
      execute format('alter type public.event_type add value %L', wanted);
    end if;
  end loop;
end;
$events_event_type_enum$;

do $events_event_type_check$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_event_type_check'
  ) then
    alter table public.events drop constraint events_event_type_check;

    alter table public.events
      add constraint events_event_type_check
      check (
        event_type is null
        or event_type::text in (
          'orientation',
          'mentee_orientation',
          'mentor_orientation',
          'training',
          'workshop',
          'community',
          'matching',
          'company_tour',
          'networking',
          'closing',
          'business_case',
          'job_shadowing',
          'kickoff',
          'interview_day',
          'cross_mentoring',
          'other'
        )
      );
  end if;
end;
$events_event_type_check$;

-- ------------------------------------------------------------
-- 2. Hình thức tổ chức
-- ------------------------------------------------------------
-- Mặc định `offline`: mọi sự kiện đã có trong bảng đều là sự kiện tới-tận-nơi,
-- nên giá trị mặc định phải nói đúng về chúng thay vì bắt ai đó đi sửa lại
-- từng dòng.
alter table public.events
  add column if not exists event_format text not null default 'offline';

do $events_format_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_event_format_check'
  ) then
    alter table public.events
      add constraint events_event_format_check
      check (event_format in ('offline', 'online', 'hybrid'));
  end if;
end;
$events_format_check$;

comment on column public.events.event_format is
  'offline (tới tận nơi), online (trực tuyến), hoặc hybrid (cả hai). Quyết định người tham dự cần địa chỉ hay cần đường dẫn phòng họp.';

-- ------------------------------------------------------------
-- 3. Giờ kết thúc
-- ------------------------------------------------------------
alter table public.events
  add column if not exists ends_at timestamptz;

do $events_ends_at_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_ends_at_check'
  ) then
    -- Nullable vì mọi sự kiện đã có đều chưa ghi giờ kết thúc, và đoán hộ
    -- chúng một giờ nào đó là bịa dữ liệu. Chỉ ràng buộc điều thật sự vô lý:
    -- kết thúc trước khi bắt đầu.
    alter table public.events
      add constraint events_ends_at_check
      check (ends_at is null or starts_at is null or ends_at > starts_at);
  end if;
end;
$events_ends_at_check$;

comment on column public.events.ends_at is
  'Giờ kết thúc. Null nghĩa là chưa ghi, không phải sự kiện không có hồi kết.';

-- ------------------------------------------------------------
-- 4. Địa điểm
-- ------------------------------------------------------------
alter table public.events
  add column if not exists location_name text;

alter table public.events
  add column if not exists location_address text;

alter table public.events
  add column if not exists location_map_url text;

alter table public.events
  add column if not exists online_join_url text;

comment on column public.events.location_name is
  'Tên nơi tổ chức, ví dụ "Hội trường A, cơ sở B". Phần người đọc nhận ra.';

comment on column public.events.location_address is
  'Địa chỉ đầy đủ. Khi không có location_map_url, ứng dụng dựng đường dẫn Google Maps từ chính chuỗi này.';

comment on column public.events.location_map_url is
  'Đường dẫn Google Maps do BTC tự dán, khi địa chỉ tự do không trỏ đúng chỗ. Được ưu tiên hơn đường dẫn suy ra từ địa chỉ. Ứng dụng chỉ nhận đường dẫn thuộc miền bản đồ của Google.';

comment on column public.events.online_join_url is
  'Đường dẫn vào phòng họp trực tuyến, cho sự kiện online hoặc hybrid.';

-- ------------------------------------------------------------
-- 5. Tự kiểm
-- ------------------------------------------------------------
do $events_location_contract$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
  from unnest(array[
    'event_format', 'ends_at', 'location_name',
    'location_address', 'location_map_url', 'online_join_url'
  ]) as want
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột trên public.events: %', missing;
  end if;

  select string_agg(want, ', ')
    into missing
  from unnest(array['events_event_format_check', 'events_ends_at_check']) as want
  where not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and conname = want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc: %', missing;
  end if;

  -- Từ vựng loại sự kiện nới ra chứ không thay thế: mọi giá trị cũ vẫn phải
  -- được nhận, nếu không thì các sự kiện đã có thành dữ liệu không hợp lệ.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_event_type_check'
  ) then
    select string_agg(want, ', ')
      into missing
    from unnest(array[
      'orientation', 'training', 'workshop', 'community', 'matching',
      'company_tour', 'networking', 'closing', 'business_case',
      'job_shadowing', 'kickoff', 'other',
      'mentee_orientation', 'mentor_orientation', 'interview_day', 'cross_mentoring'
    ]) as want
    where position('''' || want || '''' in (
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid = 'public.events'::regclass
        and c.conname = 'events_event_type_check'
    )) = 0;

    if missing is not null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: events_event_type_check không nhận: %', missing;
    end if;
  end if;
end;
$events_location_contract$;

notify pgrst, 'reload schema';
