-- =============================================================================
-- Nhóm nhận thư "Mentee không trúng tuyển vòng phỏng vấn" mùa 12 (BTC 24/10/2026)
--   Thêm 'mentee_interview_rejected' vào email_batches_audience_check.
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới mở lô với audience = 'mentee_interview_rejected', và
-- ràng buộc cũ sẽ từ chối dòng đó.
--
-- 287 bạn: rớt phỏng vấn; check-in, phân bàn hoặc chọn ca mà không phỏng vấn; được mời mà không
-- chọn ca — trừ 5 bạn BTC giữ lại. Danh sách do máy chủ tự dựng (lib/bulk-mail.ts); mẫu thư BTC
-- soạn và duyệt ở trang Thư như các đợt trước — migration này không tạo mẫu nào.
--
-- Nới ràng buộc theo lối cộng thêm (khuôn 20261008180000): đọc định nghĩa đang có rồi nối thêm, không
-- viết đè. Chạy lại lần hai không sao.
-- =============================================================================
do $thu_rot_pv_widen$
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
  if position('''mentee_invite_withdrawn''' in existing) = 0 then
    raise exception 'PREREQ_MISSING: cần migration 20261008180000 (nhóm mentee_invite_withdrawn) chạy trước';
  end if;
  if position('''mentee_interview_rejected''' in existing) > 0 then
    return;
  end if;
  rebuilt := regexp_replace(existing, '(\]\)+)$', ', ''mentee_interview_rejected''::text\1');
  if rebuilt = existing then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %', existing;
  end if;
  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$thu_rot_pv_widen$;

do $thu_rot_pv_contract$
declare
  def text;
  v text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  -- Nhóm mới có mặt, và mọi nhóm đang dùng trước đó vẫn còn.
  foreach v in array array['mentee', 'mentor', 'both', 'staff', 'returning_mentor', 'event', 'mentee_cv_rejected', 'mentee_invite_withdrawn', 'mentee_interview_rejected'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check thiếu %', v;
    end if;
  end loop;
  raise notice 'Nhóm mentee_interview_rejected đã có — BTC soạn và duyệt mẫu thư ở trang Thư, rồi gửi ở Vận hành → Mail.';
end;
$thu_rot_pv_contract$;

notify pgrst, 'reload schema';
