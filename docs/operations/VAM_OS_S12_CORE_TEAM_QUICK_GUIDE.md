# VAM OS — Core Team Quick Guide (S12)

**Phiên bản:** Batch 4 — 2026-07-21
**Dành cho:** core_team, admin, super_admin
**Mùa vận hành:** UEHM-S12

---

## 1. Đăng nhập

1. Vào `/unlock` → nhập mật khẩu nội bộ → tiếp tục.
2. Vào `/login` → đăng nhập bằng email và mật khẩu admin.
3. Menu hiển thị tùy theo vai trò của bạn. `core_team` thấy toàn bộ menu chính.

**Nếu không vào được:** Liên hệ admin cấp tài khoản. Không chia sẻ mật khẩu nội bộ.

---

## 2. Chọn đúng Season và Intake Batch

Hệ thống hiện vận hành song song dữ liệu S11 (lịch sử) và S12 (đang hoạt động).

- Khi tìm kiếm hoặc lọc dữ liệu, **luôn chọn mùa UEHM-S12 hoặc batch UEHM-S12-B1** để làm việc với đợt tuyển sinh mới nhất.
- Dữ liệu S11 vẫn hiển thị để tham khảo nhưng **không được chỉnh sửa**.
- Trang `/admin/applications` đã lọc sẵn S12.

---

## 3. Xem và xử lý ứng tuyển

**Xem danh sách ứng tuyển:** `/applications` hoặc `/admin/applications`

### Giao reviewer
1. Mở một đơn ứng tuyển → phần "Giao Review".
2. Chọn reviewer, vòng review (hồ sơ hoặc phỏng vấn), hạn nộp.
3. Nhấn "Giao Review" → thông báo xanh nếu thành công.

### Ra quyết định
1. Phần "Quyết định của Admin / Core team".
2. Chọn trạng thái từ dropdown.
3. Với trạng thái **kết thúc** (`Không phù hợp / từ chối`, `Ứng viên rút đơn`): hộp xác nhận sẽ xuất hiện. Đọc kỹ trước khi xác nhận.
4. Với trạng thái thông thường: nhấn "Ghi nhận quyết định" trực tiếp.

### Duyệt thành viên chính thức
1. Phần "Duyệt thành viên chính thức" (chỉ hiện với admin/core_team).
2. Kiểm tra thông tin ứng viên trong phần xem trước.
3. Chọn vai trò (Mentee hoặc Mentor).
4. Nhấn nút duyệt → hệ thống tạo hoặc liên kết hồ sơ người.
5. Nhấn link "Xem hồ sơ người →" để kiểm tra.

**Lưu ý:** Nếu đơn đã được duyệt trước đó, hệ thống sẽ cảnh báo và tái sử dụng hồ sơ sẵn có. Không bị tạo trùng.

---

## 4. Kiểm tra hồ sơ (People / Profile)

- `/people` — danh sách toàn bộ thành viên VAM.
- `/mentors` — danh sách mentor profile.
- `/mentees` — danh sách mentee profile.
- Click tên người → xem chi tiết: season, match, recap, event.

**Tìm kiếm:** Hỗ trợ tiếng Việt có dấu, bao gồm Đ/đ.

---

## 5. Tạo match (Ghép cặp)

1. Vào `/matches`.
2. Chọn Intake Batch từ dropdown lọc (ví dụ: UEHM-S12-B1) → nhấn "Lọc".
3. Form "Tạo matching thủ công" hiện ra.
4. Chọn mentor (thấy tải hiện tại 0/3, 1/3, 2/3, FULL).
5. Chọn mentee (hiển thị "Đã có mentor" nếu đã ghép).
6. Thêm ghi chú nội bộ (tuỳ chọn) → nhấn "Tạo matching".
7. Trang tự làm mới. Match mới xuất hiện trong danh sách.

**Giới hạn:** Mỗi mentor tối đa 3 mentee. Mỗi mentee chỉ có 1 mentor active.

---

## 6. Hủy match

1. Trong danh sách `/matches`, tìm match active.
2. Nhấn "Hủy match" → ô hủy xuất hiện với cảnh báo.
3. Nhập lý do (khuyến khích) → nhấn "Xác nhận hủy".
4. Để thoát mà không hủy → nhấn "Không".
5. Lịch sử ghép cặp không bị xóa.

---

## 7. Quản lý sự kiện

**Xem danh sách:** `/events`

**Xem chi tiết sự kiện:**
- KPI: tổng đăng ký, đã xác nhận, waitlist, checked-in, sức chứa.
- QR code check-in và link đăng ký.
- Danh sách đăng ký với trạng thái từng người.

**Chỉnh sửa sự kiện:** `/events/[id]/edit` (chỉ admin/core_team).

**Quản lý tham gia (attendance):** `/events/[id]/attendance`

---

## 8. Trạng thái đăng ký sự kiện

| Trạng thái | Ý nghĩa |
|------------|---------|
| Đã đăng ký (`registered`) | Đăng ký tự do, chưa được xem xét |
| Chờ duyệt (`pending_review`) | Cần admin xem xét |
| Đã xác nhận (`confirmed`) | Có chỗ chắc chắn |
| Danh sách chờ (`waitlisted`) | Đang chờ chỗ trống |
| Đã từ chối (`rejected`) | Không được chấp nhận (kết thúc) |
| Đã hủy (`cancelled`) | Đã hủy (kết thúc) |

---

## 9. Xử lý đăng ký

1. Mở sự kiện → click vào tên người đăng ký → vào trang đăng ký chi tiết.
2. Panel "Admin actions" gồm 4 phần:
   - **Trạng thái đăng ký**: Xác nhận / Waitlist / Từ chối / Hủy.
   - **Thanh toán**: Xác nhận hoặc từ chối.
   - **Minh chứng**: Chấp nhận hoặc từ chối.
   - **Ghi chú nội bộ**: Ghi chú dành cho team (không gửi cho người đăng ký).
3. Từ chối và hủy yêu cầu **nhập lý do** và **xác nhận trong modal**.
4. Đăng ký ở trạng thái kết thúc (rejected/cancelled) **không thể khôi phục** trong sprint hiện tại.

**Capacity:** Xác nhận đăng ký khi sự kiện đã đủ chỗ sẽ bị chặn tự động.

---

## 10. Waitlist và sức chứa

- Hệ thống kiểm tra sức chứa khi bạn xác nhận đăng ký.
- Nếu đủ chỗ → xác nhận thành công.
- Nếu hết chỗ → hệ thống báo lỗi. Chuyển người đó vào waitlist thay thế.
- Hệ thống **không tự động đôn** người trong waitlist. Core team phải thủ công xác nhận từng người khi có chỗ trống.

---

## 11. Registration link (link đăng ký)

- Trên trang chi tiết sự kiện → phần "Registration Link".
- Toggle "Bật / Tắt" link đăng ký.
- Khi tắt: link tồn tại nhưng không nhận đăng ký mới.
- Chỉ `admin` và `core_team` mới thay đổi được trạng thái link.

---

## 12. Check-in

**Cách 1 — Tự check-in (người tham gia):**
- Quét QR code hoặc vào link check-in.
- Nhập email. Nếu không có đăng ký trước, nhập thêm tên (walk-in).

**Cách 2 — Admin ghi nhận thủ công:**
- `/events/[id]/attendance` → tìm người → đổi trạng thái attendance.

**Check-in lặp lại:** Không tạo bản ghi trùng. An toàn để chạy lại nếu cần.

---

## 13. Lỗi thường gặp và cách xử lý

| Lỗi hiển thị | Nguyên nhân phổ biến | Cách xử lý |
|-------------|---------------------|------------|
| "Bạn không có quyền..." | Vai trò không đủ | Liên hệ admin nâng quyền |
| "Không thể thực hiện thao tác. Vui lòng thử lại..." | Lỗi kết nối Supabase | Thử lại sau 30 giây |
| "Không thể xác nhận... sự kiện đã đủ chỗ." | Capacity limit đã đầy | Chuyển người vào waitlist |
| "Vui lòng nhập lý do trước khi tiếp tục." | Trường lý do bắt buộc | Nhập lý do vào ô text |
| "Không tìm thấy hồ sơ ứng tuyển." | ID không đúng hoặc không có quyền | Quay lại danh sách, mở lại từ link |
| Trang trắng / 500 | Lỗi server hiếm gặp | Reload; nếu tái diễn, báo ngay |

---

## 14. TUYỆT ĐỐI KHÔNG làm với dữ liệu S11

- Không thay đổi trạng thái đơn ứng tuyển S11.
- Không xóa hoặc sửa match S11.
- Không chỉnh sửa recap hoạt động S11 ngoài quy trình chính thức.
- Không import dữ liệu mới vào bảng S11.
- Nếu cần tra cứu S11: chỉ xem, không thao tác.

---

## 15. Nơi báo lỗi

- **Lỗi cần xử lý ngay:** Nhắn trực tiếp cho founder / người phụ trách kỹ thuật.
- **Lỗi không cản workflow:** Ghi chú lại (tên trang, bước thực hiện, thông báo lỗi) và gửi vào kênh nội bộ.
- **Không cố fix lỗi bằng cách thay đổi dữ liệu trực tiếp trong database.**

---

*Quick Guide này có hiệu lực từ 2026-07-21 (Batch 4 Operational Readiness).*
