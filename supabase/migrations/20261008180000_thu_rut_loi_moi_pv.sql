-- =============================================================================
-- Thư rớt vòng hồ sơ cho mentee ĐÃ nhận thư mời phỏng vấn đợt 2 (BTC 08/10/2026)
--   1. Thêm nhóm nhận thư 'mentee_invite_withdrawn' vào email_batches_audience_check
--   2. Tạo mẫu thư NHÁP có nhắc tới thư mời ngày 07/10 — BTC đọc, sửa, rồi duyệt
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới mở lô với audience = 'mentee_invite_withdrawn', và
-- ràng buộc cũ sẽ từ chối dòng đó.
--
-- 12 bạn nhận thư mời chọn ca sáng 07/10, bị khoá link tối 07/10 (20261007233000),
-- rồi BTC chuyển "Không đạt" sáng 08/10 — chưa nhận thư rớt nào. Thư rớt chung nói
-- "chưa thể chọn hồ sơ của bạn để bước tiếp vào vòng phỏng vấn"; với người đã được
-- mời, câu đó cần đi kèm một lời giải thích và xin lỗi.
--
-- Phần 1 nới ràng buộc theo lối cộng thêm (khuôn 20261007234500). Phần 2 tạo mẫu thư
-- với id cố định: chạy lại không tạo trùng, và KHÔNG ghi đè nếu BTC đã sửa mẫu.
-- Mẫu ở trạng thái nháp — chưa ai gửi được cho tới khi BTC bấm Duyệt.
-- =============================================================================

do $thu_rut_loi_moi_widen$
declare
  existing text;
  rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  if existing is null then
    raise exception 'PREREQ_MISSING: cần email_batches_audience_check';
  end if;
  if position('''mentee_cv_rejected''' in existing) = 0 then
    raise exception 'PREREQ_MISSING: cần migration 20261007234500 (nhóm mentee_cv_rejected) chạy trước';
  end if;

  if position('''mentee_invite_withdrawn''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''mentee_invite_withdrawn''::text\1');
  if rebuilt = existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %', existing;
  end if;

  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$thu_rut_loi_moi_widen$;

-- ------------------------------------------------------------
-- 2. Mẫu thư nháp
-- ------------------------------------------------------------
do $thu_rut_loi_moi_mau$
declare
  v_id constant uuid := '97fb0a2a-d243-42fc-9d7f-01aefb1abf50';
  v_actor constant uuid := 'a3f45586-8747-49d9-860a-4b903cfdc7bc';
  v_season uuid;
begin
  if exists (select 1 from public.email_templates where id = v_id) then
    raise notice 'Mẫu thư đã có từ trước — không ghi đè.';
    return;
  end if;
  select id into v_season from public.seasons where code = 'UEHM-S12';
  if v_season is null then
    raise exception 'PREREQ_MISSING: không thấy mùa UEHM-S12';
  end if;

  insert into public.email_templates (id, season_id, kind, name, subject, body, status, created_by)
  values (
    v_id,
    v_season,
    'general_announcement',
    'Mentee rớt CV sau khi đã nhận thư mời phỏng vấn (07/10)',
    '[UEH Mentoring mùa 12] Cập nhật kết quả vòng Hồ sơ & Lời cảm ơn từ Ban tổ chức',
    concat_ws(
      E'\n\n',
      'Chào bạn {{ten_nguoi_nhan}},',
      'Lời đầu tiên, Ban tổ chức UEH Mentoring xin gửi lời cảm ơn chân thành đến bạn vì đã dành thời gian quan tâm và nộp hồ sơ đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry.',
      'Ngày 07/10, bạn đã nhận được thư mời chọn ca phỏng vấn từ Ban tổ chức. Sau khi rà soát lại toàn bộ kết quả vòng Hồ sơ, Ban tổ chức xin thông báo thư mời này đã được gửi nhầm và đường dẫn chọn ca đã được đóng lại. Ban tổ chức thành thật xin lỗi vì sự nhầm lẫn này đã khiến bạn bối rối.',
      'Ban tổ chức rất trân trọng sự chuẩn bị chỉn chu, tinh thần học hỏi cũng như mong muốn đồng hành của bạn đối với cộng đồng. Tuy nhiên, do số lượng hồ sơ nhận được trong mùa này rất lớn và chỉ tiêu kết nối có giới hạn, Ban tổ chức rất tiếc khi chưa thể chọn hồ sơ của bạn để bước tiếp vào vòng phỏng vấn lần này.',
      'Dù chưa thể đồng hành cùng bạn với vai trò Mentee trong mùa 12, Ban tổ chức tin rằng đây chỉ là một bước dừng chân tạm thời trên hành trình phát triển của bạn. Những trải nghiệm, sự nghiêm túc và tinh thần sẵn sàng nâng cao bản thân mà bạn thể hiện qua hồ sơ đều rất đáng ghi nhận.',
      'Ban tổ chức rất hy vọng sẽ có cơ hội được đón nhận sự quay trở lại của bạn ở các mùa tiếp theo, cũng như trong các hoạt động cộng đồng sắp tới của chương trình.',
      'Nếu cần hỗ trợ hoặc có thắc mắc thêm, bạn có thể nhắn tin qua Zalo Ban tổ chức Mỹ Anh (0394 983 679), Hoàng Vy (0936 359 670) hoặc phản hồi trực tiếp qua email này.',
      'Chúc bạn luôn giữ vững nhiệt huyết và đạt được nhiều thành công trên con đường sắp tới!',
      'Thân ái,'
    ),
    'draft',
    v_actor
  );

  insert into public.email_template_log (template_id, action, actor_admin_user_id, detail)
  values (v_id, 'created', v_actor, jsonb_build_object('source', 'sql 20261008180000', 'note', 'Thư rớt CV cho mentee đã nhận thư mời PV 07/10'));
end;
$thu_rut_loi_moi_mau$;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $thu_rut_loi_moi_contract$
declare
  def text;
  v text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  foreach v in array array['mentee', 'mentor', 'both', 'staff', 'returning_mentor', 'event', 'mentee_cv_rejected', 'mentee_invite_withdrawn'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check thiếu %', v;
    end if;
  end loop;

  if not exists (select 1 from public.email_templates where id = '97fb0a2a-d243-42fc-9d7f-01aefb1abf50') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: chưa có mẫu thư 97fb0a2a';
  end if;
  raise notice 'Nhóm mentee_invite_withdrawn đã có; mẫu thư nháp đã có — BTC đọc và duyệt ở trang Thư.';
end;
$thu_rut_loi_moi_contract$;

notify pgrst, 'reload schema';
