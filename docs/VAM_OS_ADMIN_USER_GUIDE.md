# Hướng Dẫn Sử Dụng VAM OS Admin Portal MVP

## VAM OS Admin Portal là gì?

VAM OS Admin Portal là cổng quản trị nội bộ cho Vietnam Alumni Mentoring, hiện tập trung vào dữ liệu UEH Mentoring Season 11. Phiên bản MVP v0.1 giúp core team xem nhanh dữ liệu người tham gia, mentor, mentee, đơn ứng tuyển, match, hồ sơ cá nhân và các vấn đề dữ liệu cần rà soát.

Portal hiện chỉ dùng cho nội bộ. Đây chưa phải là portal công khai cho mentor hoặc mentee đăng nhập.

## Giới hạn hiện tại của MVP

- Chỉ đọc dữ liệu, chưa có chức năng chỉnh sửa trực tiếp.
- Chưa có đăng nhập.
- Chưa bật phân quyền hoặc RLS.
- Chưa có workflow xử lý data issues trong app.
- Chưa có portal riêng cho mentor/mentee.
- Một số dữ liệu lịch sử vẫn cần được rà soát và làm sạch thủ công.

## Sử dụng Dashboard

Vào trang `/` để xem tổng quan vận hành:

- Tổng thành viên, mentor, mentee, ứng tuyển, match.
- Tỷ lệ mentee đã có mentor.
- Tỷ lệ mentor đang hoạt động.
- Biểu đồ theo trường, trạng thái match, trạng thái ứng tuyển.
- Top mentor đang phụ trách nhiều mentee nhất.
- Các cảnh báo dữ liệu cần rà soát.

Các link trong phần cảnh báo có thể đưa core team tới trang liên quan để kiểm tra nhanh hơn.

## Tìm kiếm People, Mentors, Mentees

Trang `/people` dùng để tìm hồ sơ người tham gia theo tên, email hoặc số điện thoại.

Trang `/mentors` dùng để xem danh sách mentor:

- Tìm theo tên, email, công ty, chức danh.
- Lọc mentor đã có mentee hoặc chưa có mentee.
- Sắp xếp theo số mentee đang phụ trách.
- Mở profile link của mentor nếu có.

Trang `/mentees` dùng để xem danh sách mentee:

- Tìm theo tên, email, mentee code, MSSV, ngành học hoặc mentor.
- Lọc theo trường, trạng thái có mentor, trạng thái match, ngành học.
- Xem mentor hiện tại, match liên quan, và link tới mentor profile.

## Review Applications

Trang `/applications` là danh sách đơn ứng tuyển nhẹ, không tải toàn bộ câu trả lời dài.

Core team có thể:

- Tìm theo tên, email, SBD, mã đơn hoặc mã person.
- Lọc theo trạng thái, vai trò ứng tuyển, mùa, PDPA.
- Mở chi tiết từng đơn bằng “Xem chi tiết”.

Trang `/applications/[id]` hiển thị:

- Thông tin ứng viên.
- Tóm tắt đơn ứng tuyển.
- Câu trả lời ứng tuyển theo thứ tự dễ đọc.
- Câu trả lời dài có thể mở rộng/thu gọn.
- Hồ sơ mentor/mentee liên quan nếu có.
- Match liên quan nếu ứng viên là mentee đã được ghép.

## Review Matches

Trang `/matches` dùng để xem danh sách ghép cặp mentor - mentee.

Core team có thể:

- Tìm theo tên mentor hoặc mentee.
- Lọc theo trạng thái match và loại match.
- Mở chi tiết match.

Trang match detail hiển thị thông tin match, mentor, mentee và link profile mentor nếu có.

## Sử dụng Data Issues

Trang `/data-issues` giúp rà soát dữ liệu cần làm sạch. Ở MVP hiện tại, các vấn đề được tính động từ dữ liệu Supabase.

Các nhóm vấn đề gồm:

- People thiếu số điện thoại.
- Đơn ứng tuyển thiếu tên/email.
- Mentee cần rà soát trường học.
- Mentor thiếu profile link.
- Mentee chưa có mentor active.
- Match active lỗi.
- Email trùng.

Mỗi nhóm có thể mở/thu gọn và có link tới hồ sơ, đơn ứng tuyển hoặc match liên quan.

## Dữ liệu nào có thể tin cậy hiện tại?

Các bảng chính đã được import và đang dùng được cho MVP:

- People
- Mentor profiles
- Mentee profiles
- Applications
- Application answers theo từng đơn
- Matches
- Seasons

Dashboard KPI dùng exact count query nên không bị giới hạn 1000 dòng mặc định của Supabase.

## Dữ liệu nào vẫn nên làm sạch thủ công?

Core team nên tiếp tục rà soát:

- Hồ sơ thiếu số điện thoại.
- Mentee thiếu hoặc sai trường học.
- Mentor thiếu profile/bio link.
- Đơn ứng tuyển chưa gắn được đúng person.
- Mentee chưa có active mentor.
- Match active thiếu mentor hoặc mentee.
- Email trùng nếu có.

## Không nên làm gì ở giai đoạn này?

- Không chia sẻ public URL rộng rãi.
- Không nhập service role key vào frontend.
- Không xem app này như portal chính thức cho mentor/mentee.
- Không kỳ vọng có chỉnh sửa dữ liệu trực tiếp trong app.
- Không bật auth/RLS khi chưa có thiết kế phân quyền rõ ràng.

## Nhắc lại

VAM OS Admin Portal MVP v0.1 là công cụ nội bộ, read-only, phục vụ review dữ liệu và vận hành ban đầu. Portal công khai cho mentor/mentee sẽ thuộc giai đoạn sau.
