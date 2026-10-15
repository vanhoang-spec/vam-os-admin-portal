-- Form tùy chỉnh (BTC 15/10/2026).
--
-- Support team tự tạo form cho từng đợt (vd. tuyển mentee Job Shadowing) thay vì nhờ lập trình:
-- tiêu đề, giới thiệu, danh sách trường (loại, bắt buộc/tùy chọn, lựa chọn), giờ mở/đóng. Bật
-- công khai thì có link os.alumni-mentoring.edu.vn/f/<public_code>; người điền không cần đăng nhập.
--
--   custom_forms           — một dòng một form; fields là mảng jsonb định nghĩa trường (kiểm ở máy
--                            chủ, lib/custom-form-core.ts). Không xoá form (chỉ đóng): câu trả lời
--                            tham chiếu tới nó.
--   custom_form_responses  — một dòng một lần gửi; answers khoá theo MÃ trường (không theo nhãn),
--                            nên sửa chữ câu hỏi không làm lệch dữ liệu cũ. dedupe_key = email đã
--                            chuẩn hoá khi form bật "Mỗi email chỉ gửi một lần"; chỉ mục duy nhất
--                            (form_id, dedupe_key) là nơi phân xử hai lần gửi cùng lúc.
--
-- Thêm (BTC 15/10/2026, tối): ô "tải file" là trường gửi LINK (form nhẹ, CRM không lưu file); ngắt
-- trang; thư tự động gửi người điền (cột auto_reply*, loại thư 'custom_form_receipt'). Hai thứ đầu
-- chỉ là loại trường trong fields jsonb, không cần cột.
--
-- Chỉ máy chủ (service_role) đọc/ghi, sau khi tự kiểm quyền. Bảng có họ tên, email, SĐT, có thể
-- có CCCD và ngày sinh: anon và authenticated không có quyền gì (khoá công khai nằm sẵn trong mã
-- trang web, ai cũng lấy được). Câu trả lời chỉ thêm, không sửa, không xoá.

create table if not exists public.custom_forms (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    check (public_code ~ '^[a-z0-9]{10,16}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  program_id uuid references public.programs(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  thank_you text not null default '' check (char_length(thank_you) <= 1000),
  one_per_email boolean not null default true,
  -- Thư tự động gửi người điền ngay sau khi gửi form; tiêu đề và nội dung do BTC/Support team soạn.
  auto_reply boolean not null default false,
  auto_reply_subject text not null default '' check (char_length(auto_reply_subject) <= 200),
  auto_reply_body text not null default '' check (char_length(auto_reply_body) <= 5000),
  fields jsonb not null default '[]'::jsonb
    check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 60),
  created_by uuid references public.admin_users(id),
  updated_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_forms_window check (opens_at is null or closes_at is null or closes_at > opens_at)
);

comment on table public.custom_forms is
  'Form tùy chỉnh do BTC/Support team tạo (BTC 15/10/2026); link công khai /f/<public_code>.';

create table if not exists public.custom_form_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.custom_forms(id) on delete restrict,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 3 and 254),
  consent_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.custom_form_responses is
  'Câu trả lời của form tùy chỉnh; answers khoá theo mã trường. Chỉ thêm, không sửa, không xoá.';

create unique index if not exists custom_form_responses_dedupe_uniq
  on public.custom_form_responses (form_id, dedupe_key) where dedupe_key is not null;
create index if not exists custom_form_responses_form_created_idx
  on public.custom_form_responses (form_id, created_at desc);

alter table public.custom_forms enable row level security;
alter table public.custom_form_responses enable row level security;
revoke all on public.custom_forms from public, anon, authenticated, service_role;
revoke all on public.custom_form_responses from public, anon, authenticated, service_role;
-- Không cấp delete: form đóng thay vì xoá, câu trả lời không được sửa hay xoá từ ứng dụng.
grant select, insert, update on public.custom_forms to service_role;
grant select, insert on public.custom_form_responses to service_role;

-- Loại thư mới 'custom_form_receipt' (thư tự động sau khi gửi form), theo lối cộng thêm: đọc định
-- nghĩa đang có rồi nối thêm — viết đè cả danh sách là để sót loại cũ và lặng lẽ chặn thư loại đó.
do $kind$
declare
  v_existing text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
    from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không thấy outbound_emails_kind_check';
  end if;
  if position(quote_literal('custom_form_receipt') in v_existing) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''custom_form_receipt''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $check$
declare
  t text;
  v_def text;
begin
  foreach t in array array['custom_forms', 'custom_form_responses'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'SELF_CHECK: thiếu bảng %', t;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'SELF_CHECK: bảng % chưa bật RLS', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception 'SELF_CHECK: anon/authenticated còn đọc hoặc ghi được %', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') or not has_table_privilege('service_role', 'public.' || t, 'insert') then
      raise exception 'SELF_CHECK: máy chủ chưa đọc/ghi được %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception 'SELF_CHECK: % không được xoá từ ứng dụng', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.custom_form_responses', 'update') then
    raise exception 'SELF_CHECK: câu trả lời phải chỉ thêm, không sửa';
  end if;
  if not has_table_privilege('service_role', 'public.custom_forms', 'update') then
    raise exception 'SELF_CHECK: máy chủ chưa sửa được custom_forms';
  end if;
  if to_regclass('public.custom_form_responses_dedupe_uniq') is null then
    raise exception 'SELF_CHECK: thiếu chỉ mục chặn gửi trùng';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'auto_reply_body') then
    raise exception 'SELF_CHECK: custom_forms thiếu cột thư tự động';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('custom_form_receipt') in coalesce(v_def, '')) = 0
     or position(quote_literal('mentee_exemption_confirm') in coalesce(v_def, '')) = 0 then
    raise exception 'SELF_CHECK: outbound_emails_kind_check thiếu loại thư';
  end if;
  raise notice 'Form tùy chỉnh: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
