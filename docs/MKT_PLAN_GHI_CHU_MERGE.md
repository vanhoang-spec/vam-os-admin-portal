# Module MKT Plan — ghi chú để quyết định merge

*PR #44, nhánh `s12-phase9-mkt-plan`, xếp chồng trên #41. Viết cho người quyết định
có merge hay không, không phải hướng dẫn sử dụng.*

---

## Quyết định cần đưa ra

Có đưa module lập kế hoạch nội dung vào `main` hay không.

Câu trả lời ngắn từ phía tôi: **merge được, nhưng chạy migration trên staging và thử
một tuần thật trước khi bật cho cả năm chương trình.** Lý do nằm ở mục "Đã kiểm chứng
tới đâu" — có hai thứ chưa ai xác nhận được bằng cách nào khác ngoài chạy thật.

---

## Module làm gì

Gom trọn vòng đời một bài đăng, cho từng fanpage riêng của từng chương trình:

```
Master plan tháng → Plan tuần (chia slot) → Bài từng slot → Gắn link hình
   → Duyệt → Chốt giờ → NGƯỜI mở trang và đăng → Ghi nhận đã đăng
```

AI (DeepSeek) viết bản nháp plan và nội dung. Mọi bước duyệt và bước đăng đều do người
làm. **Không có auto-post** — không nối API của Facebook, TikTok hay LinkedIn.

---

## Phạm vi thay đổi — phần đáng xem nhất

| | |
|---|---|
| File thay đổi | **26** |
| Trong đó **file mới** | **22** |
| File đang có **bị sửa** | **4** |
| Dòng thêm | 7.124 |
| Dòng **xoá** | **2** |

Bốn file bị sửa, và sửa gì:

| File | Sửa gì |
|---|---|
| `lib/permissions.ts` | Thêm 2 vị từ mới ở cuối file. Không đụng vị từ nào đang có. |
| `lib/nav-model.ts` | Thêm 1 mục vào menu Vận hành. |
| `__tests__/nav-model.test.ts` | Cập nhật danh sách route kỳ vọng cho khớp. |
| `.env.local.example` | Thêm 1 biến môi trường, kèm chú thích. |

**Hai dòng bị xoá** là hai dòng danh sách được viết lại để thêm phần tử vào — không có
hành vi nào đang chạy bị gỡ bỏ.

Nói cách khác: nếu module này hỏng, nó hỏng một mình. Không có đường nào nó làm hỏng
tuyển mentor, ghép cặp, sự kiện hay email.

### Cơ sở dữ liệu

Migration `074_mkt_plan.sql` — **7 bảng mới**, tất cả tên bắt đầu bằng `mkt_`.

- Additive hoàn toàn: không `drop table`, không `drop column`, không `alter` bảng nào
  đang có.
- Nằm trong **một giao dịch**, tự kiểm tra trước khi `commit`. Lỗi ở đâu thì huỷ toàn
  bộ, không để lại trạng thái nửa vời.
- RLS bật, **không policy nào**, chỉ `service_role` truy cập được. Bảng nhật ký chỉ ghi
  thêm, không sửa không xoá — kể cả `service_role`.
- Đọc `events` và `cross_requests` để lấy lịch hoạt động thật, nhưng **không bao giờ
  ghi vào**. Test kiểm chính điều này.

---

## Bốn quyết định của chủ chương trình, và chúng nằm ở đâu

Điểm đáng lưu ý: cả bốn đều nằm trong **schema**, không phải trong cấu hình. Nghĩa là
không ai vô tình làm sai được.

### 1. Tên thương hiệu = tên chương trình

Bản đặc tả gốc để chỗ trống `[TÊN THƯƠNG HIỆU]`. Ở đây tên đọc thẳng từ
`programs.name` — `UEH Mentoring`, `BK Mentoring`, `Banking Mentoring` — qua đúng một
hàm.

Hệ quả: đổi tên chương trình là đổi ở mọi nơi cùng lúc; và prompt không thể gọi nhầm
tên. Có test khẳng định prompt của Banking Mentoring không bao giờ chứa chữ
"UEH Mentoring".

### 2. LinkedIn là một kênh chung — cơ sở dữ liệu giữ luật

Mỗi chương trình là một **không gian** riêng (fanpage riêng, hàng đợi duyệt riêng).
VAM có thêm **đúng một** không gian chung.

Luật được viết thành ràng buộc:

```sql
check ((channel = 'linkedin') = is_shared)
```

Nghĩa là bài LinkedIn nằm trong tuần của UEH Mentoring **không phải lỗi có thể xảy
ra** — cơ sở dữ liệu từ chối ghi. Một bài mỗi tuần, đã gieo sẵn.

### 3. TikTok là một cái công tắc

Kênh là **dòng trong bảng**, không phải cấu hình dạng JSON. TikTok và YouTube được gieo
sẵn ở trạng thái tắt; support team bật bằng cách gạt cờ và điền số bài mỗi tuần.

Tắt lại thì dòng vẫn còn — bài cũ giữ nguyên lịch sử, không mất.

### 4. Toàn bộ chạy DeepSeek

Tầng gọi mô hình của ứng dụng vốn chỉ nói API của DeepSeek. Không thêm nhánh Claude nào.

Công tắc riêng `VAM_OS_MKT_AI_ENABLED`, tách khỏi công tắc AI ghép cặp — vì một chương
trình có thể muốn AI viết bài mà không muốn AI ghép cặp.

**Không bật AI thì module vẫn dùng được**, chỉ mất phần gợi ý; mọi ô soạn tay vẫn hoạt
động bình thường.

---

## Cái gì không rút lại được

**Gần như không có gì.**

| Hành động | Rút lại được? |
|---|---|
| Sinh plan tháng / plan tuần | Có — sinh lại, hoặc sửa tay |
| Sửa nội dung bài | Có |
| Duyệt bài | Có — chưa có gì ra ngoài |
| Bỏ qua slot | Có |
| Bật/tắt kênh | Có |
| **Đăng bài lên fanpage** | **Không — nhưng việc này do người làm, app không đăng** |

Đây là khác biệt lớn nhất so với các module trước (email, cross-mentoring): **không có
gì trong module này tự rời khỏi hệ thống.** Bài dừng ở trạng thái "đã duyệt", người phụ
trách mở trang và đăng, rồi dán link về để ghi nhận.

Đó cũng là lý do `support_team` được cấp quyền đầy đủ ở đây, trong khi họ bị chặn ở bước
tạo sự kiện của cross-mentoring.

### Quay lui migration

Bảy bảng đều mới và chưa có dữ liệu ngay sau khi chạy, nên xoá sạch được bằng bảy câu
`drop table`. Chỉ dùng khi chưa ai dùng tính năng — khi đã có bài thật thì đó là xoá
dữ liệu thật.

---

## Chi phí

Ước lượng token cho mỗi lần gọi DeepSeek:

| Việc | Vào | Ra |
|---|---|---|
| Sinh master plan tháng | ~2.000 | ~1.500 |
| Sinh plan tuần (12 slot) | ~3.500 | ~6.000 |
| Viết lại 1 bài | ~2.000 | ~800 |

Một tháng vận hành đủ 5 chương trình: 5 master plan + 20 plan tuần + khoảng 30 lần viết
lại ≈ **250.000 token**. Theo giá DeepSeek hiện hành thì đây là con số rất nhỏ; vẫn nên
tự đối chiếu bảng giá trước khi bật, vì giá có thể đã đổi.

Có hai cơ chế chặn chi phí ngoài dự kiến:

- Mỗi lần gọi **thử lại đúng 1 lần** nếu JSON hỏng, không lặp vô hạn.
- Bộ quy tắc "viết như người thật" được rút gọn còn khoảng 40 dòng. Bản gốc dài hàng
  trăm dòng, phần lớn là danh sách từ khoá tiếng Anh không bắt được văn AI tiếng Việt —
  nhét cả vào thì tốn thêm ~9.000 token **mỗi lần gọi**.

---

## Đã kiểm chứng tới đâu — và chưa tới đâu

### Đã kiểm chứng

- `npm run typecheck` — sạch
- `npm run lint` — sạch
- `npx vitest run` — **2.938 test qua**, trong đó **154 test mới** cho module này
- `npm run build` — sạch, 5 route mới sinh ra đúng

154 test mới chia thành:

| | |
|---|---|
| Lõi lịch (chia slot, ghép kết quả về slot, gợi ý giờ đăng, múi giờ) | 57 |
| Lõi prompt (tên thương hiệu, khối định hướng, lọc dữ liệu cá nhân) | 53 |
| Hợp đồng migration (RLS, phân quyền, các ràng buộc, seed) | 44 |

### CHƯA kiểm chứng — hai điều, và cả hai đều thật

**1. Migration chưa chạy trên bất kỳ cơ sở dữ liệu nào.** Phần tự kiểm tra đã được viết
nhưng chưa từng được Postgres thực thi. Test đọc file SQL dưới dạng văn bản, không chạy
nó. Cột sinh tự động và khoá phức hợp là những thứ nên thử trên staging trước.

**2. Chưa có prompt nào được gửi tới DeepSeek thật.** Cấu trúc prompt đã được test kỹ —
tên đúng, không lọt dữ liệu cá nhân, khối định hướng luôn có mặt. Nhưng **chất lượng bài
viết ra thì chưa ai đọc.** Đây là thứ không test tự động nào thay thế được.

Không có test nào trong repo gọi mạng, nên đây không phải sơ suất — đây là ranh giới của
những gì kiểm chứng được trước khi chạy thật.

---

## Rủi ro, và cách đã chặn

| Rủi ro | Đã chặn thế nào |
|---|---|
| AI trả lời hỏng làm vỡ lịch tuần | Lịch do **code** chia, AI chỉ điền vào. Ô nào AI không trả về thì **để trống và đếm lên màn hình**, không bịa bù. |
| AI bịa tên sinh viên, lời khen, con số | Quy tắc cấm ghi thẳng trong prompt, cộng một lớp kiểm tra bản nháp trả về: có email hay số điện thoại thì báo người dùng kiểm tra. |
| Dữ liệu cá nhân của mentee lọt sang bên thứ ba | Mọi ô chữ do người gõ đều đi qua bộ lọc email / số điện thoại / MSSV / link Facebook trước khi vào prompt. Dùng chung bộ lọc với bài đăng cross-mentoring. |
| Sinh lại tuần làm mất công người đã sửa | Bài đã duyệt, đã đăng, hoặc đã có link hình được **giữ nguyên** và đếm riêng trong thông báo. |
| Đăng nhầm bài của chương trình này sang chương trình kia | Tên thương hiệu lấy từ bản ghi chương trình; tên hiện ở đầu cả bốn tab. |
| Bài LinkedIn lọt vào tuần của một trường | Ràng buộc CHECK ở tầng cơ sở dữ liệu. |
| Đề nghị đăng bài bị bỏ quên | AI bắt buộc báo cáo đã xử lý từng đề nghị thế nào, và liệt kê đề nghị chưa xếp được. Cả hai hiện lên màn hình. |
| Cùng một đề nghị được lặp lại nhiều tuần | Đề nghị đã vào plan chuyển sang trạng thái "đã xếp", không quay lại prompt tuần sau. *(Đây là lỗi tôi phát hiện khi viết ghi chú này và đã sửa — commit `8036c36`.)* |
| Chi phí AI ngoài dự kiến | Thử lại đúng 1 lần; prompt đã rút gọn. |

---

## Việc phải làm

### Trước khi merge

- [ ] Đọc `supabase_migrations/074_mkt_plan.sql` — riêng phần chú thích đầu file giải
      thích vì sao chọn mô hình "không gian" thay vì một dòng cấu hình.
- [ ] Xác nhận việc cấp quyền cho `support_team` là đúng ý (họ duyệt bài và ghi nhận đã
      đăng, cho fanpage của chương trình mình).

### Sau khi merge, trước khi dùng thật

- [ ] Chạy migration `074` trên **staging** trước, theo quy trình như `072`/`073`.
- [ ] Kiểm tra: mỗi chương trình đang hoạt động có đúng một không gian, và có đúng một
      không gian chung giữ LinkedIn.
- [ ] Đặt `VAM_OS_MKT_AI_ENABLED=true` và `DEEPSEEK_API_KEY` trên staging.
- [ ] **Chạy thử trọn một tuần cho một chương trình** — sinh plan, đọc bài AI viết, sửa,
      duyệt. Đây là bước duy nhất trả lời được câu "chất lượng có dùng được không".
- [ ] Nếu đọc thấy được: điền hồ sơ thương hiệu cho từng chương trình, đặc biệt là ô
      **Hiện trạng trang**. Không có ô đó, AI chép lại nếp cũ vì nó chỉ nhìn thấy nếp cũ.
- [ ] Rồi mới chạy migration trên production.

### Thứ tự merge

Module này xếp chồng trên chuỗi mùa 12. Merge theo thứ tự:

**#35 → #36 → #37 → #38 → #39 → #40 → #41 → #44**

---

## Những thứ cố ý không làm

Ghi lại để khỏi mất công tranh luận sau:

- **Không auto-post.** Không nối API nền tảng nào. Thứ đã ra ngoài thì không thu hồi
  được, nên khoảnh khắc nó ra ngoài phải là quyết định của một người.
- **Không tạo storage bucket.** Cả ứng dụng chưa dùng Supabase Storage ở đâu; thêm vào
  cho một tính năng là thêm một mặt phân quyền mới. Designer dán link Canva hoặc Drive,
  giống cách `bio_url`, `recap_url`, `posted_url` đang làm.
- **Không đo hiệu quả bài đăng.** Số liệu tương tác nằm ở nền tảng; kéo về là một module
  khác, đừng trộn vào đây.
- **Không tách vai Content và Designer.** Đội còn nhỏ; tách vai lúc này chỉ tạo ma sát.

---

## Tóm lại

Module gần như hoàn toàn là mã mới — 22 file mới, 4 file cũ được thêm dòng, 2 dòng bị
xoá và cả hai chỉ là danh sách được nối dài. Không có gì trong đó tự rời khỏi hệ thống.
Migration additive, nằm trong một giao dịch, tự kiểm tra trước khi commit.

Hai điều chưa ai xác nhận được: migration chưa chạy trên Postgres thật, và chưa ai đọc
một bài do DeepSeek viết ra từ prompt này. Cả hai đều chỉ trả lời được bằng cách chạy
trên staging.

Rủi ro merge thấp. Rủi ro dùng ngay trên production mà chưa thử một tuần thật thì không
thấp — không phải vì hỏng hệ thống, mà vì có thể mất công điền hồ sơ cho năm chương
trình rồi mới phát hiện chất lượng chưa đạt.
