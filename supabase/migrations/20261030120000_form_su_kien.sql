-- =============================================================================
-- Form tùy chỉnh ↔ Sự kiện (đề xuất VAM00008, 30/10/2026)
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới đọc custom_forms.event_id / registration_limit và gọi hai hàm
-- dưới đây; thiếu chúng thì mọi lần lưu form và gửi form đều báo lỗi.
--
-- Thêm:
--   custom_forms.event_id              form gắn với một sự kiện (null = form độc lập như cũ)
--   custom_forms.registration_limit    giới hạn riêng của form (null = không giới hạn)
--   custom_form_responses.event_registration_id, updated_at
--   event_registrations.custom_form_id đăng ký đến từ form nào — để đếm giới hạn riêng của form
--   custom_form_duplicate_flags        cảnh báo "email trùng, họ tên khác" cho BTC xem
--   vam_custom_form_insert_response()  ghi câu trả lời + kiểm giới hạn form độc lập, dưới khoá
--   vam_custom_form_event_register()   ghi đăng ký sự kiện + kiểm sức chứa sự kiện và giới hạn form,
--                                      dưới khoá — hai người bấm cùng lúc không cùng lấy chỗ cuối
--
-- Câu trả lời vẫn KHÔNG sửa được ở cấp bảng (điều kiện của 20261015200000 còn nguyên); chỉ cấp
-- quyền sửa ba cột answers / event_registration_id / updated_at để "gửi lại cùng email và họ tên
-- thì cập nhật bản cũ" (yêu cầu của đề xuất).
--
-- Chạy lại lần hai không sao.
-- =============================================================================

do $prereq$
begin
  if to_regclass('public.custom_forms') is null or to_regclass('public.custom_form_responses') is null then
    raise exception 'PREREQ_MISSING: cần migration 20261015200000 (form tùy chỉnh) chạy trước';
  end if;
  if to_regclass('public.events') is null or to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần bảng events và event_registrations';
  end if;
end
$prereq$;

alter table public.custom_forms
  add column if not exists event_id uuid null references public.events(id) on delete set null,
  add column if not exists registration_limit integer null;

do $limit$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_forms_registration_limit_check') then
    alter table public.custom_forms
      add constraint custom_forms_registration_limit_check
      check (registration_limit is null or registration_limit between 1 and 100000);
  end if;
end
$limit$;

alter table public.custom_form_responses
  add column if not exists event_registration_id uuid null references public.event_registrations(id) on delete set null,
  add column if not exists updated_at timestamptz null;

alter table public.event_registrations
  add column if not exists custom_form_id uuid null references public.custom_forms(id) on delete set null;

create index if not exists event_registrations_custom_form_idx
  on public.event_registrations (custom_form_id) where custom_form_id is not null;
create index if not exists custom_forms_event_idx
  on public.custom_forms (event_id) where event_id is not null;

grant update (answers, event_registration_id, updated_at) on public.custom_form_responses to service_role;

create table if not exists public.custom_form_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.custom_forms(id) on delete cascade,
  existing_response_id uuid null references public.custom_form_responses(id) on delete set null,
  event_registration_id uuid null references public.event_registrations(id) on delete set null,
  submitted_name text not null default '',
  submitted_email text not null default '',
  existing_name text not null default '',
  answers jsonb not null default '{}'::jsonb,
  reason text not null default 'email_trung_ten_khac',
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null,
  constraint custom_form_duplicate_flags_reason_check check (reason in ('email_trung_ten_khac'))
);
comment on table public.custom_form_duplicate_flags is
  'Lần gửi form trùng email nhưng khác họ tên: KHÔNG ghi đè, chỉ lưu để BTC xem (VAM00008). Người điền không thấy.';
create index if not exists custom_form_duplicate_flags_form_idx
  on public.custom_form_duplicate_flags (form_id, created_at desc);

alter table public.custom_form_duplicate_flags enable row level security;
revoke all on public.custom_form_duplicate_flags from public, anon, authenticated, service_role;
grant select, insert, update on public.custom_form_duplicate_flags to service_role;

-- ---------------------------------------------------------------------------
-- Ghi một câu trả lời của form KHÔNG gắn sự kiện, kiểm giới hạn riêng dưới khoá theo form.
-- Trả {status: inserted|full|duplicate, id}.
-- ---------------------------------------------------------------------------
create or replace function public.vam_custom_form_insert_response(p_form_id uuid, p_limit integer, p_row jsonb)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_count integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('custom_form:' || p_form_id::text, 0));
  -- Người đã gửi gửi lại: báo "đã gửi rồi" trước, kể cả khi form đã đủ — đúng hơn "form đã đủ".
  if nullif(p_row ->> 'dedupe_key', '') is not null and exists (
       select 1 from public.custom_form_responses where form_id = p_form_id and dedupe_key = p_row ->> 'dedupe_key') then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if p_limit is not null then
    select count(*) into v_count from public.custom_form_responses where form_id = p_form_id;
    if v_count >= p_limit then
      return jsonb_build_object('status', 'full');
    end if;
  end if;
  begin
    insert into public.custom_form_responses (form_id, answers, dedupe_key, consent_at, event_registration_id)
    values (
      p_form_id,
      coalesce(p_row -> 'answers', '{}'::jsonb),
      nullif(p_row ->> 'dedupe_key', ''),
      coalesce((p_row ->> 'consent_at')::timestamptz, now()),
      nullif(p_row ->> 'event_registration_id', '')::uuid
    )
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate');
  end;
  return jsonb_build_object('status', 'inserted', 'id', v_id);
end
$fn$;

-- ---------------------------------------------------------------------------
-- Ghi một đăng ký sự kiện đến từ form, dưới khoá theo sự kiện:
--   - email đã có đăng ký còn hiệu lực ở sự kiện → trả {status: existing, ...}, KHÔNG ghi gì;
--   - giới hạn riêng của form đã đủ → {status: form_full};
--   - sự kiện đã đủ và không có danh sách chờ → {status: event_full};
--   - còn lại ghi một dòng: registered / pending_review (cần duyệt) / waitlisted (đủ chỗ, có chờ).
-- Chỗ = registered + pending_review + confirmed, đúng như lib/events.ts đếm.
-- p_payload: cột của event_registrations do máy chủ dựng; chỉ cột có thật mới được ghi.
-- ---------------------------------------------------------------------------
create or replace function public.vam_custom_form_event_register(
  p_event_id uuid,
  p_form_id uuid,
  p_form_limit integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_event record;
  v_existing record;
  v_seats integer;
  v_form_seats integer;
  v_full boolean;
  v_status text;
  v_payload jsonb;
  v_cols text;
  v_id uuid;
  v_email text := lower(btrim(coalesce(p_payload ->> 'email', '')));
begin
  if v_email = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('event_registration:' || p_event_id::text, 0));

  select id, status, capacity_limit_enabled, capacity_limit, waitlist_enabled, approval_required
    into v_event from public.events where id = p_event_id;
  if not found or coalesce(v_event.status, 'active') = 'cancelled' then
    return jsonb_build_object('status', 'event_closed');
  end if;

  select id, full_name, registration_status into v_existing
    from public.event_registrations
   where event_id = p_event_id and lower(email) = v_email and registration_status <> 'cancelled'
   limit 1;
  if found then
    return jsonb_build_object('status', 'existing', 'id', v_existing.id, 'full_name', v_existing.full_name,
                              'registration_status', v_existing.registration_status);
  end if;

  select count(*) into v_seats from public.event_registrations
   where event_id = p_event_id and registration_status in ('registered', 'pending_review', 'confirmed');
  if p_form_limit is not null then
    select count(*) into v_form_seats from public.event_registrations
     where event_id = p_event_id and custom_form_id = p_form_id
       and registration_status in ('registered', 'pending_review', 'confirmed');
    if v_form_seats >= p_form_limit then
      return jsonb_build_object('status', 'form_full');
    end if;
  end if;
  v_full := coalesce(v_event.capacity_limit_enabled, false) and v_event.capacity_limit is not null
            and v_seats >= v_event.capacity_limit;
  if v_full and not coalesce(v_event.waitlist_enabled, false) then
    return jsonb_build_object('status', 'event_full');
  end if;
  v_status := case when v_full then 'waitlisted'
                   when coalesce(v_event.approval_required, false) then 'pending_review'
                   else 'registered' end;

  v_payload := (p_payload - 'id' - 'registration_status' - 'event_id' - 'custom_form_id')
    || jsonb_build_object('event_id', p_event_id, 'custom_form_id', p_form_id, 'registration_status', v_status,
                          'email', v_email);
  select string_agg(quote_ident(k), ', ') into v_cols
    from jsonb_object_keys(v_payload) as k
   where exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'event_registrations' and c.column_name = k);
  begin
    execute format(
      'insert into public.event_registrations (%1$s) select %1$s from jsonb_populate_record(null::public.event_registrations, $1) returning id',
      v_cols)
      using v_payload into v_id;
  exception when unique_violation then
    -- Một đường đăng ký khác (form Sự kiện) vừa ghi cùng email ngoài khoá này.
    select id, full_name, registration_status into v_existing
      from public.event_registrations
     where event_id = p_event_id and lower(email) = v_email and registration_status <> 'cancelled'
     limit 1;
    return jsonb_build_object('status', 'existing', 'id', v_existing.id, 'full_name', v_existing.full_name,
                              'registration_status', v_existing.registration_status);
  end;
  return jsonb_build_object('status', 'inserted', 'id', v_id, 'registration_status', v_status);
end
$fn$;

revoke all on function public.vam_custom_form_insert_response(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.vam_custom_form_event_register(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.vam_custom_form_insert_response(uuid, integer, jsonb) to service_role;
grant execute on function public.vam_custom_form_event_register(uuid, uuid, integer, jsonb) to service_role;

do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'event_id')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'registration_limit')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'event_registrations' and column_name = 'custom_form_id')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'custom_form_responses' and column_name = 'event_registration_id') then
    raise exception 'SELF_CHECK: thiếu cột nối form ↔ sự kiện';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'custom_form_duplicate_flags' and c.relrowsecurity) then
    raise exception 'SELF_CHECK: custom_form_duplicate_flags chưa bật RLS';
  end if;
  if has_table_privilege('anon', 'public.custom_form_duplicate_flags', 'select')
     or has_table_privilege('authenticated', 'public.custom_form_duplicate_flags', 'select') then
    raise exception 'SELF_CHECK: anon/authenticated đọc được cảnh báo trùng';
  end if;
  if has_table_privilege('service_role', 'public.custom_form_responses', 'update') then
    raise exception 'SELF_CHECK: câu trả lời không được sửa ở cấp bảng';
  end if;
  if not has_column_privilege('service_role', 'public.custom_form_responses', 'answers', 'update') then
    raise exception 'SELF_CHECK: máy chủ chưa cập nhật được câu trả lời khi gửi lại';
  end if;
  if has_function_privilege('anon', 'public.vam_custom_form_event_register(uuid, uuid, integer, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.vam_custom_form_insert_response(uuid, integer, jsonb)', 'execute') then
    raise exception 'SELF_CHECK: anon gọi được hàm ghi đăng ký';
  end if;
  raise notice 'Form ↔ Sự kiện: sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
