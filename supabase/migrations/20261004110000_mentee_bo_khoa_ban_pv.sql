-- ============================================================
-- 20261004110000_mentee_bo_khoa_ban_pv.sql
-- ============================================================
--
-- SỬA NÓNG trong buổi phỏng vấn 04/10/2026 (sáng): Support phân bàn báo "Bàn/người
-- phỏng vấn đã được phân trong ca, hoặc mentee đã có mentor" — khoảng 90 lần chặn
-- trong 09:08–10:58 ở 10 bàn khác nhau.
--
-- Vì sao: 20261003100000 chỉ mở bàn / mentor khi bạn TRƯỚC đã có kết quả. Thực tế
-- mentor phỏng vấn xong là nhận bạn kế tiếp ngay, còn phiếu bạn trước viết sau (phiếu
-- dài, có bản nháp). Ví dụ phòng 4 bàn 4 ca 09:00: Support phân bạn mới lúc 10:32–10:36
-- đều bị chặn vì bạn trước đến 10:39 mới được lưu kết quả.
--
-- Sửa: bỏ hẳn hai chỉ số duy nhất (bàn / người phỏng vấn trong ca). Một mentor được
-- giữ nhiều bạn chưa có kết quả; Support thấy bàn đang có ai trên màn hình. Không đụng
-- dữ liệu, không đổi hàm — luật chấm, trần nhận mentee, ghép cặp giữ nguyên.
--
-- Dán vào Supabase SQL Editor (Production) NGAY — có hiệu lực tức thì, không cần deploy.

begin;

drop index if exists public.mentee_interview_desk_uidx;
drop index if exists public.mentee_interview_interviewer_uidx;

do $bo_khoa_ban_self_check$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public'
             and indexname in ('mentee_interview_desk_uidx', 'mentee_interview_interviewer_uidx')) then
    raise exception 'Tự kiểm: vẫn còn chỉ số khoá bàn / người phỏng vấn';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                 and indexname = 'mentee_interview_operations_pkey') then
    raise exception 'Tự kiểm: mất khoá chính mentee_interview_operations_pkey';
  end if;
  raise notice 'Đã bỏ khoá bàn / người phỏng vấn — Support phân bàn tự do';
end
$bo_khoa_ban_self_check$;

commit;
