# VAM OS Phase 2 - Ghi chú milestone

## Phạm vi đã hoàn thành

- Hoàn thiện các bảng database phục vụ activity tracking.
- Xây dựng import runner cho dữ liệu activity.
- Import lịch sử mentoring recap từ Tracking SS11.
- Bổ sung activity sections trên hồ sơ mentor và mentee.
- Xây dựng Operations Dashboard cho theo dõi vận hành theo tháng.
- Sửa các warning links trên Dashboard.

## Dữ liệu chính đã import

- 901 mentoring recaps có độ tin cậy cao đã được import từ Tracking SS11.
- Các tháng hoạt động chính:
  - 2025-11: 508 recap, 462 active mentees, 349 active mentors.
  - 2025-12: 278 recap, 267 active mentees, 216 active mentors.
  - 2026-01: 38 recap, 38 active mentees, 36 active mentors.
  - 2026-02: 64 recap, 64 active mentees, 56 active mentors.

## Giới hạn hiện tại

- Chưa import event participation.
- Chưa triển khai feedback module.
- Follow-up hiện chỉ là danh sách candidate được tính toán, chưa phải workflow xử lý hành động.
- Một số date outliers có thể cần review thủ công sau.
- Chưa triển khai Auth/RLS; hiện chỉ có temporary password gate.

## Đề xuất bước tiếp theo

- QA lại định nghĩa KPI trên Operations Dashboard.
- Seed các event Phase 2: Mentee Orientation, Kickoff, Tổng kết.
- Chỉ import event attendance từ nguồn sign-in/registration đáng tin cậy.
- Xây dựng follow-up workflow/action_items ở giai đoạn sau.
- Triển khai Auth/RLS trước khi chia sẻ rộng hơn.
