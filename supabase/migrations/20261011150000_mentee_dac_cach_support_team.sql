-- Mentee đặc cách — Support team làm mentee mùa này mà không qua phỏng vấn (BTC 11/10/2026).
--
-- Chuyện có từ trước: tháng 8, BTC đã tự tay cho 19 bạn Support team làm mentee mùa 12 theo
-- hai lối khác nhau — 10 bạn (mentee mùa 11) được gắn thẳng tư cách mentee, KHÔNG có đơn mùa
-- 12; 9 bạn có đơn và được bấm "Duyệt làm mentee". Không lối nào để lại dấu "đặc cách", nên
-- "Đạt phỏng vấn" và "Mentee mùa" lệch nhau mà không ai giải thích được; và 10 bạn không có
-- đơn thì KHÔNG hiện ở Vòng 2 (Vòng 2 đọc theo đơn đã duyệt) — mentor không chọn được.
--
-- Migration này cho việc đó một chỗ đứng:
--   * bảng mentee_exemptions: danh sách đặc cách do BTC chốt, mỗi người một link riêng;
--   * BTC gửi thư mời; người nhận mở link, bấm "Xác nhận" là xong;
--   * lúc xác nhận, hệ thống làm cho người đó thành mentee mùa này đúng như một người đạt
--     phỏng vấn: có đơn ở trạng thái đã duyệt (duyệt đơn sẵn có, hoặc tạo một đơn tối thiểu
--     ghi rõ nguồn đặc cách), có mentee profile, có tư cách mentee đang hoạt động.
--
-- Hàm xác nhận chạy bằng quyền chủ hàm vì người bấm không có tài khoản: chỉ máy chủ VAM OS
-- gọi được (vam063_trusted_api_role = service_role), token là thứ duy nhất xác định người,
-- và mọi điều kiện kiểm lại TRONG hàm. Kiểm hết rồi mới ghi: gặp điều gì cần BTC xem
-- (đơn đã bị từ chối/đã rút, tư cách đã ngừng, hồ sơ trùng) thì trả mã, KHÔNG ghi dở.
--
-- Máy chủ không tự đặt được dấu "đã xác nhận": quyền UPDATE của service_role chỉ mở trên
-- các cột theo dõi gửi thư và cột gỡ khỏi danh sách.
--
-- Kèm theo: nới outbound_emails_kind_check theo lối cộng thêm — + 'mentee_exemption_confirm'.

do $prereq$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role') then
    raise exception 'PREREQ_MISSING: chưa có vam063_trusted_api_role';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vam084_operator_for_season') then
    raise exception 'PREREQ_MISSING: chưa có vam084_operator_for_season';
  end if;
  if to_regclass('public.person_season_membership_log') is null
     or to_regclass('public.application_decisions') is null
     or to_regclass('public.mentee_profiles') is null then
    raise exception 'PREREQ_MISSING: thiếu bảng tư cách mùa / quyết định đơn / mentee profile';
  end if;
end
$prereq$;

create table if not exists public.mentee_exemptions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  person_id uuid not null references public.people(id),
  reason text not null default 'support_team' check (reason in ('support_team')),
  token uuid not null unique default gen_random_uuid(),
  added_by uuid references public.admin_users(id),
  added_at timestamptz not null default now(),
  send_count integer not null default 0 check (send_count >= 0),
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  confirmed_at timestamptz,
  application_id uuid references public.applications(id),
  revoked_at timestamptz,
  revoked_by uuid references public.admin_users(id),
  constraint mentee_exemptions_person_uniq unique (season_id, person_id)
);

alter table public.mentee_exemptions enable row level security;
revoke all on public.mentee_exemptions from public, anon, authenticated, service_role;
grant select, insert on public.mentee_exemptions to service_role;
-- Cố ý KHÔNG có confirmed_at, application_id, token, person_id: dấu xác nhận chỉ do hàm
-- xác nhận đặt, và link đã nằm trong hộp thư thì không đổi chủ.
grant update (send_count, first_sent_at, last_sent_at, claimed_at, last_error, revoked_at, revoked_by)
  on public.mentee_exemptions to service_role;

-- Đơn mentee của một người trong mùa: theo hồ sơ người, hoặc theo email (đơn nộp qua form
-- mới chưa được nối hồ sơ người cho tới khi duyệt).
create or replace function public.vam117_mentee_application_ids(p_season uuid, p_person uuid, p_email text)
returns setof uuid
language sql
stable
set search_path = ''
as $function$
  select a.id
  from public.applications a
  where a.season_id = p_season
    and lower(coalesce(a.role_applied::text, '')) = 'mentee'
    and (a.person_id = p_person
         or (nullif(p_email, '') is not null and lower(btrim(a.email_primary::text)) = p_email));
$function$;

-- Vì sao một người CHƯA thể vào danh sách đặc cách / chưa thể xác nhận. Trả null = được.
-- Một hàm cho cả lúc BTC thêm lẫn lúc người nhận bấm: hai nơi không được nói hai câu khác
-- nhau về cùng một người.
create or replace function public.vam117_mentee_exemption_blocker(p_season uuid, p_person uuid)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_name text;
  v_email text;
  v_count integer;
  v_app public.applications%rowtype;
  v_status text;
begin
  select nullif(btrim(p.full_name), ''), lower(btrim(p.email_primary::text)) into v_name, v_email
  from public.people p where p.id = p_person;
  if not found then return 'person_not_found'; end if;
  if v_name is null or nullif(v_email, '') is null then return 'no_email'; end if;
  select count(*) into v_count from public.people p where lower(btrim(p.email_primary::text)) = v_email;
  if v_count <> 1 then return 'email_ambiguous'; end if;

  select count(*) into v_count from public.vam117_mentee_application_ids(p_season, p_person, v_email);
  if v_count > 1 then return 'application_ambiguous'; end if;
  if v_count = 1 then
    select a.* into v_app from public.applications a
     where a.id in (select public.vam117_mentee_application_ids(p_season, p_person, v_email));
    -- Đơn đã bị từ chối hoặc đã rút là một quyết định có chủ: đặc cách không tự lật lại.
    if v_app.status in ('rejected_or_not_fit', 'withdrawn') then return 'application_closed'; end if;
    if v_app.person_id is not null and v_app.person_id <> p_person then return 'application_other_person'; end if;
  end if;

  select count(*) into v_count from public.mentee_profiles mp where mp.person_id = p_person;
  if v_count > 1 then return 'profile_ambiguous'; end if;

  select count(*), max(m.status) into v_count, v_status
  from public.person_season_memberships m
  where m.person_id = p_person and m.season_id = p_season and m.role = 'mentee';
  if v_count > 1 then return 'membership_ambiguous'; end if;
  -- Tư cách đã rút / tạm dừng / kết thúc: BTC quyết ở trang hồ sơ, link không tự bật lại.
  if v_count = 1 and v_status not in ('active', 'invited') then return 'membership_inactive'; end if;
  return null;
end;
$function$;

-- BTC thêm người vào danh sách đặc cách. Trả kết quả từng người; một người không hợp lệ
-- không chặn những người còn lại.
create or replace function public.vam117_add_mentee_exemptions(p_actor uuid, p_season uuid, p_people uuid[])
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_person uuid;
  v_blocker text;
  v_existing public.mentee_exemptions%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_code text;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  if p_people is null or cardinality(p_people) = 0 then raise exception 'PEOPLE_REQUIRED'; end if;
  if cardinality(p_people) > 200 then raise exception 'TOO_MANY_PEOPLE'; end if;

  for v_person in select distinct x from unnest(p_people) as x where x is not null order by 1 loop
    select e.* into v_existing from public.mentee_exemptions e
     where e.season_id = p_season and e.person_id = v_person for update;
    if v_existing.id is not null and v_existing.revoked_at is null then
      v_code := 'exists';
    else
      v_blocker := public.vam117_mentee_exemption_blocker(p_season, v_person);
      if v_blocker is not null then
        v_code := v_blocker;
      elsif v_existing.id is not null then
        -- Đã từng bị gỡ: đưa lại, giữ nguyên link cũ (thư cũ trong hộp thư vẫn dùng được).
        update public.mentee_exemptions set revoked_at = null, revoked_by = null where id = v_existing.id;
        v_code := 'restored';
      else
        insert into public.mentee_exemptions(season_id, person_id, reason, added_by)
          values (p_season, v_person, 'support_team', p_actor);
        v_code := 'added';
      end if;
    end if;
    v_results := v_results || jsonb_build_object('personId', v_person, 'code', v_code);
  end loop;
  return jsonb_build_object('ok', true, 'results', v_results);
end;
$function$;

-- BTC gỡ một người khỏi danh sách. Người đã xác nhận thì không gỡ ở đây: họ đã là mentee
-- mùa này, muốn ngừng thì xử lý tư cách ở trang hồ sơ như mọi mentee khác.
create or replace function public.vam117_revoke_mentee_exemption(p_actor uuid, p_season uuid, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  e public.mentee_exemptions%rowtype;
begin
  if not public.vam084_operator_for_season(p_actor, p_season) then raise exception 'ACCESS_DENIED'; end if;
  select x.* into e from public.mentee_exemptions x where x.id = p_id and x.season_id = p_season for update;
  if e.id is null then raise exception 'EXEMPTION_NOT_FOUND'; end if;
  if e.confirmed_at is not null then raise exception 'ALREADY_CONFIRMED'; end if;
  if e.revoked_at is null then
    update public.mentee_exemptions set revoked_at = now(), revoked_by = p_actor, claimed_at = null where id = e.id;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- Người nhận bấm "Xác nhận" trên trang link riêng.
create or replace function public.vam117_confirm_mentee_exemption(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_api_role text;
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

  select x.* into p from public.people x where x.id = e.person_id;
  v_email := lower(btrim(p.email_primary::text));
  -- Cùng hai khoá với đường duyệt đơn và đường "đạt phỏng vấn": không ai tạo hồ sơ hay
  -- đơn thứ hai cho cùng người trong lúc đang kiểm.
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
  -- Đọc lại SAU khi đã khoá dòng đơn: BTC có thể vừa từ chối đơn này trong tích tắc giữa
  -- phép kiểm ở trên và khoá ở đây.
  if v_app_status in ('rejected_or_not_fit', 'withdrawn') then
    return jsonb_build_object('ok', false, 'code', 'needs_btc', 'reason', 'application_closed');
  end if;

  -- GHI.
  if v_app_id is null then
    -- Chưa từng nộp đơn mùa này (mentee mùa trước ở lại làm Support team): tạo một đơn tối
    -- thiểu, ghi rõ nguồn. Không bịa câu trả lời nào — raw_payload chỉ nói đây là đặc cách.
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
      values (v_app_id, null, c_actor_name, 'approved_as_mentee', null, 'approved_as_mentee', c_note);
  elsif v_app_status is distinct from 'approved_as_mentee' then
    update public.applications set status = 'approved_as_mentee', person_id = e.person_id where id = v_app_id;
    insert into public.application_decisions(application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note)
      values (v_app_id, null, c_actor_name, 'approved_as_mentee', v_app_status, 'approved_as_mentee', c_note);
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
      values (v_membership, e.person_id, v_program, e.season_id, 'mentee', null, 'active', 'created', c_note, null);
  elsif v_member_status = 'invited' then
    update public.person_season_memberships set status = 'active', updated_at = now() where id = v_membership;
    insert into public.person_season_membership_log(membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
      values (v_membership, e.person_id, v_program, e.season_id, 'mentee', 'invited', 'active', 'status_change', c_note, null);
  end if;

  update public.mentee_exemptions
     set confirmed_at = v_now, application_id = v_app_id, claimed_at = null
   where id = e.id;
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$function$;

revoke all on function public.vam117_mentee_application_ids(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.vam117_mentee_exemption_blocker(uuid, uuid) from public, anon, authenticated;
revoke all on function public.vam117_add_mentee_exemptions(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.vam117_revoke_mentee_exemption(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.vam117_confirm_mentee_exemption(uuid) from public, anon, authenticated;
grant execute on function public.vam117_mentee_application_ids(uuid, uuid, text) to service_role;
grant execute on function public.vam117_mentee_exemption_blocker(uuid, uuid) to service_role;
grant execute on function public.vam117_add_mentee_exemptions(uuid, uuid, uuid[]) to service_role;
grant execute on function public.vam117_revoke_mentee_exemption(uuid, uuid, uuid) to service_role;
grant execute on function public.vam117_confirm_mentee_exemption(uuid) to service_role;

-- Loại thư mới, theo lối cộng thêm (khuôn 20261008080000_vong_2_mentor_chon_mentee.sql).
do $kind$
declare
  v_existing text;
  v_rebuilt text;
begin
  select pg_get_constraintdef(c.oid) into v_existing
    from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if v_existing is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không thấy outbound_emails_kind_check';
  end if;
  if position(quote_literal('mentee_exemption_confirm') in v_existing) > 0 then
    return;
  end if;
  v_rebuilt := regexp_replace(v_existing, '(\]\)+)$', ', ''mentee_exemption_confirm''::text\1');
  if v_rebuilt = v_existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: không tìm thấy đuôi mảng của outbound_emails_kind_check: %', v_existing;
  end if;
  execute 'alter table public.outbound_emails drop constraint outbound_emails_kind_check';
  execute 'alter table public.outbound_emails add constraint outbound_emails_kind_check ' || replace(v_rebuilt, 'CHECK ', 'check ');
end
$kind$;

do $$
declare
  v_def text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'mentee_exemptions' and c.relrowsecurity) then
    raise exception 'Bảng mentee_exemptions chưa bật RLS';
  end if;
  if has_table_privilege('anon', 'public.mentee_exemptions', 'select')
     or has_table_privilege('authenticated', 'public.mentee_exemptions', 'select') then
    raise exception 'anon/authenticated còn đọc được mentee_exemptions';
  end if;
  if has_column_privilege('service_role', 'public.mentee_exemptions', 'confirmed_at', 'update')
     or has_column_privilege('service_role', 'public.mentee_exemptions', 'application_id', 'update')
     or has_column_privilege('service_role', 'public.mentee_exemptions', 'token', 'update')
     or has_column_privilege('service_role', 'public.mentee_exemptions', 'person_id', 'update') then
    raise exception 'Máy chủ không được tự đặt dấu xác nhận hay đổi chủ link';
  end if;
  if has_table_privilege('service_role', 'public.mentee_exemptions', 'delete') then
    raise exception 'Máy chủ không được xoá dòng đặc cách';
  end if;
  if not exists (select 1 from pg_proc where proname = 'vam117_confirm_mentee_exemption' and prosecdef) then
    raise exception 'Hàm xác nhận phải chạy bằng quyền chủ hàm';
  end if;
  if exists (select 1 from pg_proc where proname in ('vam117_add_mentee_exemptions', 'vam117_revoke_mentee_exemption') and prosecdef) then
    raise exception 'Hàm thêm/gỡ của BTC phải chạy bằng quyền người gọi';
  end if;
  if has_function_privilege('anon', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vam117_confirm_mentee_exemption(uuid)', 'execute')
     or has_function_privilege('anon', 'public.vam117_add_mentee_exemptions(uuid, uuid, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.vam117_add_mentee_exemptions(uuid, uuid, uuid[])', 'execute') then
    raise exception 'anon/authenticated gọi được hàm đặc cách';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.outbound_emails'::regclass and c.conname = 'outbound_emails_kind_check';
  if position(quote_literal('mentee_exemption_confirm') in v_def) = 0 then
    raise exception 'outbound_emails_kind_check thiếu loại thư mentee_exemption_confirm';
  end if;
  raise notice 'Mentee đặc cách: sẵn sàng (danh sách trống cho tới khi BTC thêm người)';
end $$;
