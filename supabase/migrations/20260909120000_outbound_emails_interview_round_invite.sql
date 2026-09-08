-- Thêm một loại thư: mời ứng viên vào vòng phỏng vấn.
--
-- Scope:
--   * Chỉ mở rộng outbound_emails_kind_check thêm đúng một giá trị.
--   * Không tạo bảng, không tạo index, không đổi quyền, không đụng bảng khác.
--
-- Vì sao là loại MỚI chứ không dùng 'interview_scheduled' có sẵn:
--   'interview_scheduled' là thư của một buổi ĐÃ có giờ, hình thức, địa điểm —
--   đó là ý nghĩa của nó trên nhánh s12 và các migration sau này sẽ dựa vào đó.
--   Trên main chưa có chỗ nào lưu giờ phỏng vấn, nên lá thư gửi lúc ứng viên
--   chuyển sang 'invited_to_interview' là một thứ khác hẳn: nó báo đã qua vòng
--   hồ sơ và ban tổ chức sẽ liên hệ hẹn giờ. Dùng chung một mã cho hai lá thư
--   khác nội dung sẽ làm sổ ghi nói dối, và sẽ đụng wave 2.

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. Nới từ vựng kind
-- ------------------------------------------------------------
do $outbound_emails_kind$
begin
  if to_regclass('public.outbound_emails') is null then
    raise exception
      'PREREQ_MISSING: public.outbound_emails is required (migration 20260909090000).';
  end if;
end;
$outbound_emails_kind$;

alter table public.outbound_emails
  drop constraint if exists outbound_emails_kind_check;

alter table public.outbound_emails
  add constraint outbound_emails_kind_check
  check (kind in (
    'mentor_confirmation_link',
    'mentee_application_confirmation',
    'mentor_application_confirmation',
    'review_batch_assigned',
    'interview_scheduled',
    'reviewer_invite',
    'interview_round_invite'
  ));

-- ------------------------------------------------------------
-- 2. Tự kiểm — ràng buộc phải nhận giá trị mới VÀ giữ nguyên giá trị cũ
-- ------------------------------------------------------------
do $outbound_emails_kind_contract$
declare
  v_def text;
  missing text;
begin
  select pg_get_constraintdef(c.oid, true)
    into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.outbound_emails')
    and c.conname = 'outbound_emails_kind_check';

  if v_def is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check is missing after the change.';
  end if;

  -- Sáu giá trị cũ phải còn nguyên: mở rộng chứ không thay thế.
  select string_agg(want, ', ')
    into missing
  from unnest(array[
    'mentor_confirmation_link',
    'mentee_application_confirmation',
    'mentor_application_confirmation',
    'review_batch_assigned',
    'interview_scheduled',
    'reviewer_invite',
    'interview_round_invite'
  ]) as want
  where position(quote_literal(want) in v_def) = 0;

  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: outbound_emails_kind_check no longer accepts: %', missing;
  end if;
end;
$outbound_emails_kind_contract$;

commit;

notify pgrst, 'reload schema';
