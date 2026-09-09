-- ============================================================
-- Kho mẫu thư và lô gửi hàng loạt
-- ============================================================
--
-- Vì sao có migration này: `outbound_emails` (migration 20260909090000) ghi
-- lại MỌI bức thư đã gửi, nhưng không có chỗ nào để SOẠN một bức thư. Mọi nội
-- dung thư hiện nay nằm trong `lib/email-core.ts` — nghĩa là muốn đổi một câu
-- chữ cũng phải sửa code và chờ deploy. Core Team không tự làm được.
--
-- Migration này thêm ba thứ, và chỉ ba thứ:
--
--   1. public.email_templates     — tiêu đề + nội dung, có ô điền
--   2. public.email_template_log  — nhật ký chỉ-ghi-thêm: ai soạn, ai duyệt
--   3. public.email_batches       — một lần gửi hàng loạt
--   kèm: gắn khoá ngoại cho outbound_emails.batch_id đã dành sẵn, và nới
--        outbound_emails.kind thêm đúng một giá trị.
--
-- ------------------------------------------------------------
-- Ô ĐIỀN: VÌ SAO MẪU THƯ KHÔNG BAO GIỜ CHỨA TÊN NGƯỜI
-- ------------------------------------------------------------
-- Mẫu thư giữ `{{ten_nguoi_nhan}}`, không bao giờ giữ "Nguyễn Thị Bích Ngọc".
-- Giá trị thật được điền lúc gửi, ở phía máy chủ. Nhờ vậy một mẫu thư có thể
-- được soạn, sửa, đưa cho người khác đọc, hoặc nhờ trợ lý viết hộ, mà không
-- một dòng dữ liệu cá nhân nào rời khỏi hệ thống.
--
-- Danh mục ô điền là DANH SÁCH ĐÓNG, khai báo trong `lib/email-templates-core.ts`.
-- Không mở thẳng vào `raw_payload` của đơn: cho người soạn tự chọn bất kỳ
-- trường nào trong đơn nghĩa là một cú bấm nhầm gửi số điện thoại của bạn
-- mentee này cho bạn mentee khác.
--
-- ------------------------------------------------------------
-- LÁT NÀY CỐ Ý KHÔNG LÀM GÌ
-- ------------------------------------------------------------
--   * Không đụng vào nội dung thư nào đang chạy. `reviewer_invite` và
--     `interview_round_invite` vẫn do builder trong `lib/email-core.ts` dựng,
--     y nguyên. Đợt mời 22 mentor chấm hồ sơ đang giữa chừng — đổi thân thư
--     của nó ngay lúc này là rủi ro không có lý do gì để nhận.
--   * Không thêm `program_documents` / `mentee_dossier_links`. Chúng thuộc
--     giai đoạn sau ghép cặp, và các ô điền của chúng chưa có gì để điền.
--   * Không ghi một dòng dữ liệu nào. Mẫu thư đầu tiên được soạn trong app.
--
-- ------------------------------------------------------------
-- HỢP ĐỒNG BẢO MẬT
-- ------------------------------------------------------------
-- Server-only, giống hệt `outbound_emails`: bật RLS, KHÔNG policy nào, thu hồi
-- mọi quyền của PUBLIC/anon/authenticated, chỉ cấp cho service_role đúng phần
-- nó cần. Trình duyệt không bao giờ nói chuyện trực tiếp với ba bảng này.
--
-- Chạy lại nhiều lần vô hại: create-if-not-exists / add-if-missing xuyên suốt.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — điều kiện tiên quyết
-- ------------------------------------------------------------
-- Thà dừng ở đây với một câu nói rõ thiếu gì, còn hơn để một khoá ngoại gãy
-- giữa chừng rồi phải đọc ngược thông báo của Postgres.
do $email_templates_prereq$
begin
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: cần public.seasons';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần public.admin_users';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: cần public.outbound_emails (migration 20260909090000)';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: cần hàm public.set_updated_at';
  end if;
end;
$email_templates_prereq$;

-- ------------------------------------------------------------
-- 1. email_templates
-- ------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  kind text not null,

  -- Tên nội bộ, để Core Team phân biệt các mẫu cùng loại với nhau trong danh
  -- sách. Người nhận không bao giờ thấy tên này.
  name text not null,

  subject text not null default '',
  body text not null default '',

  status text not null default 'draft',

  -- Bản nháp đầu do đâu ra, để người duyệt biết mình đang đọc chữ của ai.
  ai_generated boolean not null default false,
  ai_model text null,
  ai_prompt_version text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  approved_by uuid null references public.admin_users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Từ vựng bắt đầu bằng đúng một giá trị. Mỗi loại thư mới là một `alter`
  -- riêng, có người ký — chứ không phải một chuỗi ai gõ cũng được.
  constraint email_templates_kind_check
    check (kind in (
      'general_announcement'
    )),

  constraint email_templates_status_check
    check (status in ('draft', 'approved', 'archived')),

  constraint email_templates_name_check
    check (btrim(name) <> ''),

  -- Mẫu đã duyệt thì phải biết duyệt lúc nào; bản nháp thì không.
  constraint email_templates_approved_shape_check
    check (
      (status = 'approved' and approved_at is not null)
      or (status <> 'approved' and approved_at is null)
    )
);

comment on table public.email_templates is
  'Nội dung các thư gửi hàng loạt. Mẫu thư chứa ô điền, không bao giờ chứa tên một người cụ thể: giá trị thật được điền lúc gửi, phía máy chủ.';

comment on column public.email_templates.name is
  'Tên nội bộ để Core Team phân biệt các mẫu cùng loại. Người nhận không thấy.';

-- CỐ Ý KHÔNG có index "mỗi mùa mỗi loại chỉ một bản duyệt" cho
-- general_announcement: cả mùa chỉ được phép có ĐÚNG MỘT thông báo chung đã
-- duyệt là vô lý — Core Team cần gửi nhiều thông báo khác nhau trong cùng một
-- mùa. Các loại thư "một-bản-duy-nhất" (thư báo trúng tuyển, thư mời kick-off)
-- khi được thêm vào sẽ mang index riêng của chúng.
create index if not exists email_templates_season_idx
  on public.email_templates (season_id, kind, status);

drop trigger if exists email_templates_set_updated_at on public.email_templates;
create trigger email_templates_set_updated_at
before update on public.email_templates
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. email_template_log — chỉ ghi thêm
-- ------------------------------------------------------------
create table if not exists public.email_template_log (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.email_templates(id) on delete cascade,
  action text not null,
  detail jsonb null,
  actor_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint email_template_log_action_check
    check (action in ('created', 'ai_drafted', 'edited', 'approved', 'archived'))
);

comment on table public.email_template_log is
  'Nhật ký chỉ-ghi-thêm: ai soạn, ai sửa, ai duyệt từng mẫu thư. UPDATE và DELETE bị trigger chặn.';

create index if not exists email_template_log_template_idx
  on public.email_template_log (template_id, created_at desc);

-- Chặn ở tầng database chứ không phải chỉ ở tầng quyền: một nhật ký duyệt mà
-- sửa được thì không còn là bằng chứng của việc gì.
create or replace function public.prevent_email_template_log_mutation()
returns trigger
language plpgsql
as $prevent_email_template_log_mutation$
begin
  raise exception 'email_template_log chỉ được ghi thêm';
end;
$prevent_email_template_log_mutation$;

drop trigger if exists email_template_log_no_update on public.email_template_log;
create trigger email_template_log_no_update
before update on public.email_template_log
for each row
execute function public.prevent_email_template_log_mutation();

drop trigger if exists email_template_log_no_delete on public.email_template_log;
create trigger email_template_log_no_delete
before delete on public.email_template_log
for each row
execute function public.prevent_email_template_log_mutation();

-- ------------------------------------------------------------
-- 3. email_batches
-- ------------------------------------------------------------
-- Một lần gửi hàng loạt. Từng lần gửi cho từng người vẫn nằm ở
-- `outbound_emails`, nối vào đây qua `batch_id`.
--
-- Bảng này tồn tại vì gửi hàng loạt KHÔNG kết thúc trong một request: Brevo
-- gói miễn phí cho ~300 thư/ngày, mà số mentor + mentee của một mùa vượt con
-- số đó. Một lô đang chạy phải nhớ được nó đã đi tới đâu để lần sau đi tiếp.
create table if not exists public.email_batches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  kind text not null,
  template_id uuid null references public.email_templates(id) on delete set null,

  status text not null default 'running',
  requested_count integer not null default 0,
  sent_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  note text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint email_batches_kind_check
    check (kind in (
      'general_announcement'
    )),

  constraint email_batches_status_check
    check (status in ('running', 'completed', 'failed')),

  constraint email_batches_counts_check
    check (
      requested_count >= 0
      and sent_count >= 0
      and skipped_count >= 0
      and failed_count >= 0
    ),

  constraint email_batches_completed_shape_check
    check (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null)
    )
);

comment on table public.email_batches is
  'Một lần gửi hàng loạt: mẫu thư nào, gửi cho bao nhiêu người, tới được bao nhiêu. Từng lần gửi lẻ nằm ở outbound_emails, nối qua batch_id.';

create index if not exists email_batches_season_idx
  on public.email_batches (season_id, kind, created_at desc);

-- ------------------------------------------------------------
-- 4. Nối vào outbound_emails
-- ------------------------------------------------------------
-- Cột `batch_id` ĐÃ tồn tại từ migration 20260909090000, để dành sẵn và cố ý
-- chưa có khoá ngoại — comment của nó nói rõ rằng migration này phải gắn khoá
-- bằng một `add constraint` tường minh, vì `add column if not exists` sẽ bị
-- Postgres bỏ qua khi cột đã có (và cùng với nó là cả mệnh đề references).
alter table public.outbound_emails
  add column if not exists batch_id uuid;

do $outbound_emails_batch_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbound_emails'::regclass
      and conname = 'outbound_emails_batch_id_fkey'
  ) then
    alter table public.outbound_emails
      add constraint outbound_emails_batch_id_fkey
      foreign key (batch_id) references public.email_batches(id) on delete set null;
  end if;
end;
$outbound_emails_batch_fk$;

comment on column public.outbound_emails.batch_id is
  'Lô gửi hàng loạt mà lần gửi này thuộc về. Null với các thư gửi lẻ.';

create index if not exists outbound_emails_batch_idx
  on public.outbound_emails (batch_id)
  where batch_id is not null;

-- Nới từ vựng `kind` thêm ĐÚNG MỘT giá trị.
--
-- Đọc-rồi-nối chứ không hard-code danh sách: hard-code nghĩa là bất kỳ giá trị
-- nào một migration khác đã thêm vào giữa hai lần deploy sẽ lặng lẽ biến mất,
-- và mọi dòng đang mang giá trị đó làm CHECK gãy ngay lúc `add constraint`.
do $outbound_emails_kind$
declare
  existing text;
  rebuilt text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy outbound_emails_kind_check';
  end if;

  -- Đã có sẵn thì thôi, để chạy lại migration vô hại.
  if position('''general_announcement''' in existing) > 0 then
    return;
  end if;

  -- `CHECK ((kind = ANY (ARRAY['a'::text, ...])))` — nối giá trị mới vào ngay
  -- trước dấu đóng mảng cuối cùng.
  rebuilt := regexp_replace(
    existing,
    '\]\)\)\)$',
    ', ''general_announcement''::text])))'
  );

  if rebuilt = existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check có dạng lạ, không nới được: %',
      existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$outbound_emails_kind$;

-- ------------------------------------------------------------
-- 5. Hợp đồng quyền — đặt cuối, sau khi mọi đối tượng đã tồn tại
-- ------------------------------------------------------------
alter table public.email_templates    enable row level security;
alter table public.email_template_log enable row level security;
alter table public.email_batches      enable row level security;

revoke all on public.email_templates    from public, anon, authenticated;
revoke all on public.email_template_log from public, anon, authenticated;
revoke all on public.email_batches      from public, anon, authenticated;

-- Nhật ký không có update/delete: quyền phản ánh đúng điều trigger đã chặn.
grant select, insert, update, delete on public.email_templates    to service_role;
grant select, insert                 on public.email_template_log to service_role;
grant select, insert, update         on public.email_batches      to service_role;

-- ------------------------------------------------------------
-- 6. Tự kiểm — chạy trong cùng transaction, sai thì cuộn ngược tất cả
-- ------------------------------------------------------------
do $email_templates_contract$
declare
  leaked text;
  missing text;
begin
  -- RLS bật, và không một policy nào — bảng server-only mà lỡ có policy thì
  -- nó thành bảng đọc được từ trình duyệt.
  select string_agg(c.relname, ', ')
    into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('email_templates', 'email_template_log', 'email_batches')
    and c.relrowsecurity is not true;

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: chưa bật RLS: %', missing;
  end if;

  select string_agg(distinct p.tablename, ', ')
    into leaked
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('email_templates', 'email_template_log', 'email_batches');

  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng server-only lại có policy: %', leaked;
  end if;

  -- Không một quyền nào lọt sang vai trò của trình duyệt.
  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('email_templates', 'email_template_log', 'email_batches')
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền lọt ra ngoài: %', leaked;
  end if;

  -- Nhật ký duyệt phải thực sự không sửa được.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_template_log'::regclass
      and tgname = 'email_template_log_no_update'
      and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger chặn UPDATE trên email_template_log';
  end if;

  -- Khoá ngoại đã gắn: đây là món nợ migration trước ghi lại cho migration này.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outbound_emails'::regclass
      and conname = 'outbound_emails_batch_id_fkey'
      and contype = 'f'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails.batch_id vẫn chưa có khoá ngoại';
  end if;

  -- Từ vựng nới rộng chứ không thay thế: giá trị mới có, và các giá trị cũ
  -- vẫn còn nguyên.
  select string_agg(want, ', ')
    into missing
  from unnest(array[
    'general_announcement',
    'mentor_confirmation_link',
    'mentee_application_confirmation',
    'mentor_application_confirmation',
    'review_batch_assigned',
    'interview_scheduled',
    'reviewer_invite',
    'interview_round_invite'
  ]) as want
  where position('''' || want || '''' in (
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = 'public.outbound_emails'::regclass
      and c.conname = 'outbound_emails_kind_check'
  )) = 0;

  if missing is not null then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check không còn nhận: %', missing;
  end if;
end;
$email_templates_contract$;

notify pgrst, 'reload schema';

commit;
