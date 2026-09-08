# Yêu cầu cấu hình DNS (phiếu 3) — sửa bản ghi DMARC

> Gửi bộ phận kỹ thuật PA Vietnam. Phiếu này **sửa một bản ghi đã có**, không
> thêm bản ghi mới. Toàn bộ nội dung là dữ liệu công khai nằm trong DNS.

---

**Tên miền:** `alumni-mentoring.edu.vn`
**Bản ghi cần sửa:** `TXT` tại `_dmarc`
**Loại thao tác:** SỬA giá trị của bản ghi hiện có

## 1. Giá trị hiện tại và giá trị mới

**Đang là:**

```
v=DMARC1; p=reject; adkim=r; aspf=s; sp=none
```

**Xin đổi thành:**

```
v=DMARC1; p=none; rua=mailto:hello@alumni-mentoring.edu.vn; adkim=r; aspf=r
```

## 2. Lưu ý quan trọng khi thao tác

**Đây là SỬA, không phải THÊM.** Theo chuẩn DMARC, một tên miền chỉ được có
**đúng một** bản ghi TXT tại `_dmarc`. Nếu tạo thêm một bản ghi thứ hai thay vì
sửa bản ghi cũ, cả hai sẽ cùng vô hiệu và tên miền coi như không có DMARC.

Xin sửa trực tiếp giá trị của bản ghi `_dmarc` đang tồn tại, hoặc xoá bản ghi cũ
rồi tạo lại đúng một bản ghi với giá trị mới.

## 3. Vì sao đổi

Chúng tôi vừa đưa vào vận hành một hệ thống gửi email giao dịch mới cho tên miền
này và đang trong giai đoạn chạy thử.

- `p=reject` yêu cầu máy chủ nhận **từ chối thẳng** mọi thư không căn chỉnh
  được. Trong giai đoạn chạy thử, nếu có một nguồn gửi hợp lệ nào chưa được cấu
  hình đúng thì thư sẽ bị chặn cứng và không ai biết.
- Bản ghi hiện tại **không có tham số `rua=`**, nghĩa là không có địa chỉ nhận
  báo cáo. Chúng tôi không có cách nào biết thư nào đang bị từ chối, của nguồn
  nào, vì lý do gì.
- `aspf=s` (căn chỉnh SPF nghiêm ngặt) có thể ảnh hưởng tới thư gửi đi từ chính
  hộp thư `hello@alumni-mentoring.edu.vn` đang chạy trên hệ thống của quý công
  ty. Chúng tôi đổi sang `aspf=r` (căn chỉnh lỏng) cho an toàn.

Giá trị mới đặt chính sách ở mức **theo dõi** (`p=none`): không chặn thư nào cả,
chỉ thu thập báo cáo. Sau vài tuần đọc báo cáo và xác nhận mọi nguồn gửi hợp lệ
đều đạt, chúng tôi sẽ gửi phiếu riêng để siết dần lên `quarantine` rồi `reject`.

Đây là quy trình triển khai DMARC theo khuyến nghị thông thường: theo dõi trước,
siết sau.

## 4. Những bản ghi xin GIỮ NGUYÊN

Xin **không** thay đổi bất kỳ bản ghi nào dưới đây — chúng vừa được cấu hình
xong và đang hoạt động đúng:

| Bản ghi | Giá trị |
|---|---|
| `NS` | `ns1.pavietnam.vn`, `ns2.pavietnam.vn`, `nsbak.pavietnam.net` |
| `MX` | `mail93155.maychuemail.com` (5), `mx93155.maychuemail.net` (10) |
| `TXT` SPF tại `@` | `v=spf1 a mx include:spf.maychuemail.com -all` |
| `TXT` tại `@` | `brevo-code:9cf33b68c499ad4cea31652936415c75` |
| `CNAME` `brevo1._domainkey` | `b1.alumni-mentoring-edu-vn.dkim.brevo.com` |
| `CNAME` `brevo2._domainkey` | `b2.alumni-mentoring-edu-vn.dkim.brevo.com` |
| `A` `@` và `A` `www` | `35.213.187.39` |
| `A` `os` | `76.76.21.21` |

Phiếu này chỉ chạm vào đúng một bản ghi: `TXT` tại `_dmarc`.

## 5. Cách xác nhận đã xong

```
nslookup -type=TXT _dmarc.alumni-mentoring.edu.vn
```

Kết quả phải trả về **đúng một** dòng, nội dung:

```
v=DMARC1; p=none; rua=mailto:hello@alumni-mentoring.edu.vn; adkim=r; aspf=r
```

Nếu trả về hai dòng trở lên, nghĩa là bản ghi cũ chưa được xoá — xin kiểm tra
lại giúp.

---

## Tóm tắt

Sửa giá trị bản ghi `TXT` tại `_dmarc` thành
`v=DMARC1; p=none; rua=mailto:hello@alumni-mentoring.edu.vn; adkim=r; aspf=r`.
Chỉ được tồn tại một bản ghi `_dmarc`. Không thay đổi bản ghi nào khác.

Xin cảm ơn bộ phận kỹ thuật.
