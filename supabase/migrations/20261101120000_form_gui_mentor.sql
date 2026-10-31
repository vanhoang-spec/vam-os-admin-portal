-- =============================================================================
-- Form tùy chỉnh: "Tự động gửi Submission cho Mentor" (VAM00011, 01/11/2026)
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới đọc các cột mentor_forward* của custom_forms; thiếu chúng thì mọi lần
-- mở, lưu và gửi form đều báo lỗi.
--
-- Thêm:
--   custom_forms.mentor_forward*       bật/tắt (mặc định TẮT), tiêu đề, nội dung, mốc bật
--   custom_form_mentor_sends           mỗi câu trả lời một dòng: chờ ghép cặp / đã gửi / lỗi / không nhận ra
--   loại thư custom_form_mentor_submission
--
-- Form đã có giữ nguyên hành vi: cột mới mặc định tắt, không dòng theo dõi nào được tạo cho câu trả lời cũ.
-- `mentor_forward_since` ngăn việc bật tính năng làm bản cũ bị gửi đi: chỉ câu trả lời từ mốc này mới được xét.
-- Chạy lại lần hai không sao.
-- =============================================================================

do $prereq$
begin
  if to_regclass('public.custom_forms') is null or to_regclass('public.custom_form_responses') is null then
    raise exception 'PREREQ_MISSING: cần migration 20261015200000 (form tùy chỉnh) chạy trước';
  end if;
  if to_regclass('public.matches') is null or to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: thiếu matches / people';
  end if;
end
$prereq$;

alter table public.custom_forms
  add column if not exists mentor_forward boolean not null default false,
  add column if not exists mentor_forward_subject text not null default '',
  add column if not exists mentor_forward_body text not null default '',
  add column if not exists mentor_forward_since timestamptz null;

do $limits$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_forms_mentor_forward_len_check') then
    alter table public.custom_forms
      add constraint custom_forms_mentor_forward_len_check
      check (char_length(mentor_forward_subject) <= 200 and char_length(mentor_forward_body) <= 5000);
  end if;
end
$limits$;

-- Unique theo câu trả lời, không theo (câu trả lời + mentor): một bản chỉ đi MỘT lần, kể cả khi mentee đổi
-- mentor sau đó. Unique theo cặp sẽ để lọt một dòng thứ hai cho mentor mới, là việc ticket không yêu cầu.
-- Khoá ngoại tới people/matches để set null: xoá người (20260920060000) không được kẹt vì sổ gửi thư này.
create table if not exists public.custom_form_mentor_sends (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.custom_form_responses(id) on delete cascade,
  form_id uuid not null references public.custom_forms(id) on delete cascade,
  mentee_email text not null default '',
  mentee_person_id uuid null references public.people(id) on delete set null,
  mentor_person_id uuid null references public.people(id) on delete set null,
  match_id uuid null references public.matches(id) on delete set null,
  status text not null default 'cho_ghep_cap',
  attempts integer not null default 0,
  last_error text null,
  claimed_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_form_mentor_sends_response_uniq unique (response_id),
  constraint custom_form_mentor_sends_status_check
    check (status in ('cho_ghep_cap', 'dang_gui', 'da_gui', 'loi', 'khong_nhan_ra'))
);
comment on table public.custom_form_mentor_sends is
  'Theo dõi việc gửi câu trả lời form tùy chỉnh cho mentor đang ghép cặp (VAM00011). Mỗi câu trả lời một dòng; chỉ máy chủ đọc/ghi.';

create index if not exists custom_form_mentor_sends_form_status_idx
  on public.custom_form_mentor_sends (form_id, status);
create index if not exists custom_form_mentor_sends_mentee_idx
  on public.custom_form_mentor_sends (mentee_person_id) where mentee_person_id is not null;
create index if not exists custom_form_mentor_sends_mentor_idx
  on public.custom_form_mentor_sends (mentor_person_id) where mentor_person_id is not null;
create index if not exists custom_form_mentor_sends_match_idx
  on public.custom_form_mentor_sends (match_id) where match_id is not null;

-- Bảng mang dữ liệu mentee: không policy nào, không quyền nào ngoài máy chủ, và máy chủ không được xoá.
alter table public.custom_form_mentor_sends enable row level security;
revoke all on public.custom_form_mentor_sends from public, anon, authenticated, service_role;
grant select, insert, update on public.custom_form_mentor_sends to service_role;

-- Loại thư mới. NỐI THÊM vào ràng buộc hiện có, không viết đè danh sách.
do $kind$
declare
  v_def text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_def is null then
    raise exception 'outbound_emails_kind_check không tồn tại';
  end if;
  if position(quote_literal('custom_form_mentor_submission') in v_def) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_def, '(\]\)+)$', ', ''custom_form_mentor_submission''::text\1');
  if v_rebuilt = v_def then
    raise exception 'Không nối thêm được loại thư vào: %', v_def;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $check$
declare
  v_def text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'mentor_forward')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'mentor_forward_since') then
    raise exception 'SELF_CHECK: custom_forms thiếu cột gửi mentor';
  end if;
  if exists (select 1 from public.custom_forms where mentor_forward and mentor_forward_since is null) then
    raise exception 'SELF_CHECK: form bật gửi mentor phải có mốc bật';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'custom_form_mentor_sends' and c.relrowsecurity) then
    raise exception 'SELF_CHECK: custom_form_mentor_sends chưa bật RLS';
  end if;
  if has_table_privilege('anon', 'public.custom_form_mentor_sends', 'select')
     or has_table_privilege('authenticated', 'public.custom_form_mentor_sends', 'select')
     or has_table_privilege('anon', 'public.custom_form_mentor_sends', 'insert')
     or has_table_privilege('authenticated', 'public.custom_form_mentor_sends', 'update') then
    raise exception 'SELF_CHECK: anon/authenticated chạm được sổ gửi mentor';
  end if;
  if has_table_privilege('service_role', 'public.custom_form_mentor_sends', 'delete') then
    raise exception 'SELF_CHECK: máy chủ không được xoá sổ gửi mentor';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'custom_form_mentor_sends_response_uniq') then
    raise exception 'SELF_CHECK: thiếu ràng buộc chống gửi trùng';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('custom_form_mentor_submission') in coalesce(v_def, '')) = 0 then
    raise exception 'SELF_CHECK: outbound_emails_kind_check thiếu loại thư custom_form_mentor_submission';
  end if;
  raise notice 'Form gửi mentor: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
