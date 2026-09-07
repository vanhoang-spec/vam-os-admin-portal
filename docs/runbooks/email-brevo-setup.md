# Bật gửi email cho VAM OS (Brevo + tên miền riêng)

Tài liệu này dành cho người vận hành, không cần biết lập trình. Làm theo đúng
thứ tự — thứ tự ở đây được xếp sao cho **không có thư nào rời khỏi hệ thống cho
tới khi bạn đã tự mắt thấy đường dây chạy đúng.**

## Trước khi bắt đầu: hiểu cái công tắc kép

Hệ thống chỉ gửi thư khi **cả hai** điều kiện cùng đúng:

1. Biến `VAM_OS_EMAIL_ENABLED` bằng đúng chữ `true`
2. Đang chạy trên môi trường Production

Nghĩa là bản preview, bản chạy trên máy lập trình viên, hay bản deploy thử đều
**không thể** gửi thư cho mentor/mentee thật, kể cả khi ai đó lỡ tay bật biến.
Đây là chủ đích, không phải hạn chế.

Khi bị chặn, hệ thống vẫn ghi một dòng vào sổ với trạng thái **"Bỏ qua"** kèm lý
do. Nhờ vậy bạn xem trước được thư *sẽ* đi tới đâu trước khi thật sự bật.

---

## Bước 1 — Tạo hộp thư trên tên miền

Vào trang quản trị hosting/email của PA Vietnam, tạo một hộp thư trên tên miền
`alumni-mentoring.edu.vn`, ví dụ:

```
mentoring@alumni-mentoring.edu.vn
```

Hộp thư này có hai vai trò:

- **Địa chỉ người gửi** hiện trên thư mentor/mentee nhận được
- **Nơi nhận thư trả lời** — hệ thống đặt Reply-To về đây, và BTC đọc bằng
  webmail hay Outlook như một hộp thư bình thường

> Ứng dụng **không** tự đọc hộp thư này. Không ai cần đưa mật khẩu hộp thư lên
> Vercel. Xem mục cuối về kế hoạch đọc tự động ở đợt sau.

## Bước 2 — Tài khoản Brevo và xác thực tên miền

1. Đăng ký tại [brevo.com](https://www.brevo.com) (gói miễn phí đủ dùng)
2. Vào **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain**
3. Nhập `alumni-mentoring.edu.vn`
4. Brevo hiện ra các bản ghi DNS cần tạo — thường là **hai bản ghi CNAME** cho
   DKIM và **một bản ghi TXT** để xác minh quyền sở hữu

Vào trang quản lý DNS của tên miền (PA Vietnam) và tạo đúng những bản ghi đó.

### ⚠️ Bản ghi SPF — chỗ dễ hỏng nhất

Brevo sẽ yêu cầu thêm `include:spf.brevo.com` vào SPF.

**Một tên miền chỉ được có ĐÚNG MỘT bản ghi TXT loại SPF.** Nếu tên miền đã có
sẵn một dòng `v=spf1 ...` (rất thường có, do PA Vietnam tạo cho hộp thư), bạn
phải **hợp nhất** vào dòng đó:

```
Trước:  v=spf1 include:spf.pavietnam.vn ~all
Sau:    v=spf1 include:spf.pavietnam.vn include:spf.brevo.com ~all
```

**Tuyệt đối không thêm dòng SPF thứ hai.** Hai dòng SPF làm cả hai cùng vô hiệu,
và hậu quả là thư của cả hệ thống lẫn hộp thư sẵn có đều rơi vào Spam — một lỗi
im lặng, không ai báo.

Kiểm tra bằng lệnh sau; kết quả phải có **đúng một** dòng chứa `v=spf1`:

```bash
nslookup -type=TXT alumni-mentoring.edu.vn
```

### Về DMARC

Không bắt buộc cho bước này. DKIM căn chỉnh đúng tên miền là đủ để thư được tin
cậy. Nếu sau này muốn đặt DMARC, làm riêng và bắt đầu bằng `p=none` để theo dõi
trước khi siết.

## Bước 3 — Tạo khoá API hạn chế

Trong Brevo: **SMTP & API** → **API Keys** → **Generate a new API key**.

Đặt tên gợi nhớ, ví dụ `vam-os-production`. Nếu Brevo cho chọn phạm vi, chỉ cấp
quyền **Transactional / SMTP**, không cấp quyền quản lý danh bạ hay chiến dịch.

Copy khoá ngay — Brevo chỉ hiện một lần.

## Bước 4 — Đặt biến môi trường trên Vercel

Vào dự án trên Vercel → **Settings** → **Environment Variables**, thêm cho môi
trường **Production**:

| Biến | Giá trị | Kiểu |
|---|---|---|
| `VAM_OS_EMAIL_ENABLED` | `true` | Config |
| `VAM_OS_EMAIL_PROVIDER` | `brevo` | Config |
| `BREVO_API_KEY` | khoá vừa tạo | **Secret** |
| `VAM_OS_EMAIL_FROM` | `VAM Mentoring <mentoring@alumni-mentoring.edu.vn>` | Config |
| `VAM_OS_EMAIL_REPLY_TO` | `mentoring@alumni-mentoring.edu.vn` | Config |

`BREVO_API_KEY` phải để kiểu **Secret**: nó là khoá thật, không được hiện lại
trên dashboard.

Địa chỉ trong `VAM_OS_EMAIL_FROM` **bắt buộc** thuộc tên miền đã xác thực ở bước
2. Brevo từ chối gửi hộ một địa chỉ chưa xác thực.

Đặt biến xong phải **deploy lại** thì biến mới có hiệu lực: vào tab **Actions**
trên GitHub → workflow *Vercel Production Deployment* → **Run workflow**.

---

## Thứ tự triển khai an toàn

Đây là phần quan trọng nhất của tài liệu.

1. **Chạy migration trên Staging trước**, rồi mới tới Production. File:
   `supabase/migrations/20260909090000_outbound_emails.sql`, chạy bằng SQL Editor
   của Supabase. Migration tự kiểm và sẽ tự huỷ nếu có gì không khớp.

2. **Deploy code khi `VAM_OS_EMAIL_ENABLED` còn chưa đặt.**

3. **Nộp một đơn thử** trên form thật (dùng địa chỉ email của chính bạn). Vào
   `/operations/emails`. Phải thấy một dòng mới, trạng thái **"Bỏ qua"**, lý do
   *"VAM_OS_EMAIL_ENABLED chưa bật"*.

   > Đây là phép thử quan trọng nhất trong cả tài liệu: nó chứng minh toàn bộ
   > đường dây đã thông — form gọi đúng hàm, hàm ghi đúng sổ — **trước khi** bất
   > kỳ lá thư nào có thể tới hộp thư của một sinh viên thật.

4. **Làm bước 2 và 3 ở trên** (Brevo, DNS, khoá).

5. **Đặt biến rồi deploy lại.**

6. **Nộp thêm một đơn thử.** Lần này dòng trong sổ phải là **"Đã gửi"**, kèm một
   Message-ID dạng `<...@smtp-relay.brevo.com>`. Mở thư nhận được và kiểm:
   - Người gửi hiển thị đúng tên và đúng địa chỉ
   - Bấm Trả lời thì thư về đúng hộp thư `mentoring@`
   - Thư nằm ở Inbox chứ không phải Spam
   - Nội dung ghi đúng tên mùa ("Mùa 12")
   - Có bị Brevo chèn logo/footer quảng cáo ở cuối không (gói miễn phí đôi khi
     có) — nếu có và BTC thấy không phù hợp thì cần cân nhắc nâng gói

7. **Gửi bù cho người đã nộp trước đây** — mục dưới.

---

## Gửi bù thư cho những người đã nộp đơn từ 15/08

Hai form mở từ 15/08/2026 nhưng hệ thống chưa gửi được thư nào cho tới nay. Trang
`/operations/emails` có ô **"Gửi bù thư xác nhận"** để xử lý số này.

Cách hoạt động:

- Chỉ gửi cho đơn **chưa vào vòng phỏng vấn**. Thư viết "bước tiếp theo là chấm
  hồ sơ và mời phỏng vấn", nên gửi cho người đã phỏng vấn xong hoặc đã có kết
  quả là lạc điệu — hệ thống tự loại những trường hợp đó.
- Mỗi lần bấm gửi **tối đa 25 thư**, ưu tiên người nộp sớm nhất.
- **Không bao giờ gửi trùng.** Mỗi đơn được "đặt chỗ" trong sổ trước khi thư
  được gửi, và database có ràng buộc chặn dòng thứ hai. Hai người cùng bấm một
  lúc cũng không làm ai nhận hai thư.

Gói Brevo miễn phí cho 300 thư mỗi ngày, và hạn mức tính cả thư xác nhận của đơn
mới. Nên chia ra nhiều ngày: mỗi ngày bấm vài lượt, xem số còn lại hiện trên ô
đó, tới khi về 0.

Mỗi lần bấm để lại một dòng trong nhật ký quản trị với đầy đủ số liệu.

---

## Đọc sổ thư

`/operations/emails` — vai trò quản trị xem được, thao tác gửi bù thì hẹp hơn.

| Trạng thái | Nghĩa là gì |
|---|---|
| **Đã gửi** | Nhà cung cấp đã nhận thư. Không đảm bảo người ta đã mở. |
| **Lỗi** | Không gửi được. Cột ghi chú nêu lý do — thường là địa chỉ sai hoặc hết hạn mức ngày. |
| **Bỏ qua** | Cấu hình chặn, **không phải lỗi**. Đọc cột ghi chú để biết thiếu gì. |
| **Đang chờ** | Đã đặt chỗ nhưng chưa chốt kết quả. Bình thường chỉ tồn tại vài giây. Dòng kẹt quá 15 phút sẽ tự bị đánh hỏng ở lượt gửi bù kế tiếp. |

Một lần gửi hỏng **không bao giờ** làm hỏng thao tác gốc: đơn của người nộp vẫn
được lưu bình thường dù thư không đi được.

---

## Việc KHÔNG được làm

- **Đừng xoay khoá Supabase** khi đang xử lý email. Không liên quan, và xoay là
  sập trang thật ngay lập tức.
- **Đừng thêm bản ghi SPF thứ hai** (xem lại bước 2).
- **Đừng đặt `VAM_OS_EMAIL_ENABLED=true` cho môi trường Preview.** Công tắc kép
  vẫn chặn, nhưng đặt như vậy là gửi tín hiệu sai cho người đọc cấu hình sau này.
- **Đừng dán khoá `BREVO_API_KEY` vào chat, email hay tài liệu.** Cần chia sẻ thì
  tạo khoá mới cho người đó.

---

## Đợt sau: nhận thư trả lời tự động

Hiện tại thư trả lời về hộp thư `mentoring@` và **người thật đọc**. Đó là lựa
chọn có chủ đích cho đợt này, không phải thiếu sót.

Phần chuẩn bị cho việc đọc tự động đã nằm sẵn trong hệ thống: mỗi thư gửi đi đều
lưu **Message-ID** do Brevo cấp, và cột đó đã có index riêng. Thư trả lời luôn
mang tiêu đề `In-Reply-To` bằng đúng Message-ID ấy.

Khi nào cần, đợt sau chỉ việc thêm:

- một bảng `inbound_emails` (message_id, in_reply_to, from_email, subject,
  received_at, và khoá nối tới dòng thư đi tương ứng)
- một tác vụ định kỳ quét hộp thư qua IMAP
- ghép thư về đúng người: `In-Reply-To` → `provider_message_id`; không khớp thì
  dò theo địa chỉ người gửi

**Không có gì trong đợt này phải làm lại.** Việc cần thêm khi đó là gói Vercel
cho phép chạy tác vụ định kỳ nhiều lần trong ngày, và mật khẩu hộp thư phải được
lưu như một biến bí mật — hai điều kiện nên cân nhắc trước khi quyết định làm.
