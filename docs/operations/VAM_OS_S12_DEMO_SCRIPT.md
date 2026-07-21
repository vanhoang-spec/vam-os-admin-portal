# VAM OS — S12 Demo Script

**Thời gian:** 10–15 phút
**Audience:** Core Team, Founder
**Dataset:** DEMO-S12 / DEMO-S12-B1
**Mục tiêu:** Giới thiệu toàn bộ workflow S12 từ đăng nhập đến check-in sử dụng dữ liệu tổng hợp an toàn.

**Không được:** Dùng dữ liệu thật S11 hoặc mutate dữ liệu production S12 thật trong buổi demo.

---

## Chuẩn bị trước demo

- [ ] Đăng nhập tài khoản demo với role `core_team` (hoặc `admin`)
- [ ] Xác nhận DEMO-S12 có ít nhất 5 mentor applications và 10 mentee applications
- [ ] Xác nhận có 2 existing matches trong DEMO-S12-B1 để demo match list
- [ ] Xác nhận event "Season 12 Demo Kickoff Orientation" tồn tại với capacity = 8
- [ ] Xác nhận có registrations ở các trạng thái: confirmed, waitlisted, pending_review
- [ ] Mở browser, navigate tới production URL hoặc Preview URL

---

## Bước 1 — Unlock và Đăng nhập (1 phút)

**URL:** `/unlock`

> "Hệ thống VAM OS có hai lớp bảo vệ. Lớp đầu là mật khẩu nội bộ để phân biệt với công khai."

1. Nhập mật khẩu nội bộ → tiếp tục.
2. Navigate tới `/login` → đăng nhập.
3. Nhìn vào menu bên trái.

> "Menu hiển thị tùy theo vai trò. Core team thấy Vận hành, Ứng tuyển, Ghép cặp, Sự kiện và Quản trị."

---

## Bước 2 — Xem Applications S12 (2 phút)

**URL:** `/applications` hoặc `/admin/applications`

> "Đây là danh sách toàn bộ ứng tuyển. Chúng ta đang làm việc với DEMO-S12 — dữ liệu tổng hợp, không ảnh hưởng S11."

1. Lọc hoặc tìm một đơn mentor DEMO-S12.
2. Click vào đơn → mở trang chi tiết.

> "Trang này hiện: thông tin ứng viên, lịch sử review, quyết định admin, và phần duyệt chính thức."

3. Kéo xuống → phần "Giao Review".
4. Chọn reviewer + round "Hồ sơ" → nhấn "Giao Review".
5. Thông báo xanh xuất hiện.

> "Hệ thống đã giao review cho reviewer. Reviewer sẽ thấy đơn này trong /reviews."

---

## Bước 3 — Review Application (2 phút)

**URL:** `/reviews/[id]`

> "Sau khi được giao, reviewer mở form đánh giá."

1. Từ trang application detail → click "Làm review" trong bảng lịch sử review.
2. Điền điểm (1–5) cho từng tiêu chí.
3. Chọn đề xuất.
4. Nhấn "Lưu nháp" → thông báo xanh.
5. Nhấn "Nộp review" → review submitted.

> "Điểm tổng được tính tự động. Review đã nộp không thể chỉnh sửa."

---

## Bước 4 — Quyết định Admin (1.5 phút)

**URL:** `/applications/[id]`

> "Sau khi có review, admin/core team ra quyết định."

1. Quay lại trang application detail.
2. Phần "Quyết định" → chọn "Pass screening — Hồ sơ đạt".
3. Nhấn "Ghi nhận quyết định" trực tiếp (không có modal vì không phải quyết định kết thúc).
4. Thông báo xanh → lịch sử quyết định cập nhật.

**Demo safety gate:**
5. Thử chọn "Không phù hợp / từ chối" → nút chuyển màu đỏ.
6. Nhấn → modal xác nhận xuất hiện.

> "Hệ thống yêu cầu xác nhận thêm cho quyết định có tính kết thúc. Người dùng không thể vô tình từ chối ứng viên."

7. Nhấn "Hủy" trong modal → không có mutation.

---

## Bước 5 — Duyệt thành viên chính thức (1.5 phút)

> "Khi đã chắc chắn, admin duyệt ứng viên để tạo hồ sơ chính thức."

1. Phần "Duyệt thành viên chính thức".
2. Kiểm tra thông tin ứng viên trong preview card.
3. Chọn "Mentee" từ dropdown.
4. Nhấn "Duyệt làm Mentee chính thức".
5. Thông báo xanh → "Đã tạo người mới. Đã tạo mentee profile mới."
6. Click "Xem hồ sơ người →".

> "Hệ thống tạo person và mentee profile, không tạo trùng nếu email đã tồn tại."

---

## Bước 6 — Xem hồ sơ người (1 phút)

**URL:** `/people/[id]`

> "Trang hồ sơ người tổng hợp toàn bộ lịch sử: ứng tuyển, match, recap, tham gia sự kiện."

1. Cuộn qua các section: thông tin cơ bản, match, recaps, sự kiện.
2. Nhấn "← Quay lại" để trở về.

---

## Bước 7 — Manual Matching (2 phút)

**URL:** `/matches`

> "Sau khi có đủ mentor và mentee đã duyệt, chúng ta ghép cặp thủ công."

1. Chọn batch `DEMO-S12-B1` từ dropdown → nhấn "Lọc".
2. Form "Tạo matching thủ công" xuất hiện.
3. Chỉ ra thanh tải mentor: xanh = còn chỗ, đỏ = FULL.
4. Chọn một mentor (hiển thị số mentee hiện tại).
5. Chọn một mentee (hiển thị "Chưa có mentor").
6. Nhập ghi chú → nhấn "Tạo matching".
7. Match mới xuất hiện trong danh sách.

> "Hệ thống ngăn không cho ghép trùng — mentee đã có mentor sẽ bị disable trong dropdown."

**Demo cancel:**
8. Nhấn "Hủy match" trên một match active → form inline xuất hiện.
9. Nhấn "Không" → form đóng lại, không có mutation.

---

## Bước 8 — Event và Registration (2 phút)

**URL:** `/events`, `/events/[id]`

> "Chúng ta tạo và quản lý sự kiện cho mùa S12."

1. Vào `/events` → click "Season 12 Demo Kickoff Orientation".
2. Xem KPI: capacity, đã xác nhận, waitlist, check-in.
3. Cuộn xuống → danh sách đăng ký.
4. Click một registration ở trạng thái "Chờ duyệt".

**URL:** `/events/[id]/registrations/[regId]`

> "Trang này cho phép xử lý từng đăng ký một cách an toàn."

5. Nhấn "Xác nhận đăng ký" → modal xuất hiện.
6. Đọc mô tả → nhấn "Xác nhận đăng ký" trong modal.
7. Thông báo xanh + trạng thái cập nhật.

> "Confirm, waitlist, reject và cancel đều có modal xác nhận. Reject và cancel yêu cầu nhập lý do."

---

## Bước 9 — Check-in (1 phút)

> "Người tham gia tự check-in qua QR code. Admin xem kết quả ở attendance page."

1. Quay lại event detail → copy link check-in.
2. Mở link check-in trong tab incognito (giả lập người dùng công khai).
3. Nhập email của một người đã confirmed → nhấn "Check-in".
4. Thông báo xanh "Check-in thành công."
5. Quay lại `/events/[id]/attendance` → xem KPI cập nhật.

> "Check-in lặp lại là an toàn — không tạo bản ghi trùng."

---

## Bước 10 — Data Isolation (30 giây)

> "Điều quan trọng nhất: mọi thao tác trên đây chỉ ảnh hưởng đến dữ liệu DEMO-S12. Dữ liệu Season 11 hoàn toàn an toàn và không bị chỉnh sửa."

1. Vào `/matches` → chọn batch UEHM-S11-B1 từ dropdown (nếu có).
2. Danh sách match S11 xuất hiện.

> "Hệ thống hiển thị dữ liệu lịch sử để tham khảo. Nhưng Core Team sẽ không cần thao tác với S11 trong mùa S12 này."

---

## Tóm tắt Demo

| Bước | Nội dung | Thời gian |
|------|---------|-----------|
| 1 | Unlock + Login | 1 phút |
| 2 | Applications + Review assignment | 2 phút |
| 3 | Review form | 2 phút |
| 4 | Admin decision (incl. destructive guard) | 1.5 phút |
| 5 | Official approval → person + profile | 1.5 phút |
| 6 | People profile | 1 phút |
| 7 | Manual matching | 2 phút |
| 8 | Event + registration actions | 2 phút |
| 9 | Check-in | 1 phút |
| 10 | Data isolation | 0.5 phút |
| **Tổng** | | **~15 phút** |

---

## Câu hỏi thường gặp trong demo

**Q: Nếu tôi vô tình từ chối một ứng viên thật?**
A: Hệ thống luôn ghi lịch sử quyết định. Tuy nhiên, quyết định `rejected_or_not_fit` cần xác nhận trong modal — giảm thiểu thao tác vô tình. Nếu cần đổi lại, chọn lại trạng thái khác từ form quyết định.

**Q: Dữ liệu S11 có an toàn không?**
A: Có. Tất cả mutation đều được kiểm tra season scope. Demo này dùng DEMO-S12 — S11 không bị ảnh hưởng.

**Q: Nếu trang báo lỗi "Không thể thực hiện thao tác"?**
A: Đây là thông báo an toàn — lỗi chi tiết được giấu. Thử lại sau 30 giây hoặc reload trang.
