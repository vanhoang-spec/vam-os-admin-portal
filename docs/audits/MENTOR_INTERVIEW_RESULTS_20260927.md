# Xem lại và xuất kết quả phỏng vấn mentor S12

## Vấn đề và cách xử lý

`getInterviewCandidates` chỉ lấy các trạng thái thuộc hàng đợi phỏng vấn. Khi
application đã được duyệt, rớt hoặc chuyển danh sách chờ, hồ sơ không còn hiện
ở hàng đợi, dù phiếu và nhận xét vẫn lưu trong `application_reviews`.

Thêm trang `/interviews/ket-qua-mentor` lấy theo phiếu phỏng vấn đã lưu của
mentor thuộc `UEHM-S12`, không lọc trạng thái application. Không thay đổi hàng
đợi bắt đầu phỏng vấn, tránh đưa hồ sơ đã chốt trở lại luồng bắt đầu mới.

- Menu Ứng tuyển → Kết quả phỏng vấn Mentor S12; có nút vào từ trang Phỏng vấn,
  Lịch phỏng vấn và trang xem phiếu phỏng vấn mentor.
- Tìm theo tên/email/SĐT hoặc tên interviewer, lọc trạng thái application.
- Mỗi phiếu hiện đủ 5 điểm, tổng /25, đề xuất, nhận xét đầy đủ, tên interviewer,
  ngày nộp/cập nhật, nút xem application. Nếu mentor có nhiều interviewer thì
  giữ từng phiếu, không ghi đè hoặc chỉ lấy phiếu đầu tiên.
- Tách nhận xét interviewer khỏi lịch sử quyết định/ghi chú BTC; không biến đề
  xuất reject thành quyết định cuối cùng và không gửi email kết quả.
- Trang bao gồm phiếu `in_progress`, `submitted`, `returned_for_clarification`,
  gắn rõ trạng thái. Không tính phân công chưa bắt đầu hoặc đã hủy là đã phỏng vấn.
- Cuối trang có Xuất PDF toàn bộ S12 / Xuất Excel toàn bộ S12. File xuất lấy lại
  toàn mùa, không bị thu hẹp bởi bộ lọc tìm kiếm trên màn hình.
- Nút tải application PDF/CSV dùng lại chức năng sẵn có cho BTC/Support.

## Quyền và dữ liệu

- Core/Admin/Support có quyền đọc mùa được xem phiếu và ghi chú BTC; reviewer
  chỉ xem phiếu của chính mình, mở application qua đường `/reviews/<id>` đã có
  cổng ownership, không có nút xem dữ liệu hồ sơ ngoài phạm vi.
- Xuất toàn mùa chỉ Core/Admin/Super Admin có quyền operations/full_access ở
  S12, theo cổng xuất review hiện có. Support được đọc nhưng không mở quyền xuất
  hàng loạt mới cho Support; reviewer không xuất toàn mùa.
- Route download xác minh quyền lại ở server, không dựa vào nút bị ẩn; header
  private/no-store, nosniff và no-referrer. Lỗi đọc trả lỗi, không xuất file thiếu.
- Đọc đủ mọi trang; lọc season/role/round và ownership ở database trên từng trang.
  Ghi chú quyết định chỉ lấy cho application đã được phép đọc.
- XLSX thật (OOXML qua PizZip đã có), không thêm thư viện. Giá trị text dùng
  inlineStr để ghi chú không thành công thức Excel và số điện thoại giữ số 0.
  Ghi chú vượt giới hạn ô được nối sang dòng sau thay vì cắt mất nội dung.
- PDF dùng pdfmake đã có, font Roboto tiếng Việt; nhận xét dài chảy qua nhiều trang.

## Kiểm chứng

- `npm run typecheck`: đạt.
- `npm run lint`: đạt.
- `npx vitest run`: 7.954 đạt, 14 skipped, không thất bại.
- `npm run build`: đạt, gồm trang kết quả và route tải PDF/XLSX.
- 15 test mới: hồi quy hồ sơ rớt/duyệt/waitlist, phân trang với cap 1, lọc đúng
  S12/mentor/interview, ownership, scope và lỗi đọc, link application, nút xuất
  toàn mùa không theo bộ lọc, XLSX không chạy công thức, ghi chú dài, PDF và
  route download xác minh quyền.
- Mutation tests: tái đưa bộ lọc trạng thái làm mất hồ sơ, bỏ ownership, bỏ
  nhận xét khỏi file, bỏ quyền operations khi xuất → test đỏ. Đã khôi phục mã
  và chạy lại toàn bộ xanh.
- PDF mẫu bằng dữ liệu giả đã render và xem cả 2 trang; phần cuối nhận xét và
  ghi chú BTC còn đủ. XLSX được mở lại bằng openpyxl, kiểm đúng 20 cột, SĐT và
  ghi chú. Không đọc hay xuất hồ sơ production để kiểm thử.

## Bàn giao triển khai

- Nhánh `feat/mentor-interview-results` đã tách độc lập trên `origin/main`.
  Chủ dự án đã cho phép push, mở PR và merge; PR #170 vẫn riêng.
- Phần kết quả mentor này không thêm bảng/RPC/migration và không gửi mail.
- PR dùng base `main`, không mang mã mentee offline vào.
- Chưa triển khai phần mentor mới; phải merge/deploy rồi mới hướng dẫn team dùng
  đường dẫn production. Cần kiểm lại bằng tài khoản BTC, Support và interviewer
  thật đúng phạm vi sau deploy.
