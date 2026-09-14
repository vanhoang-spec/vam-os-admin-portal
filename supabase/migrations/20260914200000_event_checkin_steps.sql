-- ═══════════════════════════════════════════════════════════════════════════
-- Các lần quét mã QR của từng sự kiện: Quét lần 1, Quét lần 2… tối đa 20
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Trước migration này, máy quét có bốn trạm cố định dùng chung cho mọi sự kiện
-- (Cửa vào, Booth chương trình, Booth đối tác, Khu trải nghiệm), và chỉ Cửa vào
-- tính là đã tham dự. Một sự kiện chỉ cần Check out, hay cần hai talkshow và một
-- quầy đổi quà, không có cách nào nói ra điều đó.
--
-- Cột mới `events.checkin_steps`: các lần quét theo thứ tự, mỗi phần tử một mục —
-- entrance (Check in), gift_counter, experience_counter, talkshow, seminar,
-- checkout. BTC thiết lập trong form sự kiện; máy quét chỉ hiện đúng danh sách
-- đó. Người tham dự vẫn chỉ có MỘT mã QR.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO MẶC ĐỊNH LÀ {entrance}
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Một lần Check in là đúng việc mọi sự kiện đang làm ở cửa. `entrance` cũng là
-- giá trị mặc định sẵn có của `event_scans.station`, nên lượt quét cửa vào đã có
-- vẫn là Check in của sự kiện đó, và quét lại người đã vào vẫn được nhận là quét
-- lại chứ không thành một lượt mới.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO DATABASE CHỈ KIỂM HÌNH DẠNG, KHÔNG KIỂM DANH SÁCH MỤC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CHECK chỉ khoá 1–20 phần tử và không phần tử nào null. Danh sách mục hợp lệ nằm
-- ở `lib/event-checkin-steps.ts` — nơi duy nhất ghi cột này — và được kiểm ở đó
-- trước mỗi lần ghi.
--
-- Chép cứng danh sách mục vào CHECK nghĩa là thêm một mục mới phải viết lại ràng
-- buộc, và mỗi lần viết lại là một cơ hội chép thiếu một giá trị đang có dữ liệu.
--
-- Không đụng tới dữ liệu nào: cột mới lấy giá trị mặc định, không có lệnh update.
-- `event_scans` giữ nguyên. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $preflight$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREFLIGHT_FAILED: chưa có bảng public.events';
  end if;
  if to_regclass('public.event_scans') is null then
    raise exception 'PREFLIGHT_FAILED: chưa có bảng public.event_scans — chạy migration mã điểm danh trước';
  end if;
end;
$preflight$;

alter table public.events
  add column if not exists checkin_steps text[] not null default array['entrance']::text[];

do $shape$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_checkin_steps_shape_check'
  ) then
    alter table public.events
      add constraint events_checkin_steps_shape_check
      check (
        cardinality(checkin_steps) between 1 and 20
        and array_position(checkin_steps, null) is null
      );
  end if;
end;
$shape$;

comment on column public.events.checkin_steps is
  'Các lần quét mã QR theo thứ tự (Quét lần 1, 2…), mỗi phần tử một mục: entrance = Check in, gift_counter, experience_counter, talkshow, seminar, checkout. 1–20 phần tử. Người tham dự vẫn chỉ có một mã QR. Mặc định {entrance}.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kiểm cả kiểu, NOT NULL, mặc định lẫn ràng buộc. Cột cho phép null hay thiếu mặc
-- định thì mọi sự kiện tạo bằng đường không đi qua form (thêm buổi vào chuỗi, dữ
-- liệu cũ) mở máy quét ra không có lần quét nào để chọn.
do $self_check$
declare
  v_type     text;
  v_nullable text;
  v_default  text;
  v_empty    bigint;
begin
  select udt_name, is_nullable, column_default
    into v_type, v_nullable, v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'events' and column_name = 'checkin_steps';

  if v_type is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: events.checkin_steps chưa được thêm';
  end if;

  if v_type <> '_text' or v_nullable <> 'NO' or position('entrance' in coalesce(v_default, '')) = 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: events.checkin_steps sai định nghĩa (kiểu %, nullable %, mặc định %)',
      v_type, v_nullable, v_default;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_checkin_steps_shape_check'
      and convalidated
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc events_checkin_steps_shape_check';
  end if;

  -- Mọi sự kiện đang có đều có ít nhất một lần quét để chọn.
  select count(*) into v_empty from public.events where cardinality(checkin_steps) < 1;
  if v_empty > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: % sự kiện không có lần quét nào', v_empty;
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
