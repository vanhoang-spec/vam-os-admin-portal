-- =============================================================================
-- Thư báo "ca của bạn chuyển sang PHỎNG VẤN ONLINE" — dấu đã báo (BTC 08/10/2026)
-- =============================================================================
-- DÁN TRƯỚC KHI MERGE PR: mã mới đọc và ghi cột này; thiếu cột thì khung gửi thư
-- trên trang Ca phỏng vấn mentee báo "Hệ thống đang bận".
--
-- Chiều Thứ Bảy 10/10 chuyển sang phỏng vấn online (migration 20261008153000). Mentee
-- đã giữ chỗ các ca này cần một lá thư báo kèm link nhóm Zalo. Dấu đặt trên lời mời
-- (một dòng mỗi mentee), không trên dòng giữ chỗ: bạn nào đổi sang một ca online khác
-- thì dòng giữ chỗ mới, nhưng vẫn là người đã được báo.
--
-- Cùng cách chống gửi trùng với reopen_notified_at: đánh dấu TRƯỚC khi gửi, chỉ khi
-- cột đang trống; gửi hỏng thì xoá dấu.
--
-- Chỉ thêm cột (nullable), không đụng dữ liệu, không đổi quyền hay RLS. Chạy lại vô hại.
-- =============================================================================

alter table public.mentee_interview_invites
  add column if not exists online_notified_at timestamptz;

comment on column public.mentee_interview_invites.online_notified_at is
  'Lúc gửi thư báo ca phỏng vấn chuyển sang online (BTC 08/10/2026). Trống = chưa báo.';

do $bao_phong_van_online$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mentee_interview_invites'
      and column_name = 'online_notified_at' and data_type = 'timestamp with time zone'
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: thiếu cột mentee_interview_invites.online_notified_at';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mentee_interview_invites' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA_CONTRACT_VIOLATION: mentee_interview_invites mất RLS';
  end if;
end;
$bao_phong_van_online$;

notify pgrst, 'reload schema';
