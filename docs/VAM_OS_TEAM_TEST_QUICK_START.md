# VAM OS — Quick Start cho Team Test

**Phiên bản:** Draft for Team Testing &nbsp;|&nbsp; **Ngày:** 05/05/2026 &nbsp;|&nbsp; Xem hướng dẫn đầy đủ: `VAM_OS_TEAM_TEST_GUIDE.md`

---

## 1. Đăng nhập

| | |
|---|---|
| **Hệ thống** | https://vam-os-admin-portal.vercel.app |
| **Form đăng ký Mentor** | https://vam-os-admin-portal.vercel.app/apply/mentor?token=s12pilot |
| **Form đăng ký Mentee** | https://vam-os-admin-portal.vercel.app/apply/mentee?token=s12pilot |

> **Lưu ý:** Nhận tài khoản từ admin qua email. Mở link email **ngay khi nhận** — link hết hạn nhanh.

---

## 2. Ai dùng role nào

| Role | Làm gì chính |
|------|-------------|
| **Admin / Core Team** | Giao reviewer, ra quyết định, duyệt hồ sơ chính thức, quản lý sự kiện, ghép cặp |
| **Reviewer** | Chấm điểm 5 tiêu chí (1–5), chọn đề xuất, nộp nhận xét |
| **Interviewer** | Tự nhận ứng viên cần phỏng vấn, điền form, nộp kết quả |
| **Support Team** | Điểm danh sự kiện, xem hồ sơ (tùy quyền được cấp) |
| **Viewer** | Xem dashboard — không chỉnh sửa dữ liệu |

---

## 3. 5 Flow cần test nhất

| # | Flow | Ai test | Trang |
|---|------|---------|-------|
| 1 | Nộp application (thử làm ứng viên) | Mọi người | `/apply/mentor` hoặc `/apply/mentee` |
| 2 | Giao reviewer → reviewer chấm điểm → nộp | Admin + Reviewer | `/applications` → `/reviews/[id]` |
| 3 | Admin đọc kết quả review → ra quyết định | Admin | `/applications/[id]` |
| 4 | Interviewer tự nhận ứng viên → nộp form PV | Interviewer | `/interviews` |
| 5 | Xem dashboard, kiểm tra số liệu tháng hiện tại | Mọi người | `/` |

---

## 4. Cách reset password

| Bước | Hành động |
|------|-----------|
| 1 | Báo admin để nhận email khôi phục |
| 2 | Mở email → click link → trang `/reset-password` |
| 3 | Nhập mật khẩu mới (≥ 8 ký tự) → click **"Đặt lại mật khẩu"** |
| 4 | Đăng nhập bình thường tại https://vam-os-admin-portal.vercel.app |

---

## 5. Cách báo bug

Gửi cho admin kèm đầy đủ thông tin sau:

- **Tiêu đề lỗi** — mô tả ngắn gọn (VD: "Không nộp được review — trang báo lỗi đỏ")
- **URL** — dán link đầy đủ trang đang dùng
- **Email tài khoản** — email đang đăng nhập
- **Các bước tái hiện** — 1. Làm gì → 2. Làm gì tiếp → 3. Lỗi xảy ra ở bước nào
- **Screenshot** — bắt buộc, đính kèm ảnh chụp màn hình

---

## 6. Checklist theo vai trò

### ✦ Core Team / Admin
- [ ] Đăng nhập thành công
- [ ] Giao reviewer cho 1 hồ sơ
- [ ] Ra quyết định cho 1 hồ sơ (sau khi có review)
- [ ] Tạo 1 sự kiện, cập nhật điểm danh
- [ ] Tạo 1 cặp mentor–mentee, thử hủy cặp

### ✦ Reviewer
- [ ] Đăng nhập thành công
- [ ] Thấy review được giao trong `/reviews`
- [ ] Lưu nháp review thành công
- [ ] Nộp review → form chuyển sang chỉ đọc

### ✦ Interviewer
- [ ] Đăng nhập thành công
- [ ] Mở `/interviews`, tìm ứng viên có trạng thái "Đã mời PV"
- [ ] Tự nhận 1 ứng viên, điền form, nộp kết quả

### ✦ Support Team
- [ ] Đăng nhập thành công
- [ ] Xem được danh sách hồ sơ (xem thôi, không sửa)
- [ ] Cập nhật điểm danh sự kiện (nếu được cấp quyền)

---

*Liên hệ hỗ trợ: Anh Thắng hoặc team phát triển VAM OS*
