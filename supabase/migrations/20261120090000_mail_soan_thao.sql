-- VAM00038: trình soạn thư có định dạng (chữ, ảnh, bảng, khung nội dung) cho Mail.
--
-- 1. email_templates.body_html: bản HTML đã lọc của một mẫu thư soạn bằng trình thiết kế. NULL = mẫu chữ
--    thuần như trước (thân thư HTML vẫn dựng bằng textToHtmlEmail, gửi y như cũ). Cột `body` vẫn giữ bản
--    chữ thuần rút từ HTML: phần text/plain của thư và mọi kiểm tra cũ đọc từ đó.
-- 2. email_templates.source_template_id: thư này được tạo từ mẫu nào ("Dùng mẫu"). Sửa bản sao không đổi
--    mẫu gốc; chỉ nút "Cập nhật mẫu gốc" mới chép nội dung về gốc (và gốc rơi về bản nháp, cần duyệt lại).
-- 3. Kho ảnh CÔNG KHAI 'mail-anh' cho ảnh chèn trong thân thư. Ứng dụng thư tải ảnh lúc người nhận mở thư,
--    có khi sau nhiều tuần, nên link ký có hạn (kho 'mail-dinh-kem', 'form-anh') không dùng được.
--    Chỉ nhận png/jpeg/gif/webp (không svg), tối đa 3 MB. Không policy nào cho anon/authenticated: chỉ
--    link tải lên do máy chủ ký (sau authorize() của Mail) mới ghi được; tên tệp là uuid ngẫu nhiên.
--
-- Chạy lại vô hại. Mã chạy được khi migration này CHƯA áp: đọc mẫu thư lùi về cột cũ, mẫu chữ thuần vẫn
-- lưu và gửi như trước; chỉ chế độ thiết kế báo "chưa cập nhật cơ sở dữ liệu".

begin;

do $vam00038_prereq$
begin
  if to_regclass('public.email_templates') is null then
    raise exception 'PREREQ_MISSING: cần public.email_templates (migration 20260909150000)';
  end if;
end;
$vam00038_prereq$;

alter table public.email_templates add column if not exists body_html text null;
alter table public.email_templates add column if not exists source_template_id uuid null;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_templates'::regclass and conname = 'email_templates_source_template_fkey'
  ) then
    alter table public.email_templates
      add constraint email_templates_source_template_fkey
      foreign key (source_template_id) references public.email_templates(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_templates'::regclass and conname = 'email_templates_body_html_length_check'
  ) then
    alter table public.email_templates
      add constraint email_templates_body_html_length_check
      check (body_html is null or length(body_html) <= 200000);
  end if;
end
$constraint$;

comment on column public.email_templates.body_html is
  'VAM00038: HTML đã lọc (sanitize-html, máy chủ) của mẫu soạn bằng trình thiết kế. NULL = mẫu chữ thuần.';
comment on column public.email_templates.source_template_id is
  'VAM00038: mẫu gốc mà thư này được tạo từ đó. Sửa thư này không đổi mẫu gốc.';

-- Lồng trong to_regclass: môi trường thử không có schema storage thì bỏ qua.
do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('mail-anh', 'mail-anh', true, 3145728, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
      on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$bucket$;

do $check$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_templates' and column_name = 'body_html'
  ) then
    raise exception 'SELF_CHECK: thiếu cột email_templates.body_html';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_templates' and column_name = 'source_template_id'
  ) then
    raise exception 'SELF_CHECK: thiếu cột email_templates.source_template_id';
  end if;
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'mail-anh' and public = true) then
      raise exception 'SELF_CHECK: thiếu kho ảnh công khai mail-anh';
    end if;
  end if;
  raise notice 'VAM00038 soạn thư có định dạng: sẵn sàng';
end
$check$;

commit;

notify pgrst, 'reload schema';
