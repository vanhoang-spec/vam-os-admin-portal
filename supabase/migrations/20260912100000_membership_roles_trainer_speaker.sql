-- ═══════════════════════════════════════════════════════════════════════════
-- Trainer và Speaker trở thành vai trò trong mùa
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Trước migration này, "diễn giả" và "trainer" chỉ tồn tại ở MỘT BUỔI:
-- `event_participants.role_at_event` nhận 'speaker' và 'trainer', và đó là tất
-- cả. Người đứng lớp cả mùa không có chỗ nào trong CRM nói rằng họ thuộc về mùa
-- đó — mở hồ sơ họ ra chỉ thấy trống, và câu "mùa này có những ai đứng lớp"
-- phải đi hỏi từng buổi một rồi tự gộp lại.
--
-- Mentor và Mentee thì ngược lại: đã là vai trò trong mùa từ đầu, 637 và 671
-- người. Migration này KHÔNG đụng gì tới hai vai trò đó; nó chỉ cho Trainer và
-- Speaker đứng cùng chỗ với chúng.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÌ SAO PHẢI NỚI HAI BẢNG, KHÔNG PHẢI MỘT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `vam063_add_membership_role` ghi vào `person_season_memberships` RỒI ghi vào
-- `person_season_membership_log`, trong cùng một transaction. Hai bảng đang
-- mang hai ràng buộc CHECK riêng với cùng một danh sách vai trò.
--
-- Nới mỗi bảng thứ nhất thì dòng membership vào được, dòng log bị chặn, và cả
-- transaction quay lui. Người vận hành thấy "không thêm được vai trò" mà không
-- thấy lý do, còn database thì sạch sẽ như chưa có gì xảy ra — đúng kiểu lỗi
-- tốn nửa ngày mới tìm ra.
--
-- `person_season_invites_role_check` CỐ Ý không nới. Bảng đó là lời mời gia hạn
-- mùa mới gửi cho mentor cũ; trainer và speaker không đi qua đường đó.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Preflight: thiếu thứ gì thì liệt kê đủ trong một lần, đừng bắt chạy lại năm
-- lần để phát hiện năm thứ thiếu.
-- ───────────────────────────────────────────────────────────────────────────
do $preflight$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.person_season_memberships') is null then
    missing := missing || 'bảng person_season_memberships';
  end if;
  if to_regclass('public.person_season_membership_log') is null then
    missing := missing || 'bảng person_season_membership_log';
  end if;
  if to_regproc('public.vam063_add_membership_role') is null then
    missing := missing || 'hàm vam063_add_membership_role';
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'PREFLIGHT_FAILED: chưa có %', array_to_string(missing, '; ');
  end if;
end;
$preflight$;

-- ───────────────────────────────────────────────────────────────────────────
-- Nới hai ràng buộc theo lối cộng thêm
-- ───────────────────────────────────────────────────────────────────────────
--
-- Đọc lại định nghĩa đang chạy rồi nối vào đuôi, thay vì viết đè cả danh sách.
-- Viết đè nghĩa là phải chép đúng chín giá trị đã có; chép thiếu 'alumni_mentee'
-- một lần là từ đó không ai thêm được mentee cũ nữa, và không có gì báo.
--
-- So sánh trước/sau bằng `@>` ở khối tự kiểm cuối file chứng minh chuyện đó
-- không xảy ra: danh sách mới phải CHỨA trọn danh sách cũ.
do $widen_membership_roles$
declare
  target    record;
  existing  text;
  rebuilt   text;
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

    -- Đã có rồi thì thôi: migration chạy lại lần hai không được nhân đôi giá trị.
    if position('''trainer''' in existing) > 0 and position('''speaker''' in existing) > 0 then
      continue;
    end if;

    rebuilt := regexp_replace(
      existing,
      '\]\)\)\)$',
      ', ''trainer''::text, ''speaker''::text])))'
    );

    if rebuilt = existing then
      raise exception
        'SCHEMA_CONTRACT_VIOLATION: % có dạng lạ, không nới được: %',
        target.con, existing;
    end if;

    execute format('alter table %s drop constraint %I', target.tbl, target.con);
    execute format('alter table %s add constraint %I %s',
                   target.tbl, target.con, replace(rebuilt, 'CHECK ', 'check '));
  end loop;
end;
$widen_membership_roles$;

-- ───────────────────────────────────────────────────────────────────────────
-- Cổng vai trò trong hàm ghi
-- ───────────────────────────────────────────────────────────────────────────
--
-- Ràng buộc CHECK nói giá trị nào LƯU được; hàm này nói giá trị nào THÊM TAY
-- được từ màn hình hồ sơ. Hai câu hỏi khác nhau, và đây là lý do danh sách của
-- hàm hẹp hơn danh sách của bảng: 'reviewer' và 'interviewer' lưu được nhưng
-- không thêm tay qua đường này — chúng do đường cấp quyền tuyển sinh ghi ra, và
-- ghi kèm những thứ khác mà đường này không biết làm.
--
-- Trainer và Speaker thì không có đường nào khác, nên chúng vào đây.
--
-- Chép nguyên bản hàm đang chạy trên production, đổi đúng một dòng. Phần còn
-- lại — khoá advisory, chặn cross-program, ghi log, ghi audit — giữ y nguyên.
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
  if p_role not in ('mentor','mentee','trainer','speaker') then
    raise exception 'VAM063 unsupported participant role';
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

-- Hàm đã tồn tại trên production nên quyền đã cấp từ trước; `create or replace`
-- giữ nguyên chủ sở hữu và quyền. Cấp lại ở đây cho trường hợp chạy trên một
-- bản sao mới, và `revoke` trước để không nới rộng hơn chủ đích.
revoke all on function public.vam063_add_membership_role(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.vam063_add_membership_role(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tự kiểm
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ba câu hỏi, và câu thứ ba là câu quan trọng nhất: danh sách mới có còn chứa
-- trọn danh sách cũ không. Một migration nới ràng buộc mà làm mất một giá trị
-- cũ chỉ lộ ra vào lần ai đó thêm đúng vai trò bị mất.
do $self_check$
declare
  def_membership text;
  def_log        text;
  old_values     text[] := array['mentee','mentor','supporter','reviewer','interviewer','coreteam','advisor','alumni_mentee','guest'];
  v              text;
begin
  select pg_get_constraintdef(c.oid) into def_membership
  from pg_constraint c
  where c.conrelid = 'public.person_season_memberships'::regclass
    and c.conname = 'person_season_memberships_role_check';

  select pg_get_constraintdef(c.oid) into def_log
  from pg_constraint c
  where c.conrelid = 'public.person_season_membership_log'::regclass
    and c.conname = 'person_season_membership_log_role_check';

  foreach v in array array['trainer','speaker'] loop
    if position('''' || v || '''' in coalesce(def_membership, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: person_season_memberships_role_check chưa nhận %', v;
    end if;
    if position('''' || v || '''' in coalesce(def_log, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: person_season_membership_log_role_check chưa nhận %', v;
    end if;
  end loop;

  -- Không mất giá trị cũ nào.
  foreach v in array old_values loop
    if position('''' || v || '''' in coalesce(def_membership, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: person_season_memberships_role_check đã MẤT giá trị cũ %', v;
    end if;
    if position('''' || v || '''' in coalesce(def_log, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: person_season_membership_log_role_check đã MẤT giá trị cũ %', v;
    end if;
  end loop;

  -- Hàm ghi đã nhận hai vai trò mới.
  if position('''mentor'',''mentee'',''trainer'',''speaker''' in
      pg_get_functiondef('public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: vam063_add_membership_role chưa nhận trainer/speaker';
  end if;
end;
$self_check$;
