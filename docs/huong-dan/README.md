# Tài liệu hướng dẫn cho người dùng

Thư mục này chứa tài liệu hướng dẫn **dành cho người vận hành**, không phải cho
người viết mã. Ngôn ngữ là tiếng Việt của người đi làm: nói rõ bấm vào đâu, điền
gì, và điều gì xảy ra sau khi bấm.

| Tài liệu | Dành cho | Nội dung |
|---|---|---|
| `HUONG_DAN_MODULE_SU_KIEN.pdf` | Core team, Support team, BTC sự kiện | Toàn bộ module Sự kiện: tạo sự kiện, chuỗi nhiều buổi, link đăng ký, thư xác nhận kèm QR, quét mã tại cửa, theo dõi số liệu |
| `HUONG_DAN_MODULE_MAIL.pdf` | Core team, Support team, Admin | Toàn bộ module Mail: soạn mẫu thư và ô điền, duyệt, gửi hàng loạt theo lô, nhật ký gửi, cách viết để không rơi vào hộp thư rác |
| `HUONG_DAN_CAP_QUYEN_REVIEWER.pdf` | Support team, Core team | Một trang: mời reviewer — cấp quyền chấm hồ sơ / phỏng vấn, thư đặt mật khẩu qua Brevo, reviewer đăng nhập bằng mật khẩu, các lỗi thường gặp |
| `HUONG_DAN_CONG_CU_AI.pdf` | Super Admin, Admin, Core team, Support team | Một trang: sáu công cụ AI, các bước chạy và lưu kết quả, quy tắc không đưa dữ liệu cá nhân sang DeepSeek, các lỗi thường gặp |
| `HUONG_DAN_LICH_PHONG_VAN.pdf` | Core team, Support team, BTC tuyển sinh | Một trang: lịch phỏng vấn mentor 1:1 — interviewer đăng giờ rảnh, ứng viên tự giữ chỗ qua link riêng, thư mời/nhắc tự động, huỷ và đổi lịch, các tình huống thường gặp |
| `HUONG_DAN_CANVA_AI.pdf` | Support team, Core team | Một trang: dùng công cụ **Brief thiết kế cho Canva AI** trên app để soạn prompt tiếng Anh, rồi dán sang Canva AI ra key visual / poster / video — kèm ba thứ luôn phải sửa tay và quy tắc không đưa dữ liệu cá nhân ra ngoài |
| `HUONG_DAN_TU_DAT_LAI_MAT_KHAU.pdf` | **Mọi người dùng VAM OS** | Một trang: tự đặt lại mật khẩu trên trang đăng nhập, không cần nhờ ban tổ chức — bốn bước, phân biệt hai nút dễ nhầm, và các trục trặc thường gặp |
| `HUONG_DAN_SUA_THU_TU_DONG.pdf` | Core team, Support team, Admin | Một trang: sửa câu chữ của 17 lá thư hệ thống tự gửi — bốn bước, cách dùng ô điền, vì sao hệ thống từ chối lưu, và cảnh báo lưu là có hiệu lực ngay (không có bước duyệt) |

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
- Các mục của một lần quét và giới hạn 20 lần ở Phần 7 (`lib/event-checkin-steps.ts`:
  `CHECKIN_PURPOSES`, `MAX_CHECKIN_STEPS`), số cột của file CSV ở Phần 9
  (`lib/event-export.ts`: `EVENT_EXPORT_HEADERS`)
- Các đoạn chữ sửa được trên form đã gửi link ở mục 4.4 (`lib/event-form-text.ts`:
  `FORM_TEXT_FIELDS`, `visibleFormTextFields`)
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

**Công cụ AI (một trang):**

- Tên công cụ, nhãn nút, lời báo lỗi — `__tests__/huong-dan-cong-cu-ai.test.ts`
  đối chiếu từng câu với mã nguồn (`app/ai/ai-tools.tsx`, `app/ai/ai-shared.tsx`,
  `lib/ai/ai-core.ts`)
- Số file, dung lượng, loại file (`lib/ai/upload-core.ts`) và ai dùng được
  (`lib/permissions.ts`: `canUseAiTools`, `canRunAiExecutiveReport`) — test cũng
  đối chiếu với hằng số
- Thêm hay bỏ một công cụ thì sửa bảng "Sáu công cụ" và mục "Mẹo theo từng công cụ"
- Giữ **đúng một trang**: in xong, mở PDF kiểm lại số trang

**Lịch phỏng vấn mentor (một trang):**

- Tên menu, nhãn nút, lời báo và MỌI con số (đợt 22/09–05/10, khung 07:00–22:00,
  nhịp nhắc 3 ngày, mốc 24 giờ, hotline) — `__tests__/huong-dan-lich-phong-van.test.ts`
  đối chiếu từng câu với mã nguồn và hằng số trong `lib/interview-schedule-core.ts`
- Ô cảnh báo vàng "thư chỉ tự đi khi có tab đang mở" mô tả trạng thái CHƯA bật
  CRON_SECRET — ngày nào bật cron thật thì viết lại ô đó (test sẽ nhắc)
- Giữ **đúng một trang**: in xong, mở PDF kiểm lại số trang

**Canva AI (một trang):**

- Nhãn ô nhập, nhãn nút, lời báo lỗi và số file/dung lượng —
  `__tests__/huong-dan-canva-ai.test.ts` đối chiếu từng câu với `app/ai/ai-tools.tsx`,
  `app/ai/ai-shared.tsx`, `lib/ai/ai-core.ts`, `lib/ai/upload-core.ts` và
  `lib/ai/prompts.ts`
- Ba phần của kết quả (ghi chú → prompt đánh số → checklist) mô tả đúng cấu trúc
  mà `canvaBriefPrompt` yêu cầu model trả về — đổi cấu trúc đó thì sửa cả tài liệu
- **Nửa Canva cố ý không ghim vào nhãn nút của Canva.** Đó là sản phẩm của bên
  khác, họ đổi giao diện lúc nào tuỳ họ và không ai báo. Tài liệu tả theo chức
  năng ("ô nhập mô tả"), và test canh chính sự cố ý đó — đừng "sửa cho chính xác"
  bằng cách chép tên nút hiện tại của Canva vào
- Giữ **đúng một trang**: test tự đếm số trang trong PDF, nên sửa HTML xong phải
  dựng lại PDF bằng lệnh Chrome ở trên

**Tự đặt lại mật khẩu (một trang):**

- Nhãn hai nút trên `/login`, các câu trên `/reset-password`, và độ dài mật khẩu
  tối thiểu — `__tests__/huong-dan-tu-dat-lai-mat-khau.test.ts` đối chiếu từng
  câu với `app/login/login-form.tsx`, `app/login/page.tsx`,
  `app/reset-password/page.tsx` và `lib/password-link-core.ts`
- Mục "Hai nút, đừng nhầm" là phần dễ mất nhất khi ai đó gọn lại tài liệu. Giữ
  nó: hai nút đứng cạnh nhau và chỉ khác nhau ở HẬU QUẢ, người bấm nhầm vẫn vào
  được và vẫn kẹt y hệt vào lần sau
- Người đọc tài liệu này đang KHÔNG vào được hệ thống, nên họ không đối chiếu
  được với màn hình. Sai một nhãn ở đây tốn của họ một vòng nhắn ban tổ chức —
  đúng thứ tính năng này sinh ra để xoá bỏ
- Giữ **đúng một trang**: test tự đếm số trang trong PDF

**Sửa thư tự động (một trang):**

- Nhãn nút, lời báo thành công và MỌI lời báo từ chối —
  `__tests__/huong-dan-sua-thu-tu-dong.test.ts` đối chiếu từng câu với
  `lib/email-automation-core.ts`, `lib/email-automation.ts` và
  `app/operations/mail/samples/automation-editor.tsx`
- Số lá thư sửa được (`AUTOMATION_SLOTS`), tên ba nhóm (`AUTOMATION_GROUPS`) và
  trần độ dài tiêu đề/nội dung (`lib/email-templates-core.ts`) — test đối chiếu
  thẳng với hằng số, nên thêm một lá thư là tài liệu phải sửa theo
- **Ô cảnh báo "Lưu là có hiệu lực ngay — không có bước ai duyệt" là phần không
  được gọn lại.** Người quen tay với tab "Mẫu thư" sẽ mặc định ở đây cũng có
  người duyệt, và sẽ bấm Lưu để "xem thử" — trong khi lá thư tiếp theo đã dùng
  nội dung đó. Test canh đúng câu này
- Mục "Bốn lá thư sự kiện chưa sửa được từ đây" phải sửa ngay khi thư sự kiện
  được làm cho sửa được
- Giữ **đúng một trang**: test tự đếm số trang trong PDF
