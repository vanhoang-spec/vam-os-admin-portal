-- BTC 10/10/2026 — Core team sửa được SỐ MENTEE TỐI ĐA một mentor nhận trong mùa, ngay
-- trên hồ sơ của mentor. Dán trên Production TRƯỚC khi merge.
--
-- Con số này đã có sẵn: mentor_profiles.capacity_target, ghi lúc duyệt đơn / gia hạn từ
-- câu trả lời của chính mentor, và là con số trigger vam104_match_capacity_guard cùng
-- Vòng 2 đang cưỡng chế. Trước nay không có đường nào sửa nó ngoài SQL tay. File này
-- thêm ĐÚNG MỘT đường ghi hẹp:
--
--   vam116_set_mentor_capacity(actor, mùa, người, số đang thấy, số mới)
--
--   * chỉ chạm cột capacity_target của đúng một hồ sơ mentor;
--   * cổng vam084_operator_for_season: Core team trở lên, có quyền vận hành mùa;
--   * người đó phải đang là mentor "active" của mùa — quyền theo mùa thì chỉ sửa người của mùa;
--   * cùng khoá với mọi đường tạo cặp (VAM104_MATCH|mùa): không hạ trần giữa lúc một
--     mentor đang được ghép;
--   * không cho đặt thấp hơn số mentee mentor đang nhận trong mùa — muốn hạ thì huỷ cặp trước;
--   * số đang thấy trên màn hình đã khác trong database thì dừng (hai người sửa cùng lúc);
--   * mỗi lần đổi ghi một dòng admin_audit_log (action_type có sẵn: update_mentor_profile).
--
-- Không đổi bảng, không đổi trigger, không đổi dữ liệu.

do $precheck$
begin
  if to_regprocedure('public.vam084_operator_for_season(uuid,uuid)') is null
     or to_regclass('public.mentor_profiles') is null
     or to_regclass('public.person_season_memberships') is null
     or to_regclass('public.matches') is null
     or to_regclass('public.admin_audit_log') is null then
    raise exception 'PREREQ_MISSING: cần vam084_operator_for_season, mentor_profiles, person_season_memberships, matches, admin_audit_log';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mentor_profiles'
      and column_name = 'capacity_target' and data_type = 'integer'
  ) then
    raise exception 'PREREQ_MISSING: mentor_profiles.capacity_target (integer)';
  end if;
  -- Dòng log dùng action_type có sẵn; nếu ràng buộc trên Production không còn nhận giá
  -- trị này thì hàm sẽ hỏng lúc lưu — phát hiện ở đây, không phải lúc BTC bấm nút.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_audit_log'::regclass
      and conname = 'admin_audit_log_action_type_check'
      and position('''update_mentor_profile''' in pg_get_constraintdef(oid)) > 0
  ) then
    raise exception 'PREREQ_MISSING: admin_audit_log_action_type_check không nhận update_mentor_profile';
  end if;
end $precheck$;

create or replace function public.vam116_set_mentor_capacity(
  p_actor uuid, p_season uuid, p_person uuid, p_expected integer, p_capacity integer
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_profile public.mentor_profiles%rowtype;
  v_profiles integer;
  v_active integer;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if p_capacity is null or p_capacity not between 1 and 10 then raise exception 'INVALID_CAPACITY'; end if;

  -- Cùng khoá với trigger vam104_match_capacity_guard và Vòng 2: trần và số cặp không
  -- đổi chéo nhau trong lúc đang kiểm.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || p_season::text, 0));

  if not exists (
    select 1 from public.person_season_memberships m
    where m.person_id = p_person and m.season_id = p_season and m.role = 'mentor' and m.status = 'active'
  ) then
    raise exception 'NOT_SEASON_MENTOR';
  end if;

  select count(*) into v_profiles from public.mentor_profiles where person_id = p_person;
  if v_profiles <> 1 then raise exception 'MENTOR_IDENTITY_AMBIGUOUS'; end if;
  select * into v_profile from public.mentor_profiles where person_id = p_person for update;

  if v_profile.capacity_target is distinct from p_expected then raise exception 'STALE_CAPACITY'; end if;

  select count(*) into v_active from public.matches x
  where x.season_id = p_season and x.mentor_person_id = p_person and x.status = 'active';
  if p_capacity < v_active then raise exception 'CAPACITY_BELOW_ACTIVE'; end if;

  if v_profile.capacity_target is not distinct from p_capacity then
    return jsonb_build_object('ok', true, 'changed', false, 'capacity', p_capacity, 'active', v_active);
  end if;

  update public.mentor_profiles
     set capacity_target = p_capacity, updated_at = now()
   where id = v_profile.id;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
  ) values (
    p_actor, null, 'update_mentor_profile',
    jsonb_build_object('capacity_target', v_profile.capacity_target),
    jsonb_build_object('capacity_target', p_capacity),
    jsonb_build_object('field', 'capacity_target', 'person_id', p_person, 'mentor_profile_id', v_profile.id,
                       'season_id', p_season, 'active_matches', v_active)
  );

  return jsonb_build_object('ok', true, 'changed', true, 'capacity', p_capacity,
                            'previous', v_profile.capacity_target, 'active', v_active);
end;
$function$;

revoke all on function public.vam116_set_mentor_capacity(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.vam116_set_mentor_capacity(uuid, uuid, uuid, integer, integer) to service_role;

do $self_check$
declare
  v_sig constant text := 'public.vam116_set_mentor_capacity(uuid,uuid,uuid,integer,integer)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu vam116_set_mentor_capacity';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if exists (select 1 from pg_proc where oid = v_sig::regprocedure and prosecdef) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam116_set_mentor_capacity không được là SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam116_set_mentor_capacity đang mở cho anon/authenticated';
  end if;
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: service_role chưa gọi được vam116_set_mentor_capacity';
  end if;
  if position('vam084_operator_for_season(p_actor, p_season)' in v_def) = 0
     or position('VAM104_MATCH|' in v_def) = 0
     or position('p_capacity not between 1 and 10' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam116_set_mentor_capacity thiếu cổng, khoá hoặc cận 1..10';
  end if;
end $self_check$;

notify pgrst, 'reload schema';

select 'vam116_set_mentor_capacity đã có; chưa đổi dữ liệu nào' as ket_qua,
       count(*) filter (where capacity_target is null) as mentor_chua_khai_suc_nhan,
       count(*) filter (where capacity_target = 1) as nhan_1,
       count(*) filter (where capacity_target = 2) as nhan_2,
       count(*) filter (where capacity_target >= 3) as nhan_3_tro_len
from public.mentor_profiles mp
where exists (
  select 1 from public.person_season_memberships m
  join public.seasons s on s.id = m.season_id
  where m.person_id = mp.person_id and m.role = 'mentor' and m.status = 'active' and s.code = 'UEHM-S12'
);
