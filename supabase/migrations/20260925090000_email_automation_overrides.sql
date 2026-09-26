-- ============================================================================
-- Nội dung sửa được của những lá thư hệ thống TỰ GỬI.
--
-- Trước migration này, câu chữ của 16 lá thư tự động nằm trong các hàm dựng thư
-- ở lib/email-core.ts, và đổi một câu là một lần deploy. Màn hình "Thư tự động"
-- cho core team / support team sửa và lưu; từ sau lúc lưu, hệ thống gửi nội
-- dung mới.
--
-- HAI BẢNG, VÀ VÌ SAO LÀ HAI
--   `email_automation_overrides` giữ nội dung ĐANG DÙNG — mỗi lá thư nhiều nhất
--   một dòng. Không có dòng nghĩa là đang dùng bản mặc định trong mã nguồn, nên
--   "trả về mặc định" là XOÁ dòng, không phải ghi đè một bản chép của mã nguồn.
--
--   `email_automation_override_log` giữ MỌI phiên bản đã từng lưu. Thư tự động
--   đi im lặng tới hàng trăm người; khi có người phát hiện một câu sai thì câu
--   hỏi đầu tiên luôn là "ai sửa, lúc nào, và trước đó viết gì". Một bảng chỉ
--   giữ bản mới nhất không trả lời được câu đó.
--
-- QUYỀN
--   Bảng mới trong `public` mặc định được Supabase cấp cho `anon` — khoá công
--   khai nằm sẵn trong mã trang web, ai cũng lấy được. Và `service_role` mặc
--   định đã có ALL, nên `grant` không thu hẹp gì nếu không `revoke` trước.
--   Xem CLAUDE.md, mục Vận hành, và migration 20260916090000.
-- ============================================================================

begin;

-- ── Bảng nội dung đang dùng ─────────────────────────────────────────────────

create table if not exists public.email_automation_overrides (
  id uuid primary key default gen_random_uuid(),
  -- Khoá bền của một lá thư, do lib/email-automation-core.ts đặt. CỐ Ý KHÔNG
  -- phải `kind` của sổ thư: một `kind` mang được hai lá thư khác nhau
  -- (interview_scheduled gửi ứng viên và gửi người phỏng vấn), nên lấy `kind`
  -- làm khoá là để hai lá thư giẫm lên nhau.
  slot_id text not null unique,
  subject text not null,
  body text not null,
  updated_by uuid references public.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_automation_overrides is
  'Nội dung do ban tổ chức sửa cho thư tự động. Không có dòng = đang dùng bản mặc định trong mã nguồn.';

-- ── Bảng lịch sử ────────────────────────────────────────────────────────────

create table if not exists public.email_automation_override_log (
  id uuid primary key default gen_random_uuid(),
  slot_id text not null,
  action text not null,
  -- Nội dung TRƯỚC thao tác. Null ở lần lưu đầu tiên, vì trước đó là bản mặc định.
  subject_before text,
  body_before text,
  -- Nội dung SAU thao tác. Null khi trả về mặc định.
  subject_after text,
  body_after text,
  changed_by uuid references public.admin_users (id) on delete set null,
  changed_by_name text,
  changed_at timestamptz not null default now(),
  constraint email_automation_override_log_action_check
    check (action in ('save', 'revert'))
);

create index if not exists email_automation_override_log_slot_idx
  on public.email_automation_override_log (slot_id, changed_at desc);

comment on table public.email_automation_override_log is
  'Mọi phiên bản đã từng lưu của thư tự động, để trả lời "ai sửa, lúc nào, trước đó viết gì".';

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Bật RLS và KHÔNG tạo policy nào: chỉ service_role chạm được hai bảng này.
-- Đây là cách cả 82 bảng của hệ thống được khoá, không phải một thiếu sót.

alter table public.email_automation_overrides enable row level security;
alter table public.email_automation_override_log enable row level security;

-- ── Quyền ───────────────────────────────────────────────────────────────────

revoke all on table public.email_automation_overrides from public, anon, authenticated, service_role;
revoke all on table public.email_automation_override_log from public, anon, authenticated, service_role;

-- Bảng nội dung: có DELETE, vì "trả về mặc định" là xoá dòng.
grant select, insert, update, delete on table public.email_automation_overrides to service_role;

-- Bảng lịch sử: KHÔNG có update và KHÔNG có delete. Một nhật ký sửa được
-- không phải là một nhật ký.
grant select, insert on table public.email_automation_override_log to service_role;

-- ── Tự kiểm ─────────────────────────────────────────────────────────────────
--
-- Migration báo thành công trong khi quyền chưa siết là thứ chỉ lộ ra vào đúng
-- lúc cần nó nhất.

do $$
declare
  v_acl text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_automation_overrides' and c.relrowsecurity
  ) then
    raise exception 'email_automation_overrides: chua bat RLS';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_automation_override_log' and c.relrowsecurity
  ) then
    raise exception 'email_automation_override_log: chua bat RLS';
  end if;

  -- So khớp CHÍNH XÁC chuỗi quyền, không dùng position(): tìm 'd' trong một
  -- chuỗi quyền cũng khớp cả 'D' (TRUNCATE) tuỳ cách viết, và một phép kiểm
  -- gần đúng ở đây thì không kiểm gì cả.
  select array_to_string(array(
    select a.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relname = 'email_automation_overrides'
      and a.grantee = 'service_role'::regrole
    order by 1
  ), ',') into v_acl;
  if v_acl <> 'DELETE,INSERT,SELECT,UPDATE' then
    raise exception 'email_automation_overrides: quyen service_role sai, dang la "%"', v_acl;
  end if;

  select array_to_string(array(
    select a.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relname = 'email_automation_override_log'
      and a.grantee = 'service_role'::regrole
    order by 1
  ), ',') into v_acl;
  if v_acl <> 'INSERT,SELECT' then
    raise exception 'email_automation_override_log: quyen service_role sai, dang la "%"', v_acl;
  end if;

  -- anon va authenticated phai KHONG con quyen nao.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname in ('email_automation_overrides', 'email_automation_override_log')
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'email_automation: anon hoac authenticated van con quyen';
  end if;
end $$;

commit;
