# Yêu cầu cấu hình DNS (phiếu 2) — xác thực email gửi đi

> Gửi bộ phận kỹ thuật PA Vietnam. Đây là phiếu thứ hai, độc lập với phiếu trước
> về subdomain `os.`. Toàn bộ giá trị dưới đây là dữ liệu công khai, sẽ nằm trong
> DNS công khai sau khi tạo — không phải mật khẩu hay khoá bí mật.

---

**Tên miền:** `alumni-mentoring.edu.vn`
**Mục đích:** xác thực tên miền với dịch vụ gửi email giao dịch (Brevo), để hệ
thống gửi được thư xác nhận từ địa chỉ `hello@alumni-mentoring.edu.vn`.

## 1. Bốn bản ghi cần thêm

| # | Type | Name / Host | Value |
|---|---|---|---|
| 1 | `TXT` | `@` | `brevo-code:9cf33b68c499ad4cea31652936415c75` |
| 2 | `CNAME` | `brevo1._domainkey` | `b1.alumni-mentoring-edu-vn.dkim.brevo.com` |
| 3 | `CNAME` | `brevo2._domainkey` | `b2.alumni-mentoring-edu-vn.dkim.brevo.com` |
| 4 | `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |

Ghi chú cho bản ghi số 1: nếu hệ thống không chấp nhận ký tự `@` ở ô Name, xin để
**trống** ô đó hoặc điền `alumni-mentoring.edu.vn` — tuỳ quy ước của bảng điều
khiển. Đây là bản ghi cho chính tên miền gốc.

Ghi chú cho bản ghi 2 và 3: ở ô Name chỉ điền phần đầu (`brevo1._domainkey`),
không điền tên miền đầy đủ, nếu bảng điều khiển tự ghép hậu tố.

## 2. Về bản ghi DMARC — xin đọc kỹ

Bản ghi số 4 dùng chính sách **`p=none`**, nghĩa là **chỉ theo dõi và báo cáo,
không chặn và không đưa thư nào vào spam**. Nó không làm thay đổi cách xử lý thư
hiện tại của tên miền, kể cả thư gửi từ hộp thư đang chạy trên hệ thống của PA
Vietnam.

Nếu tên miền **đã có sẵn** một bản ghi `_dmarc`, xin **không ghi đè** — báo lại
cho chúng tôi để xử lý riêng. Theo kiểm tra của chúng tôi ngày 08/09/2026 thì
chưa có, nhưng xin xác nhận lại giúp.

## 3. Không cần đụng tới SPF

Dịch vụ này **không yêu cầu** thêm `include` vào bản ghi SPF. Xác thực dựa trên
DKIM (bản ghi 2 và 3). Xin **giữ nguyên** bản ghi SPF hiện có nếu có, không thêm
và không sửa.

## 4. Những bản ghi phải giữ nguyên

| Bản ghi | Giá trị hiện tại | Lý do |
|---|---|---|
| `NS` | `ns1.pavietnam.vn`, `ns2.pavietnam.vn`, `nsbak.pavietnam.net` | Giữ nguyên tại PA Vietnam |
| `MX` | `mail93155.maychuemail.com` (5)<br>`mx93155.maychuemail.net` (10) | **Hộp thư đang hoạt động — mất là mất toàn bộ email** |
| `A` @ và `A` www | `35.213.187.39` | Website hiện tại |
| `A` `os` | `76.76.21.21` | Đã yêu cầu ở phiếu trước |

Bốn bản ghi ở mục 1 là **thêm mới**, không thay thế bản ghi nào đang có. Việc gửi
thư qua dịch vụ mới **không ảnh hưởng** tới việc nhận thư qua hệ thống PA Vietnam
— hai chiều dùng bản ghi khác nhau (MX cho nhận, DKIM cho gửi).

## 5. Cách xác nhận đã xong

```
nslookup -type=TXT alumni-mentoring.edu.vn          -> có dòng brevo-code:...
nslookup -type=CNAME brevo1._domainkey.alumni-mentoring.edu.vn
nslookup -type=CNAME brevo2._domainkey.alumni-mentoring.edu.vn
nslookup -type=TXT _dmarc.alumni-mentoring.edu.vn
```

Sau khi bản ghi cập nhật, phía chúng tôi sẽ tự bấm xác thực trên hệ thống — không
cần thao tác gì thêm từ PA Vietnam. DNS có thể cần tới 48 giờ để lan hết.

---

## Tóm tắt

Thêm 4 bản ghi ở mục 1. Không sửa, không xoá bất kỳ bản ghi nào khác — đặc biệt
là MX và SPF. Xin cảm ơn bộ phận kỹ thuật.
