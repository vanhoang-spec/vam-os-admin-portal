-- BTC chốt kết quả cho hồ sơ mentee "Cần BTC xem xét thêm" sau phỏng vấn.
--
-- 12/10/2026: sau hai đợt phỏng vấn còn 103 hồ sơ người phỏng vấn để lại kết quả
-- "Cần BTC xem xét thêm". BTC xin "mở quyền final decision cho Core team". Soi lại
-- thì Core team không thiếu quyền — thiếu ĐƯỜNG: với hồ sơ ở trạng thái này,
--   * "Duyệt làm mentee" bị chặn (phải qua "Qua vòng phỏng vấn" trước),
--   * "Qua vòng phỏng vấn" bị chặn (luật đòi một phiếu phỏng vấn MỚI nộp sau quyết
--     định "cần xem thêm" — nghĩa là phỏng vấn lại),
--   * "Không chọn" bị chặn (không có lối từ "cần xem thêm" sang từ chối),
-- còn sửa kết quả trên màn hình phỏng vấn thì chỉ đúng người đã phỏng vấn làm được.
--
-- File này thêm đúng một đường: Core team trở lên (vam084_operator_for_season — KHÔNG
-- gồm Support team) chốt "Đạt" hoặc "Không chọn" cho hồ sơ đang "cần xem thêm", bắt
-- buộc ghi lý do. Phiếu của người phỏng vấn giữ nguyên; quyết định của BTC ghi riêng.
--
--   "Đạt"       → hồ sơ approved_as_mentee + người + mentee profile + tư cách mentee
--                 của mùa, đúng các bước người phỏng vấn chốt "Đạt" vẫn làm. KHÔNG tạo
--                 cặp ghép: bạn đó vào danh sách chờ mentor chọn ở Vòng 2.
--   "Không chọn" → hồ sơ rejected_or_not_fit.
--
-- BTC đổi lại được quyết định của chính BTC (bấm nhầm), với cùng các chặn mà người
-- phỏng vấn gặp khi sửa kết quả: mentee đã có cặp ghép thì không đổi sang "Không chọn"
-- được. Sau khi BTC chốt, người phỏng vấn không sửa đè lên được nữa.
--
-- Dán lại không sao.

alter table public.mentee_interview_operations
  add column if not exists btc_decided_by uuid references public.admin_users(id),
  add column if not exists btc_decided_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mentee_interview_operations'::regclass and conname = 'mentee_interview_operations_btc_pair'
  ) then
    alter table public.mentee_interview_operations
      add constraint mentee_interview_operations_btc_pair check ((btc_decided_by is null) = (btc_decided_at is null));
  end if;
end $$;

-- Một khi BTC đã chốt, dòng kết quả đứng yên: chỉ vam119_btc_decide_needs_review (đặt cờ
-- vam.btc_decision cho đúng hồ sơ trong transaction của nó) được sửa. Chặn ở trigger
-- chứ không sửa vam104_save_offline_interview: hàm đó hơn 30 người phỏng vấn đang dùng,
-- chép lại 200 dòng để thêm một dòng là rủi ro không đáng. Người phỏng vấn bấm "Sửa kết
-- quả" trên hồ sơ BTC đã chốt sẽ nhận BTC_DECIDED và cả lần lưu được hoàn lại.
create or replace function public.vam119_btc_decision_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('vam.btc_decision', true) is distinct from old.id::text then
    if old.btc_decided_at is not null then
      raise exception 'BTC_DECIDED';
    end if;
    if new.btc_decided_by is not null or new.btc_decided_at is not null then
      raise exception 'BTC_DECISION_USE_WORKFLOW';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists vam119_btc_decision_guard on public.mentee_interview_operations;
create trigger vam119_btc_decision_guard before update on public.mentee_interview_operations
  for each row execute function public.vam119_btc_decision_guard();

create or replace function public.vam119_btc_decide_needs_review(
  p_actor uuid,
  p_application uuid,
  p_revision integer,
  p_outcome text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  a public.applications%rowtype;
  o public.mentee_interview_operations%rowtype;
  v_before jsonb; v_review jsonb; v_reason text; v_name text; v_email text; v_status text; v_expected text;
  v_person uuid; v_count integer; v_program uuid; v_membership uuid; v_new_membership uuid; v_old_member_status text;
begin
  select * into a from public.applications where id = p_application;
  -- Core team trở lên có quyền vận hành mùa. Support team và người phỏng vấn không qua cổng này.
  -- vam084_operator_for_season tự đòi current_user = 'service_role', nên không kiểm lại ở đây:
  -- một dòng kiểm trùng là một dòng không bài test nào làm đỏ được.
  if a.id is null or a.role_applied::text <> 'mentee' or not public.vam084_operator_for_season(p_actor, a.season_id)
    then raise exception 'ACCESS_DENIED'; end if;
  -- Cùng khoá với luồng phỏng vấn và ghép cặp: không ai chen được giữa lúc kiểm và lúc ghi.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || a.season_id::text, 0));
  select * into a from public.applications where id = p_application for update;
  if a.status = 'withdrawn' then raise exception 'APPLICATION_WITHDRAWN'; end if;
  select * into o from public.mentee_interview_operations where id = a.id for update;
  if o.id is null then raise exception 'NOT_NEEDS_REVIEW'; end if;
  if o.revision is distinct from p_revision then raise exception 'STALE_REVISION'; end if;
  -- Chỉ hai trường hợp: hồ sơ đang "cần xem thêm", hoặc BTC đổi lại quyết định của chính BTC.
  -- Kết quả Đạt / Không chọn do người phỏng vấn chốt thì không thuộc đường này.
  if o.outcome is distinct from 'needs_review' and o.btc_decided_at is null then raise exception 'NOT_NEEDS_REVIEW'; end if;
  if p_outcome is null or p_outcome not in ('passed', 'rejected') then raise exception 'INVALID_RESULT'; end if;
  if o.outcome is not distinct from p_outcome then raise exception 'SAME_RESULT'; end if;
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if length(v_reason) > 4000 then raise exception 'TEXT_TOO_LONG'; end if;
  -- Trạng thái hồ sơ phải còn đúng với kết quả đang ghi. Lệch nghĩa là hồ sơ đã bị đổi ở
  -- một luồng khác — chốt chồng lên là ghi đè một quyết định mà BTC chưa nhìn thấy.
  v_expected := case o.outcome when 'needs_review' then 'needs_more_review' when 'passed' then 'approved_as_mentee' else 'rejected_or_not_fit' end;
  if a.status is distinct from v_expected then raise exception 'STATUS_CHANGED'; end if;

  v_before := to_jsonb(o);
  select to_jsonb(r) into v_review from public.application_reviews r where r.id = o.review_id;
  select coalesce(full_name, email) into v_name from public.admin_users where id = p_actor;
  v_person := a.person_id;

  if p_outcome = 'passed' then
    -- Cùng các bước và cùng các chặn với nhánh "Đạt" của vam104_save_offline_interview.
    v_email := lower(btrim(a.email_primary));
    if nullif(v_email, '') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
    perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));
    if v_person is null then
      select count(*), (array_agg(id))[1] into v_count, v_person from public.people where lower(btrim(email_primary)) = v_email;
      if v_count > 1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
      if v_count = 0 then
        if nullif(btrim(a.full_name), '') is null then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
        insert into public.people(full_name, email_primary, phone_primary, source_sheets)
          values (a.full_name, v_email, a.phone_primary, 's12_native_application') returning id into v_person;
      end if;
    elsif not exists (select 1 from public.people where id = v_person and lower(btrim(email_primary)) = v_email) then
      raise exception 'IDENTITY_REQUIRES_BTC';
    end if;
    perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || v_person::text));
    select count(*) into v_count from public.mentee_profiles where person_id = v_person;
    if v_count > 1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
    if v_count = 0 then
      insert into public.mentee_profiles(person_id, source_application_id, intake_batch_id) values (v_person, a.id, a.intake_batch_id);
    end if;
    select program_id into v_program from public.seasons where id = a.season_id;
    select count(*), (array_agg(id))[1] into v_count, v_membership from public.person_season_memberships
      where person_id = v_person and season_id = a.season_id and role = 'mentee';
    if v_count > 1 then raise exception 'IDENTITY_REQUIRES_BTC'; end if;
    if v_membership is null then
      insert into public.person_season_memberships(person_id, program_id, season_id, role, status, source, created_by)
        values (v_person, v_program, a.season_id, 'mentee', 'active', 'manual', p_actor) returning id into v_new_membership;
      insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
        values (v_new_membership, v_person, v_program, a.season_id, 'mentee', null, 'active', 'created', 'BTC chốt Đạt sau phỏng vấn (hồ sơ cần xem thêm)', p_actor);
    else
      select status into v_old_member_status from public.person_season_memberships where id = v_membership for update;
      if v_old_member_status <> 'active' then
        -- Tư cách đã ngừng mà không phải do lượt phỏng vấn này tạo: không tự bật lại.
        if not o.owns_membership or o.membership_id is distinct from v_membership then raise exception 'MEMBERSHIP_REQUIRES_BTC'; end if;
        update public.person_season_memberships set status = 'active', end_date = null, updated_at = now() where id = v_membership;
        insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
          values (v_membership, v_person, v_program, a.season_id, 'mentee', v_old_member_status, 'active', 'status_change', v_reason, p_actor);
      end if;
    end if;
  elsif v_person is not null then
    -- "Không chọn": không gỡ một cặp ghép hay một tư cách do luồng khác tạo.
    if exists (select 1 from public.matches where mentee_person_id = v_person and season_id = a.season_id and status = 'active')
      then raise exception 'OTHER_MATCH_REQUIRES_BTC'; end if;
    if o.owns_membership and o.membership_id is not null then
      select status, program_id into v_old_member_status, v_program from public.person_season_memberships where id = o.membership_id for update;
      if v_old_member_status = 'active' then
        update public.person_season_memberships set status = 'withdrawn', end_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date, updated_at = now()
          where id = o.membership_id;
        insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
          values (o.membership_id, v_person, v_program, a.season_id, 'mentee', v_old_member_status, 'withdrawn', 'status_change', v_reason, p_actor);
      end if;
    elsif exists (select 1 from public.person_season_memberships where person_id = v_person and season_id = a.season_id and role = 'mentee' and status = 'active') then
      raise exception 'MEMBERSHIP_REQUIRES_BTC';
    end if;
  end if;

  v_status := case p_outcome when 'passed' then 'approved_as_mentee' else 'rejected_or_not_fit' end;
  update public.applications set status = v_status, person_id = v_person where id = a.id;
  insert into public.application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note)
    values (a.id, p_actor, v_name, v_status, a.status, v_status, v_reason);

  perform set_config('vam.btc_decision', a.id::text, true);
  update public.mentee_interview_operations
    set outcome = p_outcome, outcome_reason = v_reason, btc_decided_by = p_actor, btc_decided_at = now(),
        membership_id = coalesce(v_new_membership, membership_id),
        owns_membership = (owns_membership or v_new_membership is not null),
        revision = revision + 1, updated_at = now()
    where id = a.id returning * into o;
  perform set_config('vam.btc_decision', '', true);

  insert into public.mentee_interview_operation_log(application_id, actor_id, action, reason, before_data, after_data)
    values (a.id, p_actor, 'btc_decision', v_reason, jsonb_build_object('operation', v_before, 'review', v_review),
      jsonb_build_object('operation', to_jsonb(o), 'values', jsonb_build_object('outcome', p_outcome, 'reason', v_reason)));
  return jsonb_build_object('ok', true, 'message', 'Đã lưu.', 'revision', o.revision);
end;
$function$;

revoke all on function public.vam119_btc_decide_needs_review(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.vam119_btc_decide_needs_review(uuid,uuid,integer,text,text) to service_role;
revoke all on function public.vam119_btc_decision_guard() from public,anon,authenticated;

-- Bảng gọn của màn hình phỏng vấn (20261011190000) thêm đúng một khoá: 'canDecide' — tài khoản
-- này có được chốt hồ sơ "cần xem thêm" hay không, hỏi thẳng luật mà hàm ghi dùng. Màn hình
-- không được mời một ô mà máy chủ chắc chắn từ chối. Phần còn lại của hàm giữ nguyên từng chữ.
create or replace function public.vam118_offline_board(
  p_actor uuid,
  p_season uuid,
  p_sessions uuid[] default null,
  p_with_logs boolean default true
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
begin
  if not public.vam104_offline_access(p_actor,p_season) then raise exception 'ACCESS_DENIED'; end if;
  return jsonb_build_object(
    'canOperate',public.vam104_offline_access(p_actor,p_season,true),
    'canDecide',public.vam084_operator_for_season(p_actor,p_season),
    'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at) from public.interview_sessions s where s.season_id=p_season),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(u) || jsonb_build_object(
      'capacity',(select case when count(*)=1 then min(case when mp.capacity_target>0 then mp.capacity_target else 3 end) end
        from public.mentor_profiles mp join public.people p on p.id=mp.person_id where lower(btrim(p.email_primary))=lower(btrim(u.email))
        and exists(select 1 from public.applications a where a.person_id=p.id and a.season_id=p_season and a.status='approved_as_mentor')),
      'activeMatches',(select count(*) from public.matches m join public.people p on p.id=m.mentor_person_id
        where lower(btrim(p.email_primary))=lower(btrim(u.email)) and m.season_id=p_season and m.status='active')
    )) from public.vam110_list_recruitment_participants(p_season, 'interview', 'mentee') u),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.full_name,'email',a.email_primary,'phone',a.phone_primary,'status',a.status,
      'sessionId',b.session_id,'bookedAt',b.booked_at,
      'operation',to_jsonb(o),
      'takeSubmitted',exists(select 1 from public.application_reviews r
        where r.id=o.review_id and r.status='submitted' and r.take_choice='take')
    ) order by b.booked_at) from public.mentee_interview_bookings b join public.applications a on a.id=b.application_id
      left join public.mentee_interview_operations o on o.id=a.id
      where b.season_id=p_season and b.status='booked'
        and (p_sessions is null or b.session_id=any(p_sessions))),'[]'::jsonb),
    'logs',case when p_with_logs then coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (
      select l.*,coalesce(u.full_name,u.email) as actor_name,a.full_name as candidate_name
        from public.mentee_interview_operation_log l join public.applications a on a.id=l.application_id
        join public.admin_users u on u.id=l.actor_id where a.season_id=p_season order by l.created_at desc,l.id limit 200
    ) l),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$function$;

do $$
declare
  v_fn text := 'public.vam119_btc_decide_needs_review(uuid,uuid,integer,text,text)';
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentee_interview_operations'
        and column_name in ('btc_decided_by', 'btc_decided_at')) <> 2 then
    raise exception 'Thiếu cột btc_decided_by / btc_decided_at';
  end if;
  if to_regprocedure(v_fn) is null then raise exception 'Thiếu hàm %', v_fn; end if;
  if (select prosecdef from pg_proc where oid = to_regprocedure(v_fn)) then raise exception '% phải chạy bằng quyền người gọi', v_fn; end if;
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '% đang mở cho anon/authenticated', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then raise exception 'service_role chưa gọi được %', v_fn; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.mentee_interview_operations'::regclass and tgname = 'vam119_btc_decision_guard' and not tgisinternal) then
    raise exception 'Thiếu trigger vam119_btc_decision_guard';
  end if;
  if position('''canDecide''' in pg_get_functiondef('public.vam118_offline_board(uuid,uuid,uuid[],boolean)'::regprocedure)) = 0 then
    raise exception 'vam118_offline_board chưa trả khoá canDecide';
  end if;
  if has_function_privilege('anon', 'public.vam118_offline_board(uuid,uuid,uuid[],boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.vam118_offline_board(uuid,uuid,uuid[],boolean)', 'execute') then
    raise exception 'vam118_offline_board đang mở cho anon/authenticated';
  end if;
end $$;
