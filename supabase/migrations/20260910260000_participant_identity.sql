-- ═══════════════════════════════════════════════════════════════════════════
-- Nền tảng danh tính cho mentor / mentee đăng nhập
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hôm nay chỉ nhân sự ban tổ chức có tài khoản. Mentor và mentee chạm vào hệ
-- thống qua các link công khai — đăng ký sự kiện, gia hạn, nộp đơn — mỗi link
-- một cánh cửa hẹp, dùng xong là xong, không nhớ họ là ai.
--
-- Để họ đăng nhập được, hệ thống phải trả lời chắc chắn đúng MỘT câu:
--
--     "Người vừa đăng nhập bằng email này là ai trong chương trình?"
--
-- Nghe hiển nhiên, nhưng đây là chỗ nguy hiểm nhất của cả tính năng. Tài khoản
-- đăng nhập và hồ sơ trong danh bạ là hai thứ tách rời. Nối sai một lần là một
-- người mở ra và thấy dữ liệu của người khác.
--
-- Migration này dựng đúng cái mối nối đó, và không làm gì khác. Sau khi chạy,
-- màn hình không đổi gì cả — chưa ai đăng nhập được. Đó là chủ ý: phần quyết
-- định AI THẤY DỮ LIỆU CỦA AI được đọc và thử riêng, chứ không lẫn vào một thay
-- đổi có giao diện làm người duyệt chỉ nhìn giao diện.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO FILE NÀY TẠO BẢNG, VÀ VÌ SAO NÓ MỞ ĐẦU BẰNG MỘT BƯỚC DÒ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bản đầu của file này giả định `account_person_auth_links` đã có sẵn từ
-- `supabase_migrations/062_review_only_account_admin_rls_foundation.sql` và chỉ
-- sửa nó. Chạy trên production ngày 11/09 thì báo:
--
--     42P01: relation "public.account_person_auth_links" does not exist
--
-- Chữ "review_only" trong tên file đã nói trước điều đó: gói 062 là gói để
-- duyệt, chưa từng được chạy lên production. Có trong repo không chứng minh
-- được có trong database.
--
-- Nên file này TẠO bảng. Và nó mở đầu bằng mục 0: mọi bảng, mọi cột mà chồng
-- tính năng đăng nhập participant đọc tới đều được dò trước. Thiếu thì báo MỘT
-- lần đủ cả danh sách, trước khi câu lệnh tạo nào kịp chạy — thay vì chạy, gặp
-- lỗi, sửa, chạy lại cho từng thứ một.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BẢNG NÀY LÀ MỘT SỔ DANH TÍNH, KHÔNG PHẢI SỔ THÀNH VIÊN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bản thiết kế 062 cho bảng này mang cả `program_id`, `season_id`, `role` — tức
-- vừa nói "tài khoản này là ai" vừa nói "người này tham gia cái gì". Việc thứ
-- hai đã có `person_season_memberships` làm, đầy đủ hơn, có lịch sử, có trạng
-- thái. Số đo thật trên production: 193 mentor và 19 mentee đang hoạt động mùa
-- S12, cùng 1.090 người mùa S11 đã hoàn thành.
--
-- Chép ba cột ấy vào đây là chép lại dữ liệu đã có chỗ ở, và bản chép sẽ cũ đi
-- ngay lần đầu ai đó đổi mùa. Nên bảng KHÔNG có ba cột đó.
--
-- Hệ quả: `person_id` duy nhất là đúng — một người, một lối đăng nhập.
-- `auth_user_id` duy nhất cũng vậy — một tài khoản không trỏ về hai người.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Dò trước: những gì tính năng này đọc tới phải có mặt
-- ───────────────────────────────────────────────────────────────────────────
--
-- Chỉ ĐỌC danh mục hệ thống. Không tạo, không sửa gì.
--
-- Danh sách lấy từ chính các câu truy vấn trong mã của chồng PR đăng nhập
-- participant, không lấy từ các file migration cũ — vì file cũ chính là thứ
-- vừa nói sai. Ca test `migration-participant-identity` đọc mã và bắt danh
-- sách này phải theo kịp.
do $preflight$
declare
  missing text;
begin
  select string_agg(needed.tbl || '.' || needed.col, ', ' order by needed.tbl, needed.col)
    into missing
  from (values
    ('people',                    'id'),
    ('people',                    'email_primary'),
    ('people',                    'full_name'),
    ('person_season_memberships', 'id'),
    ('person_season_memberships', 'person_id'),
    ('person_season_memberships', 'program_id'),
    ('person_season_memberships', 'season_id'),
    ('person_season_memberships', 'role'),
    ('person_season_memberships', 'status'),
    ('programs',                  'id'),
    ('programs',                  'code'),
    ('programs',                  'name'),
    ('seasons',                   'id'),
    ('seasons',                   'code'),
    ('seasons',                   'name'),
    ('events',                    'id'),
    ('events',                    'event_name'),
    ('events',                    'starts_at'),
    ('events',                    'ends_at'),
    ('events',                    'location_name'),
    ('events',                    'season_id'),
    ('event_registrations',       'id'),
    ('event_registrations',       'event_id'),
    ('event_registrations',       'linked_person_id'),
    ('event_registrations',       'attendance_status'),
    ('event_registrations',       'registration_status'),
    ('admin_users',               'id'),
    ('admin_users',               'auth_user_id'),
    ('admin_users',               'email'),
    ('admin_users',               'status')
  ) as needed(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = needed.tbl
      and c.column_name  = needed.col
  );

  if to_regclass('auth.users') is null then
    missing := concat_ws(', ', missing, 'auth.users');
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    missing := concat_ws(', ', missing, 'hàm public.set_updated_at()');
  end if;

  if missing is not null then
    raise exception
      'PREFLIGHT_MISSING_DEPENDENCY: production chưa có những thứ tính năng đăng nhập participant đọc tới: %', missing;
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Bảng
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.account_person_auth_links (
  id uuid primary key default gen_random_uuid(),

  -- Tài khoản đăng nhập. Xoá tài khoản thì mối nối đi theo: không còn ai đăng
  -- nhập bằng nó nữa, và một mối nối trỏ vào khoảng không chỉ chờ ngày có người
  -- đọc nhầm nó là còn hiệu lực.
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,

  -- Người trong danh bạ. KHÔNG xoá dây chuyền. Không màn hình nào xoá người
  -- khỏi danh bạ; nếu một ngày có ai xoá bằng tay một người đang có tài khoản,
  -- câu lệnh ấy phải dừng lại để họ quyết định, chứ không lặng lẽ cắt đường
  -- đăng nhập của người đó.
  person_id uuid not null unique references public.people(id),

  -- Ngắt một mối nối là đổi sang `inactive`, không phải xoá dòng — xem mục 3.
  status text not null,

  -- Mối nối này từ đâu ra. Khi có người thấy dữ liệu của người khác, câu hỏi
  -- đầu tiên sẽ là "ai nối hai thứ này lại, và bằng cách nào". BẮT BUỘC có:
  -- bảng mới tinh, không có dòng cũ nào phải chừa chỗ cho giá trị rỗng.
  link_source  text        not null,
  invited_at   timestamptz null,
  activated_at timestamptz null,
  created_by   uuid        null references public.admin_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_person_auth_links_status_check
    check (status in ('active', 'inactive')),

  constraint account_person_auth_links_link_source_check
    check (link_source in ('self_register', 'invite', 'admin'))
);

comment on table public.account_person_auth_links is
  'Sổ danh tính: tài khoản đăng nhập nào là người nào trong danh bạ. Không ghi người đó tham gia gì — câu hỏi ấy đọc từ person_season_memberships.';

comment on column public.account_person_auth_links.link_source is
  'Mối nối này từ đâu ra: self_register (tự đăng nhập lần đầu và email khớp đúng một người), invite (theo link mời của ban tổ chức), admin (ban tổ chức nối tay).';

comment on column public.account_person_auth_links.activated_at is
  'Lần đầu mối nối này thật sự được dùng để đăng nhập.';

drop trigger if exists account_person_auth_links_set_updated_at on public.account_person_auth_links;
create trigger account_person_auth_links_set_updated_at
before update on public.account_person_auth_links
for each row
execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tra ngược từ email
-- ───────────────────────────────────────────────────────────────────────────
--
-- Lần đầu một người đăng nhập, hệ thống dò email của họ trong danh bạ. Phép dò
-- ấy phải không phân biệt hoa thường và bỏ khoảng trắng thừa, vì email người ta
-- gõ vào ô đăng nhập không nhất thiết giống hệt chuỗi đang lưu.
--
-- Chỉ số biểu thức để phép dò đó không phải đọc cả bảng `people`.
create index if not exists people_email_primary_lower_idx
  on public.people (lower(btrim(email_primary)))
  where coalesce(btrim(email_primary), '') <> '';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Quyền
-- ───────────────────────────────────────────────────────────────────────────
--
-- REVOKE TRƯỚC, GRANT SAU — và revoke cả service_role.
--
-- Supabase đặt `ALTER DEFAULT PRIVILEGES` trên schema public, nên một bảng vừa
-- tạo ĐÃ mang sẵn ALL cho service_role, anon và authenticated. Chỉ grant chồng
-- lên thì những quyền mặc định ấy vẫn còn nguyên, và không dòng nào trong file
-- nói ra điều đó.
--
-- service_role được đọc, thêm, sửa — KHÔNG được xoá. Ngắt một mối nối là đổi
-- `status`; xoá dòng là xoá luôn dấu vết ai từng đăng nhập được với tư cách
-- ai. Xoá tài khoản đăng nhập vẫn dọn được dòng này qua khoá ngoại ở mục 1, vì
-- lệnh xoá dây chuyền chạy bằng quyền của chủ bảng.
alter table public.account_person_auth_links enable row level security;

revoke all on public.account_person_auth_links from public, anon, authenticated;
revoke all on public.account_person_auth_links from service_role;
grant select, insert, update on public.account_person_auth_links to service_role;

-- Không policy nào. Bảng chỉ đọc qua service_role ở phía máy chủ, nơi phép
-- quyết định "tài khoản này là ai" chạy trong `lib/participant-auth.ts`. Một
-- policy là một đường vào thứ hai, và hai đường thì sẽ có ngày nói khác nhau.

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Migration báo thành công trong khi một cột chưa được thêm là thứ chỉ lộ ra
-- vào lần đăng nhập thật đầu tiên, giữa lúc cần nó nhất.
do $self_check$
declare
  missing    text;
  extra      text;
  privileges text;
begin
  if to_regclass('public.account_person_auth_links') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: chưa tạo được bảng account_person_auth_links';
  end if;

  -- Đủ mười cột.
  select string_agg(needed, ', ') into missing
  from unnest(array[
    'id', 'auth_user_id', 'person_id', 'status', 'link_source',
    'invited_at', 'activated_at', 'created_by', 'created_at', 'updated_at'
  ]) as needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'account_person_auth_links'
      and column_name  = needed
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links thiếu cột: %', missing;
  end if;

  -- Và không thừa cột nào.
  --
  -- `create table if not exists` bỏ qua im lặng nếu ở đâu đó bảng đã có sẵn với
  -- hình dạng khác — chẳng hạn bản thiết kế 062, mang `program_id` bắt buộc.
  -- Khi ấy mọi lần đăng nhập đầu tiên sẽ ghi hỏng. Dừng ở đây rõ ràng hơn nhiều.
  select string_agg(column_name, ', ') into extra
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'account_person_auth_links'
    and column_name not in (
      'id', 'auth_user_id', 'person_id', 'status', 'link_source',
      'invited_at', 'activated_at', 'created_by', 'created_at', 'updated_at'
    );

  if extra is not null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links đã có sẵn với hình dạng khác (cột ngoài dự kiến: %) — dừng lại, không tự sửa', extra;
  end if;

  -- `person_id` duy nhất. Một người, một lối đăng nhập.
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute  a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.account_person_auth_links'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname  = 'person_id'
  ) then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links.person_id thiếu ràng buộc duy nhất — một người sẽ có hai lối đăng nhập';
  end if;

  -- `auth_user_id` duy nhất, và quan trọng hơn: thiếu nó thì hai người có thể
  -- cùng trỏ về một tài khoản đăng nhập.
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute  a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.account_person_auth_links'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname  = 'auth_user_id'
  ) then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links.auth_user_id thiếu ràng buộc duy nhất';
  end if;

  -- `auth_user_id` trỏ về auth.users và đi theo khi tài khoản bị xoá.
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute  a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid    = 'public.account_person_auth_links'::regclass
      and c.contype     = 'f'
      and c.confrelid   = 'auth.users'::regclass
      and c.confdeltype = 'c'
      and a.attname     = 'auth_user_id'
  ) then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links.auth_user_id phải trỏ về auth.users và bị xoá theo tài khoản';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.account_person_auth_links'::regclass
      and relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS đang tắt trên account_person_auth_links';
  end if;

  -- Không vai trò nào ngoài service_role được chạm vào bảng. Đây là phép kiểm
  -- bắt được đúng cái bẫy quyền mặc định nói ở mục 3.
  select string_agg(distinct grantee, ', ') into extra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name   = 'account_person_auth_links'
    and grantee not in ('service_role', 'postgres', current_user);

  if extra is not null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links còn quyền cho vai trò ngoài dự kiến: %', extra;
  end if;

  -- service_role có đúng ba quyền. Thừa DELETE là xoá được dấu vết.
  select string_agg(distinct privilege_type, ', ' order by privilege_type) into privileges
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name   = 'account_person_auth_links'
    and grantee      = 'service_role';

  if privileges is distinct from 'INSERT, SELECT, UPDATE' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: service_role phải có đúng INSERT, SELECT, UPDATE trên account_person_auth_links, đang có: %', coalesce(privileges, '(không có)');
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'account_person_auth_links'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links không được có policy nào';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.account_person_auth_links'::regclass
      and tgname  = 'account_person_auth_links_set_updated_at'
      and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger account_person_auth_links_set_updated_at';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'people'
      and indexname  = 'people_email_primary_lower_idx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số people_email_primary_lower_idx';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';
