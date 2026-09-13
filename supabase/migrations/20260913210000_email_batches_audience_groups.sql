-- ============================================================
-- Thêm nhóm nhận thư: Ban tổ chức, mentor quay lại mùa, người đăng ký sự kiện
-- ============================================================
--
-- Tới trước migration này, một lô gửi hàng loạt chỉ nhắm được ba nhóm: mentee,
-- mentor, hoặc cả hai — đều theo membership đang hoạt động của mùa.
--
-- Ban tổ chức cần thêm ba nhóm:
--   'staff'            — Ban tổ chức: tài khoản admin, super_admin, core team,
--                        support team đang hoạt động.
--   'returning_mentor' — mentor đã chấp nhận lời mời quay lại mùa này.
--   'event'            — người đã đăng ký MỘT sự kiện của mùa (hoặc cả chuỗi
--                        mà sự kiện ấy thuộc về).
--
-- ============================================================
-- VÌ SAO NHÓM 'event' CẦN HAI CỘT MỚI
-- ============================================================
-- Một lô không gửi xong trong một lần chạy. Lần "Gửi tiếp" dựng lại danh sách
-- người nhận từ nhóm ĐÃ CHỐT VÀO LÔ, không nhận từ màn hình. Với ba nhóm cũ, tên
-- nhóm là đủ. Với nhóm 'event', lô còn phải nhớ sự kiện nào và có gồm cả chuỗi
-- không — thiếu một trong hai thì lần gửi tiếp dựng ra một danh sách khác, và
-- những người chưa từng nằm trong lô nhận thư như thể họ có.
--
-- Nên hai điều đó cũng nằm trên lô: `audience_event_id`, `audience_covers_series`.
-- Một ràng buộc hình dạng bắt chúng đi đúng với nhóm: có sự kiện khi và chỉ khi
-- nhóm là 'event'.
--
-- ============================================================
-- VÌ SAO NỚI RÀNG BUỘC BẰNG MẪU `\]\)+$`, KHÔNG PHẢI `\]\)\)\)$`
-- ============================================================
-- Ràng buộc hiện tại được đọc lại là
--   CHECK (((audience IS NULL) OR (audience = ANY (ARRAY['mentee'::text, ...]))))
-- tức là kết thúc bằng BỐN dấu đóng ngoặc, vì có thêm vế `audience IS NULL`.
-- Khuôn nới ràng buộc dùng ở các migration khác tìm đúng BA dấu, và áp nguyên
-- khuôn ở đây sẽ dừng lại báo "dạng lạ". Mẫu một-hoặc-nhiều khớp cả hai dạng.
--
-- Không lô nào tồn tại trên production lúc viết, nên không có dòng cũ phải lấp.
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $email_batches_groups_prereq$
begin
  if to_regclass('public.email_batches') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batches (migration 20260909150000)';
  end if;
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần public.events';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_check'
  ) then
    raise exception 'PREREQ_MISSING: cần email_batches_audience_check (migration 20260910090000)';
  end if;
end;
$email_batches_groups_prereq$;

-- ------------------------------------------------------------
-- 1. Nới ràng buộc nhóm theo lối cộng thêm
-- ------------------------------------------------------------
-- Đọc lại định nghĩa đang chạy rồi nối vào đuôi, thay vì viết đè cả danh sách:
-- viết đè là phải chép lại đúng mọi nhóm cũ, và chép thiếu một nhóm thì mọi lô
-- của nhóm đó lặng lẽ không mở được nữa.
do $email_batches_groups_widen$
declare
  existing text;
  rebuilt  text;
begin
  select pg_get_constraintdef(c.oid)
    into existing
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  -- Chạy lại lần hai không nhân đôi giá trị.
  if position('''event''' in existing) > 0 then
    return;
  end if;

  rebuilt := regexp_replace(
    existing,
    '(\]\)+)$',
    ', ''staff''::text, ''returning_mentor''::text, ''event''::text\1'
  );

  if rebuilt = existing then
    raise exception
      'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check có dạng lạ, không nới được: %',
      existing;
  end if;

  execute 'alter table public.email_batches drop constraint email_batches_audience_check';
  execute 'alter table public.email_batches add constraint email_batches_audience_check '
       || replace(rebuilt, 'CHECK ', 'check ');
end;
$email_batches_groups_widen$;

-- ------------------------------------------------------------
-- 2. Lô nhóm 'event' nhớ sự kiện nào, có gồm cả chuỗi không
-- ------------------------------------------------------------
-- ON DELETE RESTRICT: xoá một sự kiện đang có lô thư trỏ vào là xoá mất câu trả
-- lời cho "lá thư này gửi cho ai". Đường xoá buổi của chuỗi chỉ xoá buổi chưa
-- ai đăng ký, và một buổi chưa ai đăng ký thì không mở được lô nào — nên ràng
-- buộc này không chặn thao tác nào đang có.
alter table public.email_batches
  add column if not exists audience_event_id uuid references public.events(id) on delete restrict;

alter table public.email_batches
  add column if not exists audience_covers_series boolean not null default false;

create index if not exists email_batches_audience_event_idx
  on public.email_batches (audience_event_id)
  where audience_event_id is not null;

do $email_batches_groups_shape$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_event_shape_check'
  ) then
    alter table public.email_batches
      add constraint email_batches_audience_event_shape_check
      check (
        (audience = 'event' and audience_event_id is not null)
        or (audience is distinct from 'event' and audience_event_id is null and audience_covers_series = false)
      );
  end if;
end;
$email_batches_groups_shape$;

comment on column public.email_batches.audience is
  'Đối tượng nhận thư của lô: mentee, mentor, both, staff (Ban tổ chức), returning_mentor (mentor đã xác nhận quay lại mùa), hoặc event (người đã đăng ký một sự kiện). Lần chạy tiếp theo đọc cột này chứ không nhận từ màn hình.';
comment on column public.email_batches.audience_event_id is
  'Sự kiện của nhóm event. Null với mọi nhóm khác. Lần gửi tiếp dựng lại danh sách người đăng ký từ đúng sự kiện này.';
comment on column public.email_batches.audience_covers_series is
  'Nhóm event có gồm cả các buổi khác cùng chuỗi không. Luôn false với các nhóm khác.';

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $email_batches_groups_contract$
declare
  def text;
  v   text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.email_batches'::regclass
    and c.conname = 'email_batches_audience_check';

  foreach v in array array['staff', 'returning_mentor', 'event'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check chưa nhận %', v;
    end if;
  end loop;

  -- Không mất nhóm cũ nào.
  foreach v in array array['mentee', 'mentor', 'both'] loop
    if position('''' || v || '''' in coalesce(def, '')) = 0 then
      raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches_audience_check đã MẤT nhóm cũ %', v;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batches' and column_name = 'audience_event_id'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột email_batches.audience_event_id';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batches'
      and column_name = 'audience_covers_series' and is_nullable = 'NO'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột email_batches.audience_covers_series (NOT NULL)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_batches'::regclass
      and conname = 'email_batches_audience_event_shape_check'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu email_batches_audience_event_shape_check';
  end if;

  -- Bảng vẫn phải là server-only: migration này không được nới gì ra ngoài.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'email_batches'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches lại có policy';
  end if;
end;
$email_batches_groups_contract$;

notify pgrst, 'reload schema';

commit;
