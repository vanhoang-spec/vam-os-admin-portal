# Hướng Dẫn Import Activity & Event Tracking - Bản Nháp

Tài liệu này hướng dẫn cách chuẩn bị dữ liệu activity/event cho Phase 2. Đây là bản nháp để core team review. Không import dữ liệu thật cho đến khi schema và SOP được chốt.

## Mục tiêu

Core team cần ghi nhận tối thiểu:

- Ngày mentee gặp mentor.
- Link bài recap Facebook.
- Trạng thái tham gia event/training.
- Ghi chú admin nếu cần.

Không cần copy toàn bộ nội dung recap Facebook vào VAM OS ở giai đoạn MVP này.

## File template

Có 2 template:

- `templates/mentoring_recaps_import_template.csv`
- `templates/event_participations_import_template.csv`

## Cách điền mentoring recap

Mỗi dòng tương ứng một recap hoặc một buổi gặp mentor được ghi nhận.

Các cột:

- `season_code`: mã mùa, ví dụ `S11`.
- `mentee_email`: email mentee.
- `mentee_code`: mã mentee nếu có.
- `mentor_email`: email mentor.
- `mentor_code`: mã mentor nếu có.
- `match_id`: ID match nếu biết.
- `meeting_date`: ngày gặp mentor, định dạng đề xuất `YYYY-MM-DD`.
- `meeting_month`: tháng vận hành, ví dụ `2026-04`.
- `recap_url`: link bài recap Facebook hoặc nguồn khác.
- `recap_source`: nguồn recap.
- `recap_note`: ghi chú ngắn về recap nếu cần.
- `issue_flag`: đánh dấu cần follow-up.
- `admin_notes`: ghi chú nội bộ.

### Bắt buộc đề xuất

- `season_code`
- `meeting_date`
- `recap_url`
- Ít nhất một cách xác định mentee: `mentee_email` hoặc `mentee_code`
- Ít nhất một cách xác định mentor/match: `match_id`, `mentor_email`, hoặc `mentor_code`

### Tùy chọn

- `recap_note`
- `issue_flag`
- `admin_notes`

### Giá trị gợi ý

`recap_source`:

- `facebook_group`
- `google_sheet`
- `admin_input`

`issue_flag`:

- `true`
- `false`

## Cách điền event participation

Mỗi dòng tương ứng một người tham gia hoặc được ghi nhận trong một event/training.

Các cột:

- `season_code`: mã mùa.
- `event_code`: mã event nếu có.
- `event_name`: tên event/training.
- `event_date`: ngày event, định dạng đề xuất `YYYY-MM-DD`.
- `person_email`: email người tham gia.
- `person_code`: mã mentor/mentee/person nếu có.
- `role_at_event`: vai trò tại event.
- `registration_status`: trạng thái đăng ký.
- `attendance_status`: trạng thái tham dự.
- `recap_url`: link recap nếu có.
- `excuse_reason`: lý do vắng nếu có.
- `admin_notes`: ghi chú nội bộ.

### Bắt buộc đề xuất

- `season_code`
- `event_name` hoặc `event_code`
- `event_date`
- Ít nhất một cách xác định người tham gia: `person_email` hoặc `person_code`
- `attendance_status`

### Tùy chọn

- `registration_status`
- `recap_url`
- `excuse_reason`
- `admin_notes`

### Giá trị gợi ý

`registration_status`:

- `registered`
- `not_registered`
- `cancelled`
- `unknown`

`attendance_status`:

- `attended`
- `absent_with_notice`
- `absent_without_notice`
- `unknown`

`role_at_event`:

- `mentee`
- `mentor`
- `speaker`
- `trainer`
- `organizer`
- `guest`
- `unknown`

## Cách copy link recap Facebook

1. Mở bài viết recap trong Facebook group.
2. Chọn menu của bài viết.
3. Chọn copy link hoặc sao chép liên kết.
4. Dán vào cột `recap_url`.
5. Không copy toàn bộ nội dung bài viết vào CSV trừ khi SOP yêu cầu sau này.

## Ghi chú về quyền riêng tư

- Recap Facebook có thể chứa thông tin cá nhân hoặc cảm xúc của mentee.
- Giai đoạn MVP chỉ lưu link, không lưu toàn bộ nội dung recap.
- Chỉ core team nội bộ được truy cập dữ liệu.
- Không chia sẻ CSV hoặc link recap ra ngoài nhóm vận hành.

## Không import ngay

Không import các file này vào Supabase cho đến khi:

- SOP được Claude/core team xác nhận.
- Schema được chốt.
- Quy trình review/import được thống nhất.
- Quyền truy cập nội bộ được bảo vệ đầy đủ.

