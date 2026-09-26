# Bàn giao AI — VAM OS

**Cập nhật lần cuối: 27/09/2026, bởi Claude Code.** Càng xa ngày này càng nên tự
kiểm lại bằng `git log` / `gh pr list` thay vì tin nguyên văn — xem bước 2 của
`CODEX_BAT_DAU.md`.

## Đã xong, đang chạy thật trên production

- **Giai đoạn 1 phỏng vấn mentor 1:1** (đợt 22/09–05/10/2026, lịch trao đổi với
  core team qua `/dat-lich/<token>`) và **giai đoạn 1 phỏng vấn mentee trực tiếp**
  (03 & 04/10/2026, 24 ca × 25 ghế, đặt ca qua `/dat-ca/<token>`) đều đã lên
  production. Migration liên quan đã dán tay và đã kiểm lại. PR #165 đã merge.

## PR đang mở, chờ chủ dự án

Kiểm lại bằng `gh pr list --state open` — dưới đây là ảnh chụp lúc viết file này,
ba PR đều tách nhánh từ `origin/main`, độc lập nhau, không PR nào chặn PR nào:

| PR | Nội dung | Có migration? | Đang chờ |
|---|---|---|---|
| [#166](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/166) | Hướng dẫn PDF hai trang cho BTC chạy phỏng vấn mentee giai đoạn 1 | Không | Chủ dự án đọc và cho merge |
| [#167](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/167) | Đặt hạn chấm mới khi đổi người review (form "Đổi Người Review" thêm ô "Hạn chấm mới") | **Có** — `supabase/migrations/20260926140000_reassign_review_new_due.sql`, chỉ THÊM một hàm, chưa dán | **Dán migration vào Supabase SQL Editor (Production) trước**, rồi mới merge |
| [#168](https://github.com/vanhoang-spec/vam-os-admin-portal/pull/168) | Thư báo interviewer và lưới lịch phỏng vấn mang link mở thẳng hồ sơ ứng viên (`/reviews/<id>`) thay vì trang danh sách | Không | Chủ dự án đọc và cho merge |

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
