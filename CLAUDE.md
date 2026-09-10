# VAM OS — hướng dẫn cho Claude Code

Cổng quản trị nội bộ của Vietnam Alumni Mentoring. Next.js 15 (App Router) +
Supabase + Tailwind. Chạy thật tại `os.alumni-mentoring.edu.vn`, phục vụ ban tổ
chức UEH Mentoring — **mỗi lần deploy đều chạm vào dữ liệu thật của người thật.**

File này ghi những thứ không đọc ra được từ mã nguồn, hoặc đọc ra được nhưng
phải trả giá mới biết.

---

## Lệnh

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npx vitest run      # ~5.300 ca
npm run build       # next build
npm run dev         # có sẵn .env.local thì chạy được
```

**Chạy đủ cả bốn trước khi mở PR.** Chúng bắt những thứ khác nhau và không cái
nào thay được cái nào — xem mục "Bốn cổng" bên dưới.

---

## Những chỗ đã làm gãy sản phẩm, đừng làm lại

### React 18.3.1, không phải 19

Dùng `useFormState` của **`react-dom`**, không phải `useActionState` của
`react`.

`@types/react` có khai báo `useActionState`, nên nó **qua được typecheck, lint
và build** rồi mới vỡ lúc chạy — người dùng gặp trang trắng, còn cả bốn cổng
đều xanh. Chỉ một ca test component mới bắt được.

### Múi giờ: mọi mốc thời gian đi qua một cửa

Máy phát triển đặt giờ Việt Nam; Vercel chạy **UTC**. Một hàm định dạng quên ấn
định múi giờ vì thế **đúng trên máy và sai trên production**, và mọi ca test
cũng xanh trên máy.

- Hiển thị: `formatDate` · `formatTime` · `formatDateTime` · `formatTimeRange`
  trong `lib/utils.ts`. Đừng tự ghép `new Date().toLocaleString()`.
- Ô nhập ngày giờ: `lib/event-datetime.ts` + `app/events/vietnam-datetime-field.tsx`.
  `<input type="datetime-local">` hiển thị theo ngôn ngữ **trình duyệt**, nên
  Chrome tiếng Anh vẽ `mm/dd/yyyy`. Không thuộc tính HTML hay CSS nào bắt nó đổi.
- `vitest.config.ts` đặt `process.env.TZ = "UTC"` **trước** khi vitest nạp bất
  cứ thứ gì, để test chạy đúng múi giờ production.

Định dạng ngày xuyên suốt sản phẩm là **DD/MM/YYYY**.

### Migration phải dán tay TRƯỚC khi merge

Merge vào `main` → `.github/workflows/vercel-production.yml` tự test, build và
deploy. **Nó KHÔNG chạy migration.**

Có migration thì dán vào Supabase SQL Editor (Production) **trước**, rồi mới
merge. Merge trước thì mã mới gọi vào bảng chưa tồn tại.

Quy ước tên: `supabase/migrations/YYYYMMDDHHMMSS_snake_case.sql`. Thư mục cũ
`supabase_migrations/` (đánh số `NNN_`) là lịch sử, đừng thêm file mới vào đó.

### Nới ràng buộc CHECK theo lối cộng thêm, đừng viết đè

Muốn thêm một giá trị vào `outbound_emails_kind_check` (hoặc tương tự): đọc lại
định nghĩa hiện có bằng `pg_get_constraintdef` rồi nối thêm — xem khuôn ở
`supabase/migrations/20260910240000_event_schedule_change_notice.sql`.

Viết đè cả danh sách nghĩa là mỗi lần thêm phải chép đúng toàn bộ giá trị đã
có, và chép thiếu một cái thì những dòng loại đó lặng lẽ ngừng ghi được.

Mỗi migration nên kết thúc bằng một khối `do $$` tự kiểm, raise nếu thiếu thứ
gì. Migration báo thành công trong khi cột chưa được thêm là thứ chỉ lộ ra vào
lúc cần nó nhất.

### Bash heredoc trên máy này nuốt dấu gạch chéo ngược

`cat > file <<'EOF'` làm mất một lớp `\`, kể cả heredoc đã trích dẫn. `/\s+/g`
thành `/s+/g` — vẫn là regex hợp lệ, vẫn qua cả bốn cổng, nhưng thay chữ "s"
bằng khoảng trắng thay vì gộp khoảng trắng.

Nội dung có dấu gạch chéo ngược thì dùng công cụ Write, hoặc dựng ký tự bằng
`String.fromCharCode(92)` trong script node. Ghi xong `grep` lại đúng dòng đó.

---

## Bốn cổng, và cái mỗi cổng bắt được

| Cổng | Bắt được thứ mà cổng khác không bắt |
|---|---|
| `typecheck` | Sai kiểu, gọi hàm không tồn tại |
| `lint` | Hook gọi sai chỗ, biến thừa |
| `vitest` | **Hành vi.** Cổng duy nhất bắt được `useActionState` |
| `build` | Ranh giới server/client component — sai ở đó biên dịch sạch, hỏng lúc chạy |

---

## Nếp viết test của dự án này

**Một ca test chưa dựng lại được lỗi thì chưa biết nó có bắt được lỗi hay
không.** Viết xong test, hãy cố ý làm hỏng mã theo đúng cách lỗi đó xảy ra và
xác nhận test đỏ. Nếu nó vẫn xanh, thứ cần sửa là test.

Nếp này đã tìm ra lỗi thật nhiều lần, và lần nào cũng là lỗi qua được cả bốn
cổng. Vài ví dụ có thật:

- `venueKey` mất một dấu gạch chéo ngược trong regex
- Bản giả Supabase nuốt lệnh `.order()`, nên nó xanh y hệt cho bản đọc sai thứ tự
- Câu kiểm "form mang đúng id" khớp nhầm form xoá ở cùng dòng

Vài thói quen đi kèm:

- Khẳng định **chính các lệnh ghi** mà hàm phát ra, không chỉ giá trị trả về
- Soi đúng phần tử cần soi, đừng tìm chung cả trang — một chuỗi trùng ở chỗ
  khác sẽ làm test xanh vô nghĩa
- Ca "không được ghi gì cả" quan trọng ngang ca "ghi đúng"

---

## Quy ước mã

- **Tiếng Việt** cho mọi chữ người dùng thấy, và cho chú thích giải thích *vì
  sao*. Chú thích nói lý do và cái giá của lựa chọn khác, không mô tả lại dòng
  bên dưới.
- **Một cửa cho một việc.** Ba cách viết khoảng thời gian là ba cơ hội để một
  trong ba nói sai. Thấy logic lặp lần thứ ba thì gom lại.
- **Fail-closed ở mọi cổng quyền.** Không đọc được bảng thì trả `false`. Một
  lỗi hạ tầng không được biến thành quyền.
- **Đường ghi hẹp.** Sửa một trường thì viết hàm chỉ chạm trường đó, đừng gọi
  hàm cập nhật cả biểu mẫu — ô nào không có mặt trên màn hình sẽ ghi đè lên giá
  trị đang đúng.
- **Cái đến từ biểu mẫu là thứ người gửi tự đặt được.** Ô chọn đã lọc trên màn
  hình không phải một phép kiểm; hàm ghi phải tự kiểm lại.

---

## Bố cục

```
app/                     App Router
  actions/               server action ("use server")
  api/exports/           route tải file CSV
  events/ operations/ reviews/ applications/ matches/
  register/ checkin/ ve/ renew/ apply/    công khai, không cần đăng nhập
lib/                     nghiệp vụ; *-core.ts là phần thuần, không I/O
components/ui.tsx        Card · SimpleTable · KpiCard · EmptyState · PageHeader
supabase/migrations/     migration hiện hành (timestamp)
__tests__/               vitest
docs/huong-dan/          hướng dẫn PDF cho người vận hành
```

Tách `*-core.ts` là có chủ ý: phần thuần kiểm được mà không phải dựng bản giả
của database.

---

## Vận hành

- Deploy = merge vào `main`. Không có bước bấm tay.
- Thư đi qua **Brevo**, gửi từ `hello@alumni-mentoring.edu.vn`.
- Không dán khoá `service_role` / `sb_secret_` vào bất cứ đâu ngoài biến môi
  trường.
- Đổi nameserver khỏi PA Vietnam sẽ phá MX và hộp thư `hello@`. Đừng.
- File CSV xuất ra mang họ tên, email, SĐT, MSSV của hàng trăm người. Cổng tải
  hẹp hơn cổng đọc trang, và đó là cố ý.
