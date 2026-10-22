-- Thư kết quả ghép cặp mùa 12 + hồ sơ tóm tắt có link riêng (BTC 22/10/2026).
--
-- BTC gửi "THÔNG BÁO KẾT QUẢ MATCHING THÀNH CÔNG" cho mọi mentor và mentee đang có cặp ở mùa 12,
-- mọi vòng. Mentee nhận link hồ sơ mentor; mentor nhận MỘT link cho MỖI mentee. Link mở trang
-- /ho-so/<token> không cần đăng nhập, hiện hồ sơ người đồng hành kèm SĐT/email — chỉ khi cặp đó
-- vẫn đang hoạt động.
--
-- Bốn bảng, cùng một nếp với bảng link Vòng 2 (20261008080000): bật RLS, thu hồi hết quyền, chỉ
-- máy chủ VAM OS (service_role) đọc/ghi, và KHÔNG ai xoá được — gỡ là ghi mốc, không xoá dòng.
--
--   match_profile_links    một link cho mỗi chiều của một cặp (người xem → người được xem). Chỉ
--                          lưu sha256 của token: đọc được cả bảng cũng không có link nào dùng được
--                          (cùng mô hình với person_season_invites của luồng gia hạn).
--   match_result_notices   mỗi người một dòng thông báo: ai đã nhận thư, lúc nào, với những cặp nào
--                          (match_ids) — để không gửi trùng, và để thấy ai đổi cặp sau khi đã nhận.
--   match_result_holds     mentor BTC giữ lại chưa gửi (17 mentor cần Training 15/11 — thư riêng).
--                          Giữ một mentor là giữ luôn các mentee của họ.
--   match_result_settings  link Handbook mentee/mentor, link đăng ký Kick-off, và mốc BTC xác nhận
--                          danh sách giữ lại — chưa xác nhận thì không gửi được.
--
-- Kèm theo: nới outbound_emails_kind_check theo lối cộng thêm — + 'mentee_mentor_intro' (thư cho
-- mentee) và 'mentor_mentee_package' (thư cho mentor). Hai tên này đã có sẵn trong EmailKind từ
-- trước, chưa từng được dùng.
--
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge. Dán lại lần hai không sao.

do $prereq$
begin
  if to_regclass('public.matches') is null or to_regclass('public.people') is null
     or to_regclass('public.seasons') is null or to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: thiếu matches / people / seasons / admin_users';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.outbound_emails'::regclass and conname = 'outbound_emails_kind_check') then
    raise exception 'PREREQ_MISSING: không thấy outbound_emails_kind_check';
  end if;
end
$prereq$;

create table if not exists public.match_profile_links (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  match_id uuid not null references public.matches(id),
  viewer_person_id uuid not null references public.people(id),
  subject_person_id uuid not null references public.people(id),
  subject_role text not null check (subject_role in ('mentor', 'mentee')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  -- Mỗi chiều của một cặp đúng một link: gửi lại là thay hash của chính dòng này.
  constraint match_profile_links_direction_uniq unique (match_id, subject_role),
  constraint match_profile_links_not_self check (viewer_person_id <> subject_person_id)
);

create table if not exists public.match_result_notices (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  person_id uuid not null references public.people(id),
  role text not null check (role in ('mentor', 'mentee')),
  -- 'special' để dành cho thư riêng của nhóm mentor cần Training 15/11 (nội dung BTC gửi sau).
  variant text not null default 'standard' check (variant in ('standard', 'special')),
  match_ids uuid[] not null default '{}',
  claimed_at timestamptz,
  sent_at timestamptz,
  last_sent_at timestamptz,
  send_count integer not null default 0 check (send_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  constraint match_result_notices_person_uniq unique (season_id, person_id, role)
);

create table if not exists public.match_result_holds (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  mentor_person_id uuid not null references public.people(id),
  input_email text,
  reason text,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.admin_users(id),
  -- Unique thường (không phải partial): PostgREST onConflict không nhắm được index partial.
  -- Bỏ giữ = ghi removed_at; giữ lại lần nữa = xoá mốc đó trên chính dòng này.
  constraint match_result_holds_mentor_uniq unique (season_id, mentor_person_id)
);

create table if not exists public.match_result_settings (
  season_id uuid primary key references public.seasons(id),
  mentee_handbook_url text check (
    mentee_handbook_url is null or (mentee_handbook_url ~ '^https://[^[:space:]]+$' and char_length(mentee_handbook_url) <= 500)),
  mentor_handbook_url text check (
    mentor_handbook_url is null or (mentor_handbook_url ~ '^https://[^[:space:]]+$' and char_length(mentor_handbook_url) <= 500)),
  kickoff_register_url text check (
    kickoff_register_url is null or (kickoff_register_url ~ '^https://[^[:space:]]+$' and char_length(kickoff_register_url) <= 500)),
  holds_confirmed_at timestamptz,
  holds_confirmed_by uuid references public.admin_users(id),
  updated_by uuid references public.admin_users(id),
  updated_at timestamptz not null default now()
);

create index if not exists match_profile_links_viewer_idx on public.match_profile_links(viewer_person_id);
create index if not exists match_result_notices_season_idx on public.match_result_notices(season_id, role);

alter table public.match_profile_links enable row level security;
alter table public.match_result_notices enable row level security;
alter table public.match_result_holds enable row level security;
alter table public.match_result_settings enable row level security;
revoke all on public.match_profile_links from public, anon, authenticated, service_role;
revoke all on public.match_result_notices from public, anon, authenticated, service_role;
revoke all on public.match_result_holds from public, anon, authenticated, service_role;
revoke all on public.match_result_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.match_profile_links to service_role;
grant select, insert, update on public.match_result_notices to service_role;
grant select, insert, update on public.match_result_holds to service_role;
grant select, insert, update on public.match_result_settings to service_role;

-- Nới outbound_emails_kind_check theo lối cộng thêm: đọc định nghĩa đang có rồi nối các loại còn
-- thiếu; viết đè cả danh sách là để sót loại cũ và lặng lẽ chặn thư loại đó.
do $kind$
declare
  v_existing text;
  v_rebuilt text;
  v_missing text := '';
  k text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
    from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  foreach k in array array['mentee_mentor_intro', 'mentor_mentee_package'] loop
    if position(quote_literal(k) in v_existing) = 0 then
      v_missing := v_missing || ', ' || quote_literal(k) || '::text';
    end if;
  end loop;
  if v_missing = '' then
    return;
  end if;
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', v_missing || '\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $check$
declare
  t text;
  v_def text;
  k text;
begin
  foreach t in array array['match_profile_links', 'match_result_notices', 'match_result_holds', 'match_result_settings'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'SELF_CHECK: bảng % chưa bật RLS', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception 'SELF_CHECK: anon/authenticated còn đọc hoặc ghi được %', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select')
       or not has_table_privilege('service_role', 'public.' || t, 'update') then
      raise exception 'SELF_CHECK: máy chủ không đọc/ghi được %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception 'SELF_CHECK: máy chủ không được xoá dòng trong % (gỡ là ghi mốc)', t;
    end if;
  end loop;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  -- Hai loại mới có mặt, và mọi loại đang dùng trước đó vẫn còn.
  foreach k in array array['mentee_mentor_intro', 'mentor_mentee_package', 'matching_round2_reminder',
                           'matching_round2_invite', 'general_announcement', 'custom_form_receipt'] loop
    if position(quote_literal(k) in coalesce(v_def, '')) = 0 then
      raise exception 'SELF_CHECK: outbound_emails_kind_check thiếu loại thư %', k;
    end if;
  end loop;
  raise notice 'Kết quả ghép cặp: bảng hồ sơ / thông báo / giữ lại / cài đặt — sẵn sàng';
end
$check$;

notify pgrst, 'reload schema';
