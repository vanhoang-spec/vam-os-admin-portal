-- ═══════════════════════════════════════════════════════════════════════════
-- Khảo sát sau sự kiện — và nộp khảo sát CHÍNH LÀ check-out
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mentee Orientation 19/09/2026: đầu buổi người tham dự được quét mã QR (check
-- in). Cuối buổi ban tổ chức gửi một khảo sát hai câu; ai điền và bấm gửi thì
-- coi như đã check out. Danh sách "có check in VÀ có check out" là căn cứ ban
-- tổ chức đề xuất điểm rèn luyện cho sinh viên.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO KHÔNG TẠO MỘT BẢNG "CHECK OUT" RIÊNG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Check out đã có sẵn: `events.checkin_steps` cho phép mục 'checkout', và mỗi
-- lượt quét là một dòng `event_scans` với `station` tương ứng. Nộp khảo sát ghi
-- đúng một dòng như vậy — không phải một khái niệm thứ hai song song.
--
-- Nhờ đó mọi thứ đang đếm lượt quét tự nhiên đếm luôn: thẻ đếm trên trang sự
-- kiện, cột "Các lần quét" trong CSV, huy hiệu trên trang vé. Một bảng riêng thì
-- phải sửa từng chỗ đó, và chỗ nào quên sửa sẽ nói một con số khác.
--
-- `event_scans_once_per_station_uidx (registration_id, station)` cũng làm việc
-- nộp lại khảo sát KHÔNG sinh ra hai lượt check out: lần thứ hai là 23505, nơi
-- gọi hiểu là "đã check out rồi".
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BA THỨ ĐƯỢC THÊM
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. `event_links.link_type` nhận thêm 'survey' — link công khai của khảo sát,
--      đi qua đúng bộ máy bật/tắt và mở/đóng của link đăng ký và link check-in.
--      KHÔNG dùng lại link đăng ký: đăng ký đóng trước giờ diễn ra, còn khảo sát
--      mở ra đúng lúc đó.
--
--   2. `event_survey_responses` — câu trả lời, kèm thông tin nhận diện người
--      điền và dòng đăng ký đã khớp được (nếu khớp).
--
--   3. `event_survey_recipients` — hàng đợi gửi thư khảo sát, mỗi người một
--      dòng, để việc gửi chia được thành nhiều lần gọi mà không ai nhận hai thư.
--      Cùng khuôn với `event_reminder_recipients`; khác một điểm có chủ ý: danh
--      sách KHÔNG chốt một lần. Người check-in muộn lúc 18:40 được thêm vào ở
--      lần gọi kế tiếp, vì họ có dự thật.
--
-- Kèm theo: nới hai danh sách đóng theo lối cộng thêm —
--   outbound_emails_kind_check        + 'event_survey'
--   admin_audit_log_action_type_check + 'create_event_survey_link',
--                                       'send_event_survey'
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $event_survey_prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.events';
  end if;
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.event_registrations';
  end if;
  if to_regclass('public.event_links') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.event_links';
  end if;
  if to_regclass('public.event_scans') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.event_scans';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.event_links')
      and conname = 'event_links_link_type_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc event_links_link_type_check';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.outbound_emails')
      and conname = 'outbound_emails_kind_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc outbound_emails_kind_check';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.admin_audit_log')
      and conname = 'admin_audit_log_action_type_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc admin_audit_log_action_type_check';
  end if;
end;
$event_survey_prereq$;

-- ------------------------------------------------------------
-- 1. Giờ tự gửi thư khảo sát
-- ------------------------------------------------------------
--
-- Một mốc thời gian, không phải một cờ "đã gửi chưa": ban tổ chức đặt "18:30
-- hôm nay" từ sáng, rồi tới giờ hệ thống tự gửi. Cờ đúng/sai không trả lời được
-- câu "đến giờ chưa", và cũng không cho sửa lại giờ khi chương trình chạy trễ.
--
-- Đã gửi cho ai thì đọc ở `event_survey_recipients`, nên cột này không cần mang
-- thêm trạng thái nào.
alter table public.events
  add column if not exists survey_send_at timestamptz;

comment on column public.events.survey_send_at is
  'Giờ bắt đầu tự gửi thư khảo sát sau sự kiện (giờ chuẩn UTC). NULL: không tự gửi, ban tổ chức bấm tay. Ai đã nhận đọc ở event_survey_recipients, không đọc ở cột này.';

-- ------------------------------------------------------------
-- 2. Nới loại link theo lối cộng thêm
-- ------------------------------------------------------------
do $event_survey_link_type$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.event_links'::regclass
    and c.conname = 'event_links_link_type_check';

  if position(quote_literal('survey') in v_existing) > 0 then
    return;
  end if;

  -- Nối thêm vào đuôi mảng, không viết đè cả danh sách: viết đè nghĩa là mỗi lần
  -- thêm một loại lại phải chép đúng toàn bộ loại đã có, và chép thiếu 'checkin'
  -- thì mọi link check-in đang chạy lập tức vi phạm ràng buộc.
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''survey''::text\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào event_links_link_type_check: %',
      v_existing;
  end if;

  execute 'alter table public.event_links drop constraint event_links_link_type_check';
  execute 'alter table public.event_links add constraint event_links_link_type_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$event_survey_link_type$;

-- ------------------------------------------------------------
-- 3. Câu trả lời
-- ------------------------------------------------------------
create table if not exists public.event_survey_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- Khớp được dòng đăng ký nào thì trỏ vào đó. NULL là người điền mà hệ thống
  -- chưa nhận ra — người vãng lai chưa kịp đăng ký, hoặc gõ email khác lúc đăng
  -- ký. Giữ lại chứ không từ chối: câu trả lời của họ vẫn là câu trả lời thật,
  -- và ban tổ chức đối chiếu tay được.
  registration_id uuid references public.event_registrations(id) on delete set null,
  matched_by text,
  full_name text not null,
  email text not null,
  -- Dạng so sánh được, do tầng ứng dụng chuẩn hoá (thường hoá email, chỉ giữ
  -- chữ số của số điện thoại). Lưu sẵn chứ không tính lúc đọc: chỉ số duy nhất
  -- chống nộp trùng phải đứng trên đúng giá trị đã chuẩn hoá.
  email_norm text not null,
  phone text,
  phone_norm text,
  student_id text,
  -- Câu 1: điều ấn tượng nhất. Bắt buộc — một phiếu trống không nói được gì.
  impression text not null,
  -- Câu 2: câu hỏi cho ban tổ chức. Không bắt buộc.
  question text,
  -- Người điền tới từ đâu: thư (link cá nhân) hay mã QR trong hội trường.
  source text not null default 'qr',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_survey_responses_matched_by_check
    check (matched_by is null or matched_by in ('email', 'phone')),
  constraint event_survey_responses_source_check
    check (source in ('email', 'qr')),
  constraint event_survey_responses_identity_check
    check (btrim(full_name) <> '' and btrim(email_norm) <> ''),
  constraint event_survey_responses_impression_check
    check (btrim(impression) <> '')
);

-- Một người một phiếu cho một buổi. Nộp lại thì bản mới GHI ĐÈ bản cũ — cùng
-- lựa chọn với form đăng ký sự kiện (16/09/2026), và vì cùng lý do: người sửa
-- lại câu trả lời của mình không nên bị chặn, còn ban tổ chức thì không phải
-- đoán trong hai phiếu cái nào là ý cuối cùng.
create unique index if not exists event_survey_responses_once_uidx
  on public.event_survey_responses (event_id, email_norm);

create index if not exists event_survey_responses_event_idx
  on public.event_survey_responses (event_id, submitted_at desc);

create index if not exists event_survey_responses_registration_idx
  on public.event_survey_responses (registration_id)
  where registration_id is not null;

-- ------------------------------------------------------------
-- 4. Hàng đợi gửi thư khảo sát
-- ------------------------------------------------------------
create table if not exists public.event_survey_recipients (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  email text not null,
  status text not null default 'queued',
  attempted_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint event_survey_recipients_status_check
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  -- Mỗi người một dòng cho một buổi. Đây là thứ làm việc "quét thêm người mới
  -- check-in rồi xếp hàng tiếp" an toàn: người đã có dòng thì lần quét sau bỏ
  -- qua, không xếp hàng lần hai.
  constraint event_survey_recipients_once unique (event_id, registration_id)
);

create index if not exists event_survey_recipients_event_status_idx
  on public.event_survey_recipients (event_id, status);

-- ------------------------------------------------------------
-- 5. Quyền: chỉ máy chủ, không xoá
-- ------------------------------------------------------------
alter table public.event_survey_responses enable row level security;
alter table public.event_survey_recipients enable row level security;

revoke all on public.event_survey_responses from public, anon, authenticated;
revoke all on public.event_survey_recipients from public, anon, authenticated;

-- THU HỒI CỦA service_role TRƯỚC KHI CẤP LẠI. Supabase đặt default privileges
-- trên schema public, nên bảng vừa tạo đã mang sẵn ALL cho service_role — DELETE
-- nằm trong đó. Chỉ viết `grant` là chồng thêm lên quyền vốn đã bao trọn.
revoke all on public.event_survey_responses from service_role;
revoke all on public.event_survey_recipients from service_role;

-- Không cấp DELETE. Phiếu khảo sát là căn cứ đề xuất điểm rèn luyện cho sinh
-- viên; một lệnh xoá nhầm ở đây là thứ không dựng lại được.
grant select, insert, update on public.event_survey_responses to service_role;
grant select, insert, update on public.event_survey_recipients to service_role;

-- ------------------------------------------------------------
-- 6. Nới loại thư theo lối cộng thêm
-- ------------------------------------------------------------
do $event_survey_kind$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('event_survey') in v_existing) > 0 then
    return;
  end if;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''event_survey''::text\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào outbound_emails_kind_check: %',
      v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$event_survey_kind$;

-- ------------------------------------------------------------
-- 7. Nới loại nhật ký theo lối cộng thêm, so trước/sau
-- ------------------------------------------------------------
do $event_survey_audit$
declare
  v_new constant text[] := array[
    'create_event_survey_link',
    'send_event_survey'
  ];
  v_existing      text;
  v_missing       text[];
  v_before_values text[];
  v_quotes        integer;
  v_suffix        text;
  v_rebuilt       text;
  v_after         text;
  v_after_values  text[];
  v_expected      text[];
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_existing not ilike '%= ANY (ARRAY[%' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check không ở dạng ANY (ARRAY[...]): %',
      v_existing;
  end if;

  select coalesce(array_agg(v order by v), '{}')
    into v_missing
  from unnest(v_new) as v
  where position(quote_literal(v) in v_existing) = 0;

  if cardinality(v_missing) = 0 then
    return;
  end if;

  select array_agg(m[1] order by m[1])
    into v_before_values
  from regexp_matches(v_existing, '''([^'']*)''::text', 'g') as m;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đọc hụt.
  v_quotes := length(v_existing) - length(replace(v_existing, '''', ''));
  if v_before_values is null or v_quotes <> cardinality(v_before_values) * 2 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đọc được % giá trị nhưng đếm được % dấu nháy trong admin_audit_log_action_type_check',
      coalesce(cardinality(v_before_values), 0), v_quotes;
  end if;

  select string_agg(format(', %L::text', v), '' order by v)
    into v_suffix
  from unnest(v_missing) as v;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', v_suffix || '\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào admin_audit_log_action_type_check: %',
      v_existing;
  end if;

  execute 'alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check';
  execute 'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');

  select pg_get_constraintdef(c.oid)
    into v_after
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1])
    into v_after_values
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  select array_agg(x order by x)
    into v_expected
  from (
    select unnest(v_before_values) as x
    union
    select unnest(v_missing)
  ) as s;

  -- Không mất giá trị cũ nào, không thừa giá trị lạ.
  if v_expected is distinct from v_after_values then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đã MẤT giá trị cũ hoặc thừa giá trị lạ khi nới admin_audit_log_action_type_check (trước % + thêm % → sau %)',
      cardinality(v_before_values), cardinality(v_missing), cardinality(v_after_values);
  end if;
end;
$event_survey_audit$;

-- ------------------------------------------------------------
-- 8. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $event_survey_self_check$
declare
  v_def    text;
  v_leaked text;
  v        text;
begin
  if to_regclass('public.event_survey_responses') is null
     or to_regclass('public.event_survey_recipients') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng event_survey_responses hoặc event_survey_recipients';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'survey_send_at'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: events.survey_send_at chưa được thêm';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.event_survey_responses'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.event_survey_recipients'::regclass) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS chưa bật trên bảng khảo sát';
  end if;

  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into v_leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('event_survey_responses', 'event_survey_recipients')
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng khảo sát lộ quyền cho %', v_leaked;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('event_survey_responses', 'event_survey_recipients')
      and grantee = 'service_role'
      and privilege_type = 'DELETE'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: service_role còn quyền DELETE trên bảng khảo sát';
  end if;

  -- Một người một phiếu: thiếu chỉ số này thì nộp lại sinh ra phiếu thứ hai, và
  -- ban tổ chức phải tự đoán phiếu nào là ý cuối cùng.
  if not exists (
    select 1
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = 'public.event_survey_responses'::regclass
      and ic.relname = 'event_survey_responses_once_uidx'
      and i.indisunique
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số duy nhất một phiếu mỗi người mỗi buổi';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.event_links'::regclass
    and c.conname = 'event_links_link_type_check';

  if position(quote_literal('survey') in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_links_link_type_check chưa nhận survey';
  end if;
  foreach v in array array['registration', 'checkin'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: event_links_link_type_check đã MẤT loại link cũ %', v;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('event_survey') in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận event_survey';
  end if;
  foreach v in array array['event_registration_confirmation', 'event_reminder', 'event_schedule_change'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check đã MẤT loại thư cũ %', v;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  foreach v in array array['create_event_survey_link', 'send_event_survey'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận %', v;
    end if;
  end loop;
  foreach v in array array['create_event', 'send_event_reminder', 'create_event_checkin_link'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$event_survey_self_check$;

notify pgrst, 'reload schema';

commit;
