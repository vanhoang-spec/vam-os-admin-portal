-- ═══════════════════════════════════════════════════════════════════════════
-- Support team cấp quyền reviewer và giao hồ sơ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Quyết định của chủ chương trình ngày 11/09/2026: Support team là nhóm mời
-- reviewer và xếp hồ sơ cho họ chấm, nên họ phải làm được hai việc đó trên CRM.
--
-- Hôm nay database chặn cả hai. Bốn hàm ghi dưới đây kiểm người thao tác bằng
-- `vam084_operator_for_season`, và hàm đó chỉ nhận super_admin / admin /
-- core_team.
--
-- ───────────────────────────────────────────────────────────────────────────
-- VÌ SAO KHÔNG NỚI `vam084_operator_for_season`
-- ───────────────────────────────────────────────────────────────────────────
-- Hàm đó được dùng chung cho hàng chục thao tác vận hành tuyển sinh — chốt kết
-- quả, duyệt chính thức, khôi phục hồ sơ đã rút. Thêm support_team vào đó là
-- trao cho họ tất cả những việc ấy, trong khi quyết định chỉ nói hai việc.
--
-- Nên migration này thêm một phép kiểm MỚI, `vam084_staffing_operator_for_season`
-- — phép kiểm cũ, HOẶC một tài khoản support_team có quyền vận hành đúng mùa —
-- và chỉ bốn hàm của hai việc kia chuyển sang dùng nó:
--
--   vam084_grant_recruitment_participation      cấp quyền đánh giá / phỏng vấn
--   vam084_revoke_recruitment_participation     thu hồi quyền đó
--   vam094_assign_selected_application_reviews  giao một lô hồ sơ
--   vam084_change_review_assignment             trả hồ sơ về hàng chờ
--
-- Support team vẫn phải có quyền VẬN HÀNH (operations hoặc full_access) cho
-- đúng mùa. Tài khoản chỉ có quyền đọc thì vẫn bị chặn, như trước.
--
-- ───────────────────────────────────────────────────────────────────────────
-- VÌ SAO KHÔNG CHÉP LẠI BỐN HÀM ĐÓ
-- ───────────────────────────────────────────────────────────────────────────
-- Mỗi hàm dài hàng trăm dòng, và đã được viết lại vài lần qua các migration —
-- bản chặn giao hồ sơ đã rút, bản dùng lại phạm vi khi cấp quyền. Chép tay từ
-- một file là cách chắc chắn nhất để lặng lẽ xoá mất một lần sửa, hoặc chép
-- đúng file nhưng file đó khác với thứ đang chạy trên production.
--
-- Nên migration ĐỌC định nghĩa đang chạy thật trên database bằng
-- `pg_get_functiondef`, đổi đúng tên phép kiểm, rồi dựng lại hàm. Mọi thứ khác
-- giữ nguyên từng ký tự, và quyền EXECUTE của hàm cũng giữ nguyên.
--
-- Chạy lại được: hàm nào đã đổi rồi thì bỏ qua.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Dò trước
-- ───────────────────────────────────────────────────────────────────────────
do $preflight$
declare
  missing text;
begin
  select string_agg(fn, ', ') into missing
  from unnest(array[
    'public.vam084_operator_for_season(uuid,uuid)',
    'public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)',
    'public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)',
    'public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)',
    'public.vam084_change_review_assignment(uuid,uuid,text,uuid)'
  ]) as fn
  where to_regprocedure(fn) is null;

  select concat_ws(', ', missing, string_agg(needed.tbl || '.' || needed.col, ', '))
    into missing
  from (values
    ('admin_users',        'id'),
    ('admin_users',        'status'),
    ('admin_users',        'role'),
    ('admin_users',        'auth_user_id'),
    ('admin_scope_access', 'user_id'),
    ('admin_scope_access', 'status'),
    ('admin_scope_access', 'season_id'),
    ('admin_scope_access', 'role')
  ) as needed(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = needed.tbl
      and c.column_name  = needed.col
  );

  if nullif(missing, '') is not null then
    raise exception
      'PREFLIGHT_MISSING_DEPENDENCY: production chưa có những thứ migration này dựa vào: %', missing;
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Phép kiểm mới
-- ───────────────────────────────────────────────────────────────────────────
--
-- Dùng lại phép kiểm cũ chứ không viết lại điều kiện của nó: điều kiện dành cho
-- ban điều hành chỉ nằm ở một chỗ, và sửa nó sau này tự áp dụng cho cả bốn hàm.
-- Nhánh mới chỉ thêm support_team, với đúng ba điều kiện của nhánh cũ: tài
-- khoản đang hoạt động, gọi từ máy chủ, và quyền vận hành trên ĐÚNG mùa.
create or replace function public.vam084_staffing_operator_for_season(
  p_actor uuid,
  p_season_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select
    public.vam084_operator_for_season(p_actor, p_season_id)
    or (
      current_user = 'service_role'
      and exists (
        select 1
        from public.admin_users au
        join public.admin_scope_access asa
          on asa.user_id   = au.auth_user_id
         and asa.status    = 'active'
         and asa.season_id = p_season_id::text
         and asa.role in ('operations', 'full_access')
        where au.id     = p_actor
          and au.status = 'active'
          and au.role   = 'support_team'
      )
    );
$fn$;

comment on function public.vam084_staffing_operator_for_season(uuid, uuid) is
  'Người được cấp quyền tuyển sinh và giao hồ sơ trong mùa: ban điều hành như vam084_operator_for_season, cộng support_team có quyền vận hành đúng mùa. Chỉ dùng cho cấp và thu hồi quyền, giao lô, trả hồ sơ về hàng chờ.';

revoke all on function public.vam084_staffing_operator_for_season(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam084_staffing_operator_for_season(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Đổi phép kiểm trong đúng bốn hàm
-- ───────────────────────────────────────────────────────────────────────────
do $swap$
declare
  target     text;
  definition text;
  old_call   constant text := 'public.vam084_operator_for_season(';
  new_call   constant text := 'public.vam084_staffing_operator_for_season(';
begin
  foreach target in array array[
    'public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)',
    'public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)',
    'public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)',
    'public.vam084_change_review_assignment(uuid,uuid,text,uuid)'
  ] loop
    definition := pg_get_functiondef(target::regprocedure);

    if position(old_call in definition) > 0 then
      execute replace(definition, old_call, new_call);
    elsif position(new_call in definition) = 0 then
      -- Không gọi phép kiểm cũ, cũng không gọi phép kiểm mới: hàm trên database
      -- khác với thứ migration này hiểu. Đoán tiếp ở đây là đoán trên phân quyền.
      raise exception
        'SCHEMA_CONTRACT_VIOLATION: % không kiểm người thao tác bằng vam084_operator_for_season — định nghĩa trên database khác với dự kiến, dừng lại', target;
    end if;
  end loop;
end;
$swap$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
do $self_check$
declare
  target     text;
  definition text;
begin
  if to_regprocedure('public.vam084_staffing_operator_for_season(uuid,uuid)') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: chưa tạo được vam084_staffing_operator_for_season';
  end if;

  if has_function_privilege('anon', 'public.vam084_staffing_operator_for_season(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam084_staffing_operator_for_season(uuid,uuid)', 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam084_staffing_operator_for_season gọi được từ trình duyệt';
  end if;

  if not has_function_privilege('service_role', 'public.vam084_staffing_operator_for_season(uuid,uuid)', 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: máy chủ không gọi được vam084_staffing_operator_for_season';
  end if;

  foreach target in array array[
    'public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)',
    'public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)',
    'public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)',
    'public.vam084_change_review_assignment(uuid,uuid,text,uuid)'
  ] loop
    definition := pg_get_functiondef(target::regprocedure);

    if position('public.vam084_operator_for_season(' in definition) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % vẫn còn gọi phép kiểm cũ', target;
    end if;
    if position('public.vam084_staffing_operator_for_season(' in definition) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % không gọi phép kiểm mới', target;
    end if;

    -- Dựng lại hàm không được làm rơi quyền của nó.
    if has_function_privilege('anon', target, 'execute')
       or has_function_privilege('authenticated', target, 'execute') then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % gọi được từ trình duyệt', target;
    end if;
    if not has_function_privilege('service_role', target, 'execute') then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: máy chủ không gọi được %', target;
    end if;
  end loop;

  -- Phép kiểm dùng chung vẫn hẹp như cũ.
  if position('support_team' in pg_get_functiondef('public.vam084_operator_for_season(uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam084_operator_for_season đã bị nới cho support_team';
  end if;
end;
$self_check$;

notify pgrst, 'reload schema';
