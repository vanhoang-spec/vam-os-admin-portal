-- =============================================================================
-- Thư rớt vòng hồ sơ mentee (BTC 07/10/2026)
--   1. Thêm nhóm nhận thư 'mentee_cv_rejected' vào email_batches_audience_check
--   2. Sửa 3 chỗ trong mẫu thư "Ứng viên Mentee không đậu vòng hồ sơ (CV)"
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới mở lô với audience = 'mentee_cv_rejected', và
-- ràng buộc cũ sẽ từ chối dòng đó.
--
-- Phần 1 nới ràng buộc theo lối cộng thêm (đọc lại pg_get_constraintdef rồi nối
-- vào đuôi), cùng khuôn với 20260913210000: ràng buộc kết thúc bằng BỐN dấu `)`
-- vì có vế `audience IS NULL`, nên mẫu là một-hoặc-nhiều dấu.
--
-- Phần 2 chỉ sửa khi nội dung mẫu còn ĐÚNG bản lúc rà (md5 bên dưới). Ai đã sửa
-- mẫu sau đó thì file KHÔNG ghi đè — chỉ báo NOTICE để BTC sửa tay. Mẫu đang
-- được duyệt thì quay về nháp và bỏ duyệt, đúng như sửa trên màn hình
-- (lib/email-templates.ts): nội dung đổi thì phải duyệt lại.
--
-- Chạy lại nhiều lần vô hại.
-- =============================================================================

-- ------------------------------------------------------------
-- 1. Nhóm nhận thư 'mentee_cv_rejected'
-- ------------------------------------------------------------
do $nhom_rot_ho_so_widen$
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

  if position('''mentee_cv_rejected''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''mentee_cv_rejected''::text\1');
  if rebuilt = existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %', existing;
  end if;

  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$nhom_rot_ho_so_widen$;

comment on column public.email_batches.audience is
  'Đối tượng nhận thư của lô: mentee, mentor, both, staff (Ban tổ chức), returning_mentor (mentor đã xác nhận quay lại mùa), mentee_cv_rejected (mentee rớt vòng hồ sơ, chưa từng được mời phỏng vấn), hoặc event (người đã đăng ký một sự kiện). Lần chạy tiếp theo đọc cột này chứ không nhận từ màn hình.';

-- ------------------------------------------------------------
-- 2. Sửa 3 chỗ trong mẫu thư rớt vòng hồ sơ
-- ------------------------------------------------------------
--   a. "…đăng ký tham gia chương trình TUYỂN MENTEE MÙA 12 - THE TAPESTRY"
--      → "…đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry."
--   b. "với vai trò {{vai_tro}}" → "với vai trò Mentee" (ô điền ra chữ thường)
--   c. Tách số điện thoại cho dễ đọc: 0394 983 679, 0936 359 670
do $mau_thu_rot_ho_so$
declare
  v_id constant uuid := 'd96e97c8-f029-43a9-a442-df02b5e730e7';
  v_actor constant uuid := 'a3f45586-8747-49d9-860a-4b903cfdc7bc';
  v_body text;
  v_status text;
  v_new text;
begin
  select body, status into v_body, v_status from public.email_templates where id = v_id;
  if v_body is null then
    raise notice 'Không thấy mẫu thư %, bỏ qua phần 2.', v_id;
    return;
  end if;

  if position('đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry.' in v_body) > 0 then
    raise notice 'Mẫu thư đã được sửa từ trước, không làm gì.';
    return;
  end if;

  if md5(v_body) <> '08485ea0c37243bdc070e0f36c2b9857' then
    raise notice 'Mẫu thư đã bị sửa sau lúc rà (md5 khác) — KHÔNG ghi đè. BTC sửa tay 3 chỗ trên màn hình Thư.';
    return;
  end if;

  v_new := replace(
             replace(
               replace(
                 v_body,
                 'đăng ký tham gia chương trình TUYỂN MENTEE MÙA 12 - THE TAPESTRY',
                 'đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry.'
               ),
               'với vai trò {{vai_tro}} trong mùa 12',
               'với vai trò Mentee trong mùa 12'
             ),
             'Mỹ Anh (0394983679), Hoàng Vy (0936359670)',
             'Mỹ Anh (0394 983 679), Hoàng Vy (0936 359 670)'
           );

  update public.email_templates
     set body = v_new,
         status = case when status = 'approved' then 'draft' else status end,
         approved_by = case when status = 'approved' then null else approved_by end,
         approved_at = case when status = 'approved' then null else approved_at end,
         updated_at = now()
   where id = v_id;

  insert into public.email_template_log (template_id, action, actor_admin_user_id, detail)
  values (
    v_id,
    'edited',
    v_actor,
    jsonb_build_object(
      'revoked_approval', v_status = 'approved',
      'source', 'sql 20261007234500',
      'note', 'Rà soát 07/10/2026: tên chương trình, {{vai_tro}} → Mentee, tách số điện thoại'
    )
  );
end;
$mau_thu_rot_ho_so$;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $nhom_rot_ho_so_contract$
declare
  def text;
  v text;
  v_body text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  if position('''mentee_cv_rejected''' in coalesce(def, '')) = 0 then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check chưa nhận mentee_cv_rejected';
  end if;

  foreach v in array array['mentee', 'mentor', 'both', 'staff', 'returning_mentor', 'event'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check đã MẤT nhóm cũ %', v;
    end if;
  end loop;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_batches') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches lại có policy';
  end if;

  select body into v_body from public.email_templates where id = 'd96e97c8-f029-43a9-a442-df02b5e730e7';
  if v_body is not null
     and position('đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry.' in v_body) > 0
     and position('{{vai_tro}}' in v_body) = 0
     and position('0394 983 679' in v_body) > 0 then
    raise notice 'Nhóm mentee_cv_rejected đã có; mẫu thư rớt vòng hồ sơ đã sửa đủ 3 chỗ.';
  else
    raise notice 'Nhóm mentee_cv_rejected đã có; mẫu thư CHƯA được sửa — xem NOTICE phía trên.';
  end if;
end;
$nhom_rot_ho_so_contract$;

notify pgrst, 'reload schema';
