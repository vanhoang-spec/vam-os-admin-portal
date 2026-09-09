-- ============================================================
-- Chuỗi sự kiện lặp lại
-- ============================================================
--
-- Một buổi training hằng tuần có sức chứa riêng, danh sách đăng ký riêng và
-- điểm danh riêng của buổi đó. Nếu chuỗi chỉ là một quy tắc và các buổi được
-- suy ra lúc hiển thị, thì mọi thứ gắn vào một buổi cụ thể — một chỗ ngồi, một
-- lần check-in — phải gắn vào một thứ không tồn tại trong database.
--
-- Nên tạo chuỗi là tạo N dòng `events` THẬT, dùng chung một `series_id`. Đổi
-- giờ của một buổi là sửa đúng buổi đó, và không buổi nào khác bị ảnh hưởng.
--
-- ------------------------------------------------------------
-- VÌ SAO KHÔNG CÓ BẢNG event_series
-- ------------------------------------------------------------
-- Quy tắc lặp chỉ là cách sinh ra danh sách ngày, và nó chỉ tồn tại trong đúng
-- một khoảnh khắc: lúc bấm tạo. Lưu nó lại sẽ tạo ra ảo giác rằng sửa quy tắc
-- thì các buổi tự đổi theo — trong khi các buổi lúc đó đã có người đăng ký.
--
-- `series_id` không có khoá ngoại tới đâu cả: nó là một mã nhóm, không phải
-- con trỏ tới một dòng. Đủ để lọc theo chuỗi, để huỷ cả chuỗi, và để hiển thị
-- "buổi 2/6".
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $event_series_prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần public.events';
  end if;
end;
$event_series_prereq$;

alter table public.events
  add column if not exists series_id uuid;

alter table public.events
  add column if not exists series_index integer;

alter table public.events
  add column if not exists series_total integer;

do $event_series_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_series_shape_check'
  ) then
    -- Ba cột đi cùng nhau hoặc cùng vắng. Một buổi mang số thứ tự mà không
    -- thuộc chuỗi nào là một buổi hiện ra "buổi 3/?" trên màn hình.
    alter table public.events
      add constraint events_series_shape_check
      check (
        (series_id is null and series_index is null and series_total is null)
        or (
          series_id is not null
          and series_index is not null
          and series_total is not null
          and series_index >= 1
          and series_total >= 1
          and series_index <= series_total
        )
      );
  end if;
end;
$event_series_check$;

comment on column public.events.series_id is
  'Mã nhóm của một chuỗi sự kiện lặp lại. Cố ý KHÔNG có khoá ngoại: quy tắc lặp không được lưu, vì nó chỉ tồn tại lúc bấm tạo và giữ lại sẽ tạo ảo giác rằng sửa nó thì các buổi tự đổi theo.';

comment on column public.events.series_index is
  'Buổi thứ mấy trong chuỗi, đếm từ 1.';

comment on column public.events.series_total is
  'Tổng số buổi lúc chuỗi được tạo. Không tự cập nhật khi một buổi bị huỷ — nó ghi lại ý định ban đầu.';

-- Lọc các buổi của một chuỗi, theo đúng thứ tự.
create index if not exists events_series_idx
  on public.events (series_id, series_index)
  where series_id is not null;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $event_series_contract$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
  from unnest(array['series_id', 'series_index', 'series_total']) as want
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột: %', missing;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_series_shape_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu events_series_shape_check';
  end if;

  -- Mọi sự kiện đã có đều nằm ngoài chuỗi, nên ràng buộc mới không được làm
  -- dòng nào thành không hợp lệ. Kiểm luôn thay vì tin.
  if exists (
    select 1 from public.events
    where series_id is null and (series_index is not null or series_total is not null)
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: có sự kiện mang số thứ tự mà không thuộc chuỗi nào';
  end if;
end;
$event_series_contract$;

notify pgrst, 'reload schema';

commit;
