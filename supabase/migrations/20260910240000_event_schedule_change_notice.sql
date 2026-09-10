-- ═══════════════════════════════════════════════════════════════════════════
-- Thư báo đổi lịch một buổi sự kiện
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Đổi giờ một buổi đã có người đăng ký là chuyện có thật — hội trường bị đổi,
-- diễn giả kẹt lịch. Trước migration này hệ thống chỉ nhắc người vận hành rằng
-- "N người đang giữ thư ghi giờ cũ", rồi để họ tự đi báo bằng tay. Mà những
-- người đó nằm rải rác trong CRM chứ không nằm trong một nhóm chat nào.
--
-- Hai thứ được thêm:
--
--   1. `outbound_emails.kind` nhận thêm 'event_schedule_change', để thư báo đổi
--      lịch được ghi sổ như mọi thư khác và tra lại được trong Nhật ký gửi.
--
--   2. `event_registrations.schedule_notified_for` — mốc thời gian mà người này
--      ĐÃ ĐƯỢC BÁO. Xem phần dưới về vì sao là mốc thời gian chứ không phải một
--      cờ đúng/sai.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO GHI MỐC THỜI GIAN, KHÔNG PHẢI CỜ "ĐÃ BÁO"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Một cờ boolean trả lời được câu "đã báo chưa", nhưng không trả lời được câu
-- thực sự cần: "đã báo về LẦN ĐỔI NÀO". Lịch đổi hai lần thì cờ đã bật từ lần
-- một, và lần hai không ai được báo.
--
-- Ghi lại chính giá trị `starts_at` mà người đó đã được báo thì câu hỏi "còn ai
-- chưa biết giờ hiện tại" trở thành một phép so sánh: cột này khác `starts_at`
-- của buổi là chưa biết. Đúng cho lần đổi thứ nhất, thứ hai, và thứ n.
--
-- Nó cũng làm việc gửi lại an toàn: gửi tới đâu đánh dấu tới đó, nên bấm "gửi
-- tiếp" sau khi mất mạng giữa chừng không gửi hai lần cho cùng một người.
--
-- Người đăng ký MỚI sau lần đổi được đánh dấu ngay lúc cấp vé — thư xác nhận
-- của họ đã ghi giờ mới rồi, báo lại một lần nữa chỉ làm họ tưởng lịch vừa đổi
-- thêm lần nữa.
--
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.event_registrations
  add column if not exists schedule_notified_for timestamptz;

comment on column public.event_registrations.schedule_notified_for is
  'Giá trị events.starts_at mà người này đã được báo. Khác starts_at hiện tại của buổi nghĩa là chưa biết lịch mới. Ghi mốc thời gian chứ không phải cờ đúng/sai, để lần đổi lịch thứ hai vẫn nhận ra được ai chưa được báo.';

-- Truy vấn nóng là "còn ai của buổi này chưa được báo". Chỉ số theo buổi đã có
-- sẵn (`event_registrations_event_id_idx`); thêm cột này vào một chỉ số ghép để
-- phép lọc không phải đọc lại từng dòng của buổi.
create index if not exists event_registrations_schedule_notice_idx
  on public.event_registrations(event_id, schedule_notified_for);

-- ═══════════════════════════════════════════════════════════════════════════
-- Nới ràng buộc loại thư
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Đọc lại định nghĩa hiện có rồi nối thêm một giá trị, thay vì viết đè cả danh
-- sách: viết đè nghĩa là mỗi lần thêm một loại thư lại phải chép đúng toàn bộ
-- các loại đã có, và chép thiếu một cái thì những thư loại đó ngừng ghi được sổ
-- mà không ai thấy cho tới lần gửi sau.
do $outbound_emails_kind_schedule$
declare
  existing text;
  rebuilt  text;
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

  if position('''event_schedule_change''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(
    existing,
    '\]\)\)\)$',
    ', ''event_schedule_change''::text])))'
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
$outbound_emails_kind_schedule$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm: chạy xong mà một trong hai thứ chưa có thì dừng lại ngay ở đây
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Migration báo thành công trong khi cột chưa được thêm là thứ chỉ lộ ra vào
-- lần gửi thư thật đầu tiên, giữa lúc người vận hành đang cần nó chạy.
do $self_check$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_registrations'
      and column_name = 'schedule_notified_for'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_registrations.schedule_notified_for chưa được thêm';
  end if;

  if to_regclass('public.outbound_emails') is not null then
    if position('''event_schedule_change''' in (
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid = 'public.outbound_emails'::regclass
        and c.conname = 'outbound_emails_kind_check'
    )) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận event_schedule_change';
    end if;
  end if;
end;
$self_check$;
