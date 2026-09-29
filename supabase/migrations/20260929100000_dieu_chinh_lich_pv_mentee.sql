-- ═══════════════════════════════════════════════════════════════════════════
-- Điều chỉnh lịch phỏng vấn mentee 03–04/10/2026 theo đúng phòng ốc thật của
-- từng ngày — không còn đều nhau giữa thứ Bảy và Chủ nhật như migration
-- 20260926100000.
--
-- Chủ dự án chốt 29/09/2026:
--   - Ca vẫn 30 phút, nhưng khung giờ đổi: sáng 08:00–11:30 (7 ca), chiều
--     13:30–17:00 (7 ca) → 14 ca/ngày thay vì 12. Thêm buffer xử lý mentor
--     đến trễ, về sớm hoặc cần nghỉ giữa buổi.
--   - Thứ Bảy 03/10: chỉ có 3 phòng, dự kiến 6 mentor/phòng → tối đa 18
--     mentee/ca (mentor luân phiên theo ca, không ngồi suốt cả buổi).
--   - Chủ nhật 04/10: đủ 6 phòng, 5 mentor/phòng → sức chứa phòng là 30
--     mentee/ca, nhưng chốt 28 ghế/ca để chừa buffer thao tác.
--
-- Sức chứa mới: 03/10 14 ca × 18 ghế = 252, 04/10 14 ca × 28 ghế = 392
-- → 644 chỗ (migration cũ là 600 chỗ, đều 25 ghế cả hai ngày).
--
-- Xác nhận trên production trước khi viết migration này (29/09/2026): 0 lượt
-- đặt ca, 0 thư mời đã gửi — nên nới lại toàn bộ lưới ca an toàn, không ai
-- đang giữ một giờ hẹn sẽ bị đổi giờ dưới chân.
--
-- 12 mốc giờ cũ (08:00–10:30 sáng, 14:00–16:30 chiều) vẫn còn nguyên trong
-- danh sách bên dưới — chỉ THÊM 11:00 (sáng) và 13:30 (chiều). Không mốc nào
-- bị xoá, nên vẫn chỉ cần `on conflict ... do update`, không cần delete.
--
-- Phòng/bàn không còn đều 1–5 cho cả hai ngày. CHECK ở tầng bảng
-- (mentee_interview_operations) chỉ nới thành 1–6 — cận rộng nhất trong hai
-- ngày — vì CHECK không đọc được bảng khác để biết một ca là ngày nào. Cận
-- ĐÚNG theo từng ngày nằm ở một trigger mới (mục 4). Hàm
-- vam104_save_offline_interview cũng nới cận thô từ 5 lên 6 ở ĐÚNG MỘT dòng;
-- toàn bộ phần còn lại của hàm được trích nguyên văn từ migration
-- 20260927090000 bằng script, không gõ tay, để không lỡ sửa nhầm một RPC đã
-- chạy thật (CLAUDE.md: "Cái đến từ biểu mẫu là thứ người gửi tự đặt được —
-- hàm ghi phải tự kiểm lại", nên cận thô ở RPC và cận đúng ở trigger là hai
-- lớp, không phải một lớp thừa).
--
-- vam104_session_capacity_guard đang khoá cứng trần 25 ghế/ca cho mùa
-- UEHM-S12 (SESSION_MAX_25) — không nâng lên 30 thì chính câu insert bên
-- dưới bị chặn khi ghi 28 ghế cho ngày 04/10.
-- ═══════════════════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '10s';

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $dc1_prereq$
begin
  if to_regclass('public.interview_sessions') is null then
    raise exception 'PREREQ_MISSING: cần bảng interview_sessions';
  end if;
  if to_regclass('public.mentee_interview_operations') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_operations (dán migration 20260927090000 trước)';
  end if;
  if not exists (select 1 from public.seasons where code = 'UEHM-S12') then
    raise exception 'PREREQ_MISSING: không có mùa UEHM-S12';
  end if;
end;
$dc1_prereq$;

-- ------------------------------------------------------------
-- 1. Chặn cứng: KHÔNG định hình lại một ca đã có người giữ chỗ
-- ------------------------------------------------------------
do $dc1_no_bookings$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.mentee_interview_bookings b
  join public.interview_sessions s on s.id = b.session_id
  join public.seasons se on se.id = s.season_id
  where se.code = 'UEHM-S12' and b.status = 'booked';

  if v_count > 0 then
    raise exception 'DA_CO_NGUOI_DAT: % chỗ đã được giữ — không định hình lại ca. Dừng lại và hỏi trước.', v_count;
  end if;
end;
$dc1_no_bookings$;

-- ------------------------------------------------------------
-- 2. Nâng trần seat_limit của mùa UEHM-S12 từ 25 lên 30
-- ------------------------------------------------------------
-- Phải chạy TRƯỚC câu insert ở mục 3: câu insert ghi 28 ghế cho 04/10, và
-- trigger cũ (trần 25) sẽ chặn đúng câu đó nếu còn hiệu lực lúc insert chạy.
create or replace function public.vam104_session_capacity_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.seat_limit>30 and exists(select 1 from public.seasons where id=new.season_id and code='UEHM-S12')
    then raise exception 'SESSION_MAX_30'; end if;
  return new;
end;
$$;
revoke all on function public.vam104_session_capacity_guard() from public,anon,authenticated;
grant execute on function public.vam104_session_capacity_guard() to service_role;

-- ------------------------------------------------------------
-- 3. 14 ca/ngày, ghế theo đúng phòng của từng ngày
-- ------------------------------------------------------------
insert into public.interview_sessions (season_id, starts_at, ends_at, seat_limit, booking_closes_at, status)
select s.id,
       (d.ngay || ' ' || t.gio || '+07:00')::timestamptz,
       (d.ngay || ' ' || t.gio || '+07:00')::timestamptz + interval '30 minutes',
       case d.ngay when '2026-10-03' then 18 when '2026-10-04' then 28 end,
       '2026-09-30 23:59:59+07:00'::timestamptz,
       'open'
from public.seasons s
cross join (values ('2026-10-03'), ('2026-10-04')) as d(ngay)
cross join (values
  ('08:00:00'), ('08:30:00'), ('09:00:00'), ('09:30:00'), ('10:00:00'), ('10:30:00'), ('11:00:00'),
  ('13:30:00'), ('14:00:00'), ('14:30:00'), ('15:00:00'), ('15:30:00'), ('16:00:00'), ('16:30:00')
) as t(gio)
where s.code = 'UEHM-S12'
on conflict (season_id, starts_at) do update
  set ends_at           = excluded.ends_at,
      seat_limit        = excluded.seat_limit,
      booking_closes_at = excluded.booking_closes_at,
      status            = excluded.status,
      updated_at        = now();

-- ------------------------------------------------------------
-- 4. Nới cận phòng/bàn ở tầng bảng — 1–6, đủ cho ngày rộng nhất
-- ------------------------------------------------------------
alter table public.mentee_interview_operations drop constraint if exists mentee_interview_operations_room_check;
alter table public.mentee_interview_operations add constraint mentee_interview_operations_room_check check (room between 1 and 6);
alter table public.mentee_interview_operations drop constraint if exists mentee_interview_operations_desk_check;
alter table public.mentee_interview_operations add constraint mentee_interview_operations_desk_check check (desk between 1 and 6);

-- ------------------------------------------------------------
-- 5. Cận ĐÚNG theo từng ngày — trigger, vì CHECK không đọc được bảng khác
-- ------------------------------------------------------------
-- Thứ Bảy 03/10: 3 phòng × 6 bàn. Chủ nhật 04/10: 6 phòng × 5 bàn. Người vận
-- hành gõ "Phòng 5" cho một ca thứ Bảy (chỉ có 3 phòng) phải bị chặn TẠI ĐÂY,
-- không phải chỉ bị chặn bởi ô chọn đã lọc trên màn hình.
create or replace function public.vam104_room_desk_bounds_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_ngay date; v_max_room integer; v_max_desk integer;
begin
  if new.room is null then return new; end if;
  select (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date into v_ngay
    from public.interview_sessions s where s.id = new.session_id;
  v_max_room := case v_ngay when date '2026-10-03' then 3 when date '2026-10-04' then 6 else 0 end;
  v_max_desk := case v_ngay when date '2026-10-03' then 6 when date '2026-10-04' then 5 else 0 end;
  if new.room not between 1 and v_max_room or new.desk not between 1 and v_max_desk then
    raise exception 'ROOM_DESK_OUT_OF_RANGE: phòng % bàn % không hợp lệ cho ca ngày %', new.room, new.desk, v_ngay;
  end if;
  return new;
end;
$$;
drop trigger if exists vam104_room_desk_bounds on public.mentee_interview_operations;
create trigger vam104_room_desk_bounds before insert or update of room, desk, session_id on public.mentee_interview_operations
  for each row execute function public.vam104_room_desk_bounds_guard();
revoke all on function public.vam104_room_desk_bounds_guard() from public,anon,authenticated;
grant execute on function public.vam104_room_desk_bounds_guard() to service_role;

-- ------------------------------------------------------------
-- 6. vam104_save_offline_interview: nới cận thô 5 → 6, giữ nguyên mọi dòng khác
-- ------------------------------------------------------------
create or replace function public.vam104_save_offline_interview(
  p_actor uuid, p_application uuid, p_action text, p_revision integer, p_values jsonb default '{}'
) returns jsonb language plpgsql set search_path = '' as $$
declare
  a public.applications%rowtype; b public.mentee_interview_bookings%rowtype;
  o public.mentee_interview_operations%rowtype; v_before jsonb; v_review_before jsonb;
  v_operate boolean; v_reviewer uuid; v_person uuid; v_mentor uuid; v_profile uuid;
  v_count integer; v_status text; v_outcome text; v_reason text; v_scores integer[];
  v_name text; v_email text; v_program uuid; v_membership uuid; v_old_member_status text;
  v_match uuid; v_take boolean; v_room integer; v_desk integer;
begin
  if current_user <> 'service_role' then raise exception 'ACCESS_DENIED'; end if;
  select * into a from public.applications where id=p_application;
  if a.id is null or a.role_applied::text<>'mentee' or not public.vam104_offline_access(p_actor,a.season_id)
    then raise exception 'ACCESS_DENIED'; end if;
  -- Cùng khóa trước mọi bản ghi để luồng cũ và mới không tranh sức chứa.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || a.season_id::text,0));
  select * into a from public.applications where id=p_application for update;
  if a.status='withdrawn' then raise exception 'APPLICATION_WITHDRAWN'; end if;
  select * into b from public.mentee_interview_bookings where application_id=a.id and status='booked' for update;
  if b.id is null then raise exception 'NO_BOOKING'; end if;
  insert into public.mentee_interview_operations(id,session_id) values(a.id,b.session_id) on conflict(id) do nothing;
  select * into o from public.mentee_interview_operations where id=a.id for update;
  if o.revision is distinct from p_revision then raise exception 'STALE_REVISION'; end if;
  if o.session_id<>b.session_id and o.checked_in_at is not null then raise exception 'SESSION_CHANGED'; end if;
  v_before:=to_jsonb(o);
  v_operate:=public.vam104_offline_access(p_actor,a.season_id,true);
  v_reason:=nullif(btrim(p_values->>'reason'),'');
  perform set_config('vam.offline_application',a.id::text,true);
  select coalesce(full_name,email) into v_name from public.admin_users where id=p_actor;

  if p_action='checkin' then
    if not v_operate then raise exception 'ACCESS_DENIED'; end if;
    if o.checked_in_at is not null then return jsonb_build_object('ok',true,'message','Bạn này đã check-in.'); end if;
    update public.mentee_interview_operations set session_id=b.session_id,checked_in_at=now(),checked_in_by=p_actor where id=a.id;
  elsif p_action='assign' then
    if not v_operate then raise exception 'ACCESS_DENIED'; end if;
    if o.checked_in_at is null then raise exception 'CHECKIN_REQUIRED'; end if;
    if o.outcome is not null then raise exception 'ALREADY_SCORED'; end if;
    v_room:=(p_values->>'room')::integer; v_desk:=(p_values->>'desk')::integer;
    v_reviewer:=(p_values->>'interviewerId')::uuid;
    if v_room is null or v_room not between 1 and 6 or v_desk is null or v_desk not between 1 and 6
      or v_reviewer is null or not public.vam084_participant_for_stage(v_reviewer,a.season_id,'interview')
      then raise exception 'INVALID_ASSIGNMENT'; end if;
    if o.interviewer_id is not null and o.interviewer_id<>v_reviewer and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    -- Giữ phiếu nếu chỉ đổi bàn; nhận lại phiếu cũ chưa nộp để tránh trùng.
    if o.review_id is not null and o.interviewer_id=v_reviewer then
      v_profile:=o.review_id;
    else
    if o.review_id is not null then
      update public.application_reviews set status='cancelled',updated_at=now() where id=o.review_id;
    end if;
    select id into v_profile from public.application_reviews where application_id=a.id and review_round='interview'
      and reviewer_admin_user_id=v_reviewer and status<>'cancelled' for update;
    if v_profile is not null then
      if exists(select 1 from public.application_reviews where id=v_profile and status='submitted') then raise exception 'EXISTING_SUBMITTED_REVIEW'; end if;
      update public.application_reviews set offline_managed=true where id=v_profile;
    else
      insert into public.application_reviews(application_id,review_round,reviewer_admin_user_id,assigned_by,status,offline_managed)
        values(a.id,'interview',v_reviewer,p_actor,'assigned',true) returning id into v_profile;
    end if;
    end if;
    update public.mentee_interview_operations set room=v_room,desk=v_desk,interviewer_id=v_reviewer,review_id=v_profile where id=a.id;
  elsif p_action='result' then
    if o.interviewer_id is distinct from p_actor then raise exception 'NOT_ASSIGNED'; end if;
    if o.checked_in_at is null or o.review_id is null then raise exception 'CHECKIN_REQUIRED'; end if;
    v_outcome:=p_values->>'outcome';
    if v_outcome is null or v_outcome not in ('passed','rejected','needs_review') then raise exception 'INVALID_RESULT'; end if;
    if (o.outcome is not null or v_outcome<>'passed') and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    select array_agg(value::integer order by ord) into v_scores from jsonb_array_elements_text(p_values->'scores') with ordinality t(value,ord);
    if cardinality(v_scores) is distinct from 5 or exists(select 1 from unnest(v_scores) s where s is null or s not between 1 and 5)
      then raise exception 'INVALID_SCORES'; end if;
    v_take:=coalesce((p_values->>'takeMentee')::boolean,false);
    if v_take and v_outcome<>'passed' then raise exception 'INVALID_RESULT'; end if;
    select to_jsonb(r) into v_review_before from public.application_reviews r where r.id=o.review_id;
    update public.application_reviews set
      score_motivation=v_scores[1],score_goal_clarity=v_scores[2],score_commitment=v_scores[3],
      score_fit=v_scores[4],score_communication=v_scores[5],total_score=v_scores[1]+v_scores[2]+v_scores[3]+v_scores[4]+v_scores[5],
      recommendation=case v_outcome when 'passed' then 'approve_recommended' when 'rejected' then 'reject' else 'needs_admin_review' end,
      reviewer_note=nullif(btrim(p_values->>'note'),''),status='submitted',submitted_at=now(),updated_at=now()
      where id=o.review_id;

    v_person:=a.person_id;
    if v_outcome='passed' then
      v_email:=lower(btrim(a.email_primary));
      if nullif(v_email,'') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));
      if v_person is null then
        select count(*),(array_agg(id))[1] into v_count,v_person from public.people where lower(btrim(email_primary))=v_email;
        if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
        if v_count=0 then
          if nullif(btrim(a.full_name),'') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
          insert into public.people(full_name,email_primary,phone_primary,source_sheets)
            values(a.full_name,v_email,a.phone_primary,'s12_native_application') returning id into v_person;
        end if;
      elsif not exists(select 1 from public.people where id=v_person and lower(btrim(email_primary))=v_email) then
        raise exception 'IDENTITY_REQUIRES_BTC';
      end if;
      perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || v_person::text));
      select count(*) into v_count from public.mentee_profiles where person_id=v_person;
      if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      if v_count=0 then insert into public.mentee_profiles(person_id,source_application_id,intake_batch_id)
        values(v_person,a.id,a.intake_batch_id); end if;
      select program_id into v_program from public.seasons where id=a.season_id;
      select count(*),(array_agg(id))[1] into v_count,v_membership from public.person_season_memberships
        where person_id=v_person and season_id=a.season_id and role='mentee';
      if v_count>1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      if v_membership is null then
        insert into public.person_season_memberships(person_id,program_id,season_id,role,status,source,created_by)
          values(v_person,v_program,a.season_id,'mentee','active','manual',p_actor) returning id into v_membership;
        update public.mentee_interview_operations set membership_id=v_membership,owns_membership=true where id=a.id;
        insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
          values(v_membership,v_person,v_program,a.season_id,'mentee',null,'active','created','Đạt phỏng vấn trực tiếp',p_actor);
      else
        select status into v_old_member_status from public.person_season_memberships where id=v_membership for update;
        if v_old_member_status<>'active' then
          if not o.owns_membership or o.membership_id is distinct from v_membership then raise exception 'MEMBERSHIP_REQUIRES_BTC'; end if;
          update public.person_season_memberships set status='active',end_date=null,updated_at=now() where id=v_membership;
          insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
            values(v_membership,v_person,v_program,a.season_id,'mentee',v_old_member_status,'active','status_change',v_reason,p_actor);
        end if;
      end if;
    end if;

    -- Sửa nhầm chỉ được hủy match do CHÍNH lượt phỏng vấn này tạo.
    v_match:=o.match_id;
    if v_match is not null and (not v_take or v_outcome<>'passed') then
      if exists(select 1 from public.matches m join public.people p on p.id=m.mentor_person_id
        join public.admin_users u on u.id=p_actor where m.id=v_match and m.status='active'
        and (m.season_id<>a.season_id or m.mentee_person_id<>v_person or lower(btrim(p.email_primary)) is distinct from lower(btrim(u.email))))
        then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
      update public.matches set status='dropped',notes=coalesce(v_reason,'Sửa lựa chọn nhận mentee')
        where id=v_match and status='active';
      v_match:=null;
    end if;
    if v_outcome<>'passed' and v_person is not null then
      if exists(select 1 from public.matches where mentee_person_id=v_person and season_id=a.season_id and status='active')
        then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
      if o.owns_membership and o.membership_id is not null then
        select status,program_id into v_old_member_status,v_program from public.person_season_memberships where id=o.membership_id for update;
        update public.person_season_memberships set status='withdrawn',end_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date,updated_at=now() where id=o.membership_id;
        insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
          values(o.membership_id,v_person,v_program,a.season_id,'mentee',v_old_member_status,'withdrawn','status_change',v_reason,p_actor);
      elsif exists(select 1 from public.person_season_memberships where person_id=v_person and season_id=a.season_id and role='mentee' and status='active') then
        raise exception 'MEMBERSHIP_REQUIRES_BTC';
      end if;
    end if;
    if v_take then
      -- Cùng quy tắc nhận diện tài khoản interviewer hiện hành: email chuẩn,
      -- nhưng từ chối nhập nhằng, không lấy tùy tiện dòng đầu tiên.
      select count(*),(array_agg(p.id))[1] into v_count,v_mentor from public.people p join public.admin_users u
        on lower(btrim(u.email))=lower(btrim(p.email_primary)) where u.id=p_actor;
      if v_count<>1 or not exists(select 1 from public.applications where person_id=v_mentor and season_id=a.season_id and status='approved_as_mentor')
        then raise exception 'MENTOR_NOT_APPROVED'; end if;
      if v_match is not null and not exists(select 1 from public.matches where id=v_match and status='active' and mentor_person_id=v_mentor) then v_match:=null; end if;
      if v_match is null then
        insert into public.matches(season_id,mentor_person_id,mentee_person_id,status,match_source_raw,match_type,matched_at,notes)
          values(a.season_id,v_mentor,v_person,'active','manual','primary',(now() at time zone 'Asia/Ho_Chi_Minh')::date,'Mentor nhận tại buổi phỏng vấn') returning id into v_match;
      end if;
    end if;
    v_status:=case v_outcome when 'passed' then 'approved_as_mentee' when 'rejected' then 'rejected_or_not_fit' else 'needs_more_review' end;
    update public.applications set status=v_status,person_id=v_person where id=a.id;
    insert into public.application_decisions(application_id,decided_by,decided_by_name,decision,previous_status,new_status,decision_note)
      values(a.id,p_actor,v_name,v_status,a.status,v_status,coalesce(v_reason,nullif(btrim(p_values->>'note'),'')));
    update public.mentee_interview_operations set outcome=v_outcome,outcome_reason=v_reason,match_id=v_match where id=a.id;
  else raise exception 'INVALID_ACTION'; end if;

  update public.mentee_interview_operations set revision=revision+1,updated_at=now() where id=a.id returning * into o;
  insert into public.mentee_interview_operation_log(application_id,actor_id,action,reason,before_data,after_data)
    values(a.id,p_actor,p_action,v_reason,jsonb_build_object('operation',v_before,'review',v_review_before),
      jsonb_build_object('operation',to_jsonb(o),'values',p_values));
  perform set_config('vam.offline_application','',true);
  return jsonb_build_object('ok',true,'message','Đã lưu.','revision',o.revision);
end;
$$;
revoke all on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) to service_role;

-- ------------------------------------------------------------
-- 7. Tự kiểm
-- ------------------------------------------------------------
-- Migration báo thành công trong khi lưới ca hoặc cận phòng/bàn sai là thứ
-- chỉ lộ ra vào sáng 03/10, khi 18 bạn đứng trước 3 phòng chỉ có chỗ cho 12.
do $dc1_selfcheck$
declare
  v_total      integer;
  v_wrong_span integer;
  v_wrong_han  integer;
  v_day3       integer;
  v_day4       integer;
  v_other      integer;
  v_day3_seats integer;
  v_day4_seats integer;
  v_room_def   text;
  v_desk_def   text;
begin
  select count(*),
         count(*) filter (where ends_at - starts_at <> interval '30 minutes'),
         count(*) filter (where booking_closes_at <> '2026-09-30 23:59:59+07:00'::timestamptz),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-03'),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-04'),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date not in (date '2026-10-03', date '2026-10-04')),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-03' and seat_limit is distinct from 18),
         count(*) filter (where (starts_at at time zone 'Asia/Ho_Chi_Minh')::date = date '2026-10-04' and seat_limit is distinct from 28)
    into v_total, v_wrong_span, v_wrong_han, v_day3, v_day4, v_other, v_day3_seats, v_day4_seats
  from public.interview_sessions s
  join public.seasons se on se.id = s.season_id
  where se.code = 'UEHM-S12';

  if v_total <> 28 then
    raise exception 'SELFCHECK: cần đúng 28 ca, đang có %', v_total;
  end if;
  if v_wrong_span > 0 then
    raise exception 'SELFCHECK: % ca không dài đúng 30 phút', v_wrong_span;
  end if;
  if v_wrong_han > 0 then
    raise exception 'SELFCHECK: % ca có hạn đặt khác 30/09 23:59', v_wrong_han;
  end if;
  if v_day3 <> 14 or v_day4 <> 14 or v_other <> 0 then
    raise exception 'SELFCHECK: phải 14 ca mỗi ngày 03 và 04/10, đang là % / % / % ngày khác', v_day3, v_day4, v_other;
  end if;
  if v_day3_seats > 0 then
    raise exception 'SELFCHECK: % ca ngày 03/10 không có đúng 18 ghế', v_day3_seats;
  end if;
  if v_day4_seats > 0 then
    raise exception 'SELFCHECK: % ca ngày 04/10 không có đúng 28 ghế', v_day4_seats;
  end if;

  select pg_get_constraintdef(oid) into v_room_def from pg_constraint
    where conrelid = 'public.mentee_interview_operations'::regclass and conname = 'mentee_interview_operations_room_check';
  select pg_get_constraintdef(oid) into v_desk_def from pg_constraint
    where conrelid = 'public.mentee_interview_operations'::regclass and conname = 'mentee_interview_operations_desk_check';
  if v_room_def is distinct from 'CHECK (((room >= 1) AND (room <= 6)))' then
    raise exception 'SELFCHECK: room_check không đúng cận 1..6, đang là %', v_room_def;
  end if;
  if v_desk_def is distinct from 'CHECK (((desk >= 1) AND (desk <= 6)))' then
    raise exception 'SELFCHECK: desk_check không đúng cận 1..6, đang là %', v_desk_def;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'vam104_room_desk_bounds' and tgrelid = 'public.mentee_interview_operations'::regclass
  ) then
    raise exception 'SELFCHECK: thiếu trigger vam104_room_desk_bounds';
  end if;
end;
$dc1_selfcheck$;

commit;
