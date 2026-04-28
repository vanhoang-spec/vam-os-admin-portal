# VAM OS Phase 2D - Ghi chú release Admin Correction Workflow

## Phạm vi đã hoàn thành

- Tạo `activity_correction_log` làm audit trail cho các chỉnh sửa thủ công.
- Bổ sung route `/recaps/[id]/edit`.
- Bổ sung link correction từ bảng outlier trên Operations Dashboard và các dòng activity trong hồ sơ cá nhân.
- Giới hạn các field được phép correction: `meeting_date`, `meeting_month`, `status`, `issue_flag`, `admin_notes`.
- Workflow correction ghi nhận `old_value`, `new_value`, `reason`, `corrected_by`, `created_at`.

## Quy tắc an toàn

- Không cho phép delete.
- Không cho phép đổi mentor, mentee, match, `recap_url`.
- `meeting_month` được tự động derive khi `meeting_date` thay đổi.
- Mỗi field thay đổi tạo một dòng audit log riêng.
- `corrected_by` vẫn là text cho đến khi có Auth/RLS.

## Giới hạn hiện tại

- Chưa có Supabase Auth/RLS.
- `corrected_by` là text nhập thủ công.
- Workflow correction hiện chỉ hỗ trợ `mentoring_recaps`, chưa hỗ trợ `event_participations`.
- Chưa có bulk correction workflow.

## Đề xuất bước tiếp theo

- Triển khai Auth/RLS trước khi chia sẻ rộng hơn.
- Bổ sung admin correction workflow cho event participation ở giai đoạn sau.
- Bổ sung filter dashboard theo `status`/`issue_flag`.
- Rà soát các dòng outlier và chỉnh sửa date/month khi đã biết thông tin đúng.
