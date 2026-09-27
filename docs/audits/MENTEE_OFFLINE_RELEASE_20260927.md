# Phỏng vấn mentee offline — bàn giao 27/09/2026

## Điều chỉnh kế hoạch gửi — chốt cuối 27/09

Chờ ngày 28/09 có địa chỉ chính xác để đưa vào email mời và trang đặt ca. Ngày 28/09
chủ chương trình sẽ giao lệnh cho hệ thống gửi đồng loạt đến danh sách đã duyệt;
Support không cần vào CRM bấm gửi. Chưa lên lịch tự gửi và chưa gửi thật.
Khi nhận lệnh cần hoàn tất triển khai, chuẩn bị đường gửi từ hệ thống, kiểm mẫu thư
có địa chỉ và đối chiếu danh sách/hạn mức. Mã hiện có vẫn là bộ gửi theo lô trong CRM;
việc sửa hướng dẫn này không đồng nghĩa đã triển khai một bộ gửi tự động mới.

Bản PDF Support đã chuyển thành kế hoạch rà soát và mẫu thư dự kiến có ô chờ địa chỉ,
không còn in hướng dẫn bấm gửi thủ công hay khẳng định đó là email đang gửi thật.

## Hành vi

- 03–04/10, 24 ca × 30 phút × tối đa 25 mentee: 5 phòng × 5 mentor mỗi phòng.
- Giữ nguyên RPC giữ/đổi ca có khóa hàng. Giới hạn cấu hình giảm từ 300 xuống 25.
- Chọn/đổi ca xác nhận ngay trên link riêng, hiện QR và tải PNG; không gọi gửi email xác nhận.
- QR dùng token ngẫu nhiên riêng, không chứa link quản lý lịch hoặc thông tin cá nhân.
- `/interviews/mentee-offline`: lọc ca, tìm tên/SĐT (kể cả +84), camera QR, xác nhận check-in, phân phòng/bàn/interviewer.
- Support/Core và interviewer được cấp quyền mùa xem application và điểm/nhận xét hồ sơ.
- Người được phân chấm đủ 5 điểm 1–5, ghi nhận xét, chốt đạt/không chọn/cần BTC xem thêm. Hai kết quả sau cần lý do.
- Nhận mentee là chốt đạt và ghép chính mentor đang đăng nhập. Ghi kết quả, membership, match và audit trong một transaction.
- Chặn vượt capacity mentor cả khi ghép từ màn Matching cũ ở S12. Sửa kết quả cần lý do; bỏ nhận sẽ hủy match do lượt đó tạo, hoàn suất. Không hủy match/membership từ luồng khác.
- Không sửa phiếu offline từ màn review cũ; màn cũ có link mở đúng hồ sơ offline. Chặn đổi ca sau check-in.
- Chưa gửi email kết quả. Bộ gửi thư mời giữ hạn mức 300/24h, chừa 80 cho các thư hệ thống khác.

## Triển khai — bắt buộc trước merge

Chưa chạy migration hay gửi thư thật trong phiên này. Theo CLAUDE.md, merge main tự deploy nhưng không tự chạy SQL.

1. Kiểm tra đúng Supabase Production VAM `qkkroesfiazsejkzflcd` (không dùng project CRM cấu hình sẵn trong MCP).
2. Chạy toàn bộ `supabase/migrations/20260927090000_mentee_offline_workflow.sql` bằng SQL Editor; transaction có self-check và lock_timeout 10s. Nếu lỗi, rollback toàn bộ và xử lý nguyên nhân, không chạy nửa file.
3. Kiểm tra các ca S12 vẫn 25 ghế, địa điểm đã điền, interviewer được cấp vai trò/phạm vi mùa và có hồ sơ mentor được duyệt với capacity đúng. Migration không cấp quyền, không thay địa điểm, không mở thêm ca.
4. Xem trước mẫu `mentee_session_invite` trong Mail → Thư tự động. Nếu BTC đã lưu mẫu riêng thì mẫu đó ưu tiên hơn mặc định; sửa câu cũ về email xác nhận thành xác nhận/QR tại trang trước khi gửi đợt mới.
5. Sau khi SQL thành công mới merge PR. UAT bằng tài khoản thử có quyền mùa: đặt ca, tải QR, quét trên điện thoại HTTPS, check-in SĐT, phân bàn, chốt đạt/nhận mentee, sửa và kiểm log/hoàn suất. Không dùng hồ sơ thật cho UAT tạo match.

## Kiểm thử

- PostgreSQL PGlite thực thi nguyên migration mới với DDL reviews/memberships/sessions và helper quyền lấy từ migration thật; phần foundation predating migrations dùng fixture tối thiểu.
- 12 ca database: quyền mùa, ACL anon/authenticated, QR khác token quản lý, check-in lặp, khóa đổi ca, trần 25, phòng/bàn/interviewer, chống ghi phiên bản cũ, điểm/lý do, rollback khi đầy, ghép/hoàn/reactivate, audit, reuse review và chặn sửa ngoài luồng.
- 5 ca UI và 2 ca QR; ảnh PNG thực tế được giải mã bằng chính jsQR của màn quét. 5 ca booking đảm bảo không gửi email thứ hai.
- Bốn cổng đều đạt: typecheck, lint, toàn bộ suite 7.963 đạt/14 bỏ qua (các bài kiểm tra cần môi trường riêng đã có sẵn), và production build.
- Mutation: bỏ chặn capacity, bỏ chặn người được phân, bỏ revision, mở nút khi full, gửi lại email xác nhận, đổi QR prefix: test đỏ đúng lỗi; đã khôi phục mã và chạy xanh.
- PDF hướng dẫn 2 trang đã render và xem cả hai trang.

Giới hạn bằng chứng: PGlite chạy truy vấn tuần tự, không thay thế thử nhiều thiết bị/kết nối đồng thời trên staging. Chưa kiểm camera bằng điện thoại thật hoặc chạy migration trên production. Có khóa transaction và optimistic revision; cần UAT thiết bị sau deploy.

## Vận hành

- Bấm Làm mới danh sách để lấy cập nhật từ thiết bị khác; nếu báo dữ liệu đã đổi thì tải lại trước khi lưu.
- Camera bị từ chối thì cho phép camera hoặc tìm SĐT; thao tác quét chỉ tra vé, Support xác nhận check-in sau khi đối chiếu danh tính.
- Sau khi đã chấm, giữ nguyên người phỏng vấn; chính người này sửa kết quả và ghi lý do. Tranh chấp danh tính, membership hoặc match từ luồng khác báo BTC xử lý.
- Audit lưu đầy đủ trong database; giao diện hiển thị 200 thao tác gần nhất.
