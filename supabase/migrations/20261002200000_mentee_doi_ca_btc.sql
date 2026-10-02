-- ============================================================
-- 20261002200000_mentee_doi_ca_btc.sql
-- ============================================================
--
-- BTC (Core Team, Support team có quyền vận hành mùa) ĐỔI CA phỏng vấn cho một
-- mentee — kể cả SAU hạn tự đổi ca (booking_closes_at, 17:00 02/10/2026). Mentee
-- bận đột xuất nhắn BTC; BTC chuyển giúp trên màn hình Phỏng vấn mentee trực tiếp.
--
-- vam107_move_mentee_booking làm đúng việc vam102 (mentee tự đổi qua link) làm,
-- chỉ khác: cổng là quyền vận hành mùa thay vì token, KHÔNG xét hạn đổi ca, và bắt
-- buộc lý do. Giữ nguyên mọi chặn còn lại: ca mới cùng mùa, đang mở, có số ghế,
-- chưa bắt đầu, còn chỗ (khoá dòng ca mới trước khi đếm); mentee chưa check-in.
-- Ca mới kín thì DỪNG — ca cũ chưa hề bị chạm tới.
--
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge PR.

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'vam104_offline_access')
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'mentee_interview_bookings' and column_name = 'cancel_note') then
    raise exception 'Cần chạy 20261002100000_mentee_phong_van_theo_mua.sql trước';
  end if;
end $$;

create or replace function public.vam107_move_mentee_booking(
  p_actor uuid, p_application uuid, p_session uuid, p_reason text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  a public.applications%rowtype;
  b public.mentee_interview_bookings%rowtype;
  s_new public.interview_sessions%rowtype;
  s_old public.interview_sessions%rowtype;
  v_reason text;
  v_taken integer;
  v_booking uuid;
  v_name text;
  v_old_label text;
  v_new_label text;
begin
  if current_user <> 'service_role' then raise exception 'ACCESS_DENIED'; end if;
  -- Khoá dòng đơn trước: hai BTC cùng đổi ca một mentee sẽ nối đuôi nhau.
  select * into a from public.applications where id=p_application for update;
  if a.id is null or a.role_applied::text<>'mentee' or not public.vam104_offline_access(p_actor,a.season_id,true)
    then raise exception 'ACCESS_DENIED'; end if;
  v_reason:=nullif(btrim(p_reason),'');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if length(v_reason)>500 then raise exception 'TEXT_TOO_LONG'; end if;

  select * into b from public.mentee_interview_bookings where application_id=a.id and status='booked' for update;
  if b.id is null then raise exception 'NO_BOOKING'; end if;
  if exists(select 1 from public.mentee_interview_operations where id=a.id and checked_in_at is not null)
    then raise exception 'ALREADY_CHECKED_IN'; end if;
  if b.session_id=p_session then raise exception 'SAME_SESSION'; end if;

  -- Ca MỚI được khoá trước khi đếm chỗ: hai lần đổi cùng lúc vào ca còn một chỗ
  -- không cùng lọt qua phép đếm.
  select * into s_new from public.interview_sessions where id=p_session and season_id=a.season_id for update;
  if s_new.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  -- Không xét booking_closes_at — đó là lý do có hàm này.
  if s_new.status<>'open' or s_new.seat_limit is null then raise exception 'SESSION_NOT_OPEN'; end if;
  if s_new.starts_at<=now() then raise exception 'SESSION_IN_PAST'; end if;
  select count(*) into v_taken from public.mentee_interview_bookings where session_id=s_new.id and status='booked';
  if v_taken>=s_new.seat_limit then raise exception 'SESSION_FULL'; end if;

  -- Nhả chỗ cũ rồi ghi chỗ mới trong cùng transaction — chỉ số
  -- mentee_interview_bookings_active_uidx đòi đúng thứ tự này.
  update public.mentee_interview_bookings
    set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancel_note='BTC đổi ca: '||v_reason
    where id=b.id;
  insert into public.mentee_interview_bookings(session_id,application_id,season_id,previous_application_status)
    values(s_new.id,a.id,a.season_id,b.previous_application_status)
    returning id into v_booking;
  -- Dòng vận hành (nếu đã có, chưa check-in) đi theo ca mới.
  update public.mentee_interview_operations set session_id=s_new.id,updated_at=now()
    where id=a.id and checked_in_at is null;

  select * into s_old from public.interview_sessions where id=b.session_id;
  v_old_label:=coalesce(to_char(s_old.starts_at at time zone 'Asia/Ho_Chi_Minh','DD/MM/YYYY HH24:MI'),'?');
  v_new_label:=to_char(s_new.starts_at at time zone 'Asia/Ho_Chi_Minh','DD/MM/YYYY HH24:MI');
  select coalesce(full_name,email) into v_name from public.admin_users where id=p_actor;
  insert into public.application_decisions(application_id,decided_by,decided_by_name,decision,previous_status,new_status,decision_note)
    values(a.id,p_actor,v_name,'interview_scheduled',a.status,a.status,
      'BTC đổi ca phỏng vấn: '||v_old_label||' → '||v_new_label||' (giờ Việt Nam). Lý do: '||v_reason);
  insert into public.mentee_interview_operation_log(application_id,actor_id,action,reason,before_data,after_data)
    values(a.id,p_actor,'move_booking',v_reason,
      jsonb_build_object('booking',to_jsonb(b)),
      jsonb_build_object('booking',jsonb_build_object('id',v_booking,'session_id',s_new.id,'status','booked')));
  return jsonb_build_object('ok',true,
    'message','Đã đổi ca của '||coalesce(a.full_name,'ứng viên')||': '||v_old_label||' → '||v_new_label||'.');
end;
$$;
revoke all on function public.vam107_move_mentee_booking(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.vam107_move_mentee_booking(uuid,uuid,uuid,text) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'vam107_move_mentee_booking') then
    raise exception 'vam107_move_mentee_booking chưa được tạo';
  end if;
  if has_function_privilege('anon', 'public.vam107_move_mentee_booking(uuid,uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.vam107_move_mentee_booking(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'vam107_move_mentee_booking đang mở cho anon/authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
