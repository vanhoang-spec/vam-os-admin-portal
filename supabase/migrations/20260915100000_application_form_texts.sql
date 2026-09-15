-- ═══════════════════════════════════════════════════════════════════════════
-- Chữ trên form nộp đơn mentor / mentee do admin tự sửa
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 15/09/2026, chủ dự án: admin tự sửa được phần chữ trên /apply/mentor và
-- /apply/mentee — lời giới thiệu, hạn nộp, người liên hệ — mà không phải chờ
-- deploy. Trước migration này mọi câu chữ đó nằm cứng trong mã.
--
-- Mỗi dòng của bảng là MỘT khối chữ đã được sửa khác mặc định. Khối nào không có
-- dòng thì form hiện chữ mặc định trong lib/application-form-text-core.ts. Vì vậy
-- migration không chép nội dung nào vào đây: bảng trống là trạng thái hợp lệ, và
-- form trông y như trước khi có bảng.
--
-- Danh sách khối (text_key) chỉ nằm trong TypeScript. Ràng buộc ở đây chỉ canh
-- hình dạng khoá và độ dài — thêm một khối mới về sau không phải viết lại CHECK.
--
-- Không mở quyền cho anon / authenticated: RLS bật, không có policy nào. Chỉ
-- đường service role của máy chủ đọc và ghi được; trang công khai đọc qua máy chủ.
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
-- Gắn theo đợt tuyển, cùng cách với application_form_controls: chữ của Mùa 12
-- ("hạn nộp 19/09/2026") không được tự chạy sang form của mùa sau.
--
-- body được phép RỖNG: một khối tuỳ chọn (khung lưu ý hạn nộp) để trống nghĩa là
-- "đừng hiện khối này nữa" — khác với không có dòng, nghĩa là "hiện mặc định".
create table if not exists public.application_form_texts (
  id              uuid primary key default gen_random_uuid(),
  intake_batch_id uuid not null references public.intake_batches(id),
  text_key        text not null,
  body            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.admin_users(id),
  constraint application_form_texts_key_shape_check
    check (text_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint application_form_texts_body_length_check
    check (char_length(body) <= 20000)
);

-- Mỗi đợt tuyển, mỗi khối đúng một dòng: "khối này đang là gì" không phải chọn
-- giữa hai bản, và lệnh ghi upsert theo đúng cặp khoá này.
create unique index if not exists application_form_texts_batch_key_key
  on public.application_form_texts (intake_batch_id, text_key);

comment on table public.application_form_texts is
  'Khối chữ trên form nộp đơn /apply/mentor, /apply/mentee đã được admin sửa khác mặc định. Không có dòng = hiện chữ mặc định trong lib/application-form-text-core.ts. body rỗng = không hiện khối tuỳ chọn đó.';

-- ── 2. Khoá bảng ────────────────────────────────────────────────────────────
alter table public.application_form_texts enable row level security;

revoke all on public.application_form_texts from public;
revoke all on public.application_form_texts from anon;
revoke all on public.application_form_texts from authenticated;

-- ── 3. Nới danh sách loại nhật ký ───────────────────────────────────────────
-- admin_audit_log_action_type_check là một danh sách ĐÓNG. Không nới thì mỗi lần
-- lưu chữ vẫn báo thành công nhưng dòng nhật ký bị từ chối lặng lẽ (hàm ghi nhật
-- ký nuốt lỗi), và không ai tra lại được ai đã đổi hạn nộp — đúng lỗi đã xảy ra
-- với chuỗi sự kiện, xem 20260913230000_admin_audit_event_series_actions.sql.
--
-- Cùng khuôn với migration đó: đọc định nghĩa đang chạy, chỉ nối giá trị còn thiếu
-- vào đuôi mảng, rồi so tập trước/sau ngay trong khối. Đuôi mảng (một dấu đóng
-- mảng rồi một-hoặc-nhiều dấu đóng ngoặc) được tách bằng substring thay vì tham
-- chiếu ngược trong regexp_replace, để file này không chứa dấu gạch chéo ngược nào.
do $audit_form_text_widen$
declare
  v_new constant text := 'update_application_form_text';
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
    raise notice 'AUDIT_FORM_TEXT: ràng buộc đã nhận update_application_form_text; không làm gì.';
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

  raise notice 'AUDIT_FORM_TEXT: nới từ % lên % giá trị.',
    cardinality(v_before_values), cardinality(v_after_values);
end;
$audit_form_text_widen$;

-- ── 4. Tự kiểm ──────────────────────────────────────────────────────────────
-- Migration báo thành công trong khi bảng chưa khoá, hay nhật ký chưa nhận loại
-- mới, là thứ chỉ lộ ra vào lần admin sửa hạn nộp đầu tiên.
do $self_check$
declare
  v_rls boolean;
  v_def text;
  v     text;
begin
  if to_regclass('public.application_form_texts') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng application_form_texts chưa được tạo';
  end if;

  select c.relrowsecurity
    into v_rls
  from pg_class c
  where c.oid = 'public.application_form_texts'::regclass;

  if v_rls is distinct from true then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: application_form_texts chưa bật RLS';
  end if;

  if not exists (
    select 1
    from pg_index i
    where i.indexrelid = to_regclass('public.application_form_texts_batch_key_key')
      and i.indisunique
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số duy nhất (intake_batch_id, text_key)';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('anon', 'public.application_form_texts', 'select') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon vẫn đọc được application_form_texts';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_table_privilege('authenticated', 'public.application_form_texts', 'select') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: authenticated vẫn đọc được application_form_texts';
  end if;

  select pg_get_constraintdef(c.oid)
    into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc admin_audit_log_action_type_check';
  end if;

  if position(quote_literal('update_application_form_text') in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận update_application_form_text';
  end if;

  -- Giá trị cũ canh gác: nới mà làm mất nhật ký sửa sự kiện hay đổi quyền nhân sự
  -- thì tệ hơn không nới.
  foreach v in array array[
    'update_event',
    'set_application_form_state',
    'update_admin_user',
    'send_event_reminder'
  ] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
