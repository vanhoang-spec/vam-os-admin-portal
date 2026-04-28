# Hướng Dẫn Import Activity & Event Tracking

Status: Hướng dẫn MVP đã chốt theo quyết định nghiệp vụ Phase 2. Chưa import dữ liệu thật cho đến khi schema được thiết kế và review.

## Mục Tiêu

Phase 2 giúp core team ghi nhận hoạt động mentoring và tham gia event/training ở mức tối thiểu:

- Ngày mentee gặp mentor.
- Link bài recap Facebook.
- Trạng thái tham dự event/training.
- Ghi chú nội bộ nếu cần.

MVP chỉ lưu link recap, không copy toàn bộ nội dung bài Facebook vào VAM OS.

## File Template

Có 2 template:

- `templates/mentoring_recaps_import_template.csv`
- `templates/event_participations_import_template.csv`

## Mentoring Recaps

Quy tắc chính:

- Một dòng = một recap cho đúng một buổi gặp mentor-mentee.
- Một recap không đại diện cho nhiều buổi gặp trong Phase 2 MVP.
- Mỗi mentee được kỳ vọng có ít nhất một recap mỗi tháng.
- Follow-up thiếu recap chỉ được tạo sau hai tháng liên tiếp không có recap.

### Cột Dữ Liệu

- `season_code`: mã mùa, ví dụ `UEHM-S11`.
- `mentee_email`: email mentee.
- `mentee_code`: mã mentee nếu có.
- `mentor_email`: email mentor.
- `mentor_code`: mã mentor nếu có.
- `match_id`: ID match nếu biết.
- `meeting_date`: ngày gặp mentor, định dạng `YYYY-MM-DD`.
- `meeting_month`: tháng vận hành, định dạng `YYYY-MM`.
- `recap_url`: link bài recap Facebook hoặc nguồn khác.
- `recap_source`: nguồn recap.
- `recap_note`: ghi chú ngắn về recap nếu cần.
- `issue_flag`: đánh dấu cần rà soát.
- `admin_notes`: ghi chú nội bộ.
- `meeting_type`: optional operational classification for the mentoring session. Defaults to `1on1_primary` when omitted.
- `captured_by`: optional steward/import source that captured the row.

### Trường Bắt Buộc Đề Xuất

- `season_code`
- `meeting_date`
- `meeting_month`
- `recap_url`
- Ít nhất một định danh mentee: `mentee_email` hoặc `mentee_code`
- Ít nhất một định danh mentor/match: `match_id`, `mentor_email`, hoặc `mentor_code`

### Giá Trị Cho Phép

`recap_source`:

- `facebook_group`
- `google_sheet`
- `admin_input`

`issue_flag`:

- `true`
- `false`

`meeting_type`:

- `1on1_primary`: primary mentor-mentee 1:1 session.
- `1on1_cross`: cross-mentor or non-primary 1:1 session.
- `group`: group mentoring session.
- `online`: online mentoring session.
- `offline`: offline mentoring session.
- `unknown`: session type is not known yet.

For historical tracking imports, use `captured_by='tracking_file_import'` unless the specific Recap Steward is known.

## Event Participations

Phase 2 chỉ theo dõi 3 event/training:

- `Mentee Orientation`
- `Kickoff`
- `Tổng kết`

Một dòng tương ứng một người trong một event/training.

### Cột Dữ Liệu

- `season_code`: mã mùa.
- `event_code`: mã event nếu có.
- `event_name`: tên event/training.
- `event_date`: ngày event, định dạng `YYYY-MM-DD`.
- `person_email`: email người tham gia.
- `person_code`: mã người tham gia nếu có.
- `role_at_event`: vai trò tại event, ví dụ `mentee`, `mentor`, `speaker`, `organizer`.
- `registration_status`: trạng thái đăng ký.
- `attendance_status`: trạng thái tham dự.
- `recap_url`: link recap event nếu có.
- `excuse_reason`: lý do vắng nếu cần ghi nhận.
- `admin_notes`: ghi chú nội bộ.
- `captured_by`: optional steward/import source that captured the row.
- `walk_in`: optional marker for attendance without prior registration. Defaults to `false` when omitted.

### Trường Bắt Buộc Đề Xuất

- `season_code`
- `event_name` hoặc `event_code`
- `event_date`
- Ít nhất một định danh người tham gia: `person_email` hoặc `person_code`
- `attendance_status`

### Giá Trị Cho Phép

`registration_status`:

- `registered`
- `unknown`

`attendance_status`:

- `attended`: Tham dự
- `registered_absent`: Đăng ký nhưng không tham dự

`recap_url` của event là tùy chọn.

`walk_in` accepts:

- `true`
- `false`
- `yes`
- `no`
- `1`
- `0`

For historical tracking imports, use `captured_by='tracking_file_import'` unless the specific Event Steward is known.

## Cách Lấy Link Recap Facebook

1. Mở bài recap trong Facebook group.
2. Chọn chức năng sao chép liên kết bài viết.
3. Dán link vào `recap_url`.
4. Không copy toàn bộ nội dung bài viết vào file import.

## Monthly Operations Report

Báo cáo vận hành hằng tháng nên có các KPI:

- Recap count.
- Active mentee count.
- Active mentor count.
- Number of trainings/events.
- Attendance count.
- Feedback count nếu dữ liệu feedback tồn tại.

## Lưu Ý Bảo Mật

- Không đưa nội dung riêng tư không cần thiết vào file CSV.
- Chỉ lưu link recap và ghi chú vận hành ngắn.
- File import có thể chứa email, mã người dùng và link Facebook, nên chỉ chia sẻ trong core team.

## Chưa Import Ngay

Các template này dùng để chuẩn bị dữ liệu và review SOP. Chỉ import sau khi:

- Schema Phase 2 được thiết kế.
- Migration đã được review.
- Mapping import đã được test trên staging.
