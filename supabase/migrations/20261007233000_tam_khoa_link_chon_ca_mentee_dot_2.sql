-- =============================================================================
-- TẠM KHOÁ link chọn ca của các mentee đợt 2 khớp tiêu chí rớt vòng hồ sơ
-- (BTC 07/10/2026, anh Hoàng)
-- =============================================================================
-- Tiêu chí rớt vòng hồ sơ BTC chốt 07/10: reviewer đề xuất reject → rớt; đề xuất
-- khác mà điểm CV dưới 13 → rớt. Luật mời đợt 2 cùng ngày (20261007100000) lại là
-- "pass_to_interview HOẶC điểm ≥ 13", nên một số bạn bị đề xuất reject (điểm ≥ 13)
-- đã nhận thư mời chọn ca sáng 07/10.
--
-- File này khoá link của những bạn ĐÃ NHẬN thư mời nhưng CHƯA chọn ca (15 bạn lúc
-- soạn), trong khi BTC quyết giữ lời mời hay gửi thư rớt. Bạn nào đã chọn ca thì
-- KHÔNG đụng tới.
--
-- Cách khoá: trạng thái hồ sơ invited_to_interview → screening_completed (đúng
-- trạng thái trước khi được mời). Trang /dat-ca và RPC đặt ca chỉ nhận
-- screening_passed / invited_to_interview / interview_scheduled, nên:
--   - mở link: thấy "Hồ sơ của bạn hiện không ở bước đặt ca phỏng vấn…";
--   - bấm đặt ca (tab mở sẵn): bị từ chối application_not_eligible.
-- Link, token, thư đã gửi giữ nguyên — mở lại chỉ cần trả trạng thái về
-- invited_to_interview (tìm theo decision_note bên dưới).
--
-- Chống tranh chấp: một bạn đặt ca đúng lúc file chạy thì RPC đặt ca đã đổi trạng
-- thái sang interview_scheduled; UPDATE dưới đây kiểm lại status trên dòng đã khoá
-- nên bỏ qua bạn đó — người đã giữ chỗ không bao giờ bị khoá.
--
-- Chạy lại: không còn ai ở invited_to_interview khớp tiêu chí → 0 dòng, không ghi
-- thêm nhật ký.
-- =============================================================================

with target as (
  select a.id
  from public.applications a
  join public.application_reviews r
    on r.application_id = a.id
   and r.review_round = 'profile_screening'
   and r.status = 'submitted'
  where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and a.role_applied = 'mentee'
    and a.status = 'invited_to_interview'
    and (r.recommendation = 'reject' or r.total_score < 13)
    and a.created_at >= '2026-09-27 00:00+07'
    and exists (
      select 1 from public.mentee_interview_invites i
      where i.application_id = a.id and i.first_sent_at is not null
    )
    and not exists (
      select 1 from public.mentee_interview_bookings b
      where b.application_id = a.id and b.status = 'booked'
    )
),
paused as (
  update public.applications a
     set status = 'screening_completed',
         updated_at = now()
    from target t
   where a.id = t.id
     and a.status = 'invited_to_interview'
  returning a.id, a.full_name
),
logged as (
  insert into public.application_decisions
    (application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note)
  select p.id, u.id, u.full_name, 'screening_completed', 'invited_to_interview', 'screening_completed',
         'TẠM KHOÁ LINK CHỌN CA (BTC 07/10/2026): reviewer đề xuất reject hoặc điểm CV dưới 13 nhưng đã được mời phỏng vấn đợt 2. Chờ BTC quyết giữ lời mời hay gửi thư rớt vòng hồ sơ.'
  from paused p
  cross join (
    select id, full_name from public.admin_users
    where id = 'a3f45586-8747-49d9-860a-4b903cfdc7bc'
  ) u
  returning application_id
)
select
  (select count(*) from paused) as so_ban_da_khoa,
  (select count(*) from logged) as so_dong_nhat_ky,
  (select string_agg(full_name, ', ' order by full_name) from paused) as danh_sach;

-- Tự kiểm: không còn ai khớp tiêu chí mà vẫn mở được link; mỗi bạn bị khoá có
-- đúng một dòng nhật ký.
do $$
declare
  v_open int;
  v_paused int;
  v_logged int;
begin
  select count(*) into v_open
  from public.applications a
  join public.application_reviews r
    on r.application_id = a.id and r.review_round = 'profile_screening' and r.status = 'submitted'
  where a.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
    and a.role_applied = 'mentee'
    and a.status = 'invited_to_interview'
    and (r.recommendation = 'reject' or r.total_score < 13)
    and a.created_at >= '2026-09-27 00:00+07'
    and exists (select 1 from public.mentee_interview_invites i where i.application_id = a.id and i.first_sent_at is not null)
    and not exists (select 1 from public.mentee_interview_bookings b where b.application_id = a.id and b.status = 'booked');
  if v_open > 0 then
    raise exception 'Còn % bạn khớp tiêu chí chưa bị khoá link', v_open;
  end if;

  select count(*) into v_paused
  from public.applications a
  where a.status = 'screening_completed'
    and exists (
      select 1 from public.application_decisions d
      where d.application_id = a.id
        and d.decision_note like 'TẠM KHOÁ LINK CHỌN CA (BTC 07/10/2026)%'
    );
  select count(distinct application_id), count(*) - count(distinct application_id)
    into v_logged, v_open
  from public.application_decisions
  where decision_note like 'TẠM KHOÁ LINK CHỌN CA (BTC 07/10/2026)%';
  if v_open > 0 then
    raise exception 'Nhật ký tạm khoá bị ghi trùng % dòng', v_open;
  end if;
  raise notice 'Đang tạm khoá % bạn (nhật ký % bạn).', v_paused, v_logged;
end
$$;
