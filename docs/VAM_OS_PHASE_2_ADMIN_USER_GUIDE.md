# VAM OS Phase 2 - Admin User Guide

Tài liệu này dành cho founder/core team, Ops Lead, Recap Steward, Event Steward và Data Quality Reviewer. Mục tiêu là giúp team đọc dashboard, theo dõi hoạt động mentoring/event, và xử lý dữ liệu cần rà soát một cách thống nhất.

## 1. Tổng quan VAM OS Phase 2

VAM OS Phase 2 là admin portal nội bộ để theo dõi vận hành mentoring Season 11. Hệ thống tập trung vào việc đọc dữ liệu, xem hoạt động, theo dõi recap, event participation pilot, và correction có audit trail cho mentoring recap.

Mục tiêu hệ thống:

- Giúp core team có một nơi xem tình hình vận hành theo tháng.
- Theo dõi recap mentoring, mentee/mentor active, event participation.
- Phát hiện dữ liệu cần rà soát như date/month outlier.
- Hỗ trợ correction an toàn, có ghi audit log.

Các module hiện có:

- Dashboard: tổng quan dữ liệu chính.
- Operations: dashboard vận hành theo tháng.
- People: danh sách và hồ sơ cá nhân.
- Mentors: danh sách mentor.
- Mentees: danh sách mentee.
- Applications: dữ liệu application hiện có.
- Matches: thông tin ghép mentor/mentee.
- Data Issues: cảnh báo chất lượng dữ liệu.
- Recap correction route: `/recaps/[id]/edit` để sửa giới hạn một số field của mentoring recap.

## 2. Cách đọc Operations Dashboard

### Month selector

Chọn tháng vận hành cần xem. Với Season 11, dashboard ưu tiên khung tháng vận hành `2025-10` đến `2026-06`. Các tháng bất thường do lỗi parsing nguồn sẽ không làm méo biểu đồ chính.

### Recap count

Số recap hợp lệ trong tháng đang chọn. Một recap tương ứng một buổi gặp mentor/mentee được ghi nhận.

### Mentee active

Số mentee có ít nhất một recap trong tháng.

### Mentor active

Số mentor có ít nhất một recap trong tháng.

### Mentee active rate

Tỷ lệ mentee active so với danh sách mentee đang active trong match.

### Mentor chưa có recap

Số mentor active nhưng chưa có recap trong tháng đang chọn. Đây là tín hiệu để rà follow-up.

### Event/training trong tháng

Số event/training có ngày trong tháng đang chọn.

### Lượt tham dự event

Số dòng event participation có trạng thái `attended`.

### Attendance rate

Tỷ lệ attendance = `attended / (attended + registered_absent)`.

### Feedback count

Hiện feedback module chưa triển khai, nên KPI này chỉ là placeholder.

### Mentee cần follow-up

Danh sách candidate dựa trên recap gần đây. Đây chưa phải workflow xử lý chính thức, chỉ là gợi ý vận hành.

### Recap theo tháng

Biểu đồ số recap theo tháng trong khung vận hành Season 11. Outlier month như `2005-11`, `2015-11`, `2026-12` được tách ra để rà soát.

### Mentee health

Chia mentee theo nhóm:

- Active tháng này.
- Silent 1 tháng.
- Silent 2+ tháng/cần follow-up.

### Top mentors

Danh sách mentor có nhiều recap trong tháng. Dùng để xem nhịp hoạt động và phát hiện mentor/mentee pair đang active tốt.

### Follow-up candidates

Danh sách mentee cần core team xem lại vì không có recap gần đây. Nên kiểm tra profile, match, mentor, recap link trước khi liên hệ.

### Recent recaps

Các recap gần đây trong tháng đang chọn, kèm link recap, loại meeting, nguồn capture và status.

### Recap cần rà soát ngày/tháng

Bảng các recap có `meeting_month` nằm ngoài khung vận hành hoặc invalid/null. Đây là nơi Data Quality Reviewer hoặc Recap Steward bấm `Sửa` nếu đã biết thông tin đúng.

## 3. Quy trình ghi nhận recap

Nguồn dữ liệu hiện tại:

- Tracking SS11.
- Facebook recap do mentee đăng.

Nguyên tắc:

- Một recap = một buổi gặp.
- Recap Steward nên ghi nhận recap trong vòng 48h sau khi phát hiện nguồn.
- Sweep Facebook mỗi thứ 2 để bắt các recap bị sót.
- Nếu chưa chắc dữ liệu đúng, ưu tiên đánh dấu cần rà soát thay vì sửa đoán.

Cách hiểu field:

- `recap_source`: nguồn recap, ví dụ Facebook hoặc Tracking SS11.
- `meeting_type`: loại buổi gặp nếu có, ví dụ mentoring/check-in/event-related.
- `captured_by`: người hoặc quy trình đã ghi nhận dữ liệu vào hệ thống.

## 4. Quy trình theo dõi mentee/mentor

### Profile mentee xem gì

- Thông tin cá nhân cơ bản.
- Mentee profile: mã mentee, trường, ngành, cohort.
- Mentor đang được ghép.
- Hoạt động mentoring.
- Hoạt động sự kiện.
- Link recap và trạng thái recap.

### Profile mentor xem gì

- Thông tin cá nhân cơ bản.
- Mentor profile: mã mentor, công ty, chức danh, kinh nghiệm.
- Danh sách mentee đang phụ trách.
- Hoạt động mentor.
- Hoạt động sự kiện nếu có.

### Hoạt động mentoring

Hiển thị các recap liên quan đến mentee: tháng, ngày gặp, mentor, link recap, ghi chú, issue, status.

### Hoạt động mentor

Hiển thị các recap liên quan đến mentor: tháng, ngày gặp, mentee, link recap, ghi chú, issue, status.

### Hoạt động sự kiện

Hiển thị event participation nếu người đó có dữ liệu event.

### Link recap

Dùng để mở recap gốc khi cần kiểm tra nội dung hoặc đối chiếu ngày/tháng.

### Khi nào cần follow-up

- Mentee không có recap trong tháng hiện tại và tháng trước.
- Mentor active nhưng không có recap với mentee.
- Recap có `issue_flag`.
- Status là `needs_review`, `invalid`, hoặc `duplicate`.
- Có dấu hiệu mismatch giữa recap note, date, mentor/mentee.

## 5. Quy trình correction workflow

### Khi nào bấm Sửa

Bấm `Sửa` khi:

- Recap có tháng/ngày outlier rõ ràng.
- Status cần chuyển sang `needs_review`, `invalid`, hoặc `duplicate`.
- Cần bật/tắt `issue_flag`.
- Cần bổ sung `admin_notes`.

### Field được phép sửa

- `meeting_date`
- `meeting_month`
- `status`
- `issue_flag`
- `admin_notes`

Nếu `meeting_date` thay đổi, hệ thống tự derive `meeting_month` theo định dạng `YYYY-MM`.

### Field không được sửa

- mentor
- mentee
- match
- `recap_url`

Nếu các field này sai, ghi `admin_notes` hoặc `needs_review`, sau đó xử lý bằng workflow dữ liệu riêng.

### Cách ghi reason

Reason nên ngắn, rõ, có nguồn đối chiếu nếu có.

Ví dụ:

- `Corrected meeting date based on Facebook recap post date.`
- `Marked needs_review because recap month is outside Season 11 range.`
- `Marked duplicate after comparing same recap_url.`

### Cách ghi corrected_by

Hiện chưa có Auth/RLS, nên `corrected_by` là text nhập thủ công. Tạm thời dùng tên ngắn hoặc `admin` theo quy ước team.

Sau khi có Supabase Auth, field này nên lấy từ user đăng nhập.

### Audit log là gì

Audit log là lịch sử correction. Mỗi field thay đổi tạo một dòng riêng trong `activity_correction_log`, gồm:

- field được sửa
- giá trị cũ
- giá trị mới
- reason
- corrected_by
- thời điểm tạo

### Ví dụ sửa outlier month

1. Vào Operations.
2. Tìm bảng “Recap cần rà soát ngày/tháng”.
3. Bấm `Sửa`.
4. Kiểm tra recap_url hoặc nguồn gốc.
5. Sửa `meeting_date` nếu biết ngày đúng.
6. Hệ thống tự cập nhật `meeting_month`.
7. Ghi reason, ví dụ `Corrected date from Facebook recap.`
8. Ghi `corrected_by`.
9. Lưu correction và kiểm tra audit log.

## 6. Quy trình event participation

Hiện event participation mới ở mức pilot. Không import full historical attendance nếu chưa có nguồn sign-in/registration đáng tin cậy.

Chỉ import từ nguồn:

- Form đăng ký chính thức.
- Danh sách check-in/sign-in.
- Nguồn được Event Steward xác nhận.

Trạng thái hiện dùng:

- `attended`: có tham dự.
- `registered_absent`: đăng ký nhưng không tham dự.

Event Phase 2:

- Mentee Orientation
- Kickoff
- Tổng kết

## 7. Data Issues

Data Issues giúp core team đọc cảnh báo chất lượng dữ liệu.

Cách đọc:

- Ưu tiên cảnh báo ảnh hưởng đến vận hành hiện tại.
- Kiểm tra link từ dashboard nếu có.
- Không sửa dữ liệu nếu chưa có nguồn xác nhận.

Dashboard warning links:

- Dùng để đi nhanh tới nhóm dữ liệu cần kiểm tra.
- Nếu cảnh báo liên quan profile, mở profile để đối chiếu.

Khi nào cần sửa profile data:

- Có nguồn chính thức xác nhận profile sai.
- Sai dữ liệu ảnh hưởng đến liên hệ hoặc phân công.

Khi nào chỉ cần ghi nhận `needs_review`:

- Chưa có nguồn xác nhận.
- Dữ liệu có dấu hiệu lạ nhưng chưa biết giá trị đúng.
- Cần founder/Ops Lead quyết định.

## 8. Vai trò vận hành

### Ops Lead

- Theo dõi Operations Dashboard hàng tuần/tháng.
- Điều phối Recap Steward, Event Steward, Data Quality Reviewer.
- Chốt danh sách cần follow-up.

### Recap Steward

- Sweep Facebook recap.
- Ghi nhận recap từ nguồn Tracking/Facebook.
- Rà outlier recap.
- Đề xuất correction khi có nguồn xác nhận.

### Event Steward

- Quản lý danh sách event Phase 2.
- Thu thập sign-in/registration.
- Chỉ chuẩn bị import attendance từ nguồn đáng tin cậy.

### Data Quality Reviewer

- Rà Data Issues.
- Rà outlier date/month.
- Đánh dấu `needs_review`, `invalid`, `duplicate` khi cần.

### Founder/Core team reviewer

- Xem dashboard định kỳ.
- Quyết định follow-up quan trọng.
- Chốt các case cần xử lý thủ công hoặc thay đổi quy trình.

## 9. Những điều chưa làm / giới hạn hiện tại

- Auth/RLS chưa triển khai.
- Password gate chỉ là tạm thời.
- Feedback chưa triển khai.
- Event attendance chưa import full.
- Follow-up chưa phải workflow xử lý chính thức.
- Correction workflow mới áp dụng cho `mentoring_recaps`, chưa áp dụng cho `event_participations`.

## 10. Checklist vận hành hàng tuần

- Thứ 2 sweep Facebook recap.
- Cập nhật recap/event nếu có nguồn đáng tin cậy.
- Rà Data Issues.
- Rà follow-up candidates trên Operations Dashboard.
- Rà correction log nếu có correction mới.
- Ghi lại các case cần Founder/Ops Lead quyết định.

## 11. Checklist vận hành hàng tháng

- Chốt số recap trong tháng.
- Xem active mentees/mentors.
- Xem silent/follow-up list.
- Gửi báo cáo ngắn cho core team.
- Chốt việc cần follow-up tháng sau.
- Rà event/training và attendance nếu có event trong tháng.
- Rà outlier recap còn tồn.

## 12. Appendix - Glossary

### active mentee

Mentee có hoạt động recap trong tháng hoặc đang thuộc match active, tùy ngữ cảnh KPI.

### active mentor

Mentor có hoạt động recap trong tháng hoặc đang thuộc match active, tùy ngữ cảnh KPI.

### valid recap

Recap có status phù hợp để tính vào vận hành, thường là `submitted` hoặc `needs_review`.

### issue_flag

Cờ đánh dấu recap cần theo dõi thêm.

### needs_review

Status cho dòng cần rà soát thủ công nhưng chưa kết luận sai.

### duplicate

Status cho dòng bị trùng hoặc nghi trùng.

### invalid

Status cho dòng không hợp lệ và không nên dùng như recap vận hành bình thường.

### captured_by

Người hoặc quy trình đã capture dữ liệu vào hệ thống.

### correction log

Audit trail ghi lại từng field đã được sửa, giá trị cũ/mới, lý do, người sửa và thời điểm sửa.
