-- ═══════════════════════════════════════════════════════════════════════════
-- Dựng lại đường ghi của /admin/users trên production
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ngày 13/09/2026, tạo tài khoản nhân sự đầu tiên qua giao diện thất bại ngay
-- ở bước đầu: "Giai đoạn: Khởi tạo nhật ký". Truy ra thì KHÔNG CÓ hàm
-- `vam062_begin_auth_operation` nào trên production — và cũng không có hàm
-- vam062 nào khác. Đếm được: 10 hàm vam063, 13 hàm vam084, **0** hàm vam062.
--
-- Nghĩa là cả module /admin/users chưa từng ghi được gì trên production. Không
-- riêng nút Tạo: Sửa, Kích hoạt, Gỡ quyền và Import CSV đều đi qua
-- `vam062_admin_mutation_atomic`. Trang vẫn hiện danh sách vì đọc là truy vấn
-- thường; chỉ có đường GHI là chết. Mọi thay đổi tài khoản từ trước tới nay đều
-- phải làm tay bằng SQL, và đó là lý do.
--
-- Migration 062 trong `supabase_migrations/` có đủ những hàm này, nhưng nó chưa
-- bao giờ được chạy. Phần từ vựng `admin_audit_log.action_type` của nó thì đã
-- lên — nên 062 đã từng được chạy MỘT PHẦN, và phần còn lại rơi mất.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO ĐÂY LÀ MỘT PHẦN CỦA 062, KHÔNG PHẢI CẢ 062
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 062 còn bật Row Level Security lên `people`, `person_season_memberships`,
-- `admin_users`, `admin_scope_access`, `admin_audit_log`, `intake_batches`,
-- `person_season_membership_log` — bảy bảng lõi, kèm policy cho từng bảng.
--
-- Đó là một quyết định có bán kính ảnh hưởng rất rộng, và độc lập với việc sửa
-- nút Tạo user: bật RLS lên `people` nghĩa là mọi đường đọc không dùng khoá
-- service-role sẽ lặng lẽ trả về 0 dòng thay vì báo lỗi. Kiểm chuyện đó cho hết
-- bảy bảng là một đợt riêng, phải rà từng màn hình.
--
-- File này CỐ Ý chỉ mang phần tối thiểu để đường ghi tài khoản chạy được:
-- hai bảng nhật ký và sáu hàm. Không bật RLS lên bảng lõi nào.
--
-- KHÔNG có trong file này (vẫn hỏng sau khi chạy): Import CSV tài khoản, vốn
-- cần thêm ba bảng và bốn hàm nữa. Chưa ai dùng tới nó.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- MỘT THAY ĐỔI CÓ CHỦ Ý SO VỚI BẢN GỐC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bản 062 nhận diện ngữ cảnh service-role bằng
--   current_setting('request.jwt.claim.role', true)
-- tức là chỉ đọc một nguồn duy nhất, và là nguồn CŨ. Trên các bản Supabase mới
-- biến này có thể rỗng, và khi ấy MỌI lời gọi đều bị từ chối — đúng kiểu lỗi
-- vừa xảy ra: hàm có mặt, quyền có đủ, mà vẫn không ghi được gì.
--
-- Dự án đã có sẵn lời giải cho chuyện này: `vam063_trusted_api_role()` đọc lần
-- lượt ba nguồn (biến cũ, claims JSON, `set_role`) và đang chạy thật trên
-- production. File này dùng nó. Ngữ nghĩa không đổi — vẫn phải là service_role
-- — chỉ khác ở chỗ nhận ra được ngữ cảnh ấy trong cả ba cách Supabase báo.
--
-- Phần thân các hàm được TRÍCH ĐÚNG BYTE từ 062 chứ không chép tay.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Preflight
-- ───────────────────────────────────────────────────────────────────────────
do $preflight$
declare missing text[] := '{}';
begin
  if to_regclass('public.admin_users') is null then missing := missing || 'bảng admin_users'; end if;
  if to_regclass('public.admin_scope_access') is null then missing := missing || 'bảng admin_scope_access'; end if;
  if to_regclass('public.admin_audit_log') is null then missing := missing || 'bảng admin_audit_log'; end if;
  if to_regclass('public.programs') is null then missing := missing || 'bảng programs'; end if;
  if to_regclass('public.seasons') is null then missing := missing || 'bảng seasons'; end if;
  -- Phép kiểm ngữ cảnh tin cậy dựa vào hàm này; thiếu nó thì mọi hàm dưới đây
  -- sẽ từ chối mọi lời gọi, và lại đúng vào cái lỗi file này sinh ra để sửa.
  if to_regproc('public.vam063_trusted_api_role') is null then missing := missing || 'hàm vam063_trusted_api_role'; end if;
  if array_length(missing, 1) > 0 then
    raise exception 'PREFLIGHT_FAILED: chưa có %', array_to_string(missing, '; ');
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- Hai bảng nhật ký (trích nguyên văn từ 062, thêm "if not exists")
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.account_auth_reconciliation(operation_id uuid primary key,identifier_hash text not null check(identifier_hash~'^[0-9a-f]{64}$'),action_type text not null,failure_class text not null,retry_status text not null default 'required' check(retry_status in ('required','in_progress','resolved')),correlation_metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now());

create table if not exists public.account_auth_operations(operation_id uuid primary key,actor_admin_user_id uuid not null references public.admin_users(id),operation_type text not null check(operation_type in ('manual','sync','csv')),identifier_hash text not null check(identifier_hash~'^[0-9a-f]{64}$'),pre_lookup_state text not null default 'pending' check(pre_lookup_state in ('pending','zero','one','multiple','incomplete')),preexisting_auth_user_id_hash text check(preexisting_auth_user_id_hash is null or preexisting_auth_user_id_hash~'^[0-9a-f]{64}$'),provider_stage text not null default 'not_started' check(provider_stage in ('not_started','pending','explicit_id','omitted_id','failed','ambiguous')),provider_auth_user_id_hash text check(provider_auth_user_id_hash is null or provider_auth_user_id_hash~'^[0-9a-f]{64}$'),ownership_state text not null default 'not_found' check(ownership_state in ('preexisting','proven_created','ambiguous','not_found','failed','incomplete')),delete_allowed boolean not null default false,application_stage text not null default 'not_started' check(application_stage in ('not_started','pending','completed','failed')),compensation_stage text not null default 'not_required' check(compensation_stage in ('not_required','pending','completed','failed')),reconciliation_state text not null default 'not_required' check(reconciliation_state in ('not_required','required','in_progress','resolved')),retry_of uuid references public.account_auth_operations(operation_id),failure_class text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(not delete_allowed or (ownership_state='proven_created' and provider_stage='explicit_id' and provider_auth_user_id_hash is not null)));

-- Hai bảng này chỉ có máy chủ chạm tới. Bật RLS và KHÔNG viết policy nào:
-- service_role đi vòng qua RLS, còn mọi vai trò khác không có cửa nào.
-- Thu hồi trước khi cấp lại, vì bảng vừa tạo đã mang sẵn quyền cho service_role.
alter table public.account_auth_operations enable row level security;
alter table public.account_auth_reconciliation enable row level security;

revoke all on public.account_auth_operations from public, anon, authenticated, service_role;
revoke all on public.account_auth_reconciliation from public, anon, authenticated, service_role;

grant select, insert, update on public.account_auth_operations to service_role;
grant select, insert, update on public.account_auth_reconciliation to service_role;

comment on table public.account_auth_operations is
  'Nhật ký từng bước của một lần tạo/sửa tài khoản nhân sự. Có để một lần chạy dở không để lại tài khoản Auth mồ côi: mỗi giai đoạn được ghi trước khi làm, nên biết được dừng ở đâu và có được phép xoá bù hay không.';
comment on table public.account_auth_reconciliation is
  'Những lần dừng giữa chừng cần người đối soát tay. Ghi hash chứ không ghi email.';

-- ───────────────────────────────────────────────────────────────────────────
-- Sáu hàm (thân trích đúng byte từ 062)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.vam062_current_admin_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.admin_users where auth_user_id=auth.uid() and status='active' limit 1
$$;

create or replace function public.vam062_upsert_scope_atomic(p_user_id uuid,p_program_id uuid,p_season_id uuid,p_scope_role text,p_target_status text) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_target_status not in ('active','inactive') then
    raise exception 'VAM062V3 invalid scope target status';
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM062_SCOPE|'||p_user_id::text||'|'||p_program_id::text||'|'||p_season_id::text||'|'||p_scope_role));
  if p_target_status='active' then
    if exists(select 1 from public.admin_scope_access where user_id=p_user_id and program_id=p_program_id::text and season_id=p_season_id::text and role=p_scope_role and status='active') then
      return;
    end if;
    insert into public.admin_scope_access(user_id,program_id,season_id,role,status)
      values(p_user_id,p_program_id::text,p_season_id::text,p_scope_role,'active')
      on conflict (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role) where (status = 'active') do nothing;
  else
    if exists(select 1 from public.admin_scope_access where user_id=p_user_id and program_id=p_program_id::text and season_id=p_season_id::text and role=p_scope_role) then
      return;
    end if;
    insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(p_user_id,p_program_id::text,p_season_id::text,p_scope_role,'inactive');
  end if;
end $$;

create or replace function public.vam062_admin_mutation_atomic(p_actor_admin_user_id uuid,p_operation text,p_target_admin_user_id uuid,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare
  v_target uuid; v_auth uuid; v_before jsonb; v_after jsonb; v_action text;
  v_program_id uuid; v_season_id uuid; v_scope_status text;
begin
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 unauthorized actor';
  end if;
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' then
    raise exception 'VAM062V3 trusted server context required';
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
end $$;

create or replace function public.vam062_record_auth_reconciliation(p_actor_admin_user_id uuid,p_operation_id uuid,p_identifier_hash text,p_action_type text,p_failure_class text,p_retry_status text,p_correlation_metadata jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') or p_retry_status not in ('required','resolved') then
    raise exception 'VAM062V3 reconciliation rejected';
  end if;
  insert into public.account_auth_reconciliation(operation_id,identifier_hash,action_type,failure_class,retry_status,correlation_metadata)
    values(p_operation_id,p_identifier_hash,p_action_type,p_failure_class,p_retry_status,coalesce(p_correlation_metadata,'{}'));
end $$;

create or replace function public.vam062_begin_auth_operation(p_actor_admin_user_id uuid,p_operation_id uuid,p_operation_type text,p_identifier_hash text,p_retry_of uuid default null) returns table(accepted boolean,existing_stage text) language plpgsql volatile security definer set search_path=public as $$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
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
end $$;

create or replace function public.vam062_record_auth_operation_stage(p_actor_admin_user_id uuid,p_operation_id uuid,p_stage text,p_ownership_state text,p_auth_user_id_hash text,p_delete_allowed boolean,p_failure_class text) returns void language plpgsql volatile security definer set search_path=public as $$
begin
  if coalesce((select r.api_role from public.vam063_trusted_api_role() r),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
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
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Quyền gọi
-- ───────────────────────────────────────────────────────────────────────────
--
-- `vam062_current_admin_id` và `vam062_upsert_scope_atomic` là helper nội bộ:
-- chỉ các hàm SECURITY DEFINER cùng chủ sở hữu gọi tới, không cấp cho ai.
revoke all on function public.vam062_current_admin_id() from public, anon, authenticated, service_role;
revoke all on function public.vam062_upsert_scope_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function public.vam062_admin_mutation_atomic(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.vam062_record_auth_reconciliation(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.vam062_begin_auth_operation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.vam062_record_auth_operation_stage(uuid, uuid, text, text, text, boolean, text) from public, anon, authenticated;

grant execute on function public.vam062_admin_mutation_atomic(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.vam062_record_auth_reconciliation(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.vam062_begin_auth_operation(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.vam062_record_auth_operation_stage(uuid, uuid, text, text, text, boolean, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
do $self_check$
declare
  missing text[] := '{}';
  fn      text;
begin
  if to_regclass('public.account_auth_operations') is null then missing := missing || 'bảng account_auth_operations'; end if;
  if to_regclass('public.account_auth_reconciliation') is null then missing := missing || 'bảng account_auth_reconciliation'; end if;

  foreach fn in array array[
    'vam062_current_admin_id', 'vam062_upsert_scope_atomic', 'vam062_admin_mutation_atomic',
    'vam062_record_auth_reconciliation', 'vam062_begin_auth_operation', 'vam062_record_auth_operation_stage'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    ) then
      missing := missing || ('hàm ' || fn);
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: sau khi chạy vẫn thiếu %', array_to_string(missing, '; ');
  end if;

  -- Không hàm nào được còn dùng nguồn claim cũ một mình: đó chính là lỗi đang sửa.
  foreach fn in array array[
    'vam062_admin_mutation_atomic', 'vam062_record_auth_reconciliation',
    'vam062_begin_auth_operation', 'vam062_record_auth_operation_stage'
  ] loop
    if position('vam063_trusted_api_role' in (
      select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn limit 1
    )) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % vẫn đọc nguồn claim cũ một mình', fn;
    end if;
  end loop;
end;
$self_check$;
