# Operations Dashboard - Ghi chú hardening

## Phạm vi đã hoàn thành

- Lọc các tháng outlier rõ ràng khỏi biểu đồ recap chính.
- Bổ sung warning/note khi có dữ liệu recap nằm ngoài khung mùa vận hành.
- Bổ sung bảng “Recap cần rà soát ngày/tháng”.
- Giữ nguyên dữ liệu recap đã import, không sửa dữ liệu gốc.
- Xác nhận KPI event vẫn hoạt động cho tháng `2026-04`.

## Khung tháng vận hành

- Season 11 operational range: `2025-10` đến `2026-06`.
- Định nghĩa outlier:
  - `meeting_month < 2025-10`
  - `meeting_month > 2026-06`
  - `meeting_month` null/invalid

## Vì sao thay đổi này quan trọng

- Tránh lỗi parsing ngày/tháng từ nguồn làm méo biểu đồ chính trên dashboard.
- Vẫn giữ các dòng nghi vấn hiển thị để rà soát thủ công, thay vì âm thầm ẩn dữ liệu.

## Giới hạn hiện tại

- Các dòng outlier chưa được tự động sửa.
- Chưa có workflow rà soát/chỉnh sửa thủ công trong admin.
- Follow-up vẫn chỉ là danh sách candidate được tính toán, chưa phải workflow xử lý chính thức.

## Đề xuất bước tiếp theo

- Rà soát và chỉnh sửa thủ công các dòng recap outlier.
- Bổ sung admin correction workflow ở giai đoạn sau.
- Xác nhận ngày event và chỉ import event attendance từ nguồn đáng tin cậy.
- Triển khai Auth/RLS trước khi chia sẻ rộng hơn.
