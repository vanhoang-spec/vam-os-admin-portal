-- =============================================================================
-- Khoá lô gửi thư hàng loạt: một lô chỉ có MỘT lần chạy tại một thời điểm
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR. Mã của PR này gọi email_batch_claim_run ở MỌI lần chạy lô (mọi nhóm):
-- merge trước khi dán thì không lô nào chạy được (lần chạy báo lỗi, chưa lá nào đi). Mã cũ chạy
-- bình thường trên schema mới (cột mới nullable, hàm mới không ai gọi).
--
-- VÌ SAO
--   Một lần chạy đọc "đã gửi cho ai" (outbound_emails) MỘT lần ở đầu, rồi gửi tối đa 85 lá trong
--   ~30 giây. Hai lần chạy chồng nhau trên cùng một lô (hai tab, hai admin, "Gửi tiếp tới hết" ở
--   một tab và "Gửi tiếp" ở tab khác) cùng thấy một danh sách còn lại, và cùng gửi cho những người
--   đó: mỗi người nhận HAI lá, kèm CC mentor. Không có cách thu hồi thư đã gửi.
--
-- CÁCH LÀM: một hợp đồng thuê ngắn trên dòng lô
--   - email_batch_claim_run(lô, token, giây): một câu UPDATE có điều kiện, nguyên tử — chỉ thành
--     công khi lô đang 'running' và không có hợp đồng còn hạn. Dùng now() của DATABASE, không
--     dùng đồng hồ của máy chủ ứng dụng (hai máy Vercel có thể lệch nhau).
--   - email_batch_release_run(lô, token): nhả, CHỈ khi token khớp — lần chạy quá hạn không nhả
--     được hợp đồng mà lần chạy sau đã giành.
--   - Hợp đồng tự hết hạn (75 giây > maxDuration 60 giây của trang Mail): lần chạy bị cắt giữa
--     chừng không khoá lô mãi mãi.
--
-- MỌI THAY ĐỔI LÀ CỘNG THÊM: 2 cột nullable, 2 hàm mới, không đổi ràng buộc / dữ liệu cũ.
-- Hai hàm SECURITY INVOKER, chỉ service_role được gọi. Chạy lại lần hai vô hại.
-- =============================================================================

begin;

do $khoa_lo_prereq$
begin
  if to_regclass('public.email_batches') is null then
    raise exception 'PREREQ_MISSING: cần public.email_batches';
  end if;
end;
$khoa_lo_prereq$;

alter table public.email_batches
  add column if not exists run_lease_until timestamptz,
  add column if not exists run_lease_token uuid;

comment on column public.email_batches.run_lease_until is
  'Hạn của lần chạy đang giữ lô (email_batch_claim_run). Null hoặc đã qua = không ai đang chạy lô này.';
comment on column public.email_batches.run_lease_token is
  'Token của lần chạy đang giữ lô; chỉ đúng token mới nhả được (email_batch_release_run).';

create or replace function public.email_batch_claim_run(p_batch_id uuid, p_token uuid, p_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $email_batch_claim_run$
begin
  if p_token is null or p_seconds is null or p_seconds < 1 or p_seconds > 600 then
    raise exception 'email_batch_claim_run: tham số không hợp lệ';
  end if;

  update public.email_batches
     set run_lease_until = now() + make_interval(secs => p_seconds),
         run_lease_token = p_token
   where id = p_batch_id
     and status = 'running'
     and (run_lease_until is null or run_lease_until <= now());

  return found;
end;
$email_batch_claim_run$;

create or replace function public.email_batch_release_run(p_batch_id uuid, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $email_batch_release_run$
begin
  update public.email_batches
     set run_lease_until = null,
         run_lease_token = null
   where id = p_batch_id
     and run_lease_token = p_token;

  return found;
end;
$email_batch_release_run$;

revoke all on function public.email_batch_claim_run(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.email_batch_release_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_batch_claim_run(uuid, uuid, integer) to service_role;
grant execute on function public.email_batch_release_run(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- Tự kiểm
-- ------------------------------------------------------------
do $khoa_lo_contract$
declare
  leaked text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batches' and column_name = 'run_lease_until'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_batches' and column_name = 'run_lease_token'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột khoá lô trên email_batches';
  end if;

  if to_regprocedure('public.email_batch_claim_run(uuid, uuid, integer)') is null
     or to_regprocedure('public.email_batch_release_run(uuid, uuid)') is null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu hàm xin / nhả khoá lô';
  end if;

  if exists (
    select 1 from pg_proc
    where oid in ('public.email_batch_claim_run(uuid, uuid, integer)'::regprocedure,
                  'public.email_batch_release_run(uuid, uuid)'::regprocedure)
      and prosecdef
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: hàm khoá lô không được SECURITY DEFINER';
  end if;

  select string_agg(format('%s:%s', grantee, routine_name), ', ') into leaked
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('email_batch_claim_run', 'email_batch_release_run')
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: quyền gọi hàm khoá lô lọt ra ngoài: %', leaked;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_batches') then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: email_batches lại có policy';
  end if;
end;
$khoa_lo_contract$;

notify pgrst, 'reload schema';

commit;
