-- Phỏng vấn mentee ĐỢT 2 — Thứ Bảy 10/10 và Chủ nhật 11/10/2026 (BTC 07/10/2026).
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge PR. Chạy lại an toàn:
-- mỗi bước chỉ chạm đúng những dòng còn ở trạng thái cũ.
--
--  1. 28 ca 30 phút, giờ y như đợt 1, hạn chọn ca 17:00 Thứ Sáu 09/10.
--     Thứ Bảy: chưa có địa điểm (BTC điền sau ở trang Ca phỏng vấn mentee — link của
--     mentee tự hiện địa điểm khi có), 18 chỗ/ca như Thứ Bảy đợt 1.
--     Chủ nhật: Cơ sở B, 6 phòng, 28 chỗ/ca như Chủ nhật đợt 1.
--  (2. Cận phòng/bàn theo địa điểm ca: file 20261007090000 — dán TRƯỚC file này.)
--  3. Bạn đã đặt ca đợt 1 mà không đến (chưa check-in): huỷ chỗ cũ đã qua.
--  4. Mở lại chọn ca đến 17:00 09/10 cho người đã có thư mời mà chưa giữ ca nào —
--     bạn chưa từng chọn ca + bạn ở mục 3. BTC bấm gửi thư báo ở trang Ca phỏng vấn mentee.
--  5. Hồ sơ mentee nộp từ 27/09 (sau mốc chốt đợt 1: đơn được mời muộn nhất nộp
--     23:57 26/09), đã chấm vòng hồ sơ, đề xuất "Pass to interview" HOẶC đề xuất
--     khác mà điểm CV (tổng 5 tiêu chí, chưa cộng điểm theo ngày nộp) >= 13 →
--     "Mời phỏng vấn". BTC bấm "Gửi thư mời chọn ca" như đợt 1. Dưới 13 tạm giữ.
--
-- Người ghi quyết định: tài khoản của anh Hoàng (super_admin) — quyết định do BTC chốt
-- trong cuộc trao đổi 07/10/2026.

begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (
    select 1 from public.admin_users
    where id = 'a3f45586-8747-49d9-860a-4b903cfdc7bc' and status = 'active'
  ) then
    raise exception 'PREREQ: không thấy tài khoản ghi quyết định';
  end if;
  if not exists (select 1 from public.seasons where code = 'UEHM-S12') then
    raise exception 'PREREQ: không thấy mùa UEHM-S12';
  end if;
  if pg_get_functiondef('public.vam104_room_desk_bounds_guard()'::regprocedure) not like '%string_to_array%' then
    raise exception 'PREREQ: dán 20261007090000_phong_ban_theo_dia_diem_ca.sql trước';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. 28 ca của đợt 2
-- ------------------------------------------------------------
-- Giờ dựng bằng chuỗi có '+07:00' tường minh: database chạy UTC.
-- `on conflict do nothing` theo (season_id, starts_at): chạy lại không sinh trùng và
-- không ghi đè số chỗ / địa điểm BTC đã sửa.
insert into public.interview_sessions (season_id, starts_at, ends_at, booking_closes_at, seat_limit, venue, status)
select s.id,
       (d.ngay || ' ' || h.gio || ':00+07:00')::timestamptz,
       (d.ngay || ' ' || h.gio || ':00+07:00')::timestamptz + interval '30 minutes',
       '2026-10-09 17:00:00+07:00'::timestamptz,
       d.so_cho,
       d.dia_diem,
       'open'
from public.seasons s
cross join (values
  ('2026-10-10', 18, null::text),
  ('2026-10-11', 28, 'Phòng B1-502, B1-503, B1-504, B1-506, B1-802, B1-803 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, TP. Hồ Chí Minh (địa chỉ cũ: 279 Nguyễn Tri Phương, P.5, Q.10, TP.HCM). Check-in tại phòng B1-502. Bản đồ: https://maps.app.goo.gl/Cne2WL3a6LfXNZ2fA')
) as d(ngay, so_cho, dia_diem)
cross join (values
  ('08:00'), ('08:30'), ('09:00'), ('09:30'), ('10:00'), ('10:30'), ('11:00'),
  ('13:30'), ('14:00'), ('14:30'), ('15:00'), ('15:30'), ('16:00'), ('16:30')
) as h(gio)
where s.code = 'UEHM-S12'
on conflict (season_id, starts_at) do nothing;

-- ------------------------------------------------------------
-- 3. Bạn vắng đợt 1: huỷ chỗ cũ đã qua
-- ------------------------------------------------------------
-- Chỉ người CHƯA check-in (trigger vam104_booking_guard cũng tự chặn người đã check-in).
-- Trạng thái đơn giữ nguyên như khi BTC huỷ lịch ở màn hình phỏng vấn (vam105).
create temp table dot2_vang on commit drop as
select b.id as booking_id, b.application_id, b.session_id
from public.mentee_interview_bookings b
join public.interview_sessions s on s.id = b.session_id
join public.seasons se on se.id = b.season_id and se.code = 'UEHM-S12'
left join public.mentee_interview_operations o on o.id = b.application_id
where b.status = 'booked'
  and s.starts_at < '2026-10-05 00:00:00+07:00'
  and o.checked_in_at is null
  and o.outcome is null;

update public.mentee_interview_bookings b
   set status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = 'a3f45586-8747-49d9-860a-4b903cfdc7bc',
       cancel_note = 'Vắng buổi phỏng vấn 03–04/10 — mở lại chọn ca đợt 2 (10–11/10)'
  from dot2_vang v
 where b.id = v.booking_id and b.status = 'booked';

insert into public.mentee_interview_operation_log (application_id, actor_id, action, reason, before_data, after_data)
select v.application_id, 'a3f45586-8747-49d9-860a-4b903cfdc7bc', 'cancel_booking',
       'Vắng buổi phỏng vấn 03–04/10 — mở lại chọn ca đợt 2 (10–11/10)',
       jsonb_build_object('booking', jsonb_build_object('id', v.booking_id, 'session_id', v.session_id, 'status', 'booked')),
       jsonb_build_object('booking', jsonb_build_object('id', v.booking_id, 'status', 'cancelled'))
from dot2_vang v;

-- Dòng điều phối trống còn sót của ca cũ (đã tạo nhưng chưa check-in, chưa có người
-- phỏng vấn, chưa có phiếu): bỏ đi để ngày đợt 2 dựng dòng mới đúng ca mới.
delete from public.mentee_interview_operations o
 using dot2_vang v
 where o.id = v.application_id
   and o.checked_in_at is null and o.outcome is null
   and o.interviewer_id is null and o.review_id is null and o.match_id is null;

-- ------------------------------------------------------------
-- 4. Mở lại chọn ca đến 17:00 09/10 cho người có thư mời mà chưa giữ ca
-- ------------------------------------------------------------
-- reopen_notified_at = null để trang Ca phỏng vấn mentee liệt kê họ vào lượt thư
-- báo đợt 2 (kể cả người đã nhận thư mở lại hồi đợt 1).
update public.mentee_interview_invites i
   set booking_open_until = '2026-10-09 17:00:00+07:00',
       reopen_notified_at = null
  from public.applications a
  join public.seasons se on se.id = a.season_id and se.code = 'UEHM-S12'
 where a.id = i.application_id
   and a.role_applied = 'mentee'
   and a.source = 'vam_os_form'
   and a.status in ('invited_to_interview', 'interview_scheduled')
   and not exists (
     select 1 from public.mentee_interview_bookings b
     where b.application_id = a.id and b.status = 'booked'
   );

-- ------------------------------------------------------------
-- 5. Hồ sơ mới sau mốc chốt đợt 1 → Mời phỏng vấn
-- ------------------------------------------------------------
create temp table dot2_moi on commit drop as
select a.id
from public.applications a
join public.seasons se on se.id = a.season_id and se.code = 'UEHM-S12'
where a.role_applied = 'mentee'
  and a.source = 'vam_os_form'
  and a.status = 'screening_completed'
  and a.created_at >= '2026-09-27 00:00:00+07:00'
  and exists (
    select 1 from public.application_reviews r
    where r.application_id = a.id
      and r.review_round = 'profile_screening'
      and r.status = 'submitted'
      and (r.recommendation = 'pass_to_interview' or r.total_score >= 13)
  )
  -- Cùng cổng điều kiện với nút "Mời phỏng vấn hàng loạt" (vam084).
  and exists (
    select 1 from public.vam084_application_decision_eligibility(a.id, 'invited_to_interview') g
    where g.eligible
  );

update public.applications a
   set status = 'invited_to_interview'
  from dot2_moi m
 where a.id = m.id and a.status = 'screening_completed';

insert into public.application_decisions (
  application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note
)
select m.id, au.id, coalesce(nullif(btrim(au.full_name), ''), au.email), 'invited_to_interview',
       'screening_completed', 'invited_to_interview',
       'Mời phỏng vấn đợt 2 (10–11/10/2026): nộp từ 27/09, đề xuất Pass to interview hoặc điểm CV >= 13 — BTC chốt 07/10/2026'
from dot2_moi m
cross join public.admin_users au
where au.id = 'a3f45586-8747-49d9-860a-4b903cfdc7bc';

-- ------------------------------------------------------------
-- 6. Tự kiểm
-- ------------------------------------------------------------
do $$
declare
  v_sessions integer;
  v_sunday_venue integer;
  v_left integer;
  v_reopened integer;
  v_new integer;
begin
  select count(*), count(*) filter (where venue like 'Phòng B1-502,%')
    into v_sessions, v_sunday_venue
    from public.interview_sessions s join public.seasons se on se.id = s.season_id and se.code = 'UEHM-S12'
   where s.starts_at >= '2026-10-10 00:00:00+07:00' and s.starts_at < '2026-10-12 00:00:00+07:00';
  if v_sessions <> 28 then raise exception 'SELF_CHECK: đợt 2 có % ca, cần 28', v_sessions; end if;
  if v_sunday_venue <> 14 then raise exception 'SELF_CHECK: % ca Chủ nhật có địa điểm Cơ sở B, cần 14', v_sunday_venue; end if;

  select count(*) into v_left
    from public.mentee_interview_bookings b
    join public.interview_sessions s on s.id = b.session_id
    left join public.mentee_interview_operations o on o.id = b.application_id
   where b.status = 'booked' and s.starts_at < '2026-10-05 00:00:00+07:00' and o.checked_in_at is null;
  if v_left <> 0 then raise exception 'SELF_CHECK: còn % chỗ đợt 1 chưa check-in chưa huỷ', v_left; end if;

  select count(*) into v_reopened from public.mentee_interview_invites
   where booking_open_until = '2026-10-09 17:00:00+07:00' and reopen_notified_at is null;
  select count(*) into v_new from public.application_decisions
   where decision_note like 'Mời phỏng vấn đợt 2 (10–11/10/2026)%';
  raise notice 'Đợt 2: 28 ca; mở lại chọn ca cho % người; % hồ sơ mới được mời phỏng vấn.', v_reopened, v_new;
end $$;

commit;
