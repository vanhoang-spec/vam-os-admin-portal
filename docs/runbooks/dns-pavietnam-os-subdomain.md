# Yêu cầu cấu hình DNS gửi kỹ thuật PA Vietnam

> Văn bản này soạn để gửi thẳng cho bộ phận kỹ thuật PA Vietnam. Toàn bộ nội dung
> là thông tin công khai — không chứa mật khẩu, khoá API hay thông tin nhạy cảm.

---

**Tên miền:** `alumni-mentoring.edu.vn`
**Nhà cung cấp DNS:** PA Vietnam (`ns1.pavietnam.vn`, `ns2.pavietnam.vn`, `nsbak.pavietnam.net`)
**Mục đích:** trỏ subdomain `os.alumni-mentoring.edu.vn` về hệ thống quản trị nội bộ đang chạy trên nền tảng Vercel.

## 1. Việc cần làm — thêm đúng MỘT bản ghi

| Thông số | Giá trị |
|---|---|
| **Loại (Type)** | `A` |
| **Tên (Name / Host)** | `os` |
| **Giá trị (Value / Points to)** | `76.76.21.21` |
| **TTL** | mặc định của hệ thống |

Tên đầy đủ sau khi tạo phải là: `os.alumni-mentoring.edu.vn`

`76.76.21.21` là địa chỉ anycast của Vercel — đây là bản ghi do chính Vercel chỉ
định cho tên miền này.

## 2. Việc KHÔNG được thay đổi

Đây là phần quan trọng nhất của yêu cầu. Tên miền đang có website và hộp thư hoạt
động bình thường; chúng tôi chỉ cần **thêm** một subdomain, không thay đổi gì
khác.

| Bản ghi | Giá trị hiện tại | Lý do phải giữ nguyên |
|---|---|---|
| `NS` | `ns1.pavietnam.vn`, `ns2.pavietnam.vn`, `nsbak.pavietnam.net` | **Giữ nguyên tại PA Vietnam.** Không chuyển sang Name Server của Vercel. |
| `A` @ (tên miền gốc) | `35.213.187.39` | Website hiện tại đang chạy ở đây |
| `A` `www` | `35.213.187.39` | Website hiện tại |
| `MX` | `mail93155.maychuemail.com` (ưu tiên 5)<br>`mx93155.maychuemail.net` (ưu tiên 10) | **Hộp thư `@alumni-mentoring.edu.vn` đang hoạt động.** Mất bản ghi này là mất toàn bộ email của tên miền. |

Nếu quy trình bên PA Vietnam có gợi ý chuyển Name Server sang bên thứ ba để dùng
dịch vụ Vercel, **vui lòng KHÔNG thực hiện.** Chuyển Name Server sẽ làm mất bản
ghi MX và hộp thư ngừng hoạt động. Yêu cầu của chúng tôi chỉ là thêm một bản ghi
A cho subdomain, hoàn toàn tương thích với việc giữ Name Server hiện tại.

## 3. Hai câu hỏi nhờ kiểm tra giúp (chưa cần thay đổi gì)

Tra từ bên ngoài chúng tôi không thấy hai bản ghi sau, nhưng kết quả không đủ rõ
để kết luận. Xin nhờ kiểm tra trong bảng DNS và cho biết:

1. Tên miền đã có bản ghi **TXT dạng SPF** (dòng bắt đầu bằng `v=spf1`) chưa? Nếu
   có, xin cho biết nội dung đầy đủ.
2. Tên miền đã có bản ghi **DMARC** (`_dmarc.alumni-mentoring.edu.vn`) chưa? Nếu
   có, xin cho biết nội dung.

Lý do hỏi: sắp tới chúng tôi sẽ cấu hình dịch vụ gửi email giao dịch cho tên miền
này, và cần bổ sung một số bản ghi TXT/CNAME. Chúng tôi muốn nắm hiện trạng trước
để không đề nghị thay đổi nào ảnh hưởng tới việc gửi/nhận thư đang chạy.

**Chỉ cần thông tin, chưa cần thao tác.** Yêu cầu cấu hình email sẽ được gửi
thành một phiếu riêng, kèm giá trị cụ thể.

## 4. Cách xác nhận đã xong

Sau khi bản ghi được tạo và DNS cập nhật, lệnh sau phải trả về `76.76.21.21`:

```
nslookup -type=A os.alumni-mentoring.edu.vn
```

Khi đó phía chúng tôi sẽ tự hoàn tất phần còn lại (chứng chỉ SSL do Vercel tự
cấp, không cần thao tác gì thêm từ phía PA Vietnam).

---

## Tóm tắt trong một câu

Thêm bản ghi `A` với Host `os` trỏ tới `76.76.21.21`; giữ nguyên Name Server, bản
ghi A của tên miền gốc, bản ghi www và toàn bộ bản ghi MX.

Xin cảm ơn bộ phận kỹ thuật.
