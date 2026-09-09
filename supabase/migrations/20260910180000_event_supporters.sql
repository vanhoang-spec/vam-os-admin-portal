-- ============================================================
-- Event supporter — gắn theo từng buổi, không phải một vai trò toàn cục
-- ============================================================
--
-- Người đứng quét mã ở cửa cần đúng một quyền: quét mã của BUỔI ĐÓ. Họ không
-- cần xem danh sách ứng viên, không cần sửa sự kiện, không cần thấy sổ thư đi
-- — và một vai trò toàn cục mới sẽ cho họ tất cả những thứ đó ở mọi mùa.
--
-- Nên quyền này là một DÒNG GHÉP, không phải một giá trị trong `admin_users.role`:
-- người X hỗ trợ buổi Y. Hết buổi thì xoá dòng, và không gì còn lại.
--
-- Ba lý do chọn cách này thay vì thêm một vai trò:
--
--   1. Phạm vi đúng bằng nhu cầu. Một buổi orientation có sáu bạn hỗ trợ; họ
--      không có việc gì ở buổi phỏng vấn tuần sau.
--   2. Không đụng `admin_users.role`. Giá trị đó xuất hiện trong hàng chục
--      predicate phân quyền, và thêm một giá trị nghĩa là phải xét lại tất cả.
--   3. Thu hồi là xoá một dòng, không phải hạ cấp một tài khoản.
--
-- Supporter VẪN phải là `admin_users` đang hoạt động: họ cần đăng nhập được.
-- Dòng ghép chỉ mở thêm quyền quét, không thay cho việc có tài khoản.
--
-- ------------------------------------------------------------
-- HỢP ĐỒNG BẢO MẬT
-- ------------------------------------------------------------
-- Server-only: bật RLS, không policy, thu hồi mọi quyền của
-- PUBLIC/anon/authenticated, và thu hồi của service_role TRƯỚC khi cấp lại
-- (Supabase cấp sẵn ALL cho bảng mới qua `alter default privileges`).
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $event_supporters_prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần public.events';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần public.admin_users';
  end if;
end;
$event_supporters_prereq$;

create table if not exists public.event_supporters (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  added_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  note text null
);

comment on table public.event_supporters is
  'Ai được quét mã điểm danh cho một buổi cụ thể. Là dòng ghép chứ không phải một vai trò toàn cục: hết buổi thì xoá dòng, và không quyền nào còn lại.';

-- Một người một buổi một dòng. Thêm lại người đã có là thao tác vô hại chứ
-- không phải một dòng thứ hai.
create unique index if not exists event_supporters_once_uidx
  on public.event_supporters (event_id, admin_user_id);

-- "Ai hỗ trợ buổi này" — truy vấn của màn hình quản lý.
create index if not exists event_supporters_event_idx
  on public.event_supporters (event_id);

-- "Người này hỗ trợ buổi nào" — truy vấn của cổng quyền, chạy mỗi lần quét.
create index if not exists event_supporters_admin_idx
  on public.event_supporters (admin_user_id);

alter table public.event_supporters enable row level security;

revoke all on public.event_supporters from public, anon, authenticated;
revoke all on public.event_supporters from service_role;

-- Có DELETE ở đây, khác với event_scans: thu hồi quyền hỗ trợ là một thao tác
-- vận hành bình thường, còn xoá một lượt quét là xoá bằng chứng ai đã có mặt.
grant select, insert, delete on public.event_supporters to service_role;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $event_supporters_contract$
declare
  leaked text;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'event_supporters' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_supporters chưa bật RLS';
  end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'event_supporters'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng server-only mà có policy';
  end if;

  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'event_supporters'
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài: %', leaked;
  end if;

  -- UPDATE không có nghĩa gì trên một dòng ghép: đổi người hỗ trợ là xoá dòng
  -- cũ và thêm dòng mới, và như thế `created_at` nói đúng sự thật.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'event_supporters'
      and grantee = 'service_role'
      and privilege_type = 'UPDATE'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: event_supporters không cần quyền UPDATE';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_supporters_once_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc một người một buổi một dòng';
  end if;
end;
$event_supporters_contract$;

notify pgrst, 'reload schema';

commit;
