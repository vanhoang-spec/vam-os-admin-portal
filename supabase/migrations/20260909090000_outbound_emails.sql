-- Outbound email send log — nền tảng cho thư xác nhận đơn đăng ký.
--
-- Scope:
--   * public.outbound_emails — chép từ mục 3 của migration 064 trên nhánh
--     s12-phase9-mkt-plan, KHÔNG kèm mentor_season_confirmations (phần đó xung
--     đột với person_season_invites mà main đã có) và KHÔNG kèm
--     apply_submission_log.
--   * Ba khác biệt duy nhất so với 064: provider mặc định 'brevo' thay vì
--     'resend' (lib/email.ts vốn luôn ghi 'brevo'), thêm batch_id không kèm FK
--     làm chỗ dành sẵn cho 069, và hai index mới.
--   * Nới từ vựng admin_audit_log.action_type thêm đúng một giá trị.
--
-- Không tạo policy nào: bảng chỉ service_role đọc/ghi, đúng như 064.
-- Runbook vận hành: docs/runbooks/email-brevo-setup.md

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. Bảng
-- ------------------------------------------------------------
create table if not exists public.outbound_emails (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null,
  to_email            text not null,
  subject             text null,
  related_table       text null,
  related_id          uuid null,
  status              text not null default 'queued',
  provider            text not null default 'brevo',
  provider_message_id text null,
  error               text null,
  batch_id            uuid null,
  created_at          timestamptz not null default now(),

  constraint outbound_emails_status_check
    check (status in ('queued', 'sent', 'failed', 'skipped')),

  constraint outbound_emails_kind_check
    check (kind in (
      'mentor_confirmation_link',
      'mentee_application_confirmation',
      'mentor_application_confirmation',
      'review_batch_assigned',
      'interview_scheduled',
      'reviewer_invite'
    ))
);

comment on table public.outbound_emails is
  'Send log for every email the application sends through lib/email.ts. One row per recipient per send attempt; status skipped means sending was disabled by configuration.';

comment on column public.outbound_emails.provider_message_id is
  'RFC Message-ID tra ve boi provider (Brevo: <...@smtp-relay.brevo.com>). Buoc nhan thu qua IMAP sau nay se khop In-Reply-To/References vao chinh cot nay — index rieng da co san.';

comment on column public.outbound_emails.batch_id is
  'Cho danh san cho migration 069 (email_batches). Nullable, CHUA co khoa ngoai: 069 phai them FK bang mot add constraint tuong minh, vi add column if not exists cua no se bi bo qua khi cot da ton tai.';

-- ------------------------------------------------------------
-- 2. Index
-- ------------------------------------------------------------
create index if not exists outbound_emails_kind_created_idx
  on public.outbound_emails (kind, created_at desc);

create index if not exists outbound_emails_related_idx
  on public.outbound_emails (related_table, related_id);

-- Chuẩn bị cho việc nhận thư trả lời: thư hồi âm mang In-Reply-To bằng đúng
-- Message-ID này, nên tra ngược phải nhanh.
create index if not exists outbound_emails_provider_message_id_idx
  on public.outbound_emails (provider_message_id)
  where provider_message_id is not null;

-- Trọng tài chống gửi trùng cho thư xác nhận đơn: một đơn chỉ có đúng một thư
-- còn sống (queued hoặc sent). Dòng failed/skipped rơi ra khỏi phạm vi index
-- nên lượt gửi bù sau vẫn thử lại được.
--
-- CỐ Ý chỉ phủ hai loại thư xác nhận. Các loại khác được phép gửi lại cho cùng
-- một bản ghi (đổi lịch phỏng vấn, gửi lại thư ghép cặp); nếu phủ rộng thì lần
-- gửi thứ hai sẽ vi phạm index lúc ghi log, mà lib/email.ts nuốt lỗi ghi log —
-- thư vẫn đi còn dòng log biến mất.
create unique index if not exists outbound_emails_application_confirmation_once_idx
  on public.outbound_emails (kind, related_table, related_id)
  where status in ('queued', 'sent')
    and kind in ('mentee_application_confirmation', 'mentor_application_confirmation')
    and related_id is not null;

-- ------------------------------------------------------------
-- 3. Hợp đồng quyền
-- ------------------------------------------------------------
alter table public.outbound_emails enable row level security;
alter table public.outbound_emails force row level security;

revoke all on table public.outbound_emails from public, anon, authenticated;

-- Không cấp delete: đây là sổ ghi, không phải hàng đợi xoá được.
grant select, insert, update on table public.outbound_emails to service_role;

-- ------------------------------------------------------------
-- 4. Nới từ vựng admin_audit_log.action_type
--
-- admin_audit_log_action_type_check là danh sách đóng (062, 063, 069, 070,
-- 071). Mọi helper ghi audit trên main đều nuốt lỗi, nên một action_type lạ sẽ
-- bị từ chối 23514 và ÂM THẦM không bao giờ được ghi.
--
-- Khối này đọc-và-nối chứ không hard-code danh sách: nó không biết trước
-- Production đang có bao nhiêu giá trị, và không được phép làm mất giá trị nào.
-- ------------------------------------------------------------
do $outbound_emails_audit_vocab$
declare
  v_new_value constant text := 'send_application_confirmation_backfill';
  v_def    text;
  v_vocab  text[];
  v_post   text[];
  v_quotes integer;
  v_after  text;
  v_check  text[];
begin
  select pg_get_constraintdef(c.oid, true)
    into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise notice 'OUTBOUND_EMAILS: admin_audit_log_action_type_check not present; skipping vocabulary step.';
    return;
  end if;

  if position(quote_literal(v_new_value) in v_def) > 0 then
    raise notice 'OUTBOUND_EMAILS: audit vocabulary already accepts %; nothing to do.', v_new_value;
    return;
  end if;

  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception
      'OUTBOUND_EMAILS ABORTED [AUDIT_VOCAB_SHAPE]: constraint is not in ANY (ARRAY[...]) form: %',
      v_def;
  end if;

  select array_agg(m[1] order by m[1])
    into v_vocab
  from regexp_matches(v_def, '''([^'']*)''::text', 'g') as m;

  if v_vocab is null or coalesce(array_length(v_vocab, 1), 0) = 0 then
    raise exception 'OUTBOUND_EMAILS ABORTED [AUDIT_VOCAB_EMPTY]: no values parsed from the constraint.';
  end if;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đã đọc hụt, và đọc
  -- hụt rồi dựng lại constraint là làm mất giá trị của người khác.
  v_quotes := length(v_def) - length(replace(v_def, '''', ''));
  if v_quotes <> array_length(v_vocab, 1) * 2 then
    raise exception
      'OUTBOUND_EMAILS ABORTED [AUDIT_VOCAB_SHAPE]: parsed % values but counted % quotes.',
      array_length(v_vocab, 1), v_quotes;
  end if;

  v_post := v_vocab || v_new_value;

  alter table public.admin_audit_log
    drop constraint admin_audit_log_action_type_check;

  -- Bắt buộc dạng array['a'::text, ...] để pg_get_constraintdef vẫn deparse ra
  -- ANY (ARRAY[...]); dùng '{a,b}'::text[] sẽ làm gãy các gói kiểm kiểu M071.
  execute format(
    'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check check (action_type = any (array[%s]))',
    (select string_agg(format('%L::text', x), ', ' order by x) from unnest(v_post) x)
  );

  select pg_get_constraintdef(c.oid, true)
    into v_after
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1])
    into v_check
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  if v_check is distinct from (select array_agg(x order by x) from unnest(v_post) x) then
    raise exception
      'OUTBOUND_EMAILS ABORTED [AUDIT_VOCAB_POST]: rebuilt vocabulary does not match the intended set.';
  end if;

  raise notice 'OUTBOUND_EMAILS: audit vocabulary grew from % to % values.',
    array_length(v_vocab, 1), array_length(v_post, 1);
end;
$outbound_emails_audit_vocab$;

-- ------------------------------------------------------------
-- 5. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $outbound_emails_contract$
declare
  offending text;
  missing   text;
begin
  -- 5a. RLS phải bật và ép trên bảng mới.
  select string_agg(c.relname, ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'outbound_emails'
    and (c.relrowsecurity is false or c.relforcerowsecurity is false);

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: row level security is not enabled and forced on: %', offending;
  end if;

  -- 5b. Không được có policy nào.
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename = 'outbound_emails';

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: unexpected policy present: %', offending;
  end if;

  -- 5c. Không được còn quyền nào cho PUBLIC, anon hay authenticated.
  select string_agg(format('%s -> %s:%s', c.relname, grantee_name, a.privilege_type), ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
           x.privilege_type
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
  ) a(grantee_name, privilege_type)
  where n.nspname = 'public'
    and c.relname = 'outbound_emails'
    and a.grantee_name in ('PUBLIC', 'anon', 'authenticated');

  if offending is not null then
    raise exception 'GRANT_CONTRACT_VIOLATION: client-role privileges remain: %', offending;
  end if;

  -- 5d. service_role không được có quyền delete trên sổ ghi.
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'outbound_emails'
      and grantee = 'service_role'
      and privilege_type = 'DELETE'
  ) then
    raise exception 'GRANT_CONTRACT_VIOLATION: service_role must not hold DELETE on outbound_emails.';
  end if;

  -- 5e. Các cột dành sẵn phải có mặt.
  select string_agg(want, ', ')
    into missing
  from unnest(array['batch_id', 'provider_message_id']) as want
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'outbound_emails'
      and column_name = want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails is missing column(s): %', missing;
  end if;

  -- 5f. Hai constraint phải đúng tên, vì 069 sẽ drop theo tên.
  select string_agg(want, ', ')
    into missing
  from unnest(array['outbound_emails_kind_check', 'outbound_emails_status_check']) as want
  where not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('public.outbound_emails')
      and conname = want
  );

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails is missing constraint(s): %', missing;
  end if;

  -- 5g. Index chống trùng phải tồn tại VÀ phải là unique.
  if not exists (
    select 1
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = to_regclass('public.outbound_emails')
      and ic.relname = 'outbound_emails_application_confirmation_once_idx'
      and i.indisunique
  ) then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_application_confirmation_once_idx must exist and be unique.';
  end if;
end;
$outbound_emails_contract$;

commit;

notify pgrst, 'reload schema';
