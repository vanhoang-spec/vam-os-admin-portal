-- ═══════════════════════════════════════════════════════════════════════════
-- Thư mời trao đổi chỉ đi sau khi hồ sơ đã qua vòng chấm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Luật đối tượng chốt ngày 22/09/2026 nhận MỌI đơn mentor còn mở, kể cả đơn
-- chưa ai chấm: ý lúc đó là "đừng để ai phải chờ một cú bấm hành chính". Một
-- ngày sau, dữ liệu nói cái giá của nó.
--
-- Đọc trên production sáng 23/09/2026, trong 82 lá thư mời đã gửi:
--
--   5 người đang `screening_assigned`   — reviewer đang cầm hồ sơ
--   3 người đang `submitted`            — chưa ai mở ra xem
--   1 người đang `ready_for_screening`  — chưa giao cho ai
--   12 người sau đó bị đánh `rejected_or_not_fit`
--
-- Chín người đầu được mời ngồi với core team trước khi có ai nói hồ sơ của họ
-- đạt. Mười hai người sau nhận thư rồi mới bị từ chối — link của họ đã tự
-- khoá, nhưng lá thư thì không rút lại được.
--
-- Migration này đổi vòng hồ sơ từ một bước SONG SONG thành một CỬA:
--
--   'screening_passed'      — hình thái cũ của "Qua vòng hồ sơ" (luồng hai bước)
--   'invited_to_interview'  — quyết định core team thật sự bấm hôm nay
--   'interview_scheduled'   — đã có lịch, giữ lại để huỷ xong đặt lại được
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO PHẢI SỬA CẢ HAI HÀM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Có hai đường vào một buổi hẹn, và chúng phải cùng một luật:
--
--   vam098_book_interview_slot   — mentor tự giữ chỗ qua link riêng
--   vam099_match_mentor_at_hour  — interviewer ghép vào giờ mentor khai rảnh
--
-- Siết một bên thôi thì người không được mời vẫn đi vòng qua bên kia. Tầng
-- TypeScript (BOOKING_ELIGIBLE_STATUSES) là cửa thứ ba, và cả ba phải khớp
-- từng chữ — bài test tĩnh mới đối chiếu chúng theo hai chiều.
--
-- Thân hai hàm dưới đây được CHÉP NGUYÊN từ migration đã tạo ra chúng
-- (20260922100000 và 20260923040000), md5 đã đối chiếu với pg_proc.prosrc của
-- production trước khi chép, và chỉ đúng một chỗ trong mỗi thân bị thay: danh
-- sách trạng thái. Gõ tay lại 12KB thân hàm là cách đánh rơi một dòng.
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ------------------------------------------------------------
-- 0. Điều kiện tiên quyết
-- ------------------------------------------------------------
do $invite_gate_prereq$
declare
  v_check  text;
  v_status text;
  v_needle text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam098_book_interview_slot'
  ) then
    raise exception 'PREREQ_MISSING: chưa có vam098_book_interview_slot — dán 20260922100000 trước';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam099_match_mentor_at_hour'
  ) then
    raise exception 'PREREQ_MISSING: chưa có vam099_match_mentor_at_hour — dán 20260923040000 trước';
  end if;

  -- Một trạng thái gõ sai biến cái cửa này thành bức tường: không ai đủ điều
  -- kiện, thư ngừng đi, và không có lỗi nào hiện ra. Ràng buộc status của bảng
  -- applications là chỗ duy nhất nói được ba tên kia có thật hay không.
  select pg_get_constraintdef(c.oid) into v_check
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'applications' and c.conname = 'applications_status_check';
  if v_check is null then
    raise exception 'PREREQ_MISSING: không đọc được applications_status_check';
  end if;
  foreach v_status in array array['screening_passed', 'invited_to_interview', 'interview_scheduled'] loop
    if strpos(v_check, '''' || v_status || '''') = 0 then
      raise exception 'PREREQ_MISSING: applications_status_check không có trạng thái %', v_status;
    end if;
  end loop;
end
$invite_gate_prereq$;

-- ------------------------------------------------------------
-- 1. Hai hàm ghi, cùng một luật đối tượng
-- ------------------------------------------------------------
create or replace function public.vam098_book_interview_slot(
  p_token uuid,
  p_slot_starts_at timestamptz
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
  v_slot       public.interview_slots%rowtype;
  v_review_id  uuid;
  v_booking_id uuid;
  v_phone      text;
  v_iv_name    text;
  v_iv_email   text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select i.application_id into v_app_id
  from public.interview_slot_invites i
  where i.token = p_token;
  if v_app_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- Khoá dòng đơn TRƯỚC khi kiểm bất cứ điều gì: hai tab của cùng một mentor
  -- bấm hai slot khác nhau sẽ nối đuôi nhau ở đây, tab sau thấy 'already_booked'.
  select a.* into v_app
  from public.applications a
  where a.id = v_app_id
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if exists (
    select 1 from public.interview_bookings b
    where b.application_id = v_app_id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_booked');
  end if;

  -- Luật đối tượng (chủ dự án siết lại 23/09/2026): đơn mentor nộp qua
  -- form, ĐÃ QUA vòng hồ sơ, và CHƯA có phiếu phỏng vấn nào không-huỷ —
  -- người đã có phiếu mở theo đường phân công cũ thì interviewer đang phụ
  -- trách tự hẹn.
  --
  -- Bản 22/09 nhận cả đơn chưa ai chấm. Đọc lại dữ liệu ngày 23/09: 9 người
  -- nhận thư mời trong khi hồ sơ còn trên bàn reviewer, và 12 người nhận thư
  -- xong mới bị đánh 'không phù hợp'. Giờ của core team là thứ đắt nhất
  -- trong đợt tuyển, nên vòng hồ sơ phải là CỬA chứ không phải bước song
  -- song. Danh sách dưới đây khớp từng chữ với BOOKING_ELIGIBLE_STATUSES
  -- trong lib/interview-schedule-core.ts.
  if lower(coalesce(v_app.role_applied::text, '')) <> 'mentor'
     or coalesce(v_app.source, '') <> 'vam_os_form'
     or v_app.status not in (
       'screening_passed', 'invited_to_interview', 'interview_scheduled'
     ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app_id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'code', 'application_not_eligible');
  end if;

  if p_slot_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'slot_in_past');
  end if;

  -- FIFO có nhường đường: người rảnh sớm nhất được ghép trước; nếu dòng sớm
  -- nhất đang bị một giao dịch khác cầm thì LẤY NGAY dòng kế (skip locked)
  -- thay vì xếp hàng — mentor không phải chờ ai.
  select s.* into v_slot
  from public.interview_slots s
  where s.slot_starts_at = p_slot_starts_at
    and s.status = 'open'
    and s.season_id = v_app.season_id
  order by s.available_since asc, s.id asc
  limit 1
  for update skip locked;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'slot_full');
  end if;

  update public.interview_slots
     set status = 'booked',
         booked_application_id = v_app_id
   where id = v_slot.id;

  -- Phiếu phỏng vấn giao thẳng cho interviewer của slot: sau buổi họ chấm ở
  -- /reviews như mọi phiếu khác. assigned_by để trống — không có ai "giao",
  -- chính mentor chọn; dòng application_decisions bên dưới kể chuyện đó.
  insert into public.application_reviews (
    application_id, review_round, reviewer_admin_user_id,
    assigned_by, assigned_at, due_at, status
  ) values (
    v_app_id, 'interview', v_slot.admin_user_id,
    null, now(), p_slot_starts_at + interval '1 hour', 'assigned'
  )
  returning id into v_review_id;

  insert into public.interview_bookings (
    slot_id, application_id, interviewer_admin_user_id, review_id,
    slot_starts_at, previous_application_status
  ) values (
    v_slot.id, v_app_id, v_slot.admin_user_id, v_review_id,
    p_slot_starts_at, v_app.status
  )
  returning id into v_booking_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app_id, null, 'Hệ thống đặt lịch phỏng vấn', 'interview_scheduled',
    v_app.status, 'interview_scheduled',
    'Mentor tự đặt lịch qua link cá nhân — '
      || to_char(p_slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app_id;

  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = v_slot.admin_user_id;

  select au.full_name, au.email into v_iv_name, v_iv_email
  from public.admin_users au
  where au.id = v_slot.admin_user_id;

  -- Trả đủ thông tin liên hệ hai bên để tầng ứng dụng gửi ba lá thư xác nhận
  -- (interviewer / mentor / ban tổ chức) mà không phải đọc lại lần nào.
  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'review_id', v_review_id,
    'slot_starts_at', p_slot_starts_at,
    'previous_status', v_app.status,
    'interviewer', jsonb_build_object(
      'admin_user_id', v_slot.admin_user_id,
      'full_name', v_iv_name,
      'email', v_iv_email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app_id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

create or replace function public.vam099_match_mentor_at_hour(
  p_actor uuid,
  p_slot_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_actor      public.admin_users%rowtype;
  v_avail      public.interview_mentor_availability%rowtype;
  v_app        public.applications%rowtype;
  v_slot       public.interview_slots%rowtype;
  v_review_id  uuid;
  v_booking_id uuid;
  v_phone      text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select au.* into v_actor
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor.id is null
     or v_actor.role not in ('super_admin', 'admin', 'core_team', 'reviewer') then
    raise exception 'Interviewer context required';
  end if;

  -- SĐT của interviewer đi vào thư xác nhận gửi mentor. Ghép mà thiếu nó là
  -- hẹn một người rồi không cho họ cách gọi lại — chặn ngay ở đây.
  select ip.phone into v_phone
  from public.interviewer_profiles ip
  where ip.admin_user_id = p_actor;
  if coalesce(btrim(coalesce(v_phone, '')), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'missing_phone');
  end if;

  if p_slot_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'slot_in_past');
  end if;

  -- Người khai sớm nhất được ghép trước; dòng đang bị giao dịch khác cầm thì
  -- bỏ qua lấy người kế (skip locked) — interviewer thứ hai không phải chờ.
  -- Điều kiện đối tượng lặp lại đúng luật của vam098_book_interview_slot: đơn
  -- mentor nộp qua form, ĐÃ QUA vòng hồ sơ, chưa có lịch, chưa có phiếu.
  -- Hai hàm phải cùng một luật: nếu chỉ siết một bên thì người không được
  -- mời vẫn vào được qua bên còn lại.
  select av.* into v_avail
  from public.interview_mentor_availability av
  join public.applications a on a.id = av.application_id
  where av.slot_starts_at = p_slot_starts_at
    and av.status = 'open'
    and lower(coalesce(a.role_applied::text, '')) = 'mentor'
    and coalesce(a.source, '') = 'vam_os_form'
    and a.status in (
      'screening_passed', 'invited_to_interview', 'interview_scheduled'
    )
    and not exists (
      select 1 from public.interview_bookings b
      where b.application_id = a.id and b.status = 'booked'
    )
    and not exists (
      select 1 from public.application_reviews ar
      where ar.application_id = a.id
        and ar.review_round = 'interview'
        and ar.status <> 'cancelled'
    )
  order by av.available_since asc, av.id asc
  limit 1
  for update of av skip locked;

  if v_avail.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_mentor_waiting');
  end if;

  -- Khoá dòng đơn rồi kiểm lại dưới khoá: giữa lúc chọn ở trên và ghi ở dưới,
  -- chính mentor đó có thể vừa tự giữ chỗ qua link riêng.
  select a.* into v_app
  from public.applications a
  where a.id = v_avail.application_id
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_mentor_waiting');
  end if;

  if exists (
    select 1 from public.interview_bookings b
    where b.application_id = v_app.id and b.status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'code', 'mentor_already_booked');
  end if;

  if exists (
    select 1 from public.application_reviews ar
    where ar.application_id = v_app.id
      and ar.review_round = 'interview'
      and ar.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'code', 'mentor_already_booked');
  end if;

  -- Giờ của interviewer: có sẵn thì dùng, chưa có thì mở luôn. Interviewer
  -- không phải đăng giờ trước rồi mới ghép được — một cú bấm là xong.
  select s.* into v_slot
  from public.interview_slots s
  where s.admin_user_id = p_actor and s.slot_starts_at = p_slot_starts_at
  for update;

  if v_slot.id is not null and v_slot.status = 'booked' then
    return jsonb_build_object('ok', false, 'code', 'interviewer_busy');
  end if;

  if v_slot.id is null then
    insert into public.interview_slots (
      season_id, admin_user_id, slot_starts_at, status, booked_application_id
    ) values (
      v_app.season_id, p_actor, p_slot_starts_at, 'booked', v_app.id
    )
    returning * into v_slot;
  else
    update public.interview_slots
       set status = 'booked',
           booked_application_id = v_app.id
     where id = v_slot.id
    returning * into v_slot;
  end if;

  -- Phiếu phỏng vấn giao thẳng cho người vừa bấm ghép: sau buổi họ chấm ở
  -- /reviews như mọi phiếu khác. assigned_by chính là họ — khác chiều kia,
  -- nơi mentor tự chọn nên không có ai "giao".
  insert into public.application_reviews (
    application_id, review_round, reviewer_admin_user_id,
    assigned_by, assigned_at, due_at, status
  ) values (
    v_app.id, 'interview', p_actor,
    p_actor, now(), p_slot_starts_at + interval '1 hour', 'assigned'
  )
  returning id into v_review_id;

  insert into public.interview_bookings (
    slot_id, application_id, interviewer_admin_user_id, review_id,
    slot_starts_at, previous_application_status
  ) values (
    v_slot.id, v_app.id, p_actor, v_review_id,
    p_slot_starts_at, v_app.status
  )
  returning id into v_booking_id;

  update public.interview_mentor_availability
     set status = 'matched',
         matched_booking_id = v_booking_id,
         matched_at = now()
   where id = v_avail.id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    v_app.id, p_actor, coalesce(v_actor.full_name, v_actor.email),
    'interview_scheduled', v_app.status, 'interview_scheduled',
    'Interviewer ghép vào giờ mentor tự khai rảnh — '
      || to_char(p_slot_starts_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
      || ' (giờ Việt Nam)'
  );

  update public.applications
     set status = 'interview_scheduled'
   where id = v_app.id;

  -- Cùng hình dạng trả về với vam098_book_interview_slot, để tầng ứng dụng
  -- gửi ba lá thư xác nhận bằng đúng một đoạn mã cho cả hai chiều.
  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'review_id', v_review_id,
    'slot_starts_at', p_slot_starts_at,
    'previous_status', v_app.status,
    'interviewer', jsonb_build_object(
      'admin_user_id', p_actor,
      'full_name', v_actor.full_name,
      'email', v_actor.email,
      'phone', v_phone
    ),
    'candidate', jsonb_build_object(
      'application_id', v_app.id,
      'full_name', v_app.full_name,
      'email', v_app.email_primary,
      'phone', v_app.phone_primary
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- 2. Chủ sở hữu và quyền gọi
-- ------------------------------------------------------------
-- `create or replace function` giữ nguyên ACL cũ, nhưng nói lại vẫn rẻ hơn
-- việc một ngày nào đó phát hiện hàm ghi đang mở cho anon.
alter function public.vam098_book_interview_slot(uuid, timestamptz) owner to postgres;
revoke all on function public.vam098_book_interview_slot(uuid, timestamptz) from public;
revoke all on function public.vam098_book_interview_slot(uuid, timestamptz) from anon, authenticated;
grant execute on function public.vam098_book_interview_slot(uuid, timestamptz) to service_role;

alter function public.vam099_match_mentor_at_hour(uuid, timestamptz) owner to postgres;
revoke all on function public.vam099_match_mentor_at_hour(uuid, timestamptz) from public;
revoke all on function public.vam099_match_mentor_at_hour(uuid, timestamptz) from anon, authenticated;
grant execute on function public.vam099_match_mentor_at_hour(uuid, timestamptz) to service_role;

-- ------------------------------------------------------------
-- 3. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ------------------------------------------------------------
do $invite_gate_self_check$
declare
  v_name   text;
  v_body   text;
  v_acl    text;
  v_status text;
begin
  foreach v_name in array array['vam098_book_interview_slot', 'vam099_match_mentor_at_hour'] loop
    select p.prosrc into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_body is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: mất hàm %', v_name;
    end if;

    -- Cửa mới đóng đúng chỗ.
    foreach v_status in array array[
      'submitted', 'under_data_check', 'ready_for_screening',
      'screening_assigned', 'screening_in_progress', 'screening_completed'
    ] loop
      if strpos(v_body, '''' || v_status || '''') > 0 then
        raise exception 'SCHEMA_CONTRACT_VIOLATION: % còn nhận trạng thái chưa qua vòng hồ sơ: %', v_name, v_status;
      end if;
    end loop;
    foreach v_status in array array['screening_passed', 'invited_to_interview', 'interview_scheduled'] loop
      if strpos(v_body, '''' || v_status || '''') = 0 then
        raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất trạng thái %', v_name, v_status;
      end if;
    end loop;

    -- Và những gì bản cũ đã bảo vệ thì vẫn còn nguyên: chép thân hàm mà đánh
    -- rơi một trong các dòng này là cách hỏng lặng lẽ nhất.
    if position('vam063_trusted_api_role' in v_body) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất cổng ngữ cảnh máy chủ', v_name;
    end if;
    if position('vam084_operator_for_season(' in v_body) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % gọi vam084_operator_for_season trong security definer', v_name;
    end if;
    if position('skip locked' in v_body) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất phép chọn không nghẽn', v_name;
    end if;
    if position('available_since asc' in v_body) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất thứ tự ai-trước-được-trước', v_name;
    end if;
    if position('vam_os_form' in v_body) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất điều kiện nguồn đơn', v_name;
    end if;
    if position('review_round = ''interview''' in v_body) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất điều kiện chưa có phiếu phỏng vấn', v_name;
    end if;

    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name and p.prosecdef
    ) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % phải là security definer', v_name;
    end if;

    select array_to_string(p.proacl, ' ') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_acl is not null and (position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0) then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % còn cấp quyền gọi cho anon/authenticated', v_name;
    end if;
  end loop;
end
$invite_gate_self_check$;

notify pgrst, 'reload schema';

commit;
