-- BTC 10/10/2026 — Mentor Orientation tối 09/10/2026: GHI BÙ tham dự cho người được
-- duyệt làm mentor SAU buổi.
--
-- Vì sao cần: 64 người đã check-in, nhưng chỉ 6 người là mentor chính thức lúc đó. 49
-- người khác khớp email với đơn mentor mùa 12 CHƯA duyệt (43 người đang chờ BTC chốt).
-- Bảng tham dự (event_participations) gắn theo hồ sơ người, mà đơn mentor chưa duyệt thì
-- chưa có hồ sơ người — nên chưa ghi được cho họ. Lượt check-in của họ không mất: vẫn nằm
-- ở danh sách đăng ký của Event.
--
-- File này CHẠY LẠI ĐƯỢC. Mỗi lần BTC duyệt thêm một đợt mentor, dán lại cả file:
--   * đăng ký đã check-in + email khớp ĐÚNG MỘT người có đơn mentor S12 đã duyệt
--     → nối đăng ký với hồ sơ người, ghi "attended" ngày 09/10/2026;
--   * người chưa duyệt, người đã ghi rồi: không bị chạm.
-- Chạy khi chưa duyệt thêm ai: không ghi gì, chỉ in bảng tình hình.
--
-- Cố ý KHÔNG tự ghi cho người chỉ trùng số điện thoại (email khác với đơn): trùng SĐT
-- chưa đủ chắc là cùng một người. BTC xác minh xong thì thêm đích danh, đừng nới luật khớp.
--
-- Chỉ là dữ liệu: không cần merge hay deploy.

begin;
set local lock_timeout = '10s';

do $precheck$
begin
  if not exists (
    select 1 from public.events e
    where e.id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
      and e.event_name = 'Mentor Orientation'
      and e.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::uuid
      and (e.starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-09'
  ) then
    raise exception 'PRECHECK: không đúng sự kiện Mentor Orientation 09/10/2026 của S12 — dừng, chưa ghi gì';
  end if;
end $precheck$;

-- Một câu lệnh, không bảng tạm: chạy lại một nửa file cũng không để lại trạng thái dở.
with eligible as (
  select r.id as registration_id, coalesce(r.is_walk_in, false) as walk_in, m.person_ids[1] as person_id
  from public.event_registrations r
  cross join lateral (
    select array_agg(distinct a.person_id) as person_ids
    from public.applications a
    where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::uuid
      and a.role_applied = 'mentor'
      and a.status = 'approved_as_mentor'
      and a.person_id is not null
      and lower(btrim(a.email_primary)) = lower(btrim(r.email))
  ) m
  where r.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
    and r.attendance_status = 'checked_in'
    and r.registration_status <> 'cancelled'
    and r.linked_person_id is null
    and nullif(btrim(r.email), '') is not null
    -- Một email dẫn tới hai hồ sơ người khác nhau thì không đoán: để BTC xem.
    and cardinality(m.person_ids) = 1
),
linked as (
  update public.event_registrations r
  set linked_person_id = e.person_id,
      match_method = 'exact_email',
      match_review_status = 'auto_linked',
      matched_at = now()
  from eligible e
  where r.id = e.registration_id and r.linked_person_id is null
  returning r.id
),
persons as (
  select person_id, bool_or(walk_in) as walk_in from eligible group by person_id
),
updated as (
  -- Đã có dòng tham dự (BTC thêm tay trước đó) thì sửa dòng đó, không thêm dòng thứ hai:
  -- bảng này không có ràng buộc duy nhất (sự kiện, người).
  update public.event_participations ep
  set attendance_status = 'attended', attendance_date = date '2026-10-09'
  from persons p
  where ep.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
    and ep.person_id = p.person_id
    and ep.attendance_status is distinct from 'attended'
  returning ep.id
),
inserted as (
  insert into public.event_participations
    (event_id, season_id, person_id, role_at_event, registration_status, attendance_status, attendance_date, captured_by, walk_in)
  select 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid, '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::uuid,
         p.person_id, 'mentor', 'registered', 'attended', date '2026-10-09', 'self_qr', p.walk_in
  from persons p
  where not exists (
    select 1 from public.event_participations ep
    where ep.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid and ep.person_id = p.person_id
  )
  returning id
)
select (select count(*) from linked) as dang_ky_vua_noi,
       (select count(*) from updated) as dong_tham_du_vua_sua,
       (select count(*) from inserted) as dong_tham_du_vua_them;

do $self_check$
declare
  v_left integer;
  v_missing integer;
  v_duplicate integer;
begin
  -- 1. Không còn ai đủ điều kiện mà chưa được nối.
  select count(*) into v_left
  from public.event_registrations r
  where r.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
    and r.attendance_status = 'checked_in' and r.registration_status <> 'cancelled'
    and r.linked_person_id is null and nullif(btrim(r.email), '') is not null
    and (select count(distinct a.person_id) from public.applications a
         where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::uuid and a.role_applied = 'mentor'
           and a.status = 'approved_as_mentor' and a.person_id is not null
           and lower(btrim(a.email_primary)) = lower(btrim(r.email))) = 1;
  if v_left > 0 then
    raise exception 'SELF_CHECK: còn % đăng ký đủ điều kiện chưa được nối', v_left;
  end if;

  -- 2. Ai đã check-in và đã nối hồ sơ đều có dòng tham dự "attended".
  select count(*) into v_missing
  from public.event_registrations r
  where r.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
    and r.attendance_status = 'checked_in' and r.registration_status <> 'cancelled'
    and r.linked_person_id is not null
    and not exists (
      select 1 from public.event_participations ep
      where ep.event_id = r.event_id and ep.person_id = r.linked_person_id and ep.attendance_status = 'attended'
    );
  if v_missing > 0 then
    raise exception 'SELF_CHECK: % người đã check-in và đã nối hồ sơ nhưng chưa có dòng tham dự', v_missing;
  end if;

  -- 3. Không ai có hai dòng tham dự cho buổi này.
  select count(*) into v_duplicate from (
    select ep.person_id from public.event_participations ep
    where ep.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid and ep.person_id is not null
    group by ep.person_id having count(*) > 1
  ) d;
  if v_duplicate > 0 then
    raise exception 'SELF_CHECK: % người có hơn một dòng tham dự cho buổi này', v_duplicate;
  end if;
end $self_check$;

commit;

-- Bảng tình hình sau khi chạy (chỉ đọc). "con_cho_duyet" là những người sẽ được ghi ở
-- lần chạy sau, khi BTC duyệt họ.
with reg as (
  select r.id, r.full_name, r.linked_person_id,
         lower(btrim(r.email)) as email,
         right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 9) as phone9
  from public.event_registrations r
  where r.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
    and r.attendance_status = 'checked_in' and r.registration_status <> 'cancelled'
),
apps as (
  select a.status, lower(btrim(a.email_primary)) as email,
         right(regexp_replace(coalesce(a.phone_primary, ''), '\D', '', 'g'), 9) as phone9
  from public.applications a
  where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::uuid and a.role_applied = 'mentor'
),
sorted as (
  select r.*,
    exists (select 1 from apps a where a.email = r.email) as don_theo_email,
    exists (select 1 from apps a where length(r.phone9) = 9 and a.phone9 = r.phone9) as don_theo_sdt,
    exists (select 1 from public.event_participations ep
            where ep.event_id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
              and ep.person_id = r.linked_person_id and ep.attendance_status = 'attended') as da_ghi
  from reg r
)
select
  count(*) as tong_check_in,
  count(*) filter (where da_ghi) as da_ghi_nhan_tham_du,
  count(*) filter (where not da_ghi and don_theo_email) as con_cho_duyet,
  count(*) filter (where not da_ghi and not don_theo_email and don_theo_sdt) as chi_trung_sdt_can_xac_minh,
  count(*) filter (where not da_ghi and not don_theo_email and not don_theo_sdt) as khong_khop,
  string_agg(full_name, ', ' order by full_name) filter (where not da_ghi and don_theo_email) as ten_nguoi_con_cho_duyet,
  to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') as kiem_tra_luc_vn
from sorted;
