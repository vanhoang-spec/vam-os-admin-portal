-- ============================================================
-- 20261003100000_mentee_ban_pv_mo_lai_sau_khi_cham.sql
-- ============================================================
--
-- SỬA NÓNG trong buổi phỏng vấn 03/10/2026: mentor chấm xong một mentee rồi KHÔNG
-- nhận được mentee tiếp theo — Support phân bàn báo "Bàn/người phỏng vấn đã được
-- phân trong ca, hoặc mentee đã có mentor".
--
-- Vì sao: hai chỉ số duy nhất "một bàn một mentee mỗi ca" và "một người phỏng vấn
-- một mentee mỗi ca" khoá CẢ những buổi đã chấm xong. Ca 08:30 chạy trễ, mentor
-- nhận tiếp mentee CÙNG ca tại cùng bàn → đụng dòng của mentee đã chấm (vd. phòng
-- 2 bàn 3 ca 08:30 vẫn ghi cho mentee đã có kết quả).
--
-- Sửa: chỉ khoá buổi CHƯA có kết quả (outcome is null). Một bàn / một mentor vẫn
-- không thể có hai mentee đang phỏng vấn cùng lúc trong một ca; chấm xong thì bàn
-- và mentor được giải phóng cho mentee kế tiếp. Không đụng dữ liệu, không đổi hàm.
--
-- Dán vào Supabase SQL Editor (Production) NGAY — không có mã ứng dụng đi kèm.

begin;

drop index if exists public.mentee_interview_desk_uidx;
create unique index mentee_interview_desk_uidx
  on public.mentee_interview_operations (session_id, room, desk)
  where room is not null and outcome is null;

drop index if exists public.mentee_interview_interviewer_uidx;
create unique index mentee_interview_interviewer_uidx
  on public.mentee_interview_operations (session_id, interviewer_id)
  where interviewer_id is not null and outcome is null;

do $ban_pv_self_check$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'mentee_interview_desk_uidx';
  if v_def is null or position('UNIQUE' in v_def) = 0 or position('outcome IS NULL' in v_def) = 0 then
    raise exception 'Tự kiểm: mentee_interview_desk_uidx chưa đúng: %', v_def;
  end if;
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'mentee_interview_interviewer_uidx';
  if v_def is null or position('UNIQUE' in v_def) = 0 or position('outcome IS NULL' in v_def) = 0 then
    raise exception 'Tự kiểm: mentee_interview_interviewer_uidx chưa đúng: %', v_def;
  end if;
  raise notice 'Đã mở lại bàn/người phỏng vấn sau khi chấm xong';
end
$ban_pv_self_check$;

commit;
