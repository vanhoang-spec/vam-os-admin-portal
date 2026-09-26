-- ═══════════════════════════════════════════════════════════════════════════
-- Ca phỏng vấn mentee — 12 ca offline, ngày 3 và 4/10/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Vòng phỏng vấn mentor đã chạy theo lối "mentee chọn GIỜ của một người cụ
-- thể". Vòng mentee đi theo lối khác hẳn, do team support chốt trong thư báo
-- kết quả vòng đơn: ứng viên chọn một CA, không chọn người. Ban tổ chức phân
-- mentor cho từng bạn tại chỗ trong ngày.
--
-- 12 ca: 6 ca mỗi ngày × 2 ngày, mỗi ca một giờ.
--   03/10 và 04/10 — 08:00, 09:00, 10:00, 14:00, 15:00, 16:00 (giờ Việt Nam)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO `seat_limit` ĐỂ NULL, VÀ NULL NGHĨA LÀ ĐÓNG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Số ghế mỗi ca chưa chốt: nó là tích của hai con số ban tổ chức chưa có — số
-- mentor ngồi bàn mỗi ca, và độ dài một buổi. Nên 12 ca sinh ra với
-- `seat_limit` NULL.
--
-- NULL là ĐÓNG, không phải vô hạn. Đây là lựa chọn fail-closed và nó là điều
-- quan trọng nhất trong file này: nếu NULL nghĩa là vô hạn thì một ô cấu hình
-- bị quên sẽ để 500 ứng viên dồn vào một ca, và không có lỗi nào hiện ra cho
-- tới sáng ngày 3/10. Quên điền số thì KHÔNG AI đặt được — sai lộ ra ngay ngày
-- đầu tiên, khi còn sửa được.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO HẠN ĐĂNG KÝ LÀ MỘT CỘT, KHÔNG PHẢI MỘT HẰNG TRONG HÀM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Thư đã tuyên hạn 23h59 ngày 28/09/2026, và tuyên luôn rằng quá hạn thì coi
-- như ứng viên không tiếp tục. Một mốc nặng như vậy mà chôn trong thân hàm thì
-- muốn gia hạn phải sửa mã và deploy — đúng lúc đang gấp nhất. Để thành cột
-- `booking_closes_at` thì ban tổ chức gia hạn được bằng một câu update.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GHẾ ĐƯỢC CƯỠNG CHẾ Ở ĐÂU
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Trong hàm vam101, bằng khoá hàng trên dòng ca rồi ĐẾM LẠI. Không thể dùng
-- chỉ số unique vì sức chứa là một phép đếm, không phải một khoá.
--
-- Module Sự kiện có sẵn `capacity_limit`, nhưng nó kiểm ở tầng ứng dụng theo
-- lối đọc-rồi-ghi, không có ràng buộc database đỡ lưng. Với ~500 người cùng
-- bấm trong bốn ngày, lối đó sẽ vượt ghế mà không ai biết — nên vòng này không
-- dùng lại nó.
--
-- Thứ tự khoá: applications → interview_sessions → mentee_interview_bookings.
-- Cùng chiều với vam098 (applications trước), nên hai hàm không tạo vòng chờ.
--
-- Không đụng tới dòng dữ liệu nào đang có, và không chạm một object nào của
-- vòng mentor đang chạy thật. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $mentee_sessions_prereq$
declare
  v_check  text;
  v_status text;
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'seasons') then
    raise exception 'PREREQ_MISSING: chưa có bảng seasons';
  end if;
  if not exists (select 1 from public.seasons where code = 'UEHM-S12') then
    raise exception 'PREREQ_MISSING: chưa có mùa UEHM-S12 để gắn 12 ca';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role') then
    raise exception 'PREREQ_MISSING: chưa có vam063_trusted_api_role';
  end if;

  -- Ba trạng thái dưới đây là cửa vào vòng phỏng vấn. Gõ sai một tên biến cửa
  -- thành bức tường: không ai đủ điều kiện, và không lỗi nào hiện ra.
  select pg_get_constraintdef(c.oid) into v_check
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'applications'
    and c.conname = 'applications_status_check';
  if v_check is null then
    raise exception 'PREREQ_MISSING: không đọc được applications_status_check';
  end if;
  foreach v_status in array array['screening_passed', 'invited_to_interview', 'interview_scheduled'] loop
    if strpos(v_check, '''' || v_status || '''') = 0 then
      raise exception 'PREREQ_MISSING: applications_status_check không có trạng thái %', v_status;
    end if;
  end loop;
end
$mentee_sessions_prereq$;

-- ------------------------------------------------------------
-- 1. Ca phỏng vấn
-- ------------------------------------------------------------
create table if not exists public.interview_sessions (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid not null references public.seasons(id),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- NULL = chưa mở. Xem phần đầu file: đây là lựa chọn fail-closed.
  seat_limit        integer,
  venue             text,
  booking_closes_at timestamptz not null,
  status            text not null default 'open',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint interview_sessions_status_check check (status in ('open', 'closed')),
  constraint interview_sessions_span_check check (ends_at > starts_at),
  constraint interview_sessions_seat_check check (seat_limit is null or seat_limit > 0),
  constraint interview_sessions_unique_slot unique (season_id, starts_at)
);

create index if not exists interview_sessions_season_idx
  on public.interview_sessions (season_id, starts_at);

alter table public.interview_sessions enable row level security;
revoke all on table public.interview_sessions from public;
revoke all on table public.interview_sessions from anon, authenticated;

-- Thu hồi của service_role TRƯỚC khi cấp lại: bảng vừa tạo đã mang sẵn ALL theo
-- default privileges của Supabase, và DELETE nằm trong đó. Thiếu dòng này thì
-- câu grant bên dưới không thu hẹp gì cả.
revoke all on table public.interview_sessions from service_role;
grant select, insert, update on table public.interview_sessions to service_role;

-- ------------------------------------------------------------
-- 2. Chỗ ứng viên đã giữ
-- ------------------------------------------------------------
create table if not exists public.mentee_interview_bookings (
  id                          uuid primary key default gen_random_uuid(),
  session_id                  uuid not null references public.interview_sessions(id),
  application_id              uuid not null references public.applications(id),
  season_id                   uuid not null references public.seasons(id),
  status                      text not null default 'booked',
  previous_application_status text,
  booked_at                   timestamptz not null default now(),
  cancelled_at                timestamptz,
  constraint mentee_interview_bookings_status_check check (status in ('booked', 'cancelled')),
  constraint mentee_interview_bookings_cancel_check
    check ((status = 'cancelled') = (cancelled_at is not null))
);

-- Một ứng viên giữ nhiều nhất MỘT chỗ đang hiệu lực. Đây là lưới đỡ cuối cùng:
-- tầng ứng dụng cũng kiểm, nhưng chỉ chỉ số này mới chịu được hai tab bấm cùng
-- một giây.
create unique index if not exists mentee_interview_bookings_active_uidx
  on public.mentee_interview_bookings (application_id)
  where status = 'booked';

create index if not exists mentee_interview_bookings_session_idx
  on public.mentee_interview_bookings (session_id)
  where status = 'booked';

alter table public.mentee_interview_bookings enable row level security;
revoke all on table public.mentee_interview_bookings from public;
revoke all on table public.mentee_interview_bookings from anon, authenticated;

-- Thu hồi của service_role TRƯỚC khi cấp lại: bảng vừa tạo đã mang sẵn ALL theo
-- default privileges của Supabase, và DELETE nằm trong đó. Thiếu dòng này thì
-- câu grant bên dưới không thu hẹp gì cả.
revoke all on table public.mentee_interview_bookings from service_role;
grant select, insert, update on table public.mentee_interview_bookings to service_role;

-- ------------------------------------------------------------
-- 3. Mã link riêng của từng ứng viên
-- ------------------------------------------------------------
-- Bảng RIÊNG, không dùng lại interview_slot_invites của vòng mentor: vòng đó
-- đang chạy thật trên dữ liệu người thật ngay lúc này, và nhịp gửi thư của nó
-- (send_count, claimed_at) thuộc về một bộ gửi khác. Dùng chung một bảng cho
-- hai vòng là mời một lỗi mà không ai truy được thuộc về vòng nào.
create table if not exists public.mentee_interview_invites (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id),
  token          uuid not null unique default gen_random_uuid(),
  send_count     integer not null default 0,
  first_sent_at  timestamptz,
  last_sent_at   timestamptz,
  claimed_at     timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  constraint mentee_interview_invites_send_count_check check (send_count between 0 and 4)
);

alter table public.mentee_interview_invites enable row level security;
revoke all on table public.mentee_interview_invites from public;
revoke all on table public.mentee_interview_invites from anon, authenticated;

-- Thu hồi của service_role TRƯỚC khi cấp lại: bảng vừa tạo đã mang sẵn ALL theo
-- default privileges của Supabase, và DELETE nằm trong đó. Thiếu dòng này thì
-- câu grant bên dưới không thu hẹp gì cả.
revoke all on table public.mentee_interview_invites from service_role;
grant select, insert, update on table public.mentee_interview_invites to service_role;

-- ------------------------------------------------------------
-- 4. Sinh 12 ca cho mùa UEHM-S12
-- ------------------------------------------------------------
-- Giờ dựng bằng chuỗi có '+07:00' tường minh: database chạy UTC, và một ca
-- "08:00" dựng theo múi giờ phiên sẽ lệch bảy tiếng mà không ai thấy cho tới
-- khi ứng viên tới sai giờ.
--
-- `on conflict do nothing` theo (season_id, starts_at): chạy lại không sinh
-- trùng, và KHÔNG ghi đè seat_limit hay venue mà ban tổ chức đã điền.
insert into public.interview_sessions (season_id, starts_at, ends_at, booking_closes_at)
select s.id,
       (d.ngay || ' ' || h.gio || ':00:00+07:00')::timestamptz,
       (d.ngay || ' ' || h.gio || ':00:00+07:00')::timestamptz + interval '1 hour',
       '2026-09-28 23:59:59+07:00'::timestamptz
from public.seasons s
cross join (values ('2026-10-03'), ('2026-10-04')) as d(ngay)
cross join (values ('08'), ('09'), ('10'), ('14'), ('15'), ('16')) as h(gio)
where s.code = 'UEHM-S12'
on conflict (season_id, starts_at) do nothing;

-- ------------------------------------------------------------
-- 5. Giữ chỗ — một transaction, ghế đếm lại dưới khoá
-- ------------------------------------------------------------
create or replace function public.vam101_book_mentee_session(
  p_token uuid,
  p_session_id uuid
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
  v_session    public.interview_sessions%rowtype;
  v_taken      integer;
  v_booking_id uuid;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id into v_app_id
  from public.mentee_interview_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Khoá dòng đơn TRƯỚC mọi phép kiểm: hai tab của cùng một ứng viên bấm hai ca
  -- khác nhau sẽ nối đuôi ở đây, tab sau thấy 'already_booked'.
  select a.* into v_app from public.applications a where a.id = v_app_id for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Luật đối tượng: đơn mentee nộp qua form, ĐÃ QUA vòng hồ sơ. Ba trạng thái
  -- này khớp từng chữ với BOOKING_ELIGIBLE_STATUSES ở tầng TypeScript.
  if lower(coalesce(v_app.role_applied::text, '')) <> 'mentee'
     or coalesce(v_app.source, '') <> 'vam_os_form'
     or v_app.status not in (
       'screening_passed', 'invited_to_interview', 'interview_scheduled'
     ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if exists (
    select 1 from public.mentee_interview_bookings b
    where b.application_id = v_app_id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_booked');
  end if;

  -- Khoá dòng ca rồi mới đếm. Đếm trước khi khoá là đúng cái lỗi khiến ca vượt
  -- ghế: hai người cùng đọc "còn 1 chỗ" rồi cùng ghi.
  select se.* into v_session
  from public.interview_sessions se
  where se.id = p_session_id and se.season_id = v_app.season_id
  for update;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_found');
  end if;

  if now() > v_session.booking_closes_at then
    return jsonb_build_object('ok', false, 'code', 'deadline_passed');
  end if;

  if v_session.status <> 'open' or v_session.seat_limit is null then
    return jsonb_build_object('ok', false, 'code', 'session_not_open');
  end if;

  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'session_in_past');
  end if;

  select count(*) into v_taken
  from public.mentee_interview_bookings b
  where b.session_id = v_session.id and b.status = 'booked';

  if v_taken >= v_session.seat_limit then
    return jsonb_build_object('ok', false, 'code', 'session_full');
  end if;

  insert into public.mentee_interview_bookings (
    session_id, application_id, season_id, previous_application_status
  ) values (
    v_session.id, v_app_id, v_app.season_id, v_app.status
  )
  returning id into v_booking_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app_id, null, 'Hệ thống đặt ca phỏng vấn mentee', 'interview_scheduled',
    v_app.status, 'interview_scheduled',
    'Ứng viên tự chọn ca qua link cá nhân — '
      || to_char(v_session.starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'session_id', v_session.id,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'venue', v_session.venue,
    'previous_status', v_app.status,
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
-- 6. Chủ sở hữu và quyền gọi
-- ------------------------------------------------------------
alter function public.vam101_book_mentee_session(uuid, uuid) owner to postgres;
revoke all on function public.vam101_book_mentee_session(uuid, uuid) from public;
revoke all on function public.vam101_book_mentee_session(uuid, uuid) from anon, authenticated;
grant execute on function public.vam101_book_mentee_session(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 7. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $mentee_sessions_self_check$
declare
  v_fn    text;
  v_acl   text;
  v_tbl   text;
  v_count integer;
begin
  foreach v_tbl in array array[
    'interview_sessions', 'mentee_interview_bookings', 'mentee_interview_invites'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_tbl and c.relrowsecurity
    ) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa bật RLS', v_tbl;
    end if;

    select array_to_string(c.relacl, ' ') into v_acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_tbl;
    if v_acl is not null and (position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % còn cấp quyền cho anon/authenticated', v_tbl;
    end if;
    -- Khẳng định ĐÚNG bộ quyền chứ không dò từng chữ cái: a=insert, r=select,
    -- w=update. Thiếu `revoke all ... from service_role` phía trên thì chuỗi này
    -- là `arwdDxtm` — có cả DELETE (d) lẫn TRUNCATE (D) — và bản chạy thử đầu
    -- tiên của migration này đã dính đúng lỗi đó.
    --
    -- Không cấp DELETE là có chủ ý: chỗ đã huỷ là bằng chứng, chuyển trạng thái
    -- chứ không xoá.
    if coalesce(split_part(split_part(v_acl, 'service_role=', 2), '/', 1), '') <> 'arw' then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % cấp cho service_role bộ quyền "%s", phải là đúng "arw"',
        v_tbl, split_part(split_part(v_acl, 'service_role=', 2), '/', 1);
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'mentee_interview_bookings_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu chỉ số một-ứng-viên-một-chỗ';
  end if;

  select count(*) into v_count
  from public.interview_sessions se
  join public.seasons s on s.id = se.season_id
  where s.code = 'UEHM-S12';
  if v_count <> 12 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: phải có đúng 12 ca cho UEHM-S12, đang có %', v_count;
  end if;

  select prosrc into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam101_book_mentee_session';
  if v_fn is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất hàm vam101_book_mentee_session';
  end if;
  if position('vam063_trusted_api_role' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ mất cổng ngữ cảnh máy chủ';
  end if;
  if position('vam084_operator_for_season(' in v_fn) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ gọi vam084_operator_for_season trong security definer';
  end if;
  -- Đếm ghế phải nằm SAU khoá hàng. Mất "for update" là mất toàn bộ phép cưỡng chế.
  if position('for update' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ mất khoá hàng';
  end if;
  if position('seat_limit is null' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ không còn coi ghế chưa cấu hình là đóng';
  end if;
  if position('booking_closes_at' in v_fn) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ không kiểm hạn đăng ký';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam101_book_mentee_session' and p.prosecdef
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam101_book_mentee_session phải là security definer';
  end if;

  select array_to_string(p.proacl, ' ') into v_acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam101_book_mentee_session';
  if v_acl is not null and (position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm giữ chỗ còn cấp quyền gọi cho anon/authenticated';
  end if;
end
$mentee_sessions_self_check$;

notify pgrst, 'reload schema';

commit;
