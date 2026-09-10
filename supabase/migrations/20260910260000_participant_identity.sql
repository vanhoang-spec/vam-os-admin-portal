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
-- KHÔNG TẠO BẢNG MỚI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `account_person_auth_links` đã tồn tại từ migration 062 với đúng hình dạng
-- cần: `auth_user_id` duy nhất, `person_id` duy nhất, khoá ngoại về `people`.
-- Nó đang ngủ đông — không mã chạy nào ghi vào, chỉ vài ca test nhắc tên.
--
-- Thêm một bảng thứ hai cùng ánh xạ `auth_user_id → person_id` là tạo ra hai
-- nguồn sự thật cho một câu hỏi, và hai nguồn thì sẽ có ngày lệch nhau.
--
-- RLS, revoke và grant của bảng này đã đúng từ 062 (RLS bật, không policy,
-- thu hồi khỏi public/anon/authenticated, chỉ service_role ghi được). Migration
-- này KHÔNG đụng vào chúng.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BẢNG NÀY LÀ MỘT SỔ DANH TÍNH, KHÔNG PHẢI SỔ THÀNH VIÊN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 062 dựng nó mang luôn `program_id`, `season_id`, `role` — tức nó vừa nói
-- "tài khoản này là ai" vừa nói "người này tham gia cái gì". Việc thứ hai đã có
-- `person_season_memberships` làm rồi, đầy đủ hơn, có lịch sử, có trạng thái.
-- Số đo thật trên production: 193 mentor và 19 mentee đang hoạt động mùa S12,
-- cùng 1.090 người mùa S11 đã hoàn thành.
--
-- Giữ hai cột ấy ở đây nghĩa là chép lại dữ liệu đã có chỗ ở, và bản chép sẽ
-- cũ đi ngay lần đầu ai đó đổi mùa. Nên ba cột `program_id`, `season_id`,
-- `role` được NỚI THÀNH CHO PHÉP RỖNG và không còn được dùng: câu hỏi "người
-- này tham gia gì" đọc từ `person_season_memberships`.
--
-- Không xoá hẳn ba cột, vì migration 062 và các gói kiểm tra của nó có khẳng
-- định về hình dạng bảng; xoá cột làm hỏng những khẳng định đó mà chẳng được
-- gì thêm.
--
-- Hệ quả: `person_id unique` GIỮ NGUYÊN, và giờ nó mới thật sự đúng — một
-- người, một lối đăng nhập. (Kế hoạch ban đầu định gỡ ràng buộc này, vì lúc đó
-- bảng còn mang `program_id` nên nó chặn mất trường hợp một người nhiều chương
-- trình. Khi bảng thu về đúng vai trò sổ danh tính thì ràng buộc ấy là thứ
-- muốn có, không phải thứ phải gỡ.)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Ba cột thành viên: nới cho phép rỗng
-- ───────────────────────────────────────────────────────────────────────────
alter table public.account_person_auth_links
  alter column program_id drop not null,
  alter column season_id  drop not null,
  alter column role       drop not null;

comment on column public.account_person_auth_links.program_id is
  'KHÔNG DÙNG NỮA. Câu hỏi "người này tham gia chương trình nào" đọc từ person_season_memberships, nơi đã có sẵn lịch sử và trạng thái. Giữ cột để không phá các khẳng định về hình dạng bảng trong gói 062.';

comment on column public.account_person_auth_links.season_id is
  'KHÔNG DÙNG NỮA — xem chú thích ở program_id.';

comment on column public.account_person_auth_links.role is
  'KHÔNG DÙNG NỮA — xem chú thích ở program_id. Vai trò đọc từ person_season_memberships.role, nơi có đủ chín giá trị chứ không phải hai.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Mối nối này từ đâu ra
-- ───────────────────────────────────────────────────────────────────────────
--
-- Khi có người thấy dữ liệu của người khác, câu hỏi đầu tiên sẽ là "ai nối hai
-- thứ này lại, và bằng cách nào". Không ghi lại thì không ai trả lời được.
alter table public.account_person_auth_links
  add column if not exists link_source  text        null,
  add column if not exists invited_at   timestamptz null,
  add column if not exists activated_at timestamptz null,
  add column if not exists created_by   uuid        null references public.admin_users(id) on delete set null;

comment on column public.account_person_auth_links.link_source is
  'Mối nối này từ đâu ra: self_register (người dùng tự đăng nhập lần đầu và email khớp đúng một người), invite (theo link mời của ban tổ chức), admin (ban tổ chức nối tay). Rỗng = dòng có từ trước migration này.';

comment on column public.account_person_auth_links.activated_at is
  'Lần đầu mối nối này thật sự được dùng để đăng nhập.';

do $add_link_source_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_person_auth_links'::regclass
      and conname  = 'account_person_auth_links_link_source_check'
  ) then
    alter table public.account_person_auth_links
      add constraint account_person_auth_links_link_source_check
      check (link_source is null or link_source in ('self_register', 'invite', 'admin'));
  end if;
end;
$add_link_source_check$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Tra ngược từ email
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Migration báo thành công trong khi một cột chưa được thêm là thứ chỉ lộ ra
-- vào lần đăng nhập thật đầu tiên, giữa lúc cần nó nhất.
do $self_check$
declare
  missing text;
begin
  -- Ba cột thành viên phải cho phép rỗng.
  select string_agg(column_name, ', ') into missing
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'account_person_auth_links'
    and column_name in ('program_id', 'season_id', 'role')
    and is_nullable  = 'NO';

  if missing is not null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: các cột này lẽ ra phải cho phép rỗng: %', missing;
  end if;

  -- Bốn cột mới phải có mặt.
  select string_agg(needed, ', ') into missing
  from unnest(array['link_source', 'invited_at', 'activated_at', 'created_by']) as needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'account_person_auth_links'
      and column_name  = needed
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột: %', missing;
  end if;

  -- `person_id unique` phải CÒN. Một người, một lối đăng nhập.
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
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links.person_id mất ràng buộc duy nhất — một người sẽ có hai lối đăng nhập';
  end if;

  -- `auth_user_id unique` cũng vậy, và quan trọng hơn: mất nó thì hai người có
  -- thể cùng trỏ về một tài khoản đăng nhập.
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
      'SCHEMA_CONTRACT_VIOLATION: account_person_auth_links.auth_user_id mất ràng buộc duy nhất';
  end if;

  -- RLS phải còn bật. 062 đã bật; migration này không đụng vào, nhưng kiểm lại
  -- vì bảng sắp bắt đầu giữ dữ liệu thật.
  if not exists (
    select 1 from pg_class
    where oid = 'public.account_person_auth_links'::regclass
      and relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS đang tắt trên account_person_auth_links';
  end if;

  -- Chỉ số tra email phải có.
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
