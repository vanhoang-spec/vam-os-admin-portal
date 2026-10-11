-- Màn hình phỏng vấn mentee: bảng gọn + hồ sơ chi tiết tải riêng.
--
-- 11/10/2026: database production tự khởi động lại 6 lần trong ngày phỏng vấn.
-- vam104_offline_dashboard trả về MỌI ứng viên đã đặt ca của cả mùa (902 bạn),
-- mỗi bạn kèm nguyên đơn đăng ký (raw_payload) và mọi phiếu chấm: khoảng 11 MB
-- cho mỗi lần gọi. Màn hình phỏng vấn gọi lại nó sau mỗi thao tác của mỗi người,
-- trang Tiến độ gọi lại mỗi 15 giây; máy database 1 GB không chịu nổi.
--
-- Hai hàm mới, cùng cổng quyền vam104_offline_access với hàm cũ:
--
--   vam118_offline_board            danh sách: chỉ các cột của bảng, lọc được theo
--                                   ca (một đợt), không đơn đăng ký, không phiếu chấm.
--   vam118_offline_candidate_detail đơn đăng ký + phiếu chấm đầy đủ của MỘT bạn,
--                                   màn hình gọi khi mở hồ sơ bạn đó.
--
-- vam104_offline_dashboard GIỮ NGUYÊN: báo cáo phỏng vấn theo đợt vẫn đọc nó (mở
-- thưa, cần cả đơn lẫn phiếu), và bản mã đang chạy vẫn gọi nó cho tới khi bản mới
-- lên — dán file này trước khi merge không làm gãy gì.
--
-- Dán lại không sao: chỉ create or replace.

-- Danh sách cho màn hình phỏng vấn và trang Tiến độ.
--   p_sessions  null = mọi ca của mùa; có giá trị = chỉ ứng viên đang giữ các ca đó.
--   p_with_logs false = bỏ nhật ký thao tác (trang Tiến độ không dùng).
-- 'takeSubmitted' thay cho việc gửi cả phiếu chỉ để đếm: mentor đã nộp phiếu chọn
-- "Có – Tôi muốn nhận" cho bạn này chưa (màn hình khoá lựa chọn thứ ba; database
-- vẫn tự kiểm bằng TAKE_LIMIT_REACHED lúc lưu).
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

-- Hồ sơ chi tiết của một ứng viên đang giữ ca trong mùa: đơn đăng ký và mọi phiếu
-- chấm chưa huỷ — đúng hai phần vam104_offline_dashboard từng gửi kèm cho TỪNG bạn.
-- Không còn ca đang hiệu lực (đã huỷ lịch, hồ sơ mùa khác) thì NO_BOOKING: cùng
-- phạm vi với danh sách, không mở được hồ sơ của ai ngoài danh sách đó.
create or replace function public.vam118_offline_candidate_detail(
  p_actor uuid,
  p_season uuid,
  p_application uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_detail jsonb;
begin
  if not public.vam104_offline_access(p_actor,p_season) then raise exception 'ACCESS_DENIED'; end if;
  select jsonb_build_object(
    'id',a.id,
    'rawPayload',a.raw_payload,
    'reviews',coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewerName',coalesce(u.full_name,u.email)) order by r.created_at)
      from public.application_reviews r left join public.admin_users u on u.id=r.reviewer_admin_user_id
      where r.application_id=a.id and r.status<>'cancelled'),'[]'::jsonb)
  ) into v_detail
  from public.mentee_interview_bookings b join public.applications a on a.id=b.application_id
  where b.season_id=p_season and b.status='booked' and b.application_id=p_application
  limit 1;
  if v_detail is null then raise exception 'NO_BOOKING'; end if;
  return v_detail;
end;
$function$;

revoke all on function public.vam118_offline_board(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.vam118_offline_board(uuid,uuid,uuid[],boolean) to service_role;
revoke all on function public.vam118_offline_candidate_detail(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.vam118_offline_candidate_detail(uuid,uuid,uuid) to service_role;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.vam118_offline_board(uuid,uuid,uuid[],boolean)',
    'public.vam118_offline_candidate_detail(uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Thiếu hàm %', v_fn;
    end if;
    if (select prosecdef from pg_proc where oid = to_regprocedure(v_fn)) then
      raise exception '% phải chạy bằng quyền người gọi', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '% đang mở cho anon/authenticated', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'service_role chưa gọi được %', v_fn;
    end if;
  end loop;
  -- Hàm cũ phải còn: báo cáo phỏng vấn và bản mã đang chạy vẫn gọi nó.
  if to_regprocedure('public.vam104_offline_dashboard(uuid,uuid)') is null then
    raise exception 'vam104_offline_dashboard đã bị gỡ — báo cáo phỏng vấn sẽ hỏng';
  end if;
end $$;
