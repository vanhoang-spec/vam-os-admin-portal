-- =============================================================================
-- Vòng 2 — Support team được đổi / xác nhận nhóm ngành của từng người (BTC 08/10/2026)
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR. Thiếu file này thì nút "Lưu nhóm" của Support team hiện ra
-- nhưng database trả ACCESS_DENIED — không hỏng gì, chỉ không lưu được.
--
-- Vì sao: nhóm ngành do máy xếp từ hồ sơ còn chỗ chưa đúng; Support team rà lại trước
-- khi gửi link chọn mentee cho mentor. Trước đây chỉ Super admin / Admin / Core team
-- (vam084_operator_for_season) đổi được.
--
-- Phạm vi hẹp có chủ ý:
--   * CHỈ hàm đổi nhóm từng người (vam112_set_industry_group) dùng cổng mới. Phân loại
--     hàng loạt (vam112_save_industry_assignments), mở vòng, gửi thư giữ nguyên cổng cũ.
--   * vam084_operator_for_season KHÔNG đổi: nó là cổng của mọi việc vận hành mùa khác.
--   * Support team vẫn phải có quyền vận hành mùa (scope operations / full_access) —
--     cùng điều kiện như Core team; tài khoản bị khoá thì không được.
-- Thân hàm vam112_set_industry_group chép nguyên từ 20261007140000, chỉ thay đúng
-- dòng kiểm quyền.
-- =============================================================================

create or replace function public.vam114_round2_group_editor_for_season(p_actor uuid, p_season_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    current_user = 'service_role'
    and exists (
      select 1
      from public.admin_users au
      where au.id = p_actor
        and au.status = 'active'
        and au.role in ('super_admin', 'admin', 'core_team', 'support_team')
        and (
          au.role = 'super_admin'
          or exists (
            select 1
            from public.admin_scope_access asa
            where asa.user_id = au.auth_user_id
              and asa.status = 'active'
              and asa.season_id = p_season_id::text
              and asa.role in ('operations', 'full_access')
          )
        )
    );
$$;

revoke all on function public.vam114_round2_group_editor_for_season(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam114_round2_group_editor_for_season(uuid, uuid) to service_role;

-- BTC / Support team đổi hoặc xác nhận nhóm của một người. p_expected_group là nhóm
-- người bấm đang nhìn trên màn hình: người khác vừa đổi thì từ chối (STALE_GROUP),
-- không ghi đè lên quyết định mới hơn. Truyền đúng nhóm hiện tại = xác nhận, gỡ cờ.
create or replace function public.vam112_set_industry_group(
  p_actor uuid, p_assignment uuid, p_expected_group smallint, p_new_group smallint, p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  a public.matching_industry_assignments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into a from public.matching_industry_assignments where id = p_assignment;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.vam114_round2_group_editor_for_season(p_actor, a.season_id) then raise exception 'ACCESS_DENIED'; end if;
  if p_new_group is null or p_new_group not between 1 and 9 then raise exception 'INVALID_GROUP'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  -- Cùng khoá với mọi đường tạo cặp của mùa: không đổi nhóm giữa lúc một mentor đang chọn.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || a.season_id::text, 0));
  select * into a from public.matching_industry_assignments where id = p_assignment for update;
  if a.group_code is distinct from p_expected_group then raise exception 'STALE_GROUP'; end if;

  perform set_config('vam.industry_override', a.id::text, true);
  update public.matching_industry_assignments
     set group_code = p_new_group,
         source = 'btc',
         confidence = 'cao',
         flags = array_remove(flags, 'CAN_BTC_XEM'),
         reviewed_by = p_actor,
         reviewed_at = now(),
         override_reason = v_reason,
         drift_group = null,
         drift_checked_at = now()
   where id = a.id;
  perform set_config('vam.industry_override', '', true);

  insert into public.matching_industry_assignment_log(assignment_id, actor_id, action, old_group, new_group, reason)
    values (a.id, p_actor, case when p_new_group = a.group_code then 'btc_confirm' else 'btc_override' end,
            a.group_code, p_new_group, v_reason);
  return jsonb_build_object('ok', true, 'group', p_new_group);
end;
$$;

revoke all on function public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text) from public, anon, authenticated;
grant execute on function public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text) to service_role;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $support_doi_nhom_contract$
declare
  def_set text := pg_get_functiondef('public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text)'::regprocedure);
  def_save text := pg_get_functiondef('public.vam112_save_industry_assignments(uuid, uuid, jsonb, text)'::regprocedure);
  def_editor text := pg_get_functiondef('public.vam114_round2_group_editor_for_season(uuid, uuid)'::regprocedure);
begin
  if position('vam114_round2_group_editor_for_season(p_actor, a.season_id)' in def_set) = 0
     or position('vam084_operator_for_season' in def_set) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam112_set_industry_group chưa dùng cổng vam114';
  end if;
  -- Phân loại hàng loạt vẫn là việc của Core team trở lên.
  if position('vam084_operator_for_season(p_actor, p_season)' in def_save) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam112_save_industry_assignments không còn dùng vam084';
  end if;
  if position('''support_team''' in def_editor) = 0 or position('''reviewer''' in def_editor) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: danh sách vai trò của vam114 sai';
  end if;
  if exists (select 1 from pg_proc where proname in ('vam112_set_industry_group', 'vam114_round2_group_editor_for_season') and prosecdef) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm đổi nhóm phải chạy bằng quyền người gọi';
  end if;
  if has_function_privilege('anon', 'public.vam112_set_industry_group(uuid, uuid, smallint, smallint, text)', 'execute')
     or has_function_privilege('anon', 'public.vam114_round2_group_editor_for_season(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam114_round2_group_editor_for_season(uuid, uuid)', 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon/authenticated gọi được hàm đổi nhóm';
  end if;
  raise notice 'Vòng 2: Support team có quyền vận hành mùa đã đổi / xác nhận được nhóm ngành.';
end;
$support_doi_nhom_contract$;

notify pgrst, 'reload schema';
