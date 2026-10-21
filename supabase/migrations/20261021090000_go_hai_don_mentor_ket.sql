-- BTC 21/10/2026 — gỡ hai đơn mentor đang kẹt ở interview_passed.
--
-- Chuyện đã xảy ra: 20/10/2026 17:42 UTC (21/10 00:42 giờ Việt Nam), hai đơn mentor bị
-- đánh "không phù hợp" ở vòng hồ sơ được đổi THẲNG sang interview_passed theo đề nghị của
-- team Tuyển Mentor (dấu DOI_TRANG_THAI_MENTOR_2026_10_21, chính dòng ghi chú đó đã nói
-- "chưa có phiếu phỏng vấn đã nộp trong hệ thống").
--
-- Vì sao trạng thái ấy là chỗ kẹt: màn hình đơn vẽ thẻ "Duyệt thành viên chính thức" khi
-- status = interview_passed, nhưng vam084_application_decision_eligibility đòi đủ số phiếu
-- phỏng vấn ĐÃ NỘP cho MỌI lối đi tiếp theo — duyệt, danh sách chờ, loại, lẫn "cần xem
-- thêm". Hai đơn này không có dòng phiếu phỏng vấn nào, nên không nút nào bấm được. Phân
-- công người phỏng vấn cũng không được: lib/application-review-assignability.ts chỉ cho gán
-- phiếu phỏng vấn ở invited_to_interview, interview_scheduled, interview_in_progress.
--
-- File này đưa hai đơn về invited_to_interview — "Mời phỏng vấn", đúng quyết định core team
-- vẫn bấm, và là trạng thái mở lại mọi cửa bình thường: đặt lịch (BOOKING_ELIGIBLE_STATUSES
-- trong lib/interview-schedule-core.ts), phân công người phỏng vấn, nộp phiếu, rồi "Qua vòng
-- phỏng vấn" và duyệt chính thức.
--
-- Cố ý KHÔNG đưa về rejected_or_not_fit (trạng thái trước lần đổi 21/10): team Tuyển Mentor
-- đã quyết định nhận lại hai người này, và từ "không phù hợp" thì màn hình cũng không còn
-- nút nào đi tiếp.
--
-- KHÔNG gửi thư. Thư mời phỏng vấn đi qua màn hình của BTC
-- (lib/interview-invite-notifications.ts), không qua file này.
--
-- CHẠY LẠI ĐƯỢC: lần hai thấy đã có dòng quyết định mang dấu MOI_PV_LAI_MENTOR_2026_10_21
-- thì bỏ qua người đó — kể cả khi lúc ấy BTC đã phỏng vấn và duyệt họ đàng hoàng.
--
-- TRƯỚC KHI CHẠY: điền c_actor_email bằng email tài khoản admin đang hoạt động của người
-- dán file. Tài khoản đó đứng tên dòng quyết định và dòng audit.
--
-- Chỉ là dữ liệu: không cần merge hay deploy.

begin;
set local lock_timeout = '10s';

do $go_don_ket$
declare
  c_marker      constant text := 'MOI_PV_LAI_MENTOR_2026_10_21';
  c_prev_marker constant text := 'DOI_TRANG_THAI_MENTOR_2026_10_21';
  c_target      constant text := 'invited_to_interview';
  c_season_code constant text := 'UEHM-S12';
  -- ĐIỀN TRƯỚC KHI CHẠY.
  c_actor_email constant text := 'REPLACE_ME@alumni-mentoring.edu.vn';
  c_names       constant text[] := array['Nguyễn Hoàng Tân', 'Trần Thanh Bạch'];
  -- Từ vựng audit là danh sách đóng và mỗi Production một khác; chọn giá trị đang được
  -- nhận thay vì đoán. Thứ tự ưu tiên = sát nghĩa nhất trước.
  c_action_candidates constant text[] := array[
    'update_application_status',
    'application_status_change',
    'application_decision',
    'cancel_membership'
  ];
  v_actor_id   uuid;
  v_actor_name text;
  v_season     uuid;
  v_def        text;
  v_action     text;
  v_candidate  text;
  v_name       text;
  v_app        public.applications%rowtype;
  v_last       public.application_decisions%rowtype;
  v_count      integer;
  v_done       integer := 0;
  v_skipped    integer := 0;
begin
  select au.id, coalesce(nullif(btrim(au.full_name), ''), au.email)
    into v_actor_id, v_actor_name
  from public.admin_users au
  where lower(au.email) = lower(c_actor_email) and au.status = 'active';
  if v_actor_id is null then
    raise exception 'PRECHECK: không thấy tài khoản admin đang hoạt động với email % — dừng, chưa ghi gì', c_actor_email;
  end if;

  select s.id into v_season from public.seasons s where s.code = c_season_code;
  if v_season is null then
    raise exception 'PRECHECK: không thấy mùa % — dừng, chưa ghi gì', c_season_code;
  end if;

  -- Một action_type lạ bị từ chối 23514 và làm hỏng cả giao dịch; chọn trước, ở đây,
  -- nơi câu báo lỗi còn đọc được.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'admin_audit_log'
    and c.conname = 'admin_audit_log_action_type_check';
  if v_def is null then
    v_action := c_action_candidates[1];
  else
    foreach v_candidate in array c_action_candidates loop
      if position(quote_literal(v_candidate) in v_def) > 0 then
        v_action := v_candidate;
        exit;
      end if;
    end loop;
  end if;
  if v_action is null then
    raise exception 'PRECHECK: từ vựng admin_audit_log không nhận giá trị nào trong % — dừng, chưa ghi gì', c_action_candidates;
  end if;

  foreach v_name in array c_names loop
    select count(*) into v_count
    from public.applications a
    where a.season_id = v_season
      and lower(coalesce(a.role_applied::text, '')) = 'mentor'
      and btrim(a.full_name) = v_name;
    if v_count <> 1 then
      raise exception 'PRECHECK: thấy % đơn mentor tên "%" trong mùa % (cần đúng 1) — dừng, chưa ghi gì',
        v_count, v_name, c_season_code;
    end if;

    select a.* into v_app
    from public.applications a
    where a.season_id = v_season
      and lower(coalesce(a.role_applied::text, '')) = 'mentor'
      and btrim(a.full_name) = v_name
    for update;

    -- Xét TRƯỚC mọi phép kiểm khác: sau lần gỡ, BTC có thể đã mời phỏng vấn, chấm, thậm
    -- chí duyệt — lần chạy lại không được kéo ngược việc đó.
    if exists (
      select 1 from public.application_decisions d
      where d.application_id = v_app.id
        and position(c_marker in coalesce(d.decision_note, '')) > 0
    ) then
      raise notice 'Đã gỡ "%" ở lần chạy trước — bỏ qua.', v_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_app.status is distinct from 'interview_passed' then
      raise exception 'PRECHECK: đơn của "%" đang ở "%", không phải interview_passed — dừng, chưa ghi gì',
        v_name, v_app.status;
    end if;

    -- Chỉ gỡ đúng đơn do lần đổi 21/10 đưa lên interview_passed. Đơn nào lên đó bằng đường
    -- bình thường (có phỏng vấn thật) thì không phải việc của file này.
    select d.* into v_last
    from public.application_decisions d
    where d.application_id = v_app.id
    order by d.created_at desc, d.id desc
    limit 1;
    if v_last.id is null
       or v_last.new_status is distinct from 'interview_passed'
       or position(c_prev_marker in coalesce(v_last.decision_note, '')) = 0 then
      raise exception 'PRECHECK: quyết định mới nhất của "%" không phải lần đổi % — dừng, chưa ghi gì',
        v_name, c_prev_marker;
    end if;

    -- Có phiếu phỏng vấn đã nộp nghĩa là đơn không còn kẹt; để nguyên cho BTC bấm duyệt.
    if exists (
      select 1 from public.application_reviews ar
      where ar.application_id = v_app.id
        and ar.review_round = 'interview'
        and ar.status = 'submitted'
    ) then
      raise exception 'PRECHECK: đơn của "%" đã có phiếu phỏng vấn đã nộp — không còn kẹt, dừng, chưa ghi gì', v_name;
    end if;

    -- Cùng khoá với trigger tạo cặp (vam104) và Vòng 2: không ai kịp ghép người này với
    -- một mentee trong lúc đang kiểm.
    perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || v_season::text, 0));
    if v_app.person_id is not null then
      if exists (
        select 1 from public.person_season_memberships m
        where m.person_id = v_app.person_id and m.season_id = v_season and m.role = 'mentor'
      ) then
        raise exception 'PRECHECK: "%" đã có tư cách mentor mùa này — dừng, chưa ghi gì', v_name;
      end if;
      if exists (
        select 1 from public.matches m
        where m.season_id = v_season and m.mentor_person_id = v_app.person_id
      ) then
        raise exception 'PRECHECK: "%" đã có cặp ghép trong mùa — dừng, chưa ghi gì', v_name;
      end if;
      if exists (
        select 1 from public.matching_round2_links l where l.mentor_person_id = v_app.person_id
      ) then
        raise exception 'PRECHECK: "%" đã có link chọn mentee Vòng 2 — dừng, chưa ghi gì', v_name;
      end if;
    end if;

    update public.applications
       set status = c_target
     where id = v_app.id and status = 'interview_passed';

    insert into public.application_decisions (
      application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note
    ) values (
      v_app.id, v_actor_id, v_actor_name, c_target, 'interview_passed', c_target,
      c_marker || ': đơn kẹt ở interview_passed khi chưa có phiếu phỏng vấn nào, nên mọi quyết định tiếp theo đều bị chặn. Đưa về "Mời phỏng vấn" để đặt lịch, phân công người phỏng vấn và nộp phiếu theo đường bình thường.'
    );

    insert into public.admin_audit_log (
      actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
    ) values (
      v_actor_id, null, v_action,
      jsonb_build_object('application_status', 'interview_passed'),
      jsonb_build_object('application_status', c_target),
      jsonb_build_object(
        'marker', c_marker,
        'application_id', v_app.id,
        'person_id', v_app.person_id,
        'season_id', v_season,
        'full_name', v_name,
        'reverted_decision_id', v_last.id,
        'reason', 'Gỡ đơn kẹt: interview_passed nhưng chưa có phiếu phỏng vấn đã nộp, không còn lối đi nào trên màn hình.'
      )
    );

    -- Tự kiểm trong cùng giao dịch: sai một điều là huỷ cả lượt.
    if (select a.status from public.applications a where a.id = v_app.id) is distinct from c_target then
      raise exception 'SELF_CHECK: đơn của "%" chưa về trạng thái %', v_name, c_target;
    end if;
    v_done := v_done + 1;
  end loop;

  raise notice 'Đã gỡ % đơn, bỏ qua % đơn. Dòng audit ghi bằng action_type "%".', v_done, v_skipped, v_action;
end $go_don_ket$;

commit;

-- Tình hình sau khi chạy (chỉ đọc). Mong đợi: trang_thai = invited_to_interview,
-- so_phieu_pv_da_nop = 0, dat_lich_duoc = true.
select
  a.full_name                                   as mentor,
  a.status                                      as trang_thai,
  (select count(*) from public.application_reviews ar
    where ar.application_id = a.id and ar.review_round = 'interview' and ar.status = 'submitted')
                                                as so_phieu_pv_da_nop,
  a.status in ('screening_passed', 'invited_to_interview', 'interview_scheduled')
                                                as dat_lich_duoc,
  to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') as kiem_tra_luc_vn
from public.applications a
join public.seasons s on s.id = a.season_id
where s.code = 'UEHM-S12'
  and lower(coalesce(a.role_applied::text, '')) = 'mentor'
  and btrim(a.full_name) in ('Nguyễn Hoàng Tân', 'Trần Thanh Bạch')
order by a.full_name;
