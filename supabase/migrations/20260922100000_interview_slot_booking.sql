-- ═══════════════════════════════════════════════════════════════════════════
-- Lịch phỏng vấn mentor 1:1 — interviewer đăng giờ rảnh, mentor tự giữ chỗ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Đợt phỏng vấn mentor UEHM-S12 (22/09–05/10/2026, 07:00–22:00 giờ Việt Nam,
-- mỗi slot tròn 60 phút): interviewer (core team, hoặc mentor được bật quyền
-- "người phỏng vấn" qua Danh sách nhân sự tuyển sinh) đánh dấu giờ mình rảnh;
-- mỗi mentor mới nhận một link riêng mang mã, tự chọn một slot; hệ thống giữ
-- chỗ theo luật ai-bấm-trước-được-trước, rồi tự giao phiếu phỏng vấn cho đúng
-- interviewer của slot đó để sau buổi họ chấm kết quả bằng luồng /reviews cũ.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO GIỮ CHỖ NẰM TRONG MỘT HÀM SQL, KHÔNG NẰM Ở TẦNG ỨNG DỤNG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hai mentor bấm giữ slot cuối cùng của một khung giờ trong cùng một giây là
-- tình huống sẽ xảy ra thật. Tầng ứng dụng không có transaction chung giữa hai
-- request, nên mọi phép "đọc rồi ghi" ở đó đều có kẽ hở. Toàn bộ chuỗi
-- kiểm-điều-kiện → chọn interviewer → flip slot → tạo phiếu → đổi trạng thái
-- đơn phải là MỘT transaction, và chỗ duy nhất làm được điều đó là một hàm
-- trong database. `for update skip locked` cho người đến sau lấy ngay
-- interviewer rảnh kế tiếp thay vì xếp hàng chờ khoá.
--
-- Cùng một khung giờ có nhiều interviewer rảnh thì ghép cho người ĐĂNG GIỜ ĐÓ
-- SỚM NHẤT trước (cột `available_since`) — đúng lời chủ dự án chốt 22/09/2026.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BỐN BẢNG, BA HÀM, MỘT HÀM ĐƯỢC VÁ
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. `interviewer_profiles`  — số điện thoại của interviewer. admin_users
--      không có cột phone, và thư xác nhận lịch phải ghi đủ SĐT hai bên.
--   2. `interview_slots`       — giờ rảnh, đồng thời là trọng tài tranh chấp.
--      Một dòng cho một (interviewer, giờ) DÙ Ở TRẠNG THÁI NÀO: gỡ giờ là
--      status='removed', đăng lại là UPDATE về 'open' — không bao giờ có dòng
--      thứ hai, nhờ vậy FIFO không bị reset lậu bằng cách gỡ-đăng lại.
--   3. `interview_bookings`    — lịch sử giữ chỗ, kể cả đã huỷ. Mang
--      `previous_application_status` để lúc huỷ trả đơn về đúng chỗ nó đứng
--      trước khi đặt (mentor đặt lịch từ giữa vòng hồ sơ không bị đẩy sang
--      'invited_to_interview' — trạng thái họ chưa từng có).
--   4. `interview_slot_invites` — mã link riêng của từng đơn + sổ gửi thư
--      (mời 1 lần + nhắc tối đa 3 lần, mỗi 3 ngày, lần nhắc 3 CC hello@).
--      `claimed_at` là khoá nhận-trước-gửi: hai tab cùng bấm gửi không làm
--      ai nhận hai thư — cùng khuôn với event_survey_recipients.
--
--   Hàm: vam098_book_interview_slot / vam098_cancel_interview_booking_mentor
--        / vam098_cancel_interview_booking_btc.
--
--   Vá thêm: `vam084_recompute_application_review_status` nhánh hồ sơ hiện
--   RAISE khi đơn đã đứng ở trạng thái vòng phỏng vấn (whitelist update không
--   chứa các trạng thái đó, update 0 dòng → exception). Mentor đang
--   'screening_assigned' mà đặt lịch xong thì reviewer hồ sơ NỘP PHIẾU SẼ VỠ.
--   Vá theo lối cộng thêm: gặp đơn đã sang vòng phỏng vấn thì trả nguyên trạng
--   và không đụng gì — điểm của reviewer vẫn lưu. Nhánh interview giữ nguyên.
--
-- Kèm theo: nới outbound_emails_kind_check theo lối cộng thêm —
--   + 'interview_slot_invite'     (thư mời/nhắc đặt lịch)
--   + 'interview_slot_cancelled'  (thư báo huỷ lịch)
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $interview_booking_prereq$
begin
  if to_regclass('public.applications') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.applications';
  end if;
  if to_regclass('public.application_reviews') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.application_reviews';
  end if;
  if to_regclass('public.application_decisions') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.application_decisions';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.admin_users';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.seasons';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: cần bảng public.outbound_emails';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.outbound_emails')
      and conname = 'outbound_emails_kind_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc outbound_emails_kind_check';
  end if;
  -- 'interview_scheduled' phải đã hợp lệ trong applications_status_check.
  -- Nó được đưa vào bởi migration 20260905140800, nhưng chưa có bằng chứng
  -- đọc-catalog nào xác nhận file đó đã lên Production — nên hỏi to ở đây
  -- thay vì để hàm giữ chỗ chết bằng lỗi 23514 lúc mentor đầu tiên bấm.
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.applications')
      and conname = 'applications_status_check'
      and position(quote_literal('interview_scheduled') in pg_get_constraintdef(oid)) > 0
  ) then
    raise exception 'PREREQ_MISSING: applications_status_check chưa nhận interview_scheduled (dán migration 20260905140800 trước)';
  end if;
  if to_regprocedure('public.vam063_trusted_api_role()') is null then
    raise exception 'PREREQ_MISSING: cần hàm public.vam063_trusted_api_role()';
  end if;
  if to_regprocedure('public.vam084_recompute_application_review_status(uuid, text)') is null then
    raise exception 'PREREQ_MISSING: cần hàm public.vam084_recompute_application_review_status(uuid, text)';
  end if;
end;
$interview_booking_prereq$;

-- ------------------------------------------------------------
-- 1. Số điện thoại của interviewer
-- ------------------------------------------------------------
--
-- Một bảng riêng thay vì thêm cột vào admin_users: mọi đường ghi admin_users
-- đều đi qua bộ RPC vam062 có nhật ký thao tác, và số điện thoại cho việc
-- xếp lịch không đáng để mở rộng hợp đồng đó. Bảng này chỉ tầng máy chủ đọc.
create table if not exists public.interviewer_profiles (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviewer_profiles_phone_check check (btrim(phone) <> ''),
  constraint interviewer_profiles_admin_user_key unique (admin_user_id)
);

-- ------------------------------------------------------------
-- 2. Giờ rảnh — trọng tài tranh chấp
-- ------------------------------------------------------------
create table if not exists public.interview_slots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  admin_user_id uuid not null references public.admin_users(id),
  slot_starts_at timestamptz not null,
  status text not null default 'open',
  booked_application_id uuid references public.applications(id),
  -- Khoá FIFO: giờ này TRỞ THÀNH rảnh từ lúc nào. Đăng lại sau khi gỡ thì
  -- reset (xuống cuối hàng — họ đã từng rút lời). Huỷ lịch mở lại chỗ thì
  -- KHÔNG reset: interviewer không làm gì sai, giữ nguyên thứ tự của họ.
  available_since timestamptz not null default now(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint interview_slots_status_check
    check (status in ('open', 'removed', 'booked')),
  constraint interview_slots_booked_link_check
    check ((status = 'booked') = (booked_application_id is not null)),
  -- Vị trí hợp lệ trên lưới: tròn giờ, 07..21 theo giờ Việt Nam. Biên ngày
  -- của đợt (22/09–05/10) nằm ở tầng ứng dụng (lib/interview-schedule-core.ts)
  -- để mùa sau đổi đợt chỉ cần sửa TypeScript, không cần migration.
  constraint interview_slots_hour_check check (
    extract(minute from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) = 0
    and extract(second from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) = 0
    and extract(hour from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) between 7 and 21
  ),
  -- Một dòng cho một (interviewer, giờ) dù ở trạng thái nào — đăng lại là
  -- UPDATE về 'open', không phải dòng mới. Nhờ vậy gỡ-rồi-đăng-lại không
  -- nhân đôi giờ rảnh, và available_since do database canh giữ.
  constraint interview_slots_one_per_hour unique (admin_user_id, slot_starts_at)
);

create index if not exists interview_slots_open_by_time_idx
  on public.interview_slots (slot_starts_at, available_since)
  where status = 'open';

create index if not exists interview_slots_interviewer_idx
  on public.interview_slots (admin_user_id, slot_starts_at);

create index if not exists interview_slots_season_idx
  on public.interview_slots (season_id);

comment on column public.interview_slots.available_since is
  'Khoá FIFO ghép interviewer trong cùng khung giờ: ai rảnh sớm hơn được ghép trước. Reset khi đăng lại sau khi gỡ; giữ nguyên khi huỷ lịch mở lại chỗ.';

-- ------------------------------------------------------------
-- 3. Sổ giữ chỗ — lịch sử kể cả đã huỷ
-- ------------------------------------------------------------
create table if not exists public.interview_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.interview_slots(id),
  application_id uuid not null references public.applications(id),
  interviewer_admin_user_id uuid not null references public.admin_users(id),
  review_id uuid references public.application_reviews(id),
  -- Chép lại giờ hẹn thay vì chỉ trỏ vào slot: dòng huỷ vẫn phải kể được
  -- "đã từng hẹn lúc nào" kể cả khi slot về sau đổi trạng thái.
  slot_starts_at timestamptz not null,
  -- Trạng thái đơn TRƯỚC khi đặt lịch — để huỷ trả về đúng chỗ. Mentor đặt
  -- lịch từ 'screening_in_progress' mà huỷ thì về lại đó, không bị ném sang
  -- 'invited_to_interview' là trạng thái họ chưa từng đi qua.
  previous_application_status text not null,
  status text not null default 'booked',
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.admin_users(id),
  cancel_note text,
  constraint interview_bookings_status_check
    check (status in ('booked', 'cancelled_by_mentor', 'cancelled_by_btc'))
);

-- Hai trọng tài: một mentor chỉ có MỘT lịch đang hiệu lực, một slot chỉ bị
-- giữ bởi MỘT người. Hàm giữ chỗ đã khoá dòng đơn nên bình thường không đụng
-- tới đây; hai chỉ số này là lưới đỡ nếu một đường ghi khác xuất hiện sau này.
create unique index if not exists interview_bookings_active_app_uidx
  on public.interview_bookings (application_id)
  where status = 'booked';

create unique index if not exists interview_bookings_active_slot_uidx
  on public.interview_bookings (slot_id)
  where status = 'booked';

create index if not exists interview_bookings_time_idx
  on public.interview_bookings (slot_starts_at);

create index if not exists interview_bookings_application_idx
  on public.interview_bookings (application_id);

-- ------------------------------------------------------------
-- 4. Mã link riêng + sổ gửi thư mời/nhắc
-- ------------------------------------------------------------
create table if not exists public.interview_slot_invites (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  -- Mã nằm ở cột riêng chứ không dùng luôn id: lộ mã thì xoay mã được mà
  -- không phá các dòng đang trỏ vào id.
  token uuid not null default gen_random_uuid(),
  -- Đếm cả thư mời lẫn thư nhắc: 1 mời + 3 nhắc = tối đa 4.
  send_count integer not null default 0,
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  -- Khoá nhận-trước-gửi: tab nào UPDATE được claimed_at từ NULL thì tab đó
  -- gửi; tab kia thấy khác NULL thì bỏ qua. Claim để quên quá 10 phút được
  -- coi là mồ côi và thu hồi — cùng luật với hàng đợi thư khảo sát.
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_slot_invites_send_count_check
    check (send_count between 0 and 4),
  constraint interview_slot_invites_application_key unique (application_id),
  constraint interview_slot_invites_token_key unique (token)
);

create index if not exists interview_slot_invites_last_sent_idx
  on public.interview_slot_invites (last_sent_at);

-- ------------------------------------------------------------
-- 5. Quyền: chỉ máy chủ, không xoá
-- ------------------------------------------------------------
alter table public.interviewer_profiles enable row level security;
alter table public.interview_slots enable row level security;
alter table public.interview_bookings enable row level security;
alter table public.interview_slot_invites enable row level security;

revoke all on public.interviewer_profiles from public, anon, authenticated;
revoke all on public.interview_slots from public, anon, authenticated;
revoke all on public.interview_bookings from public, anon, authenticated;
revoke all on public.interview_slot_invites from public, anon, authenticated;

-- THU HỒI CỦA service_role TRƯỚC KHI CẤP LẠI. Supabase đặt default privileges
-- trên schema public, nên bảng vừa tạo đã mang sẵn ALL cho service_role — DELETE
-- nằm trong đó. Chỉ viết `grant` là chồng thêm lên quyền vốn đã bao trọn.
revoke all on public.interviewer_profiles from service_role;
revoke all on public.interview_slots from service_role;
revoke all on public.interview_bookings from service_role;
revoke all on public.interview_slot_invites from service_role;

-- Không cấp DELETE. Gỡ giờ rảnh là status='removed'; huỷ lịch là một dòng
-- trạng thái — lịch sử ai hẹn ai, huỷ lúc nào là thứ phải giữ được.
grant select, insert, update on public.interviewer_profiles to service_role;
grant select, insert, update on public.interview_slots to service_role;
grant select, insert, update on public.interview_bookings to service_role;
grant select, insert, update on public.interview_slot_invites to service_role;

-- ------------------------------------------------------------
-- 6. Nới loại thư theo lối cộng thêm
-- ------------------------------------------------------------
do $interview_booking_kind_invite$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('interview_slot_invite') in v_existing) > 0 then
    return;
  end if;

  -- Nối thêm vào đuôi mảng, không viết đè cả danh sách: viết đè nghĩa là mỗi
  -- lần thêm một loại lại phải chép đúng toàn bộ loại đã có, và chép thiếu một
  -- loại thì những dòng loại đó lặng lẽ ngừng ghi được.
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''interview_slot_invite''::text\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào outbound_emails_kind_check: %',
      v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$interview_booking_kind_invite$;

do $interview_booking_kind_cancel$
declare
  v_existing text;
  v_rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into v_existing
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  if position(quote_literal('interview_slot_cancelled') in v_existing) > 0 then
    return;
  end if;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''interview_slot_cancelled''::text\1');

  if v_rebuilt = v_existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào outbound_emails_kind_check: %',
      v_existing;
  end if;

  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');
end;
$interview_booking_kind_cancel$;

-- ------------------------------------------------------------
-- 7. Giữ chỗ — một transaction, ai bấm trước được trước
-- ------------------------------------------------------------
--
-- Lỗi NGHIỆP VỤ trả về jsonb {ok:false, code} chứ không raise: raise làm
-- PostgREST trả 400 trống trơn, còn mã lỗi thì tầng ứng dụng dịch được thành
-- câu tiếng Việt tử tế ("khung giờ này vừa có người đặt trước"). Chỉ raise
-- cho lỗi LẬP TRÌNH (gọi ngoài ngữ cảnh máy chủ).
--
-- Thứ tự khoá thống nhất cho cả ba hàm: applications → interview_slots →
-- (bookings/reviews chỉ ghi sau khi đã cầm hai khoá trên) — không deadlock.
create or replace function public.vam098_book_interview_slot(
  p_token uuid,
  p_slot_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_app_id     uuid;
  v_app        public.applications%rowtype;
  v_slot       public.interview_slots%rowtype;
  v_review_id  uuid;
  v_booking_id uuid;
  v_phone      text;
  v_iv_name    text;
  v_iv_email   text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id into v_app_id
  from public.interview_slot_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Khoá dòng đơn TRƯỚC khi kiểm bất cứ điều gì: hai tab của cùng một mentor
  -- bấm hai slot khác nhau sẽ nối đuôi nhau ở đây, tab sau thấy 'already_booked'.
  select a.* into v_app
  from public.applications a
  where a.id = v_app_id
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if exists (
    select 1 from public.interview_bookings b
    where b.application_id = v_app_id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_booked');
  end if;

  -- Luật đối tượng (chủ dự án chốt 22/09/2026): đơn mentor nộp qua form,
  -- hồ sơ còn mở, và CHƯA có phiếu phỏng vấn nào không-huỷ — người đã có
  -- phiếu mở theo đường phân công cũ thì interviewer đang phụ trách tự hẹn.
  if lower(coalesce(v_app.role_applied::text, '')) <> 'mentor'
     or coalesce(v_app.source, '') <> 'vam_os_form'
     or v_app.status not in (
       'submitted', 'under_data_check', 'ready_for_screening',
       'screening_assigned', 'screening_in_progress', 'screening_completed',
       'screening_passed', 'invited_to_interview', 'interview_scheduled'
     ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app_id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if p_slot_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'slot_in_past');
  end if;

  -- FIFO có nhường đường: người rảnh sớm nhất được ghép trước; nếu dòng sớm
  -- nhất đang bị một giao dịch khác cầm thì LẤY NGAY dòng kế (skip locked)
  -- thay vì xếp hàng — mentor không phải chờ ai.
  select s.* into v_slot
  from public.interview_slots s
  where s.slot_starts_at = p_slot_starts_at
    and s.status = 'open'
    and s.season_id = v_app.season_id
  order by s.available_since asc, s.id asc
  limit 1
  for update skip locked;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'slot_full');
  end if;

  update public.interview_slots
     set status = 'booked',
         booked_application_id = v_app_id
   where id = v_slot.id;

  -- Phiếu phỏng vấn giao thẳng cho interviewer của slot: sau buổi họ chấm ở
  -- /reviews như mọi phiếu khác. assigned_by để trống — không có ai "giao",
  -- chính mentor chọn; dòng application_decisions bên dưới kể chuyện đó.
  insert into public.application_reviews (
    application_id, review_round, reviewer_admin_user_id,
    assigned_by, assigned_at, due_at, status
  ) values (
    v_app_id, 'interview', v_slot.admin_user_id,
    null, now(), p_slot_starts_at + interval '1 hour', 'assigned'
  )
  returning id into v_review_id;

  insert into public.interview_bookings (
    slot_id, application_id, interviewer_admin_user_id, review_id,
    slot_starts_at, previous_application_status
  ) values (
    v_slot.id, v_app_id, v_slot.admin_user_id, v_review_id,
    p_slot_starts_at, v_app.status
  )
  returning id into v_booking_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app_id, null, 'Hệ thống đặt lịch phỏng vấn', 'interview_scheduled',
    v_app.status, 'interview_scheduled',
    'Mentor tự đặt lịch qua link cá nhân — '
      || to_char(p_slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app_id;

  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = v_slot.admin_user_id;

  select au.full_name, au.email into v_iv_name, v_iv_email
  from public.admin_users au
  where au.id = v_slot.admin_user_id;

  -- Trả đủ thông tin liên hệ hai bên để tầng ứng dụng gửi ba lá thư xác nhận
  -- (interviewer / mentor / ban tổ chức) mà không phải đọc lại lần nào.
  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'review_id', v_review_id,
    'slot_starts_at', p_slot_starts_at,
    'previous_status', v_app.status,
    'interviewer', jsonb_build_object(
      'admin_user_id', v_slot.admin_user_id,
      'full_name', v_iv_name,
      'email', v_iv_email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- 8. Mentor tự huỷ lịch — chỉ khi còn hơn 24 giờ
-- ------------------------------------------------------------
create or replace function public.vam098_cancel_interview_booking_mentor(
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role      text;
  v_app_id        uuid;
  v_app_status    text;
  v_booking       public.interview_bookings%rowtype;
  v_review_status text;
  v_restored      text;
  v_phone         text;
  v_iv_name       text;
  v_iv_email      text;
  v_cand_name     text;
  v_cand_email    text;
  v_cand_phone    text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id into v_app_id
  from public.interview_slot_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Cùng thứ tự khoá với hàm giữ chỗ: đơn trước, slot sau.
  select a.status into v_app_status
  from public.applications a
  where a.id = v_app_id
  for update;
  if v_app_status is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select b.* into v_booking
  from public.interview_bookings b
  where b.application_id = v_app_id and b.status = 'booked'
  for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_active_booking');
  end if;

  -- Trong vòng 24 giờ trước buổi hẹn thì không tự huỷ được nữa — interviewer
  -- đã giữ buổi sáng/chiều đó cho mình. Muốn đổi phải qua hotline để ban tổ
  -- chức cân nhắc bằng tay.
  if v_booking.slot_starts_at - now() <= interval '24 hours' then
    return jsonb_build_object('ok', false, 'code', 'inside_24h');
  end if;

  select ar.status into v_review_status
  from public.application_reviews ar
  where ar.id = v_booking.review_id
  for update;
  if v_review_status = 'submitted' then
    return jsonb_build_object('ok', false, 'code', 'already_completed');
  end if;

  -- Mở lại chỗ. available_since giữ nguyên: interviewer không làm gì sai,
  -- không bị đẩy xuống cuối hàng FIFO.
  update public.interview_slots
     set status = 'open',
         booked_application_id = null
   where id = v_booking.slot_id and status = 'booked';

  update public.interview_bookings
     set status = 'cancelled_by_mentor',
         cancelled_at = now()
   where id = v_booking.id;

  update public.application_reviews
     set status = 'cancelled',
         updated_at = now()
   where id = v_booking.review_id
     and status in ('assigned', 'in_progress');

  -- Trả đơn về đúng chỗ nó đứng trước khi đặt — chỉ khi không còn phiếu
  -- phỏng vấn hiệu lực nào khác, và chỉ khi trạng thái hiện tại vẫn là thứ
  -- việc đặt lịch tạo ra (ban tổ chức đã chuyển đơn đi nơi khác thì thôi).
  v_restored := v_app_status;
  if not exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app_id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) and v_app_status in ('interview_scheduled', 'interview_in_progress') then
    update public.applications
       set status = v_booking.previous_application_status
     where id = v_app_id;
    v_restored := v_booking.previous_application_status;

    insert into public.application_decisions (
      application_id, decided_by, decided_by_name, decision,
      previous_status, new_status, decision_note
    ) values (
      v_app_id, null, 'Mentor tự huỷ lịch phỏng vấn', 'interview_booking_cancelled',
      v_app_status, v_restored,
      'Huỷ buổi hẹn '
        || to_char(v_booking.slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
        || ' (giờ Việt Nam) qua link cá nhân'
    );

    -- Đơn về lại giữa vòng hồ sơ thì để máy trạng thái vòng hồ sơ tính lại —
    -- trong lúc bị giữ chỗ, reviewer có thể đã chấm xong. Chỉ gọi khi mùa có
    -- cấu hình yêu cầu chấm, vì hàm tính lại raise nếu thiếu cấu hình.
    if v_restored in (
         'submitted', 'under_data_check', 'ready_for_screening',
         'screening_assigned', 'screening_in_progress', 'screening_completed',
         'needs_admin_review'
       )
       and exists (
         select 1 from public.application_reviews ar
         where ar.application_id = v_app_id and ar.review_round = 'profile_screening'
       )
       and exists (
         select 1 from public.recruitment_stage_requirements r
         join public.applications a on a.id = v_app_id
         where r.season_id = a.season_id and r.review_stage = 'profile_screening'
       ) then
      perform public.vam084_recompute_application_review_status(v_app_id, 'profile_screening');
    end if;
  end if;

  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = v_booking.interviewer_admin_user_id;

  select au.full_name, au.email into v_iv_name, v_iv_email
  from public.admin_users au
  where au.id = v_booking.interviewer_admin_user_id;

  select a.full_name, a.email_primary, a.phone_primary
    into v_cand_name, v_cand_email, v_cand_phone
  from public.applications a
  where a.id = v_app_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'slot_starts_at', v_booking.slot_starts_at,
    'restored_status', v_restored,
    'interviewer', jsonb_build_object(
      'admin_user_id', v_booking.interviewer_admin_user_id,
      'full_name', v_iv_name,
      'email', v_iv_email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_cand_name,
      'email', v_cand_email,
      'phone', v_cand_phone
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- 9. Ban tổ chức huỷ lịch — không vướng mốc 24 giờ
-- ------------------------------------------------------------
create or replace function public.vam098_cancel_interview_booking_btc(
  p_booking_id uuid,
  p_actor uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role      text;
  v_actor_role    text;
  v_actor_name    text;
  v_app_id        uuid;
  v_app_status    text;
  v_booking       public.interview_bookings%rowtype;
  v_review_status text;
  v_restored      text;
  v_phone         text;
  v_iv_name       text;
  v_iv_email      text;
  v_cand_name     text;
  v_cand_email    text;
  v_cand_phone    text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  -- Kiểm vai trò viết thẳng ở đây, không qua hàm phụ đọc current_user: trong
  -- hàm định danh chủ sở hữu là postgres, các hàm phụ đó luôn trả false —
  -- bài học đã trả giá ngày 18/09/2026.
  select au.role, coalesce(au.full_name, au.email, 'Ban tổ chức')
    into v_actor_role, v_actor_name
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_role is null then
    raise exception 'Tài khoản thực hiện không hoạt động.';
  end if;
  if v_actor_role not in ('super_admin', 'admin', 'core_team') then
    raise exception 'Bạn không có quyền huỷ lịch phỏng vấn.';
  end if;

  select b.application_id into v_app_id
  from public.interview_bookings b
  where b.id = p_booking_id;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_active_booking');
  end if;

  -- Giữ đúng thứ tự khoá đơn-trước-slot-sau: đọc application_id không khoá ở
  -- trên, khoá đơn, rồi mới khoá dòng giữ chỗ và kiểm lại nó còn hiệu lực.
  select a.status into v_app_status
  from public.applications a
  where a.id = v_app_id
  for update;

  select b.* into v_booking
  from public.interview_bookings b
  where b.id = p_booking_id and b.status = 'booked'
  for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_active_booking');
  end if;

  select ar.status into v_review_status
  from public.application_reviews ar
  where ar.id = v_booking.review_id
  for update;
  if v_review_status = 'submitted' then
    return jsonb_build_object('ok', false, 'code', 'already_completed');
  end if;

  update public.interview_slots
     set status = 'open',
         booked_application_id = null
   where id = v_booking.slot_id and status = 'booked';

  update public.interview_bookings
     set status = 'cancelled_by_btc',
         cancelled_at = now(),
         cancelled_by = p_actor,
         cancel_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_booking.id;

  update public.application_reviews
     set status = 'cancelled',
         updated_at = now()
   where id = v_booking.review_id
     and status in ('assigned', 'in_progress');

  v_restored := v_app_status;
  if not exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app_id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) and v_app_status in ('interview_scheduled', 'interview_in_progress') then
    update public.applications
       set status = v_booking.previous_application_status
     where id = v_app_id;
    v_restored := v_booking.previous_application_status;

    insert into public.application_decisions (
      application_id, decided_by, decided_by_name, decision,
      previous_status, new_status, decision_note
    ) values (
      v_app_id, p_actor, v_actor_name, 'interview_booking_cancelled',
      v_app_status, v_restored,
      'Ban tổ chức huỷ buổi hẹn '
        || to_char(v_booking.slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
        || ' (giờ Việt Nam)'
        || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), '')
    );

    if v_restored in (
         'submitted', 'under_data_check', 'ready_for_screening',
         'screening_assigned', 'screening_in_progress', 'screening_completed',
         'needs_admin_review'
       )
       and exists (
         select 1 from public.application_reviews ar
         where ar.application_id = v_app_id and ar.review_round = 'profile_screening'
       )
       and exists (
         select 1 from public.recruitment_stage_requirements r
         join public.applications a on a.id = v_app_id
         where r.season_id = a.season_id and r.review_stage = 'profile_screening'
       ) then
      perform public.vam084_recompute_application_review_status(v_app_id, 'profile_screening');
    end if;
  end if;

  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = v_booking.interviewer_admin_user_id;

  select au.full_name, au.email into v_iv_name, v_iv_email
  from public.admin_users au
  where au.id = v_booking.interviewer_admin_user_id;

  select a.full_name, a.email_primary, a.phone_primary
    into v_cand_name, v_cand_email, v_cand_phone
  from public.applications a
  where a.id = v_app_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'slot_starts_at', v_booking.slot_starts_at,
    'restored_status', v_restored,
    'interviewer', jsonb_build_object(
      'admin_user_id', v_booking.interviewer_admin_user_id,
      'full_name', v_iv_name,
      'email', v_iv_email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_cand_name,
      'email', v_cand_email,
      'phone', v_cand_phone
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- 10. Vá máy tính-lại trạng thái vòng hồ sơ
-- ------------------------------------------------------------
--
-- Thân hàm chép NGUYÊN VĂN từ 20260903180000, cộng đúng MỘT tấm chắn ở đầu
-- nhánh hồ sơ: đơn đã đứng ở trạng thái vòng phỏng vấn thì trả nguyên trạng.
-- Không có tấm chắn này, reviewer hồ sơ nộp phiếu cho một mentor đã đặt lịch
-- sẽ vỡ cả transaction — điểm vừa chấm mất theo. (Lỗi này vốn đã rình sẵn
-- với các đơn được mời phỏng vấn thẳng; việc đặt lịch chỉ làm nó lộ to ra.)
-- Nhánh interview giữ nguyên từng chữ. Không security definer — giữ đúng
-- tính invoker của bản gốc.
create or replace function public.vam084_recompute_application_review_status(p_application_id uuid, p_review_stage text)
returns text
language plpgsql
set search_path to ''
as $function$
declare
  v_season_id uuid;
  v_current_status text;
  v_required integer;
  v_active integer;
  v_started integer;
  v_submitted integer;
  v_recommendations integer;
  v_next text;
  v_updated integer;
begin
  select a.season_id, a.status
    into v_season_id, v_current_status
  from public.applications a
  where a.id = p_application_id
  for update;
  if v_season_id is null then raise exception 'Application or season not found'; end if;

  -- Tấm chắn cộng thêm (22/09/2026): đơn đã sang vòng phỏng vấn thì phép tính
  -- vòng hồ sơ không còn gì để nói — trả nguyên trạng, đừng raise, đừng kéo lùi.
  if p_review_stage = 'profile_screening'
     and v_current_status in (
       'invited_to_interview', 'interview_scheduled', 'interview_in_progress',
       'interview_completed', 'ready_for_final_decision'
     ) then
    return v_current_status;
  end if;

  select r.minimum_submitted_reviews into v_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_season_id and r.review_stage = p_review_stage;
  if v_required is null then raise exception 'Review requirement is not configured'; end if;

  select
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status <> 'cancelled'),
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status in ('in_progress','submitted')),
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status = 'submitted'),
    count(distinct ar.recommendation) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    )
  into v_active, v_started, v_submitted, v_recommendations
  from public.application_reviews ar
  where ar.application_id = p_application_id
    and ar.review_round = p_review_stage;

  if p_review_stage = 'profile_screening' then
    v_next := case
      when v_current_status = 'needs_more_review' and v_active > v_submitted then 'needs_more_review'
      when v_submitted >= v_required and v_recommendations > 1 then 'needs_admin_review'
      when v_submitted >= v_required then 'screening_completed'
      when v_active = 0 then 'ready_for_screening'
      when v_started > 0 then 'screening_in_progress'
      else 'screening_assigned'
    end;
    update public.applications set status = v_next
    where id = p_application_id
      and status in (
        'submitted','under_data_check','ready_for_screening','screening_assigned',
        'screening_in_progress','screening_completed','needs_admin_review','needs_more_review'
      );
  elsif p_review_stage = 'interview' then
    v_next := case
      when v_current_status = 'needs_more_review' and v_active > v_submitted then 'needs_more_review'
      when v_submitted >= v_required then 'ready_for_final_decision'
      when v_active = 0 then 'invited_to_interview'
      else 'interview_in_progress'
    end;
    update public.applications set status = v_next
    where id = p_application_id
      and status in (
        'invited_to_interview','interview_scheduled',
        'interview_in_progress','interview_completed','ready_for_final_decision','needs_more_review'
      );
  else
    raise exception 'Unsupported review stage';
  end if;
  get diagnostics v_updated = row_count;
  if v_updated = 0 and v_current_status is distinct from v_next then
    raise exception 'Application state cannot be recomputed from current status';
  end if;
  return v_next;
end;
$function$;

-- ------------------------------------------------------------
-- 11. Chủ sở hữu và quyền gọi ba hàm mới
-- ------------------------------------------------------------
--
-- Không đụng ACL của vam084_recompute_application_review_status: create or
-- replace giữ nguyên ACL đang có trên Production.
alter function public.vam098_book_interview_slot(uuid, timestamptz) owner to postgres;
revoke all on function public.vam098_book_interview_slot(uuid, timestamptz) from public;
revoke all on function public.vam098_book_interview_slot(uuid, timestamptz) from anon, authenticated;
grant execute on function public.vam098_book_interview_slot(uuid, timestamptz) to service_role;

alter function public.vam098_cancel_interview_booking_mentor(uuid) owner to postgres;
revoke all on function public.vam098_cancel_interview_booking_mentor(uuid) from public;
revoke all on function public.vam098_cancel_interview_booking_mentor(uuid) from anon, authenticated;
grant execute on function public.vam098_cancel_interview_booking_mentor(uuid) to service_role;

alter function public.vam098_cancel_interview_booking_btc(uuid, uuid, text) owner to postgres;
revoke all on function public.vam098_cancel_interview_booking_btc(uuid, uuid, text) from public;
revoke all on function public.vam098_cancel_interview_booking_btc(uuid, uuid, text) from anon, authenticated;
grant execute on function public.vam098_cancel_interview_booking_btc(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------
-- 12. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $interview_booking_self_check$
declare
  v_def    text;
  v_acl    text;
  v_leaked text;
  v        text;
  v_fn     text;
begin
  if to_regclass('public.interviewer_profiles') is null
     or to_regclass('public.interview_slots') is null
     or to_regclass('public.interview_bookings') is null
     or to_regclass('public.interview_slot_invites') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng của bộ lịch phỏng vấn';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.interviewer_profiles'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.interview_slots'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.interview_bookings'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.interview_slot_invites'::regclass) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS chưa bật trên bảng lịch phỏng vấn';
  end if;

  select string_agg(format('%s→%s', table_name, grantee), ', ')
    into v_leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'interviewer_profiles', 'interview_slots',
      'interview_bookings', 'interview_slot_invites'
    )
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng lịch phỏng vấn lộ quyền cho %', v_leaked;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'interviewer_profiles', 'interview_slots',
        'interview_bookings', 'interview_slot_invites'
      )
      and grantee = 'service_role'
      and privilege_type = 'DELETE'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: service_role còn quyền DELETE trên bảng lịch phỏng vấn';
  end if;

  -- Năm chỉ số duy nhất — thiếu cái nào thì tranh chấp tương ứng hết trọng tài.
  foreach v in array array[
    'interview_slots_one_per_hour',
    'interview_bookings_active_app_uidx',
    'interview_bookings_active_slot_uidx',
    'interview_slot_invites_application_key',
    'interview_slot_invites_token_key'
  ] loop
    if not exists (
      select 1
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      where ic.relname = v
        and i.indisunique
    ) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số duy nhất %', v;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.outbound_emails'::regclass
    and c.conname = 'outbound_emails_kind_check';

  foreach v in array array['interview_slot_invite', 'interview_slot_cancelled'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check chưa nhận %', v;
    end if;
  end loop;
  foreach v in array array[
    'interview_scheduled', 'mentor_application_confirmation', 'event_survey'
  ] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check đã MẤT loại thư cũ %', v;
    end if;
  end loop;

  -- Ba hàm mới: tồn tại, đọc claim tin cậy, không gọi hàm phụ đọc current_user,
  -- và không mở cho anon/authenticated.
  foreach v_fn in array array[
    'public.vam098_book_interview_slot(uuid, timestamptz)',
    'public.vam098_cancel_interview_booking_mentor(uuid)',
    'public.vam098_cancel_interview_booking_btc(uuid, uuid, text)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu hàm %', v_fn;
    end if;

    select pg_get_functiondef(to_regprocedure(v_fn)::oid) into v_def;

    if position('public.vam063_trusted_api_role()' in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % không đọc vam063_trusted_api_role', v_fn;
    end if;
    -- Tìm theo DẠNG GỌI có mở ngoặc: tên trần có thể xuất hiện trong chú thích.
    if position('vam084_operator_for_season(' in v_def) > 0
       or position('vam084_staffing_operator_for_season(' in v_def) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % gọi hàm phụ đọc current_user — luôn false trong hàm định danh', v_fn;
    end if;

    select coalesce(array_to_string(p.proacl, ' '), '') into v_acl
    from pg_proc p
    where p.oid = to_regprocedure(v_fn)::oid;

    if position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mở quyền cho anon/authenticated', v_fn;
    end if;
    if position('service_role=' in v_acl) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa cấp execute cho service_role', v_fn;
    end if;
  end loop;

  -- Hàm giữ chỗ phải giữ đúng hai lời hứa: chọn không chặn nhau, và FIFO.
  select pg_get_functiondef(to_regprocedure('public.vam098_book_interview_slot(uuid, timestamptz)')::oid)
    into v_def;
  if position('for update skip locked' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ mất "for update skip locked"';
  end if;
  if position('available_since asc' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ mất thứ tự FIFO theo available_since';
  end if;

  select pg_get_functiondef(to_regprocedure('public.vam098_cancel_interview_booking_mentor(uuid)')::oid)
    into v_def;
  if position('interval ''24 hours''' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm mentor tự huỷ mất mốc chặn 24 giờ';
  end if;

  -- Hàm tính lại: tấm chắn mới phải có, và hai whitelist cũ không được mất.
  select pg_get_functiondef(to_regprocedure('public.vam084_recompute_application_review_status(uuid, text)')::oid)
    into v_def;
  if position('Tấm chắn cộng thêm' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam084_recompute thiếu tấm chắn vòng-hồ-sơ-gặp-đơn-đã-phỏng-vấn';
  end if;
  foreach v in array array['screening_assigned', 'interview_scheduled', 'needs_admin_review'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: vam084_recompute đã MẤT trạng thái % trong whitelist', v;
    end if;
  end loop;
end;
$interview_booking_self_check$;

notify pgrst, 'reload schema';

commit;
