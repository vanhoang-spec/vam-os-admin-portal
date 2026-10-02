-- ============================================================
-- 20261002150000_mentee_phieu_cham_bat_buoc_ghi_chu.sql
-- ============================================================
--
-- "Điều chỉnh mục Phỏng vấn Mentee trực tiếp.docx" (BTC, 02/10/2026), áp dụng
-- cho mọi đợt phỏng vấn mentee:
--
-- 1. vam104_save_offline_interview — sinh bằng script từ 20261002100000 (nguyên
--    văn, chỉ thay đúng các mỏ neo):
--    - Evidence / Note của MỌI tiêu chí bắt buộc       → CRITERION_NOTE_REQUIRED
--    - Concern / Note (mục B) bắt buộc                  → ALIGNMENT_NOTE_REQUIRED
--    - "Không chọn làm mentee" khoá mục C: không nhận lựa chọn nhận, không cần
--      chân dung Mentor                                 → INVALID_TAKE_CHOICE
--    - Mỗi mentor chọn "Có – Tôi muốn nhận bạn này" cho tối đa 2 hồ sơ/mùa
--                                                       → TAKE_LIMIT_REACHED
--    Phiếu đã nộp trước migration này giữ nguyên.
--
-- 2. Phiếu S12 phiên bản 2: câu chữ thuần Việt (câu hỏi cốt lõi, mô tả 1/3/5,
--    lưu ý điểm số). Tên tiêu chí, trọng số, câu hỏi gợi ý không đổi. CHỈ ghi khi
--    phiếu S12 vẫn là phiên bản 1 — BTC đã sửa trên màn hình thì không đè, chỉ
--    báo NOTICE. Bản TS cùng nội dung: lib/mentee-interview-rubric-s12.ts.
--    Form mentor đang mở sẽ báo "BTC vừa sửa phiếu" và phải tải lại (RUBRIC_CHANGED).
--
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge PR.

begin;

do $$
begin
  if to_regclass('public.mentee_interview_rubrics') is null
    or not exists (select 1 from pg_proc where proname = 'vam106_effective_rubric')
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'application_reviews' and column_name = 'take_choice') then
    raise exception 'Cần chạy 20261002100000_mentee_phong_van_theo_mua.sql trước';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. vam104_save_offline_interview — sinh bằng script từ 20261002100000
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
  v_is_online boolean; v_online_note text;
  v_rubric public.mentee_interview_rubrics%rowtype; v_snapshot jsonb; v_weighted numeric;
  v_rationale text; v_key_need text; v_alignment text; v_take_choice text; v_desired text;
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
    -- Kết quả lần đầu đã có ô "Lý do chọn/không chọn" bắt buộc riêng; lý do
    -- SỬA chỉ còn bắt buộc khi đổi một kết quả đã chốt.
    if o.outcome is not null and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
    -- Phiếu chấm của mùa: dòng riêng của mùa, không có thì phiếu lưu gần nhất.
    -- Form đang mở gửi kèm id + phiên bản phiếu; BTC sửa phiếu giữa chừng thì
    -- từ chối thay vì ghi điểm theo bộ tiêu chí mentor không nhìn thấy.
    v_rubric:=public.vam106_effective_rubric(a.season_id);
    if v_rubric.id is null then raise exception 'RUBRIC_MISSING'; end if;
    if (p_values->>'rubricId') is distinct from v_rubric.id::text
      or (p_values->>'rubricVersion') is distinct from v_rubric.version::text
      then raise exception 'RUBRIC_CHANGED'; end if;
    if jsonb_typeof(p_values->'criteria') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_values->'criteria') k
                where k not in (select c->>'key' from jsonb_array_elements(v_rubric.criteria) c))
      or exists(select 1 from jsonb_array_elements(v_rubric.criteria) c
                where coalesce(p_values->'criteria'->(c->>'key')->>'score','') !~ '^[1-5]$')
      then raise exception 'INVALID_SCORES'; end if;
    if exists(select 1 from jsonb_array_elements(v_rubric.criteria) c
              where length(coalesce(p_values->'criteria'->(c->>'key')->>'note',''))>2000)
      then raise exception 'TEXT_TOO_LONG'; end if;
    -- Ô Evidence / Note của MỌI tiêu chí bắt buộc (BTC 02/10/2026): điểm không kèm
    -- bằng chứng thì BTC đọc lại không biết vì sao ra con số đó.
    if exists(select 1 from jsonb_array_elements(v_rubric.criteria) c
              where nullif(btrim(coalesce(p_values->'criteria'->(c->>'key')->>'note','')),'') is null)
      then raise exception 'CRITERION_NOTE_REQUIRED'; end if;
    select jsonb_agg(jsonb_build_object(
             'key',c->>'key','label',c->>'label','weight',(c->>'weight')::integer,
             'score',(p_values->'criteria'->(c->>'key')->>'score')::integer,
             'note',nullif(btrim(p_values->'criteria'->(c->>'key')->>'note'),'')) order by ord)
      into v_snapshot from jsonb_array_elements(v_rubric.criteria) with ordinality t(c,ord);
    -- Điểm quy đổi (thang 1–5) chỉ để BTC tham khảo — phiếu ghi rõ không cộng
    -- tổng và không có điểm sàn; không dùng để tự quyết Đạt/Không chọn.
    select round(sum((x->>'score')::numeric*(x->>'weight')::numeric)/sum((x->>'weight')::numeric),2)
      into v_weighted from jsonb_array_elements(v_snapshot) x;
    v_rationale:=nullif(btrim(p_values->>'rationale'),'');
    v_key_need:=nullif(btrim(p_values->>'keyNeed'),'');
    v_alignment:=p_values->>'alignment';
    v_take_choice:=nullif(btrim(p_values->>'takeChoice'),'');
    v_desired:=nullif(btrim(p_values->>'desiredMentor'),'');
    if v_rationale is null then raise exception 'RATIONALE_REQUIRED'; end if;
    if v_key_need is null then raise exception 'KEY_NEED_REQUIRED'; end if;
    if v_alignment is null or v_alignment not in ('aligned','needs_clarification','concern') then raise exception 'INVALID_ALIGNMENT'; end if;
    if nullif(btrim(p_values->>'alignmentNote'),'') is null then raise exception 'ALIGNMENT_NOTE_REQUIRED'; end if;
    -- "Không chọn làm mentee" khoá cả mục C (BTC 02/10/2026): không có lựa chọn nhận,
    -- không cần chân dung Mentor. Kết quả khác thì mục C vẫn bắt buộc như cũ.
    if v_outcome='rejected' then
      if v_take_choice is not null then raise exception 'INVALID_TAKE_CHOICE'; end if;
    else
      if v_take_choice is null or v_take_choice not in ('take','recommend_other','undecided') then raise exception 'INVALID_TAKE_CHOICE'; end if;
      if v_desired is null then raise exception 'DESIRED_MENTOR_REQUIRED'; end if;
    end if;
    if length(v_rationale)>4000 or length(v_key_need)>2000 or length(v_desired)>2000
      or length(coalesce(p_values->>'alignmentNote',''))>2000 or length(coalesce(p_values->>'additionalNote',''))>4000
      then raise exception 'TEXT_TOO_LONG'; end if;
    -- Từ đây xuống, v_reason là lý do của quyết định (lý do sửa nếu có, không
    -- thì lý do chọn/không chọn) — các chỗ ghi lịch sử bên dưới giữ nguyên văn.
    v_reason:=coalesce(v_reason,v_rationale);
    v_take:=coalesce(v_take_choice='take',false);
    if v_take and v_outcome<>'passed' then raise exception 'INVALID_RESULT'; end if;
    -- Mỗi mentor chọn "Có – Tôi muốn nhận bạn này" cho tối đa 2 hồ sơ trong mùa (BTC
    -- 02/10/2026; cùng con số MAX_TAKES_PER_INTERVIEWER phía giao diện). Đếm phiếu ĐÃ
    -- NỘP của chính mentor này ở hồ sơ khác; khoá VAM104_MATCH theo mùa ở đầu hàm làm
    -- hai lần lưu cùng lúc không cùng lọt qua phép đếm.
    if v_take and (select count(*) from public.application_reviews r join public.applications x on x.id=r.application_id
        where r.reviewer_admin_user_id=p_actor and r.review_round='interview' and r.status='submitted'
          and r.take_choice='take' and x.season_id=a.season_id and r.application_id<>a.id) >= 2
      then raise exception 'TAKE_LIMIT_REACHED'; end if;
    select to_jsonb(r) into v_review_before from public.application_reviews r where r.id=o.review_id;
    update public.application_reviews set
      score_motivation=null,score_goal_clarity=null,score_commitment=null,score_fit=null,score_communication=null,total_score=null,
      interview_scores=v_snapshot,rubric_version=v_rubric.version,weighted_score=v_weighted,
      key_development_need=v_key_need,expectation_alignment=v_alignment,alignment_note=nullif(btrim(p_values->>'alignmentNote'),''),
      take_choice=v_take_choice,desired_mentor_profile=v_desired,additional_note=nullif(btrim(p_values->>'additionalNote'),''),
      recommendation=case v_outcome when 'passed' then 'approve_recommended' when 'rejected' then 'reject' else 'needs_admin_review' end,
      reviewer_note=v_rationale,status='submitted',submitted_at=now(),updated_at=now()
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
-- 2. Phiếu S12 phiên bản 2
-- ------------------------------------------------------------
do $$
declare
  v_criteria jsonb := $s12v2_criteria$[{"key":"need","label":"Nhu cầu Mentoring & Giá trị phát triển","label_en":"Development Need & Mentoring Value","weight":30,"question":"Mentoring có thể tạo ra giá trị thực sự cho bạn này không?","descriptors":{"1":"Chưa thấy nhu cầu mentoring rõ; tham gia chủ yếu vì networking/CV/cơ hội chung.","3":"Có nhu cầu thật nhưng còn chung chung; cần tìm hiểu thêm để làm rõ.","5":"Có nhu cầu phát triển thật sự; nhận thức được bản thân đang cần khám phá và phát triển ở lĩnh vực nào; thấy rõ mentoring có thể mang lại giá trị cho bản thân."},"interview_questions":["Hiện tại điều gì trong học tập, nghề nghiệp hoặc phát triển bản thân khiến em băn khoăn nhất?","Em đã thử tự tìm hiểu hoặc giải quyết vấn đề đó như thế nào rồi?","Nếu không có Mentor đồng hành, điều gì em nghĩ mình sẽ khó tự nhìn ra hoặc tự giải quyết nhất?","Tình huống: Nếu Mentor chỉ có thể giúp em làm rõ một điều trong 9 tháng, em muốn đó là điều gì? Vì sao?"]},{"key":"readiness","label":"Sẵn sàng học hỏi","label_en":"Learning Readiness / Coachability","weight":20,"question":"Bạn này có tinh thần học hỏi; biết tự phản tỉnh và chủ động thử cách tiếp cận mới không?","descriptors":{"1":"Kỳ vọng Mentor đưa sẵn đáp án; phản ứng phòng thủ khi nhận feedback; ít tự phản tỉnh.","3":"Sẵn sàng lắng nghe và học hỏi. Tuy nhiên, bằng chứng về việc chuyển hóa thành hành động thực tế còn hạn chế.","5":"Biết lắng nghe; có khả năng tự phản tỉnh; chủ động thử cách tiếp cận khác và linh hoạt thay đổi khi cần cũng như sẵn sàng đón nhận thử thách."},"interview_questions":["Behavioral: Hãy kể một feedback em từng nhận mà lúc đầu em thấy khó nghe hoặc chưa đồng ý. Sau đó em đã làm gì?","Sau feedback đó, em có thay đổi điều gì không? Kết quả ra sao?","Có điều gì về bản thân mà em biết mình cần thay đổi/phát triển không? Nếu Mentor chỉ ra một điểm em chưa từng nghĩ tới, em sẽ phản ứng thế nào?","Tình huống: Nếu Mentor đưa ra góc nhìn hoàn toàn khác với điều em tin và hai bên vẫn khác quan điểm, em sẽ làm gì?"]},{"key":"ownership","label":"Chủ động & Chịu trách nhiệm","label_en":"Ownership & Initiative","weight":25,"question":"Bạn này có tự làm phần của mình hay chờ Mentor dẫn dắt?","descriptors":{"1":"Kỳ vọng Mentor chủ động lên lịch và nhắc nhở; mong Mentor xây dựng lộ trình phát triển để định hướng rõ ràng; kỳ vọng Mentor tìm kiếm và giới thiệu các cơ hội phù hợp.","3":"Hiểu mình phải chủ động nhưng vẫn cần khá nhiều hướng dẫn.","5":"Chủ động chuẩn bị trước buổi mentoring; tự sắp xếp và đặt lịch hẹn; thực hiện follow-up và triển khai hành động cụ thể sau buổi mentoring."},"interview_questions":["Theo em, trong một mối quan hệ mentoring, phần việc nào thuộc trách nhiệm của Mentee?","Behavioral: Kể một lần em gặp vấn đề chưa biết giải quyết. Trước khi nhờ người khác, em đã chủ động làm gì?","Tình huống: Nếu gần đến tháng mới nhưng Mentor chưa chủ động nhắn để đặt lịch, em sẽ làm gì?","Trước mỗi buổi mentoring em sẽ chuẩn bị gì, và sau buổi em sẽ làm gì để biến trao đổi thành hành động?"]},{"key":"follow_through","label":"Cam kết & Theo đến cùng","label_en":"Commitment & Follow-through","weight":25,"question":"Bạn này có khả năng duy trì hành trình 9 tháng không?","descriptors":{"1":"Chưa hiểu rõ hành trình mentoring bản thân cần cam kết những gì nên khó ước lượng khả năng thực hiện; thường chỉ phản hồi chung chung kiểu “em sẽ cố gắng” thay vì đưa ra kế hoạch cụ thể; chưa có cách xử lý khi bận rộn.","3":"Hiểu được ý nghĩa và tầm quan trọng của sự cam kết trong quá trình mentoring nhưng kế hoạch duy trì cam kết còn khá chung chung.","5":"Có minh chứng rõ ràng về khả năng thực hiện cam kết; biết cách quản lý công việc/học việc để đảm bảo tiến độ mentoring; chủ động báo sớm khi có vấn đề phát sinh thay vì để đến phút cuối; có khả năng xử lý xung đột thay vì im lặng hoặc bỏ ngang."},"interview_questions":["Tình huống: 9 tháng khá dài và chắc chắn sẽ có lúc em thi, đi làm hoặc rất bận. Khi đó em sẽ xử lý hành trình mentoring thế nào?","Behavioral: Hãy kể một cam kết kéo dài mà có lúc em rất muốn bỏ. Cuối cùng em xử lý ra sao?","Khi nhận ra mình có nguy cơ không thực hiện được điều đã cam kết, em thường làm gì và sẽ chủ động báo với ai?","Tình huống: Nếu cùng tuần có kỳ thi, deadline internship và lịch mentoring/recap, em sẽ sắp xếp và trao đổi thế nào?"]}]$s12v2_criteria$::jsonb;
  v_guidance jsonb := $s12v2_guidance${"motto":"Có cần không? • Có chịu học không? • Có tự làm phần của mình không? • Có đi đến cùng không?","note":"Điểm số chỉ mang tính tham khảo để Mentor đánh giá mức độ ở từng thành phần. KHÔNG sử dụng điểm số như ngưỡng sàn để quyết định Mentee “Đạt/Không đạt”. Không cộng điểm thành tổng số để đưa ra kết luận. Mentor dựa trên 4 tiêu chí chính để hỗ trợ đánh giá, chứ không áp dụng công thức tính điểm để quyết định việc trở thành Mentee.","reminder":"Chưa có định hướng, chưa nhiều kỹ năng hoặc chưa tự tin KHÔNG phải lý do để loại. Hãy đánh giá liệu mentoring có tạo giá trị cho bạn ấy và bạn ấy có sẵn sàng học, chủ động và đi đến cùng hay không."}$s12v2_guidance$::jsonb;
  v_rows integer;
begin
  if not public.vam106_valid_criteria(v_criteria) or not public.vam106_valid_guidance(v_guidance) then
    raise exception 'Phiếu S12 phiên bản 2 không hợp lệ';
  end if;
  update public.mentee_interview_rubrics r
     set criteria = v_criteria, guidance = v_guidance, version = r.version + 1, updated_at = now(), updated_by = null
    from public.seasons s
   where s.id = r.season_id and s.code = 'UEHM-S12' and r.version = 1;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise notice 'Phiếu S12 không còn ở phiên bản 1 (BTC đã sửa trên màn hình) — KHÔNG ghi đè. Sửa câu chữ tay ở /interviews/phieu-cham-mentee.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Tự kiểm
-- ------------------------------------------------------------
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'vam104_save_offline_interview';
  if v_src is null
    or position('CRITERION_NOTE_REQUIRED' in v_src) = 0
    or position('ALIGNMENT_NOTE_REQUIRED' in v_src) = 0
    or position('TAKE_LIMIT_REACHED' in v_src) = 0
    or position('vam106_effective_rubric' in v_src) = 0
    or position('RUBRIC_CHANGED' in v_src) = 0 then
    raise exception 'vam104_save_offline_interview chưa mang đủ luật mới';
  end if;
  if has_function_privilege('anon', 'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)', 'execute') then
    raise exception 'vam104_save_offline_interview đang mở cho anon/authenticated';
  end if;
  if not exists (select 1 from public.mentee_interview_rubrics r join public.seasons s on s.id = r.season_id
                 where s.code = 'UEHM-S12' and public.vam106_valid_criteria(r.criteria)) then
    raise exception 'Phiếu S12 không hợp lệ sau migration';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
