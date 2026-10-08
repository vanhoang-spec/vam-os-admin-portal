# Bàn giao VAM OS cho Codex — 08/10/2026, 23:00

Người bàn giao: Claude Code (phiên làm việc với anh Hoàng từ 07/10 đến 08/10/2026).
Người nhận: Codex, làm tiếp trong vài ngày tới.

**Đọc theo thứ tự trước khi làm bất cứ việc gì:**
1. `CLAUDE.md` ở gốc repo. Đây là luật của dự án, áp dụng cho mọi tác tử. Phần lớn luật trong đó đã phải trả giá bằng lỗi thật trên production.
2. File này.

---

## 1. Bối cảnh trong một đoạn

VAM OS là CRM nội bộ của Vietnam Alumni Mentoring, chạy tại `os.alumni-mentoring.edu.vn`. Hiện phục vụ Ban tổ chức (BTC) **UEH Mentoring mùa 12 (S12)**, đang ở giữa đợt tuyển và ghép cặp mentor – mentee.

Người làm việc trực tiếp với bạn là **anh Hoàng** (BTC, `super_admin`, GitHub `vanhoang-spec`). Anh trao đổi bằng tiếng Việt, ra quyết định nhanh, thường nhắn ngắn: "merge luôn", "đã dán sql". Các thành viên BTC khác (Mỹ Anh, Hoàng Vy, Tường Vy, …) dùng CRM hằng ngày và tự bấm gửi thư.

**Mỗi lần merge vào `main` là một lần deploy lên dữ liệu thật của người thật.**

---

## 2. Định danh và hạ tầng

| Thứ | Giá trị |
|---|---|
| Repo | `vanhoang-spec/vam-os-admin-portal`, nhánh chính `main` |
| Production | `os.alumni-mentoring.edu.vn` (Vercel team `tcm17`, region `sin1`) |
| Deploy | Merge vào `main` → `.github/workflows/vercel-production.yml` (tên run: "Vercel Production Deployment") chạy typecheck → test → build → deploy, khoảng 5–7 phút. **Workflow này không chạy migration.** |
| CI của PR | Job "Typecheck, lint, test, build", khoảng 4–6 phút |
| Supabase | project `vam-os-mvp`, ref `qkkroesfiazsejkzflcd` |
| Mùa S12 | `seasons.code = 'UEHM-S12'`, id `32fbfc86-1d67-4158-b9d4-1e6bff48b2c1` |
| Tài khoản anh Hoàng | `admin_users.id = a3f45586-8747-49d9-860a-4b903cfdc7bc` (super_admin) |
| Thư | Gửi qua **Resend** từ 06/10, From `hello@alumni-mentoring.edu.vn`. Một trần chung **1.000 thư / 24 giờ**, tối đa **40 thư mỗi lần bấm** (`lib/email-quota-core.ts`). Brevo còn làm đường lui tới khoảng 13/10 rồi anh Hoàng huỷ. |

---

## 3. Cách làm việc với anh Hoàng (bắt buộc)

- **Tiếng Việt** cho mọi chữ người dùng thấy và cho trao đổi. Trả lời ngắn, có số liệu cụ thể, nói rõ ai phải làm bước tiếp theo.
- **Không tự gửi thư, không tự bấm nút gửi.** Mọi việc gửi ra ngoài (thư, lời mời tài khoản) do BTC bấm. Bạn làm đến bước "sẵn sàng để gửi", rồi hướng dẫn BTC bấm ở đâu.
- **Không tạo tài khoản quản trị hộ.** BTC tạo ở *Quản lý người dùng* (`/admin/users`); hệ thống tự gửi thư mời.
- **SQL do anh Hoàng dán tay** vào Supabase SQL Editor (Production):
  - Ghi thành file `supabase/migrations/YYYYMMDDHHMMSS_ten_snake_case.sql` và đưa anh **đường dẫn file trong repo**. Đừng dán SQL vào chat, đừng dùng clipboard.
  - File phải dán **TRƯỚC** khi merge PR cần nó.
  - Mỗi file kết thúc bằng khối `do $$ … $$` tự kiểm, `raise` nếu thiếu thứ gì. File sửa dữ liệu nên có một câu `select` cuối, để anh thấy bảng kết quả.
  - Khi SQL còn chờ anh dán, **đừng rời nhánh chứa file**. Ô xem file của anh đọc file trên đĩa.
  - Không dùng temp table trong SQL dán tay: chạy lại một đoạn sẽ vỡ. Viết mỗi bước bằng một câu lệnh có CTE.
- **Chỉ merge khi anh nói rõ** ("merge luôn", "merge và deploy luôn"). Câu "đã dán sql" chưa phải lệnh merge.
  - Trước khi merge: kiểm production đã có thứ SQL tạo ra, kiểm CI xanh và `main` chưa đổi kể từ lúc chạy bốn cổng.
  - Sau khi merge: theo dõi run deploy tới khi xong, báo anh giờ lên production (giờ Việt Nam).
- **Không merge / deploy trong giờ phỏng vấn mentee 10–11/10** (sáng đến chiều Thứ Bảy và Chủ nhật). Deploy giữa ca từng làm hỏng phiên đăng nhập đang mở.
- **Không đổi nameserver, MX, SPF, DMARC.** Không dán khoá `service_role` / `sb_secret_` / API key ở đâu ngoài biến môi trường. Đừng bảo anh dán khoá vào chat.
- **Commit message:** tiếng Việt không dấu, dạng `feat(khu-vuc): ...` / `fix(...)` / `ops(...)`. Tiêu đề và nội dung PR: tiếng Việt có dấu, gồm các mục Vì sao / Thay đổi / Kiểm / Sau khi merge.

### Chất lượng (theo CLAUDE.md, tóm lại)

- **Đủ bốn cổng trước khi mở PR:** `npm run typecheck`, `npm run lint`, `npx vitest run` (hiện 8.854 ca), `npm run build`.
- **Cố ý làm hỏng mã** theo đúng cách lỗi có thể xảy ra, rồi xác nhận test chuyển đỏ. Cách tiện nhất: viết một script node thay một đoạn mã → chạy test → khôi phục, lặp qua danh sách đột biến. Đọc file rồi đổi CRLF về LF trước khi so chuỗi, vì vài file trong repo dùng CRLF. Nếu một đột biến vẫn xanh, sửa test, hoặc ghi rõ vì sao nó tương đương mã gốc.
- **Quét ký tự ẩn** trong file vừa sửa: U+0000–U+001F (trừ tab / LF / CR), U+0300–U+036F, U+FEFF.
- **Dấu gạch chéo ngược và escape `\uXXXX`** dễ hỏng khi ghi qua heredoc hoặc công cụ ghi file. Ghi xong phải `grep` lại đúng dòng đó.
- **React 18.3.1:** dùng `useFormState` của `react-dom`, không dùng `useActionState`.
- **Múi giờ:** mọi hiển thị ngày giờ đi qua `lib/utils.ts` (`formatDate`, `formatDateTime`, …). Ngày ghi vào cột DATE dùng `vietnamDateKey`. Đồng hồ shell và vitest chạy UTC, nên giờ thật lấy bằng `now()` trên Supabase.
- **Lint trong worktree** (`.claude/worktrees/*`): `next lint` có thể báo "Plugin @next/next was conflicted". Khi đó chạy `npx eslint --no-eslintrc -c .eslintrc.json <file>`.

---

## 4. Trạng thái lúc bàn giao (đọc production 08/10, 22:56)

### Đã lên production trong hai ngày 07–08/10

| PR | Nội dung |
|---|---|
| #225 | Mọi danh sách xếp **mới nhất trước** (`lib/list-order.ts`). "Công việc của tôi": việc còn nợ lên đầu. |
| #226 | Nhóm nhận thư `mentee_cv_rejected` (mentee rớt vòng hồ sơ) + sửa mẫu thư rớt. |
| #227 | Thư xác nhận lịch PV cho mentor đọc sheet đợt 2 qua `/export?format=csv`; hướng dẫn theo buổi ở `MENTOR_BLOCK_GUIDES`. |
| #228, #229 | Chiều Thứ Bảy 10/10 **phỏng vấn online qua nhóm Zalo** (7 ca 13:30–17:00) + thư báo online (đã báo 85 bạn). |
| #230 | Nhóm thư rớt CV tự bỏ người đã nhận thư ở lô trước. |
| #231 | Nút "Mở lại link gia hạn" cho mentor đã từ chối rồi đổi ý (`/admin/renewals`). |
| #232 | Nhóm thư `mentee_invite_withdrawn`: 12 bạn đã nhận thư mời PV rồi bị rớt CV. **Mỗi người chỉ nhận một lá thư rớt**, dù thuộc nhóm nào. |
| #233 | **Support team đổi / xác nhận được nhóm ngành Vòng 2** (cổng `vam114_round2_group_editor_for_season`). |
| #234 | Trang Vòng 2: cột Hồ sơ thêm *Công ty*; bấm tên mở hồ sơ ở tab mới. |
| #235 | 16 mentor nhóm 1 có công ty không phải ngân hàng / bảo hiểm → chuyển nhóm 3 (SQL đã dán). Sửa luôn lỗi báo "Dữ liệu đổi nhóm" nhầm cho người BTC đã rà. |
| #236 | **Báo cáo tuyển mentor** `/interviews/bao-cao-mentor`, mục đầu nhánh Tuyển Mentor (merge 22:53 08/10). |

### Số liệu thật

**Thư rớt mentee đã gửi đủ**

| Lô | Nhóm | Số thư | Giờ gửi |
|---|---|---|---|
| Sáng | Rớt CV | 146 | 08/10 08:24 |
| Tối | Rớt CV | 11 | 08/10 19:14 |
| Tối | Nhận thư mời PV rồi rớt CV | 12 | 08/10 19:19 |

**PV mentee đợt 2:** 14 ca ngày 10/10 với 198 chỗ đã giữ; 14 ca ngày 11/10 với 180 chỗ đã giữ.

**Ghép cặp**
- 49 cặp đang hoạt động, đều là **vòng 1**: mentee được chính người phỏng vấn nhận ngay tại buổi.
- **Vòng 2 chưa mở** (`matching_round2_settings` trống) và chưa gửi link nào.
- 102 người còn cờ "Cần BTC xem" ở trang phân nhóm.

**Tuyển mentor mới**
- 274 đơn → 237 vào vòng phỏng vấn → 177 đã phỏng vấn → 110 mentor chính thức.
- 75 người đã phỏng vấn, đang chờ BTC chốt.

**Mentor gia hạn:** mời 468 người, 271 đồng ý.

---

## 5. Lịch mấy ngày tới và việc đang chờ

### Mốc thời gian

| Khi nào | Việc | Ghi chú |
|---|---|---|
| **Thứ Sáu 09/10, 17:00** | Hạn mentee chọn ca PV đợt 2 | Hạn riêng từng người nằm ở `mentee_interview_invites.booking_open_until`. |
| **Thứ Bảy 10/10** | PV mentee đợt 2 | Sáng: Cơ sở E (phòng E501, E502, E504). Chiều: **online qua Zalo**, Support Team điều phối, mentor đang trống gửi link phòng cho mentee. Màn hình: `/interviews/mentee-offline?dot=2026-10-10`. **Không deploy.** |
| **Chủ nhật 11/10** | PV mentee đợt 2 tại Cơ sở B | Hết đợt lịch PV mentor 1:1 (`INTERVIEW_WINDOW.lastDateKey = "2026-10-11"` trong `lib/interview-schedule-core.ts`). **Không deploy.** |
| Sau 11/10 | Báo cáo PV mentee đợt 2 | Số liệu tự có ở `/interviews/bao-cao-mentee?dot=2026-10-10`. Phần "mẫu hình nhận xét" là bản viết tay trong `lib/mentee-interview-report-notes.ts` (`WAVE_NOTES`); đợt 2 cần một lần đọc toàn bộ phiếu rồi viết thêm khoá `"2026-10-10"`. Mọi con số về điểm phải đối chiếu bằng SQL trước khi ghi; bỏ tên, trường, công ty khỏi trích dẫn. |
| ~13/10 | Anh Hoàng huỷ Brevo | Có thể xoá `BREVO_API_KEY` trên Vercel. Việc của anh, không phải mã. |

Các cặp được nhận ngay tại buổi PV đợt 2 cũng là **vòng 1**: trigger `vam111_interview_take_round` tự gắn, không cần làm tay.

### Vòng 2 ghép cặp: mentor tự chọn mentee cùng nhóm ngành

1. **Đang làm:** BTC và Support team rà nhóm ngành ở `/matches/vong-2`.
   - Bấm tên người để mở hồ sơ; dùng ô "Đổi / xác nhận nhóm", bắt buộc ghi lý do.
   - "Phân loại người mới" chỉ Core team trở lên bấm được.
2. **Khi BTC sẵn sàng:** ở `/matches/vong-2/bao-cao`, đặt giờ mở / đóng → "Gửi thử cho tôi" → "Gửi link chọn mentee" (40 thư mỗi lần bấm).
3. **Sau PV đợt 2:** "Phân loại người mới" → đổi "Đợt gửi thư" sang 2 → gửi. Chỉ mentor còn chỗ mới nhận thư.

Luật đã chốt:
- Số chỗ còn của mentor = min(2, số đăng ký) − số cặp đang hoạt động (tính cả cặp vòng 1).
- Mentor tự bỏ chọn được trong 30 phút; quá hạn thì BTC huỷ cặp ở `/matches`.
- Mentor KHÔNG thấy email, SĐT, MSSV của mentee.

### Đang chờ người khác (đừng tự làm)

- **3 tài khoản Support team** cho Nguyễn Lê Như Quỳnh (`nlnhuquynh173@gmail.com`), Võ Hoàng Khánh Vy (`khanhvy031205@gmail.com`), Dương Bảo Châu (`gocnhocuachauu@gmail.com`).
  - Lúc bàn giao **chưa tạo**. BTC tạo ở `/admin/users` với vai trò Support team, mùa S12, scope **Operations**, trạng thái Kích hoạt.
  - Nếu chọn scope Read thì họ xem được trang nhưng không đổi được nhóm.
  - Tạo xong thì kiểm `admin_users` + `admin_scope_access`.
- **Home Credit** (mentor Nguyễn Thị Bảo Ngân) ở nhóm 1 hay nhóm 3: chờ anh Hoàng quyết.
- **Mentor gia hạn đổi ý** (vd. chị Đặng Thụy Thanh Lan): BTC bấm "Mở lại link gia hạn" trên dòng "Từ chối" ở `/admin/renewals`. Link cũ không khôi phục được vì database chỉ lưu hash.

### Đã đề nghị, anh chưa yêu cầu (chỉ làm khi anh bảo)

- Đưa luật "nhóm 1 mà công ty không phải ngân hàng / bảo hiểm → nhóm 3" vào bộ phân loại tự động (`lib/matching-round2-classify-core.ts`). Hiện luật mới chỉ áp bằng SQL cho người đã có nhóm.
- Hàng việc `/interviews` và `/reviews/assign-bulk`: có đổi sang "cũ nhất trước" (FIFO) không? Anh chưa trả lời.
- Báo cáo tuyển mentor: anh chưa xem số trên trang thật. Nếu anh báo lệch, đối chiếu bằng SQL theo đúng luật trong `lib/mentor-recruitment-report-core.ts`.

---

## 6. Bản đồ mã — những mảng vừa làm

| Mảng | Ở đâu |
|---|---|
| Thư hàng loạt | `lib/bulk-mail-core.ts` (nhóm nhận, nhãn, gợi ý), `lib/bulk-mail.ts` (chọn người nhận, `runEmailBatch`). Mẫu thư (`email_templates`, kind `general_announcement`) phải `approved` mới gửi được. Thêm nhóm nhận = nới `email_batches_audience_check` **theo lối cộng thêm** (khuôn: `20261008180000_thu_rut_loi_moi_pv.sql`). |
| PV mentee trực tiếp | RPC `vam104_*` (`vam104_offline_dashboard`, …). Mã: `lib/mentee-offline*.ts`, màn hình `/interviews/mentee-offline`. Ca: `/interviews/ca-mentee`. Link mentee chọn ca: `/dat-ca/[token]`. Đợt: `lib/mentee-interview-waves.ts` (thêm đợt 3 = thêm một dòng vào `MENTEE_INTERVIEW_WAVE_LINKS`). |
| Phòng / bàn PV | Suy ra từ địa điểm ca dạng "Phòng a, b, … — Cơ sở …" (trigger `vam104_room_desk_bounds_guard`, phía màn hình `roomDeskBounds`). Đổi thứ tự phòng trong địa điểm là đổi nghĩa số phòng đã phân. Địa điểm online (`isOnlineVenue`) hiển thị link bấm được (`lib/text-links.ts`). |
| Vòng 2 | `lib/matching-round2*.ts`. RPC: `vam112_*` (lưu / đổi nhóm), `vam113_*` (mở vòng, pick / unpick), `vam114_round2_group_editor_for_season` (cổng đổi nhóm, có Support team). Trang: `/matches/vong-2`, `/matches/vong-2/bao-cao`, `/chon-mentee/[token]`. Nhóm đã lưu bị trigger khoá; chỉ đổi qua `vam112_set_industry_group` (có lý do, có log). |
| Báo cáo | `/interviews/bao-cao-mentee`, `/interviews/bao-cao-mentor`. Bảng đếm chéo dùng chung: `lib/report-crosstab-core.ts` + `components/cross-tab-table.tsx`. Cấp bậc từ chức danh: `lib/mentor-seniority-core.ts`. Gộp tên công ty: `lib/company-name-core.ts`. Hai bộ này bị khoá bằng dữ liệu thật trong `__tests__/fixtures/mentor-*-s12.ts`; đổi luật thì các con số khoá trong test đổi theo, phải xem lại có chủ ý. |
| Phễu tuyển | `lib/recruitment-export.ts` (`deriveDecisions`, `PROVES_SCREENING_PASSED`, …). "Rớt / rút ở vòng nào" đọc từ phiếu phỏng vấn đã nộp + lịch sử quyết định, không đọc từ trạng thái. Mentor gia hạn (`source = 's12_mentor_renewal'`) không qua chấm hồ sơ hay PV; luôn tách khỏi phễu. |
| Gia hạn mentor | `lib/renewal-*.ts`, `/admin/renewals`. Dữ liệu đơn gia hạn nằm dưới `raw_payload.renewal`; đọc qua `applicantPayload` (`lib/matching-quick-view-core.ts`). |
| Quyền | `lib/permissions.ts` (vai trò) + `lib/program-scope.ts` (`canOperateSeason`: scope Operations / Full access theo mùa). Database có `vam084_operator_for_season` (Core team trở lên) và các cổng riêng như vam114. Mọi cổng fail-closed. |
| Đọc nhiều trang | `readAllPages` / `readAllPagesIn` (`lib/paged-read.ts`). Bảng mới phải có trong `PAGE_ORDER`. |

---

## 7. Bẫy đã gặp — đừng giẫm lại

- **Có trong repo ≠ có trên production.** Trước khi dựa vào một bảng / hàm / cột, kiểm catalog production (`to_regprocedure`, `information_schema`). Ví dụ: `account_person_auth_links` không có trên prod.
- **Gọi RPC sửa dữ liệu từ SQL Editor.** Các hàm `vam1xx` kiểm `current_user = 'service_role'`, nên chạy thẳng sẽ bị `ACCESS_DENIED`. Cách đúng: trong khối `do`, `set local role service_role;` → gọi hàm với `p_actor` là anh Hoàng → `reset role;`. Khuôn: `20261008223000_vong_2_mentor_nhom_1_sang_nhom_3.sql` (có test PGlite đi kèm).
- **Thân hàm trên production có CRLF** (dán từ Windows). So thân hàm thì bỏ `chr(13)` trước khi `md5`.
- **Thêm giá trị vào CHECK:** đọc `pg_get_constraintdef` rồi nối thêm. Đừng viết đè cả danh sách.
- **Bảng mới trong `public`:** bật RLS và thu hồi quyền `anon` / `authenticated` ngay trong migration tạo bảng. View phải có `security_invoker = on`.
- **Hai token đơn đăng ký là MỘT cấu hình:** đặt `VAM_OS_APPLY_TOKEN` sẽ làm chết mọi link đã gửi.
- **Duyệt mentor tạo tư cách mùa** bằng trigger (từ 03/10). Đơn rút (`withdrawn`) vẫn chặn đơn gia hạn cùng email; gỡ bằng cách đổi email của đơn rút.
- **Đơn mentor mới chưa duyệt có `person_id` NULL.** Gộp đơn trùng theo email, chữ thường.
- **Sheet Google:** đọc qua `/export?format=csv&gid=`. Cách gviz làm mất hàng tiêu đề nhiều dòng.
- **Middleware làm mới mã đăng nhập** phải chuyển mã mới tới cả request lẫn trình duyệt. Triệu chứng của lỗi này: "gửi lần đầu hỏng, tải lại thì được".
- **Thư cho mentor:** mỗi mentor một thư. Cấp quyền dùng `notify:false`; link đặt mật khẩu chỉ nằm trong thư thật.
- **Đã bỏ khoá bàn PV mentee:** mentor nhận bạn kế tiếp trước khi nộp phiếu; chống trùng bằng lời nhắc, không bằng ràng buộc DB.
- **Anh Hoàng gõ tiếng Việt bằng Unikey;** dán SQL đôi khi dính ký tự lạ (`syntax error at or near "v"`). Khi đó chưa có gì chạy; bảo anh dán lại.
- **Trình duyệt tự động** không hiện hộp `confirm()`. Xác nhận hai bước phải làm ngay trên trang.

---

## 8. Quy trình một việc điển hình

1. Tạo nhánh từ `main` mới nhất. Nếu một file SQL khác còn chờ anh dán, làm trong worktree riêng.
2. Đọc mã liên quan và dữ liệu thật trên production, nếu có quyền đọc. Không có quyền thì viết câu `select` vào file, nhờ anh chạy.
3. Sửa mã theo nếp của file xung quanh. Chú thích bằng tiếng Việt, nói *vì sao*. Đường ghi phải hẹp: sửa một trường thì viết hàm chỉ chạm trường đó.
4. Viết test. Khẳng định chính các lệnh ghi mà mã phát ra, không chỉ giá trị trả về. Ca "không được ghi gì" quan trọng ngang ca "ghi đúng". Cố ý làm hỏng mã để thấy test đỏ.
5. Chạy đủ bốn cổng, quét ký tự ẩn, commit, push, mở PR.
6. Có SQL: đưa anh đường dẫn file. Chờ anh báo "đã dán", rồi tự kiểm production đã có thứ SQL tạo ra.
7. Chờ anh nói "merge". Kiểm CI xanh, merge, theo dõi deploy, báo giờ lên production.
8. Nếu sau deploy BTC phải làm gì (duyệt mẫu thư, bấm gửi, tạo tài khoản…), ghi rõ từng bước: ở trang nào, bấm nút gì, gõ gì.

---

Câu hỏi nghiệp vụ (ai nhận thư, luật xếp nhóm, ngày giờ, nội dung thư) thì **hỏi anh Hoàng, đừng đoán**. Câu hỏi kỹ thuật thì đọc mã và dữ liệu trước khi hỏi.
