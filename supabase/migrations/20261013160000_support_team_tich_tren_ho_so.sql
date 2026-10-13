-- Support team tích ngay trên hồ sơ → tự thành mentee của mùa (BTC 13/10/2026).
--
-- Luồng cũ (20261011150000): BTC tick từ danh sách gợi ý, hệ thống gửi thư, người nhận mở link
-- bấm "Xác nhận" thì mới thành mentee. BTC muốn làm thẳng: Support team / Core team / Admin tích
-- "Support team" trên hồ sơ của từng bạn, và bạn thành mentee của mùa NGAY (không gửi thư, không
-- chờ bấm). Mùa nào cũng làm được trên giao diện, không phải chạy lại SQL mỗi năm.
--
-- Migration này gom phần "làm một người thành mentee của mùa" vào MỘT hàm dùng chung
-- (vam121_grant_mentee_exemption) để hai đường không bao giờ nói hai câu khác nhau về cùng việc:
--   * vam117_confirm_mentee_exemption (đường link) nay chỉ kiểm token rồi gọi hàm chung. Ghi
--     Y HỆT như trước: cùng đơn / quyết định / hồ sơ / tư cách, cùng lời ghi, người ghi là
--     "không ai" (mentee tự xác nhận).
--   * vam121_set_support_team (đường tích) kiểm quyền người thao tác rồi gọi hàm chung. Lịch sử
--     đơn và lịch sử tư cách ghi TÊN người đã tích.
--
-- Mọi điều kiện cản (đơn đã bị từ chối / đã rút, tư cách đã ngừng, hồ sơ trùng email…) vẫn do
-- vam117_mentee_exemption_blocker quyết — một hàm cho cả hai đường. Gặp điều cần BTC xem thì
-- HỦY CẢ LỆNH (không để lại dòng đặc cách dở), và trả lỗi NEEDS_BTC:<mã>.
--
-- Vì sao hàm tích chạy bằng quyền chủ hàm: dấu "đã xác nhận" của bảng mentee_exemptions chỉ do
-- hàm của database đặt (service_role không có quyền UPDATE các cột đó, cố ý). Nên cổng quyền của
-- người thao tác phải nằm TRONG hàm — vam104_offline_access và vam084_operator_for_season kiểm
-- current_user = 'service_role' nên không dùng được bên trong hàm quyền chủ hàm. Luật "ai được
-- vận hành mùa" nằm ở vam121_actor_may_operate_season, giữ đúng bằng vam104_offline_access(…, true).
-- Test PGlite đối chiếu hai hàm với mọi tài khoản × mọi mùa để chúng không lệch nhau.
--
-- Không có bảng mới, không đổi quyền bảng nào.

do $prereq$
begin
  if to_regclass('public.mentee_exemptions') is null then
    raise exception 'PREREQ_MISSING: chưa có bảng mentee_exemptions (20261011150000)';
  end if;
  if to_regprocedure('public.vam117_mentee_exemption_blocker(uuid, uuid)') is null
     or to_regprocedure('public.vam117_confirm_mentee_exemption(uuid)') is null then
    raise exception 'PREREQ_MISSING: chưa có các hàm vam117 (20261011150000)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role') then
    raise exception 'PREREQ_MISSING: chưa có vam063_trusted_api_role';
  end if;
  if to_regclass('public.admin_scope_access') is null or to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: thiếu admin_users / admin_scope_access';
  end if;
end
$prereq$;

-- Người thao tác có được vận hành mùa này không. Cùng luật với vam104_offline_access(actor, season, true):
-- Super admin / Admin / Core team (admin và core cần quyền operations hoặc full_access của mùa),
-- và Support team có quyền operations hoặc full_access của mùa. Chỉ gọi được từ hàm quyền chủ hàm.
create or replace function public.vam121_actor_may_operate_season(p_actor uuid, p_season uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
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
              and asa.season_id = p_season::text
              and asa.role in ('operations', 'full_access')
          )
        )
      )
  );
$function$;

-- MỘT chỗ làm một người thành mentee của mùa, như một người đạt phỏng vấn: đơn ở trạng thái đã
-- duyệt (duyệt đơn sẵn có, hoặc tạo một đơn tối thiểu ghi rõ nguồn đặc cách), có mentee profile,
-- có tư cách mentee đang hoạt động. Chỉ hàm khác của database gọi được (không ai trong API).
--   p_actor      người đã tích (null = chính mentee bấm link).
--   p_actor_name tên ghi vào lịch sử đơn.
--   p_note       lời ghi vào lịch sử đơn và lịch sử tư cách.
-- Trả { ok: true, code: 'confirmed' }, hoặc { ok: false, code: 'needs_btc', reason } và KHÔNG ghi gì.
create or replace function public.vam121_grant_mentee_exemption(p_exemption uuid, p_actor uuid, p_actor_name text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  e public.mentee_exemptions%rowtype;
  p public.people%rowtype;
  v_email text;
  v_blocker text;
  v_app_id uuid;
  v_app_status text;
  v_program uuid;
  v_membership uuid;
  v_member_status text;
  v_now timestamptz := now();
begin
  select x.* into e from public.mentee_exemptions x where x.id = p_exemption for update;
  if e.id is null then raise exception 'EXEMPTION_NOT_FOUND'; end if;

  select x.* into p from public.people x where x.id = e.person_id;
  v_email := lower(btrim(p.email_primary::text));
  -- Cùng hai khoá với đường duyệt đơn và đường "đạt phỏng vấn": không ai tạo hồ sơ hay đơn thứ
  -- hai cho cùng người trong lúc đang kiểm.
  if nullif(v_email, '') is not null then
    perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || e.person_id::text));

  -- KIỂM HẾT RỒI MỚI GHI. Từ đây xuống tới dòng "GHI" không có lệnh ghi nào.
  v_blocker := public.vam117_mentee_exemption_blocker(e.season_id, e.person_id);
  if v_blocker is not null then
    return jsonb_build_object('ok', false, 'code', 'needs_btc', 'reason', v_blocker);
  end if;
  select program_id into v_program from public.seasons where id = e.season_id;
  if v_program is null then return jsonb_build_object('ok', false, 'code', 'needs_btc', 'reason', 'season_without_program'); end if;

  select a.id, a.status into v_app_id, v_app_status
  from public.applications a
  where a.id in (select public.vam117_mentee_application_ids(e.season_id, e.person_id, v_email))
  for update;
  -- Đọc lại SAU khi đã khoá dòng đơn: BTC có thể vừa từ chối đơn này trong tích tắc giữa phép
  -- kiểm ở trên và khoá ở đây.
  if v_app_status in ('rejected_or_not_fit', 'withdrawn') then
    return jsonb_build_object('ok', false, 'code', 'needs_btc', 'reason', 'application_closed');
  end if;

  -- GHI.
  if v_app_id is null then
    -- Chưa từng nộp đơn mùa này (mentee mùa trước ở lại làm Support team): tạo một đơn tối thiểu,
    -- ghi rõ nguồn. Không bịa câu trả lời nào — raw_payload chỉ nói đây là đặc cách.
    insert into public.applications(
      person_id, season_id, role_applied, status, source,
      full_name, email_primary, phone_primary, consent_data_storage, raw_payload, submitted_at
    ) values (
      e.person_id, e.season_id, 'mentee', 'approved_as_mentee', 's12_mentee_exemption',
      p.full_name, btrim(p.email_primary::text), p.phone_primary, true,
      jsonb_build_object(
        'source', 's12_mentee_exemption',
        'exemption_reason', e.reason,
        'exemption_id', e.id,
        'exemption_confirmed_at', v_now
      ),
      (v_now at time zone 'Asia/Ho_Chi_Minh')::date
    ) returning id into v_app_id;
    insert into public.application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note)
      values (v_app_id, p_actor, p_actor_name, 'approved_as_mentee', null, 'approved_as_mentee', p_note);
  elsif v_app_status is distinct from 'approved_as_mentee' then
    update public.applications set status = 'approved_as_mentee', person_id = e.person_id where id = v_app_id;
    insert into public.application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note)
      values (v_app_id, p_actor, p_actor_name, 'approved_as_mentee', v_app_status, 'approved_as_mentee', p_note);
  else
    -- Đơn đã duyệt từ trước (BTC bấm duyệt tay): chỉ nối hồ sơ người nếu còn thiếu.
    update public.applications set person_id = e.person_id where id = v_app_id and person_id is null;
  end if;

  if not exists (select 1 from public.mentee_profiles mp where mp.person_id = e.person_id) then
    insert into public.mentee_profiles(person_id, source_application_id) values (e.person_id, v_app_id);
  end if;

  select m.id, m.status into v_membership, v_member_status
  from public.person_season_memberships m
  where m.person_id = e.person_id and m.season_id = e.season_id and m.role = 'mentee'
  for update;
  if v_membership is null then
    insert into public.person_season_memberships(person_id, program_id, season_id, role, status, source)
      values (e.person_id, v_program, e.season_id, 'mentee', 'active', 'application')
      returning id into v_membership;
    insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
      values (v_membership, e.person_id, v_program, e.season_id, 'mentee', null, 'active', 'created', p_note, p_actor);
  elsif v_member_status = 'invited' then
    update public.person_season_memberships set status = 'active', updated_at = now() where id = v_membership;
    insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
      values (v_membership, e.person_id, v_program, e.season_id, 'mentee', 'invited', 'active', 'status_change', p_note, p_actor);
  end if;

  update public.mentee_exemptions
     set confirmed_at = v_now, application_id = v_app_id, claimed_at = null
   where id = e.id;
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$function$;

-- Đường link: người nhận bấm "Xác nhận". Chỉ còn kiểm token; phần ghi do hàm chung làm.
create or replace function public.vam117_confirm_mentee_exemption(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
  e public.mentee_exemptions%rowtype;
  c_actor_name constant text := 'Mentee tự xác nhận (đặc cách Support team)';
  c_note constant text := 'Đặc cách Support team: không qua phỏng vấn. Mentee tự xác nhận tham gia qua link riêng.';
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select x.* into e from public.mentee_exemptions x where x.token = p_token for update;
  if e.id is null then return jsonb_build_object('ok', false, 'code', 'invalid_token'); end if;
  if e.revoked_at is not null then return jsonb_build_object('ok', false, 'code', 'revoked'); end if;
  -- Bấm lần hai (hoặc mở lại thư cũ) không ghi gì thêm.
  if e.confirmed_at is not null then return jsonb_build_object('ok', true, 'code', 'already_confirmed'); end if;

  return public.vam121_grant_mentee_exemption(e.id, null, c_actor_name, c_note);
end;
$function$;

-- Đường tích: người vận hành tích "Support team" trên hồ sơ → thành mentee của mùa ngay.
--   Trả { ok: true, code: 'marked' }  — vừa làm xong;
--       { ok: true, code: 'already' } — người này đã là Support team của mùa (không ghi gì thêm).
--   Lỗi: ACCESS_DENIED (người thao tác không vận hành được mùa), PERSON_NOT_FOUND,
--        NEEDS_BTC:<mã> (đơn bị từ chối / đã rút, tư cách đã ngừng, hồ sơ trùng…). Mọi lỗi đều
--        hủy cả lệnh: không để lại dòng đặc cách dở.
create or replace function public.vam121_set_support_team(p_actor uuid, p_season uuid, p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
  e public.mentee_exemptions%rowtype;
  v_exemption uuid;
  v_name text;
  v_email text;
  v_result jsonb;
  c_note constant text := 'Support team: tự động thành mentee, không qua phỏng vấn. Người vận hành tích “Support team” trên hồ sơ.';
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;
  if p_actor is null or p_season is null or p_person is null then raise exception 'ACCESS_DENIED'; end if;
  if not public.vam121_actor_may_operate_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;

  select lower(btrim(x.email_primary::text)) into v_email from public.people x where x.id = p_person;
  if not found then raise exception 'PERSON_NOT_FOUND'; end if;
  -- Khoá trước khi đọc dòng đặc cách: hai người cùng tích một bạn thì nối đuôi nhau.
  if nullif(v_email, '') is not null then
    perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || p_person::text));

  select coalesce(nullif(btrim(au.full_name), ''), au.email, 'Người vận hành') into v_name
  from public.admin_users au where au.id = p_actor;

  select x.* into e from public.mentee_exemptions x
   where x.season_id = p_season and x.person_id = p_person for update;
  if e.id is not null and e.confirmed_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;

  if e.id is null then
    insert into public.mentee_exemptions(season_id, person_id, reason, added_by)
      values (p_season, p_person, 'support_team', p_actor)
      returning id into v_exemption;
  else
    v_exemption := e.id;
  end if;
  if e.id is not null and e.revoked_at is not null then
    -- Từng bị gỡ khỏi danh sách: tích lại là đưa lại, giữ nguyên link cũ.
    update public.mentee_exemptions set revoked_at = null, revoked_by = null where id = v_exemption;
  end if;

  v_result := public.vam121_grant_mentee_exemption(v_exemption, p_actor, v_name, c_note);
  if not coalesce((v_result->>'ok')::boolean, false) then
    -- Hủy cả lệnh, kể cả dòng đặc cách vừa thêm.
    raise exception 'NEEDS_BTC:%', coalesce(v_result->>'reason', 'unknown');
  end if;
  return jsonb_build_object('ok', true, 'code', 'marked');
end;
$function$;

-- Hàm giúp việc: chỉ hàm quyền chủ hàm gọi được, không ai trong API gọi thẳng.
revoke all on function public.vam121_actor_may_operate_season(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.vam121_grant_mentee_exemption(uuid, uuid, text, text) from public, anon, authenticated, service_role;
-- Hai hàm máy chủ gọi.
revoke all on function public.vam117_confirm_mentee_exemption(uuid) from public, anon, authenticated;
revoke all on function public.vam121_set_support_team(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam117_confirm_mentee_exemption(uuid) to service_role;
grant execute on function public.vam121_set_support_team(uuid, uuid, uuid) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'vam121_grant_mentee_exemption' and prosecdef)
     or not exists (select 1 from pg_proc where proname = 'vam121_set_support_team' and prosecdef)
     or not exists (select 1 from pg_proc where proname = 'vam117_confirm_mentee_exemption' and prosecdef) then
    raise exception 'Ba hàm ghi phải chạy bằng quyền chủ hàm';
  end if;
  if exists (select 1 from pg_proc where proname = 'vam121_actor_may_operate_season' and prosecdef) then
    raise exception 'vam121_actor_may_operate_season chỉ đọc, không cần quyền chủ hàm';
  end if;
  if has_function_privilege('anon', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'public.vam121_grant_mentee_exemption(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.vam121_actor_may_operate_season(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam121_actor_may_operate_season(uuid, uuid)', 'execute')
     or has_function_privilege('service_role', 'public.vam121_actor_may_operate_season(uuid, uuid)', 'execute') then
    raise exception 'Hàm giúp việc đang mở cho API hoặc hàm tích đang mở cho anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.vam121_set_support_team(uuid, uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute') then
    raise exception 'service_role chưa gọi được hàm tích / hàm xác nhận';
  end if;
  if position('vam121_grant_mentee_exemption' in pg_get_functiondef('public.vam117_confirm_mentee_exemption(uuid)'::regprocedure)) = 0
     or position('vam121_grant_mentee_exemption' in pg_get_functiondef('public.vam121_set_support_team(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'Hai đường (link và tích) phải cùng đi qua vam121_grant_mentee_exemption';
  end if;
  if has_column_privilege('service_role', 'public.mentee_exemptions', 'confirmed_at', 'update')
     or has_column_privilege('service_role', 'public.mentee_exemptions', 'application_id', 'update') then
    raise exception 'Máy chủ không được tự đặt dấu xác nhận';
  end if;
  raise notice 'Support team tích trên hồ sơ: sẵn sàng';
end $$;
