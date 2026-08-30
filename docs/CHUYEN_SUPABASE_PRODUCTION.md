# Chuyển production sang Supabase Pro của anh

*Ngày 30/08/2026. Thay cho phần "Các bước thực hiện" của
[hướng dẫn ngày 19/08](audits/VAM_OS_HUONG_DAN_CHUYEN_SUPABASE_2026-08-19.html) —
bản đó viết theo hướng chuyển cả hai dự án, phương án đã đổi.*

---

## Quyết định mới

**Chỉ chuyển `vam-os-mvp` (production). `staging` để nguyên trong tài khoản Free của
anh Thắng.**

Lý do: gói Pro tính thuê bao theo tổ chức nhưng tính máy chủ theo từng dự án. Đưa cả hai
vào Pro tốn thêm khoảng 10 USD/tháng chỉ để giữ bản thử nghiệm trong tổ chức trả phí —
không đáng, vì thứ thực sự cần sao lưu và cần anh sở hữu là bản chạy thật.

### Sau khi xong, ai giữ gì

| Dự án | Mã dự án | Nằm ở đâu | Ai sở hữu |
|---|---|---|---|
| `vam-os-mvp` (production) | `qkkroesfiazsejkzflcd` | Tổ chức **Pro** của anh | **Anh** |
| `staging` | `ljfneyuvpxrmejpxsmpz` | Tổ chức **Free** của anh Thắng | Anh Thắng |

Chi phí: **~25 USD/tháng**, một dự án trên Pro. Khoản tín dụng máy chủ kèm gói Pro vừa đủ
trả cho máy nhỏ nhất, nên đây gần như là toàn bộ hoá đơn.

---

## Ba điều phải biết trước khi bắt đầu

### 1. Không còn phép thử

Kế hoạch cũ chuyển `staging` trước để nếu có trục trặc thì gặp ở chỗ không gây hại. Giờ
chỉ còn một lần chuyển, và đó chính là lần có dữ liệu thật của hơn một nghìn người.

Bù lại bằng ba việc, **không bỏ việc nào**:

- **Tải một bản sao lưu thủ công về máy trước khi chuyển.** Hướng dẫn cũ ghi đây là việc
  "nên làm". Giờ nó là **bắt buộc**. Vào `vam-os-mvp` → *Database* → *Backups* → tải bản
  dump về máy anh, không phải để trên cloud.
- **Làm vào giờ vắng.** Chiều Free → Pro không gây gián đoạn, nhưng nếu có gì ngoài dự
  kiến thì lúc 11 giờ đêm dễ xử lý hơn lúc 8 giờ tối.
- **Hai người cùng online.** Anh Thắng bấm, anh kiểm tra ngay sau đó.

### 2. Anh vẫn cần vào được staging

Mọi quy trình migration trong dự án này đều viết là **"chạy staging trước, kiểm tra xong
mới đụng production"** — bao gồm ba migration đang chờ (`072`, `073`, `074`).

Nếu staging nằm ở tài khoản anh Thắng mà anh không vào được, thì mỗi lần chạy migration
anh đều phải nhờ anh ấy. Đó là ma sát không cần thiết, và nó sẽ khiến người ta bỏ bước
staging — bước quan trọng nhất.

**Cách xử lý: mời lẫn nhau.** Anh Thắng mời anh vào tổ chức Free của anh ấy với vai trò
`Developer` hoặc `Administrator`. Anh vào được SQL editor của staging, chạy migration
được, mà không đụng gì tới thanh toán hay quyền sở hữu của anh ấy.

### 3. Không phải sửa code

Chức năng *Transfer project* giữ nguyên mã dự án, địa chỉ và các khoá. Hai file
`lib/supabase.ts` và `lib/preview-environment.ts` ghi cứng
`qkkroesfiazsejkzflcd` và `ljfneyuvpxrmejpxsmpz` — cả hai vẫn đúng sau khi chuyển,
nên không phải sửa code, không phải sửa biến môi trường trên Vercel.

Đây cũng là lý do phải dùng "chuyển" chứ không phải "tạo mới rồi chép dữ liệu qua".

---

## Ai bấm nút

Supabase yêu cầu người thực hiện chuyển phải có quyền ở **cả hai** tổ chức:

| Ở tổ chức nào | Cần quyền gì |
|---|---|
| Tổ chức đang giữ dự án (Free của anh Thắng) | **Owner** |
| Tổ chức nhận dự án (Pro của anh) | Thành viên có quyền quản trị |

Ghép lại thì người duy nhất làm được là **anh Thắng** — anh ấy đã là chủ tổ chức nguồn.
Anh chỉ cần mời anh ấy vào tổ chức Pro của mình.

---

## Các bước

### Bước 1 — Anh: mời anh Thắng vào tổ chức Pro

1. Đăng nhập [supabase.com/dashboard](https://supabase.com/dashboard)
2. Góc trên bên trái, chọn đúng **tổ chức Pro** của anh
3. **Organization settings** → **Team** → **Invite member**
4. Nhập **email anh ấy dùng để đăng nhập Supabase** — không phải email công việc bất kỳ.
   Sai địa chỉ thì lời mời nằm im, không báo lỗi.
5. Vai trò: chọn **`Administrator`**

> **Vì sao Administrator chứ không phải Member.** Tôi không chắc chắn tuyệt đối Supabase
> yêu cầu mức nào ở tổ chức nhận. Chọn thiếu thì nút *Transfer project* bên phía anh Thắng
> sẽ mờ đi, và phải quay lại nâng quyền, mời lại, chờ nhận lời mời lần nữa.
> `Administrator` không xoá được tổ chức và không đụng được thanh toán — chỉ `Owner` mới
> làm được hai việc đó. Và hôm nay anh ấy đang toàn quyền với chính cơ sở dữ liệu đó rồi,
> nên đây là trao **ít hơn** những gì anh ấy đang có, trong khoảng 20 phút.

**Xong khi:** trong danh sách Team thấy tên anh ấy, trạng thái không còn là *Invited*.

### Bước 2 — Anh Thắng: mời anh vào tổ chức Free của anh ấy

Chiều ngược lại, để anh còn chạy migration trên staging.

Tổ chức Free của anh ấy → **Organization settings** → **Team** → **Invite member** →
email của anh → vai trò **`Developer`**.

**Xong khi:** anh đăng nhập tài khoản mình, thấy dự án `staging` trong danh sách và mở
được **SQL Editor** của nó.

### Bước 3 — Anh: tải bản sao lưu production về máy

`vam-os-mvp` → **Database** → **Backups** → tải bản dump.

**Đừng bỏ bước này.** Gói Free không có sao lưu tự động, nghĩa là **hôm nay production
đang không có bản sao nào cả**. Đây là lần đầu tiên trong suốt thời gian qua anh có một
bản trong tay.

### Bước 4 — Anh Thắng: kiểm tra ba thứ có thể chặn việc chuyển

Trong dự án `vam-os-mvp`:

| Kiểm tra ở đâu | Cần thấy gì |
|---|---|
| *Settings* → *Integrations* | Không có kết nối GitHub đang hoạt động. Nếu có thì ngắt, chuyển xong nối lại. |
| *Settings* → *Log Drains* | Không có log drain nào bật. Gói Free không bật được nên gần như chắc chắn trống. |
| Vai trò gán riêng cho dự án | Chỉ có ở gói Team/Enterprise. Không liên quan. |

### Bước 5 — Anh Thắng: chuyển production

`vam-os-mvp` → **Settings** → **General** → kéo xuống mục **Transfer project** → chọn tổ
chức Pro của anh → xác nhận.

Chiều Free → Pro **không gây gián đoạn dịch vụ**. (Chiều ngược lại mới có, nhưng ta không
đi chiều đó.)

### Bước 6 — Anh: bật sao lưu hằng ngày

`vam-os-mvp` → **Database** → **Backups** → xác nhận sao lưu tự động hằng ngày đang bật.

**Đây là lý do đáng làm nhất của cả việc chuyển này.** Đừng dừng lại ở bước 5.

---

## Kiểm tra sau khi chuyển

Bốn việc, theo thứ tự:

| # | Việc kiểm tra | Kết quả đúng |
|---|---|---|
| 1 | Mở web app VAM OS, đăng nhập bằng tài khoản của anh | Đăng nhập được, bảng vận hành có số liệu |
| 2 | Mở `/admin/debug-auth` trên web app | Dòng *Is production ref* ghi **`yes`** |
| 3 | Mở danh sách mentee | Hiện đầy đủ như trước |
| 4 | Supabase → *Database* → *Backups* | Có lịch sao lưu hằng ngày |
| 5 | Supabase → *Organization settings* → *Billing* | Thấy đúng **một** dự án trên gói Pro |

### Nếu bước 2 ghi `no` thì dừng lại

Nghĩa là mã dự án đã đổi — không nên xảy ra với chức năng Transfer. Đừng tự sửa. Chụp màn
hình gửi lại, vì lúc đó phải sửa `lib/supabase.ts`, `lib/preview-environment.ts` và biến
môi trường trên Vercel cho khớp.

---

## Sau khi xong

- **Gỡ anh Thắng khỏi tổ chức Pro** của anh, hoặc hạ xuống mức phù hợp nếu anh vẫn muốn
  anh ấy hỗ trợ kỹ thuật.
- **Giữ nguyên lời mời chiều ngược lại** — anh vẫn cần vào staging để chạy migration.
- Chạy `072`, `073`, `074` theo đúng thứ tự: **staging trước** (tài khoản anh Thắng),
  kiểm tra, rồi mới tới production (tài khoản anh). Xem
  [hướng dẫn chạy migration](CHAY_MIGRATION_072_073.md).

---

## Điều còn lại chưa giải quyết

Staging vẫn phụ thuộc tài khoản anh Thắng. Hai hệ quả, ghi ra để anh biết mình đang chấp
nhận gì:

- Nếu tài khoản anh ấy gặp vấn đề, anh mất bản thử nghiệm. Không mất production — đó là
  cái được của việc chuyển này.
- Theo ghi chép của tôi, **dữ liệu HAM mùa 6 hiện chỉ tồn tại trên staging**. Nếu đó là dữ
  liệu còn cần, nên tải một bản dump của staging về máy luôn, cùng lúc với bước 3.

Muốn dứt điểm chuyện phụ thuộc thì tạo thêm một tổ chức **Free của chính anh** rồi chuyển
staging vào đó — vẫn miễn phí, và anh sở hữu cả hai. Đánh đổi: dự án Free bị tạm dừng sau
khoảng một tuần không hoạt động, mỗi lần chạy migration phải bấm mở lại. Việc này làm lúc
nào cũng được, không cần làm cùng đợt này.
