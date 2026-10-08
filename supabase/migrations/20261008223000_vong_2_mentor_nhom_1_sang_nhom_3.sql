-- =============================================================================
-- Vòng 2 — 16 mentor nhóm 1 (Ngân hàng - Bảo hiểm) chuyển sang nhóm 3 (Tài chính -
-- Đầu tư) vì công ty hiện tại không phải ngân hàng / công ty bảo hiểm (BTC 08/10/2026)
-- =============================================================================
-- DỮ LIỆU, không đổi cấu trúc. Dán vào SQL Editor (Production) → Run. Cần migration
-- 20261008190000 (cổng vam114) đã chạy — đã dán và đã kiểm 08/10.
--
-- Danh sách đọc từ production 08/10: 35 mentor nhóm 1. 18 người làm ở ngân hàng /
-- công ty bảo hiểm giữ nguyên. Home Credit (công ty tài chính tiêu dùng) cũng giữ
-- nguyên — để BTC tự quyết ở ô "Đổi / xác nhận nhóm". 16 người dưới đây chuyển sang 3.
--
-- Đi qua đúng hàm đổi nhóm của màn hình (vam112_set_industry_group): cùng khoá ghép
-- cặp, cùng kiểm "nhóm hiện tại", cùng log, người đổi = anh Hoàng. Hàm chỉ nhận lời
-- gọi từ service_role, nên khối dưới tạm đổi vai trong chính giao dịch này.
--
-- Ai đã được đổi sang nhóm khác trước khi chạy (Support team sửa tay) thì BỎ QUA,
-- không ghi đè quyết định mới hơn. Chạy lại lần hai: không đổi gì, không thêm log.
-- =============================================================================

do $mentor_nhom_1_sang_3$
declare
  v_season constant uuid := '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1';
  v_actor constant uuid := 'a3f45586-8747-49d9-860a-4b903cfdc7bc';
  t record;
  v_id uuid;
  v_group smallint;
  v_moved integer := 0;
  v_skipped integer := 0;
begin
  if to_regprocedure('public.vam114_round2_group_editor_for_season(uuid, uuid)') is null then
    raise exception 'PREREQ_MISSING: cần migration 20261008190000 chạy trước';
  end if;
  if not exists (select 1 from public.admin_users where id = v_actor and role = 'super_admin' and status = 'active') then
    raise exception 'PREREQ_MISSING: tài khoản người đổi không còn là super_admin đang hoạt động';
  end if;

  set local role service_role;

  for t in
    select * from (values
      ('c757ac0d-4333-4755-8184-3b1300292ee8'::uuid, 'Nguyễn Nguyên Thục Oanh', 'Ares Management'),
      ('91fd8835-df24-4df7-9b44-b555c1774d58'::uuid, 'Trịnh Thị Thúy Liễu', 'Boston Pharma'),
      ('f196753b-99e9-42be-b842-f2cf86038a14'::uuid, 'Trịnh Văn Phương', 'CLICK AI VIET NAM JSC'),
      ('50abe2de-011e-4851-a52c-c96c68829734'::uuid, 'Hồ Đức Toàn', 'Công ty Cổ phần Chứng khoán Đại Việt'),
      ('e1cced53-6bff-405c-a0b3-e581e575a0bc'::uuid, 'Lê Quốc Duy', 'Công ty cổ phần Thành Thành Công Biên Hoà'),
      ('b4fa8cde-dbe9-4542-82bf-28162ec5acce'::uuid, 'Nguyễn Minh Tuấn', 'Công ty TNHH ANT NET'),
      ('4a49f4bc-2668-47cc-bada-8592473e96da'::uuid, 'Trần Thị Bảo Trâm', 'Công ty TNHH BTM Solution'),
      ('7889fd73-0ef8-4355-b41b-c93fe0300462'::uuid, 'Nguyễn Công Thử', 'Công ty TNHH Đại lý thuế Khang Phúc'),
      ('fd33ca6a-1995-4309-9ebe-824ba8d91f20'::uuid, 'Phạm Thị Xuân Thắm', 'Công ty TNHH PwC (Việt Nam)'),
      ('7a483e24-d78c-4b26-9248-bc7a7bd7cf50'::uuid, 'Nguyễn Dương Hiếu', 'Công ty TNHH tư vấn phát hành Phượng Hoàng'),
      ('63b72bc1-47f3-41a0-9ca1-f1348bc07d63'::uuid, 'Hoàng Thị Hoa', 'Dragon Capital'),
      ('b4fece0b-13b8-49e9-b085-15d158725432'::uuid, 'Mạc Quang Huy', 'FiinGroup'),
      ('331dd2f3-931b-45c4-accb-43bb48ba6599'::uuid, 'Nguyễn Thị Hải Anh', 'Freelancer'),
      ('5f3660ad-b73d-4ec9-beff-4bf884d43ccb'::uuid, 'Phạm Đình Hưng', 'HAMAH'),
      ('dda3c0de-ba07-4c01-b5ea-895d095e5719'::uuid, 'Nguyễn Quang Huy', 'Lakeshore Capital'),
      ('4d432edc-dd95-4217-94df-73de720c5e19'::uuid, 'Nguyễn Đức Thắng', 'Red Square')
    ) as v(person_id, ten, cong_ty)
  loop
    select id, group_code into v_id, v_group
      from public.matching_industry_assignments
     where season_id = v_season and person_id = t.person_id and role = 'mentor';
    if v_id is null then
      raise exception 'NOT_FOUND: % chưa có nhóm ở vòng 2 — dừng, không đổi ai', t.ten;
    end if;
    if v_group <> 1 then
      raise notice 'Bỏ qua % — đang ở nhóm % (đã có người đổi), không ghi đè.', t.ten, v_group;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform public.vam112_set_industry_group(
      v_actor, v_id, 1::smallint, 3::smallint,
      'BTC 08/10/2026: công ty hiện tại (' || t.cong_ty || ') không phải ngân hàng / công ty bảo hiểm → nhóm 3 Tài chính - Đầu tư'
    );
    v_moved := v_moved + 1;
  end loop;

  reset role;
  raise notice 'Đã chuyển % mentor sang nhóm 3; bỏ qua % người đã được đổi trước đó.', v_moved, v_skipped;
end;
$mentor_nhom_1_sang_3$;

-- Kết quả hiện ra ở ô dưới SQL Editor: 16 dòng, mỗi người một nhóm hiện tại.
select p.full_name as mentor, mia.group_code as nhom_hien_tai, mia.source as nguon, mia.override_reason as ly_do
  from public.matching_industry_assignments mia
  join public.people p on p.id = mia.person_id
 where mia.season_id = '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'
   and mia.role = 'mentor'
   and mia.person_id in (
     'c757ac0d-4333-4755-8184-3b1300292ee8', '91fd8835-df24-4df7-9b44-b555c1774d58', 'f196753b-99e9-42be-b842-f2cf86038a14',
     '50abe2de-011e-4851-a52c-c96c68829734', 'e1cced53-6bff-405c-a0b3-e581e575a0bc', 'b4fa8cde-dbe9-4542-82bf-28162ec5acce',
     '4a49f4bc-2668-47cc-bada-8592473e96da', '7889fd73-0ef8-4355-b41b-c93fe0300462', 'fd33ca6a-1995-4309-9ebe-824ba8d91f20',
     '7a483e24-d78c-4b26-9248-bc7a7bd7cf50', '63b72bc1-47f3-41a0-9ca1-f1348bc07d63', 'b4fece0b-13b8-49e9-b085-15d158725432',
     '331dd2f3-931b-45c4-accb-43bb48ba6599', '5f3660ad-b73d-4ec9-beff-4bf884d43ccb', 'dda3c0de-ba07-4c01-b5ea-895d095e5719',
     '4d432edc-dd95-4217-94df-73de720c5e19'
   )
 order by mia.group_code, p.full_name;
