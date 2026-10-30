-- VAM00009 mục 4.1: banner và logo riêng từng form.
--
-- Ảnh nằm trong kho riêng 'form-anh', chỉ nhận png/jpeg/webp ≤ 5 MB. Trình duyệt tải THẲNG lên kho bằng link
-- ký sẵn và xem bằng link ký sẵn 1 giờ, cùng khuôn kho 'bao-loi' (20261027200000_bao_loi.sql). Không có
-- policy nào cho anon/authenticated: chỉ link do máy chủ cấp mới mở được kho.
-- Cột là đường dẫn trong kho; null = form không có ảnh. Form đã có giữ nguyên.

alter table public.custom_forms add column if not exists banner_path text;
alter table public.custom_forms add column if not exists logo_path text;
alter table public.custom_forms add column if not exists logo_position text not null default 'left';

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.custom_forms'::regclass and conname = 'custom_forms_logo_position_check') then
    alter table public.custom_forms add constraint custom_forms_logo_position_check check (logo_position in ('left', 'center', 'right'));
  end if;
end
$constraint$;

-- Lồng hai tầng: một biểu thức nhắc storage.buckets sẽ hỏng ngay khi schema storage không có (môi trường thử).
do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('form-anh', 'form-anh', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$bucket$;

do $check$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'logo_position') then
    raise exception 'SELF_CHECK: thiếu cột logo_position';
  end if;
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'form-anh' and public = false) then
      raise exception 'SELF_CHECK: thiếu kho ảnh riêng form-anh';
    end if;
  end if;
  raise notice 'Form banner + logo: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
