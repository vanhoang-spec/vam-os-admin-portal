# VAM OS Phase 2B - Ghi chú release Event Participation Pilot

## Phạm vi đã hoàn thành

- Seeded 3 event Phase 2:
  - Mentee Orientation
  - Kickoff
  - Tổng kết
- Sửa lookup khi import event participation để dùng `legacy_event_temp_id` trong trường hợp bảng `events` chưa có `event_code`.
- Import 3 dòng participation pilot cho Mentee Orientation.
- Đã verify KPI event trên Operations Dashboard cho tháng `2026-04`.
- Đã verify các phần event activity trên hồ sơ có thể hiển thị event participation.

## Dữ liệu pilot

- Event/training trong tháng `2026-04`: 2
- Lượt tham dự event: 2
- Tỷ lệ attendance: 67%
- Pilot participation rows:
  - 2 `attended`
  - 1 `registered_absent`

## Giới hạn hiện tại

- Event participation hiện chỉ là pilot, chưa phải full historical import.
- Cần nguồn registration/sign-in đáng tin cậy trước khi import đầy đủ event attendance.
- Ngày event hiện đang là placeholder được seed, trừ khi ngày thực tế được xác nhận.
- Feedback module chưa được triển khai.

## Đề xuất bước tiếp theo

- Xác nhận ngày thực tế cho Orientation, Kickoff, Tổng kết.
- Thu thập nguồn sign-in/registration chính thức.
- Chỉ import event attendance từ nguồn đáng tin cậy.
- Bổ sung event detail page hoặc event attendance table ở giai đoạn sau.
- Làm sạch hoặc flag các date outlier trong mentoring recap chart.
