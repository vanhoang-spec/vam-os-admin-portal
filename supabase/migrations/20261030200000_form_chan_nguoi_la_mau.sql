-- VAM00009 (Form tùy chỉnh, phần 2): tùy chọn chặn người chưa có trên hệ thống và màu chủ đạo, riêng từng form.
-- Câu Có/Không và đích rẽ nhánh nằm trong custom_forms.fields (jsonb) nên không cần cột.
-- Mặc định false / null: form đã có giữ nguyên hành vi.

alter table public.custom_forms add column if not exists require_known_person boolean not null default false;
alter table public.custom_forms add column if not exists theme_color text;

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.custom_forms'::regclass and conname = 'custom_forms_theme_color_check') then
    alter table public.custom_forms add constraint custom_forms_theme_color_check check (theme_color is null or theme_color ~ '^#[0-9a-f]{6}$');
  end if;
end
$constraint$;

do $check$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'require_known_person') then
    raise exception 'SELF_CHECK: thiếu cột require_known_person';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'theme_color') then
    raise exception 'SELF_CHECK: thiếu cột theme_color';
  end if;
  raise notice 'Form VAM00009: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
