# Tài liệu hướng dẫn cho người dùng

Thư mục này chứa tài liệu hướng dẫn **dành cho người vận hành**, không phải cho
người viết mã. Ngôn ngữ là tiếng Việt của người đi làm: nói rõ bấm vào đâu, điền
gì, và điều gì xảy ra sau khi bấm.

| Tài liệu | Dành cho | Nội dung |
|---|---|---|
| `HUONG_DAN_MODULE_SU_KIEN.pdf` | Core team, Support team, BTC sự kiện | Toàn bộ module Sự kiện: tạo sự kiện, chuỗi nhiều buổi, link đăng ký, thư xác nhận kèm QR, quét mã tại cửa, theo dõi số liệu |
| `HUONG_DAN_MODULE_MAIL.pdf` | Core team, Support team, Admin | Toàn bộ module Mail: soạn mẫu thư và ô điền, duyệt, gửi hàng loạt theo lô, nhật ký gửi, cách viết để không rơi vào hộp thư rác |
| `HUONG_DAN_CAP_QUYEN_REVIEWER.pdf` | Support team, Core team | Một trang: mời reviewer — cấp quyền chấm hồ sơ / phỏng vấn, thư mời, reviewer đăng nhập lần sau, các lỗi thường gặp |

## Sửa và xuất lại bản PDF

Bản PDF được dựng từ file HTML cùng tên — **sửa file HTML, đừng sửa PDF**.

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="docs/huong-dan/HUONG_DAN_MODULE_SU_KIEN.pdf" "file:///<đường dẫn tuyệt đối>/docs/huong-dan/HUONG_DAN_MODULE_SU_KIEN.html"
```

Dùng Chrome vì tài liệu đặt chữ bằng CSS in ấn (khổ A4, ngắt trang, không cho
bảng bị cắt đôi) và Chrome là thứ đọc đúng những quy tắc đó. Font là Segoe UI —
có sẵn trên mọi máy Windows và đủ dấu tiếng Việt.

## Khi nào phải cập nhật

Tài liệu mô tả những nút bấm có thật trên màn hình. Đổi nhãn nút, thêm bớt một ô
trong biểu mẫu, hay đổi cách phân quyền thì phải sửa tài liệu trong cùng lần
thay đổi đó — một hướng dẫn nói sai còn tệ hơn không có hướng dẫn, vì người đọc
tin nó và đi tìm thứ không tồn tại.

Phần dễ lạc hậu nhất, kiểm lại trước tiên.

**Module Sự kiện:**

- Bảng phân quyền ở Phần 1 (`lib/auth-constants.ts`, `lib/permissions.ts`)
- Danh sách loại sự kiện ở Phần 2 (`lib/event-constants.ts`)
- Danh sách trạm quét ở Phần 7 (`lib/event-checkin-code.ts`)
- Mục "Những gì hệ thống chưa làm" ở Phần 1 — sửa ngay khi một trong số đó được làm

**Module Mail:**

- Bảng phân quyền ở Phần 2 (`lib/permissions.ts`: `canComposeEmailTemplate`,
  `canApproveEmailTemplate`, `canSendBulkEmail`, `canViewOutboundEmails`)
- Danh sách ô điền và loại mẫu thư ở Phần 3 (`lib/email-templates-core.ts`:
  `TEMPLATE_SPECS`, `TEMPLATE_KINDS`)
- Con số "mỗi lượt 25 thư" ở Phần 5 (`lib/bulk-mail-core.ts`: `BULK_SEND_CHUNK`)
- Nhóm người nhận ở Phần 5 (`lib/bulk-mail-core.ts`: `BULK_AUDIENCE_LABELS`)
- Các lời báo lỗi trích trong Phần 3 (`lib/email-templates-core.ts`, hàm kiểm mẫu thư)

**Mời reviewer (một trang):**

- Tên menu, nhãn nút và lời báo trích trong trang — `__tests__/huong-dan-cap-quyen-reviewer.test.ts`
  đối chiếu từng câu với mã nguồn, đổi nhãn mà quên sửa hướng dẫn thì test đỏ
- Ai làm được (`lib/permissions.ts`: `canManageReviewers`, `canAssignReviewLots`)
- Giữ **đúng một trang**: in xong, mở PDF kiểm lại số trang
