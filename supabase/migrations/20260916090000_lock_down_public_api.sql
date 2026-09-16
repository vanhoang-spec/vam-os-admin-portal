-- ═══════════════════════════════════════════════════════════════════════════
-- Khoá API công khai: bật RLS cho mọi bảng, thu hồi quyền của vai trò anon
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SỰ VIỆC ĐÃ XÁC MINH TRÊN PRODUCTION (16/09/2026)
-- ---------------------------------------------------------------------------
-- Khoá công khai của ứng dụng nằm sẵn trong mã JavaScript của trang web — đúng
-- theo thiết kế của Supabase, ai mở trang cũng lấy được. Với khoá đó, gọi thẳng
-- vào PostgREST, vai trò `anon` ĐỌC ĐƯỢC 27 bảng, trong đó:
--
--   event_registrations                588 dòng — họ tên, email, SĐT, MSSV
--   staging_application_answers_import 15.207 dòng
--   mentoring_recaps                   2.447 dòng
--   person_roles / staging_people_import  1.331 dòng
--   matches 637 · event_participations 952 · staging_applications_import 888
--
-- và CÒN GHI ĐƯỢC: lệnh POST thử với một tên cột không tồn tại trả về 400
-- (sai dữ liệu) chứ không phải 401 (không có quyền) — nghĩa là quyền insert có
-- thật. Vai trò `anon` cũng gọi được hàm `get_operations_dashboard_data` và đọc
-- được ba view `v_*`.
--
-- Nguyên nhân: các bảng này ở schema `public` nhưng chưa bật RLS, trong khi
-- Supabase mặc định cấp quyền bảng cho `anon` và `authenticated`. Không bật RLS
-- nghĩa là không có gì chặn.
--
-- ---------------------------------------------------------------------------
-- BẢN VÁ NÀY LÀM GÌ
-- ---------------------------------------------------------------------------
--   1. Bật RLS cho MỌI bảng trong schema public còn thiếu. Không policy nào
--      được thêm, nên mặc định là cấm — trừ các bảng đã có policy sẵn, chúng
--      bắt đầu có hiệu lực đúng như người viết đã định.
--   2. Thu hồi toàn bộ quyền của `anon` trên bảng, view, sequence và hàm.
--      `anon` không cần gì trong schema này: đăng nhập đi qua Supabase Auth,
--      còn mọi lượt đọc/ghi dữ liệu của app đều dùng service role ở máy chủ.
--   3. Ba view `v_*` chuyển sang chạy theo quyền NGƯỜI GỌI (security_invoker),
--      nên chúng không còn là đường vòng qua mặt RLS của bảng gốc.
--   4. Chặn cả quyền mặc định cho bảng/hàm tạo về sau, để lỗi này không tự
--      quay lại cùng bảng mới.
--
-- GIỮ NGUYÊN, CÓ CHỦ Ý
--   * `service_role` không bị đụng tới: nó bỏ qua RLS, và đây là đường mà toàn
--     bộ ứng dụng đọc ghi dữ liệu.
--   * `authenticated` giữ nguyên quyền: RLS giờ mới là thứ quyết định nó thấy
--     gì. App cần nó cho RPC `get_operations_dashboard_data` (hàm đọc auth.uid()
--     nên phải gọi bằng JWT của người dùng, không phải service role) và cho các
--     hàm kiểm quyền mà policy gọi tới.
--
-- Chạy lại vô hại. Không đụng tới một dòng dữ liệu nào.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

-- ── 1. Bật RLS cho mọi bảng public ──────────────────────────────────────────
-- Quét động thay vì liệt kê tên: danh sách bảng thiếu RLS hôm nay là 31, nhưng
-- thứ cần đúng là "không còn bảng nào", kể cả bảng vừa thêm tuần trước.
do $enable_rls$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
    order by 1
  loop
    execute format('alter table %s enable row level security', r.tbl);
    n := n + 1;
  end loop;
  raise notice 'LOCKDOWN: bật RLS cho % bảng', n;
end;
$enable_rls$;

-- ── 2. Ba view chạy theo quyền người gọi ────────────────────────────────────
-- View trong Postgres mặc định chạy bằng quyền của CHỦ view, nên một view đọc
-- bảng đã bật RLS vẫn trả dữ liệu ra cho người không được phép. security_invoker
-- làm view tôn trọng RLS của người gọi. service_role vẫn đọc đủ vì nó bỏ qua RLS.
do $views_invoker$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.oid::regclass as v
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'v'
      and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%'
    order by 1
  loop
    execute format('alter view %s set (security_invoker = on)', r.v);
    n := n + 1;
  end loop;
  raise notice 'LOCKDOWN: % view chuyển sang security_invoker', n;
end;
$views_invoker$;

-- ── 3. Thu hồi quyền của anon ───────────────────────────────────────────────
-- `anon` là vai trò của bất kỳ ai cầm khoá công khai — tức là bất kỳ ai. Trong
-- schema này nó không có việc gì để làm.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all routines in schema public from anon;

-- ── 4. Bảng và hàm tạo về sau cũng không cấp cho anon ───────────────────────
-- Áp cho các đối tượng do chính vai trò đang chạy migration này tạo ra — cùng
-- vai trò đã tạo mọi bảng hiện có.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ── 5. Tự kiểm ──────────────────────────────────────────────────────────────
-- Một bản vá bảo mật báo thành công trong khi vẫn còn một bảng hở thì tệ hơn
-- không vá, vì nó tạo cảm giác đã xong.
do $self_check$
declare
  v_open_tables text[];
  v_anon_tables text[];
  v_anon_funcs  text[];
  v_views       text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_open_tables
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if cardinality(v_open_tables) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: còn bảng chưa bật RLS: %', v_open_tables;
  end if;

  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_anon_tables
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind in ('r', 'v', 'm', 'p')
    and (has_table_privilege('anon', c.oid, 'select')
      or has_table_privilege('anon', c.oid, 'insert')
      or has_table_privilege('anon', c.oid, 'update')
      or has_table_privilege('anon', c.oid, 'delete'));

  if cardinality(v_anon_tables) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: anon vẫn còn quyền trên: %', v_anon_tables;
  end if;

  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_anon_funcs
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

  if cardinality(v_anon_funcs) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: anon vẫn gọi được hàm: %', v_anon_funcs;
  end if;

  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_views
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%';

  if cardinality(v_views) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: view chưa chạy theo quyền người gọi: %', v_views;
  end if;

  -- Đường của ứng dụng phải còn nguyên, nếu không thì cả CRM sập ngay sau khi vá.
  if not has_table_privilege('service_role', 'public.people', 'select')
     or not has_table_privilege('service_role', 'public.event_registrations', 'select')
     or not has_table_privilege('service_role', 'public.applications', 'select') then
    raise exception 'SECURITY_CONTRACT_VIOLATION: service_role mất quyền đọc — dừng lại';
  end if;

  if not has_function_privilege('authenticated', 'public.get_operations_dashboard_data(text)', 'execute') then
    raise exception 'SECURITY_CONTRACT_VIOLATION: authenticated mất quyền gọi get_operations_dashboard_data';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
