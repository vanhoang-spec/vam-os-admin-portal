-- Cấp lại quyền tuyển sinh cho người mà tài khoản đăng nhập cũ đã bị xoá.
--
-- 18/09/2026, production: một mentor (đúng một người trong toàn hệ thống) có dòng
-- `admin_users` trỏ tới một `auth.users` không còn tồn tại. Mỗi lần bấm "Cấp quyền
-- đánh giá", app tạo tài khoản đăng nhập mới rồi gọi
-- `vam084_grant_recruitment_participation`; hàm đó thấy email đã gắn với một Auth id
-- khác nên raise 'Account email is linked to a different Auth identity', app xoá tài
-- khoản vừa tạo và hiện một câu chung chung. Bấm lại bao nhiêu lần cũng vậy.
--
-- Hàm dưới đây gỡ ĐÚNG liên kết đã chết, và chỉ khi nó đã chết: còn dòng trong
-- auth.users thì đây là liên kết thật, không được đụng vào. Phải SECURITY DEFINER
-- vì service_role không đọc được auth.users (đo trên production: has_table_privilege
-- = false), nên app không tự kiểm được điều kiện này.
--
-- Không xoá dòng nào, không tạo tài khoản nào, không đụng vai trò hay trạng thái.
--
-- Hoàn nguyên:
--   drop function if exists public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid);
-- Liên kết đã gỡ thì không cần khôi phục: app ghi lại auth_user_id mới ngay ở lần
-- cấp quyền kế tiếp, và mỗi lần gỡ đều có một dòng trong admin_audit_log.

begin;

set local lock_timeout = '10s';

do $preflight$
begin
  if to_regprocedure('public.vam084_staffing_operator_for_season(uuid, uuid)') is null then
    raise exception 'PRECONDITION: thiếu vam084_staffing_operator_for_season';
  end if;
  if to_regprocedure('public.vam084_grant_recruitment_participation(uuid, uuid, uuid, text, uuid, text)') is null then
    raise exception 'PRECONDITION: thiếu vam084_grant_recruitment_participation';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_users' and column_name = 'auth_user_id'
  ) then
    raise exception 'PRECONDITION: admin_users không có cột auth_user_id';
  end if;
end
$preflight$;

create or replace function public.vam084_clear_stale_recruitment_auth_link(
  p_actor uuid,
  p_person_id uuid,
  p_season_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email text;
  v_admin_id uuid;
  v_auth_user_id uuid;
begin
  -- Cùng một cổng quyền với lệnh cấp quyền: thao tác viên phải vận hành được mùa này.
  if not public.vam084_staffing_operator_for_season(p_actor, p_season_id) then
    raise exception 'Stale auth link clear rejected';
  end if;

  select lower(btrim(p.email_primary)) into v_email
  from public.people p
  where p.id = p_person_id;
  if v_email is null or v_email = '' then
    return false;
  end if;

  select au.id, au.auth_user_id into v_admin_id, v_auth_user_id
  from public.admin_users au
  where lower(btrim(au.email)) = v_email
  for update;

  if v_admin_id is null or v_auth_user_id is null then
    return false;
  end if;

  -- Tài khoản đăng nhập vẫn còn: đây là liên kết thật của người ta. Gỡ nó là mở
  -- đường cho một tài khoản khác nhận email này.
  if exists (select 1 from auth.users u where u.id = v_auth_user_id) then
    return false;
  end if;

  update public.admin_users
     set auth_user_id = null,
         updated_at = now()
   where id = v_admin_id
     and auth_user_id = v_auth_user_id;
  if not found then
    return false;
  end if;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
  ) values (
    p_actor, v_admin_id, 'update_admin_user_access',
    jsonb_build_object('auth_user_id', v_auth_user_id),
    jsonb_build_object('auth_user_id', null),
    jsonb_build_object(
      'operation', 'clear_stale_auth_link',
      'person_id', p_person_id,
      'season_id', p_season_id
    )
  );

  return true;
end;
$function$;

alter function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) owner to postgres;

revoke all on function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) from public;
revoke all on function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) from anon;
revoke all on function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) from authenticated;
grant execute on function public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid) to service_role;

do $self_check$
declare
  v_secdef boolean;
  v_acl text;
  v_stale integer;
begin
  select p.prosecdef, coalesce(p.proacl::text, '')
    into v_secdef, v_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam084_clear_stale_recruitment_auth_link';

  if v_secdef is null then
    raise exception 'SELF_CHECK: hàm chưa được tạo';
  end if;
  if not v_secdef then
    raise exception 'SELF_CHECK: hàm phải là SECURITY DEFINER thì mới đọc được auth.users';
  end if;
  if v_acl not like '%service_role=X%' then
    raise exception 'SELF_CHECK: service_role chưa được cấp quyền chạy hàm';
  end if;
  if v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'SELF_CHECK: anon hoặc authenticated không được chạy hàm này';
  end if;

  select count(*) into v_stale
  from public.admin_users au
  where au.auth_user_id is not null
    and not exists (select 1 from auth.users u where u.id = au.auth_user_id);
  raise notice 'Còn % tài khoản quản trị trỏ tới tài khoản đăng nhập đã bị xoá; lần cấp quyền kế tiếp sẽ tự gỡ.', v_stale;
end
$self_check$;

commit;
