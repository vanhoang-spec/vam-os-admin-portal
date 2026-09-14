-- ============================================================
-- "Gửi remind": thư nhắc lịch một buổi sự kiện
-- ============================================================
--
-- Ban tổ chức bấm "Gửi remind" trên trang một buổi, nhập lại ngày của buổi,
-- xác nhận, và hệ thống gửi thư nhắc tới mọi người đang giữ chỗ — kèm thông tin
-- mới nhất lúc gửi.
--
-- ============================================================
-- VÌ SAO CẦN HAI BẢNG, KHÔNG CHỈ GHI SỔ THƯ
-- ============================================================
-- Một buổi có thể có hai trăm người giữ chỗ. Không lần gọi máy chủ nào gửi hết
-- hai trăm thư mà chắc chắn không bị cắt giữa chừng, nên việc gửi chia thành
-- nhiều lần gọi. Giữa các lần gọi phải nhớ được ai đã nhận, ai chưa:
--
--   event_reminder_runs        — một lượt gửi: của buổi nào, ai bấm, ngày họ đã
--                                nhập lại, và đang chạy / xong / đã dừng.
--   event_reminder_recipients  — danh sách người nhận CHỐT lúc bấm, mỗi người
--                                một dòng mang kết quả của riêng họ.
--
-- Nhờ vậy:
--   * Bấm hai lần, hay mở hai tab, không ai nhận hai thư: một thư chỉ được gửi
--     sau khi dòng của nó được CHIẾM (queued → sending) bằng một lệnh ghi có điều
--     kiện, và hai lần chiếm cùng một dòng thì chỉ một lần thắng.
--   * Đóng tab giữa chừng thì bấm "Gửi tiếp" để gửi phần còn lại.
--   * Thư lỗi (ví dụ hết hạn mức) gửi lại được cho riêng người lỗi, không phải
--     gửi lại cho cả buổi.
--
-- Một buổi chỉ có MỘT lượt đang chạy tại một thời điểm (unique index một phần).
--
-- Kèm theo: nới hai danh sách đóng theo lối cộng thêm —
--   outbound_emails_kind_check          + 'event_reminder'
--   admin_audit_log_action_type_check   + 'send_event_reminder',
--                                         'retry_event_reminder',
--                                         'cancel_event_reminder'
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $event_reminders_prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.events';
  end if;
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.event_registrations';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.admin_users';
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
$event_reminders_prereq$;

-- ------------------------------------------------------------
-- 1. Lượt gửi
-- ------------------------------------------------------------
create table if not exists public.event_reminder_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- Người rời ban tổ chức không được xoá dấu vết ai đã gửi.
  created_by uuid null references public.admin_users(id) on delete set null,
  -- Ngày người bấm đã nhập lại để xác nhận — lưu lại để tra được về sau.
  confirmed_event_date date not null,
  status text not null default 'running',
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint event_reminder_runs_status_check
    check (status in ('running', 'completed', 'cancelled')),
  constraint event_reminder_runs_recipient_count_check
    check (recipient_count >= 0),
  -- Đang chạy thì chưa có giờ kết thúc, đã kết thúc thì phải có.
  constraint event_reminder_runs_finished_shape_check
    check ((status = 'running') = (finished_at is null))
);

-- Một buổi chỉ một lượt đang chạy. Lượt thứ hai chạy song song là hai danh sách
-- chồng lên nhau, và mỗi người trong phần chung nhận hai thư.
create unique index if not exists event_reminder_runs_one_running_uidx
  on public.event_reminder_runs (event_id)
  where status = 'running';

create index if not exists event_reminder_runs_event_idx
  on public.event_reminder_runs (event_id, created_at desc);

-- ------------------------------------------------------------
-- 2. Người nhận của một lượt
-- ------------------------------------------------------------
create table if not exists public.event_reminder_recipients (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.event_reminder_runs(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  status text not null default 'queued',
  attempted_at timestamptz null,
  error text null,
  created_at timestamptz not null default now(),
  constraint event_reminder_recipients_status_check
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  -- Mỗi người một dòng trong một lượt: danh sách chốt không thể chứa ai hai lần.
  constraint event_reminder_recipients_once unique (run_id, registration_id)
);

create index if not exists event_reminder_recipients_run_status_idx
  on public.event_reminder_recipients (run_id, status);

-- ------------------------------------------------------------
-- 3. Quyền: chỉ máy chủ, không xoá
-- ------------------------------------------------------------
alter table public.event_reminder_runs enable row level security;
alter table public.event_reminder_recipients enable row level security;

revoke all on public.event_reminder_runs from public, anon, authenticated;
revoke all on public.event_reminder_recipients from public, anon, authenticated;

-- THU HỒI CỦA service_role TRƯỚC KHI CẤP LẠI. Supabase đặt default privileges
-- trên schema public, nên bảng vừa tạo đã mang sẵn ALL cho service_role — DELETE
-- nằm trong đó. Chỉ viết `grant` là chồng thêm lên quyền vốn đã bao trọn.
revoke all on public.event_reminder_runs from service_role;
revoke all on public.event_reminder_recipients from service_role;

-- Không cấp DELETE: danh sách này trả lời câu "ai đã được nhắc, lúc nào".
grant select, insert, update on public.event_reminder_runs to service_role;
grant select, insert, update on public.event_reminder_recipients to service_role;

-- ------------------------------------------------------------
-- 4. Nới loại thư theo lối cộng thêm
-- ------------------------------------------------------------
do $event_reminders_kind$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('event_reminder') in v_existing) > 0 then
    return;
  end if;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''event_reminder''::text\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào outbound_emails_kind_check: %',
      v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$event_reminders_kind$;

-- ------------------------------------------------------------
-- 5. Nới loại nhật ký theo lối cộng thêm, so trước/sau
-- ------------------------------------------------------------
do $event_reminders_audit$
declare
  v_new constant text[] := array[
    'send_event_reminder',
    'retry_event_reminder',
    'cancel_event_reminder'
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
$event_reminders_audit$;

-- ------------------------------------------------------------
-- 6. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $event_reminders_self_check$
declare
  v_def       text;
  v_predicate text;
  v_leaked    text;
  v           text;
begin
  if to_regclass('public.event_reminder_runs') is null
     or to_regclass('public.event_reminder_recipients') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng event_reminder_runs hoặc event_reminder_recipients';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.event_reminder_runs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.event_reminder_recipients'::regclass) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS chưa bật trên bảng remind';
  end if;

  select pg_get_expr(i.indpred, i.indrelid)
    into v_predicate
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  where i.indrelid = 'public.event_reminder_runs'::regclass
    and ic.relname = 'event_reminder_runs_one_running_uidx'
    and i.indisunique;

  if v_predicate is null or position('running' in v_predicate) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu unique index một lượt đang chạy mỗi buổi';
  end if;

  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into v_leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('event_reminder_runs', 'event_reminder_recipients')
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng remind lộ quyền cho %', v_leaked;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('event_reminder_runs', 'event_reminder_recipients')
      and grantee = 'service_role'
      and privilege_type = 'DELETE'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: service_role còn quyền DELETE trên bảng remind';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('event_reminder') in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận event_reminder';
  end if;
  foreach v in array array['event_registration_confirmation', 'event_schedule_change', 'staff_invite'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check đã MẤT loại thư cũ %', v;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  foreach v in array array['send_event_reminder', 'retry_event_reminder', 'cancel_event_reminder'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận %', v;
    end if;
  end loop;
  foreach v in array array['create_event', 'add_event_series_session', 'notify_event_schedule_change'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$event_reminders_self_check$;

notify pgrst, 'reload schema';

commit;
