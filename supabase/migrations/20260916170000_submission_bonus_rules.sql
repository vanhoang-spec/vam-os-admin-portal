-- ═══════════════════════════════════════════════════════════════════════════
-- Điểm cộng theo ngày nộp
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 16/09/2026, chủ dự án: team support tự đặt "nộp từ ngày nào / đến hết ngày nào
-- thì được cộng N điểm" cho form tuyển mentee đang mở, thao tác ngay trên app.
-- Về sau form đăng ký training, company visit… dùng cùng kiểu cài đặt này.
--
-- Mỗi dòng là MỘT mốc. Điểm cộng KHÔNG lưu vào đơn: màn hình tính lúc đọc, từ
-- giờ nộp của đơn (applications.created_at, đọc theo giờ Việt Nam) — xem
-- lib/submission-bonus-core.ts. Vì vậy migration không đụng một dòng đơn nào, và
-- bảng trống nghĩa là không ai được cộng — y như trước khi có bảng.
--
-- form_kind: hôm nay chỉ có 'application' (form nộp đơn mentor/mentee, gắn theo
-- đợt tuyển + vai trò). Form sự kiện về sau là một giá trị mới cộng thêm vào
-- CHECK và một cột đích mới, không phải một bảng thứ hai.
--
-- Không mở quyền cho anon / authenticated: RLS bật, không có policy nào. Chỉ
-- đường service role của máy chủ đọc và ghi được.
--
-- Chạy lại vô hại: mọi bước đều có điều kiện "nếu chưa có".
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.intake_batches') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.intake_batches';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.admin_users';
  end if;
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.admin_audit_log';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_audit_log'::regclass
      and conname = 'admin_audit_log_action_type_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc admin_audit_log_action_type_check';
  end if;
end;
$preflight$;

-- ── 1. Bảng ────────────────────────────────────────────────────────────────
-- starts_on / ends_on là NGÀY theo lịch Việt Nam, tính cả hai đầu. Một trong hai
-- được để trống ("nộp đến hết 10/09"), nhưng không được trống cả hai: một mốc
-- không có ngày nào là cộng điểm cho mọi đơn, và đó không bao giờ là ý người đặt.
--
-- Trần điểm 1–100 và độ dài tên khớp lib/submission-bonus-core.ts. Nó không phải
-- luật nghiệp vụ; nó chặn một lệnh ghi đi vòng qua màn hình.
create table if not exists public.submission_bonus_rules (
  id              uuid primary key default gen_random_uuid(),
  form_kind       text not null,
  intake_batch_id uuid references public.intake_batches(id),
  role_applied    text,
  label           text,
  starts_on       date,
  ends_on         date,
  points          integer not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.admin_users(id),
  constraint submission_bonus_rules_form_kind_check
    check (form_kind in ('application')),
  constraint submission_bonus_rules_application_target_check
    check (form_kind <> 'application' or (intake_batch_id is not null and role_applied in ('mentor', 'mentee'))),
  constraint submission_bonus_rules_window_check
    check (starts_on is not null or ends_on is not null),
  constraint submission_bonus_rules_window_order_check
    check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint submission_bonus_rules_points_check
    check (points between 1 and 100),
  constraint submission_bonus_rules_label_length_check
    check (label is null or char_length(label) <= 120)
);

create index if not exists submission_bonus_rules_application_idx
  on public.submission_bonus_rules (intake_batch_id, role_applied);

comment on table public.submission_bonus_rules is
  'Mốc điểm cộng theo ngày nộp. Điểm tính lúc đọc từ giờ nộp của đơn (giờ Việt Nam), không lưu vào đơn. Đơn rơi vào nhiều mốc nhận mốc cao nhất. Xem lib/submission-bonus-core.ts.';

-- ── 2. Khoá bảng ────────────────────────────────────────────────────────────
alter table public.submission_bonus_rules enable row level security;

revoke all on public.submission_bonus_rules from public;
revoke all on public.submission_bonus_rules from anon;
revoke all on public.submission_bonus_rules from authenticated;

-- ── 3. Nới danh sách loại nhật ký ───────────────────────────────────────────
-- Thêm/xoá một mốc đổi điểm của hàng trăm đơn đã nộp. Không nới thì lệnh ghi vẫn
-- báo thành công nhưng dòng nhật ký bị từ chối lặng lẽ (hàm ghi nhật ký nuốt lỗi),
-- và không ai tra lại được ai đã đổi điểm cộng lúc nào.
--
-- Cùng khuôn với 20260915100000_application_form_texts.sql: đọc định nghĩa đang
-- chạy, chỉ nối giá trị còn thiếu vào đuôi mảng, rồi so tập trước/sau ngay trong
-- khối. File này không chứa dấu gạch chéo ngược nào.
do $audit_bonus_widen$
declare
  v_new constant text := 'update_submission_bonus_rules';
  v_existing      text;
  v_before_values text[];
  v_quotes        integer;
  v_tail          text;
  v_rebuilt       text;
  v_after         text;
  v_after_values  text[];
  v_lost          text[];
  v_expected      text[];
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_existing not ilike '%= ANY (ARRAY[%' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check không ở dạng ANY (ARRAY[...]): %',
      v_existing;
  end if;

  if position(quote_literal(v_new) in v_existing) > 0 then
    raise notice 'AUDIT_BONUS: ràng buộc đã nhận update_submission_bonus_rules; không làm gì.';
    return;
  end if;

  select array_agg(m[1] order by m[1])
    into v_before_values
  from regexp_matches(v_existing, '''([^'']*)''::text', 'g') as m;

  -- Mỗi giá trị đóng góp đúng hai dấu nháy. Lệch nghĩa là đọc hụt — và so
  -- trước/sau trên một tập đọc hụt thì không chứng minh được gì.
  v_quotes := length(v_existing) - length(replace(v_existing, '''', ''));
  if v_before_values is null or v_quotes <> cardinality(v_before_values) * 2 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đọc được % giá trị nhưng đếm được % dấu nháy trong admin_audit_log_action_type_check',
      coalesce(cardinality(v_before_values), 0), v_quotes;
  end if;

  v_tail := substring(v_existing from '[]][)]+$');
  if v_tail is null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào admin_audit_log_action_type_check: %',
      v_existing;
  end if;

  v_rebuilt := left(v_existing, length(v_existing) - length(v_tail))
            || format(', %L::text', v_new)
            || v_tail;

  execute 'alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check';
  execute 'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');

  select pg_get_constraintdef(c.oid)
    into v_after
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1])
    into v_after_values
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  -- Không được mất giá trị cũ nào.
  select coalesce(array_agg(b order by b), '{}')
    into v_lost
  from unnest(v_before_values) as b
  where not (b = any (coalesce(v_after_values, '{}')));

  if cardinality(v_lost) > 0 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ: %',
      v_lost;
  end if;

  -- Và tập sau phải đúng bằng tập trước cộng đúng một giá trị mới — không hơn.
  select array_agg(x order by x)
    into v_expected
  from (
    select unnest(v_before_values) as x
    union
    select v_new
  ) as s;

  if v_expected is distinct from v_after_values then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: tập giá trị sau khi nới không khớp tập mong đợi (trước % → sau %)',
      cardinality(v_before_values), cardinality(v_after_values);
  end if;

  raise notice 'AUDIT_BONUS: nới từ % lên % giá trị.',
    cardinality(v_before_values), cardinality(v_after_values);
end;
$audit_bonus_widen$;

-- ── 4. Tự kiểm ──────────────────────────────────────────────────────────────
-- Migration báo thành công trong khi bảng chưa khoá, ràng buộc ngày chưa có, hay
-- nhật ký chưa nhận loại mới, là thứ chỉ lộ ra vào lần đầu team đặt mốc.
do $self_check$
declare
  v_rls boolean;
  v_def text;
  v     text;
begin
  if to_regclass('public.submission_bonus_rules') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng submission_bonus_rules chưa được tạo';
  end if;

  select c.relrowsecurity
    into v_rls
  from pg_class c
  where c.oid = 'public.submission_bonus_rules'::regclass;

  if v_rls is distinct from true then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: submission_bonus_rules chưa bật RLS';
  end if;

  foreach v in array array[
    'submission_bonus_rules_form_kind_check',
    'submission_bonus_rules_application_target_check',
    'submission_bonus_rules_window_check',
    'submission_bonus_rules_window_order_check',
    'submission_bonus_rules_points_check',
    'submission_bonus_rules_label_length_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.submission_bonus_rules'::regclass
        and conname = v
    ) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc %', v;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('anon', 'public.submission_bonus_rules', 'select') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon vẫn đọc được submission_bonus_rules';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('anon', 'public.submission_bonus_rules', 'insert') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon vẫn ghi được submission_bonus_rules';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_table_privilege('authenticated', 'public.submission_bonus_rules', 'select') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: authenticated vẫn đọc được submission_bonus_rules';
  end if;

  select pg_get_constraintdef(c.oid)
    into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc admin_audit_log_action_type_check';
  end if;

  if position(quote_literal('update_submission_bonus_rules') in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận update_submission_bonus_rules';
  end if;

  -- Giá trị cũ canh gác: nới mà làm mất nhật ký sửa chữ form hay mở/đóng form thì
  -- tệ hơn không nới.
  foreach v in array array[
    'update_application_form_text',
    'set_application_form_state',
    'update_event',
    'update_admin_user'
  ] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
