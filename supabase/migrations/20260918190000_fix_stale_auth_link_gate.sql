-- Sửa cổng quyền của hàm gỡ liên kết Auth đã chết.
--
-- Migration 20260918100000 tạo `vam084_clear_stale_recruitment_auth_link` là hàm
-- SECURITY DEFINER (bắt buộc: service_role không đọc được auth.users), nhưng bên
-- trong lại gọi `vam084_staffing_operator_for_season`. Hàm đó — và
-- `vam084_operator_for_season` bên dưới nó — đòi `current_user = 'service_role'`.
-- Trong một hàm SECURITY DEFINER thuộc sở hữu postgres, `current_user` là postgres,
-- nên phép kiểm luôn trả về false và hàm luôn raise.
--
-- Hậu quả trên Production 18/09/2026: bấm "Cấp quyền đánh giá" cho người có liên
-- kết Auth đã chết thì lệnh gỡ bị từ chối (app chỉ ghi log, không chặn lượt cấp
-- quyền), rồi lệnh cấp quyền vẫn hỏng vì liên kết chưa được gỡ. Đo read-only:
-- 0 dòng nhật ký 'clear_stale_auth_link', 1 tài khoản vẫn mang liên kết chết.
--
-- Cách sửa: kiểm "gọi từ máy chủ tin cậy" bằng `vam063_trusted_api_role()` — đọc
-- claim của request chứ không đọc `current_user`, đúng cách mà họ vam063 đã làm bên
-- trong các hàm SECURITY DEFINER — và kiểm vai trò + phạm vi mùa ngay tại đây, đúng
-- tập vai trò mà `vam084_staffing_operator_for_season` mô tả.
--
-- Hoàn nguyên: chạy lại 20260918100000 để lấy bản cũ (bản cũ không gỡ được gì).

begin;

set local lock_timeout = '10s';

do $preflight$
begin
  if to_regprocedure('public.vam084_clear_stale_recruitment_auth_link(uuid, uuid, uuid)') is null then
    raise exception 'PRECONDITION: chưa có hàm gỡ liên kết để sửa';
  end if;
  if to_regprocedure('public.vam063_trusted_api_role()') is null then
    raise exception 'PRECONDITION: thiếu vam063_trusted_api_role';
  end if;
  if position('vam084_staffing_operator_for_season(' in (
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam084_clear_stale_recruitment_auth_link'
  )) = 0 then
    raise notice 'Hàm gỡ liên kết đã không còn dùng cổng quyền cũ; migration này chạy lại vô hại.';
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
  v_api_role text;
  v_email text;
  v_admin_id uuid;
  v_auth_user_id uuid;
begin
  -- Gọi từ máy chủ ứng dụng, không phải từ một phiên bất kỳ. Đọc claim của request:
  -- `current_user` ở đây luôn là chủ sở hữu hàm, nên nó không nói được điều gì.
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  -- Đúng tập vai trò của vam084_staffing_operator_for_season, viết thẳng ở đây vì
  -- hàm đó hỏi current_user và câu trả lời trong ngữ cảnh này luôn sai.
  if not exists (
    select 1
    from public.admin_users au
    where au.id = p_actor
      and au.status = 'active'
      and (
        au.role = 'super_admin'
        or (
          au.role in ('admin', 'core_team', 'support_team')
          and exists (
            select 1
            from public.admin_scope_access asa
            where asa.user_id = au.auth_user_id
              and asa.status = 'active'
              and asa.season_id = p_season_id::text
              and asa.role in ('operations', 'full_access')
          )
        )
      )
  ) then
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
  v_def text;
  v_acl text;
  v_secdef boolean;
  v_stale integer;
begin
  select pg_get_functiondef(p.oid), coalesce(p.proacl::text, ''), p.prosecdef
    into v_def, v_acl, v_secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam084_clear_stale_recruitment_auth_link';

  if v_def is null then
    raise exception 'SELF_CHECK: hàm gỡ liên kết biến mất';
  end if;
  if not v_secdef then
    raise exception 'SELF_CHECK: hàm phải là SECURITY DEFINER thì mới đọc được auth.users';
  end if;
  if v_acl not like '%service_role=X%' or v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'SELF_CHECK: quyền chạy hàm không đúng';
  end if;
  if position('vam063_trusted_api_role' in v_def) = 0 then
    raise exception 'SELF_CHECK: hàm chưa kiểm ngữ cảnh gọi bằng claim của request';
  end if;
  -- Tìm LỜI GỌI, không tìm cái tên: chú thích trong thân hàm có nhắc tên phép kiểm
  -- cũ để nói vì sao không dùng nó, và phép tìm theo tên trần sẽ tưởng đó là lời gọi.
  -- Đó chính là lỗi làm lần dán đầu tiên của file này bị raise và tự hoàn nguyên.
  if position('vam084_staffing_operator_for_season(' in v_def) > 0
     or position('vam084_operator_for_season(' in v_def) > 0 then
    raise exception 'SELF_CHECK: hàm vẫn gọi phép kiểm phụ thuộc current_user';
  end if;
  if position('u.id = v_auth_user_id' in v_def) = 0 then
    raise exception 'SELF_CHECK: mất phép kiểm liên kết đã chết';
  end if;

  select count(*) into v_stale
  from public.admin_users au
  where au.auth_user_id is not null
    and not exists (select 1 from auth.users u where u.id = au.auth_user_id);
  raise notice 'Còn % tài khoản quản trị trỏ tới tài khoản đăng nhập đã bị xoá; lần bấm cấp quyền kế tiếp sẽ gỡ.', v_stale;
end
$self_check$;

commit;
