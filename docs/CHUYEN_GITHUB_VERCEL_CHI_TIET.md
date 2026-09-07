# Chuyển GitHub và Vercel sang tài khoản mới

*Hướng dẫn cho người không làm kỹ thuật. Làm theo đúng thứ tự, không nhảy bước.*

---

## Tóm tắt: chuyện gì đang xảy ra

| Thứ | Hôm nay ở đâu | Sau khi xong |
|---|---|---|
| **Mã nguồn (GitHub)** | Tài khoản anh Thắng | Tài khoản anh Hoàng |
| **Trang web (Vercel)** | Tài khoản anh Thắng | Tài khoản anh Hoàng |
| **Cơ sở dữ liệu (Supabase)** | *(đang chuyển riêng)* | Tài khoản anh Hoàng |

Ba thứ này độc lập với nhau. Tài liệu này lo hai thứ đầu.

**Thời gian:** khoảng 60–90 phút, hai người cùng online.

> ### Đọc trước: trang web không còn deploy theo cách cũ
>
> Từ 02/09/2026, mỗi lần có commit vào nhánh `main`, **GitHub Actions** chạy một
> quy trình: kiểm tra kiểu dữ liệu → chạy toàn bộ test → nếu qua hết mới build và
> đẩy lên Vercel. File quy trình là `.github/workflows/vercel-production.yml`.
>
> Nghĩa là Vercel **không còn tự deploy khi thấy commit mới**. Nó chỉ nhận bản
> build đã xong từ GitHub.
>
> Ba khoá kết nối nằm ở **GitHub**, không phải Vercel — trong
> *Settings → Environments → Production*:
>
> ```
> VERCEL_TOKEN        VERCEL_ORG_ID        VERCEL_PROJECT_ID
> ```
>
> **Ba khoá này đi theo kho khi chuyển** (đã kiểm chứng sau lần chuyển ngày
> 07/09/2026 — chúng vẫn còn). Nhưng chúng đang trỏ vào **Vercel của anh Thắng**,
> nên sau khi dựng dự án Vercel mới phải cập nhật lại cả ba. Đó là Bước 5 mới.

**Gián đoạn dịch vụ:** chỉ một lần, khoảng 2–5 phút, ở bước chuyển tên miền (Bước 7).
Mọi bước khác không ảnh hưởng người dùng.

### Ai làm gì

| Bước | Ai làm |
|---|---|
| 1. Chuẩn bị | Cả hai |
| 2. Chuyển GitHub | **Anh Thắng** |
| 3. Chép biến môi trường | **Anh Thắng** |
| 4. Dựng trang trên Vercel mới | **Anh Hoàng** |
| 5. Chuyển deploy sang Vercel mới | **Anh Hoàng** |
| 6. Kiểm tra | **Anh Hoàng** |
| 7. Chuyển tên miền | **Anh Hoàng**, rồi anh Thắng |
| 8. Dọn dẹp | Cả hai |

---

# BƯỚC 1 — Chuẩn bị

## 1.1 Xác nhận đúng tên tài khoản

Cần biết chính xác **tên tài khoản GitHub của anh Hoàng**. Theo thông tin hiện tại là:

```
vanhoang-spec
```

Anh Hoàng vào [github.com](https://github.com), bấm ảnh đại diện góc trên bên phải →
xem dòng **"Signed in as ..."** để xác nhận. Gõ sai tên là chuyển nhầm người.

## 1.2 Kiểm tra tài khoản nhận chưa có kho trùng tên

Anh Hoàng mở đường dẫn này trong trình duyệt:

```
https://github.com/vanhoang-spec/vam-os-admin-portal
```

- Thấy **404 Not Found** → **đúng**, đi tiếp.
- Thấy một kho hiện ra → phải đổi tên kho đó trước, nếu không GitHub sẽ từ chối.

## 1.3 Anh Hoàng cần có tài khoản Vercel

Vào [vercel.com](https://vercel.com) → **Sign Up** → chọn **Continue with GitHub**,
đăng nhập bằng chính tài khoản `vanhoang-spec`.

> **Vì sao phải đăng nhập bằng GitHub:** Vercel cần đọc mã nguồn từ GitHub. Đăng
> nhập bằng email khác rồi nối sau sẽ rối hơn nhiều.

> **Trường hợp hiện tại (07/09/2026):** tài khoản Vercel của anh Hoàng **đã** đăng
> nhập bằng `vanhoang-spec` — đúng tài khoản vừa nhận kho. Nên Vercel nhìn thấy kho
> ngay, không phải cấp quyền thêm. Bước 4.2 sẽ rất nhanh.

## 1.4 Ghi lại địa chỉ web hiện tại

Anh Thắng mở [vercel.com/dashboard](https://vercel.com/dashboard) → bấm vào dự án VAM
OS → tab **Domains**. Chụp màn hình danh sách tên miền.

Sẽ thấy một trong hai dạng:

- **Chỉ có `...vercel.app`** → không có tên miền riêng. **Bỏ qua được Bước 7** — nhẹ hơn nhiều.
- **Có tên miền riêng** (ví dụ `vam.edu.vn`) → phải làm Bước 6.

---

# BƯỚC 2 — Chuyển kho GitHub

> **Anh Thắng làm.** Anh Hoàng chờ email.

## 2.1 Mở phần cài đặt của kho

1. Vào [github.com](https://github.com), đăng nhập tài khoản anh Thắng
2. Mở kho **`vam-os-admin-portal`**
3. Bấm tab **Settings** (răng cưa, hàng trên cùng bên phải)
4. Cuộn xuống **hết trang**, tới khung viền đỏ tên **Danger Zone**

## 2.2 Bấm Transfer

1. Ở dòng **"Transfer ownership"** → bấm nút **Transfer**
2. Hiện hộp thoại. Điền:
   - Ô đầu: gõ tên kho để xác nhận → `vam-os-admin-portal`
   - Ô thứ hai **"New owner's GitHub username or organization name"** → gõ `vanhoang-spec`
3. Bấm **"I understand, transfer this repository"**
4. GitHub hỏi mật khẩu hoặc mã xác thực → nhập

## 2.3 Anh Hoàng nhận lời mời

GitHub gửi email tới anh Hoàng. Mở email → bấm **Accept transfer**.

Nếu không thấy email: vào [github.com](https://github.com), thường sẽ có thanh thông
báo ở đầu trang. Kiểm tra cả hộp thư rác.

## 2.4 Kiểm tra

Anh Hoàng mở:

```
https://github.com/vanhoang-spec/vam-os-admin-portal
```

**Phải thấy đủ:**

- [ ] Kho hiện ra, tên chủ sở hữu là `vanhoang-spec`
- [ ] Tab **Pull requests** vẫn còn nguyên các PR đang mở
- [ ] Tab **Code** → nút nhánh (branches) vẫn thấy đủ các nhánh

> **Yên tâm về link cũ:** GitHub tự chuyển hướng. Ai mở link cũ
> `github.com/ThangNguyen-bot/vam-os-admin-portal` vẫn tới đúng chỗ mới.

## 2.5 Anh Thắng vẫn cần vào được

Sau khi chuyển, anh Thắng **không còn là chủ**. Muốn anh ấy tiếp tục hỗ trợ:

Anh Hoàng vào kho → **Settings** → **Collaborators** → **Add people** → gõ
`ThangNguyen-bot` → chọn quyền **Write** → gửi lời mời.

---

# BƯỚC 3 — Chép biến môi trường

> **Anh Thắng làm.** Đây là bước dài nhất nhưng chỉ là chép và dán.

Trang web cần khoảng 20 "biến môi trường" — như một tờ khai cấu hình chứa khoá kết nối
và các công tắc bật/tắt tính năng. Không có chúng, trang dựng lên sẽ trắng.

## 3.1 Mở danh sách

Anh Thắng vào [vercel.com/dashboard](https://vercel.com/dashboard) → dự án VAM OS →
**Settings** → **Environment Variables**.

Sẽ thấy một danh sách dài. Giá trị bị che bằng dấu chấm — bấm biểu tượng **con mắt**
hoặc **Edit** để xem.

## 3.2 Ba nhóm — xử lý khác nhau

### Nhóm A — Anh Hoàng tự lấy được, KHÔNG cần anh Thắng gửi

Bốn biến này lấy thẳng từ Supabase của anh Hoàng (cơ sở dữ liệu đã là của anh ấy):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

**Cách lấy:** Supabase → dự án `vam-os-mvp` → **Settings** → **API**. Trang đó có sẵn
URL và các khoá.

> **Đây là điều tốt.** `SUPABASE_SERVICE_ROLE_KEY` là khoá mạnh nhất của cả hệ thống
> — ai có nó đọc ghi được mọi dữ liệu. Không phải gửi nó qua tin nhắn là an toàn hơn hẳn.

### Nhóm B — BẮT BUỘC chép nguyên văn, đổi là gãy

```
VAM_OS_APPLY_TOKEN
VAM_OS_APPLICATION_PILOT_TOKEN
VAM_OS_RECAP_IMPORT_TOKEN
```

**Vì sao không được đổi:**

- Hai biến đầu nằm trong **đường link đăng ký đã gửi cho sinh viên**. Đổi là mọi link
  đã phát ra ngoài báo "không hợp lệ".
- Biến thứ ba nằm trong **tiện ích Chrome thu recap**. Đổi thì phải cài lại tiện ích
  cho mọi người đang dùng.

### Nhóm C — Chép cũng được, tạo mới cũng được

```
VAM_OS_RATE_LIMIT_SALT      → tạo mới thoải mái (chỉ reset bộ đếm chống spam)
CRON_SECRET                 → tạo mới thoải mái (chỉ dùng nội bộ)
BREVO_API_KEY               → nên tạo khoá mới trong tài khoản Brevo
DEEPSEEK_API_KEY            → nên tạo khoá mới trong tài khoản DeepSeek
RESEND_API_KEY              → bỏ được, hệ thống đã dùng Brevo
```

Còn lại là các công tắc bật/tắt, chép nguyên:

```
VAM_OS_ENABLE_MENTOR_APPLICATION      VAM_OS_EMAIL_ENABLED
VAM_OS_ENABLE_MENTEE_APPLICATION      VAM_OS_EMAIL_PROVIDER
VAM_OS_ALLOW_TOKENLESS_APPLICATIONS   VAM_OS_EMAIL_FROM
VAM_OS_AI_MATCHING_ENABLED            VAM_OS_EMAIL_REPLY_TO
VAM_OS_MKT_AI_ENABLED                 DEEPSEEK_MODEL
VAM_OS_PUBLIC_BASE_URL                DEEPSEEK_BASE_URL
```

## 3.3 Cách gửi cho anh Hoàng

Tạo một **file văn bản trên máy**, mỗi dòng một biến:

```
VAM_OS_APPLY_TOKEN=giá-trị-thật-ở-đây
VAM_OS_EMAIL_FROM=giá-trị-thật-ở-đây
```

Gửi qua kênh riêng tư (Zalo tin nhắn riêng, hoặc gọi đọc). **Đừng dán vào nhóm chat
chung, đừng dán vào GitHub.**

Nhóm A bỏ qua — anh Hoàng tự lấy.

---

# BƯỚC 4 — Dựng trang trên Vercel của anh Hoàng

> **Anh Hoàng làm.** Trang cũ vẫn chạy bình thường suốt bước này.

## 4.1 Vì sao dựng mới chứ không "chuyển"

Vercel có chức năng chuyển dự án, nhưng dựng mới hợp hơn ở đây: kho GitHub vừa đổi chủ,
nên mối nối giữa dự án Vercel cũ và GitHub cũng phải nối lại. Dựng mới thì mỗi bước đều
kiểm tra được ngay, và **trang cũ vẫn chạy làm lưới an toàn** cho tới khi trang mới
chắc chắn đúng.

## 4.2 Nhập dự án

1. Vào [vercel.com/new](https://vercel.com/new)
2. Vì Vercel đang đăng nhập bằng chính `vanhoang-spec` — tài khoản sở hữu kho —
   `vam-os-admin-portal` thường hiện sẵn trong danh sách. Nếu không thấy, bấm
   **Adjust GitHub App Permissions** rồi chọn **All repositories**.
3. Tìm `vam-os-admin-portal` → bấm **Import**

## 4.3 KHOAN bấm Deploy

Trang cấu hình hiện ra. Trước khi bấm nút xanh:

1. **Framework Preset** → phải tự nhận là **Next.js**. Nếu không, chọn tay.
2. Mở phần **Environment Variables** (bấm mũi tên để mở rộng)
3. Dán từng biến vào: ô trái là **tên**, ô phải là **giá trị**, bấm **Add**. Lặp lại
   cho tới hết.

> **Mẹo:** Vercel cho dán nhiều dòng cùng lúc. Dán trọn nội dung file văn bản ở Bước
> 3.3 vào ô tên — Vercel tự tách thành nhiều biến. Dán xong **đếm lại** cho đủ.

4. **Kiểm tra `VAM_OS_PUBLIC_BASE_URL`** — biến này quyết định đường link trong email
   gửi đi. Tạm để nguyên giá trị cũ, Bước 7 sẽ sửa.

## 4.4 Deploy

Bấm **Deploy**. Chờ 2–4 phút.

- **Thấy pháo giấy chúc mừng** → xong, đi tiếp.
- **Thấy chữ đỏ "Build Failed"** → bấm vào để xem log. Thường là thiếu một biến môi
  trường. Chụp màn hình gửi lại, đừng tự sửa mã nguồn.

---

# BƯỚC 5 — Chuyển deploy sang Vercel mới

> **Anh Hoàng làm.** Đây là bước thật sự chuyển việc deploy. Bước 4 mới chỉ tạo ra
> chỗ để deploy tới.

## 5.1 Lấy ba giá trị từ Vercel mới

Trong dự án Vercel vừa tạo:

| Cần lấy | Lấy ở đâu |
|---|---|
| `VERCEL_PROJECT_ID` | Dự án → **Settings** → **General** → mục *Project ID* |
| `VERCEL_ORG_ID` | [vercel.com/account](https://vercel.com/account) → **General** → mục *Your ID* |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → **Create Token** |

> **Lưu ý về `VERCEL_ORG_ID`:** tên biến có chữ "ORG" nhưng tài khoản của anh Hoàng
> là **tài khoản cá nhân**, không phải team. Giá trị cần điền là **ID của chính tài
> khoản cá nhân** — nằm ở trang Account Settings, mục *Your ID*, không phải ở trang
> dự án. Đây là chỗ dễ tìm nhầm nhất trong cả tài liệu.

Khi tạo token: đặt tên dễ nhớ (ví dụ `github-actions-deploy`), phạm vi chọn đúng
tài khoản của anh, hạn dùng chọn **No Expiration** hoặc dài nhất có thể.

> Token chỉ hiện **một lần** ngay sau khi tạo. Chép ngay, đóng cửa sổ là mất, phải
> tạo cái khác.

## 5.2 Thay ba khoá trong GitHub

Vào kho trên GitHub → **Settings** → **Environments** → **Production**. Ở mục
*Environment secrets* sẽ thấy đúng ba tên trên.

Bấm biểu tượng bút chì cạnh từng khoá → dán giá trị mới → **Save**. Làm cả ba.

> Không xoá rồi tạo lại — sửa tại chỗ là đủ, và đỡ nguy cơ gõ sai tên. Tên khoá
> phải khớp chính xác, sai một chữ là quy trình báo thiếu khoá.

## 5.3 Chạy thử

Vào tab **Actions** → chọn quy trình **Vercel Production Deployment** → nút
**Run workflow** → chọn nhánh `main` → **Run**.

Theo dõi các bước chạy. Kết quả đúng:

- Bước *Verify deployment secrets* → xanh (nếu đỏ, nó ghi rõ thiếu khoá nào)
- Các bước *Type-check* và *Run tests* → xanh
- Bước *Deploy production artifact* → xanh, và in ra một địa chỉ `.vercel.app`

Mở địa chỉ đó, đăng nhập thử. Nếu vào được thì việc deploy đã chuyển sang tài khoản
anh xong.

## 5.4 Tắt kết nối Git của Vercel để khỏi deploy hai lần

Dự án Vercel mới được nhập từ GitHub nên Vercel cũng tự deploy khi thấy commit —
cộng với GitHub Actions là **hai lần deploy cho một commit**, chạy đua nhau, tốn
hạn mức build.

Vercel → dự án mới → **Settings** → **Git** → mục *Ignored Build Step*, chọn
**Don't build anything**. Hoặc **Disconnect** hẳn kho GitHub khỏi dự án.

> **Vì sao không để Vercel tự deploy cho gọn:** vì quy trình GitHub Actions chạy
> **typecheck và toàn bộ test trước khi deploy**. Vercel tự deploy thì không kiểm
> gì cả — một lỗi lọt vào `main` sẽ lên thẳng trang thật.

---

# BƯỚC 6 — Kiểm tra trang mới

> **Anh Hoàng làm.** Trang cũ vẫn đang chạy, nên cứ thử thoải mái.

Vercel cho một địa chỉ tạm dạng `vam-os-admin-portal-xxxx.vercel.app`. Mở nó và kiểm
tra theo thứ tự:

| # | Việc kiểm tra | Kết quả đúng |
|---|---|---|
| 1 | Mở trang chủ | Hiện màn hình đăng nhập, không phải trang trắng |
| 2 | Đăng nhập bằng tài khoản admin | Vào được, thấy bảng vận hành có số liệu |
| 3 | Mở danh sách mentee | Hiện đầy đủ như trang cũ |
| 4 | Mở `/admin/debug-auth` | Dòng *Is production ref* ghi **`yes`** |
| 5 | Mở một link đăng ký cũ đã từng gửi cho sinh viên | Form mở được, không báo token sai |

**Nếu mục 4 ghi `no`:** trang mới đang trỏ vào cơ sở dữ liệu sai. Kiểm tra lại
`NEXT_PUBLIC_SUPABASE_URL`.

**Nếu mục 5 báo token sai:** `VAM_OS_APPLY_TOKEN` chép chưa đúng. Xem lại Nhóm B.

**Chỉ khi cả 5 mục đều đúng mới đi tiếp.**

---

# BƯỚC 7 — Chuyển tên miền

> **Bỏ qua bước này nếu Bước 1.4 cho thấy chỉ có địa chỉ `.vercel.app`.**
>
> Đây là bước duy nhất có gián đoạn. Làm vào giờ vắng, hai người cùng online.

**Vì sao có gián đoạn:** một tên miền chỉ gắn được vào một dự án Vercel tại một thời
điểm. Phải gỡ khỏi trang cũ trước rồi mới gắn vào trang mới được — khoảng trống ở giữa
là lúc người dùng không vào được.

Làm liền tay, khoảng 2–5 phút:

1. **Anh Thắng:** dự án cũ → **Settings** → **Domains** → tên miền riêng → **Remove**
2. **Anh Hoàng:** dự án mới → **Settings** → **Domains** → **Add** → gõ đúng tên miền
   đó → **Add**
3. **Anh Hoàng:** Vercel có thể yêu cầu sửa DNS. Nếu hiện bảng hướng dẫn, chụp lại và
   nhắn — bước này phải làm ở nơi mua tên miền, không phải trên Vercel.
4. Chờ tới khi Vercel hiện dấu tích xanh cạnh tên miền
5. **Anh Hoàng:** mở tên miền thật trong trình duyệt, đăng nhập thử lại

## 7.1 Sửa lại đường link trong email

Sau khi tên miền chạy, quay lại **Settings** → **Environment Variables** → sửa:

```
VAM_OS_PUBLIC_BASE_URL = https://tên-miền-thật (không có dấu / ở cuối)
```

Rồi vào tab **Deployments** → bấm dấu **···** ở bản mới nhất → **Redeploy**.

> **Bỏ bước này thì:** mọi email hệ thống gửi đi sẽ chứa link trỏ về địa chỉ cũ.

---

# BƯỚC 8 — Dọn dẹp

Chỉ làm **sau khi trang mới đã chạy đúng ít nhất một ngày**.

## Anh Thắng

1. **Tạm dừng dự án Vercel cũ**, đừng xoá ngay: dự án cũ → **Settings** → **General**
   → cuộn xuống **Pause Project**. Giữ khoảng một tuần phòng khi cần quay lại.
2. Sau một tuần yên ổn → **Delete Project**.

## Anh Hoàng

1. Kiểm tra anh Thắng đã nhận lời mời collaborator ở Bước 2.5 chưa
2. Nếu dùng khoá Brevo/DeepSeek mới → vào hai dịch vụ đó **xoá khoá cũ**, để khoá cũ
   còn sống là còn rủi ro
3. Nhờ anh Thắng **thu hồi `VERCEL_TOKEN` cũ** của anh ấy tại
   [vercel.com/account/tokens](https://vercel.com/account/tokens). Token đó không còn
   được dùng, và một token deploy còn sống là một đường vào trang thật.
3. Vào Vercel → **Settings** → **Git** → xác nhận nhánh deploy là `main`

---

# Những chỗ dễ vấp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| GitHub từ chối chuyển | Tài khoản nhận đã có kho trùng tên | Đổi tên kho kia trước (Bước 1.2) |
| Không nhận được email chuyển kho | Vào hộp thư rác | Hoặc xem thanh thông báo trên github.com |
| Build Failed | Thiếu biến môi trường | Xem log, thường ghi rõ thiếu biến nào |
| Trang trắng sau khi deploy | Thiếu khoá Supabase | Kiểm tra 4 biến Nhóm A |
| `Is production ref` ghi `no` | Trỏ nhầm cơ sở dữ liệu | Sửa `NEXT_PUBLIC_SUPABASE_URL` |
| Link đăng ký cũ báo lỗi | Đổi `VAM_OS_APPLY_TOKEN` | Chép lại đúng giá trị cũ |
| Email gửi đi có link sai | Quên sửa `VAM_OS_PUBLIC_BASE_URL` | Sửa rồi Redeploy (Bước 6.1) |
| Vercel không thấy kho | Chưa cấp quyền GitHub cho Vercel | Bước 4.2, bấm Configure |
| Actions báo `Missing required GitHub secret` | Thiếu hoặc sai tên một trong ba khoá | Bước 5.2, kiểm tra tên khoá khớp chính xác |
| Một commit deploy hai lần | Vercel tự deploy song song với Actions | Bước 5.4, tắt build của Vercel |
| Deploy vẫn lên trang cũ của anh Thắng | Ba khoá còn trỏ vào Vercel cũ | Bước 5.2 |

---

# Hai điều cần biết trước

## Gói Vercel

Nếu tài khoản anh Hoàng dùng gói **Hobby** (miễn phí), có hai giới hạn:

- Vercel quy định gói Hobby **không dùng cho mục đích thương mại**. Chương trình
  mentoring phi lợi nhuận thường không sao, nhưng nên đọc điều khoản trước.
- Tính năng chạy tự động theo giờ (cron) bị giới hạn **một lần mỗi ngày**. Hệ thống
  hiện đặt 2 giờ sáng mỗi ngày nên vẫn vừa.

## Việc này không liên quan tới Supabase

Chuyển GitHub và Vercel **không đụng gì tới cơ sở dữ liệu**. Không mất dữ liệu, không
cần sao lưu trước. Thứ duy nhất người dùng cảm nhận được là vài phút gián đoạn ở Bước 6.

---

*Tài liệu đi kèm: [chuyển Supabase](CHUYEN_SUPABASE_PRODUCTION.md).*
