# Bàn giao Vercel — tiếp theo, từ điểm hiện tại

*Ngày 07/09/2026. Phần GitHub đã xong; tài liệu này chỉ lo Vercel.*

> **Tài liệu này được thực thi bởi hai bên, mỗi bên có thể dùng Claude hỗ trợ.**
> Mục "Quy ước cho hai bên" ở ngay dưới là bắt buộc đọc trước khi bấm bất cứ gì.

---

## Điểm xuất phát — đã xác minh 21:18 ngày 07/09/2026

| Thứ | Trạng thái |
|---|---|
| **GitHub** | ✅ Đã chuyển. Chủ sở hữu là `vanhoang-spec`, bản gốc không phải fork, đường dẫn cũ tự chuyển hướng. |
| **Cách deploy** | Qua GitHub Actions — `.github/workflows/vercel-production.yml`, chạy mỗi khi có commit vào `main` |
| **Ba khoá deploy** | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — nằm ở GitHub, *Settings → Environments → Production*. Còn nguyên sau khi chuyển kho, **vẫn trỏ vào Vercel của anh Thắng** |
| **Deploy gần nhất** | 07/09/2026 lúc 10:55 — **thành công**. Hệ thống đang chạy bình thường. |
| **Vercel** | ❌ Chưa chuyển. Đây là việc của tài liệu này. |

**Điều quan trọng cần hiểu:** trang web hiện chạy tốt và sẽ tiếp tục chạy tốt trong
suốt quá trình này. Không có gì gấp. Chừng nào ba khoá chưa đổi thì mỗi commit vẫn
deploy lên Vercel của anh Thắng như thường.

---

## Quy ước cho hai bên

Gọi tắt:

- **Bên A** — anh Thắng, chủ tài khoản Vercel hiện tại
- **Bên B** — anh Hoàng, chủ tài khoản Vercel đích và chủ kho GitHub

### Bốn điều Claude của cả hai bên KHÔNG được tự làm

1. **Không dán giá trị secret vào cuộc trò chuyện.** Bao gồm
   `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_TOKEN`, `BREVO_API_KEY`, `DEEPSEEK_API_KEY`.
   Đọc để đối chiếu độ dài hay 4 ký tự đầu thì được; dán trọn giá trị thì không.
   Nếu cần chuyển, người thật chuyển qua kênh riêng.

2. **Không xoá, không thu hồi, không ngắt kết nối gì cho tới Bước 6.** Dự án Vercel
   cũ là lưới an toàn duy nhất. Xoá nó trước khi bản mới chạy được là mất đường lui.

3. **Không đổi tên miền khi chưa xác minh xong Bước 4.** Đây là bước duy nhất người
   dùng cảm nhận được.

4. **Không đoán khi lệnh báo lỗi.** Chép nguyên văn thông báo lỗi và dừng lại hỏi.
   Vercel có nhiều thứ tên gần giống nhau; đoán sai thì sửa mất nhiều thời gian hơn hỏi.

### Điều nên làm

Ưu tiên **kiểm chứng bằng lệnh** thay vì mô tả màn hình. Vercel CLI đọc được trạng
thái thật:

```bash
npm install --global vercel@59.1.3
vercel login
vercel projects ls
```

---

# BƯỚC 1 — Bên A: xem có chuyển thẳng dự án được không

Vercel có chức năng chuyển dự án sang tài khoản khác. **Nếu dùng được thì đây là
đường tốt nhất** — biến môi trường và tên miền đi theo, không phải chép tay 20 biến.

## 1.1 Kiểm tra

Vào [vercel.com/dashboard](https://vercel.com/dashboard) → dự án VAM OS →
**Settings** → **General** → cuộn xuống cuối trang, tìm mục **Transfer Project**.

Ghi lại thấy gì:

| Thấy | Nghĩa là |
|---|---|
| Có nút **Transfer**, bấm được | ✅ Đi tiếp **Bước 2A** |
| Có mục nhưng nút mờ, kèm dòng giải thích | ⚠️ Chép nguyên dòng giải thích đó rồi hỏi |
| Không tìm thấy mục nào tên Transfer | ➡️ Đi **Bước 2B** |

## 1.2 Ghi lại hiện trạng trước khi động vào

Bên A ghi lại và gửi bên B (những thứ này **không phải secret**, gửi thoải mái):

```
- Tên dự án trên Vercel:
- Địa chỉ .vercel.app hiện tại:
- Danh sách tên miền ở tab Domains (chụp màn hình):
- Số lượng biến ở Settings → Environment Variables:
- Gói tài khoản (Hobby / Pro):
```

Danh sách tên miền quyết định có phải làm Bước 5 hay không.

---

# BƯỚC 2A — Chuyển thẳng dự án *(nếu Bước 1.1 cho phép)*

## 2A.1 Bên B chuẩn bị nhận

Bên B đăng nhập [vercel.com](https://vercel.com) bằng tài khoản GitHub
`vanhoang-spec`. Vercel thường yêu cầu bên nhận phải ở cùng một team hoặc phải chấp
nhận lời mời — làm theo đúng những gì màn hình yêu cầu.

## 2A.2 Bên A bấm chuyển

Settings → General → **Transfer Project** → chọn tài khoản đích của bên B → xác nhận.

## 2A.3 Xác minh ngay sau khi chuyển

Bên B chạy:

```bash
vercel projects ls
```

Phải thấy dự án nằm dưới tài khoản của bên B.

**Rồi kiểm ba thứ đi theo hay không:**

| Kiểm tra | Cách xem |
|---|---|
| Biến môi trường | Settings → Environment Variables — đếm có bằng số bên A ghi ở 1.2 không |
| Tên miền | Tab Domains — còn đủ như ảnh chụp không |
| Project ID | Settings → General → *Project ID* — **ghi lại, có thể đã đổi** |

> Nếu số biến môi trường **ít hơn** con số bên A ghi lại, dừng lại và báo. Thiếu một
> biến là trang trắng hoặc một tính năng chết âm thầm.

**Xong Bước 2A thì bỏ qua Bước 2B, sang thẳng Bước 3.**

---

# BƯỚC 2B — Dựng dự án mới *(nếu không chuyển thẳng được)*

## 2B.1 Bên A xuất biến môi trường

Cách nhanh và ít sai nhất, chạy trong thư mục dự án:

```bash
vercel login
vercel link          # chọn đúng dự án VAM OS
vercel env pull .env.production.local --environment=production
```

Lệnh này tạo một file chứa **toàn bộ biến kèm giá trị thật**.

> **File này chứa mọi khoá của hệ thống.** Không commit, không gửi qua nhóm chat,
> không dán vào cuộc trò chuyện với Claude. Chuyển cho bên B qua kênh riêng tư
> (gọi điện đọc, hoặc trình quản lý mật khẩu). Xong việc thì xoá file.

Không dùng CLI được thì mở Settings → Environment Variables, bấm con mắt từng dòng
và chép tay.

## 2B.2 Ba nhóm biến — xử lý khác nhau

**Nhóm A — bên B tự lấy, bên A không cần gửi:**

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Lấy từ Supabase của bên B: dự án `vam-os-mvp` → Settings → API.

> Nếu Supabase **chưa** chuyển sang bên B thì bốn biến này vẫn phải xin bên A. Xác
> nhận trạng thái Supabase trước khi làm bước này.

**Nhóm B — bắt buộc chép nguyên văn, đổi là gãy:**

```
VAM_OS_APPLY_TOKEN
VAM_OS_APPLICATION_PILOT_TOKEN
VAM_OS_RECAP_IMPORT_TOKEN
```

Hai biến đầu nằm trong link đăng ký **đã gửi cho sinh viên**. Biến thứ ba nằm trong
tiện ích Chrome thu recap. Đổi là gãy hết.

**Nhóm C — nên tạo mới thay vì chép:**

```
BREVO_API_KEY        DEEPSEEK_API_KEY
CRON_SECRET          VAM_OS_RATE_LIMIT_SALT
```

Tạo khoá mới trong tài khoản Brevo/DeepSeek của bên B. Hai biến còn lại là chuỗi
ngẫu nhiên nội bộ, đặt gì cũng được.

Còn lại là công tắc bật/tắt, chép nguyên:

```
VAM_OS_ENABLE_MENTOR_APPLICATION     VAM_OS_EMAIL_ENABLED
VAM_OS_ENABLE_MENTEE_APPLICATION     VAM_OS_EMAIL_PROVIDER
VAM_OS_ALLOW_TOKENLESS_APPLICATIONS  VAM_OS_EMAIL_FROM
VAM_OS_AI_MATCHING_ENABLED           VAM_OS_EMAIL_REPLY_TO
VAM_OS_MKT_AI_ENABLED                DEEPSEEK_MODEL
VAM_OS_PUBLIC_BASE_URL               DEEPSEEK_BASE_URL
```

## 2B.3 Bên B tạo dự án

1. [vercel.com/new](https://vercel.com/new)
2. Vercel của bên B đăng nhập bằng `vanhoang-spec` — chính tài khoản sở hữu kho — nên
   `vam-os-admin-portal` hiện sẵn. Không thấy thì **Adjust GitHub App Permissions** →
   **All repositories**.
3. **Import**
4. Framework Preset phải tự nhận **Next.js**
5. Mở **Environment Variables**, dán hết vào **trước khi** bấm Deploy
6. **Deploy**

---

# BƯỚC 3 — Bên B: chuyển deploy sang Vercel mới

**Đây mới là lúc việc deploy đổi chủ.** Bước 2 chỉ tạo ra chỗ để deploy tới.

## 3.1 Lấy ba giá trị

| Cần lấy | Lấy ở đâu |
|---|---|
| `VERCEL_PROJECT_ID` | Dự án → Settings → General → *Project ID* |
| `VERCEL_ORG_ID` | [vercel.com/account](https://vercel.com/account) → General → *Your ID* |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → **Create Token** |

> **Hai cái bẫy ở `VERCEL_ORG_ID`, cùng một biến:**
>
> **Bẫy 1 — chữ "ORG".** Tài khoản bên B là **cá nhân**, không phải team. Giá trị cần
> điền là ID của chính tài khoản cá nhân, ở trang Account Settings — **không phải** ở
> trang dự án.
>
> **Bẫy 2 — nhầm với Username.** Trang Account Settings có ô **Username** ghi
> `vanhoang-spec` (đã xác nhận 07/09/2026). Đó **KHÔNG phải** `VERCEL_ORG_ID`.
> Username chỉ là phần địa chỉ `vercel.com/vanhoang-spec`. Giá trị cần lấy nằm ở mục
> **Your ID** — một chuỗi dài không đọc được, không phải tên người.
>
> Điền nhầm username vào đây thì quy trình deploy chạy tới bước cuối rồi mới báo lỗi,
> nên rất tốn thời gian mới nhận ra.

Cách chắc chắn hơn nếu dùng CLI: chạy `vercel link` trong thư mục dự án, rồi mở file
`.vercel/project.json` — nó chứa đúng cả `orgId` và `projectId`.

Token chỉ hiện **một lần**. Chép ngay.

## 3.2 Thay ba khoá trong GitHub

Kho GitHub → **Settings** → **Environments** → **Production** → *Environment secrets*.

Bấm bút chì cạnh từng khoá → dán giá trị mới → **Save**. Làm cả ba.

Sửa tại chỗ, đừng xoá rồi tạo lại — tên khoá phải khớp chính xác.

## 3.3 Tắt build của Vercel để khỏi deploy hai lần

Nếu làm Bước 2B (dự án nhập từ GitHub), Vercel cũng tự build khi thấy commit — cộng
với GitHub Actions là **hai lần deploy cho một commit**, chạy đua nhau.

Vercel → dự án → **Settings** → **Git** → *Ignored Build Step* → **Don't build
anything**.

> **Vì sao không để Vercel tự deploy cho gọn:** quy trình GitHub Actions chạy
> **typecheck và toàn bộ test trước khi deploy**. Vercel tự build thì không kiểm gì
> cả — một lỗi lọt vào `main` sẽ lên thẳng trang thật.

---

# BƯỚC 4 — Chạy thử và xác minh

## 4.1 Chạy quy trình deploy

GitHub → tab **Actions** → **Vercel Production Deployment** → **Run workflow** →
nhánh `main` → **Run**.

Theo dõi từng bước:

- [ ] *Verify deployment secrets* → xanh. Đỏ thì nó ghi rõ thiếu khoá nào.
- [ ] *Type-check* → xanh
- [ ] *Run tests* → xanh
- [ ] *Deploy production artifact* → xanh, in ra một địa chỉ `.vercel.app`

## 4.2 Mở địa chỉ đó và kiểm tra

| # | Việc kiểm tra | Kết quả đúng |
|---|---|---|
| 1 | Mở trang chủ | Màn hình đăng nhập, không phải trang trắng |
| 2 | Đăng nhập tài khoản admin | Vào được, bảng vận hành có số liệu |
| 3 | Mở danh sách mentee | Đầy đủ như trang cũ |
| 4 | Mở `/admin/debug-auth` | Dòng *Is production ref* ghi **`yes`** |
| 5 | Mở một link đăng ký cũ đã gửi cho sinh viên | Form mở được, không báo token sai |

**Mục 4 ghi `no`** → trỏ nhầm cơ sở dữ liệu, kiểm tra `NEXT_PUBLIC_SUPABASE_URL`.
**Mục 5 báo lỗi** → `VAM_OS_APPLY_TOKEN` chép chưa đúng.

**Cả 5 mục đúng mới đi tiếp.**

---

# BƯỚC 5 — Chuyển tên miền

> **Bỏ qua nếu Bước 1.2 cho thấy chỉ có địa chỉ `.vercel.app`.**
>
> **Bỏ qua luôn nếu đã làm Bước 2A** — chuyển thẳng dự án thì tên miền đi theo.

Đây là bước duy nhất có gián đoạn, **2–5 phút**. Một tên miền chỉ gắn được vào một dự
án Vercel tại một thời điểm.

Làm vào giờ vắng, hai bên cùng online, liền tay:

1. **Bên A:** dự án cũ → Settings → Domains → **Remove** tên miền
2. **Bên B:** dự án mới → Settings → Domains → **Add** → gõ đúng tên miền → **Add**
3. Nếu Vercel yêu cầu sửa DNS: chụp lại màn hình, việc này làm ở nơi mua tên miền
4. Chờ tới khi có dấu tích xanh
5. **Bên B:** mở tên miền thật, đăng nhập thử

## 5.1 Sửa đường link trong email

Vercel → Settings → Environment Variables → sửa:

```
VAM_OS_PUBLIC_BASE_URL = https://tên-miền-thật
```

(không có dấu `/` ở cuối)

Rồi chạy lại quy trình deploy ở Bước 4.1.

> **Bỏ bước này thì** mọi email hệ thống gửi đi chứa link trỏ về địa chỉ cũ.

---

# BƯỚC 6 — Dọn dẹp

**Chỉ làm sau khi trang mới chạy đúng ít nhất một ngày.**

## Bên A

1. **Tạm dừng** dự án Vercel cũ, đừng xoá: Settings → General → **Pause Project**.
   Giữ khoảng một tuần.
2. Sau một tuần yên ổn → **Delete Project**.
3. **Thu hồi `VERCEL_TOKEN` cũ** tại
   [vercel.com/account/tokens](https://vercel.com/account/tokens). Token deploy còn
   sống là một đường vào trang thật.
4. Nếu đã chạy `vercel env pull` ở Bước 2B.1 → **xoá file `.env.production.local`**
   trên máy.

## Bên B

1. Nếu dùng khoá Brevo/DeepSeek mới → xoá khoá cũ ở hai dịch vụ đó
2. Vercel → Settings → Git → xác nhận nhánh deploy là `main`
3. Kiểm tra lại danh sách collaborator trên GitHub — hiện có `ThangNguyen-bot`,
   `hoang-embassy`, `vietdang7` đều quyền `write`

---

# Những chỗ dễ vấp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Actions báo `Missing required GitHub secret` | Thiếu hoặc sai tên một trong ba khoá | Bước 3.2, tên phải khớp chính xác |
| Deploy xanh nhưng vẫn lên trang cũ | Ba khoá còn trỏ Vercel cũ | Bước 3.2 |
| Một commit deploy hai lần | Vercel build song song với Actions | Bước 3.3 |
| Build Failed ở bước `npm test` | Test hỏng thật, không phải lỗi cấu hình | Chép log gửi lại, **đừng tắt bước test** |
| Trang trắng sau deploy | Thiếu khoá Supabase | Kiểm 4 biến Nhóm A |
| `Is production ref` ghi `no` | Trỏ nhầm cơ sở dữ liệu | Sửa `NEXT_PUBLIC_SUPABASE_URL` |
| Link đăng ký cũ báo lỗi | Đã đổi `VAM_OS_APPLY_TOKEN` | Chép lại giá trị cũ |
| Email có link sai | Quên `VAM_OS_PUBLIC_BASE_URL` | Bước 5.1 |
| `vercel projects ls` không thấy dự án | Đăng nhập nhầm tài khoản | `vercel logout` rồi `vercel login` lại |

---

# Hai điều cần biết trước

## Gói Vercel của bên B

Nếu là gói **Hobby** (miễn phí):

- Vercel quy định Hobby **không dùng cho mục đích thương mại**. Chương trình mentoring
  phi lợi nhuận thường không sao, nhưng nên đọc điều khoản.
- Chạy tự động theo giờ giới hạn **một lần/ngày**. Hệ thống đặt 2 giờ sáng nên vẫn vừa.

## Việc này không đụng tới cơ sở dữ liệu

Chuyển Vercel **không ảnh hưởng dữ liệu**. Không mất gì, không cần sao lưu trước. Thứ
duy nhất người dùng cảm nhận được là vài phút ở Bước 5.

---

*Tài liệu liên quan: [bàn giao GitHub và Vercel, bản đầy đủ](CHUYEN_GITHUB_VERCEL_CHI_TIET.md)
· [chuyển Supabase](CHUYEN_SUPABASE_PRODUCTION.md)*
