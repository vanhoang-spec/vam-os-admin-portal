-- ============================================================
-- 20261004170000_tach_4_nhom_quyen_tuyen_sinh.sql
-- ============================================================
--
-- BTC 04/10/2026: bốn nhóm quyền tuyển sinh ĐỘC LẬP, cấp ngay trên CRM, không gán chéo:
--   1a. Chấm hồ sơ mentee      — psm.role 'reviewer'            (core team + support cấp)
--   1b. Phỏng vấn mentee       — psm.role 'interviewer'         (core team + support cấp)
--   2.  Chấm hồ sơ mentor      — psm.role 'mentor_reviewer'     (chỉ core team cấp)
--   3.  Phỏng vấn mentor (1:1) — psm.role 'mentor_interviewer'  (chỉ core team cấp)
-- 'reviewer'/'interviewer' giữ tên cũ vì đã có 179 dòng thật — cả 84 dòng 'reviewer'
-- đều chỉ từng chấm hồ sơ mentee; 'interviewer' từ 02/10 là để chấm phỏng vấn mentee.
--
-- Vì sao (đã gán chéo thật):
--   * Chấm hồ sơ chỉ cần scope 'review' — KHÔNG đọc tư cách 'reviewer', KHÔNG phân
--     mentor/mentee. Cấp quyền phỏng vấn cũng tạo scope 'review' → 86 mentor được cấp
--     để chấm phỏng vấn mentee đều chấm được mọi hồ sơ, cả mentor.
--   * Phỏng vấn mentee và mentor dùng chung 'interviewer' (sáng 04/10 mới tách lịch PV
--     mentor bằng bảng mentor_interview_hosts — bảng đó gộp vào đây).
--   * Cấp quyền cho tài khoản support_team hạ nó thành 'reviewer', mất quyền Support.
--
-- Core team / admin / super_admin: vẫn có cả bốn quyền theo vai trò (như trước).
--
-- Cách làm:
--   1. Nới CHECK vai trò của psm + log (cộng thêm, không viết đè).
--   2. vam110_*: quyền theo (vòng, hồ sơ mentor|mentee). vam084_* giữ nguyên làm lịch sử,
--      mã ứng dụng mới không gọi nữa.
--   3. Viết lại TẠI CHỖ mọi hàm đang hỏi quyền cũ (đọc định nghĩa đang chạy rồi thay
--      đúng lời gọi — khuôn 20260911120000), vì bản trên Production khác bản trong repo.
--   4. Cấp / thu quyền: nhận 4 vai trò; 2 vai trò mentor chỉ ban điều hành; từ chối
--      tài khoản support_team thay vì hạ vai trò.
--   5. Dữ liệu: host lịch PV mentor → 'mentor_interviewer'; host chưa từng PV mentee mất
--      'interviewer'; ai đang giữ phiếu CHƯA NỘP mà mất quyền tương ứng thì được cấp đúng
--      quyền đó — không phiếu dở nào kẹt. Bỏ bảng mentor_interview_hosts.
--
-- Dán vào Supabase SQL Editor (Production) TRƯỚC khi merge mã ứng dụng.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Nới CHECK vai trò
-- ───────────────────────────────────────────────────────────────────────────
do $widen_roles$
declare
  target   record;
  existing text;
  rebuilt  text;
begin
  for target in
    select * from (values
      ('public.person_season_memberships', 'person_season_memberships_role_check'),
      ('public.person_season_membership_log', 'person_season_membership_log_role_check')
    ) as t(tbl, con)
  loop
    select pg_get_constraintdef(c.oid) into existing
    from pg_constraint c
    where c.conrelid = target.tbl::regclass and c.conname = target.con;
    if existing is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy %', target.con;
    end if;
    if position('''mentor_reviewer''' in existing) > 0 and position('''mentor_interviewer''' in existing) > 0 then
      continue;
    end if;
    rebuilt := regexp_replace(existing, '\]\)\)\)$', ', ''mentor_reviewer''::text, ''mentor_interviewer''::text])))');
    if rebuilt = existing then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % có dạng lạ, không nới được: %', target.con, existing;
    end if;
    execute format('alter table %s drop constraint %I', target.tbl, target.con);
    execute format('alter table %s add constraint %I %s', target.tbl, target.con, replace(rebuilt, 'CHECK ', 'check '));
  end loop;
end;
$widen_roles$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Quyền theo (vòng, hồ sơ mentor|mentee)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.vam110_permission_role(p_review_stage text, p_role_applied text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_review_stage = 'profile_screening' and lower(btrim(coalesce(p_role_applied, ''))) = 'mentee' then 'reviewer'
    when p_review_stage = 'interview'         and lower(btrim(coalesce(p_role_applied, ''))) = 'mentee' then 'interviewer'
    when p_review_stage = 'profile_screening' and lower(btrim(coalesce(p_role_applied, ''))) = 'mentor' then 'mentor_reviewer'
    when p_review_stage = 'interview'         and lower(btrim(coalesce(p_role_applied, ''))) = 'mentor' then 'mentor_interviewer'
  end;
$function$;

-- Cổng tài khoản giữ nguyên như vam084_recruitment_eligible_admins (đang hoạt động, đúng
-- vai trò, scope đúng mùa). Khác: tài khoản 'reviewer' phải có ĐÚNG tư cách của nhóm —
-- kể cả vòng chấm hồ sơ, trước đây chỉ cần scope.
create or replace function public.vam110_recruitment_eligible_admins(
  p_season_id uuid,
  p_review_stage text,
  p_role_applied text
)
returns table(admin_user_id uuid, eligibility_source text)
language sql
stable
set search_path = ''
as $function$
  with wanted as (
    select public.vam110_permission_role(p_review_stage, p_role_applied) as role
  ),
  eligible_account as (
    select au.id, au.role
    from public.admin_users au
    where au.status = 'active'
      and au.role in ('reviewer', 'core_team', 'admin', 'super_admin')
      and (
        au.role = 'super_admin'
        or exists (
          select 1
          from public.admin_scope_access asa
          where asa.user_id = au.auth_user_id
            and asa.status = 'active'
            and asa.season_id = p_season_id::text
            and asa.role in ('review', 'operations', 'full_access')
        )
      )
  )
  select ea.id, 'privileged_role'::text
  from eligible_account ea
  join wanted w on w.role is not null
  where ea.role in ('core_team', 'admin', 'super_admin')

  union

  select ea.id, 'participation'::text
  from eligible_account ea
  join wanted w on w.role is not null
  join public.admin_users au on au.id = ea.id
  join public.people p on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  join public.person_season_memberships psm
    on psm.person_id = p.id
   and psm.season_id = p_season_id
   and psm.status = 'active'
   and psm.role = w.role
  where ea.role = 'reviewer';
$function$;

create or replace function public.vam110_eligible_for(
  p_admin_user_id uuid,
  p_season_id uuid,
  p_review_stage text,
  p_role_applied text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.vam110_recruitment_eligible_admins(p_season_id, p_review_stage, p_role_applied) e
    where e.admin_user_id = p_admin_user_id
  );
$function$;

-- Cùng hình dạng với vam084_list_recruitment_participants (id, email, full_name, role,
-- participation_role) để thay thẳng trong vam104_offline_dashboard và mã ứng dụng.
-- participation_role = đúng nhóm quyền ('reviewer'|'interviewer'|'mentor_reviewer'|'mentor_interviewer').
create or replace function public.vam110_list_recruitment_participants(
  p_season_id uuid,
  p_review_stage text,
  p_role_applied text
)
returns table(id uuid, email text, full_name text, role text, participation_role text)
language sql
stable
set search_path = ''
as $function$
  select
    au.id,
    au.email,
    coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(au.full_name), ''), au.email) as full_name,
    au.role,
    public.vam110_permission_role(p_review_stage, p_role_applied) as participation_role
  from public.vam110_recruitment_eligible_admins(p_season_id, p_review_stage, p_role_applied) e
  join public.admin_users au on au.id = e.admin_user_id
  left join lateral (
    select pp.full_name
    from public.people pp
    where lower(btrim(pp.email_primary)) = lower(btrim(au.email))
    order by pp.id
    limit 1
  ) p on true
  where current_user = 'service_role'
  order by 3, 2;
$function$;

revoke all on function public.vam110_permission_role(text, text) from public, anon, authenticated;
revoke all on function public.vam110_recruitment_eligible_admins(uuid, text, text) from public, anon, authenticated;
revoke all on function public.vam110_eligible_for(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.vam110_list_recruitment_participants(uuid, text, text) from public, anon, authenticated;
grant execute on function public.vam110_permission_role(text, text) to service_role;
grant execute on function public.vam110_recruitment_eligible_admins(uuid, text, text) to service_role;
grant execute on function public.vam110_eligible_for(uuid, uuid, text, text) to service_role;
grant execute on function public.vam110_list_recruitment_participants(uuid, text, text) to service_role;

-- Lịch phỏng vấn mentor 1:1: reviewer cần 'mentor_interviewer' (thay bảng mentor_interview_hosts).
create or replace function public.vam109_mentor_interview_host(p_admin uuid, p_season uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.admin_users au
    where au.id = p_admin
      and au.status = 'active'
      and (
        au.role in ('core_team', 'admin', 'super_admin')
        or (au.role = 'reviewer' and public.vam110_eligible_for(p_admin, p_season, 'interview', 'mentor'))
      )
  );
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Viết lại tại chỗ mọi hàm đang hỏi quyền cũ
-- ───────────────────────────────────────────────────────────────────────────
-- Mỗi dòng: hàm, mẫu lời gọi cũ (regex — khoảng trắng/xuống dòng tuỳ bản), lời gọi mới.
-- Không khớp mẫu nào → dừng cả migration: hàm trên database khác với thứ migration này hiểu.
do $rewrite_callers$
declare
  r       record;
  def     text;
  new_def text;
begin
  for r in
    select * from (values
      ('public.vam095_assign_application_review(uuid,uuid,text,timestamptz,uuid)',
       'public\.vam084_participant_for_stage\(\s*p_reviewer_id\s*,\s*v_app\.season_id\s*,\s*p_review_round\s*\)',
       'public.vam110_eligible_for(p_reviewer_id, v_app.season_id, p_review_round, v_app.role_applied::text)'),
      ('public.vam095_save_application_review_draft(uuid,uuid,integer,integer,integer,integer,integer,text,text)',
       'public\.vam084_participant_for_stage\(\s*p_actor\s*,\s*v_app\.season_id\s*,\s*v_review\.review_round\s*\)',
       'public.vam110_eligible_for(p_actor, v_app.season_id, v_review.review_round, v_app.role_applied::text)'),
      ('public.vam084_submit_application_review(uuid,uuid,integer,integer,integer,integer,integer,text,text)',
       'public\.vam084_participant_for_stage\(\s*p_actor\s*,\s*v_app\.season_id\s*,\s*v_review\.review_round\s*\)',
       'public.vam110_eligible_for(p_actor, v_app.season_id, v_review.review_round, v_app.role_applied::text)'),
      ('public.vam084_change_review_assignment(uuid,uuid,text,uuid)',
       'public\.vam084_participant_for_stage\(\s*p_new_reviewer\s*,\s*v_app\.season_id\s*,\s*v_review\.review_round\s*\)',
       'public.vam110_eligible_for(p_new_reviewer, v_app.season_id, v_review.review_round, v_app.role_applied::text)'),
      -- Lô giao đã bị ép cùng một role_applied ngay phía trên lời gọi này.
      ('public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)',
       'public\.vam084_participant_for_stage\(\s*p_reviewer_id\s*,\s*v_season_id\s*,\s*p_review_round\s*\)',
       'public.vam110_eligible_for(p_reviewer_id, v_season_id, p_review_round, (select a.role_applied::text from public.applications a where a.id = p_application_ids[1]))'),
      ('public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer)',
       'public\.vam084_participant_for_stage\(\s*v_reviewer_id\s*,\s*v_season_id\s*,\s*p_review_round\s*\)',
       'public.vam110_eligible_for(v_reviewer_id, v_season_id, p_review_round, p_role_applied)'),
      -- Phỏng vấn trực tiếp chỉ dành cho hồ sơ mentee.
      ('public.vam104_offline_access(uuid,uuid,boolean)',
       'public\.vam084_participant_for_stage\(\s*p_actor\s*,\s*p_season\s*,\s*''interview''\s*\)',
       'public.vam110_eligible_for(p_actor, p_season, ''interview'', ''mentee'')'),
      ('public.vam104_offline_dashboard(uuid,uuid)',
       'public\.vam084_list_recruitment_participants\(\s*p_season\s*,\s*''interview''\s*\)',
       'public.vam110_list_recruitment_participants(p_season, ''interview'', ''mentee'')'),
      ('public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)',
       'public\.vam084_participant_for_stage\(\s*v_reviewer\s*,\s*a\.season_id\s*,\s*''interview''\s*\)',
       'public.vam110_eligible_for(v_reviewer, a.season_id, ''interview'', ''mentee'')')
    ) as t(fn, pattern, repl)
  loop
    if to_regprocedure(r.fn) is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu hàm %', r.fn;
    end if;
    def := pg_get_functiondef(r.fn::regprocedure);
    if position('public.vam110_' in def) > 0 then
      continue; -- đã viết lại (chạy migration lần hai)
    end if;
    new_def := regexp_replace(def, r.pattern, r.repl, 'g');
    if new_def = def then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % không có lời gọi quyền như dự kiến — dừng lại', r.fn;
    end if;
    if new_def ~ 'vam084_participant_for_stage|vam084_list_recruitment_participants' then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % còn lời gọi quyền cũ sau khi thay', r.fn;
    end if;
    execute new_def;
  end loop;
end;
$rewrite_callers$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Cấp / thu quyền: 4 vai trò, 2 vai trò mentor chỉ ban điều hành
-- ───────────────────────────────────────────────────────────────────────────
do $rewrite_grants$
declare
  fn      text;
  def     text;
  new_def text;
begin
  -- Cấp quyền
  fn := 'public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)';
  def := pg_get_functiondef(fn::regprocedure);
  if position('mentor_interviewer' in def) = 0 then
    new_def := regexp_replace(def,
      'if p_participation_role not in \(\s*''reviewer''\s*,\s*''interviewer''\s*\) then\s*raise exception ''Unsupported recruitment participation role'';',
      'if p_participation_role not in (''reviewer'', ''interviewer'', ''mentor_reviewer'', ''mentor_interviewer'') then
    raise exception ''Unsupported recruitment participation role'';
  end if;
  -- Chấm hồ sơ / phỏng vấn MENTOR: chỉ ban điều hành cấp (BTC 04/10/2026), support thì không.
  if p_participation_role in (''mentor_reviewer'', ''mentor_interviewer'')
     and not public.vam084_operator_for_season(p_actor, p_season_id) then
    raise exception ''Mentor recruitment participation requires core team'';');
    -- Không hạ tài khoản Support thành reviewer — từ chối, để BTC dùng tài khoản khác.
    new_def := regexp_replace(new_def,
      'if v_existing_role not in \(\s*''viewer''\s*,\s*''support_team''\s*,',
      'if v_existing_role = ''support_team'' then
    raise exception ''Support team account cannot join recruitment'';
  end if;
  if v_existing_role not in (''viewer'',');
    if position('''mentor_interviewer''' in new_def) = 0
       or position('Mentor recruitment participation requires core team' in new_def) = 0
       or position('Support team account cannot join recruitment' in new_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: không viết lại được % — định nghĩa khác dự kiến', fn;
    end if;
    execute new_def;
  end if;

  -- Thu quyền
  fn := 'public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)';
  def := pg_get_functiondef(fn::regprocedure);
  if position('mentor_interviewer' in def) = 0 then
    new_def := regexp_replace(def,
      'p_participation_role not in \(\s*''reviewer''\s*,\s*''interviewer''\s*\)',
      'p_participation_role not in (''reviewer'', ''interviewer'', ''mentor_reviewer'', ''mentor_interviewer'')
     or (p_participation_role in (''mentor_reviewer'', ''mentor_interviewer'')
         and not public.vam084_operator_for_season(p_actor, p_season_id))');
    new_def := regexp_replace(new_def,
      'psm\.role in \(\s*''reviewer''\s*,\s*''interviewer''\s*\)',
      'psm.role in (''reviewer'', ''interviewer'', ''mentor_reviewer'', ''mentor_interviewer'')', 'g');
    if (length(new_def) - length(replace(new_def, '''mentor_interviewer''', ''))) / length('''mentor_interviewer''') < 4 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: không viết lại được % — định nghĩa khác dự kiến', fn;
    end if;
    execute new_def;
  end if;
end;
$rewrite_grants$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Dữ liệu
-- ───────────────────────────────────────────────────────────────────────────
-- "or replace": dán lại trong cùng phiên SQL Editor thì hàm tạm vẫn còn từ lần trước.
create or replace function pg_temp.vam110_set_membership(
  p_person uuid, p_program uuid, p_season uuid, p_role text, p_status text, p_reason text
)
returns void
language plpgsql
as $f$
declare
  v_id  uuid;
  v_old text;
begin
  select m.id, m.status into v_id, v_old
  from public.person_season_memberships m
  where m.person_id = p_person and m.season_id = p_season and m.role = p_role
  order by m.created_at desc
  limit 1
  for update;
  if v_id is null then
    if p_status <> 'active' then return; end if;
    insert into public.person_season_memberships (person_id, program_id, season_id, role, status, source)
    values (p_person, p_program, p_season, p_role, 'active', 'manual')
    returning id into v_id;
  elsif v_old is distinct from p_status then
    update public.person_season_memberships
       set status = p_status,
           end_date = case when p_status = 'active' then null else current_date end,
           updated_at = now()
     where id = v_id;
  else
    return;
  end if;
  insert into public.person_season_membership_log (
    membership_id, person_id, program_id, season_id, role,
    old_status, new_status, transition_type, reason, changed_by
  ) values (
    v_id, p_person, p_program, p_season, p_role,
    v_old, p_status, case when v_old is null then 'created' else 'status_change' end, p_reason, null
  );
end;
$f$;

do $chuyen_du_lieu$
declare
  r        record;
  v_hosts  integer := 0;
  v_rows   integer := 0;
begin
  -- 5a. Host lịch phỏng vấn mentor → 'mentor_interviewer'. Host chưa từng phỏng vấn
  -- mentee nào → bỏ 'interviewer' (họ được bật 22/09 để phỏng vấn MENTOR, không phải mentee).
  if to_regclass('public.mentor_interview_hosts') is not null then
    execute 'select count(*) from public.mentor_interview_hosts' into v_rows;
    for r in execute $q$
      select h.season_id, h.admin_user_id, p.id as person_id, s.program_id
      from public.mentor_interview_hosts h
      join public.admin_users au on au.id = h.admin_user_id
      join public.seasons s on s.id = h.season_id
      join lateral (
        select pp.id from public.people pp
        where lower(btrim(pp.email_primary)) = lower(btrim(au.email))
        order by pp.id limit 1
      ) p on true
    $q$ loop
      perform pg_temp.vam110_set_membership(r.person_id, r.program_id, r.season_id, 'mentor_interviewer', 'active',
        'Tách 4 nhóm quyền 04/10/2026: phỏng vấn mentor (đợt bật 22/09)');
      if not exists (
        select 1 from public.application_reviews ar
        join public.applications a on a.id = ar.application_id
        where ar.reviewer_admin_user_id = r.admin_user_id
          and ar.review_round = 'interview'
          and ar.status <> 'cancelled'
          and a.season_id = r.season_id
          and lower(a.role_applied::text) = 'mentee'
      ) then
        perform pg_temp.vam110_set_membership(r.person_id, r.program_id, r.season_id, 'interviewer', 'cancelled',
          'Tách 4 nhóm quyền 04/10/2026: được bật để phỏng vấn mentor, chưa từng phỏng vấn mentee');
      end if;
      v_hosts := v_hosts + 1;
    end loop;
    if v_hosts <> v_rows then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % host nhưng chỉ chuyển được % (thiếu hồ sơ người)', v_rows, v_hosts;
    end if;
    execute 'drop table public.mentor_interview_hosts';
  end if;

  -- 5b. Phiếu đang dở (chưa nộp, chưa huỷ) mà người giữ không còn đúng quyền → cấp đúng
  -- quyền đó. Không thì họ không lưu / nộp được phiếu đang chấm.
  for r in
    select distinct au.id as admin_id, p.id as person_id, s.program_id, a.season_id,
           public.vam110_permission_role(ar.review_round, a.role_applied::text) as perm
    from public.application_reviews ar
    join public.applications a on a.id = ar.application_id
    join public.seasons s on s.id = a.season_id
    join public.admin_users au on au.id = ar.reviewer_admin_user_id
    join lateral (
      select pp.id from public.people pp
      where lower(btrim(pp.email_primary)) = lower(btrim(au.email))
      order by pp.id limit 1
    ) p on true
    where ar.status not in ('submitted', 'cancelled')
      and au.role = 'reviewer'
      and au.status = 'active'
      and public.vam110_permission_role(ar.review_round, a.role_applied::text) is not null
      and not public.vam110_eligible_for(au.id, a.season_id, ar.review_round, a.role_applied::text)
  loop
    perform pg_temp.vam110_set_membership(r.person_id, r.program_id, r.season_id, r.perm, 'active',
      'Tách 4 nhóm quyền 04/10/2026: giữ quyền cho phiếu đang chấm dở');
  end loop;
end;
$chuyen_du_lieu$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Tự kiểm
-- ───────────────────────────────────────────────────────────────────────────
do $tach_4_nhom_self_check$
declare
  fn       text;
  def      text;
  v_count  integer;
begin
  -- 6a. Danh sách vai trò mới chứa trọn danh sách cũ.
  for def in
    select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conname in ('person_season_memberships_role_check', 'person_season_membership_log_role_check')
  loop
    if def !~ '''mentor_reviewer''' or def !~ '''mentor_interviewer'''
       or def !~ '''reviewer''' or def !~ '''interviewer''' or def !~ '''mentor''' or def !~ '''mentee''' then
      raise exception 'Tự kiểm: CHECK vai trò chưa đúng: %', def;
    end if;
  end loop;

  -- 6b. Hàm mới khoá kín.
  foreach fn in array array[
    'public.vam110_permission_role(text,text)',
    'public.vam110_recruitment_eligible_admins(uuid,text,text)',
    'public.vam110_eligible_for(uuid,uuid,text,text)',
    'public.vam110_list_recruitment_participants(uuid,text,text)'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'Tự kiểm: thiếu %', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'Tự kiểm: % gọi được từ trình duyệt', fn;
    end if;
  end loop;

  -- 6c. Không hàm ghi nào còn hỏi quyền cũ.
  foreach fn in array array[
    'public.vam095_assign_application_review(uuid,uuid,text,timestamptz,uuid)',
    'public.vam095_save_application_review_draft(uuid,uuid,integer,integer,integer,integer,integer,text,text)',
    'public.vam084_submit_application_review(uuid,uuid,integer,integer,integer,integer,integer,text,text)',
    'public.vam084_change_review_assignment(uuid,uuid,text,uuid)',
    'public.vam094_assign_selected_application_reviews(uuid[],uuid,text,timestamptz,text,uuid)',
    'public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer)',
    'public.vam104_offline_access(uuid,uuid,boolean)',
    'public.vam104_offline_dashboard(uuid,uuid)',
    'public.vam104_save_offline_interview(uuid,uuid,text,integer,jsonb)',
    'public.vam109_mentor_interview_host(uuid,uuid)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if def ~ 'vam084_participant_for_stage|vam084_list_recruitment_participants' or position('public.vam110_' in def) = 0 then
      raise exception 'Tự kiểm: % chưa chuyển sang quyền theo nhóm', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'Tự kiểm: % gọi được từ trình duyệt', fn;
    end if;
  end loop;

  -- 6d. Cấp / thu quyền nhận 4 vai trò, vai trò mentor chỉ ban điều hành.
  def := pg_get_functiondef('public.vam084_grant_recruitment_participation(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
  if position('Mentor recruitment participation requires core team' in def) = 0
     or position('Support team account cannot join recruitment' in def) = 0 then
    raise exception 'Tự kiểm: hàm cấp quyền chưa tách nhóm mentor / chưa chặn Support';
  end if;
  def := pg_get_functiondef('public.vam084_revoke_recruitment_participation(uuid,uuid,uuid,text)'::regprocedure);
  if position('''mentor_interviewer''' in def) = 0 or position('vam084_operator_for_season(p_actor, p_season_id)' in def) = 0 then
    raise exception 'Tự kiểm: hàm thu quyền chưa tách nhóm mentor';
  end if;

  -- 6e. Không phiếu dở nào mất người chấm.
  select count(*) into v_count
  from public.application_reviews ar
  join public.applications a on a.id = ar.application_id
  join public.admin_users au on au.id = ar.reviewer_admin_user_id
  where ar.status not in ('submitted', 'cancelled')
    and au.role = 'reviewer' and au.status = 'active'
    and public.vam110_permission_role(ar.review_round, a.role_applied::text) is not null
    and not public.vam110_eligible_for(au.id, a.season_id, ar.review_round, a.role_applied::text);
  if v_count > 0 then
    raise exception 'Tự kiểm: % phiếu đang dở sẽ không lưu / nộp được', v_count;
  end if;

  -- 6f. Bảng host cũ đã gộp vào tư cách mùa.
  if to_regclass('public.mentor_interview_hosts') is not null then
    raise exception 'Tự kiểm: bảng mentor_interview_hosts vẫn còn';
  end if;

  select count(*) into v_count from public.person_season_memberships where role = 'mentor_interviewer' and status = 'active';
  raise notice 'Đã tách 4 nhóm quyền tuyển sinh — % người phỏng vấn mentor (ngoài ban điều hành)', v_count;
end;
$tach_4_nhom_self_check$;

commit;
