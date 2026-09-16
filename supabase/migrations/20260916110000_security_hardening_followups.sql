-- ═══════════════════════════════════════════════════════════════════════════
-- Dọn nốt hai cảnh báo còn lại của Supabase Advisor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sau bản vá 20260916090000 (bật RLS, thu hồi quyền của anon), Advisor sạch mọi
-- mục mức ERROR. Còn lại hai thứ sửa được bằng SQL:
--
--   1. 9 hàm chưa ấn định `search_path`.
--   2. Hàm trigger `vam069_assert_control_binding` vẫn còn quyền EXECUTE của
--      `authenticated` từ một lệnh cấp cũ.
--
-- ---------------------------------------------------------------------------
-- 1. VÌ SAO `search_path` CỦA HÀM LÀ CHUYỆN BẢO MẬT
-- ---------------------------------------------------------------------------
-- Hàm không ấn định `search_path` thì tên bảng bên trong nó được tra theo đường
-- dẫn của NGƯỜI GỌI. Người gọi tạo được một schema riêng đứng trước `public` là
-- mọi câu lệnh trong hàm đọc bảng của họ thay vì bảng thật — nguy hiểm nhất với
-- hàm SECURITY DEFINER, vì hàm ấy chạy bằng quyền chủ hàm.
--
-- Đặt `public, pg_temp` là theo đúng nếp đang có trong database này (11 hàm khác
-- đã dùng đúng giá trị đó). Giữ `public` ở đầu cũng là điều kiện để kiểu `citext`
-- của cột `people.email_primary` vẫn tra được — extension `citext` đang nằm
-- trong `public`.
--
-- ---------------------------------------------------------------------------
-- 2. HÀM TRIGGER KHÔNG CẦN AI GỌI THẲNG
-- ---------------------------------------------------------------------------
-- `vam069_assert_control_binding` chỉ chạy khi trigger nổ. Quyền EXECUTE của
-- `authenticated` không mở ra dữ liệu gì (gọi thẳng chỉ báo lỗi vì thiếu ngữ
-- cảnh trigger), nhưng một hàm SECURITY DEFINER ai cũng gọi được là bề mặt thừa.
--
-- ---------------------------------------------------------------------------
-- KHÔNG LÀM Ở ĐÂY: chuyển extension `citext` khỏi schema `public`
-- ---------------------------------------------------------------------------
-- Advisor có gợi ý việc đó, nhưng `people.email_primary` là kiểu `citext`, và
-- `service_role`, `authenticated`, `anon` đều KHÔNG đặt `search_path` riêng.
-- Chuyển extension sang schema khác làm toán tử so sánh của `citext` có thể
-- không còn nhìn thấy, tức là mọi phép tra email theo địa chỉ có thể hỏng. Đổi
-- lấy việc tắt một cảnh báo mức WARN thì không đáng. Muốn làm thì phải kèm đổi
-- `search_path` của các vai trò và kiểm lại từng đường đọc email — một việc
-- riêng, có kế hoạch lùi.
--
-- Chạy lại vô hại. Không đụng tới một dòng dữ liệu nào.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

-- ── 1. Ấn định search_path cho mọi hàm của mình còn thiếu ───────────────────
-- Quét động: thứ cần đúng là "không còn hàm nào thiếu", kể cả hàm thêm sau này.
-- Hàm của extension bị loại ra — chúng thuộc về extension, không phải của mình.
do $set_search_path$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg where cfg like 'search_path=%'
      )
    order by 1
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.fn);
    n := n + 1;
  end loop;
  raise notice 'HARDENING: ấn định search_path cho % hàm', n;
end;
$set_search_path$;

-- ── 2. Hàm trigger: chỉ service_role giữ quyền ──────────────────────────────
do $trigger_function_grants$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
    order by 1
  loop
    execute format('revoke all on function %s from public', r.fn);
    execute format('revoke all on function %s from anon', r.fn);
    execute format('revoke all on function %s from authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
    n := n + 1;
  end loop;
  raise notice 'HARDENING: khoá % hàm trigger', n;
end;
$trigger_function_grants$;

-- ── 3. Tự kiểm ──────────────────────────────────────────────────────────────
do $self_check$
declare
  v_missing text[];
  v_triggers text[];
begin
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
    into v_missing
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg where cfg like 'search_path=%');

  if cardinality(v_missing) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: còn hàm chưa ấn định search_path: %', v_missing;
  end if;

  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
    into v_triggers
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prorettype = 'pg_catalog.trigger'::regtype
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));

  if cardinality(v_triggers) > 0 then
    raise exception 'SECURITY_CONTRACT_VIOLATION: hàm trigger vẫn gọi thẳng được: %', v_triggers;
  end if;

  -- Bản vá trước phải còn nguyên: không bảng nào hở, anon không còn quyền bảng.
  if exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    raise exception 'SECURITY_CONTRACT_VIOLATION: có bảng public chưa bật RLS';
  end if;

  -- Đường của ứng dụng còn nguyên.
  if not has_function_privilege('service_role', 'public.vam069_set_application_form_state(uuid,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_operations_dashboard_data(text)', 'execute')
     or not has_table_privilege('service_role', 'public.people', 'select') then
    raise exception 'SECURITY_CONTRACT_VIOLATION: đường của ứng dụng bị chạm — dừng lại';
  end if;

  -- Trên Production cột people.email_primary là citext; trên Staging là text
  -- (xem 20260904070000). Ở đâu là citext thì thử một phép so sánh thật, để
  -- search_path vừa đặt không lặng lẽ làm hỏng mọi phép tra email.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'people'
      and column_name = 'email_primary' and udt_name = 'citext'
  ) then
    perform 1 from public.people where email_primary = 'probe@example.invalid' limit 1;
  else
    raise notice 'HARDENING: people.email_primary không phải citext ở môi trường này; bỏ qua phép thử';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
