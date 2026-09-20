-- ═══════════════════════════════════════════════════════════════════════════
-- Xoá hẳn một người khỏi hệ thống, và xoá hẳn một tài khoản ban tổ chức
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Chủ dự án chốt 20/09/2026: cho phép xoá THẬT khỏi database, không phải đánh
-- dấu ngưng. Kèm theo là phân quyền:
--
--   * admin và core team  → xoá được mentor
--   * support team        → xoá được mentee
--   * admin               → sửa/xoá được tài khoản core team
--   * core team           → sửa/xoá được tài khoản support team
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO HAI HÀM NÀY TỪ CHỐI NHIỀU HƠN LÀ XOÁ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `people` có 27 khoá ngoại trỏ vào, và chúng chia làm ba nhóm với ba hậu quả
-- hoàn toàn khác nhau:
--
--   CASCADE   — hồ sơ mentor/mentee, membership, lượt đăng ký sự kiện, ghi chú
--               CRM: xoá theo, đúng như mong đợi.
--   SET NULL  — `matches.mentor_person_id`, `applications.person_id`, …: dòng
--               VẪN CÒN nhưng mất người. Một cặp ghép không còn mentor là thứ
--               không ai nhìn thấy cho tới lúc mở trang ghép cặp ra và thấy một
--               ô trống, và lúc đó thì không dựng lại được.
--   RESTRICT  — `person_season_membership_log`: chặn hẳn lệnh xoá.
--
-- Nên phép xoá ở đây KHÔNG phải `delete from people`. Nó là:
--
--   1. đếm mọi thứ sẽ mất và mọi thứ sẽ mồ côi;
--   2. TỪ CHỐI nếu người đó có lịch sử thật — cặp ghép, đơn ứng tuyển, recap,
--      lượt tham dự đã điểm danh, tài khoản đăng nhập;
--   3. chỉ khi sạch dấu vết mới xoá, và ghi một bản chụp đầy đủ vào nhật ký
--      TRƯỚC khi xoá — vì sau đó không còn gì để trỏ tới.
--
-- Nói cách khác: đường này để dọn hồ sơ trùng và hồ sơ nhập sai, không phải để
-- "cho một mentor nghỉ". Cho nghỉ thì dùng Chuyển sang Không tham dự / Huỷ tư
-- cách — những thứ đã có và khôi phục được.
--
-- Cùng một triết lý cho tài khoản ban tổ chức: tài khoản đã chấm bài, đã ra
-- quyết định, đã thao tác gì có ghi nhật ký thì KHÔNG xoá được, phải tạm khoá.
-- Xoá được là tài khoản chưa kịp làm gì — đúng trường hợp cấp nhầm rồi thu hồi.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CỔNG QUYỀN ĐỌC TỪ CLAIM CỦA REQUEST, KHÔNG ĐỌC `current_user`
-- ═══════════════════════════════════════════════════════════════════════════
-- Bài học 18/09/2026 (migration 20260918190000): trong một hàm SECURITY DEFINER
-- do postgres sở hữu, `current_user` luôn là postgres, nên mọi phép kiểm hỏi
-- `current_user = 'service_role'` đều trả false và hàm không bao giờ chạy. Hai
-- hàm dưới đây đọc vai trò API qua `vam063_trusted_api_role()`, và viết thẳng
-- phép kiểm vai trò/phạm vi tại chỗ.
--
-- Không đụng tới dòng dữ liệu nào đang có. Chạy lại nhiều lần vô hại.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $prereq$
begin
  if to_regclass('public.people') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.person_season_memberships') is null
     or to_regclass('public.person_season_membership_log') is null then
    raise exception 'PREREQ_MISSING: thiếu bảng nền của người và tài khoản';
  end if;
  if to_regprocedure('public.vam063_trusted_api_role()') is null then
    raise exception 'PREREQ_MISSING: cần hàm public.vam063_trusted_api_role()';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.admin_audit_log')
      and conname = 'admin_audit_log_action_type_check'
  ) then
    raise exception 'PREREQ_MISSING: cần ràng buộc admin_audit_log_action_type_check';
  end if;
end;
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. Nới loại nhật ký theo lối cộng thêm, so trước/sau
-- ---------------------------------------------------------------------------
do $audit_widen$
declare
  v_new constant text[] := array['delete_person', 'delete_admin_account'];
  v_existing      text;
  v_missing       text[];
  v_before_values text[];
  v_quotes        integer;
  v_suffix        text;
  v_rebuilt       text;
  v_after         text;
  v_after_values  text[];
  v_expected      text[];
begin
  select pg_get_constraintdef(c.oid) into v_existing
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  if v_existing not ilike '%= ANY (ARRAY[%' then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check không ở dạng ANY (ARRAY[...]): %', v_existing;
  end if;

  select coalesce(array_agg(v order by v), '{}') into v_missing
  from unnest(v_new) as v
  where position(quote_literal(v) in v_existing) = 0;

  if cardinality(v_missing) = 0 then
    return;
  end if;

  select array_agg(m[1] order by m[1]) into v_before_values
  from regexp_matches(v_existing, '''([^'']*)''::text', 'g') as m;

  v_quotes := length(v_existing) - length(replace(v_existing, '''', ''));
  if v_before_values is null or v_quotes <> cardinality(v_before_values) * 2 then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đọc được % giá trị nhưng đếm được % dấu nháy',
      coalesce(cardinality(v_before_values), 0), v_quotes;
  end if;

  select string_agg(format(', %L::text', v), '' order by v) into v_suffix
  from unnest(v_missing) as v;

  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', v_suffix || '\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng để nối vào: %', v_existing;
  end if;

  execute 'alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check';
  execute 'alter table public.admin_audit_log add constraint admin_audit_log_action_type_check '
       || replace(v_rebuilt, 'CHECK ', 'check ');

  select pg_get_constraintdef(c.oid) into v_after
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  select array_agg(m[1] order by m[1]) into v_after_values
  from regexp_matches(v_after, '''([^'']*)''::text', 'g') as m;

  select array_agg(x order by x) into v_expected
  from (select unnest(v_before_values) as x union select unnest(v_missing)) as s;

  if v_expected is distinct from v_after_values then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: đã MẤT giá trị cũ hoặc thừa giá trị lạ (trước % + thêm % → sau %)',
      cardinality(v_before_values), cardinality(v_missing), cardinality(v_after_values);
  end if;
end;
$audit_widen$;

-- ---------------------------------------------------------------------------
-- 2. Bản kê: xoá người này thì mất gì, và cái gì đang chặn
-- ---------------------------------------------------------------------------
--
-- MỘT CỬA cho cả màn hình xem trước lẫn hàm xoá. Hai nơi tự đếm lấy là hai nơi
-- có thể đếm khác nhau — và khi đó màn hình nói "xoá được" trong khi hàm xoá
-- nói không, hoặc tệ hơn, ngược lại.
create or replace function public.vam097_person_delete_report(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_api_role  text;
  v_person    public.people%rowtype;
  v_is_mentor boolean;
  v_is_mentee boolean;
  v_other     text[];
  v_blockers  jsonb := '{}'::jsonb;
  v_removes   jsonb := '{}'::jsonb;
  v_orphans   jsonb := '{}'::jsonb;
  v_seasons   uuid[];
  n           bigint;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select * into v_person from public.people where id = p_person_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_is_mentor := exists (select 1 from public.mentor_profiles where person_id = p_person_id)
              or exists (select 1 from public.person_season_memberships where person_id = p_person_id and role = 'mentor');
  v_is_mentee := exists (select 1 from public.mentee_profiles where person_id = p_person_id)
              or exists (select 1 from public.person_season_memberships where person_id = p_person_id and role = 'mentee');

  select coalesce(array_agg(distinct m.role), '{}')
    into v_other
  from public.person_season_memberships m
  where m.person_id = p_person_id and m.role not in ('mentor', 'mentee');

  select coalesce(array_agg(distinct s), '{}') into v_seasons
  from (
    select season_id as s from public.person_season_memberships where person_id = p_person_id and season_id is not null
    union
    select season_id from public.person_roles where person_id = p_person_id and season_id is not null
  ) q;

  -- ── Những thứ CHẶN: mất chúng đi là mất dữ liệu thật của chương trình ────
  select count(*) into n from public.matches
   where mentor_person_id = p_person_id or mentee_person_id = p_person_id
      or mentor_profile_id in (select id from public.mentor_profiles where person_id = p_person_id)
      or mentee_profile_id in (select id from public.mentee_profiles where person_id = p_person_id);
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('cap_ghep', n); end if;

  select count(*) into n from public.applications where person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('don_ung_tuyen', n); end if;

  select count(*) into n from public.mentoring_recaps
   where mentor_person_id = p_person_id or mentee_person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('recap', n); end if;

  select count(*) into n from public.event_participations where person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('tham_du_su_kien', n); end if;

  select count(*) into n from public.event_registrations
   where (person_id = p_person_id or linked_person_id = p_person_id)
     and attendance_status = 'checked_in';
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('da_diem_danh', n); end if;

  select count(*) into n from public.operational_team_assignments where person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('phan_cong_van_hanh', n); end if;

  select count(*) into n from public.action_items where target_person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('viec_can_lam', n); end if;

  select count(*) into n from public.account_person_auth_links where person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('tai_khoan_dang_nhap', n); end if;

  select count(*) into n from public.blog_posts where author_person_id = p_person_id;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('bai_blog', n); end if;

  -- ── Những thứ MẤT THEO ────────────────────────────────────────────────────
  select count(*) into n from public.person_season_memberships where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('membership', n);
  select count(*) into n from public.person_season_membership_log where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('nhat_ky_membership', n);
  select count(*) into n from public.person_season_invites where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('loi_moi_mua', n);
  select count(*) into n from public.person_roles where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('vai_tro', n);
  select count(*) into n from public.crm_notes where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('ghi_chu_crm', n);
  select count(*) into n from public.mentor_profiles where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('ho_so_mentor', n);
  select count(*) into n from public.mentee_profiles where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('ho_so_mentee', n);
  select count(*) into n from public.event_registrations where person_id = p_person_id;
  v_removes := v_removes || jsonb_build_object('dang_ky_su_kien', n);

  -- ── Những thứ CÒN LẠI nhưng mất liên kết ──────────────────────────────────
  select count(*) into n from public.event_registrations
   where linked_person_id = p_person_id and person_id is distinct from p_person_id;
  if n > 0 then v_orphans := v_orphans || jsonb_build_object('dang_ky_mat_lien_ket', n); end if;

  return jsonb_build_object(
    'found', true,
    'person', jsonb_build_object(
      'id', v_person.id,
      'full_name', v_person.full_name,
      'email', v_person.email_primary
    ),
    'is_mentor', v_is_mentor,
    'is_mentee', v_is_mentee,
    'other_roles', to_jsonb(v_other),
    'season_ids', to_jsonb(v_seasons),
    'blockers', v_blockers,
    'removes', v_removes,
    'orphans', v_orphans,
    'can_delete', v_blockers = '{}'::jsonb
  );
end;
$function$;

alter function public.vam097_person_delete_report(uuid) owner to postgres;
revoke all on function public.vam097_person_delete_report(uuid) from public, anon, authenticated;
grant execute on function public.vam097_person_delete_report(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Xoá một người
-- ---------------------------------------------------------------------------
create or replace function public.vam097_delete_person(
  p_actor uuid,
  p_person_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_report     jsonb;
  v_actor_role text;
  v_actor_auth uuid;
  v_allowed    text[];
  v_seasons    uuid[];
  v_season     uuid;
  v_snapshot   jsonb;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Cần ghi lý do xoá.';
  end if;

  -- Khoá dòng người này lại trước khi đọc bản kê: không thì giữa lúc đếm xong
  -- và lúc xoá, một tiến trình khác kịp ghép cặp cho họ, và phép "không có cặp
  -- ghép nào" trở thành sai đúng vào lúc nó được dùng.
  perform 1 from public.people where id = p_person_id for update;
  if not found then
    raise exception 'Không tìm thấy người này.';
  end if;

  v_report := public.vam097_person_delete_report(p_person_id);

  select au.role, au.auth_user_id into v_actor_role, v_actor_auth
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_role is null then
    raise exception 'Tài khoản thực hiện không hoạt động.';
  end if;

  -- Ai được xoá ai. Mentee thì support team xoá được; mentor, hoặc người mang
  -- thêm vai trò khác, thì không — đúng như chủ dự án chốt 20/09/2026.
  if (v_report->>'is_mentee')::boolean
     and not (v_report->>'is_mentor')::boolean
     and jsonb_array_length(v_report->'other_roles') = 0 then
    v_allowed := array['super_admin', 'admin', 'core_team', 'support_team'];
  else
    v_allowed := array['super_admin', 'admin', 'core_team'];
  end if;

  if not (v_actor_role = any (v_allowed)) then
    raise exception 'Bạn không có quyền xoá người này khỏi hệ thống.';
  end if;

  -- Phạm vi mùa: phải vận hành được MỌI mùa người đó thuộc về. "Ít nhất một
  -- mùa" nghĩa là người phụ trách mùa 11 xoá được một người đang chạy mùa 12.
  if v_actor_role <> 'super_admin' then
    select coalesce(array_agg(value::text::uuid), '{}') into v_seasons
    from jsonb_array_elements_text(v_report->'season_ids') as value;

    if cardinality(v_seasons) = 0 then
      if not exists (
        select 1 from public.admin_scope_access asa
        where asa.user_id = v_actor_auth and asa.status = 'active'
          and asa.role in ('operations', 'full_access')
      ) then
        raise exception 'Bạn không có phạm vi vận hành nào để xoá hồ sơ này.';
      end if;
    else
      foreach v_season in array v_seasons loop
        if not exists (
          select 1 from public.admin_scope_access asa
          where asa.user_id = v_actor_auth and asa.status = 'active'
            and asa.season_id = v_season::text
            and asa.role in ('operations', 'full_access')
        ) then
          raise exception 'Bạn không có quyền vận hành trong mọi mùa mà người này thuộc về.';
        end if;
      end loop;
    end if;
  end if;

  if not (v_report->>'can_delete')::boolean then
    raise exception 'Không xoá được: người này còn dữ liệu chương trình (%). Dùng Huỷ tư cách hoặc Chuyển sang Không tham dự.',
      (select string_agg(key, ', ') from jsonb_each_text(v_report->'blockers'));
  end if;

  -- Bản chụp ghi TRƯỚC khi xoá. Sau lệnh xoá thì không còn gì để chụp, và một
  -- dòng nhật ký chỉ có mã định danh là một dòng nhật ký không trả lời được câu
  -- "đã xoá mất ai".
  v_snapshot := jsonb_build_object(
    'person', v_report->'person',
    'is_mentor', v_report->'is_mentor',
    'is_mentee', v_report->'is_mentee',
    'other_roles', v_report->'other_roles',
    'season_ids', v_report->'season_ids',
    'removes', v_report->'removes',
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('season_id', m.season_id, 'role', m.role, 'status', m.status))
      from public.person_season_memberships m where m.person_id = p_person_id
    ), '[]'::jsonb),
    'mentor_profile', coalesce((
      select jsonb_agg(to_jsonb(mp)) from public.mentor_profiles mp where mp.person_id = p_person_id
    ), '[]'::jsonb),
    'mentee_profile', coalesce((
      select jsonb_agg(to_jsonb(mp)) from public.mentee_profiles mp where mp.person_id = p_person_id
    ), '[]'::jsonb)
  );

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
  ) values (
    p_actor, null, 'delete_person', v_snapshot, null,
    jsonb_build_object('person_id', p_person_id, 'reason', btrim(p_reason))
  );

  -- Nhật ký membership chặn lệnh xoá (RESTRICT), nên phải xoá tay trước. Phần
  -- còn lại đi theo CASCADE của chính khoá ngoại.
  delete from public.person_season_membership_log where person_id = p_person_id;
  delete from public.people where id = p_person_id;

  return jsonb_build_object('ok', true, 'deleted', v_report->'removes', 'person', v_report->'person');
end;
$function$;

alter function public.vam097_delete_person(uuid, uuid, text) owner to postgres;
revoke all on function public.vam097_delete_person(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.vam097_delete_person(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Bản kê cho một tài khoản ban tổ chức
-- ---------------------------------------------------------------------------
create or replace function public.vam097_admin_account_delete_report(p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_api_role text;
  v_user     public.admin_users%rowtype;
  v_blockers jsonb := '{}'::jsonb;
  v_removes  jsonb := '{}'::jsonb;
  n          bigint;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select * into v_user from public.admin_users where id = p_target;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Dấu vết công việc: có là không xoá được, phải tạm khoá.
  select count(*) into n from public.application_reviews
   where reviewer_admin_user_id = p_target and status <> 'cancelled';
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('bai_cham_dang_hoac_da_lam', n); end if;

  select count(*) into n from public.application_reviews where assigned_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('da_phan_cong_bai_cham', n); end if;

  select count(*) into n from public.application_decisions where decided_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('quyet_dinh_ket_qua', n); end if;

  select count(*) into n from public.admin_audit_log where actor_admin_user_id = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('thao_tac_da_ghi_nhat_ky', n); end if;

  select count(*) into n from public.review_assignment_batches where created_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('dot_phan_cong', n); end if;

  select count(*) into n from public.person_season_invites where created_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('loi_moi_da_tao', n); end if;

  select count(*) into n from public.recruitment_assignment_events
   where actor_admin_user_id = p_target or new_reviewer_admin_user_id = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('su_kien_phan_cong', n); end if;

  select count(*) into n from public.account_auth_operations where actor_admin_user_id = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('thao_tac_tai_khoan', n); end if;

  select count(*) into n from public.application_form_controls where updated_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('sua_cong_tac_form', n); end if;

  select count(*) into n from public.application_form_texts where updated_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('sua_chu_tren_form', n); end if;

  select count(*) into n from public.submission_bonus_rules where created_by = p_target;
  if n > 0 then v_blockers := v_blockers || jsonb_build_object('quy_tac_diem_cong', n); end if;

  -- Xoá theo: phân công đã huỷ và phạm vi. Đây đúng là dấu vết của một tài
  -- khoản được cấp quyền rồi thu hồi trước khi kịp làm gì.
  select count(*) into n from public.application_reviews
   where reviewer_admin_user_id = p_target and status = 'cancelled';
  v_removes := v_removes || jsonb_build_object('bai_cham_da_huy', n);

  select count(*) into n from public.recruitment_assignment_events
   where previous_reviewer_admin_user_id = p_target;
  v_removes := v_removes || jsonb_build_object('su_kien_phan_cong_cu', n);

  select count(*) into n from public.admin_scope_access where user_id = v_user.auth_user_id;
  v_removes := v_removes || jsonb_build_object('pham_vi', n);

  return jsonb_build_object(
    'found', true,
    'account', jsonb_build_object(
      'id', v_user.id, 'full_name', v_user.full_name,
      'email', v_user.email, 'role', v_user.role, 'status', v_user.status,
      'auth_user_id', v_user.auth_user_id
    ),
    'blockers', v_blockers,
    'removes', v_removes,
    'can_delete', v_blockers = '{}'::jsonb
  );
end;
$function$;

alter function public.vam097_admin_account_delete_report(uuid) owner to postgres;
revoke all on function public.vam097_admin_account_delete_report(uuid) from public, anon, authenticated;
grant execute on function public.vam097_admin_account_delete_report(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Xoá một tài khoản ban tổ chức
-- ---------------------------------------------------------------------------
--
-- Bậc quản lý: chỉ đụng được vào vai trò THẤP HƠN mình. Ngang cấp và cấp trên
-- đều không, và không ai tự xoá mình — một người tự khoá mình ra ngoài giữa mùa
-- là sự cố không có đường sửa từ trong ứng dụng.
create or replace function public.vam097_delete_admin_account(
  p_actor uuid,
  p_target uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_api_role   text;
  v_actor_role text;
  v_report     jsonb;
  v_target_role text;
  v_auth_id    uuid;
  v_manageable text[];
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Cần ghi lý do xoá.';
  end if;
  if p_actor = p_target then
    raise exception 'Không tự xoá tài khoản của chính mình.';
  end if;

  perform 1 from public.admin_users where id = p_target for update;
  if not found then
    raise exception 'Không tìm thấy tài khoản này.';
  end if;

  select au.role into v_actor_role
  from public.admin_users au where au.id = p_actor and au.status = 'active';
  if v_actor_role is null then
    raise exception 'Tài khoản thực hiện không hoạt động.';
  end if;

  v_report := public.vam097_admin_account_delete_report(p_target);
  v_target_role := v_report->'account'->>'role';
  v_auth_id := nullif(v_report->'account'->>'auth_user_id', '')::uuid;

  v_manageable := case v_actor_role
    when 'super_admin' then array['admin', 'core_team', 'support_team', 'reviewer', 'viewer']
    when 'admin'       then array['core_team', 'support_team', 'reviewer', 'viewer']
    when 'core_team'   then array['support_team', 'reviewer', 'viewer']
    else array[]::text[]
  end;

  if not (v_target_role = any (v_manageable)) then
    raise exception 'Bạn không có quyền xoá tài khoản cấp %.', coalesce(v_target_role, '(không rõ)');
  end if;

  if not (v_report->>'can_delete')::boolean then
    raise exception 'Không xoá được: tài khoản này đã để lại dấu vết công việc (%). Hãy tạm khoá thay vì xoá.',
      (select string_agg(key, ', ') from jsonb_each_text(v_report->'blockers'));
  end if;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
  ) values (
    p_actor, null, 'delete_admin_account', v_report->'account', null,
    jsonb_build_object('target_admin_user_id', p_target, 'reason', btrim(p_reason),
                       'removed', v_report->'removes')
  );

  delete from public.recruitment_assignment_events where previous_reviewer_admin_user_id = p_target;
  delete from public.application_reviews where reviewer_admin_user_id = p_target and status = 'cancelled';
  if v_auth_id is not null then
    delete from public.admin_scope_access where user_id = v_auth_id;
  end if;
  delete from public.admin_users where id = p_target;

  -- Tài khoản Auth do tầng ứng dụng xoá, bằng API quản trị của Supabase: xoá
  -- `auth.users` từ trong SQL bỏ qua mọi thứ Supabase dọn kèm một danh tính.
  return jsonb_build_object('ok', true, 'auth_user_id', v_auth_id, 'account', v_report->'account');
end;
$function$;

alter function public.vam097_delete_admin_account(uuid, uuid, text) owner to postgres;
revoke all on function public.vam097_delete_admin_account(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.vam097_delete_admin_account(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Tự kiểm — hỏng hợp đồng thì huỷ cả transaction
-- ---------------------------------------------------------------------------
do $self_check$
declare
  v_def text;
  v_acl text;
  v     text;
  v_fn  text;
begin
  foreach v_fn in array array[
    'public.vam097_person_delete_report(uuid)',
    'public.vam097_delete_person(uuid, uuid, text)',
    'public.vam097_admin_account_delete_report(uuid)',
    'public.vam097_delete_admin_account(uuid, uuid, text)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu hàm %', v_fn;
    end if;

    select pg_get_functiondef(to_regprocedure(v_fn)::oid) into v_def;

    if position('vam063_trusted_api_role()' in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % không đọc vai trò API từ claim của request', v_fn;
    end if;

    -- Bài học 18/09/2026: trong hàm SECURITY DEFINER, mọi phép kiểm phụ thuộc
    -- `current_user` đều trả false và hàm không bao giờ chạy. Tìm LỜI GỌI, không
    -- tìm cái tên — tên có thể nằm trong một dòng chú thích giải thích.
    if position('vam084_operator_for_season(' in v_def) > 0
       or position('vam084_staffing_operator_for_season(' in v_def) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % gọi phép kiểm phụ thuộc current_user', v_fn;
    end if;

    select coalesce(array_to_string(p.proacl, ' '), '') into v_acl
    from pg_proc p where p.oid = to_regprocedure(v_fn)::oid;
    if position('anon=' in v_acl) > 0 or position('authenticated=' in v_acl) > 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % lộ quyền chạy cho anon/authenticated (%)', v_fn, v_acl;
    end if;
    if position('service_role=' in v_acl) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: % chưa cấp quyền chạy cho service_role (%)', v_fn, v_acl;
    end if;
  end loop;

  -- Hàm xoá người phải thật sự xoá nhật ký membership trước: thiếu dòng đó thì
  -- ràng buộc RESTRICT chặn, và tính năng hỏng ở đúng lần dùng đầu tiên.
  select pg_get_functiondef(to_regprocedure('public.vam097_delete_person(uuid, uuid, text)')::oid) into v_def;
  if position('delete from public.person_season_membership_log' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam097_delete_person không dọn person_season_membership_log';
  end if;
  if position('for update' in v_def) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam097_delete_person không khoá dòng trước khi đếm';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.conname = 'admin_audit_log_action_type_check';

  foreach v in array array['delete_person', 'delete_admin_account'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check chưa nhận %', v;
    end if;
  end loop;
  foreach v in array array['create_event', 'send_event_reminder', 'override_application_review'] loop
    if position(quote_literal(v) in v_def) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: admin_audit_log_action_type_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;
end;
$self_check$;

notify pgrst, 'reload schema';

commit;
