-- =============================================================================
-- VAM00037 — Mail: đính kèm nhiều tệp tải lên từ thiết bị
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR. Chưa dán thì gửi thư KHÔNG đính kèm vẫn chạy y như trước (mã coi "thiếu
-- bảng" là "lô không có tệp"); chỉ nút "Đính kèm tệp từ máy" báo chưa mở được kho, và gửi kèm tệp
-- bị từ chối trước khi lá thư nào đi.
--
-- 1. Kho riêng 'mail-dinh-kem' (KHÔNG công khai, không policy cho trình duyệt): trình duyệt chỉ PUT
--    được qua link ký sẵn máy chủ cấp; nhà cung cấp thư lấy tệp qua link tải ký sẵn. Kho tự chặn tệp
--    > 10 MB và mọi MIME ngoài danh sách (khớp LOAI_TEP_DINH_KEM trong lib/mail-dinh-kem-core.ts).
-- 2. Bảng public.email_attachments: tệp đã chốt vào một lô gửi. "Gửi tiếp" đọc lại bảng này nên mọi
--    người nhận của lô — lần chạy nào cũng vậy — nhận đủ cùng một bộ tệp. Chỉ máy chủ đọc / thêm;
--    tệp đã chốt không sửa, không xoá (xoá lô thì tệp của nó đi theo).
--
-- Chạy lại vô hại (if not exists / on conflict / drop … if exists).
-- =============================================================================

begin;

do $vam00037_prereq$
begin
  if to_regclass('public.email_batches') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batches (migration 20260909150000)';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: cần public.seasons';
  end if;
end;
$vam00037_prereq$;

-- ------------------------------------------------------------
-- 1. Kho riêng
-- ------------------------------------------------------------
do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('mail-dinh-kem', 'mail-dinh-kem', false, 10485760, array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/rtf',
        'text/csv',
        'text/plain',
        'text/calendar',
        'image/jpeg',
        'image/png',
        'image/gif'
      ])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$bucket$;

-- ------------------------------------------------------------
-- 2. Tệp đã chốt vào lô
-- ------------------------------------------------------------
create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.email_batches(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  -- admin_users.id của người tải lên. Không khoá ngoại: xoá một tài khoản không được kẹt vì lô thư cũ.
  uploaded_by uuid,
  position integer not null,
  -- <mùa>/<người tải>/<uuid>/<tên-ascii>.<đuôi> trong kho 'mail-dinh-kem'.
  storage_path text not null,
  -- Tên người nhận thấy (tên gốc đã làm sạch).
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),

  constraint email_attachments_position_check check (position >= 0 and position < 10),
  constraint email_attachments_file_name_check check (btrim(file_name) <> '' and length(file_name) <= 120),
  constraint email_attachments_size_check check (size_bytes > 0 and size_bytes <= 10485760),
  constraint email_attachments_path_check
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9][a-z0-9-]{0,59}\.[a-z0-9]{1,5}$'),
  constraint email_attachments_batch_path_key unique (batch_id, storage_path),
  constraint email_attachments_batch_position_key unique (batch_id, position)
);

create index if not exists email_attachments_batch_idx on public.email_attachments (batch_id, position);
create index if not exists email_attachments_path_idx on public.email_attachments (storage_path);

comment on table public.email_attachments is
  'Tệp đính kèm đã chốt vào một lô gửi hàng loạt (Mail, VAM00037). Byte nằm trong kho riêng mail-dinh-kem; Gửi tiếp đọc bảng này để mọi người nhận có đủ tệp. Chỉ máy chủ đọc/thêm; không sửa, không xoá.';

-- Tổng một lô: tối đa 10 tệp, tổng 10 MB — cùng giới hạn với lib/mail-dinh-kem-core.ts. Máy chủ đã
-- kiểm; trigger là hàng rào cuối nếu một đường ghi khác quên kiểm.
create or replace function public.email_attachments_enforce_batch_limits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $email_attachments_enforce_batch_limits$
declare
  v_count integer;
  v_total bigint;
begin
  perform pg_advisory_xact_lock(hashtext('email_attachments:' || new.batch_id::text));
  select count(*), coalesce(sum(size_bytes), 0) into v_count, v_total
  from public.email_attachments where batch_id = new.batch_id;
  if v_count + 1 > 10 then
    raise exception 'email_attachments: một lô đính kèm tối đa 10 tệp';
  end if;
  if v_total + new.size_bytes > 10485760 then
    raise exception 'email_attachments: tổng tệp của một lô vượt 10 MB';
  end if;
  return new;
end;
$email_attachments_enforce_batch_limits$;

revoke all on function public.email_attachments_enforce_batch_limits() from public, anon, authenticated;

drop trigger if exists email_attachments_enforce_batch_limits on public.email_attachments;
create trigger email_attachments_enforce_batch_limits
before insert on public.email_attachments
for each row
execute function public.email_attachments_enforce_batch_limits();

alter table public.email_attachments enable row level security;
revoke all on public.email_attachments from public, anon, authenticated, service_role;
grant select, insert on public.email_attachments to service_role;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $vam00037_contract$
declare
  leaked text;
begin
  if to_regclass('public.email_attachments') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng public.email_attachments';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_attachments' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_attachments chưa bật RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_attachments') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_attachments lại có policy';
  end if;
  select string_agg(format('%s:%s', grantee, privilege_type), ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'email_attachments'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài trên email_attachments: %', leaked;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_attachments'::regclass
      and tgname = 'email_attachments_enforce_batch_limits' and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger email_attachments_enforce_batch_limits';
  end if;
  -- Lồng hai tầng: một biểu thức nhắc storage.buckets sẽ hỏng ngay khi schema storage không có (môi trường thử).
  if to_regclass('storage.buckets') is not null then
    if not exists (
      select 1 from storage.buckets
      where id = 'mail-dinh-kem' and public = false and file_size_limit = 10485760
    ) then
      raise exception 'SELF_CHECK: thiếu kho riêng mail-dinh-kem (không công khai, 10 MB)';
    end if;
  end if;
  raise notice 'VAM00037 đính kèm: sẵn sàng';
end;
$vam00037_contract$;

notify pgrst, 'reload schema';

commit;
