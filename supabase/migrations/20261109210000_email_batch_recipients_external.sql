-- =============================================================================
-- VAM00027 — Danh sách tùy chỉnh nhận email NGOÀI VAM (không có hồ sơ trong VAM OS)
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR. Cần 20261106120000_email_batch_recipients.sql đã chạy trước.
-- Thiếu migration này thì lô có email ngoài VAM bị từ chối lúc chốt danh sách (CHECK), lô đóng
-- ngay, chưa lá nào đi. Lô chỉ gồm người lấy từ VAM vẫn chạy như cũ.
--
-- MỘT DÒNG NGOÀI VAM TRÔNG THẾ NÀO
--   relation_table = 'external', relation_id = NULL, role = 'external', full_name có thể rỗng.
--   Không trỏ vào hồ sơ nào: email và tên là chữ người bấm gõ / file Excel mang vào lúc mở lô.
--   Sổ thư (outbound_emails.related_table/related_id) nối lá thư về CHÍNH DÒNG NÀY
--   ('email_batch_recipients', id) — cột related_table là chữ tự do, không cần nới gì ở
--   outbound_emails, và loại thư vẫn là loại của mẫu thư (general_announcement).
--
-- MỌI THAY ĐỔI LÀ CỘNG THÊM
--   1. relation_table_check, role_check: đọc pg_get_constraintdef rồi NỐI 'external' (khuôn
--      20261106120000 / 20261024120000), không chép lại danh sách cũ.
--   2. relation_id: bỏ NOT NULL, thay bằng ràng buộc mới: dòng VAM vẫn BẮT BUỘC có relation_id,
--      dòng ngoài BẮT BUỘC không có. Mọi dòng đã có (đều là dòng VAM) vẫn thoả.
--   3. full_name_check: biểu thức cũ được giữ nguyên, chỉ thêm "hoặc là dòng ngoài VAM".
--   4. Ràng buộc mới cho dòng ngoài: tên không quá 120 ký tự, không có ký tự điều khiển.
-- Không đổi quyền, RLS, trigger của bảng. Chạy lại lần hai vô hại.
-- =============================================================================

begin;

do $vam00027_prereq$
begin
  if to_regclass('public.email_batch_recipients') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batch_recipients (migration 20261106120000)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass
      and conname in ('email_batch_recipients_relation_table_check', 'email_batch_recipients_role_check',
                      'email_batch_recipients_full_name_check')
    group by conrelid having count(*) = 3
  ) then
    raise exception 'PREREQ_MISSING: email_batch_recipients thiếu ràng buộc của migration 20261106120000';
  end if;
end;
$vam00027_prereq$;

-- ------------------------------------------------------------
-- 1. Nối 'external' vào hai danh sách đóng
-- ------------------------------------------------------------
do $vam00027_widen$
declare
  target   text;
  existing text;
  rebuilt  text;
begin
  foreach target in array array['email_batch_recipients_relation_table_check', 'email_batch_recipients_role_check'] loop
    select pg_get_constraintdef(c.oid)
      into existing
    from pg_constraint c
    where c.conrelid = 'public.email_batch_recipients'::regclass
      and c.conname = target;

    if position('''external''' in existing) > 0 then
      continue;
    end if;
    rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''external''::text\1');
    if rebuilt = existing then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % có dạng lạ, không nới được: %', target, existing;
    end if;
    execute format('alter table public.email_batch_recipients drop constraint %I', target);
    execute format('alter table public.email_batch_recipients add constraint %I ', target)
         || replace(rebuilt, 'CHECK ', 'check ');
  end loop;
end;
$vam00027_widen$;

-- ------------------------------------------------------------
-- 2. relation_id: bắt buộc với dòng VAM, cấm với dòng ngoài
-- ------------------------------------------------------------
do $vam00027_relation$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass
      and conname = 'email_batch_recipients_relation_id_check'
  ) then
    -- Thêm ràng buộc mới TRƯỚC khi bỏ NOT NULL: không có lúc nào dòng VAM được thiếu relation_id.
    alter table public.email_batch_recipients
      add constraint email_batch_recipients_relation_id_check
      check ((relation_table = 'external') = (relation_id is null));
  end if;
  alter table public.email_batch_recipients alter column relation_id drop not null;
end;
$vam00027_relation$;

-- ------------------------------------------------------------
-- 3. full_name: giữ biểu thức cũ, thêm ngoại lệ cho dòng ngoài
-- ------------------------------------------------------------
do $vam00027_full_name$
declare
  existing text;
  expr     text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.email_batch_recipients'::regclass
    and c.conname = 'email_batch_recipients_full_name_check';

  if position('''external''' in existing) > 0 then
    return;
  end if;
  expr := substring(existing from '^CHECK \((.*)\)$');
  if expr is null or expr = '' then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batch_recipients_full_name_check có dạng lạ: %', existing;
  end if;
  alter table public.email_batch_recipients drop constraint email_batch_recipients_full_name_check;
  execute 'alter table public.email_batch_recipients add constraint email_batch_recipients_full_name_check check (('
       || expr || ') or relation_table = ''external'')';
end;
$vam00027_full_name$;

-- ------------------------------------------------------------
-- 4. Tên của dòng ngoài: ngắn, không ký tự điều khiển (tên đi thẳng vào tiêu đề và thân thư)
-- ------------------------------------------------------------
do $vam00027_external_name$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass
      and conname = 'email_batch_recipients_external_name_check'
  ) then
    alter table public.email_batch_recipients
      add constraint email_batch_recipients_external_name_check
      check (relation_table <> 'external' or (char_length(full_name) <= 120 and full_name !~ '[[:cntrl:]]'));
  end if;
end;
$vam00027_external_name$;

comment on column public.email_batch_recipients.relation_id is
  'Id dòng nguồn trong relation_table. NULL đúng khi relation_table = external (email ngoài VAM, VAM00027): dòng đó không trỏ vào hồ sơ nào, và sổ thư nối lá thư về chính dòng chốt này (related_table = email_batch_recipients).';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $vam00027_contract$
declare
  def    text;
  target text;
  v      text;
  leaked text;
begin
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
  where c.conrelid = 'public.email_batch_recipients'::regclass and c.conname = 'email_batch_recipients_relation_table_check';
  foreach v in array array['people', 'admin_users', 'event_registrations', 'applications', 'external'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: relation_table_check thiếu %', v;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into def from pg_constraint c
  where c.conrelid = 'public.email_batch_recipients'::regclass and c.conname = 'email_batch_recipients_role_check';
  foreach v in array array['mentor', 'mentee', 'staff', 'attendee', 'external'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: role_check thiếu %', v;
    end if;
  end loop;

  foreach target in array array['email_batch_recipients_relation_table_check', 'email_batch_recipients_role_check',
                                'email_batch_recipients_full_name_check'] loop
    select pg_get_constraintdef(c.oid) into def from pg_constraint c
    where c.conrelid = 'public.email_batch_recipients'::regclass and c.conname = target;
    if (length(def) - length(replace(def, '''external''', ''))) / length('''external''') <> 1 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % phải có external đúng một lần: %', target, def;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into def from pg_constraint c
  where c.conrelid = 'public.email_batch_recipients'::regclass and c.conname = 'email_batch_recipients_full_name_check';
  if position('btrim' in coalesce(def, '')) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: full_name_check mất biểu thức cũ: %', def;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.email_batch_recipients'::regclass
                 and conname = 'email_batch_recipients_relation_id_check') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu email_batch_recipients_relation_id_check';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.email_batch_recipients'::regclass
                 and conname = 'email_batch_recipients_external_name_check') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu email_batch_recipients_external_name_check';
  end if;

  -- Không được nới gì ngoài các ràng buộc trên: RLS, không policy, không lọt quyền, trigger chỉ-lô-custom.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_batch_recipients' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batch_recipients chưa bật RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_batch_recipients') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batch_recipients lại có policy';
  end if;
  select string_agg(format('%s:%s', grantee, privilege_type), ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'email_batch_recipients'
    and (grantee in ('anon', 'authenticated', 'PUBLIC')
         or (grantee = 'service_role' and privilege_type not in ('SELECT', 'INSERT')));
  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài trên email_batch_recipients: %', leaked;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_batch_recipients'::regclass
      and tgname = 'email_batch_recipients_require_custom' and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger email_batch_recipients_require_custom';
  end if;
end;
$vam00027_contract$;

notify pgrst, 'reload schema';

commit;
