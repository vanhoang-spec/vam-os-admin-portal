-- ═══════════════════════════════════════════════════════════════════════════
-- Chiều ngược: mentor tự khai giờ rảnh, interviewer mở lưới ra ghép
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Đợt phỏng vấn mentor UEHM-S12 đang chạy theo một chiều: interviewer đăng giờ
-- rảnh trước, mentor mở link riêng và giữ chỗ. Chiều đó bế tắc khi không còn
-- giờ nào trống — 23/09/2026 có 50 mentor cầm link mà mở ra chỉ thấy một ô
-- vàng "hiện chưa có khung giờ trống nào".
--
-- Chiều này đi ngược lại: mentor chọn MỘT giờ mình rảnh, interviewer mở lưới
-- thấy "khung giờ này có N người đang chờ" rồi bấm ghép. Hai chiều gặp nhau ở
-- đúng một kết quả — một dòng `interview_bookings`, một phiếu phỏng vấn giao
-- cho interviewer, ba lá thư xác nhận — nên phần sau của quy trình không phải
-- biết buổi hẹn đã sinh ra từ chiều nào.
--
-- Mỗi mentor chỉ giữ MỘT lời ngỏ tại một thời điểm (chủ dự án chốt 23/09/2026):
-- chọn giờ khác là bỏ giờ cũ, rồi chờ tới khi có interviewer khớp vào đúng giờ
-- đó. Nhờ vậy con số "N người đang chờ" đếm đúng N CON NGƯỜI, không phải N lượt
-- khai — ban tổ chức đọc nó để quyết định mở thêm giờ nào.
--
-- Giá trị lớn nhất không phải là thêm một đường đặt lịch, mà là ban tổ chức
-- lần đầu NHÌN THẤY nhu cầu: hôm nay họ chỉ biết là thiếu giờ, không biết
-- thiếu giờ NÀO. Có bảng này thì "20:00 có 18 người chờ" là một con số đọc
-- được, và interviewer mở đúng khung giờ đang tắc thay vì đoán.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO PHÉP GHÉP NẰM TRONG MỘT HÀM SQL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cùng một lý do đã viết trong 20260922100000: hai interviewer bấm ghép cùng
-- một khung giờ trong cùng một giây là chuyện sẽ xảy ra, và tầng ứng dụng
-- không có transaction chung giữa hai request. Toàn bộ chuỗi chọn-người-chờ →
-- khoá đơn → mở giờ cho interviewer → tạo phiếu → đổi trạng thái phải là MỘT
-- transaction.
--
-- Trong cùng một khung giờ, ghép cho mentor KHAI SỚM NHẤT trước (cột
-- `available_since`) — đúng tinh thần ai-trước-được-trước của chiều kia, và
-- đúng lời chủ dự án chốt 23/09/2026. `for update skip locked` cho interviewer
-- thứ hai lấy ngay người kế tiếp thay vì xếp hàng chờ khoá.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THỨ TỰ KHOÁ
-- ═══════════════════════════════════════════════════════════════════════════
--
--   interview_mentor_availability → applications → interview_slots → (bookings,
--   reviews chỉ ghi sau khi đã cầm ba khoá trên)
--
-- Hàm giữ chỗ cũ (vam098_book_interview_slot) đi applications → interview_slots
-- và KHÔNG bao giờ chạm bảng mới này, nên hai hàm không tạo được vòng chờ.
-- Mentor vừa tự giữ chỗ vừa bị ghép trong cùng một giây thì cả hai hàm đều
-- khoá dòng đơn trước khi ghi, nên người sau thấy 'already_booked' — và chỉ
-- số duy nhất `interview_bookings_active_app_uidx` là lưới đỡ cuối.
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $mentor_availability_prereq$
begin
  if to_regclass('public.applications') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.seasons') is null
     or to_regclass('public.application_reviews') is null
     or to_regclass('public.application_decisions') is null then
    raise exception 'PREREQ_MISSING: thiếu bảng nền của hệ tuyển sinh';
  end if;

  -- Bộ lịch phỏng vấn 20260922100000 phải có mặt trước: bảng mới ghép vào
  -- chính interview_slots / interview_bookings của nó.
  if to_regclass('public.interview_slots') is null
     or to_regclass('public.interview_bookings') is null
     or to_regclass('public.interview_slot_invites') is null
     or to_regclass('public.interviewer_profiles') is null then
    raise exception 'PREREQ_MISSING: chưa chạy 20260922100000_interview_slot_booking.sql';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role'
  ) then
    raise exception 'PREREQ_MISSING: thiếu hàm vam063_trusted_api_role';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.applications'::regclass
      and c.conname = 'applications_status_check'
      and position(quote_literal('interview_scheduled') in pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception 'PREREQ_MISSING: applications_status_check chưa nhận interview_scheduled';
  end if;
end
$mentor_availability_prereq$;

-- ------------------------------------------------------------
-- 1. Giờ rảnh do mentor tự khai
-- ------------------------------------------------------------
create table if not exists public.interview_mentor_availability (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  season_id uuid not null references public.seasons(id),
  slot_starts_at timestamptz not null,
  status text not null default 'open',
  -- Khoá FIFO: mentor khai giờ này từ lúc nào. Bỏ tick rồi tick lại thì reset
  -- (xuống cuối hàng — họ đã từng rút lời), đúng như bên interview_slots.
  available_since timestamptz not null default now(),
  matched_booking_id uuid references public.interview_bookings(id),
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint interview_mentor_availability_status_check
    check (status in ('open', 'removed', 'matched')),
  -- Dòng đã ghép phải trỏ được về buổi hẹn, và chỉ dòng đã ghép mới được trỏ.
  constraint interview_mentor_availability_matched_link_check
    check ((status = 'matched') = (matched_booking_id is not null)),
  -- Cùng lưới với interview_slots: tròn giờ, 07..21 giờ Việt Nam. Biên ngày
  -- của đợt nằm ở tầng ứng dụng để mùa sau đổi đợt không cần migration.
  constraint interview_mentor_availability_hour_check check (
    extract(minute from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) = 0
    and extract(second from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) = 0
    and extract(hour from (slot_starts_at at time zone 'Asia/Ho_Chi_Minh')) between 7 and 21
  ),
  -- Một dòng cho một (mentor, giờ) dù ở trạng thái nào — bỏ tick là
  -- status='removed', tick lại là UPDATE về 'open'. Không bao giờ có dòng thứ
  -- hai, nên thứ tự FIFO do database canh giữ chứ không do tầng ứng dụng.
  constraint interview_mentor_availability_one_per_hour
    unique (application_id, slot_starts_at)
);

create index if not exists interview_mentor_availability_open_by_time_idx
  on public.interview_mentor_availability (slot_starts_at, available_since)
  where status = 'open';

create index if not exists interview_mentor_availability_app_idx
  on public.interview_mentor_availability (application_id, slot_starts_at);

create index if not exists interview_mentor_availability_season_idx
  on public.interview_mentor_availability (season_id);

-- MỘT mentor chỉ giữ MỘT lời ngỏ tại một thời điểm (chủ dự án chốt 23/09/2026).
-- Chọn giờ khác nghĩa là bỏ giờ cũ, không phải khai thêm giờ thứ hai; rồi chờ
-- tới khi có interviewer khớp vào đúng giờ đó.
--
-- Luật này được canh Ở ĐÂY chứ không phải ở tầng ứng dụng: tầng ứng dụng không
-- có transaction chung giữa hai request, nên hai tab của cùng một người bấm hai
-- giờ khác nhau trong cùng một giây sẽ lọt qua mọi phép "đọc rồi ghi". Chỉ số
-- bộ phận này thì không lọt.
create unique index if not exists interview_mentor_availability_active_uidx
  on public.interview_mentor_availability (application_id)
  where status = 'open';

comment on table public.interview_mentor_availability is
  'Giờ mentor tự khai là mình rảnh, để interviewer mở lưới ra ghép. Chiều ngược của interview_slots.';

comment on column public.interview_mentor_availability.available_since is
  'Khoá FIFO trong cùng khung giờ: ai khai sớm hơn được ghép trước. Reset khi tick lại sau khi bỏ tick.';

-- ------------------------------------------------------------
-- 2. Quyền: chỉ máy chủ, không xoá
-- ------------------------------------------------------------
alter table public.interview_mentor_availability enable row level security;

revoke all on public.interview_mentor_availability from public, anon, authenticated;

-- Thu hồi của service_role TRƯỚC khi cấp lại: bảng vừa tạo đã mang sẵn ALL
-- theo default privileges của Supabase, và DELETE nằm trong đó.
revoke all on public.interview_mentor_availability from service_role;

-- Không cấp DELETE. Bỏ tick là status='removed' — "ai từng khai rảnh giờ nào,
-- rút lúc nào" là thứ ban tổ chức sẽ cần khi đối chiếu về sau.
grant select, insert, update on public.interview_mentor_availability to service_role;

-- ------------------------------------------------------------
-- 3. Ghép — một transaction, ai khai trước được ghép trước
-- ------------------------------------------------------------
--
-- Lỗi NGHIỆP VỤ trả jsonb {ok:false, code} để tầng ứng dụng dịch thành câu
-- tiếng Việt; chỉ raise cho lỗi LẬP TRÌNH (gọi ngoài ngữ cảnh máy chủ, hoặc
-- người bấm không phải interviewer).
--
-- KHÔNG gọi hàm phụ vam084_operator_for_season — bên trong security definer,
-- current_user là postgres nên hàm đó đọc sai ngữ cảnh (bài học PR #144).
-- Quyền của người bấm được kiểm inline ngay dưới đây.
create or replace function public.vam099_match_mentor_at_hour(
  p_actor uuid,
  p_slot_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_actor      public.admin_users%rowtype;
  v_avail      public.interview_mentor_availability%rowtype;
  v_app        public.applications%rowtype;
  v_slot       public.interview_slots%rowtype;
  v_review_id  uuid;
  v_booking_id uuid;
  v_phone      text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select au.* into v_actor
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor.id is null
     or v_actor.role not in ('super_admin', 'admin', 'core_team', 'reviewer') then
    raise exception 'Interviewer context required';
  end if;

  -- SĐT của interviewer đi vào thư xác nhận gửi mentor. Ghép mà thiếu nó là
  -- hẹn một người rồi không cho họ cách gọi lại — chặn ngay ở đây.
  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = p_actor;
  if coalesce(btrim(coalesce(v_phone, '')), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'missing_phone');
  end if;

  if p_slot_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'slot_in_past');
  end if;

  -- Người khai sớm nhất được ghép trước; dòng đang bị giao dịch khác cầm thì
  -- bỏ qua lấy người kế (skip locked) — interviewer thứ hai không phải chờ.
  -- Điều kiện đối tượng lặp lại đúng luật của vam098_book_interview_slot: đơn
  -- mentor nộp qua form, hồ sơ còn mở, chưa có lịch và chưa có phiếu phỏng vấn.
  select av.* into v_avail
  from public.interview_mentor_availability av
  join public.applications a on a.id = av.application_id
  where av.slot_starts_at = p_slot_starts_at
    and av.status = 'open'
    and lower(coalesce(a.role_applied::text, '')) = 'mentor'
    and coalesce(a.source, '') = 'vam_os_form'
    and a.status in (
      'submitted', 'under_data_check', 'ready_for_screening',
      'screening_assigned', 'screening_in_progress', 'screening_completed',
      'screening_passed', 'invited_to_interview', 'interview_scheduled'
    )
    and not exists (
      select 1 from public.interview_bookings b
      where b.application_id = a.id and b.status = 'booked'
    )
    and not exists (
      select 1 from public.application_reviews ar
      where ar.application_id = a.id
        and ar.review_round = 'interview'
        and ar.status <> 'cancelled'
    )
  order by av.available_since asc, av.id asc
  limit 1
  for update of av skip locked;

  if v_avail.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_mentor_waiting');
  end if;

  -- Khoá dòng đơn rồi kiểm lại dưới khoá: giữa lúc chọn ở trên và ghi ở dưới,
  -- chính mentor đó có thể vừa tự giữ chỗ qua link riêng.
  select a.* into v_app
  from public.applications a
  where a.id = v_avail.application_id
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_mentor_waiting');
  end if;

  if exists (
    select 1 from public.interview_bookings b
    where b.application_id = v_app.id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'mentor_already_booked');
  end if;

  if exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app.id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'code', 'mentor_already_booked');
  end if;

  -- Giờ của interviewer: có sẵn thì dùng, chưa có thì mở luôn. Interviewer
  -- không phải đăng giờ trước rồi mới ghép được — một cú bấm là xong.
  select s.* into v_slot
  from public.interview_slots s
  where s.admin_user_id = p_actor and s.slot_starts_at = p_slot_starts_at
  for update;

  if v_slot.id is not null and v_slot.status = 'booked' then
    return jsonb_build_object('ok', false, 'code', 'interviewer_busy');
  end if;

  if v_slot.id is null then
    insert into public.interview_slots (
      season_id, admin_user_id, slot_starts_at, status, booked_application_id
    ) values (
      v_app.season_id, p_actor, p_slot_starts_at, 'booked', v_app.id
    )
    returning * into v_slot;
  else
    update public.interview_slots
       set status = 'booked',
           booked_application_id = v_app.id
     where id = v_slot.id
    returning * into v_slot;
  end if;

  -- Phiếu phỏng vấn giao thẳng cho người vừa bấm ghép: sau buổi họ chấm ở
  -- /reviews như mọi phiếu khác. assigned_by chính là họ — khác chiều kia,
  -- nơi mentor tự chọn nên không có ai "giao".
  insert into public.application_reviews (
    application_id, review_round, reviewer_admin_user_id,
    assigned_by, assigned_at, due_at, status
  ) values (
    v_app.id, 'interview', p_actor,
    p_actor, now(), p_slot_starts_at + interval '1 hour', 'assigned'
  )
  returning id into v_review_id;

  insert into public.interview_bookings (
    slot_id, application_id, interviewer_admin_user_id, review_id,
    slot_starts_at, previous_application_status
  ) values (
    v_slot.id, v_app.id, p_actor, v_review_id,
    p_slot_starts_at, v_app.status
  )
  returning id into v_booking_id;

  update public.interview_mentor_availability
     set status = 'matched',
         matched_booking_id = v_booking_id,
         matched_at = now()
   where id = v_avail.id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app.id, p_actor, coalesce(v_actor.full_name, v_actor.email),
    'interview_scheduled', v_app.status, 'interview_scheduled',
    'Interviewer ghép vào giờ mentor tự khai rảnh — '
      || to_char(p_slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app.id;

  -- Cùng hình dạng trả về với vam098_book_interview_slot, để tầng ứng dụng
  -- gửi ba lá thư xác nhận bằng đúng một đoạn mã cho cả hai chiều.
  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'review_id', v_review_id,
    'slot_starts_at', p_slot_starts_at,
    'previous_status', v_app.status,
    'interviewer', jsonb_build_object(
      'admin_user_id', p_actor,
      'full_name', v_actor.full_name,
      'email', v_actor.email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app.id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- 4. Chủ sở hữu và quyền gọi
-- ------------------------------------------------------------
alter function public.vam099_match_mentor_at_hour(uuid, timestamptz) owner to postgres;
revoke all on function public.vam099_match_mentor_at_hour(uuid, timestamptz) from public;
revoke all on function public.vam099_match_mentor_at_hour(uuid, timestamptz) from anon, authenticated;
grant execute on function public.vam099_match_mentor_at_hour(uuid, timestamptz) to service_role;

-- ------------------------------------------------------------
-- 5. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $mentor_availability_self_check$
declare
  v_fn     text;
  v_acl    text;
  v_leaked text;
  v        text;
begin
  if to_regclass('public.interview_mentor_availability') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu bảng interview_mentor_availability';
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.interview_mentor_availability'::regclass) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: RLS chưa bật trên interview_mentor_availability';
  end if;

  select string_agg(distinct g.grantee, ', ') into v_leaked
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'interview_mentor_availability'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: bảng giờ rảnh mentor còn lộ quyền cho %', v_leaked;
  end if;

  select string_agg(distinct g.privilege_type, ',' order by g.privilege_type) into v
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'interview_mentor_availability'
    and g.grantee = 'service_role';
  if coalesce(v, '') <> 'INSERT,SELECT,UPDATE' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: quyền service_role phải đúng INSERT,SELECT,UPDATE (đang là %)',
      coalesce(v, '(trống)');
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.interview_mentor_availability'::regclass
      and c.conname = 'interview_mentor_availability_one_per_hour'
      and c.contype = 'u'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu khoá duy nhất (application_id, slot_starts_at)';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'interview_mentor_availability_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số một-mentor-một-lời-ngỏ';
  end if;

  select pg_get_functiondef(p.oid) into v_fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam099_match_mentor_at_hour';
  if v_fn is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu hàm vam099_match_mentor_at_hour';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam099_match_mentor_at_hour' and p.prosecdef
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam099_match_mentor_at_hour phải là security definer';
  end if;
  if position('vam063_trusted_api_role' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm ghép không kiểm ngữ cảnh máy chủ';
  end if;
  if position('for update of av skip locked' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm ghép mất phép chọn không nghẽn';
  end if;
  if position('av.available_since asc' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm ghép mất thứ tự ai-khai-trước-được-trước';
  end if;
  if position('vam084_operator_for_season(' in v_fn) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm ghép gọi vam084_operator_for_season trong security definer';
  end if;

  select array_to_string(p.proacl, ' ') into v_acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam099_match_mentor_at_hour';
  if v_acl is not null and (position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm ghép còn cấp quyền gọi cho anon/authenticated';
  end if;
end
$mentor_availability_self_check$;

notify pgrst, 'reload schema';

commit;
