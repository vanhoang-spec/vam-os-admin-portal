-- ============================================================
-- Lô gửi phải tự nhớ nó gửi cho ai
-- ============================================================
--
-- Một lô không gửi xong trong một lần chạy: gói Brevo đang dùng cho khoảng 300
-- thư một ngày, và các lời gọi chạy tuần tự nên một request cũng không đủ dài.
-- Lần chạy sau đọc `outbound_emails.batch_id` để biết đã gửi tới ai, rồi đi
-- tiếp.
--
-- Nhưng "đi tiếp" cần biết danh sách gốc là ai. Nếu đối tượng nhận thư chỉ nằm
-- trên màn hình rồi gửi kèm mỗi lần bấm, thì một lô mở cho mentor có thể được
-- bấm tiếp với mentee — và những người chưa từng nằm trong lô ấy nhận thư như
-- thể họ có. Cột này khoá điều đó lại ở chỗ duy nhất không bấm nhầm được.
--
-- Cột nullable, vì `create table if not exists` ở migration trước đã có thể
-- chạy rồi. Không lô nào tồn tại lúc này (module chưa gửi được gì), nên không
-- có dòng cũ nào phải lấp.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $email_batches_audience_prereq$
begin
  if to_regclass('public.email_batches') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batches (migration 20260909150000)';
  end if;
end;
$email_batches_audience_prereq$;

alter table public.email_batches
  add column if not exists audience text;

do $email_batches_audience_check$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_check'
  ) then
    alter table public.email_batches
      add constraint email_batches_audience_check
      check (audience is null or audience in ('mentee', 'mentor', 'both'));
  end if;
end;
$email_batches_audience_check$;

comment on column public.email_batches.audience is
  'Đối tượng nhận thư của lô: mentee, mentor, hoặc both. Lần chạy tiếp theo đọc cột này chứ không nhận từ màn hình, để một lô không đổi tập người nhận giữa chừng.';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $email_batches_audience_contract$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_batches'
      and column_name = 'audience'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột email_batches.audience';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc email_batches_audience_check';
  end if;

  -- Bảng vẫn phải là server-only: migration này không được nới gì ra ngoài.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'email_batches'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches lại có policy';
  end if;
end;
$email_batches_audience_contract$;

notify pgrst, 'reload schema';

commit;
