-- ============================================================
-- Giới hạn số lần một email được đăng ký sự kiện (báo lỗi VAM00015, 03/11/2026)
-- ============================================================
--
-- Mỗi sự kiện có thể đặt "một email đăng ký tối đa N lần", tính trong một sự kiện hoặc
-- trên cả chuỗi sự kiện (các buổi dùng chung `events.series_id`). Để trống là không giới hạn,
-- đúng như hôm nay: migration này KHÔNG đổi hành vi của sự kiện nào cho tới khi có người đặt
-- giới hạn.
--
-- ------------------------------------------------------------
-- VÌ SAO CHẶN Ở DATABASE
-- ------------------------------------------------------------
-- Kiểm ở tầng ứng dụng thôi thì hai lần bấm gần nhau (hai buổi, cùng một email) vẫn lọt cả hai:
-- cả hai cùng đếm ra "chưa có đăng ký nào" rồi cùng ghi. Nên chốt chặn là một trigger trên
-- `event_registrations`, chạy dưới khoá tư vấn theo (chuỗi hoặc sự kiện, email): hai yêu cầu của
-- cùng một email trong cùng chuỗi xếp hàng, và yêu cầu sau đếm lại SAU KHI yêu cầu trước đã ghi.
-- Khoá theo CHUỖI chứ không theo buổi, vì giới hạn theo chuỗi phải thấy được đăng ký ở buổi khác.
--
-- ------------------------------------------------------------
-- LUẬT ĐẾM
-- ------------------------------------------------------------
-- - Một lượt tính khi `registration_status` KHÔNG phải 'cancelled' hoặc 'rejected'. Nên:
--   huỷ đăng ký là hoàn lượt ngay, không cần bộ đếm nào phải được trả lại; chờ duyệt, đã xác nhận
--   và danh sách chờ đều tính (người ở danh sách chờ có thể được xếp chỗ, và nếu không tính thì
--   một người đăng ký vào mọi buổi rồi được xếp chỗ hết sẽ vượt giới hạn).
-- - Chỉ chặn đăng ký công khai (`registration_source = 'public_form'`, kể cả form tùy chỉnh gắn sự
--   kiện). Vãng lai, BTC nhập tay và import không bị chặn: người đang đứng trước cửa phòng không
--   thể bị từ chối vì đã đăng ký đủ ở nơi khác. Dòng vãng lai cũng không được tính vào giới hạn.
-- - Nộp lại để sửa đăng ký đã có (cùng email, cùng buổi) là cập nhật chứ không phải lượt mới, nên
--   không bị chặn dù email đã chạm giới hạn.
--
-- ------------------------------------------------------------
-- PHẠM VI "MỘT SỰ KIỆN"
-- ------------------------------------------------------------
-- Trong MỘT buổi, `event_registrations_event_lower_email_active_uidx` đã buộc mỗi email chỉ giữ một
-- đăng ký còn hiệu lực (nộp lại là ghi đè). Nên phạm vi 'event' chỉ có nghĩa là "1 lần" và không
-- cần trigger can thiệp: để nó chạy thì hai lần bấm gần nhau sẽ nhận lỗi giới hạn thay vì đi vào
-- đường "ghi đè dòng vừa tạo" mà ứng dụng đã xử lý bằng lỗi trùng khoá 23505.
--
-- Chạy lại nhiều lần vô hại.
-- ============================================================

begin;

do $prereq$
begin
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: cần public.events';
  end if;
  if to_regclass('public.event_registrations') is null then
    raise exception 'PREREQ_MISSING: cần public.event_registrations';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'series_id'
  ) then
    raise exception 'PREREQ_MISSING: cần events.series_id (migration 20260910140000)';
  end if;
end;
$prereq$;

-- ------------------------------------------------------------
-- 1. Cấu hình trên sự kiện
-- ------------------------------------------------------------
alter table public.events
  add column if not exists registration_limit_per_email integer;

alter table public.events
  add column if not exists registration_limit_scope text not null default 'event';

do $limit_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and conname = 'events_registration_limit_check'
  ) then
    alter table public.events
      add constraint events_registration_limit_check
      check (registration_limit_per_email is null or registration_limit_per_email >= 1);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and conname = 'events_registration_limit_scope_check'
  ) then
    alter table public.events
      add constraint events_registration_limit_scope_check
      check (registration_limit_scope in ('event', 'series'));
  end if;
end;
$limit_constraints$;

comment on column public.events.registration_limit_per_email is
  'Một email được đăng ký tối đa bấy nhiêu lần. NULL = không giới hạn. Đếm theo registration_limit_scope; huỷ đăng ký là hoàn lượt.';

comment on column public.events.registration_limit_scope is
  '"event": đếm trong sự kiện này (trong một buổi một email vốn chỉ giữ một đăng ký còn hiệu lực). "series": đếm trên mọi buổi cùng events.series_id; sự kiện không thuộc chuỗi thì coi như "event".';

-- ------------------------------------------------------------
-- 2. Luật đếm, một chỗ duy nhất
-- ------------------------------------------------------------
create or replace function public.vam_registration_counts_toward_limit(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select coalesce(p_status, '') not in ('cancelled', 'rejected')
$fn$;

-- ------------------------------------------------------------
-- 3. Chốt chặn
-- ------------------------------------------------------------
create or replace function public.vam_enforce_event_registration_limit()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_limit integer;
  v_scope text;
  v_series uuid;
  v_email text;
  v_count integer;
begin
  -- Chỉ đăng ký công khai. Vãng lai, BTC nhập tay, import không bị giới hạn.
  if coalesce(new.is_walk_in, false) or coalesce(new.registration_source, '') <> 'public_form' then
    return new;
  end if;
  if not public.vam_registration_counts_toward_limit(new.registration_status) then
    return new;
  end if;
  v_email := lower(btrim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Cùng người, cùng buổi, vẫn đang tính: sửa tên, sửa số điện thoại, hay đổi giữa các trạng thái
    -- còn hiệu lực không phải một lượt mới.
    if public.vam_registration_counts_toward_limit(old.registration_status)
       and lower(btrim(coalesce(old.email, ''))) = v_email
       and old.event_id = new.event_id then
      return new;
    end if;
  end if;

  select e.registration_limit_per_email, e.registration_limit_scope, e.series_id
    into v_limit, v_scope, v_series
    from public.events e
   where e.id = new.event_id;

  -- Chưa đặt giới hạn, hoặc phạm vi một sự kiện (đã có ràng buộc một email một buổi): không làm gì.
  if v_limit is null or v_scope <> 'series' or v_series is null then
    return new;
  end if;

  -- Xếp hàng mọi yêu cầu của cùng một email trong cùng một chuỗi. Khoá nhả khi giao dịch kết thúc,
  -- nên yêu cầu sau chỉ đếm khi yêu cầu trước đã ghi xong (READ COMMITTED đọc lại từng câu lệnh).
  perform pg_advisory_xact_lock(hashtextextended('event_registration_limit:' || v_series::text || ':' || v_email, 0));

  select count(*) into v_count
    from public.event_registrations r
    join public.events ev on ev.id = r.event_id
   where ev.series_id = v_series
     and lower(r.email) = v_email
     and r.is_walk_in is not true
     and r.id <> new.id
     and public.vam_registration_counts_toward_limit(r.registration_status);

  if v_count >= v_limit then
    raise exception 'EVENT_REGISTRATION_LIMIT_REACHED'
      using detail = format('scope=%s; limit=%s; count=%s', v_scope, v_limit, v_count);
  end if;

  return new;
end
$fn$;

-- `create or replace trigger` (PostgreSQL 14+): chạy lại được mà không phải xoá trigger rồi tạo lại.
create or replace trigger event_registrations_limit_per_email
  before insert or update of email, registration_status, event_id
  on public.event_registrations
  for each row
  execute function public.vam_enforce_event_registration_limit();

revoke all on function public.vam_registration_counts_toward_limit(text) from public, anon, authenticated;
revoke all on function public.vam_enforce_event_registration_limit() from public, anon, authenticated;
grant execute on function public.vam_registration_counts_toward_limit(text) to service_role;

-- ------------------------------------------------------------
-- 4. Tự kiểm
-- ------------------------------------------------------------
do $contract$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
  from unnest(array['registration_limit_per_email', 'registration_limit_scope']) as want
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = want
  );
  if missing is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột: %', missing;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass and conname = 'events_registration_limit_check')
     or not exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass and conname = 'events_registration_limit_scope_check') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu ràng buộc giới hạn đăng ký';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.event_registrations'::regclass
      and tgname = 'event_registrations_limit_per_email'
      and not tgisinternal
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu trigger event_registrations_limit_per_email';
  end if;

  -- Ràng buộc một email một buổi phải còn nguyên: trigger đứng cạnh nó, không thay nó.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_registrations_event_lower_email_active_uidx'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mất ràng buộc một-email-một-buổi';
  end if;

  if has_function_privilege('anon', 'public.vam_enforce_event_registration_limit()', 'execute')
     or has_function_privilege('authenticated', 'public.vam_enforce_event_registration_limit()', 'execute')
     or has_function_privilege('anon', 'public.vam_registration_counts_toward_limit(text)', 'execute')
     or has_function_privilege('authenticated', 'public.vam_registration_counts_toward_limit(text)', 'execute') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: anon hoặc authenticated gọi được hàm giới hạn đăng ký';
  end if;
end;
$contract$;

notify pgrst, 'reload schema';

commit;
