-- Phỏng vấn mentee 03–04/10: vé tại trang, điều phối 5 phòng × 5 bàn,
-- chốt kết quả và nhận mentee trong cùng transaction. Dán TRƯỚC khi merge.
begin;
set local lock_timeout = '10s';

alter table public.mentee_interview_invites
  add column if not exists checkin_token uuid not null default gen_random_uuid();
create unique index if not exists mentee_checkin_token_uidx
  on public.mentee_interview_invites(checkin_token);

create table if not exists public.mentee_interview_operations (
  id uuid primary key references public.applications(id),
  session_id uuid not null references public.interview_sessions(id),
  checked_in_at timestamptz,
  checked_in_by uuid references public.admin_users(id),
  room integer check (room between 1 and 5),
  desk integer check (desk between 1 and 5),
  interviewer_id uuid references public.admin_users(id),
  review_id uuid references public.application_reviews(id),
  outcome text check (outcome in ('passed','rejected','needs_review')),
  outcome_reason text,
  match_id uuid references public.matches(id),
  membership_id uuid references public.person_season_memberships(id),
  owns_membership boolean not null default false,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint mentee_room_desk_pair check ((room is null) = (desk is null))
);
create unique index if not exists mentee_interview_desk_uidx
  on public.mentee_interview_operations(session_id, room, desk) where room is not null;
create unique index if not exists mentee_interview_interviewer_uidx
  on public.mentee_interview_operations(session_id, interviewer_id) where interviewer_id is not null;

create table if not exists public.mentee_interview_operation_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  actor_id uuid not null references public.admin_users(id),
  action text not null,
  reason text,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.mentee_interview_operations enable row level security;
alter table public.mentee_interview_operation_log enable row level security;
revoke all on public.mentee_interview_operations, public.mentee_interview_operation_log from public, anon, authenticated, service_role;
grant select, insert, update on public.mentee_interview_operations to service_role;
grant select, insert on public.mentee_interview_operation_log to service_role;

-- Chỉ phạm vi mùa hiện hành; quyền đọc hồ sơ không đồng nghĩa quyền chấm thay.
create or replace function public.vam104_offline_access(p_actor uuid, p_season uuid, p_operate boolean default false)
returns boolean language sql stable set search_path = '' as $$
  select current_user = 'service_role' and exists (
    select 1 from public.admin_users au where au.id=p_actor and au.status='active'
    and (
      public.vam084_operator_for_season(p_actor,p_season)
      or (au.role='support_team' and exists (
        select 1 from public.admin_scope_access s where s.user_id=au.auth_user_id
        and s.status='active' and s.season_id=p_season::text and s.role in ('operations','full_access')
      ))
      or (not p_operate and public.vam084_participant_for_stage(p_actor,p_season,'interview'))
    )
  );
$$;

-- Khóa dùng chung cả đường matching cũ: kiểm sức chứa ở ứng dụng không đủ
-- khi hai thiết bị xác nhận cùng lúc. Một mentee chỉ có một match active/mùa.
create index if not exists vam104_active_mentee_matches
  on public.matches(season_id,mentee_person_id) where status='active';
create or replace function public.vam104_match_capacity_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_capacity integer; v_profiles integer; v_count integer;
begin
  if new.status <> 'active' then return new; end if;
  -- Không áp luật tuyển sinh mới lên dữ liệu legacy mùa khác.
  if not exists(select 1 from public.seasons where id=new.season_id and code='UEHM-S12') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || new.season_id::text,0));
  if exists(select 1 from public.matches where season_id=new.season_id and mentee_person_id=new.mentee_person_id and status='active' and id<>new.id)
    then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
  select count(*), min(case when capacity_target > 0 then capacity_target else 3 end)
    into v_profiles,v_capacity from public.mentor_profiles where person_id=new.mentor_person_id;
  if v_profiles <> 1 then raise exception 'MENTOR_IDENTITY_AMBIGUOUS'; end if;
  select count(*) into v_count from public.matches m
    where m.season_id=new.season_id and m.mentor_person_id=new.mentor_person_id
      and m.status='active' and m.id<>new.id;
  if v_count >= v_capacity then raise exception 'MENTOR_FULL'; end if;
  return new;
end;
$$;
drop trigger if exists vam104_match_capacity on public.matches;
create trigger vam104_match_capacity before insert or update of status,mentor_person_id,mentee_person_id,season_id
  on public.matches for each row execute function public.vam104_match_capacity_guard();

-- Phiếu offline phải sửa qua RPC để điểm, kết quả, match và log cùng thay đổi.
alter table public.application_reviews add column if not exists offline_managed boolean not null default false;
create or replace function public.vam104_review_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.offline_managed or new.offline_managed) and
    current_setting('vam.offline_application',true) is distinct from old.application_id::text then
    raise exception 'OFFLINE_REVIEW_USE_WORKFLOW';
  end if;
  return new;
end;
$$;
drop trigger if exists vam104_review_guard on public.application_reviews;
create trigger vam104_review_guard before update on public.application_reviews
  for each row execute function public.vam104_review_guard();

create or replace function public.vam104_booking_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='booked' and (new.status<>'booked' or new.session_id<>old.session_id)
    and exists(select 1 from public.mentee_interview_operations where id=old.application_id and checked_in_at is not null)
    then raise exception 'ALREADY_CHECKED_IN'; end if;
  return new;
end;
$$;
drop trigger if exists vam104_booking_guard on public.mentee_interview_bookings;
create trigger vam104_booking_guard before update on public.mentee_interview_bookings
  for each row execute function public.vam104_booking_guard();
revoke all on function public.vam104_review_guard(), public.vam104_booking_guard() from public,anon,authenticated;
grant execute on function public.vam104_review_guard(), public.vam104_booking_guard() to service_role;

create or replace function public.vam104_session_capacity_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.seat_limit>25 and exists(select 1 from public.seasons where id=new.season_id and code='UEHM-S12')
    then raise exception 'SESSION_MAX_25'; end if;
  return new;
end;
$$;
drop trigger if exists vam104_session_capacity on public.interview_sessions;
create trigger vam104_session_capacity before insert or update of seat_limit,season_id on public.interview_sessions
  for each row execute function public.vam104_session_capacity_guard();
revoke all on function public.vam104_session_capacity_guard() from public,anon,authenticated;
grant execute on function public.vam104_session_capacity_guard() to service_role;

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
    if v_room is null or v_room not between 1 and 5 or v_desk is null or v_desk not between 1 and 5
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

revoke all on function public.vam104_offline_access(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.vam104_match_capacity_guard() from public,anon,authenticated;
grant execute on function public.vam104_offline_access(uuid,uuid,boolean) to service_role;
grant execute on function public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb) to service_role;
grant execute on function public.vam104_match_capacity_guard() to service_role;

-- Một snapshot cho màn điều phối; danh sách ca tối đa 600 người nhưng không
-- phụ thuộc giới hạn 1000 dòng của PostgREST. Không trả token đặt ca/QR.
create or replace function public.vam104_offline_dashboard(p_actor uuid,p_season uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not public.vam104_offline_access(p_actor,p_season) then raise exception 'ACCESS_DENIED'; end if;
  return jsonb_build_object(
    'canOperate',public.vam104_offline_access(p_actor,p_season,true),
    'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at) from public.interview_sessions s where s.season_id=p_season),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(u) || jsonb_build_object(
      'capacity',(select case when count(*)=1 then min(case when mp.capacity_target>0 then mp.capacity_target else 3 end) end
        from public.mentor_profiles mp join public.people p on p.id=mp.person_id where lower(btrim(p.email_primary))=lower(btrim(u.email))
        and exists(select 1 from public.applications a where a.person_id=p.id and a.season_id=p_season and a.status='approved_as_mentor')),
      'activeMatches',(select count(*) from public.matches m join public.people p on p.id=m.mentor_person_id
        where lower(btrim(p.email_primary))=lower(btrim(u.email)) and m.season_id=p_season and m.status='active')
    )) from public.vam084_list_recruitment_participants(p_season,'interview') u),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.full_name,'email',a.email_primary,'phone',a.phone_primary,'status',a.status,
      'sessionId',b.session_id,'bookedAt',b.booked_at,'rawPayload',a.raw_payload,
      'operation',to_jsonb(o),'reviews',coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewerName',coalesce(u.full_name,u.email)) order by r.created_at)
        from public.application_reviews r left join public.admin_users u on u.id=r.reviewer_admin_user_id
        where r.application_id=a.id and r.status<>'cancelled'),'[]'::jsonb)
    ) order by b.booked_at) from public.mentee_interview_bookings b join public.applications a on a.id=b.application_id
      left join public.mentee_interview_operations o on o.id=a.id
      where b.season_id=p_season and b.status='booked'),'[]'::jsonb),
    'logs',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (
      select l.*,coalesce(u.full_name,u.email) as actor_name,a.full_name as candidate_name
        from public.mentee_interview_operation_log l join public.applications a on a.id=l.application_id
        join public.admin_users u on u.id=l.actor_id where a.season_id=p_season order by l.created_at desc,l.id limit 200
    ) l),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.vam104_offline_dashboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vam104_offline_dashboard(uuid,uuid) to service_role;

-- QR chỉ tra vé đang hiệu lực; người chưa đăng nhập không đọc được danh tính.
create or replace function public.vam104_lookup_offline_ticket(p_actor uuid,p_season uuid,p_code uuid)
returns uuid language plpgsql stable set search_path = '' as $$
declare v_id uuid;
begin
  if not public.vam104_offline_access(p_actor,p_season,true) then raise exception 'ACCESS_DENIED'; end if;
  select i.application_id into v_id from public.mentee_interview_invites i
    join public.mentee_interview_bookings b on b.application_id=i.application_id and b.status='booked'
    join public.applications a on a.id=i.application_id
    where i.checkin_token=p_code and b.season_id=p_season and a.status<>'withdrawn';
  return v_id;
end;
$$;
revoke all on function public.vam104_lookup_offline_ticket(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.vam104_lookup_offline_ticket(uuid,uuid,uuid) to service_role;

do $$
declare t text;
begin
  foreach t in array array['mentee_interview_operations','mentee_interview_operation_log'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and c.relrowsecurity)
      then raise exception 'SELF_CHECK RLS: %',t; end if;
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT')
      then raise exception 'SELF_CHECK ACL: %',t; end if;
  end loop;
  if to_regprocedure('public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)') is null
    or has_function_privilege('anon','public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)','EXECUTE')
    then raise exception 'SELF_CHECK RPC'; end if;
  if exists(select 1 from public.mentee_interview_invites where checkin_token is null) then raise exception 'SELF_CHECK QR'; end if;
end;
$$;
commit;
