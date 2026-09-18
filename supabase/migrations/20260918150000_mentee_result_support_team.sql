-- Support Team đổi được kết quả của đơn MENTEE; đơn mentor giữ nguyên như cũ.
--
-- Chủ dự án chốt 18/09/2026: Support Team quyết định kết quả mentee, kể cả bước
-- duyệt chính thức. Kết quả mentor vẫn là việc của Core Team trở lên.
--
-- Cổng quyền hiện tại là `vam084_operator_for_season`, và nó chỉ nhận
-- super_admin / admin / core_team. KHÔNG nới hàm đó: nó còn là cổng của 6 việc
-- khác (cấp quyền tuyển sinh, giao bài chấm hàng loạt, sửa yêu cầu số review,
-- khôi phục đơn đã rút...), nới ở đó là mở nhầm cả những việc không ai yêu cầu.
--
-- Thay vào đó: một hàm quyền mới đọc theo VAI TRÒ ỨNG TUYỂN của chính đơn, và ba
-- hàm ghi kết quả gọi nó thay cho hàm cũ. Ba hàm đó được vá đúng một dòng, đọc từ
-- bản đang chạy — chép lại cả thân hàm là ghi đè lặng lẽ mọi khác biệt.
--
-- Hoàn nguyên: chạy lại đúng ba phép thay ngược (new -> old) trên ba hàm, rồi
--   drop function if exists public.vam096_decision_operator_for_application(uuid, uuid);

begin;

set local lock_timeout = '10s';

do $preflight$
declare
  v_missing text;
begin
  foreach v_missing in array array[
    'public.vam084_operator_for_season(uuid, uuid)',
    'public.vam084_apply_application_decisions(uuid[], text, uuid, text, jsonb)',
    'public.vam090_finalize_recruitment_approval(uuid, text, uuid, uuid, text, text)',
    'public.vam092_bulk_official_approve_applications(uuid[], uuid)'
  ] loop
    if to_regprocedure(v_missing) is null then
      raise exception 'PRECONDITION: thiếu hàm %', v_missing;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications' and column_name = 'role_applied'
  ) then
    raise exception 'PRECONDITION: applications không có cột role_applied';
  end if;
end
$preflight$;

-- Quyền đổi kết quả của MỘT đơn.
--
-- Nhánh thứ nhất giữ nguyên luật cũ cho mọi đơn. Nhánh thứ hai chỉ mở thêm đúng
-- một trường hợp: đơn mentee, người thao tác là support_team đang hoạt động, và
-- vẫn phải có quyền vận hành đúng mùa của đơn — cùng điều kiện phạm vi mà
-- vam084_operator_for_season đòi, không phải một cửa sau.
create or replace function public.vam096_decision_operator_for_application(
  p_actor uuid,
  p_application_id uuid
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select
    current_user = 'service_role'
    and exists (
      select 1
      from public.applications a
      where a.id = p_application_id
        and (
          public.vam084_operator_for_season(p_actor, a.season_id)
          or (
            lower(btrim(coalesce(a.role_applied::text, ''))) = 'mentee'
            and exists (
              select 1
              from public.admin_users au
              where au.id = p_actor
                and au.status = 'active'
                and au.role = 'support_team'
                and exists (
                  select 1
                  from public.admin_scope_access asa
                  where asa.user_id = au.auth_user_id
                    and asa.status = 'active'
                    and asa.season_id = a.season_id::text
                    and asa.role in ('operations', 'full_access')
                )
            )
          )
        )
    );
$function$;

revoke all on function public.vam096_decision_operator_for_application(uuid, uuid) from public;
revoke all on function public.vam096_decision_operator_for_application(uuid, uuid) from anon;
revoke all on function public.vam096_decision_operator_for_application(uuid, uuid) from authenticated;
grant execute on function public.vam096_decision_operator_for_application(uuid, uuid) to service_role;

-- Vá ba hàm ghi kết quả: đọc bản đang chạy, thay đúng một dòng, tự chứng minh.
do $patch$
declare
  v_target record;
  v_def text;
  v_new_def text;
  v_matches integer;
  v_acl_before text;
  v_acl_after text;
  v_secdef_before boolean;
  v_secdef_after boolean;
  v_config_before text;
  v_config_after text;
  v_patched integer := 0;
begin
  for v_target in
    select *
    from (values
      (
        'vam084_apply_application_decisions',
        'if not public.vam084_operator_for_season(p_actor, v_row.season_id) then',
        'if not public.vam096_decision_operator_for_application(p_actor, v_row.id) then'
      ),
      (
        'vam090_finalize_recruitment_approval',
        'if not public.vam084_operator_for_season(p_actor, v_app.season_id) then',
        'if not public.vam096_decision_operator_for_application(p_actor, p_application_id) then'
      ),
      (
        'vam092_bulk_official_approve_applications',
        'if not public.vam084_operator_for_season(p_actor, v_app.season_id) then',
        'if not public.vam096_decision_operator_for_application(p_actor, v_app.id) then'
      )
    ) as t(proname, old_text, new_text)
  loop
    select pg_get_functiondef(p.oid), coalesce(p.proacl::text, ''), p.prosecdef, coalesce(p.proconfig::text, '')
      into v_def, v_acl_before, v_secdef_before, v_config_before
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_target.proname;

    if v_def is null then
      raise exception 'PATCH: không đọc được định nghĩa của %', v_target.proname;
    end if;

    -- Chạy lại vô hại: hàm đã vá thì bỏ qua.
    if position(v_target.new_text in v_def) > 0 then
      raise notice '% đã vá từ trước, bỏ qua.', v_target.proname;
      continue;
    end if;

    v_matches := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    if v_matches <> 1 then
      raise exception 'PATCH: % có % chỗ khớp, phải đúng 1', v_target.proname, v_matches;
    end if;

    v_new_def := replace(v_def, v_target.old_text, v_target.new_text);
    -- Đảo phép thay phải ra đúng bản cũ: chứng minh không có gì khác bị đụng.
    if md5(replace(v_new_def, v_target.new_text, v_target.old_text)) <> md5(v_def) then
      raise exception 'PATCH: phép thay của % chạm vào chỗ khác', v_target.proname;
    end if;

    execute v_new_def;

    select coalesce(p.proacl::text, ''), p.prosecdef, coalesce(p.proconfig::text, '')
      into v_acl_after, v_secdef_after, v_config_after
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_target.proname;

    if v_acl_before is distinct from v_acl_after
       or v_secdef_before is distinct from v_secdef_after
       or v_config_before is distinct from v_config_after then
      raise exception 'PATCH: quyền hoặc cấu hình của % đã đổi sau khi vá', v_target.proname;
    end if;

    v_patched := v_patched + 1;
  end loop;

  raise notice 'Đã vá % hàm.', v_patched;
end
$patch$;

do $self_check$
declare
  v_name text;
  v_def text;
  v_others integer;
  v_support integer;
begin
  foreach v_name in array array[
    'vam084_apply_application_decisions',
    'vam090_finalize_recruitment_approval',
    'vam092_bulk_official_approve_applications'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;

    if position('vam096_decision_operator_for_application' in v_def) = 0 then
      raise exception 'SELF_CHECK: % chưa gọi hàm quyền mới', v_name;
    end if;
    if position('vam084_operator_for_season' in v_def) > 0 then
      raise exception 'SELF_CHECK: % vẫn còn gọi hàm quyền cũ', v_name;
    end if;
  end loop;

  -- Hàm quyền cũ phải còn nguyên cho những việc khác vẫn dùng nó.
  select count(*) into v_others
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> 'vam084_operator_for_season'
    and pg_get_functiondef(p.oid) like '%vam084_operator_for_season%';
  if v_others < 4 then
    raise exception 'SELF_CHECK: hàm quyền cũ chỉ còn % chỗ dùng, nghi đã vá nhầm', v_others;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vam096_decision_operator_for_application'
      and coalesce(p.proacl::text, '') like '%service_role=X%'
      and coalesce(p.proacl::text, '') not like '%anon=X%'
      and coalesce(p.proacl::text, '') not like '%authenticated=X%'
  ) then
    raise exception 'SELF_CHECK: quyền chạy hàm mới không đúng';
  end if;

  select count(*) into v_support
  from public.admin_users au
  where au.status = 'active' and au.role = 'support_team';
  raise notice 'Có % tài khoản support team đang hoạt động; họ đổi được kết quả đơn mentee ở mùa họ có quyền vận hành.', v_support;
end
$self_check$;

commit;
