# VAM OS — Tài liệu giới thiệu & Hướng dẫn sử dụng cho Team Test

**Cổng quản trị dữ liệu và vận hành Vietnam Alumni Mentoring**

---

| Thông tin | Nội dung |
|-----------|----------|
| Phiên bản | Draft for Team Testing |
| Ngày | 05/05/2026 |
| Chuẩn bị cho | VAM Core Team, Support Team, Reviewers, Interviewers |
| Chuẩn bị bởi | VAM OS Project Team |

---

## Mục lục

1. VAM OS là gì?
2. Ai sẽ dùng VAM OS?
3. Tài khoản test và nguyên tắc đăng nhập
4. Tổng quan các màn hình chính
5. Flow 1 — Mentor/Mentee nộp application
6. Flow 2 — Assign reviewer và review hồ sơ
7. Flow 3 — Admin ra quyết định (Decision)
8. Flow 4 — Phỏng vấn tự nhận (Interview Self-Claim)
9. Flow 5 — Duyệt thành Mentor/Mentee chính thức
10. Flow 6 — Events & Điểm danh
11. Flow 7 — Ghép cặp thủ công (Manual Matching)
12. Flow 8 — Dashboard & Theo dõi recap mentoring
13. Checklist kiểm thử theo vai trò
14. Hướng dẫn báo lỗi
15. Giới hạn đã biết (Không phải lỗi)
16. Phụ lục A — Các giá trị enum trong hệ thống
17. Phụ lục B — Danh sách màn hình cần chụp

---

## 1. VAM OS là gì?

VAM OS (Vietnam Alumni Mentoring Operating System) là **cổng vận hành nội bộ** dành cho đội ngũ VAM, giúp quản lý toàn bộ vòng đời của chương trình mentoring — từ tiếp nhận hồ sơ, xét duyệt, phỏng vấn, duyệt hồ sơ chính thức, điểm danh sự kiện, ghép cặp mentor–mentee, đến theo dõi recap hàng tháng và dashboard vận hành.

### Tại sao cần VAM OS?

Trước đây, nhiều thông tin được lưu rải rác trên Google Sheet, Zalo, email và file Excel. VAM OS tập trung dữ liệu về một nơi, giúp:

- **Giảm công việc thủ công** — không cần copy/paste giữa nhiều file.
- **Giảm thất thoát thông tin** — lịch sử đầy đủ, có audit trail.
- **Minh bạch hơn** — mọi người trong team thấy được trạng thái thực tế.
- **Vận hành nhất quán hơn** — cùng quy trình, cùng tiêu chuẩn mỗi mùa.

### Tình trạng hiện tại

- Hệ thống **đã được xây dựng xong phần core**.
- Hiện đang trong giai đoạn **kiểm thử có kiểm soát (controlled pilot)**.
- **Cần phản hồi từ team** trước khi sử dụng chính thức cho Season 12.
- Dữ liệu Season 11 được giữ lại để tham chiếu vận hành và dashboard.

**Link vào hệ thống:** https://vam-os-admin-portal.vercel.app

**Link form pilot công khai:**
- Mentor đăng ký: https://vam-os-admin-portal.vercel.app/apply/mentor?token=s12pilot
- Mentee đăng ký: https://vam-os-admin-portal.vercel.app/apply/mentee?token=s12pilot

---

## 2. Ai sẽ dùng VAM OS?

| Vai trò | Người dùng | Mục đích chính | Các trang chính |
|---------|-----------|----------------|-----------------|
| **Super Admin** | Ban quản trị hệ thống | Quản lý tài khoản, phân quyền, cấu hình hệ thống | `/admin/users`, toàn bộ hệ thống |
| **Admin / Core Team** | Core Team VAM | Xem và xử lý hồ sơ, giao reviewer, ra quyết định, duyệt profile, quản lý sự kiện, ghép cặp, theo dõi dashboard | Tất cả trang |
| **Reviewer** | Thành viên được giao xét hồ sơ | Chấm điểm tiêu chí, chọn đề xuất kết quả, nộp nhận xét | `/reviews`, `/reviews/[id]` |
| **Interviewer** | Người phỏng vấn | Tự nhận ứng viên cần phỏng vấn, điền form phỏng vấn, nộp kết quả | `/interviews` |
| **Support Team** | Đội hỗ trợ vận hành | Hỗ trợ kiểm tra hồ sơ, điểm danh sự kiện, làm sạch dữ liệu vận hành (tùy quyền được cấp) | `/events`, `/applications` (xem) |
| **Viewer** | Quan sát viên, báo cáo | Xem dashboard, báo cáo — **không chỉnh sửa dữ liệu** | `/`, `/operations` |

> **Lưu ý quan trọng:** Mỗi người dùng cần có tài khoản riêng với email của mình. Không dùng tài khoản chung để tránh nhầm lẫn khi tra cứu lịch sử.

---

## 3. Tài khoản test và nguyên tắc đăng nhập

### Cách nhận tài khoản

Mỗi thành viên sẽ nhận được **email mời hoặc email đặt lại mật khẩu** từ hệ thống (gửi qua Supabase Auth).

> **Lưu ý:** Link trong email có thể hết hạn sau vài phút hoặc vài giờ. Hãy mở ngay khi nhận được.

### Quy trình đặt mật khẩu lần đầu

| Bước | Hành động |
|------|-----------|
| 1 | Admin gửi email khôi phục / mời từ hệ thống |
| 2 | Người dùng mở **email mới nhất** (tìm từ địa chỉ noreply@...) |
| 3 | Click vào link trong email → hệ thống mở trang `/reset-password` |
| 4 | Nhập mật khẩu mới và xác nhận (tối thiểu 8 ký tự) |
| 5 | Click **"Đặt lại mật khẩu"** → hệ thống xác nhận thành công |
| 6 | Quay lại https://vam-os-admin-portal.vercel.app và đăng nhập bình thường |

[Screenshot: Reset password page]

### Xử lý sự cố đăng nhập

| Vấn đề | Cách xử lý |
|--------|-----------|
| Link expired / OTP hết hạn | Báo admin để gửi lại email khôi phục |
| Link mở ra localhost hoặc trang lạ | Báo admin — có thể cần kiểm tra cấu hình môi trường |
| Đăng nhập được nhưng thấy "Không có quyền truy cập" | Báo admin kiểm tra role và trạng thái account |
| Quên mật khẩu | Báo admin để reset |

---

## 4. Tổng quan các màn hình chính

### 4.1 Dashboard `/`

**Mục đích:** Tổng quan nhanh tình trạng vận hành mentoring.

**Ai dùng:** Admin, Core Team, Viewer.

**Thông tin hiển thị:**
- Số recap tháng này
- Mentee active tháng này / Mentor active tháng này
- Mentee active tháng đã đóng
- Số mentor/mentee chưa có recap tháng gần nhất
- Im lặng 2 tháng liên tiếp / cần follow-up

> **Lưu ý Season 11:** Dashboard hiển thị dữ liệu đã được chuẩn hóa trong DB. Một phần gap recap Season 11 còn lại do dữ liệu lịch sử không thể tự động map (recap qua Zalo, thiếu mã mentee, không map được với match). Đây không phải lỗi hệ thống.

[Screenshot: Dashboard page]

---

### 4.2 Danh sách hồ sơ `/applications`

**Mục đích:** Xem tất cả hồ sơ đăng ký Mentor/Mentee.

**Ai dùng:** Admin, Core Team, Support Team.

**Tính năng:**
- Lọc theo batch, loại hồ sơ (mentor/mentee), trạng thái
- Xem tên, email, trạng thái hiện tại
- Mở chi tiết từng hồ sơ

[Screenshot: Applications list]

---

### 4.3 Chi tiết hồ sơ `/applications/[id]`

**Mục đích:** Xem đầy đủ thông tin hồ sơ, lịch sử xét duyệt, và thực hiện các hành động.

**Ai dùng:** Admin, Core Team.

**Tính năng:**
- Xem raw data từ form đăng ký
- **Giao reviewer** (assign reviewer)
- Xem lịch sử review
- **Ra quyết định** (admin decision)
- **Duyệt thành mentor/mentee chính thức**

[Screenshot: Application detail and assign reviewer]

---

### 4.4 Danh sách review `/reviews`

**Mục đích:** Reviewer xem danh sách review được giao. Admin theo dõi tiến độ.

**Ai dùng:** Reviewer, Admin.

**Tính năng:**
- Reviewer thấy review của mình
- Lọc theo trạng thái (assigned, in_progress, submitted)
- Xem hạn chót nếu có

[Screenshot: Reviews list]

---

### 4.5 Form review `/reviews/[id]`

**Mục đích:** Reviewer chấm điểm và nộp nhận xét về ứng viên.

**Ai dùng:** Reviewer, Interviewer.

**5 tiêu chí chấm điểm (1–5 điểm mỗi tiêu chí):**

| Tiêu chí | Ý nghĩa |
|----------|---------|
| Động lực (Motivation) | Mức độ nhiệt tình và lý do tham gia |
| Rõ ràng mục tiêu (Goal Clarity) | Ứng viên biết mình muốn gì |
| Cam kết (Commitment) | Sẵn sàng dành thời gian và nỗ lực |
| Phù hợp chương trình (Fit) | Hồ sơ phù hợp với tiêu chí VAM |
| Giao tiếp (Communication) | Cách diễn đạt, viết lách |

**Đề xuất kết quả (vòng hồ sơ):**
- Mời vào vòng phỏng vấn
- Đưa vào danh sách chờ
- Không phù hợp / từ chối
- Cần core team/admin xem thêm

**Đề xuất kết quả (vòng phỏng vấn):**
- Đề xuất duyệt
- Danh sách chờ
- Không phù hợp / từ chối
- Cần core team xem thêm

> Reviewer có thể **Lưu nháp** nhiều lần trước khi **Nộp Review** chính thức. Sau khi nộp, form chuyển sang chế độ chỉ đọc.

[Screenshot: Review form]

---

### 4.6 Giao reviewer hàng loạt `/reviews/assign-bulk`

**Mục đích:** Admin/Core Team giao nhiều hồ sơ cho reviewer cùng lúc.

**Ai dùng:** Admin, Core Team.

> Dùng cẩn thận — nên kiểm tra kỹ danh sách trước khi giao loạt.

---

### 4.7 Tiến độ review `/reviews/progress`

**Mục đích:** Admin theo dõi reviewer nào đã nộp, ai còn đang làm.

**Ai dùng:** Admin, Core Team.

---

### 4.8 Reviewer pool `/reviews/reviewer-pool`

**Mục đích:** Admin kích hoạt tài khoản mentor thành reviewer.

**Ai dùng:** Admin, Super Admin.

> Chỉ kích hoạt tài khoản có email thực. Không dùng email test chung.

---

### 4.9 Phỏng vấn `/interviews`

**Mục đích:** Interviewer tự nhận ứng viên cần phỏng vấn và nộp kết quả.

**Ai dùng:** Interviewer, Admin.

**Trạng thái ứng viên trong luồng phỏng vấn:**

| Trạng thái | Ý nghĩa |
|-----------|---------|
| Đã mời PV (`invited_to_interview`) | Đã được admin mời, chờ interviewer nhận |
| Đã lên lịch (`interview_scheduled`) | Đã có lịch hẹn |
| Đang PV (`interview_in_progress`) | Đang trong quá trình phỏng vấn |
| Đã hoàn thành (`interview_completed`) | Phỏng vấn xong, có kết quả |

[Screenshot: Interviews page]

> **Lưu ý:** Module phỏng vấn vẫn đang được kiểm thử thêm. Báo cáo nếu gặp xung đột khi hai người cùng nhận một ứng viên.

---

### 4.10 Sự kiện `/events`

**Mục đích:** Quản lý danh sách sự kiện của chương trình.

**Ai dùng:** Admin, Core Team, Support Team.

**Tính năng:**
- Tạo mới / chỉnh sửa / hủy sự kiện
- Lọc theo mùa, loại, batch, trạng thái
- Xem danh sách người tham dự

[Screenshot: Events list]

---

### 4.11 Điểm danh sự kiện `/events/[id]/attendance`

**Mục đích:** Quản lý và cập nhật điểm danh từng sự kiện.

**Ai dùng:** Admin, Core Team, Support Team.

**Tính năng:**
- Thêm người tham dự thủ công
- Thêm hàng loạt từ danh sách mentor/mentee đã duyệt
- Đánh dấu: **Đã tham dự** / **Vắng** / **Walk-in** / **Chưa cập nhật**

[Screenshot: Events attendance]

---

### 4.12 Ghép cặp `/matches`

**Mục đích:** Tạo và quản lý cặp mentor–mentee.

**Ai dùng:** Admin, Core Team.

**Tính năng:**
- Chọn mentor và mentee để ghép cặp
- Lọc theo batch
- Hủy/vô hiệu hóa cặp đã ghép

**Nguyên tắc ghép:**
- Mỗi mentor: mặc định tối đa **3 mentee active** đồng thời
- Mỗi mentee: tối đa **1 cặp active** cùng lúc
- Cặp bị hủy: status = `dropped`, ghi nhận lý do

[Screenshot: Matches page]

---

### 4.13 Danh sách Mentor `/mentors`

**Mục đích:** Xem và lọc danh sách mentor đã được duyệt.

**Ai dùng:** Admin, Core Team.

[Screenshot: Mentors list]

---

### 4.14 Danh sách Mentee `/mentees`

**Mục đích:** Xem và lọc danh sách mentee đã được duyệt.

**Ai dùng:** Admin, Core Team.

[Screenshot: Mentees list]

---

### 4.15 Quản lý tài khoản người dùng `/admin/users`

**Mục đích:** Tạo, chỉnh sửa, phân quyền tài khoản admin.

**Ai dùng:** **Chỉ Super Admin**.

**Các vai trò có thể cấp:**
- `super_admin` — toàn quyền
- `admin` — quyền vận hành đầy đủ
- `reviewer` — chỉ xem và nộp review
- `viewer` — chỉ xem, không chỉnh sửa

[Screenshot: Admin users page]

---

## 5. Flow 1 — Mentor/Mentee nộp application

### Dành cho: Người đăng ký (Mentor hoặc Mentee)

**Bước thực hiện:**

| Bước | Hành động | Người thực hiện |
|------|-----------|----------------|
| 1 | Mở link form đăng ký (Mentor hoặc Mentee) | Ứng viên |
| 2 | Điền đầy đủ thông tin trong form | Ứng viên |
| 3 | Submit form | Ứng viên |
| 4 | Hệ thống chuyển sang trang cảm ơn (`/apply/thanks`) | Hệ thống |
| 5 | Admin vào `/applications` để thấy hồ sơ mới | Admin |

**Link form pilot:**
- Mentor: https://vam-os-admin-portal.vercel.app/apply/mentor?token=s12pilot
- Mentee: https://vam-os-admin-portal.vercel.app/apply/mentee?token=s12pilot

### Checklist kiểm tra sau khi nộp form:

- [ ] Tên và email xuất hiện đúng trong `/applications`
- [ ] Loại hồ sơ (mentor/mentee) hiển thị chính xác
- [ ] Trạng thái ban đầu là `submitted` hoặc `pending_review`
- [ ] Raw data / payload hồ sơ có thể xem được trong chi tiết
- [ ] Không tạo ngay mentor/mentee profile chính thức — chỉ tạo application record

> **Quan trọng:** Việc nộp form chỉ tạo `application record`. Hồ sơ mentor/mentee chính thức chỉ được tạo sau khi admin duyệt ở bước cuối.

---

## 6. Flow 2 — Assign reviewer và review hồ sơ

### Dành cho: Admin/Core Team (giao việc) + Reviewer (làm việc)

**Phần Admin/Core Team:**

| Bước | Hành động |
|------|-----------|
| 1 | Vào `/applications` |
| 2 | Mở chi tiết hồ sơ cần giao |
| 3 | Chọn reviewer từ dropdown và giao |
| 4 | Hệ thống tạo review task cho reviewer |

**Phần Reviewer:**

| Bước | Hành động |
|------|-----------|
| 1 | Đăng nhập vào hệ thống |
| 2 | Vào `/reviews` |
| 3 | Thấy danh sách review được giao |
| 4 | Mở từng review |
| 5 | Chấm điểm 5 tiêu chí (1–5) |
| 6 | Chọn đề xuất kết quả |
| 7 | Viết ghi chú nhận xét (nếu có) |
| 8 | Click **"Lưu nháp"** để lưu tạm / **"Nộp Review"** khi hoàn thành |

[Screenshot: Review form]

### Checklist kiểm tra:

- [ ] Reviewer chỉ thấy review được giao cho mình
- [ ] Điểm số lưu đúng sau khi nộp
- [ ] Đề xuất kết quả lưu đúng
- [ ] Lịch sử review xuất hiện trong trang chi tiết hồ sơ
- [ ] Trạng thái review cập nhật từ `assigned` → `submitted` sau khi nộp
- [ ] Form chuyển sang chỉ đọc sau khi nộp (không sửa được nữa)

---

## 7. Flow 3 — Admin ra quyết định (Decision)

### Dành cho: Admin / Core Team

Sau khi reviewer nộp kết quả, admin đọc nhận xét và ra quyết định chính thức.

**Bước thực hiện:**

| Bước | Hành động |
|------|-----------|
| 1 | Vào `/applications` → mở hồ sơ đã được review |
| 2 | Đọc điểm và nhận xét từ reviewer |
| 3 | Chọn quyết định: |
|   | • **Mời phỏng vấn** (`invited_to_interview`) |
|   | • **Danh sách chờ** (`waitlist`) |
|   | • **Từ chối** (`rejected`) |
|   | • **Cần xem thêm** (`needs_more_review`) |
| 4 | Lưu quyết định |
| 5 | Kiểm tra lịch sử quyết định trong trang chi tiết |

### Checklist kiểm tra:

- [ ] Quyết định được lưu thành công
- [ ] Trạng thái hồ sơ cập nhật đúng
- [ ] Lịch sử quyết định hiển thị đầy đủ
- [ ] Không có row quyết định bị trùng (trừ khi cố ý thêm)

---

## 8. Flow 4 — Phỏng vấn tự nhận (Interview Self-Claim)

### Dành cho: Interviewer

**Bước thực hiện:**

| Bước | Hành động |
|------|-----------|
| 1 | Đăng nhập vào hệ thống |
| 2 | Vào `/interviews` |
| 3 | Chọn batch cần phỏng vấn |
| 4 | Tìm ứng viên có trạng thái `invited_to_interview` |
| 5 | Click **"Bắt đầu phỏng vấn"** |
| 6 | Hệ thống tạo interview review cho interviewer đó |
| 7 | Hoàn thành form phỏng vấn (chấm điểm + ghi chú) |
| 8 | Click **"Nộp Review"** |

### Checklist kiểm tra:

- [ ] Ứng viên có thể được nhận (`claim`)
- [ ] Sau khi nhận, hệ thống tạo review với `review_round = interview`
- [ ] Điểm số và ghi chú được lưu đúng
- [ ] Trạng thái ứng viên chuyển thành `interview_completed` sau khi nộp
- [ ] Kiểm tra: hai interviewer cùng claim một ứng viên có xảy ra xung đột không

> **Cảnh báo:** Module phỏng vấn đang được kiểm thử thêm. Nếu gặp xung đột hoặc lỗi khi nhận ứng viên, hãy báo ngay cho team và không thực hiện thêm bất kỳ thao tác nào.

---

## 9. Flow 5 — Duyệt thành Mentor/Mentee chính thức

### Dành cho: Admin / Core Team

Khi ứng viên đã qua đủ các vòng, admin duyệt tạo profile chính thức.

**Bước thực hiện:**

| Bước | Hành động |
|------|-----------|
| 1 | Vào chi tiết hồ sơ (`/applications/[id]`) |
| 2 | Xác nhận ứng viên đã qua review và phỏng vấn (nếu cần) |
| 3 | Click **"Duyệt thành Mentor"** hoặc **"Duyệt thành Mentee"** |
| 4 | Hệ thống tạo hoặc tái sử dụng bản ghi `person` |
| 5 | Hệ thống tạo `mentor_profiles` hoặc `mentee_profiles` |
| 6 | Trạng thái hồ sơ chuyển thành `approved_as_mentor` / `approved_as_mentee` |

### Checklist kiểm tra:

- [ ] Không tạo `person` trùng lặp cho cùng email
- [ ] Không tạo `mentor_profile` / `mentee_profile` trùng lặp
- [ ] Profile mới liên kết ngược về hồ sơ application gốc
- [ ] Intake batch được gắn đúng vào profile
- [ ] Mentor mới xuất hiện trong `/mentors` / Mentee mới xuất hiện trong `/mentees`

---

## 10. Flow 6 — Events & Điểm danh

### Dành cho: Admin, Core Team, Support Team

**Bước thực hiện:**

| Bước | Hành động |
|------|-----------|
| 1 | Vào `/events` |
| 2 | Tạo sự kiện mới hoặc mở sự kiện có sẵn |
| 3 | Vào trang điểm danh của sự kiện |
| 4 | Thêm người tham dự thủ công hoặc thêm hàng loạt từ danh sách đã duyệt |
| 5 | Đánh dấu trạng thái điểm danh cho từng người |
| 6 | Kiểm tra thống kê số lượng trên KPI card |

**Trạng thái điểm danh:**

| Trạng thái | Ý nghĩa |
|-----------|---------|
| Đã tham dự | Đến và tham gia sự kiện |
| Vắng | Đã đăng ký nhưng không đến |
| Walk-in | Đến mà không có trong danh sách trước |
| Chưa cập nhật | Chưa biết, cần cập nhật sau |

**Loại sự kiện hợp lệ trong hệ thống:**

| Giá trị hệ thống | Tên hiển thị gợi ý |
|-----------------|-------------------|
| `orientation` | Orientation / Khai mạc |
| `training` | Training / Đào tạo |
| `networking` | Networking / Kickoff |
| `closing` | Closing / Tổng kết |
| `company_tour` | Company Tour |
| `business_case` | Business Case |
| `job_shadowing` | Job Shadowing |
| `other` | Khác |

> **Lưu ý:** Các loại như `kickoff`, `tong_ket`, `community`, `workshop` **không hợp lệ** trong hệ thống. Dùng giá trị tương đương ở bảng trên.

[Screenshot: Events attendance]

### Checklist kiểm tra:

- [ ] Sự kiện lưu thành công
- [ ] Điểm danh cập nhật đúng trạng thái
- [ ] Thêm hàng loạt không tạo người tham dự trùng
- [ ] KPI card cập nhật đúng số liệu

---

## 11. Flow 7 — Ghép cặp thủ công (Manual Matching)

### Dành cho: Admin / Core Team

**Bước thực hiện:**

| Bước | Hành động |
|------|-----------|
| 1 | Vào `/matches` |
| 2 | Chọn batch |
| 3 | Chọn mentor từ danh sách |
| 4 | Chọn mentee từ danh sách |
| 5 | Tạo cặp |
| 6 | Kiểm tra cặp mới xuất hiện trong danh sách |

**Để hủy cặp:**

| Bước | Hành động |
|------|-----------|
| 1 | Mở cặp cần hủy |
| 2 | Click hủy / vô hiệu hóa |
| 3 | Hệ thống cập nhật `status = dropped`, ghi `ended_at`, `end_reason` |

**Quy tắc ghép:**

| Quy tắc | Giá trị |
|---------|---------|
| Mentor: số mentee active tối đa | 3 |
| Mentee: số cặp active tối đa | 1 |
| Loại cặp mặc định | `primary` |
| Nguồn ghép | `manual` |
| Trạng thái cặp hủy | `dropped` |

[Screenshot: Matches page]

### Checklist kiểm tra:

- [ ] Ghép cặp thành công
- [ ] Mentee biến mất khỏi danh sách chưa ghép sau khi có cặp
- [ ] Load của mentor tăng lên (số mentee đang kèm)
- [ ] Hủy cặp thành công
- [ ] Mentee hiển thị lại trong danh sách chưa ghép sau khi hủy
- [ ] Load của mentor giảm xuống
- [ ] Cặp đã hủy hiển thị trong filter `dropped`

---

## 12. Flow 8 — Dashboard & Theo dõi recap mentoring

### Dành cho: Admin, Core Team, Viewer

Dashboard giúp team theo dõi mức độ hoạt động mentoring theo từng tháng.

**Các chỉ số chính:**

| Chỉ số | Ý nghĩa |
|--------|---------|
| Số recap tháng này | Số buổi mentoring đã có recap trong tháng đang chọn |
| Mentee active tháng này | Số mentee có ít nhất 1 recap trong tháng |
| Mentor active tháng này | Số mentor có ít nhất 1 recap trong tháng |
| Mentee active tháng đã đóng | Mentee active trong tháng chốt chính thức |
| Chưa có recap tháng gần nhất | Mentor đang active nhưng không có recap gần đây |
| Im lặng 2 tháng liên tiếp | Mentee không có recap 2 tháng liền → cần follow-up |

**Lưu ý về dữ liệu Season 11:**

> Dữ liệu recap Season 11 đã được backfill từ file tracking. DB hiện có **1.405 / 1.735** recap theo báo cáo tracking gốc. Phần chênh lệch (~330 recap) còn lại là do dữ liệu lịch sử không thể tự động khôi phục (recap qua Zalo, thiếu mã mentee, không map được match). Dashboard phản ánh dữ liệu đã được chuẩn hóa trong DB — **không cần lo lắng về số liệu chênh này**.

[Screenshot: Dashboard page]

---

## 13. Checklist kiểm thử theo vai trò

### Admin / Core Team

- [ ] Đăng nhập thành công
- [ ] Dashboard hiển thị đủ chỉ số
- [ ] Xem được danh sách hồ sơ
- [ ] Giao được reviewer cho hồ sơ
- [ ] Ra quyết định cho hồ sơ
- [ ] Duyệt được hồ sơ thành mentor/mentee chính thức
- [ ] Tạo/chỉnh sửa sự kiện
- [ ] Cập nhật điểm danh sự kiện
- [ ] Tạo và hủy cặp mentor–mentee

### Reviewer

- [ ] Đăng nhập thành công
- [ ] Thấy danh sách review được giao
- [ ] Mở và chấm điểm review
- [ ] Lưu nháp thành công
- [ ] Nộp review thành công
- [ ] Sau khi nộp: form chuyển sang chỉ đọc
- [ ] Không thấy/không vào được trang admin-only (nếu role bị giới hạn)

### Interviewer

- [ ] Đăng nhập thành công
- [ ] Mở được trang `/interviews`
- [ ] Chọn batch, tìm ứng viên
- [ ] Tự nhận ứng viên thành công
- [ ] Điền và nộp form phỏng vấn
- [ ] Trạng thái ứng viên cập nhật đúng sau khi nộp

### Support Team

- [ ] Đăng nhập thành công
- [ ] Truy cập được trang được phép
- [ ] Hỗ trợ điểm danh sự kiện (nếu được cấp quyền)
- [ ] Báo lỗi rõ ràng với screenshot khi gặp vấn đề

### Viewer

- [ ] Đăng nhập thành công
- [ ] Xem được dashboard
- [ ] Không chỉnh sửa được dữ liệu

---

## 14. Hướng dẫn báo lỗi

Khi gặp vấn đề, hãy điền đầy đủ thông tin theo mẫu dưới đây và gửi cho admin/team:

---

**MẪU BÁO LỖI**

**Tiêu đề lỗi:** *(Ví dụ: "Không nộp được review — form báo lỗi đỏ")*

**Trang / URL:** *(Dán link URL đầy đủ)*

**Tài khoản sử dụng:** *(Email đăng nhập)*

**Vai trò:** *(Admin / Reviewer / Interviewer / Support...)*

**Các bước tái hiện lỗi:**
1. Làm gì trước tiên
2. Làm gì tiếp theo
3. Lỗi xảy ra ở bước nào

**Kết quả mong đợi:** *(Hệ thống nên làm gì)*

**Kết quả thực tế:** *(Hệ thống thực sự làm gì / thông báo lỗi là gì)*

**Screenshot:** *(Bắt buộc — chụp màn hình đính kèm)*

**Thời điểm xảy ra:** *(Ngày giờ)*

**Lỗi có chặn công việc không?** Có / Không

**Ghi chú thêm:** *(Nếu có)*

---

> **Lưu ý:** Luôn kèm screenshot và email tài khoản khi báo lỗi. Điều này giúp team xử lý nhanh hơn nhiều.

---

## 15. Giới hạn đã biết (Không phải lỗi)

| Giới hạn | Giải thích |
|---------|-----------|
| Gap recap Season 11 sau backfill | Còn ~330 recap lịch sử chưa khôi phục được do thiếu dữ liệu nguồn (Zalo, thiếu mã mentee, v.v.). Đây là giới hạn lịch sử, không phải lỗi hệ thống. |
| Module phỏng vấn cần kiểm thử thêm | Luồng interview self-claim cần kiểm tra thêm về xung đột khi nhiều người cùng nhận ứng viên. |
| Giao reviewer hàng loạt | Cần kiểm thử kỹ trước khi sử dụng ở quy mô lớn. |
| Ghép cặp tự động | Chưa có — hiện chỉ hỗ trợ ghép thủ công. |
| Tự động gửi email cho ứng viên | Chưa hoàn thiện — hiện cần thông báo thủ công. |
| Dashboard chỉ phản ánh DB chuẩn hóa | Không phải toàn bộ dữ liệu raw tracking lịch sử. |
| Season 11 recap: 1.405 / 1.735 | Đây là con số sau backfill. Gap còn lại là cấu trúc — không thể tự động khôi phục thêm. |

---

## 16. Phụ lục A — Các giá trị enum trong hệ thống

Khi nhập dữ liệu vào hệ thống, hãy sử dụng đúng các giá trị sau:

### Loại sự kiện (`event_type`)

| Giá trị | Mô tả |
|---------|-------|
| `orientation` | Buổi khai mạc / orientation |
| `training` | Buổi đào tạo |
| `company_tour` | Tham quan công ty |
| `networking` | Networking / Kickoff |
| `closing` | Tổng kết / Closing |
| `business_case` | Business case |
| `job_shadowing` | Job shadowing |
| `other` | Loại khác |

### Giới tính (`gender_type`)

| Giá trị | Mô tả |
|---------|-------|
| `male` | Nam |
| `female` | Nữ |
| `other` | Khác |
| `undisclosed` | Không muốn tiết lộ |

### Loại cặp ghép (`match_type`)

| Giá trị | Mô tả |
|---------|-------|
| `primary` | Cặp chính thức (mặc định) |
| `cross` | Cặp cross-mentoring |
| `secondary` | Cặp phụ |

### Trạng thái cặp ghép (`match_status`)

| Giá trị | Mô tả |
|---------|-------|
| `active` | Đang hoạt động |
| `dropped` | Đã hủy / kết thúc sớm |
| `completed` | Hoàn thành theo kế hoạch |
| `unmatched_review` | Đang chờ xem xét lại |

---

## 17. Phụ lục B — Danh sách màn hình cần chụp

Dưới đây là danh sách screenshot cần thiết để hoàn thiện tài liệu. Sau khi có tài khoản test, hãy chụp và điền vào chỗ `[Screenshot: ...]` trong tài liệu:

| STT | Tên màn hình | URL | Ghi chú |
|-----|-------------|-----|---------|
| 1 | Trang đăng nhập | `/login` | Chụp form đăng nhập |
| 2 | Trang đặt lại mật khẩu | `/reset-password` | Chụp sau khi click link email |
| 3 | Dashboard | `/` | Chụp toàn bộ trang với KPI card |
| 4 | Danh sách hồ sơ | `/applications` | Chụp có filter và danh sách |
| 5 | Chi tiết hồ sơ | `/applications/[id]` | Chụp phần assign reviewer |
| 6 | Danh sách review | `/reviews` | Chụp với filter trạng thái |
| 7 | Form review | `/reviews/[id]` | Chụp 5 tiêu chí chấm điểm |
| 8 | Trang phỏng vấn | `/interviews` | Chụp danh sách ứng viên |
| 9 | Danh sách sự kiện | `/events` | Chụp với filter |
| 10 | Điểm danh sự kiện | `/events/[id]/attendance` | Chụp trang điểm danh đầy đủ |
| 11 | Danh sách cặp ghép | `/matches` | Chụp danh sách với cặp active |
| 12 | Danh sách mentor | `/mentors` | Chụp với filter batch |
| 13 | Danh sách mentee | `/mentees` | Chụp với filter batch |
| 14 | Quản lý tài khoản | `/admin/users` | Chụp danh sách user và role |

---

*Tài liệu này được chuẩn bị bởi VAM OS Project Team. Phiên bản: Draft for Team Testing. Ngày: 05/05/2026.*

*Mọi phản hồi và câu hỏi, vui lòng liên hệ trực tiếp với Anh Thắng hoặc team phát triển VAM OS.*
