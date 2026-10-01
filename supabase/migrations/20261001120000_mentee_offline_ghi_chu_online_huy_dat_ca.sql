-- ═══════════════════════════════════════════════════════════════════════════
-- Phỏng vấn mentee trực tiếp — giai đoạn 2 (01/10/2026): ghi chú riêng từng
-- tiêu chí, đánh dấu phỏng vấn ONLINE, và cho Support/BTC huỷ một lượt đặt ca
-- (không qua đổi ca như vam102). Dán TRƯỚC khi merge code phụ thuộc.
--
-- VÌ SAO KHÔNG SỬA vam104_offline_dashboard: hàm đó build 'operation' và
-- 'reviews' bằng to_jsonb(rowtype) thẳng từ bảng (xem 20260927090000, dòng có
-- "v_before:=to_jsonb(o)" và dashboard query), không liệt kê tay từng cột —
-- cột mới ở dưới tự động xuất hiện trong JSON, khoá y hệt tên cột (snake_case).
--
-- VÌ SAO HUỶ BOOKING KHÔNG LẶP LẠI PHÉP KIỂM "CHƯA CHECK-IN": trigger
-- vam104_booking_guard (đã có từ 20260927090000, dòng 110-121) đã tự raise
-- ALREADY_CHECKED_IN khi đổi status/session của một dòng mentee_interview_
-- bookings đã check-in. vam105 bên dưới chỉ update status — để trigger đó
-- phân xử, một cửa cho một việc (CLAUDE.md).
--
-- VÌ SAO TÊN CỘT cancelled_by/cancel_note: interview_bookings (vòng mentor
-- 1:1, 20260922100000) đã dùng đúng ba cột cancelled_at/cancelled_by/
-- cancel_note cho đúng việc này — lặp lại tên để hai chỗ "huỷ có lý do" trong
-- cùng sản phẩm đọc giống nhau, không phải hai từ vựng khác nhau cho cùng một
-- khái niệm.
--
-- VÌ SAO vam104_save_offline_interview CHÉP NGUYÊN VĂN: thân hàm bên dưới lấy
-- đúng nguyên văn từ supabase/migrations/20260929100000_dieu_chinh_lich_pv_
-- mentee.sql (đã đọc trực tiếp, đối chiếu từng dòng trước khi viết migration
-- này) — CHỈ chèn thêm đúng phần đọc/ghi isOnline, onlineNote (nhánh assign)
-- và notes theo tiêu chí (nhánh result). Mọi dòng khác giữ y nguyên, không gõ
-- lại tay, tránh đúng rủi ro CLAUDE.md đã cảnh báo (sửa nhầm một RPC đang
-- chạy thật khi chép tay một hàm dài).
-- ═══════════════════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '10s';

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $mop2_prereq$
begin
  if to_regclass('public.mentee_interview_operations') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_operations — dán 20260927090000 trước';
  end if;
  if to_regclass('public.mentee_interview_bookings') is null then
    raise exception 'PREREQ_MISSING: cần bảng mentee_interview_bookings — dán 20260924190000 trước';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'vam104_save_offline_interview') then
    raise exception 'PREREQ_MISSING: cần vam104_save_offline_interview — dán 20260927090000 trước';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam104_room_desk_bounds') then
    raise exception 'PREREQ_MISSING: cần trigger vam104_room_desk_bounds — dán 20260929100000 trước (hàm bên dưới dựa trên cận 1..6)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vam104_booking_guard') then
    raise exception 'PREREQ_MISSING: cần trigger vam104_booking_guard — dán 20260927090000 trước';
  end if;
end;
$mop2_prereq$;

-- ------------------------------------------------------------
-- 1. Ghi chú riêng từng tiêu chí trên application_reviews
-- ------------------------------------------------------------
alter table public.application_reviews
  add column if not exists note_motivation text,
  add column if not exists note_goal_clarity text,
  add column if not exists note_commitment text,
  add column if not exists note_fit text,
  add column if not exists note_communication text;

-- ------------------------------------------------------------
-- 2. Cờ phỏng vấn ONLINE trên mentee_interview_operations
-- ------------------------------------------------------------
alter table public.mentee_interview_operations
  add column if not exists is_online boolean not null default false,
  add column if not exists online_note text;

-- ------------------------------------------------------------
-- 3. Cột huỷ có lý do trên mentee_interview_bookings
-- ------------------------------------------------------------
alter table public.mentee_interview_bookings
  add column if not exists cancelled_by uuid references public.admin_users(id),
  add column if not exists cancel_note text;

-- ------------------------------------------------------------
-- 4. vam104_save_offline_interview — thêm isOnline/onlineNote (assign) và
--    5 ghi chú theo tiêu chí (result). Phần còn lại nguyên văn từ 20260929100000.
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
  v_is_online boolean; v_online_note text; v_notes text[];
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
    -- Online là THÊM, không thay room/desk/interviewer: mentee online vẫn có
    -- bàn/mentor cố định, chỉ đổi cách gặp — không nới required ở ba ô cũ.
    v_is_online:=coalesce((p_values->>'isOnline')::boolean,false);
    v_online_note:=nullif(btrim(p_values->>'onlineNote'),'');
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
    update public.mentee_interview_operations
      set room=v_room,desk=v_desk,interviewer_id=v_reviewer,review_id=v_profile,is_online=v_is_online,online_note=v_online_note
      where id=a.id;
  elsif p_action='result' then
    if o.interviewer_id is distinct from p_actor then raise exception 'NOT_ASSIGNED'; end if;
    if o.checked_in_at is null or o.review_id is null then raise exception 'CHECKIN_REQUIRED'; end if;
    v_outcome:=p_values->>'outcome';
    if v_outcome is null or v_outcome not in ('passed','rejected','needs_review') then raise exception 'INVALID_RESULT'; end if;
    if (o.outcome is not null or v_outcome<>'passed') and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    select array_agg(value::integer order by ord) into v_scores from jsonb_array_elements_text(p_values->'scores') with ordinality t(value,ord);
    if cardinality(v_scores) is distinct from 5 or exists(select 1 from unnest(v_scores) s where s is null or s not between 1 and 5)
      then raise exception 'INVALID_SCORES'; end if;
    -- Một ô ghi chú riêng cho MỖI tiêu chí, cùng thứ tự scores (OFFLINE_SCORES
    -- ở TypeScript) — sai số lượng bị chặn, không âm thầm bỏ ô nào.
    select array_agg(value order by ord) into v_notes from jsonb_array_elements_text(coalesce(p_values->'notes','[]'::jsonb)) with ordinality t(value,ord);
    if cardinality(v_notes) is distinct from 5 then raise exception 'INVALID_NOTES'; end if;
    v_take:=coalesce((p_values->>'takeMentee')::boolean,false);
    if v_take and v_outcome<>'passed' then raise exception 'INVALID_RESULT'; end if;
    select to_jsonb(r) into v_review_before from public.application_reviews r where r.id=o.review_id;
    update public.application_reviews set
      score_motivation=v_scores[1],score_goal_clarity=v_scores[2],score_commitment=v_scores[3],
      score_fit=v_scores[4],score_communication=v_scores[5],total_score=v_scores[1]+v_scores[2]+v_scores[3]+v_scores[4]+v_scores[5],
      note_motivation=nullif(btrim(v_notes[1]),''),note_goal_clarity=nullif(btrim(v_notes[2]),''),note_commitment=nullif(btrim(v_notes[3]),''),
      note_fit=nullif(btrim(v_notes[4]),''),note_communication=nullif(btrim(v_notes[5]),''),
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
-- 5. vam105_cancel_mentee_booking — huỷ MỘT lượt đặt ca (không rebook)
-- ------------------------------------------------------------
create or replace function public.vam105_cancel_mentee_booking(
  p_actor uuid, p_application uuid, p_reason text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  a public.applications%rowtype;
  b public.mentee_interview_bookings%rowtype;
  v_reason text;
begin
  if current_user <> 'service_role' then raise exception 'ACCESS_DENIED'; end if;
  select * into a from public.applications where id=p_application for update;
  if a.id is null or a.role_applied::text<>'mentee' or not public.vam104_offline_access(p_actor,a.season_id,true)
    then raise exception 'ACCESS_DENIED'; end if;
  v_reason:=nullif(btrim(p_reason),'');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select * into b from public.mentee_interview_bookings where application_id=a.id and status='booked' for update;
  if b.id is null then raise exception 'NO_BOOKING'; end if;
  -- vam104_booking_guard (trigger có sẵn trên chính bảng này) tự raise
  -- ALREADY_CHECKED_IN nếu mentee đã check-in — không lặp lại phép kiểm đó ở đây.
  update public.mentee_interview_bookings
    set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancel_note=v_reason
    where id=b.id;
  insert into public.mentee_interview_operation_log(application_id,actor_id,action,reason,before_data,after_data)
    values(a.id,p_actor,'cancel_booking',v_reason,
      jsonb_build_object('booking',to_jsonb(b)),
      jsonb_build_object('booking',jsonb_build_object('id',b.id,'status','cancelled','cancelled_by',p_actor)));
  return jsonb_build_object('ok',true,'message','Đã huỷ lịch đăng ký của '||coalesce(a.full_name,'ứng viên')||' — chỗ đã mở lại.');
end;
$$;
revoke all on function public.vam105_cancel_mentee_booking(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.vam105_cancel_mentee_booking(uuid,uuid,text) to service_role;

-- ------------------------------------------------------------
-- 6. Tự kiểm
-- ------------------------------------------------------------
do $mop2_selfcheck$
declare
  v_col text;
  v_fn text;
begin
  foreach v_col in array array[
    'application_reviews.note_motivation','application_reviews.note_goal_clarity','application_reviews.note_commitment',
    'application_reviews.note_fit','application_reviews.note_communication',
    'mentee_interview_operations.is_online','mentee_interview_operations.online_note',
    'mentee_interview_bookings.cancelled_by','mentee_interview_bookings.cancel_note'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=split_part(v_col,'.',1) and column_name=split_part(v_col,'.',2)
    ) then
      raise exception 'SELF_CHECK column: %', v_col;
    end if;
  end loop;

  if to_regprocedure('public.vam105_cancel_mentee_booking(uuid,uuid,text)') is null
    or has_function_privilege('anon','public.vam105_cancel_mentee_booking(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.vam105_cancel_mentee_booking(uuid,uuid,text)','EXECUTE')
    then raise exception 'SELF_CHECK RPC vam105'; end if;

  select prosrc into v_fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='vam104_save_offline_interview';
  if v_fn is null or position('isOnline' in v_fn)=0 or position('onlineNote' in v_fn)=0
    or position('INVALID_NOTES' in v_fn)=0 or position('note_motivation=nullif' in v_fn)=0
    then raise exception 'SELF_CHECK vam104_save_offline_interview missing online/notes logic'; end if;
  if has_function_privilege('anon','public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)','EXECUTE')
    then raise exception 'SELF_CHECK vam104 ACL'; end if;
end;
$mop2_selfcheck$;

commit;
