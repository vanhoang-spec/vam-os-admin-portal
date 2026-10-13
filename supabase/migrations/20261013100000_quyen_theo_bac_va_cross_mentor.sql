-- ═══════════════════════════════════════════════════════════════════════════
-- Quyền tài khoản theo bậc ở tầng database, và vai trò Cross mentor trong mùa
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BTC 13/10/2026: admin đổi được thành viên Core team; Core team trở lên bổ
-- nhiệm được trainer và cross mentor cho mentor.
--
-- ───────────────────────────────────────────────────────────────────────────
-- 1. VÌ SAO PHẢI SỬA Ở DATABASE
-- ───────────────────────────────────────────────────────────────────────────
--
-- Từ 20/09/2026 mã đã theo bậc "admin quản Core team, Core team quản Support
-- team": trang /admin/users mở cho cả ba cấp, từng dòng có nút Sửa / Tạm khoá /
-- Gỡ quyền. Nhưng mọi nút đó đi qua `vam062_admin_mutation_atomic`, và dòng đầu
-- tiên của hàm này vẫn là "người gọi phải là super_admin". Chỉ riêng nút Xoá đi
-- đường khác (`vam097_delete_admin_account`) nên mới theo đúng bậc.
--
-- Hệ quả: admin và Core team thấy nút, bấm, và nhận "Không thể cập nhật tài
-- khoản và audit trong cùng giao dịch". Nhật ký xác nhận điều đó — tới 13/10,
-- mọi dòng create/update/reactivate_admin_user đều do super admin ghi; chưa có
-- dòng nào của admin hay Core team. Bốn cổng không bắt được vì test của tầng mã
-- dùng database giả, mà database giả thì nói "được".
--
-- Migration này đưa đúng bảng bậc của `vam097_delete_admin_account` vào bốn hàm
-- vam062. Thân hàm chép nguyên từ bản đang chạy trên production (đã đối chiếu
-- md5 từng hàm ngày 13/10/2026), chỉ thay phần cổng.
--
--   super_admin  như cũ, không đổi gì
--   admin        sửa / tạm khoá / gỡ quyền / TẠO: core_team, support_team,
--                reviewer, viewer
--   core_team    sửa / tạm khoá / gỡ quyền: support_team, reviewer, viewer
--                (không tạo tài khoản)
--
-- Ba điều cổng mới giữ mà cổng cũ không cần giữ, vì trước đây chỉ có super admin:
--   • không ai dưới super admin tự sửa chính mình — cấp của mình không bao giờ
--     nằm trong danh sách mình quản, nên bảng bậc tự chặn, không cần dòng riêng;
--   • không đặt cho ai một cấp mình không quản được — Core team sửa một tài
--     khoản Support team thành admin là tự dựng cho mình một cấp trên;
--   • phạm vi mùa cấp kèm không vượt cấp của tài khoản — reviewer không nhận
--     được scope "operations", Core team không nhận được "full_access".
--
-- "Đồng bộ Auth" (link_auth) vẫn chỉ của super admin, như ở tầng mã.
--
-- ───────────────────────────────────────────────────────────────────────────
-- 2. CROSS MENTOR LÀ MỘT VAI TRÒ TRONG MÙA
-- ───────────────────────────────────────────────────────────────────────────
--
-- Cùng lối với Trainer và Speaker (20260912100000): một dòng
-- `person_season_memberships`, thêm tay từ hồ sơ CRM, hiện trên hồ sơ và lọc
-- được theo mùa. Phải nới HAI ràng buộc CHECK (bảng membership và bảng log),
-- nới một thì dòng log bị chặn và cả transaction quay lui.
--
-- Bổ nhiệm trainer và cross mentor là việc của Core team trở lên. Tầng mã đã
-- chặn; hàm ghi chặn lại lần nữa, vì `vam063_authorized_for_scope` chỉ hỏi
-- phạm vi mùa — mà Support team có đúng phạm vi đó.
--
-- Chạy lại nhiều lần được.
-- ═══════════════════════════════════════════════════════════════════════════

do $preflight$
declare
  missing text[] := '{}';
  fn      text;
begin
  if to_regclass('public.admin_users') is null then missing := missing || 'bảng admin_users'; end if;
  if to_regclass('public.admin_scope_access') is null then missing := missing || 'bảng admin_scope_access'; end if;
  if to_regclass('public.admin_audit_log') is null then missing := missing || 'bảng admin_audit_log'; end if;
  if to_regclass('public.account_auth_operations') is null then missing := missing || 'bảng account_auth_operations'; end if;
  if to_regclass('public.person_season_memberships') is null then missing := missing || 'bảng person_season_memberships'; end if;
  if to_regclass('public.person_season_membership_log') is null then missing := missing || 'bảng person_season_membership_log'; end if;
  foreach fn in array array[
    'public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)',
    'public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid)',
    'public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)',
    'public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)',
    'public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_authorized_for_scope(uuid,uuid,uuid)',
    'public.vam063_trusted_api_role()'
  ] loop
    if to_regprocedure(fn) is null then missing := missing || ('hàm ' || fn); end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'PREFLIGHT_FAILED: chưa có %', array_to_string(missing, '; ');
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- Bảng bậc — một chỗ, dùng cho mọi hàm vam062
-- ───────────────────────────────────────────────────────────────────────────
--
-- Cùng bảng với MANAGEABLE_ADMIN_ROLES trong lib/permissions.ts và với
-- vam097_delete_admin_account. super_admin KHÔNG có dòng ở đây: các hàm gọi cho
-- super admin đi thẳng như trước, không qua bảng này.
--
-- Vai trò đích NULL hoặc lạ trả về false: thiếu thông tin là KHÔNG.
create or replace function public.vam120_account_tier_allows(p_actor_role text, p_target_role text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(
    case p_actor_role
      when 'admin'     then p_target_role in ('core_team', 'support_team', 'reviewer', 'viewer')
      when 'core_team' then p_target_role in ('support_team', 'reviewer', 'viewer')
      else false
    end,
    false)
$function$;

-- Phạm vi mùa cao nhất một CẤP tài khoản được mang, khi người cấp không phải
-- super admin. Cùng thang với scopeRoleForAdminRole trong lib/admin-users.ts.
create or replace function public.vam120_scope_within_role(p_role text, p_scope_role text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(
    case p_role
      when 'core_team'    then p_scope_role in ('read', 'review', 'operations')
      when 'support_team' then p_scope_role in ('read', 'review', 'operations')
      when 'reviewer'     then p_scope_role in ('read', 'review')
      when 'viewer'       then p_scope_role in ('read')
      else false
    end,
    false)
$function$;

-- Hai hàm trên chỉ được gọi từ trong các hàm SECURITY DEFINER bên dưới (chạy
-- bằng quyền chủ sở hữu), nên không cấp cho vai trò API nào.
revoke all on function public.vam120_account_tier_allows(text, text) from public, anon, authenticated, service_role;
revoke all on function public.vam120_scope_within_role(text, text) from public, anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Sửa / tạm khoá / gỡ quyền / tạo tài khoản — theo bậc
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.vam062_admin_mutation_atomic(p_actor_admin_user_id uuid, p_operation text, p_target_admin_user_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target uuid; v_auth uuid; v_before jsonb; v_after jsonb; v_action text;
  v_program_id uuid; v_season_id uuid; v_scope_status text;
  v_actor_role text; v_target_role text;
begin
  select a.role into v_actor_role from public.admin_users a where a.id=p_actor_admin_user_id and a.status='active';
  if v_actor_role is null or v_actor_role not in ('super_admin','admin','core_team') then
    raise exception 'VAM062V3 unauthorized actor';
  end if;
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' then
    raise exception 'VAM062V3 trusted server context required';
  end if;

  -- Bậc quản lý (13/10/2026). Super admin đi thẳng như trước. Admin và Core
  -- team chỉ đụng được cấp THẤP hơn mình, và mọi thứ đọc từ dòng đang lưu chứ
  -- không từ payload: payload là thứ người gửi tự đặt được.
  if v_actor_role<>'super_admin' then
    if p_operation='upsert' then
      -- Tạo tài khoản: super admin và admin. Core team quản cấp dưới nhưng không tạo.
      if v_actor_role<>'admin' then
        raise exception 'VAM062V3 unauthorized actor';
      end if;
      -- 'upsert' ghi đè theo email. Không có dòng này thì admin "tạo" một tài
      -- khoản trùng email của super admin là hạ cấp được super admin.
      select a.role into v_target_role from public.admin_users a where a.email=lower(btrim(p_payload->>'email')) for update;
      if found and not public.vam120_account_tier_allows(v_actor_role,v_target_role) then
        raise exception 'VAM120 target above actor tier';
      end if;
    elsif p_operation in ('update','status','remove') then
      select a.role into v_target_role from public.admin_users a where a.id=p_target_admin_user_id for update;
      if not found then raise exception 'VAM062V3 target missing'; end if;
      if not public.vam120_account_tier_allows(v_actor_role,v_target_role) then
        raise exception 'VAM120 target above actor tier';
      end if;
    else
      -- link_auth và mọi thao tác khác: vẫn chỉ super admin.
      raise exception 'VAM062V3 unauthorized actor';
    end if;
    if p_operation in ('upsert','update') then
      if not public.vam120_account_tier_allows(v_actor_role,p_payload->>'role') then
        raise exception 'VAM120 role above actor tier';
      end if;
      if not public.vam120_scope_within_role(p_payload->>'role',p_payload->>'scope_role') then
        raise exception 'VAM120 scope above role';
      end if;
    end if;
  end if;

  if p_operation in ('upsert','update','link_auth') then
    if nullif(p_payload->>'season_id','') is null or nullif(p_payload->>'program_id','') is null then
      raise exception 'VAM062V3 explicit program and season required';
    end if;
    -- DEC-R1: these three operations only ever create or retarget an
    -- ACTIVE scope row. A caller-supplied scope_status is honored only when
    -- it is exactly 'active'; anything else fails closed before mutation
    -- rather than being silently ignored or silently applied.
    v_scope_status:=nullif(btrim(p_payload->>'scope_status'),'');
    if v_scope_status is not null and v_scope_status<>'active' then
      raise exception 'VAM062V3 scope_status must be active or omitted for this operation; use the dedicated status/remove operation to deactivate';
    end if;
    select p.id,s.id into v_program_id,v_season_id
    from public.programs p join public.seasons s on s.program_id=p.id
    where p.is_active
      and (p.id::text=p_payload->>'program_id' or p.code=p_payload->>'program_id')
      and (s.id::text=p_payload->>'season_id' or s.code=p_payload->>'season_id');
    if v_program_id is null or v_season_id is null then
      raise exception 'VAM062V3 invalid program-season relationship';
    end if;
  end if;

  if p_operation='upsert' then
    if p_payload->>'role' not in ('viewer','reviewer','support_team','core_team','admin','super_admin') then
      raise exception 'VAM062V3 invalid role';
    end if;
    select id,to_jsonb(a) into v_target,v_before from public.admin_users a where email=lower(btrim(p_payload->>'email'));
    insert into public.admin_users(auth_user_id,email,full_name,role,status)
      values((p_payload->>'auth_user_id')::uuid,lower(btrim(p_payload->>'email')),nullif(btrim(p_payload->>'full_name'),''),p_payload->>'role',p_payload->>'status')
      on conflict(email) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,role=excluded.role,status=excluded.status
      returning id,auth_user_id into v_target,v_auth;
    perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    v_action:=case when v_before is null then 'create_admin_user' else 'update_admin_user' end;

  elsif p_operation='update' then
    select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    update public.admin_users set full_name=nullif(btrim(p_payload->>'full_name'),''),role=p_payload->>'role',status=p_payload->>'status' where id=p_target_admin_user_id returning id into v_target;
    if nullif(p_payload->>'scope_id','') is not null then
      -- Explicit-scope-id retarget: role only, and only against a row that
      -- is currently active — this can never reactivate an inactive row or
      -- set any other status (DEC-R1 §4/§6).
      update public.admin_scope_access
        set role=p_payload->>'scope_role'
        where id=(p_payload->>'scope_id')::uuid and user_id=v_auth and program_id=v_program_id::text and season_id=v_season_id::text and status='active';
      if not found then raise exception 'VAM062V3 scope mismatch'; end if;
    else
      perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    end if;
    v_action:='update_admin_user';

  elsif p_operation='link_auth' then
    select to_jsonb(a) into v_before from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    update public.admin_users set auth_user_id=(p_payload->>'auth_user_id')::uuid where id=p_target_admin_user_id returning id,auth_user_id into v_target,v_auth;
    perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    v_action:='sync_auth';

  elsif p_operation in ('status','remove') then
    select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    -- DEC-04: admin_users.status stays active/inactive only.
    update public.admin_users set status=case when p_operation='remove' then 'inactive' else p_payload->>'status' end where id=p_target_admin_user_id returning id into v_target;
    -- Scoped to the specific program/season/role named in the payload
    -- rather than every scope row the user holds, consistent with DEC-02.
    if nullif(p_payload->>'season_id','') is not null and nullif(p_payload->>'program_id','') is not null and nullif(p_payload->>'scope_role','') is not null then
      select p.id,s.id into v_program_id,v_season_id
      from public.programs p join public.seasons s on s.program_id=p.id
      where (p.id::text=p_payload->>'program_id' or p.code=p_payload->>'program_id')
        and (s.id::text=p_payload->>'season_id' or s.code=p_payload->>'season_id');
      update public.admin_scope_access
        set status=case when p_operation='status' and p_payload->>'status'='active' then 'active' else 'inactive' end
        where user_id=v_auth and program_id=v_program_id::text and season_id=v_season_id::text and role=p_payload->>'scope_role';
    else
      update public.admin_scope_access set status='inactive' where user_id=v_auth and status='active';
    end if;
    v_action:=case when p_operation='remove' then 'remove_admin_access' when p_payload->>'status'='active' then 'reactivate_admin_user' else 'deactivate_admin_user' end;

  else
    raise exception 'VAM062V3 unsupported operation';
  end if;

  select to_jsonb(a) into v_after from public.admin_users a where id=v_target;
  insert into public.admin_audit_log(actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data) values(p_actor_admin_user_id,v_action,v_target,v_before,v_after);
end $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- Ba hàm nhật ký của luồng TẠO tài khoản — mở cho admin
-- ───────────────────────────────────────────────────────────────────────────
--
-- Luồng tạo ghi nhật ký từng bước TRƯỚC khi làm bước đó. Để nguyên ba hàm này
-- ở super admin thì admin dừng ngay bước đầu ("Khởi tạo nhật ký") và không có
-- gì được tạo — hàm ghi chính có mở cũng vô ích.
create or replace function public.vam062_record_auth_reconciliation(p_actor_admin_user_id uuid, p_operation_id uuid, p_identifier_hash text, p_action_type text, p_failure_class text, p_retry_status text, p_correlation_metadata jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role in ('super_admin','admin') and status='active') or p_retry_status not in ('required','resolved') then
    raise exception 'VAM062V3 reconciliation rejected';
  end if;
  insert into public.account_auth_reconciliation(operation_id,identifier_hash,action_type,failure_class,retry_status,correlation_metadata)
    values(p_operation_id,p_identifier_hash,p_action_type,p_failure_class,p_retry_status,coalesce(p_correlation_metadata,'{}'));
end $function$;

create or replace function public.vam062_begin_auth_operation(p_actor_admin_user_id uuid, p_operation_id uuid, p_operation_type text, p_identifier_hash text, p_retry_of uuid default null)
returns table(accepted boolean, existing_stage text)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role in ('super_admin','admin') and status='active') then
    raise exception 'VAM062V3 operation rejected';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  insert into public.account_auth_operations(operation_id,actor_admin_user_id,operation_type,identifier_hash,retry_of)
    values(p_operation_id,p_actor_admin_user_id,p_operation_type,p_identifier_hash,p_retry_of) on conflict do nothing;
  if found then
    return query select true,'created'::text;
  else
    return query select false,(select provider_stage from public.account_auth_operations where operation_id=p_operation_id);
  end if;
end $function$;

create or replace function public.vam062_record_auth_operation_stage(p_actor_admin_user_id uuid, p_operation_id uuid, p_stage text, p_ownership_state text, p_auth_user_id_hash text, p_delete_allowed boolean, p_failure_class text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role in ('super_admin','admin') and status='active') then
    raise exception 'VAM062V3 operation update rejected';
  end if;
  update public.account_auth_operations set
    pre_lookup_state=case p_stage when 'prelookup_zero' then 'zero' when 'preexisting' then 'one' when 'incomplete' then 'incomplete' when 'ambiguous' then case when provider_stage='not_started' then 'multiple' else pre_lookup_state end else pre_lookup_state end,
    preexisting_auth_user_id_hash=case when p_stage='preexisting' then p_auth_user_id_hash else preexisting_auth_user_id_hash end,
    provider_stage=case p_stage when 'provider_pending' then 'pending' when 'provider_explicit_id' then 'explicit_id' when 'not_found' then 'omitted_id' when 'failed' then 'failed' when 'ambiguous' then 'ambiguous' else provider_stage end,
    provider_auth_user_id_hash=case when p_stage in ('provider_explicit_id','ambiguous') and provider_stage<>'not_started' then p_auth_user_id_hash else provider_auth_user_id_hash end,
    ownership_state=p_ownership_state,
    delete_allowed=p_delete_allowed,
    application_stage=case p_stage when 'application_pending' then 'pending' when 'application_completed' then 'completed' when 'application_failed' then 'failed' else application_stage end,
    compensation_stage=case p_stage when 'compensation_pending' then 'pending' when 'compensation_completed' then 'completed' when 'compensation_failed' then 'failed' else compensation_stage end,
    reconciliation_state=case when p_stage='reconciliation_resolved' then 'resolved' when p_stage='reconciliation_required' or p_ownership_state in ('ambiguous','failed','incomplete') then 'required' else reconciliation_state end,
    failure_class=p_failure_class,
    updated_at=now()
  where operation_id=p_operation_id and actor_admin_user_id=p_actor_admin_user_id;
  if not found then raise exception 'VAM062V3 operation missing'; end if;
end $function$;

-- `create or replace` giữ chủ sở hữu và quyền đã cấp; cấp lại ở đây cho bản sao
-- mới, và `revoke` trước để không rộng hơn chủ đích.
revoke all on function public.vam062_admin_mutation_atomic(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.vam062_record_auth_reconciliation(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.vam062_begin_auth_operation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.vam062_record_auth_operation_stage(uuid, uuid, text, text, text, boolean, text) from public, anon, authenticated;

grant execute on function public.vam062_admin_mutation_atomic(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.vam062_record_auth_reconciliation(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.vam062_begin_auth_operation(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.vam062_record_auth_operation_stage(uuid, uuid, text, text, text, boolean, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Cross mentor: nới hai ràng buộc theo lối cộng thêm
-- ───────────────────────────────────────────────────────────────────────────
--
-- Đọc định nghĩa đang chạy rồi nối vào đuôi. Viết đè nghĩa là phải chép đúng
-- mười ba giá trị đã có; chép thiếu một cái thì từ đó vai trò ấy không ghi được
-- nữa và không có gì báo.
do $widen_membership_roles$
declare
  target    record;
  existing  text;
  rebuilt   text;
  applied   text;
  v         text;
begin
  for target in
    select * from (values
      ('public.person_season_memberships', 'person_season_memberships_role_check'),
      ('public.person_season_membership_log', 'person_season_membership_log_role_check')
    ) as t(tbl, con)
  loop
    select pg_get_constraintdef(c.oid)
      into existing
    from pg_constraint c
    where c.conrelid = target.tbl::regclass
      and c.conname = target.con;

    if existing is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy %', target.con;
    end if;

    -- Đã có rồi thì thôi: chạy lại lần hai không được nhân đôi giá trị.
    if position('''cross_mentor''' in existing) > 0 then
      continue;
    end if;

    rebuilt := regexp_replace(
      existing,
      '\]\)\)\)$',
      ', ''cross_mentor''::text])))'
    );

    if rebuilt = existing then
      raise exception
        'SCHEMA_CONTRACT_VIOLATION: % có dạng lạ, không nới được: %',
        target.con, existing;
    end if;

    execute format('alter table %s drop constraint %I', target.tbl, target.con);
    execute format('alter table %s add constraint %I %s',
                   target.tbl, target.con, replace(rebuilt, 'CHECK ', 'check '));

    -- Mọi giá trị có TRƯỚC khi nới phải còn nguyên sau khi nới — đọc lại từ
    -- chính ràng buộc vừa tạo, không tin chuỗi mình vừa dựng.
    select pg_get_constraintdef(c.oid)
      into applied
    from pg_constraint c
    where c.conrelid = target.tbl::regclass
      and c.conname = target.con;
    for v in select (regexp_matches(existing, '''([a-z_]+)''', 'g'))[1] loop
      if position('''' || v || '''' in coalesce(applied, '')) = 0 then
        raise exception 'SCHEMA_CONTRACT_VIOLATION: % đã MẤT giá trị cũ %', target.con, v;
      end if;
    end loop;
  end loop;
end;
$widen_membership_roles$;

-- ───────────────────────────────────────────────────────────────────────────
-- Hàm thêm vai trò: nhận cross_mentor; trainer và cross_mentor cần Core team
-- ───────────────────────────────────────────────────────────────────────────
--
-- Chép nguyên bản đang chạy trên production, đổi đúng khối kiểm vai trò.
create or replace function public.vam063_add_membership_role(
  p_actor_admin_user_id uuid,
  p_person_id uuid,
  p_program_id uuid,
  p_season_id uuid,
  p_role text,
  p_reason text
)
returns table(outcome_status text, membership_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_membership uuid; v_api_role text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM063 trusted server context required';
  end if;
  if not exists (select 1 from public.admin_users where id = p_actor_admin_user_id and status = 'active') then
    raise exception 'VAM063 unauthorized actor';
  end if;
  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, p_program_id, p_season_id) then
    raise exception 'VAM063 actor not authorized for this program-season scope';
  end if;
  if not exists (select 1 from public.programs p join public.seasons s on s.program_id = p.id
                  where p.id = p_program_id and p.is_active and s.id = p_season_id) then
    raise exception 'VAM063 invalid active program-season relationship';
  end if;
  if p_role not in ('mentor','mentee','trainer','speaker','cross_mentor') then
    raise exception 'VAM063 unsupported participant role';
  end if;
  -- Bổ nhiệm trainer / cross mentor: Core team trở lên (BTC 13/10/2026). Phép
  -- kiểm phạm vi ở trên không đủ — Support team có cùng phạm vi vận hành mùa.
  if p_role in ('trainer','cross_mentor') and not exists (
       select 1 from public.admin_users
        where id = p_actor_admin_user_id
          and role in ('super_admin','admin','core_team')) then
    raise exception 'VAM120 appointment requires core team';
  end if;
  -- UEHM/HAM and S11/S12 isolation: a person already holding a membership in a
  -- DIFFERENT program for this same season can never be reassigned by this path.
  if exists (select 1 from public.person_season_memberships
              where person_id = p_person_id and program_id <> p_program_id and season_id = p_season_id) then
    raise exception 'VAM063 cross-program reassignment denied';
  end if;

  perform pg_advisory_xact_lock(hashtext('VAM063_ROLE|' || p_person_id::text || '|' || p_season_id::text || '|' || p_role));
  select id into v_membership from public.person_season_memberships
   where person_id = p_person_id and season_id = p_season_id and role = p_role;
  if v_membership is not null then
    return query select 'noop'::text, v_membership;
    return;
  end if;

  insert into public.person_season_memberships (person_id, program_id, season_id, role, status, source, created_by)
  values (p_person_id, p_program_id, p_season_id, p_role, 'active', 'manual', p_actor_admin_user_id)
  returning id into v_membership;

  insert into public.person_season_membership_log
    (membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
  values
    (v_membership, p_person_id, p_program_id, p_season_id, p_role, null, 'active', 'created', p_reason, p_actor_admin_user_id);

  insert into public.admin_audit_log (actor_admin_user_id, action_type, before_data, after_data)
  values (p_actor_admin_user_id, 'add_membership_role', null,
          jsonb_build_object('membership_id', v_membership, 'person_id', p_person_id,
                             'program_id', p_program_id, 'season_id', p_season_id, 'role', p_role));

  return query select 'created'::text, v_membership;
end
$function$;

revoke all on function public.vam063_add_membership_role(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.vam063_add_membership_role(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
do $self_check$
declare
  v_def  text;
  v_acl  text;
  v_fn   text;
  v      text;
begin
  -- 1. Bảng bậc trả lời đúng những câu quyết định. Sai ở đây là sai ở mọi hàm.
  if not public.vam120_account_tier_allows('admin', 'core_team')
     or not public.vam120_account_tier_allows('core_team', 'support_team')
     or public.vam120_account_tier_allows('admin', 'admin')
     or public.vam120_account_tier_allows('admin', 'super_admin')
     or public.vam120_account_tier_allows('core_team', 'core_team')
     or public.vam120_account_tier_allows('core_team', 'admin')
     or public.vam120_account_tier_allows('support_team', 'viewer')
     or public.vam120_account_tier_allows('reviewer', 'viewer')
     or public.vam120_account_tier_allows('admin', null)
     or public.vam120_account_tier_allows(null, 'viewer') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam120_account_tier_allows trả lời sai bảng bậc';
  end if;
  if not public.vam120_scope_within_role('core_team', 'operations')
     or public.vam120_scope_within_role('core_team', 'full_access')
     or public.vam120_scope_within_role('reviewer', 'operations')
     or public.vam120_scope_within_role('viewer', 'review')
     or public.vam120_scope_within_role('admin', 'read')
     or public.vam120_scope_within_role('core_team', null) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam120_scope_within_role trả lời sai thang phạm vi';
  end if;

  -- 2. Hàm ghi tài khoản đã theo bậc, không còn cổng "chỉ super admin".
  select pg_get_functiondef('public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)'::regprocedure) into v_def;
  if position('vam120_account_tier_allows(' in v_def) = 0 or position('vam120_scope_within_role(' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam062_admin_mutation_atomic chưa hỏi bảng bậc';
  end if;
  if position('role=''super_admin'' and status=''active''' in v_def) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam062_admin_mutation_atomic vẫn còn cổng chỉ super admin';
  end if;
  if position('vam063_trusted_api_role()' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam062_admin_mutation_atomic mất phép kiểm ngữ cảnh máy chủ';
  end if;

  -- 3. Ba hàm nhật ký nhận admin, và chỉ thêm admin.
  foreach v_fn in array array[
    'public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid)',
    'public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)',
    'public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)'
  ] loop
    select pg_get_functiondef(v_fn::regprocedure) into v_def;
    if position('role in (''super_admin'',''admin'') and status=''active''' in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa nhận admin', v_fn;
    end if;
    if position('vam063_trusted_api_role()' in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % mất phép kiểm ngữ cảnh máy chủ', v_fn;
    end if;
  end loop;

  -- 4. Không hàm nào lộ cho anon/authenticated; các hàm máy chủ gọi vẫn gọi được.
  foreach v_fn in array array[
    'public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)',
    'public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid)',
    'public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)',
    'public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam120_account_tier_allows(text,text)',
    'public.vam120_scope_within_role(text,text)'
  ] loop
    select coalesce(array_to_string(p.proacl, ' '), '') into v_acl
    from pg_proc p where p.oid = v_fn::regprocedure::oid;
    if position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0
       or has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % lộ quyền chạy cho anon/authenticated (%)', v_fn, v_acl;
    end if;
    if v_fn not like 'public.vam120_%' and not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa cấp quyền chạy cho service_role (%)', v_fn, v_acl;
    end if;
  end loop;

  -- 5. Hai ràng buộc nhận cross_mentor và không mất giá trị cũ nào đang có.
  for v_fn in
    select * from (values
      ('public.person_season_memberships|person_season_memberships_role_check'),
      ('public.person_season_membership_log|person_season_membership_log_role_check')) as t(x)
  loop
    select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    where c.conrelid = split_part(v_fn, '|', 1)::regclass and c.conname = split_part(v_fn, '|', 2);
    if position('''cross_mentor''' in coalesce(v_def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa nhận cross_mentor', split_part(v_fn, '|', 2);
    end if;
    foreach v in array array['mentee','mentor','supporter','reviewer','interviewer','coreteam','advisor','alumni_mentee','guest','trainer','speaker'] loop
      if position('''' || v || '''' in v_def) = 0 then
        raise exception 'SCHEMA_CONTRACT_VIOLATION: % đã MẤT giá trị cũ %', split_part(v_fn, '|', 2), v;
      end if;
    end loop;
  end loop;

  -- 6. Hàm thêm vai trò nhận cross_mentor và giữ cổng Core team cho bổ nhiệm.
  select pg_get_functiondef('public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)'::regprocedure) into v_def;
  if position('''mentor'',''mentee'',''trainer'',''speaker'',''cross_mentor''' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam063_add_membership_role chưa nhận cross_mentor';
  end if;
  if position('VAM120 appointment requires core team' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam063_add_membership_role thiếu cổng Core team cho trainer/cross mentor';
  end if;
end;
$self_check$;
