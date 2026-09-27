# Bàn giao AI — VAM OS

**Cập nhật lần cuối: 27/09/2026, bởi Claude Code** (nối tiếp bản Codex viết cùng
ngày). Càng xa ngày này càng nên tự kiểm lại bằng `git log` / `gh pr list` thay
vì tin nguyên văn — xem bước 2 của `CODEX_BAT_DAU.md`.

## Việc của Codex — truy xuất kết quả mentor S12 (27/09) — ĐÃ MERGE

Chủ dự án phản ánh hồ sơ phỏng vấn mentor biến mất sau lưu và không xem được
nhận xét để soạn thư báo rớt. Đã bổ sung trang `/interviews/ket-qua-mentor`, nút
xem application, điểm/nhận xét theo từng interviewer, ghi chú quyết định BTC và
nút xuất PDF/Excel toàn bộ kết quả S12 ở cuối trang. Không gửi thư kết quả.

Làm trên nhánh riêng `feat/mentor-interview-results`, base `main`. Không cần
migration; bốn cổng đạt (7.963 test qua, 14 skipped) lúc mở PR.
**[PR #171](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/171) đã
merge và deploy thành công 27/09** — không còn là việc đang dở. Chi tiết quyền,
kiểm thử: [bàn giao kết quả mentor](docs/audits/MENTOR_INTERVIEW_RESULTS_20260927.md).

Nhánh mentee offline (`feat/mentee-offline-interview-workflow`) và nhánh này
cùng sửa `lib/nav-model.ts` / `app/interviews/page.tsx` / `app/reviews/[id]/page.tsx`
ở gần đúng một chỗ (mỗi bên thêm một link điều hướng) — xung đột git thuần văn
bản, không xung đột thiết kế; Claude Code đã hợp nhất giữ cả hai link khi merge
`main` vào nhánh mentee offline.

## Claude Code tiếp tục ngày 28/09 — gửi email mời mentee

**Yêu cầu cuối của chủ dự án:** ghi nhận bàn giao để ngày mai có địa chỉ chính xác
thì Claude Code làm tiếp phần gửi mail. Không yêu cầu Support vào CRM bấm gửi.
Chưa gửi email, chưa đặt lịch tự gửi; việc cung cấp địa chỉ là đầu vào để hoàn
thiện đợt gửi, không tự suy diễn thành lệnh gửi ngay nếu chủ dự án chưa giao gửi.

### Trạng thái nhận việc — cập nhật sau khi Claude Code đọc lại và mở PR

- Nhánh `feat/mentee-offline-interview-workflow`: **đã push, đã mở**
  [PR #170](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/170).
  Ba commit: `1e1e0cf` (tính năng, của Codex), `417abb0` (cập nhật hướng dẫn theo
  kế hoạch chờ địa chỉ), `79b62ef` (sửa khai báo RPC sai trong
  `lib/production-rpc-contract.ts`, phát hiện lúc đọc lại).
- **Migration `20260927090000_mentee_offline_workflow.sql` đã dán vào Supabase
  Production và đã kiểm chứng** (đọc lại catalog: 2 bảng RLS đúng, 4 trigger,
  8 hàm `vam104_*`, ACL hàm ghi chỉ `service_role`). Chức năng mới vẫn **chưa
  deploy** — chỉ deploy khi PR #170 được merge.
- Bốn cổng đã chạy lại TOÀN BỘ trên đúng cây sắp mở PR (không chỉ tin số cũ của
  Codex): typecheck sạch, lint sạch, **vitest 7.939 ca qua, 0 hỏng**, build
  thành công, route `/interviews/mentee-offline` biên dịch sạch.
- Bộ gửi tự động "một lệnh là hệ thống gửi hết, Support không cần bấm CRM"
  **vẫn chưa được xây** — mã hiện có là nút gửi theo lô thủ công trong CRM
  (`lib/mentee-invite-dispatch.ts`). Đây là phần việc chính còn lại cho 28/09.
- `tmp/` chứa log kiểm thử/ảnh render của Codex, không đưa vào commit.

### Thứ tự làm tiếp khi nhận địa chỉ

1. Đọc `CLAUDE.md`, kiểm lại branch/status và trạng thái triển khai. Đừng mất các
   chỉnh sửa tài liệu chưa commit. Tra [bàn giao kỹ thuật](docs/audits/MENTEE_OFFLINE_RELEASE_20260927.md).
2. Nhận địa chỉ chính xác: tên cơ sở/địa điểm, địa chỉ đầy đủ, nơi tập trung
   check-in, bản đồ nếu có. Đưa thẳng vào **email mời** và trang đặt ca; điền các
   ô chờ trong HTML/PDF hướng dẫn, xuất và kiểm PDF lại. Không gửi bản có placeholder
   hoặc câu hẹn báo địa điểm sau. Nếu hai ngày khác địa điểm, thể hiện đúng từng ngày.
3. Hoàn thiện đường gửi do hệ thống thực hiện sau một lệnh của chủ chương trình,
   không bắt Support bấm nút từng lô trong CRM. Ưu tiên tái sử dụng cơ chế claim,
   chống trùng, ghi log và hạn mức trong `lib/mentee-invite-dispatch.ts` cùng
   `lib/mentee-invite-dispatch-core.ts`; không bỏ các chốt này để gửi nhanh.
   Cách thực hiện cụ thể chưa chốt; không tự tạo lịch gửi định kỳ.
4. Kiểm nội dung thư thực tế, kể cả mẫu riêng đã lưu ưu tiên hơn mặc định:
   `lib/email-core.ts`, `lib/email-automation.ts`, `lib/email.ts` và mẫu
   `mentee_session_invite`. Email cần địa chỉ + link riêng chọn ca. Chọn ca hiện
   xác nhận và QR tải ảnh ngay tại trang; **không có email xác nhận thứ hai**.
5. Chốt danh sách được duyệt mời đợt 03–04/10, đối chiếu email, người đã nhận thư,
   người đã đặt ca và hồ sơ đã rút. Không tự thêm danh sách chờ/cần xem thêm.
   Đếm lại dữ liệu thật, không lấy số lượng trong tài liệu cũ làm danh sách gửi.
6. Đối chiếu hạn mức: hiện cấu hình 300 thư/24h toàn hệ thống, chừa 80 thư cho
   việc khác, mỗi lượt tối đa 40 thư. Gửi đồng loạt có thể xử lý nhiều lô; không
   hứa gửi hết cùng lúc hoặc tự nâng hạn mức/gói. Nếu không kịp hạn chọn ca hiện
   tại 23:59 ngày 30/09, báo chủ dự án để quyết định trước khi thực hiện.
7. Hoàn tất kiểm thử và triển khai theo `CLAUDE.md`: đúng project VAM
   `qkkroesfiazsejkzflcd`, migration trước merge, kiểm trang chọn ca/QR trên bản
   đã triển khai rồi mới gửi link thật. Thực hiện các bước production theo quyền
   đã được chủ dự án cấp, không suy diễn quyền từ yêu cầu ghi bàn giao.
8. Khi chủ chương trình giao gửi, thực hiện đợt gửi đúng danh sách/nội dung đã
   chốt; báo số đã gửi, lỗi, chờ hạn mức và trạng thái hoàn tất. Không gửi lại
   hàng loạt cho người đã nhận; xử lý retry theo log và cơ chế chống trùng.

### Những điểm giữ nguyên

- 03–04/10, ca 30 phút, tối đa 25 mentee/ca; 5 phòng × 5 mentor mỗi phòng.
- Support tự điều phối phòng/bàn; QR hoặc SĐT để check-in. Người phỏng vấn giữ
  bộ 5 điểm hiện tại, chốt đạt/không chọn/cần xem thêm; nhận mentee là chốt đạt,
  ghép đúng mentor và trừ suất. Sửa nhầm có lý do, log và hoàn suất khi bỏ nhận.
- **Email kết quả đậu/rớt là đợt riêng, chưa được yêu cầu gửi.**
- Tài liệu Support mới nhất:
  `docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.html` và `.pdf`.
  Bản này là kế hoạch rà soát, chưa phải xác nhận mọi chức năng đã chạy thật.

## Đã xong, đang chạy thật trên production

- **Giai đoạn 1 phỏng vấn mentor 1:1** (đợt 22/09–05/10/2026, lịch trao đổi với
  core team qua `/dat-lich/<token>`) và **giai đoạn 1 phỏng vấn mentee trực tiếp**
  (03 & 04/10/2026, 24 ca × 25 ghế, đặt ca qua `/dat-ca/<token>`) đều đã lên
  production. Migration liên quan đã dán tay và đã kiểm lại. PR #165 đã merge.

## PR đang mở, chờ chủ dự án

**Kế hoạch mới chốt cuối 27/09:** chờ địa chỉ chính xác ngày 28/09 để đưa vào email.
Chủ chương trình sẽ giao hệ thống gửi đồng loạt ngày 28/09; Support không bấm gửi
trong CRM. Chưa có lịch tự gửi. PDF Support đã cập nhật kế hoạch này, gồm mẫu thư
chờ điền địa chỉ. Phần gửi từ hệ thống cần chuẩn bị/kiểm tra khi nhận lệnh; chưa
được coi là đã triển khai chỉ vì tài liệu đã sửa.

**Cập nhật 27/09 (Claude Code):** #166, #167, #168, #171 đều MERGED và deploy
thành công. **Chỉ còn [#170](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/170)
đang mở** — luồng phỏng vấn mentee offline (QR tại trang, check-in/phân phòng,
chốt kết quả, mentor nhận mentee). Migration `20260927090000_mentee_offline_workflow.sql`
**đã dán và kiểm chứng trên Production trước khi mở PR**. Nhánh đã được hợp
nhất với `main` mới nhất (giải xung đột với #171 ở `lib/nav-model.ts`,
`app/interviews/page.tsx`, `app/reviews/[id]/page.tsx` và hai file test —
đều là hai link điều hướng chèn cùng chỗ, giữ cả hai). Chi tiết kiểm thử, UAT
và triển khai: [bàn giao offline](docs/audits/MENTEE_OFFLINE_RELEASE_20260927.md).

Kiểm lại bằng `gh pr list --state open` trước khi tin bảng dưới — đây là ảnh
chụp lúc viết file này:

| PR | Nội dung | Có migration? | Trạng thái |
|---|---|---|---|
| [#166](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/166) | Hướng dẫn PDF hai trang cho BTC chạy phỏng vấn mentee giai đoạn 1 | Không | MERGED |
| [#167](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/167) | Đặt hạn chấm mới khi đổi người review | Có — đã dán | MERGED |
| [#168](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/168) | Link mở thẳng hồ sơ ứng viên trong thư và lưới lịch phỏng vấn | Không | MERGED |
| [#171](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/171) | Xem lại application và kết quả phỏng vấn mentor S12, xuất PDF/Excel | Không | MERGED |
| [#170](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/170) | Phỏng vấn mentee offline 03–04/10: QR, check-in, phân phòng, chấm, nhận mentee | Có — **đã dán và kiểm chứng** | **OPEN — chờ chủ dự án merge** |

Mỗi PR đã qua đủ bốn cổng (typecheck/lint/vitest/build) và đã tiêm lỗi để chứng
minh ca test mới bắt được — chi tiết nằm trong mô tả từng PR.

## Việc chưa làm, có chủ ý — chờ chủ dự án quyết

- **129 mentor apply mới bị xếp "danh sách chờ" + 16 "cần core team xem thêm"**
  (S12) chưa được xếp vào giai đoạn phỏng vấn nào, kể cả giai đoạn 2 (dự kiến
  10–11/10, chưa có migration).
- Chưa có **thư nhắc** cho mentee/mentor đã nhận thư mời chọn ca/giờ mà chưa chọn
  — bảng mời đã có sẵn cột `send_count` để dựng việc đó khi cần.
- Hạn đặt ca/chọn giờ hiện chỉ đổi được bằng SQL tay; màn hình chưa có ô sửa hạn.

## Chỗ tra thêm khi cần

- `C:\Users\DELL\.claude\projects\D--AI-App-Embassy-VAM-Platform-vam-os-admin-portal\memory\MEMORY.md`
  — quyết định của chủ dự án qua từng giai đoạn S12, các lần dữ liệu production bị
  lộ/sai và cách đã sửa, các quy ước chưa ghi trong `CLAUDE.md`.
- `docs/audits/` — báo cáo rà soát trạng thái production trước đây (có thể cũ hơn
  bảng PR ở trên).
