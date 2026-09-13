-- ============================================================
-- Nhật ký cho các thao tác trên chuỗi sự kiện
-- ============================================================
--
-- VẤN ĐỀ ĐÃ XÁC NHẬN TRÊN PRODUCTION (13/09/2026, truy vấn chỉ đọc)
-- ------------------------------------------------------------
-- Mã ghi bốn loại nhật ký mà ràng buộc `admin_audit_log_action_type_check`
-- không nhận:
--   'add_event_series_session'      — thêm một buổi vào chuỗi
--   'remove_event_series_session'   — xoá một buổi khỏi chuỗi
--   'update_event_session_time'     — dời giờ một buổi
--   'notify_event_schedule_change'  — gửi thư báo đổi lịch
--
-- Số dòng nhật ký của cả bốn loại là 0, dù sáng 13/09 đã có một buổi thật được
-- thêm vào chuỗi "Mentee Orientation Mùa 12". Mỗi lần ghi bị từ chối 23514, và
-- hàm ghi nhật ký bắt lỗi rồi chỉ log — nên thao tác vẫn báo thành công, còn
-- dấu vết thì mất, và không ai biết.
--
-- ============================================================
-- VÌ SAO NỚI BẰNG CÁCH NỐI VÀO ĐUÔI
-- ============================================================
-- Đọc lại định nghĩa đang chạy bằng pg_get_constraintdef rồi nối bốn giá trị
-- vào trước dấu đóng mảng, thay vì viết đè cả danh sách: viết đè là phải chép
-- lại đúng 58 giá trị đang có, và chép thiếu một giá trị thì mọi thao tác loại
-- đó lặng lẽ ngừng được ghi nhật ký — đúng lỗi mà migration này sửa.
--
-- Đuôi được tìm bằng mẫu một-hoặc-nhiều `(\]\)+)$`, không đếm cứng số dấu đóng
-- ngoặc: định nghĩa đọc lại có thể kết thúc bằng ba hay bốn dấu tuỳ vế điều
-- kiện (xem 20260913210000_email_batches_audience_groups.sql).
--
-- Chỉ nối giá trị còn thiếu, nên chạy lại lần hai không nhân đôi và vô hại.
-- Không có dòng dữ liệu nào bị đụng tới: nới một danh sách cho phép thì mọi
-- dòng cũ vẫn hợp lệ.
-- ============================================================

begin;

do $audit_series_prereq$
begin
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.admin_audit_log';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_audit_log'::regclass
      and conname = 'admin_audit_log_action_type_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc admin_audit_log_action_type_check';
  end if;
end;
$audit_series_prereq$;

-- ------------------------------------------------------------
-- 1. Nới ràng buộc theo lối cộng thêm, và so trước/sau ngay trong khối
-- ------------------------------------------------------------
do $audit_series_widen$
declare
  v_new constant text[] := array[
    'add_event_series_session',
    'remove_event_series_session',
    'update_event_session_time',
    'notify_event_schedule_change'
  ];
  v_existing      text;
  v_missing       text[];
  v_before_values text[];
  v_quotes        integer;
  v_suffix        text;
  v_rebuilt       text;
  v_after         text;
  v_after_values  text[];
  v_lost          text[];
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

  -- Chỉ những giá trị chưa có. Chạy lại lần hai thì danh sách này rỗng.
  select coalesce(array_agg(v order by v), '{}')
    into v_missing
  from unnest(v_new) as v
  where position(quote_literal(v) in v_existing) = 0;

  if cardinality(v_missing) = 0 then
    raise notice 'AUDIT_SERIES: ràng buộc đã nhận đủ bốn giá trị; không làm gì.';
    return;
  end if;

  select array_agg(m[1] order by m[1])
    into v_before_values
  from regexp_matches(v_existing, '''([^'']*)''::text', 'g') as m;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đọc hụt — và so
  -- trước/sau trên một tập đọc hụt thì không chứng minh được gì.
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

  -- Không được mất giá trị cũ nào.
  select coalesce(array_agg(b order by b), '{}')
    into v_lost
  from unnest(v_before_values) as b
  where not (b = any (coalesce(v_after_values, '{}')));

  if cardinality(v_lost) > 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ: %',
      v_lost;
  end if;

  -- Và tập sau phải đúng bằng tập trước cộng các giá trị còn thiếu — không hơn.
  select array_agg(x order by x)
    into v_expected
  from (
    select unnest(v_before_values) as x
    union
    select unnest(v_missing)
  ) as s;

  if v_expected is distinct from v_after_values then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: tập giá trị sau khi nới không khớp tập mong đợi (trước % + thêm % → sau %)',
      cardinality(v_before_values), cardinality(v_missing), cardinality(v_after_values);
  end if;

  raise notice 'AUDIT_SERIES: nới từ % lên % giá trị (thêm: %).',
    cardinality(v_before_values), cardinality(v_after_values), v_missing;
end;
$audit_series_widen$;

-- ------------------------------------------------------------
-- 2. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $audit_series_self_check$
declare
  v_def text;
  v     text;
begin
  select pg_get_constraintdef(c.oid)
    into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc admin_audit_log_action_type_check';
  end if;

  foreach v in array array[
    'add_event_series_session',
    'remove_event_series_session',
    'update_event_session_time',
    'notify_event_schedule_change'
  ] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận %', v;
    end if;
  end loop;

  -- Giá trị cũ canh gác: nới mà làm mất nhật ký tạo sự kiện hay đổi quyền nhân
  -- sự thì tệ hơn không nới.
  foreach v in array array[
    'create_event',
    'update_event',
    'update_admin_user',
    'participant_account_invite',
    'send_application_confirmation_backfill'
  ] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$audit_series_self_check$;

commit;
