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
| `HUONG_DAN_SUA_THU_TU_DONG.pdf` | Core team, Support team, Admin | Một trang: sửa câu chữ của 19 lá thư hệ thống tự gửi — bốn bước, cách dùng ô điền, vì sao hệ thống từ chối lưu, và cảnh báo lưu là có hiệu lực ngay (không có bước duyệt) |
| `HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.pdf` | Support team, Core team, BTC | Hai trang, cập nhật 29/09: gửi thư mời NGAY, cố ý không có địa chỉ — mentee mở lại đúng link để xem khi có; ai bấm nút gửi và cần bấm lại nhiều lần; 28 ca, ghế và phòng/bàn khác nhau theo ngày; thư mời nguyên văn và hướng dẫn QR/check-in/phân bàn/chấm/nhận mentee |
| `HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.pdf` | Trang 1–3: Core Team (soạn thông báo/video cho mentor). Trang 4: Support/BTC trực bàn | Bốn trang, dựng 30/09, mở rộng 01/10. Trang 1–3 CHỈ nội dung dành cho MENTOR (phần cấp quyền/danh sách nội bộ anh Hoàng làm riêng, không thuộc tài liệu này): đăng nhập lần đầu, tìm đúng mentee được phân, khung điểm + thang điểm gợi ý 1/3/5 riêng cho Mùa 12, câu hỏi gợi ý đủ 5/5 tiêu chí (từ tài liệu Mùa 11 BTC gửi, chỉ mượn câu hỏi) — đã bỏ hẳn phần phân loại nhóm mentee G/C/E/F theo chốt của anh Hoàng. Trang 4 (thêm 30/09) là quy trình check-in → phân công phòng/bàn/người phỏng vấn cho Support/BTC, cùng màn hình `/interviews/mentee-offline` mentor dùng nhưng khác nút thao tác. Đây là bản ĐẦY ĐỦ — xem `HUONG_DAN_NHANH_MENTOR_PHONG_VAN.pdf` để có bản rút gọn 1 trang |
| `HUONG_DAN_NHANH_MENTOR_PHONG_VAN.pdf` | **Mentor** — gửi kèm email confirm phỏng vấn | Một trang A4 duy nhất, dựng 01/10 theo yêu cầu anh Hoàng: CHỈ phần cơ bản nhất mentor cần biết trước buổi 03–04/10 — đăng nhập, tìm đúng mentee (tick ô lọc, chờ Support xếp bàn), chấm 5 tiêu chí, chọn kết quả và xác nhận. Cố ý KHÔNG mang theo khung điểm chi tiết/câu hỏi gợi ý/quy trình Support-BTC của bản 4 trang — ai cần sâu hơn thì đọc `HUONG_DAN_MENTOR_PHONG_VAN_TRUC_TIEP.pdf` |

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

**Phỏng vấn mentee giai đoạn 1 (hai trang):**

- Trang 1 là kế hoạch chốt 29/09: gửi thư mời **ngay**, cố ý không có địa chỉ;
  chủ dự án hoặc Support có quyền tự bấm nút "Gửi thư mời chọn ca" — có thể phải
  bấm nhiều lần vì trần 40 thư/lượt và trần ngày chung hệ thống. Đây là lần cập
  nhật thứ hai; bản 27/09 (chờ địa chỉ trước khi gửi) đã lỗi thời khi chủ dự án
  đổi quyết định.
- Trang 2 là **nguyên văn thư đang gửi thật**, chép từ `buildMenteeSessionInviteEmail`
  trong `lib/email-core.ts` — không phải bản dự kiến. Sửa hàm đó (kể cả chỉ đổi
  một câu) thì phải chép lại đúng câu đó vào tài liệu trong cùng lần sửa.
- `__tests__/huong-dan-phong-van-mentee-giai-doan-1.test.ts` kiểm các điểm chốt,
  đối chiếu số liệu với `lib/mentee-invite-dispatch-core.ts` (`DAILY_EMAIL_LIMIT`,
  `DISPATCH_RESERVE`, `DISPATCH_MAX_PER_RUN`) và vài dòng thư nguyên văn.
- Số ca, số ghế theo từng ngày, phòng/bàn theo từng ngày và hạn đặt ca
  (migration `20260929100000_dieu_chinh_lich_pv_mentee.sql`) — hiện là số liệu
  gõ tay trong test, không import hằng số (những con số đó chỉ nằm trong SQL
  migration, không có hằng số TypeScript tương ứng)
- Giai đoạn 2 (10 & 11/10) có migration riêng; khi đó viết tài liệu riêng, đừng
  sửa đè tài liệu này
- Giữ **đúng hai trang**: test tự đếm số trang trong PDF

**Mentor phỏng vấn mentee trực tiếp (bốn trang):**

- Trang 1–3 mô tả bước thật trên màn hình cho MENTOR (đăng nhập, tìm mentee, khung
  điểm, chấm điểm) — `__tests__/huong-dan-mentor-phong-van-truc-tiep.test.ts` đối
  chiếu nhãn nút và đường dẫn với mã nguồn thật (`app/login`,
  `app/interviews/mentee-offline/workflow.tsx`), và 5 tiêu chí/kết quả với
  `lib/mentee-offline-core.ts` (`OFFLINE_SCORES`, `OFFLINE_OUTCOMES`)
- **Không có phần "nội bộ" về cấp quyền/danh sách mentor** trong trang 1–3 — anh
  Hoàng chủ động tách ra làm riêng 30/09. Đừng thêm lại số liệu sống (bao nhiêu
  mentor đã có quyền, trần thư Brevo…) — thứ đó đổi theo ngày và không phải thứ
  mentor cần đọc
- **Trang 2 (mở rộng 30/09)** có bảng "Thang điểm gợi ý theo tiêu chí" — mô tả 1/3/5
  điểm nghĩa là gì cho từng tiêu chí trong 5 tiêu chí Mùa 12, do Core Team tự dựng
  (KHÔNG có trong mã nguồn, phần mềm chỉ lưu một con số 1–5). Đây là nội dung ảnh
  hưởng trực tiếp tới việc chấm đậu/rớt mentee thật — BTC nên đọc lại và chỉnh nếu
  thấy mốc nào chưa đúng, trước khi gửi cho mentor. Bảng full-width, KHÔNG đặt trong
  `.grid` hai cột — nhét vào cột hẹp làm chữ tự xuống dòng nhiều, tràn quá 1 trang
- Câu hỏi gợi ý ở trang 3 lấy từ tài liệu chấm Mùa 11 anh Hoàng gửi 30/09 — CHỈ mượn
  phần câu hỏi, KHÔNG mượn thang điểm (thang điểm hai bên KHÁC NHAU: Mùa 11 là 3
  tiêu chí/10đ, Mùa 12 là 5 tiêu chí/25đ — đã CHỐT giữ nguyên 5 tiêu chí/25đ). Nay đã
  có câu hỏi gợi ý cho đủ cả 5/5 tiêu chí (kể cả Mức độ phù hợp, Giao tiếp — Core
  Team tự viết thêm vì tài liệu Mùa 11 không có). **Phân loại nhóm mentee G/C/E/F
  của tài liệu Mùa 11 đã BỎ HẲN** theo chốt của anh Hoàng 30/09 — đừng thêm lại, kể
  cả dạng cảnh báo
- **Trang 4 (thêm 30/09)** là quy trình check-in → phân công cho **Support/BTC trực
  bàn**, không phải nội dung gửi mentor — vai trò/bước/nhãn nút đối chiếu thẳng với
  `app/interviews/mentee-offline/workflow.tsx` (`canOperate`-gated: "Xác nhận
  check-in", ba ô Phòng/Bàn/Người phỏng vấn, "Lưu phân bàn", "Lý do đổi phân công"
  bắt buộc khi đổi người). Đổi nhãn nút hay luồng ở màn hình đó thì phải sửa trang
  4 trong cùng lần đổi
- **Khối "Trước tiên" (thêm 30/09, cuối buổi)** ở đầu trang 4 — mentor tới xác nhận
  tên/SĐT, được Support hỗ trợ đăng nhập trên máy cá nhân, rồi Support tự ghi tên
  mentor vào sổ riêng. Bước ghi sổ này BẮT BUỘC vì ô "Người phỏng vấn" ở Bước B liệt
  kê **TOÀN BỘ interviewer đủ điều kiện của mùa** (RPC `vam104_offline_dashboard` →
  `vam084_list_recruitment_participants`), KHÔNG lọc theo ai đang thật sự có mặt —
  đây là sự thật đã xác minh lại từ mã nguồn 30/09, thay cho câu mô tả sai trước đó
  ("chỉ hiện người đang có mặt"). Đổi cách RPC lọc participants thì phải sửa lại câu
  này ở cả khối "Trước tiên" lẫn Bước B
- Bước "Mở hồ sơ" ở trang 1 nêu ĐÚNG hai nhãn hiển thị của câu trả lời chuẩn bị
  ("Mong muốn về Mentor đồng hành", "Lý do muốn có Mentor đồng hành") — đối chiếu
  `RAW_PAYLOAD_LABELS` trong `lib/application-export.ts`; đổi nhãn ở đó thì sửa
  luôn câu này
- Giữ **đúng bốn trang**: test tự đếm số trang trong PDF. Thêm nội dung mà tràn
  trang thì tách trang mới (`page-break`) thay vì thu nhỏ font tới mức khó đọc khi
  in — xem cách trang 2/3 đã tách ở lần sửa 30/09
- **Ba việc thêm 01/10** (migration
  `20261001120000_mentee_offline_ghi_chu_online_huy_dat_ca.sql`): trang 1 Bước 3
  nhắc có thêm ô ghi chú riêng từng tiêu chí (ngoài ô "Nhận xét" chung); trang 4
  Bước B thêm bullet cờ "Phỏng vấn ONLINE" (chỉ Support/BTC đặt, ứng viên không
  thấy — trang công khai `/dat-ca/[token]` không đọc bảng này nên tự động không
  lộ); trang 4 thêm mục "Huỷ lịch đăng ký" (chỉ Support/BTC, bắt buộc lý do, chỉ
  còn trước check-in — tái dùng trigger `vam104_booking_guard` có sẵn)
- **Chưa có ảnh chụp màn hình CRM thật trong tài liệu** (yêu cầu 30/09, chưa xong) —
  nút "Xác nhận check-in" mở `window.confirm()` gốc của trình duyệt, công cụ tự động
  của Claude Code không thao tác được; ghi trực tiếp vào Supabase production để dựng
  trạng thái "đã check-in" cũng bị lớp an toàn của Claude Code chặn. Cách khả thi:
  anh Hoàng tự bấm qua luồng thật trên UI (hoặc dán SQL dựng sẵn vào Supabase SQL
  Editor) rồi Claude Code chụp lại, hoặc chấp nhận ảnh mockup dựng từ mã nguồn thay
  ảnh chụp thật
