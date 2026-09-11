-- ═══════════════════════════════════════════════════════════════════════════
-- Blog: bài viết chia sẻ trải nghiệm mentoring
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mỗi bài chọn một mức hiển thị: CÔNG KHAI (đọc được trên internet, dùng để
-- giới thiệu chương trình và tuyển mùa sau) hoặc NỘI BỘ (chỉ người đã đăng nhập
-- — mentor, mentee, cựu thành viên, ban tổ chức).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- MẶC ĐỊNH LÀ NỘI BỘ, VÀ ĐÓ LÀ ĐIỂM QUAN TRỌNG NHẤT CỦA CẢ FILE NÀY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Một bài nội bộ lọt ra công khai là KHÔNG THU HỒI ĐƯỢC. Nó mang tên thật và
-- câu chuyện thật của một người; khi Google đã đọc nó thì gỡ bài đi cũng không
-- gỡ được bản lưu.
--
-- Nên quên chọn thì thành nội bộ, chứ không phải quên chọn thì thành công khai.
-- Cái giá của hai lần quên rất khác nhau: một bài công khai để nhầm chế độ nội
-- bộ thì chỉ ít người đọc hơn.
--
-- Cùng lý do với `status`: mặc định `draft`. Bài chưa ai đọc lại thì không nằm
-- trên internet.
--
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),

  -- Đường dẫn của bài. Duy nhất toàn hệ thống vì nó nằm trong URL người ta chia
  -- sẻ cho nhau; hai bài cùng đường dẫn nghĩa là một trong hai không mở được.
  slug text not null unique,

  title   text not null,
  excerpt text null,
  body    text not null,

  visibility text not null default 'internal',
  status     text not null default 'draft',

  -- Tác giả. `person_id` để nối về danh bạ; `author_display_name` để bài vẫn ký
  -- đúng tên kể cả khi dòng danh bạ bị gộp hay đổi tên về sau — bài đã đăng là
  -- một bản ghi lịch sử, không phải một khung nhìn vào dữ liệu hiện tại.
  author_person_id     uuid null references public.people(id) on delete set null,
  author_display_name  text null,

  -- Mùa mà câu chuyện này thuộc về. Tuỳ chọn: có bài nói chuyện chung.
  season_id uuid null references public.seasons(id) on delete set null,

  published_at timestamptz null,
  created_by   uuid null references public.admin_users(id) on delete set null,
  published_by uuid null references public.admin_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint blog_posts_visibility_check
    check (visibility in ('internal', 'public')),

  constraint blog_posts_status_check
    check (status in ('draft', 'published', 'archived')),

  -- Đã đăng thì phải có mốc thời gian đăng. Một bài `published` mà
  -- `published_at` rỗng sẽ rơi xuống cuối mọi phép sắp theo thời gian và biến
  -- mất khỏi tầm mắt người đọc.
  constraint blog_posts_published_at_check
    check (status <> 'published' or published_at is not null)
);

comment on column public.blog_posts.visibility is
  'internal = chỉ người đã đăng nhập; public = đọc được trên internet. Mặc định internal: một bài nội bộ lọt ra ngoài là không thu hồi được, còn một bài công khai để nhầm nội bộ thì chỉ ít người đọc hơn.';

comment on column public.blog_posts.author_display_name is
  'Tên ký dưới bài, chụp lại lúc đăng. Bài đã đăng là bản ghi lịch sử, không phải khung nhìn vào danh bạ hiện tại.';

-- Danh sách bài luôn đọc theo "đã đăng, mới nhất trước".
create index if not exists blog_posts_published_idx
  on public.blog_posts (published_at desc)
  where status = 'published';

-- Lọc theo mức hiển thị nằm ngay cạnh, vì trang công khai luôn hỏi cả hai.
create index if not exists blog_posts_visibility_published_idx
  on public.blog_posts (visibility, published_at desc)
  where status = 'published';

create index if not exists blog_posts_author_idx
  on public.blog_posts (author_person_id)
  where author_person_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- updated_at
-- ───────────────────────────────────────────────────────────────────────────
do $touch_trigger$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.blog_posts'::regclass
        and tgname  = 'blog_posts_set_updated_at'
    ) then
      create trigger blog_posts_set_updated_at
        before update on public.blog_posts
        for each row execute function public.set_updated_at();
    end if;
  end if;
end;
$touch_trigger$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Quyền
-- ═══════════════════════════════════════════════════════════════════════════
--
-- REVOKE TRƯỚC, GRANT SAU — và revoke cả service_role.
--
-- Supabase đặt `ALTER DEFAULT PRIVILEGES` trên schema public, nên một bảng vừa
-- tạo ĐÃ mang sẵn ALL cho service_role. Chỉ `grant select, insert, update` lên
-- trên là chồng thêm vào một quyền vốn đã bao trùm tất cả — DELETE vẫn còn, và
-- không dòng nào trong file nói ra điều đó.
--
-- Bài đã đăng cần xoá được thật (gỡ bài là một việc có thật), nên ở đây
-- service_role có đủ bốn quyền. Nhưng nó phải là một câu lệnh CÓ CHỦ Ý, không
-- phải một quyền còn sót lại vì mặc định của nền tảng.
alter table public.blog_posts enable row level security;

revoke all on public.blog_posts from public, anon, authenticated;
revoke all on public.blog_posts from service_role;
grant select, insert, update, delete on public.blog_posts to service_role;

-- Không policy nào. Bảng chỉ đọc qua service_role ở phía máy chủ, nơi phép
-- quyết định "ai đọc được bài nào" chạy trong `lib/blog-core.ts`. Một policy là
-- một đường vào thứ hai, và hai đường thì sẽ có ngày nói khác nhau.

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
do $self_check$
declare
  extra text;
begin
  if to_regclass('public.blog_posts') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: chưa tạo được bảng blog_posts';
  end if;

  -- Mặc định phải là nội bộ và bản nháp.
  if (
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'blog_posts' and column_name = 'visibility'
  ) not like '%internal%' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: blog_posts.visibility phải mặc định internal — quên chọn không được thành công khai';
  end if;

  if (
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'blog_posts' and column_name = 'status'
  ) not like '%draft%' then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: blog_posts.status phải mặc định draft';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.blog_posts'::regclass and relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS đang tắt trên blog_posts';
  end if;

  -- Không vai trò nào ngoài service_role được chạm vào bảng. Đây là phép kiểm
  -- bắt được đúng cái bẫy quyền mặc định nói ở trên.
  select string_agg(distinct grantee, ', ') into extra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name   = 'blog_posts'
    and grantee not in ('service_role', 'postgres', current_user);

  if extra is not null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: blog_posts còn quyền cho vai trò ngoài dự kiến: %', extra;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'blog_posts'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: blog_posts không được có policy nào';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';
