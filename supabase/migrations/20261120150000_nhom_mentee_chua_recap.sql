-- =============================================================================
-- Nhóm nhận thư "Mentee chưa có recap trong tháng" + CC mentor của cặp
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR. Cần 20261106120000 và 20261109210000 đã chạy trước.
-- Thiếu migration này thì mở lô nhóm mới bị CHECK từ chối ngay lúc mở, chưa lá nào đi.
-- Các nhóm cũ và Danh sách tùy chỉnh chạy y như trước.
--
-- VÌ SAO LÔ NHÓM NÀY CHỐT DANH SÁCH (như lô custom), KHÔNG DỰNG LẠI MỖI LẦN "GỬI TIẾP"
--   Danh sách nhắc là ảnh chụp "tính tới đợt quét ngày 20": bài recap quét sau đó làm danh sách
--   đổi giữa hai lần bấm, và con số người bấm đã gõ xác nhận không còn là số lô sẽ gửi. Mỗi thư
--   còn mang CC riêng (mentor của cặp active mới nhất); CC phải đi đúng như lúc xác nhận ở MỌI
--   lần chạy, nên nó nằm cạnh người nhận trong danh sách chốt.
--
-- MỌI THAY ĐỔI LÀ CỘNG THÊM
--   1. email_batches_audience_check: đọc pg_get_constraintdef rồi NỐI 'mentee_no_recap_month'.
--   2. email_batches.audience_month (YYYY-MM, nullable): tháng của nhóm mới. Ràng buộc hình
--      dạng: nhóm mới BẮT BUỘC có tháng đúng dạng, nhóm khác BẮT BUỘC không có.
--   3. email_batch_recipients.cc_emails (text[], mặc định rỗng): địa chỉ CC của từng thư, đã
--      chuẩn hoá chữ thường, tối đa 5. Dòng cũ nhận mảng rỗng, nghĩa là "không CC" như trước.
--   4. Trigger chốt danh sách nhận thêm lô nhóm mới (thân hàm thay, TÊN giữ nguyên để tự kiểm
--      của 20261106120000 vẫn đúng).
-- Không đổi quyền, RLS, policy. Chạy lại lần hai vô hại.
-- =============================================================================

begin;

do $vam_chua_recap_prereq$
begin
  if to_regclass('public.email_batch_recipients') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batch_recipients (migration 20261106120000)';
  end if;
  if position('''external''' in coalesce((
    select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conrelid = 'public.email_batch_recipients'::regclass
      and c.conname = 'email_batch_recipients_relation_table_check'
  ), '')) = 0 then
    raise exception 'PREREQ_MISSING: cần migration 20261109210000 (nguồn external)';
  end if;
end;
$vam_chua_recap_prereq$;

-- ------------------------------------------------------------
-- 1. Nới ràng buộc nhóm nhận thư
-- ------------------------------------------------------------
do $vam_chua_recap_widen$
declare
  existing text;
  rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  if existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy email_batches_audience_check';
  end if;
  if position('''custom''' in existing) = 0 then
    raise exception 'PREREQ_MISSING: email_batches_audience_check chưa có custom (migration 20261106120000)';
  end if;
  if position('''mentee_no_recap_month''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''mentee_no_recap_month''::text\1');
  if rebuilt = existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %', existing;
  end if;
  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$vam_chua_recap_widen$;

-- ------------------------------------------------------------
-- 2. Tháng của nhóm "chưa có recap"
-- ------------------------------------------------------------
alter table public.email_batches
  add column if not exists audience_month text;

comment on column public.email_batches.audience_month is
  'Tháng (YYYY-MM) của nhóm mentee_no_recap_month, chốt lúc mở lô. Null với mọi nhóm khác.';

do $vam_chua_recap_month_shape$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_month_shape_check'
  ) then
    -- `is not null` viết rõ: CHECK cho qua khi biểu thức ra NULL, mà `null ~ '...'` là NULL —
    -- thiếu vế này thì lô nhóm mới KHÔNG có tháng vẫn ghi được.
    alter table public.email_batches
      add constraint email_batches_audience_month_shape_check check (
        (audience is distinct from 'mentee_no_recap_month' and audience_month is null)
        or (audience = 'mentee_no_recap_month' and audience_month is not null
            and audience_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
      );
  end if;
end;
$vam_chua_recap_month_shape$;

-- ------------------------------------------------------------
-- 3. CC của từng thư trong danh sách chốt
-- ------------------------------------------------------------
alter table public.email_batch_recipients
  add column if not exists cc_emails text[] not null default '{}';

comment on column public.email_batch_recipients.cc_emails is
  'Địa chỉ CC của thư gửi người này (vd mentor của cặp ở nhóm mentee_no_recap_month), đã chuẩn hoá chữ thường, tối đa 5. Rỗng = không CC. Mỗi lần Gửi tiếp đọc đúng cột này.';

do $vam_chua_recap_cc_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass
      and conname = 'email_batch_recipients_cc_emails_check'
  ) then
    alter table public.email_batch_recipients
      add constraint email_batch_recipients_cc_emails_check check (
        cardinality(cc_emails) <= 5
        and array_position(cc_emails, null) is null
        and array_to_string(cc_emails, ',') = lower(array_to_string(cc_emails, ','))
        and array_to_string(cc_emails, ',') !~ '[[:space:]]'
        and not (email = any (cc_emails))
      );
  end if;
end;
$vam_chua_recap_cc_check$;

-- ------------------------------------------------------------
-- 4. Lô nhóm mới cũng có danh sách chốt
-- ------------------------------------------------------------
create or replace function public.email_batch_recipients_require_custom()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $email_batch_recipients_require_custom$
begin
  if not exists (
    select 1 from public.email_batches b
    where b.id = new.batch_id and b.audience in ('custom', 'mentee_no_recap_month')
  ) then
    raise exception 'email_batch_recipients chỉ nhận dòng của lô nhóm custom hoặc mentee_no_recap_month';
  end if;
  return new;
end;
$email_batch_recipients_require_custom$;

revoke all on function public.email_batch_recipients_require_custom() from public, anon, authenticated;

comment on column public.email_batches.audience is
  'Đối tượng nhận thư của lô: mentee, mentor, both, staff, returning_mentor, event, ba nhóm thư rớt mentee, custom (Danh sách tùy chỉnh), hoặc mentee_no_recap_month (mentee chưa có recap trong tháng audience_month, CC mentor). Hai nhóm cuối có danh sách chốt ở email_batch_recipients. Lần chạy tiếp theo đọc cột này chứ không nhận từ màn hình.';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $vam_chua_recap_contract$
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
                           'mentee_cv_rejected', 'mentee_invite_withdrawn', 'mentee_interview_rejected',
                           'custom', 'mentee_no_recap_month'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check thiếu %', v;
    end if;
  end loop;
  if (length(def) - length(replace(def, '''mentee_no_recap_month''', ''))) / length('''mentee_no_recap_month''') <> 1 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có mentee_no_recap_month nhiều lần';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batches' and column_name = 'audience_month'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu email_batches.audience_month';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batch_recipients' and column_name = 'cc_emails'
      and is_nullable = 'NO'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu email_batch_recipients.cc_emails (not null)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass and conname = 'email_batches_audience_month_shape_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batch_recipients'::regclass and conname = 'email_batch_recipients_cc_emails_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc audience_month / cc_emails';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_batch_recipients'::regclass
      and tgname = 'email_batch_recipients_require_custom' and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger email_batch_recipients_require_custom';
  end if;
  if position('mentee_no_recap_month' in pg_get_functiondef('public.email_batch_recipients_require_custom()'::regprocedure)) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: trigger chốt danh sách chưa nhận lô mentee_no_recap_month';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('email_batches', 'email_batch_recipients')) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches / email_batch_recipients lại có policy';
  end if;
  select string_agg(format('%s:%s', grantee, privilege_type), ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('email_batches', 'email_batch_recipients')
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài: %', leaked;
  end if;
end;
$vam_chua_recap_contract$;

notify pgrst, 'reload schema';

commit;
