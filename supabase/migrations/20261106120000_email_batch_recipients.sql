-- =============================================================================
-- VAM00026 — Nhóm nhận thư "Danh sách tùy chỉnh" và danh sách người nhận chốt vào lô
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới mở lô với audience = 'custom' và ghi vào
-- public.email_batch_recipients; thiếu migration này thì nút gửi báo lỗi CHECK / thiếu bảng.
--
-- VÌ SAO PHẢI CHỐT DANH SÁCH VÀO LÔ
-- Một lô không gửi xong trong một lần chạy, và "Gửi tiếp" của mọi nhóm cũ DỰNG LẠI danh sách từ
-- nhóm đã chốt vào lô (lib/bulk-mail-core.ts). Danh sách tùy chỉnh là kết quả của nhiều nguồn cộng
-- lại, cộng người thêm tay, trừ người bỏ tick — không dựng lại được. Nên lúc mở lô, máy chủ ghi
-- đúng danh sách cuối cùng vào bảng này, và "Gửi tiếp" của lô 'custom' chỉ đọc bảng này: không ai
-- ngoài danh sách đã xem trước nhận thư, kể cả khi dữ liệu nguồn đổi giữa hai lần bấm.
--
-- Email và họ tên ở đây là bản chụp từ database lúc mở lô (không lấy từ form). Mỗi email một dòng
-- trong một lô (unique) — một người không nhận hai lá.
--
-- Bảng chỉ máy chủ đọc/ghi: bật RLS, không policy, thu hồi quyền anon/authenticated. service_role
-- chỉ được đọc và thêm — danh sách đã chốt không sửa, không xoá.
--
-- Nới email_batches_audience_check theo lối cộng thêm (khuôn 20261024120000). Chạy lại vô hại.
-- =============================================================================

begin;

do $vam00026_prereq$
begin
  if to_regclass('public.email_batches') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batches (migration 20260909150000)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_check'
  ) then
    raise exception 'PREREQ_MISSING: cần email_batches_audience_check (migration 20260910090000)';
  end if;
  if position('''mentee_interview_rejected''' in (
    select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conrelid = 'public.email_batches'::regclass and c.conname = 'email_batches_audience_check'
  )) = 0 then
    raise exception 'PREREQ_MISSING: cần migration 20261024120000 (nhóm mentee_interview_rejected) chạy trước';
  end if;
end;
$vam00026_prereq$;

-- ------------------------------------------------------------
-- 1. Nới ràng buộc nhóm: thêm 'custom', giữ nguyên mọi nhóm cũ
-- ------------------------------------------------------------
do $vam00026_widen$
declare
  existing text;
  rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  if position('''custom''' in existing) > 0 then
    return;
  end if;
  rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''custom''::text\1');
  if rebuilt = existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %', existing;
  end if;
  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$vam00026_widen$;

-- ------------------------------------------------------------
-- 2. Danh sách người nhận đã chốt của một lô 'custom'
-- ------------------------------------------------------------
create table if not exists public.email_batch_recipients (
  id uuid primary key default gen_random_uuid(),
  -- Xoá lô thì danh sách của nó đi theo; danh sách không có nghĩa khi không còn lô.
  batch_id uuid not null references public.email_batches(id) on delete cascade,
  -- Thứ tự gửi, đúng thứ tự người bấm đã thấy ở bước xem trước.
  position integer not null,
  -- Dòng nguồn mà sổ thư (outbound_emails.related_table/related_id) nối lá thư về.
  -- Không khoá ngoại: bốn bảng khác nhau, và xoá một người không được kẹt vì một lô thư cũ.
  relation_table text not null,
  relation_id uuid not null,
  email text not null,
  full_name text not null,
  role text not null,
  created_at timestamptz not null default now(),

  constraint email_batch_recipients_position_check check (position >= 0),
  constraint email_batch_recipients_relation_table_check
    check (relation_table in ('people', 'admin_users', 'event_registrations', 'applications')),
  constraint email_batch_recipients_role_check
    check (role in ('mentor', 'mentee', 'staff', 'attendee')),
  -- Email đã chuẩn hoá (chữ thường, không khoảng trắng hai đầu) để unique bắt được trùng thật.
  constraint email_batch_recipients_email_check
    check (email = lower(btrim(email)) and email like '_%@_%'),
  constraint email_batch_recipients_full_name_check check (btrim(full_name) <> ''),
  constraint email_batch_recipients_batch_email_key unique (batch_id, email),
  constraint email_batch_recipients_batch_position_key unique (batch_id, position)
);

comment on table public.email_batch_recipients is
  'Danh sách người nhận đã chốt của một lô gửi hàng loạt nhóm custom (Danh sách tùy chỉnh, VAM00026). Gửi tiếp đọc bảng này, không dựng lại danh sách. Chỉ máy chủ đọc/ghi; không sửa, không xoá.';

-- Chỉ lô 'custom' có danh sách chốt: một dòng gắn vào lô nhóm khác là một danh sách không ai đọc,
-- và là dấu hiệu mã đang ghi nhầm lô.
create or replace function public.email_batch_recipients_require_custom()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $email_batch_recipients_require_custom$
begin
  if not exists (
    select 1 from public.email_batches b
    where b.id = new.batch_id and b.audience = 'custom'
  ) then
    raise exception 'email_batch_recipients chỉ nhận dòng của lô nhóm custom';
  end if;
  return new;
end;
$email_batch_recipients_require_custom$;

revoke all on function public.email_batch_recipients_require_custom() from public, anon, authenticated;

drop trigger if exists email_batch_recipients_require_custom on public.email_batch_recipients;
create trigger email_batch_recipients_require_custom
before insert on public.email_batch_recipients
for each row
execute function public.email_batch_recipients_require_custom();

alter table public.email_batch_recipients enable row level security;
revoke all on public.email_batch_recipients from public, anon, authenticated, service_role;
grant select, insert on public.email_batch_recipients to service_role;

comment on column public.email_batches.audience is
  'Đối tượng nhận thư của lô: mentee, mentor, both, staff, returning_mentor, event, ba nhóm thư rớt mentee, hoặc custom (Danh sách tùy chỉnh — danh sách đã chốt nằm ở email_batch_recipients). Lần chạy tiếp theo đọc cột này chứ không nhận từ màn hình.';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $vam00026_contract$
declare
  def    text;
  v      text;
  leaked text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  foreach v in array array['mentee', 'mentor', 'both', 'staff', 'returning_mentor', 'event',
                           'mentee_cv_rejected', 'mentee_invite_withdrawn', 'mentee_interview_rejected', 'custom'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check thiếu %', v;
    end if;
  end loop;
  if (length(def) - length(replace(def, '''custom''', ''))) / length('''custom''') <> 1 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có custom nhiều lần';
  end if;

  if to_regclass('public.email_batch_recipients') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng public.email_batch_recipients';
  end if;
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
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài trên email_batch_recipients: %', leaked;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass
      and conname = 'email_batch_recipients_batch_email_key'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu unique (batch_id, email)';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_batch_recipients'::regclass
      and tgname = 'email_batch_recipients_require_custom' and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger email_batch_recipients_require_custom';
  end if;
end;
$vam00026_contract$;

notify pgrst, 'reload schema';

commit;
