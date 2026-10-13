-- BTC 11/10/2026 — HOÀN một lần duyệt nhầm đơn mentor mùa 12.
--
-- Chuyện đã xảy ra: 10/10/2026 13:03, một đơn mentor được bấm "Qua vòng phỏng vấn" rồi
-- "Duyệt làm mentor" cách nhau 7 giây. Mentor này chưa tham gia Mentor Orientation nên BTC
-- chưa định duyệt. Lần duyệt đó đã tạo: hồ sơ người, mentor profile, và (qua trigger
-- vam108) một dòng tư cách mentor mùa 12 đang hoạt động.
--
-- Vì sao phải dùng SQL: màn hình quyết định không có đường đi ngược từ "đã duyệt" —
-- vam084_application_decision_eligibility trả invalid_transition cho mọi lựa chọn.
--
-- File này làm đúng ba việc, trong một giao dịch:
--   1. đưa đơn về "ready_for_final_decision": trạng thái ngay trước hai lần bấm đó, cũng
--      là trạng thái của các mentor khác đã phỏng vấn xong và đang chờ BTC chốt;
--   2. XOÁ dòng tư cách mentor mùa 12 mà lần duyệt nhầm tự tạo. Phải xoá chứ không đổi
--      sang "cancelled": trigger vam108 ghi "on conflict do nothing", nên dòng cũ còn nằm
--      đó thì lần duyệt thật sau này KHÔNG tạo lại tư cách — mentor được duyệt mà không
--      hiện ở trang Mentor theo mùa (lỗi đã gặp 03/10/2026). Nguyên dòng bị xoá được chép
--      vào admin_audit_log.before_data, cần thì dựng lại được;
--   3. ghi một dòng application_decisions và một dòng admin_audit_log.
--
-- Cố ý GIỮ: hồ sơ người, mentor profile, liên kết đơn với người, nhóm ngành Vòng 2 đã
-- phân. Lần duyệt thật sẽ dùng lại đúng các dòng đó (lib/application-approvals.ts coi liên
-- kết sẵn có là chuẩn). Không dòng nào trong số đó làm người này hiện ra như mentor mùa
-- 12: bảng Vòng 2 đọc đơn đã duyệt, trang Mentor theo mùa đọc tư cách mùa.
--
-- Cố ý KHÔNG đặt "waitlisted": từ trạng thái đó màn hình không còn nút nào đưa đơn đi
-- tiếp, kể cả duyệt. Chạy file này xong, BTC vẫn tự chọn được "Đưa vào danh sách chờ" trên
-- trang đơn nếu đúng là muốn vậy.
--
-- CHẠY LẠI ĐƯỢC: lần hai thấy đã có dòng quyết định hoàn duyệt thì không làm gì — kể cả
-- khi lúc đó BTC đã duyệt lại mentor này một cách đàng hoàng.
--
-- Chỉ là dữ liệu: không cần merge hay deploy.

begin;
set local lock_timeout = '10s';

do $hoan_duyet$
declare
  c_app     constant uuid := '1f05fe24-4858-4526-aa5b-7adf573cd9cd';
  c_person  constant uuid := '8d94e96e-3d7b-4138-848f-547c93c481a0';
  c_season  constant uuid := '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1';
  -- Dòng quyết định của chính lần duyệt nhầm (10/10/2026 13:03:54).
  c_wrong   constant uuid := '40913783-7da7-4bed-9c0a-9a27fe9a1603';
  -- Super admin dán file này; đứng tên dòng quyết định và dòng log.
  c_actor   constant uuid := 'a3f45586-8747-49d9-860a-4b903cfdc7bc';
  c_restore constant text := 'ready_for_final_decision';
  c_marker  constant text := 'HOAN_DUYET_NHAM_2026_10_11';
  v_app public.applications%rowtype;
  v_last public.application_decisions%rowtype;
  v_membership public.person_season_memberships%rowtype;
  v_actor_name text;
begin
  select a.* into v_app from public.applications a where a.id = c_app for update;
  if v_app.id is null then
    raise exception 'PRECHECK: không tìm thấy đơn % — dừng, chưa ghi gì', c_app;
  end if;

  -- Đã hoàn ở lần chạy trước. Xét TRƯỚC mọi phép kiểm khác: sau lần hoàn, BTC có thể đã
  -- duyệt lại mentor này, và lần chạy lại không được gỡ lần duyệt thật đó.
  if exists (
    select 1 from public.application_decisions d
    where d.application_id = c_app and position(c_marker in coalesce(d.decision_note, '')) > 0
  ) then
    raise notice 'Đã hoàn duyệt ở lần chạy trước — không làm gì thêm.';
    return;
  end if;

  if v_app.season_id is distinct from c_season
     or lower(coalesce(v_app.role_applied::text, '')) <> 'mentor'
     or v_app.person_id is distinct from c_person
     or v_app.status is distinct from 'approved_as_mentor' then
    raise exception 'PRECHECK: đơn không còn ở đúng tình trạng lúc duyệt nhầm (trạng thái %, người %) — dừng, chưa ghi gì',
      v_app.status, v_app.person_id;
  end if;

  -- Quyết định mới nhất phải CHÍNH LÀ lần duyệt nhầm. Có quyết định nào sau đó nghĩa là
  -- đã có người xử lý đơn này theo cách khác — không ghi đè lên việc của họ.
  select d.* into v_last
  from public.application_decisions d
  where d.application_id = c_app
  order by d.created_at desc, d.id desc
  limit 1;
  if v_last.id is distinct from c_wrong
     or v_last.new_status is distinct from 'approved_as_mentor'
     or v_last.previous_status is distinct from 'interview_passed' then
    raise exception 'PRECHECK: quyết định mới nhất của đơn không phải lần duyệt nhầm 10/10 — dừng, chưa ghi gì';
  end if;
  -- Trạng thái trả về phải đúng là trạng thái trước phiên bấm nhầm, không phải suy đoán.
  if not exists (
    select 1 from public.application_decisions d
    where d.application_id = c_app
      and d.new_status = 'interview_passed'
      and d.previous_status = c_restore
      and d.created_at < v_last.created_at
      and d.created_at > v_last.created_at - interval '10 minutes'
  ) then
    raise exception 'PRECHECK: không thấy bước "%" ngay trước lần duyệt nhầm — dừng, chưa ghi gì', c_restore;
  end if;

  -- Cùng khoá với trigger tạo cặp (vam104) và Vòng 2: không ai kịp ghép mentor này với
  -- một mentee trong lúc đang kiểm.
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || c_season::text, 0));
  if exists (
    select 1 from public.matches m where m.season_id = c_season and m.mentor_person_id = c_person
  ) then
    raise exception 'PRECHECK: mentor này đã có cặp ghép trong mùa — phải xử lý cặp trước; dừng, chưa ghi gì';
  end if;
  if exists (
    select 1 from public.matching_round2_links l where l.mentor_person_id = c_person
  ) then
    raise exception 'PRECHECK: mentor này đã được tạo link chọn mentee Vòng 2 — phải thu hồi link trước; dừng, chưa ghi gì';
  end if;

  select coalesce(nullif(btrim(au.full_name), ''), au.email) into v_actor_name
  from public.admin_users au
  where au.id = c_actor and au.status = 'active';
  if v_actor_name is null then
    raise exception 'PRECHECK: không thấy tài khoản super admin đang hoạt động để đứng tên — dừng, chưa ghi gì';
  end if;

  select m.* into v_membership
  from public.person_season_memberships m
  where m.person_id = c_person and m.season_id = c_season and m.role = 'mentor'
  for update;
  -- Chỉ xoá đúng dòng mà trigger vam108 tạo trong CHÍNH giao dịch duyệt nhầm (cùng mốc
  -- giờ với dòng quyết định) và chưa ai sửa. Khác đi dù một chút thì để người xem.
  if v_membership.id is not null and (
       v_membership.source is distinct from 'application'
       or v_membership.status is distinct from 'active'
       or v_membership.created_at is distinct from v_last.created_at
       or v_membership.updated_at is distinct from v_membership.created_at
     ) then
    raise exception 'PRECHECK: dòng tư cách mentor mùa này không phải dòng do lần duyệt nhầm tạo, hoặc đã bị sửa — dừng, chưa ghi gì';
  end if;

  update public.applications
     set status = c_restore
   where id = c_app and status = 'approved_as_mentor';

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision, previous_status, new_status, decision_note
  ) values (
    c_app, c_actor, v_actor_name, c_restore, 'approved_as_mentor', c_restore,
    c_marker || ': hoàn lần duyệt nhầm 10/10/2026 13:03 — mentor chưa tham gia Mentor Orientation nên BTC chưa duyệt. Đơn trở về chờ BTC chốt.'
  );

  if v_membership.id is not null then
    delete from public.person_season_memberships where id = v_membership.id;
  end if;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, before_data, after_data, details
  ) values (
    c_actor, null, 'cancel_membership',
    jsonb_build_object(
      'application_status', 'approved_as_mentor',
      'membership', case when v_membership.id is null then null else to_jsonb(v_membership) end
    ),
    jsonb_build_object('application_status', c_restore, 'membership', null),
    jsonb_build_object(
      'marker', c_marker,
      'application_id', c_app,
      'person_id', c_person,
      'season_id', c_season,
      'reverted_decision_id', c_wrong,
      'reason', 'Duyệt nhầm: mentor chưa tham gia Mentor Orientation. Xoá tư cách mùa tự tạo để lần duyệt thật tạo lại được.'
    )
  );

  -- Tự kiểm trong cùng giao dịch: sai một điều là huỷ cả lượt.
  if (select a.status from public.applications a where a.id = c_app) is distinct from c_restore then
    raise exception 'SELF_CHECK: đơn chưa về trạng thái %', c_restore;
  end if;
  if exists (
    select 1 from public.person_season_memberships m
    where m.person_id = c_person and m.season_id = c_season and m.role = 'mentor'
  ) then
    raise exception 'SELF_CHECK: vẫn còn tư cách mentor mùa này';
  end if;
  if not exists (select 1 from public.people p where p.id = c_person)
     or (select count(*) from public.mentor_profiles mp where mp.person_id = c_person) <> 1 then
    raise exception 'SELF_CHECK: hồ sơ người hoặc mentor profile không còn nguyên — lần duyệt thật sẽ không dùng lại được';
  end if;
end $hoan_duyet$;

commit;

-- Tình hình sau khi chạy (chỉ đọc). Mong đợi: trang_thai_don = ready_for_final_decision,
-- so_tu_cach_mentor_mua = 0, so_mentor_profile = 1.
select
  a.full_name as mentor,
  a.status as trang_thai_don,
  (select count(*) from public.person_season_memberships m
    where m.person_id = a.person_id and m.season_id = a.season_id and m.role = 'mentor') as so_tu_cach_mentor_mua,
  (select count(*) from public.mentor_profiles mp where mp.person_id = a.person_id) as so_mentor_profile,
  (select mia.group_code from public.matching_industry_assignments mia
    where mia.person_id = a.person_id and mia.season_id = a.season_id and mia.role = 'mentor') as nhom_nganh_giu_lai,
  (select count(*) from public.applications x
    where x.season_id = a.season_id and x.role_applied = 'mentor' and x.status = 'approved_as_mentor') as tong_don_mentor_da_duyet,
  to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') as kiem_tra_luc_vn
from public.applications a
where a.id = '1f05fe24-4858-4526-aa5b-7adf573cd9cd'::uuid;
