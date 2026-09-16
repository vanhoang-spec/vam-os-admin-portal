-- ═══════════════════════════════════════════════════════════════════════════
-- Ngày nộp đơn theo lịch Việt Nam
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 16/09/2026, chủ dự án: sửa cột "Ngày nộp" lệch giờ.
--
-- applications.submitted_at là cột DATE, và cả hai chỗ ghi vào nó đều ghi NGÀY UTC:
--
--   1. Form nộp đơn (lib/applications-create.ts): toISOString().slice(0, 10).
--      Đã sửa trong mã, cùng PR với file này.
--   2. Hàm gia hạn mentor vam071_submit_renewal_accepted: ghi v_now (timestamptz)
--      thẳng vào cột DATE. Postgres ép kiểu theo múi giờ của phiên — trên Supabase
--      là UTC. Sửa ở mục 1 dưới đây.
--
-- Hệ quả: đơn nộp từ 00:00 đến 06:59 sáng giờ Việt Nam mang ngày hôm trước. Đo ngày
-- 16/09/2026: 30 đơn mentee, 4 đơn mentor qua form, 6 đơn gia hạn mentor. Mục 2
-- chỉnh lại đúng những đơn đó.
--
-- MỤC 1 VÁ HÀM ĐANG CHẠY, KHÔNG CHÉP LẠI CẢ HÀM
--   Hàm dài, SECURITY DEFINER, và là cửa công khai của link gia hạn. Chép lại toàn
--   bộ nghĩa là mọi khác biệt nhỏ giữa file trong repo và bản đang chạy trên
--   Production đều bị ghi đè lặng lẽ. Khối dưới đây đọc định nghĩa ĐANG CHẠY, thay
--   đúng một dòng, và tự chứng minh phần còn lại không đổi một ký tự: đảo phép thay
--   thì phải ra đúng md5 của bản cũ. Quyền thực thi, SECURITY DEFINER và
--   search_path được so trước/sau.
--
-- MỤC 2 CHỈ CHẠM ĐƠN MANG ĐÚNG DẤU VẾT CỦA LỖI
--   Nguồn là một trong hai chỗ ghi ở trên, submitted_at bằng NGÀY UTC của
--   created_at, và khác ngày Việt Nam của created_at. Đơn S11 nhập tay (source
--   'manual') không được đụng: created_at của chúng là lúc nhập, không phải lúc nộp.
--   Một đơn mà ai đó đã sửa ngày bằng tay sẽ không còn khớp dấu vết, nên cũng
--   không bị ghi đè.
--
-- Chạy lại vô hại: hàm đã vá thì bỏ qua; đơn đã đúng thì không còn khớp dấu vết.
--
-- LÙI LẠI NẾU CẦN
--   Hàm: chạy lại khối vá với hai chuỗi đổi chỗ cho nhau.
--   Dữ liệu (chỉ những đơn tạo trước khi chạy file này):
--     update public.applications
--        set submitted_at = (created_at at time zone 'UTC')::date
--      where source in ('vam_os_form', 's12_mentor_renewal')
--        and created_at < '<thời điểm chạy file này>'
--        and submitted_at = (created_at at time zone 'Asia/Ho_Chi_Minh')::date
--        and submitted_at <> (created_at at time zone 'UTC')::date;
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

do $preflight$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications'
      and column_name = 'submitted_at' and data_type = 'date'
  ) then
    raise exception 'PREREQ_MISSING: applications.submitted_at không còn là cột DATE — dừng lại, đừng áp phép sửa này';
  end if;
  if to_regprocedure('public.vam071_submit_renewal_accepted(text, jsonb, boolean)') is null then
    raise exception 'PREREQ_MISSING: cần hàm public.vam071_submit_renewal_accepted(text, jsonb, boolean)';
  end if;
end;
$preflight$;

-- ── 1. Vá hàm gia hạn mentor ────────────────────────────────────────────────
do $patch_renewal$
declare
  v_fn       constant regprocedure := 'public.vam071_submit_renewal_accepted(text, jsonb, boolean)'::regprocedure;
  v_old_tail constant text := '    v_now' || chr(10) || '  )' || chr(10) || '  returning id into v_app_id;';
  v_new_tail constant text := '    (v_now at time zone ''Asia/Ho_Chi_Minh'')::date' || chr(10) || '  )' || chr(10) || '  returning id into v_app_id;';
  v_def      text;
  v_new_def  text;
  v_matches  integer;
  v_acl      text;
  v_secdef   boolean;
  v_config   text;
  v_after    text;
begin
  select pg_get_functiondef(p.oid), coalesce(array_to_string(p.proacl, ','), ''), p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '')
    into v_def, v_acl, v_secdef, v_config
  from pg_proc p
  where p.oid = v_fn;

  if position(v_new_tail in v_def) > 0 then
    raise notice 'VN_DATE: hàm gia hạn đã ghi ngày Việt Nam; không làm gì.';
    return;
  end if;

  v_matches := (length(v_def) - length(replace(v_def, v_old_tail, ''))) / length(v_old_tail);
  if v_matches <> 1 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đoạn ghi submitted_at của vam071_submit_renewal_accepted khớp % lần (cần đúng 1) — hàm đang chạy khác bản đã đọc ngày 16/09/2026',
      v_matches;
  end if;

  v_new_def := replace(v_def, v_old_tail, v_new_tail);

  -- Phần còn lại không đổi một ký tự: đảo phép thay phải ra đúng bản cũ.
  if md5(replace(v_new_def, v_new_tail, v_old_tail)) <> md5(v_def) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: phép vá đổi nhiều hơn một dòng';
  end if;

  execute v_new_def;

  select pg_get_functiondef(p.oid)
    into v_after
  from pg_proc p
  where p.oid = v_fn;

  if position(v_new_tail in v_after) = 0 or position(v_old_tail in v_after) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm gia hạn chưa nhận bản vá';
  end if;

  if (select coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.oid = v_fn) <> v_acl then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền thực thi của hàm gia hạn đã đổi sau khi vá';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_fn) is distinct from v_secdef then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: SECURITY DEFINER của hàm gia hạn đã đổi sau khi vá';
  end if;
  if (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = v_fn) <> v_config then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: search_path của hàm gia hạn đã đổi sau khi vá';
  end if;

  raise notice 'VN_DATE: đã vá hàm gia hạn — submitted_at ghi ngày theo giờ Việt Nam.';
end;
$patch_renewal$;

-- ── 2. Chỉnh các đơn đã lệch ngày ───────────────────────────────────────────
do $fix_rows$
declare
  v_before integer;
  v_fixed  integer;
begin
  select count(*)
    into v_before
  from public.applications a
  where a.source in ('vam_os_form', 's12_mentor_renewal')
    and a.submitted_at = (a.created_at at time zone 'UTC')::date
    and a.submitted_at <> (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date;

  update public.applications a
     set submitted_at = (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date
   where a.source in ('vam_os_form', 's12_mentor_renewal')
     and a.submitted_at = (a.created_at at time zone 'UTC')::date
     and a.submitted_at <> (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date;
  get diagnostics v_fixed = row_count;

  if v_fixed <> v_before then
    raise exception 'DATA_CONTRACT_VIOLATION: đếm được % đơn lệch nhưng chỉnh % đơn', v_before, v_fixed;
  end if;

  raise notice 'VN_DATE: đã chỉnh ngày nộp của % đơn.', v_fixed;
end;
$fix_rows$;

-- ── 3. Tự kiểm ──────────────────────────────────────────────────────────────
do $self_check$
declare
  v_left     integer;
  v_other    integer;
begin
  -- Không còn đơn nào mang dấu vết lỗi.
  select count(*)
    into v_left
  from public.applications a
  where a.source in ('vam_os_form', 's12_mentor_renewal')
    and a.submitted_at = (a.created_at at time zone 'UTC')::date
    and a.submitted_at <> (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if v_left > 0 then
    raise exception 'DATA_CONTRACT_VIOLATION: còn % đơn ghi ngày UTC', v_left;
  end if;

  -- Đơn của hai nguồn này mà ngày vẫn khác ngày Việt Nam thì không phải do lỗi này
  -- (có người đã sửa tay). Không raise — chỉ báo để người chạy biết là có.
  select count(*)
    into v_other
  from public.applications a
  where a.source in ('vam_os_form', 's12_mentor_renewal')
    and a.submitted_at is distinct from (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if v_other > 0 then
    raise notice 'VN_DATE: % đơn có ngày nộp khác ngày tạo nhưng không mang dấu vết lỗi UTC — không đụng tới.', v_other;
  end if;

  if position(
       '(v_now at time zone ''Asia/Ho_Chi_Minh'')::date'
       in pg_get_functiondef('public.vam071_submit_renewal_accepted(text, jsonb, boolean)'::regprocedure)
     ) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm gia hạn vẫn ghi ngày UTC';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
