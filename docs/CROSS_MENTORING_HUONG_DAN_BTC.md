# Cross-mentoring — hướng dẫn cho ban tổ chức

*Giai đoạn 8. Viết cho người vận hành chương trình, không cần biết kỹ thuật.*

---

## Cross-mentoring là gì trong hệ thống này

Một bạn mentee muốn nghe chia sẻ về một lĩnh vực mà mentor của mình không làm.
Bạn ấy nêu nguyện vọng, ban tổ chức duyệt, hệ thống mời đúng nhóm mentor có
lĩnh vực đó, mentor nào nhận lời thì ban tổ chức chọn một người, chốt giờ và
địa điểm, tạo sự kiện cho mentee đăng ký, rồi điểm danh như mọi buổi khác.

Trước đây việc này chạy hoàn toàn qua tin nhắn cá nhân. Mùa 11 có khoảng 15
buổi như vậy trong một tháng mà hệ thống chỉ biết đến sau khi đã diễn ra, qua
recap. Từ giờ mọi bước đều được ghi lại.

---

## Toàn bộ quy trình, một hình

```
   Mentee                Ban tổ chức              Mentor              Hệ thống
     │                        │                      │                    │
  ┌──┴──┐                     │                      │                    │
  │ Gửi │────────────────────▶│                      │                    │
  │nguyện                     │                      │                    │
  │ vọng│               ┌─────┴─────┐                │                    │
  └─────┘               │ Duyệt hay │                │                    │
                        │  từ chối  │                │                    │
                        └─────┬─────┘                │                    │
                              │ duyệt                │                    │
                              ▼                      │                    │
                        ┌───────────┐                │                    │
                        │ Mời mentor│───────────────────────────────────▶ │
                        └─────┬─────┘                │            gửi thư │
                              │                      │        (mỗi người  │
                              │                      │         đúng 1 lần)│
                              │                 ┌────┴────┐               │
                              │◀────────────────│Nhận lời │               │
                              │                 │+ giờ rảnh               │
                              │                 └─────────┘               │
                        ┌─────┴─────┐                                     │
                        │Chốt mentor│──────────────────────────────────▶  │
                        └─────┬─────┘              thư "được chọn"        │
                              │                  + thư "lần này chưa"     │
                              ▼                                           │
                        ┌───────────┐                                     │
                        │Chốt giờ & │─────────────────────────────────▶   │
                        │ địa điểm  │                      tạo sự kiện    │
                        └─────┬─────┘                                     │
                              ▼                                           │
                        ┌───────────┐                                     │
                        │ Viết bài  │  (AI viết nháp, BTC sửa)            │
                        │  đăng     │                                     │
                        └─────┬─────┘                                     │
                              ▼                                           │
                        ┌───────────┐                                     │
   ┌─────┐              │Mở đăng ký │─────────────────────────────────▶   │
   │Đăng │◀─────────────└─────┬─────┘                  link + QR          │
   │ ký  │                    │                                          │
   └──┬──┘                    │                                          │
      │                       │                                          │
   ┌──┴──┐                    │                                          │
   │Check│                    │                                          │
   │ -in │                    │                                          │
   └─────┘              ┌─────┴─────┐                                     │
                        │ Chốt sổ   │  ← ai đăng ký mà không tới          │
                        └───────────┘     được ghi nhận vắng ở đây        │
```

---

## Trước khi bắt đầu mùa: mentor phải khai lĩnh vực

Hệ thống chỉ mời được mentor nếu biết mentor đó master lĩnh vực nào.

**Mentor khai ở đâu:** trong cổng người tham gia, `Trang chương trình →
Cross-mentoring`. Có 14 nhóm ngành nghề và 14 mảng công việc, tick bao nhiêu
cũng được.

**Mentor mới không cần làm gì:** ai nộp đơn qua form ứng tuyển thì lĩnh vực
trong đơn được mang sang tự động lúc ban tổ chức duyệt đơn. Mentor mở cổng ra
sẽ thấy sẵn, kèm dòng nhắc "lấy từ đơn đăng ký, vui lòng kiểm tra".

**Mentor cũ nhập từ Excel mùa trước** sẽ trống cho tới khi họ tự khai. Nếu số
này nhiều, nên nhắc trong email đầu mùa.

> **Vì sao không hỏi ở form xác nhận tham gia mùa?** Vì form đó tự khoá lại
> ngay khi mentor đã được ghép cặp, mà cross-mentoring lại chạy sau khi ghép
> cặp xong. Hỏi ở đó nghĩa là không hỏi được đúng những mentor cần hỏi.

---

## Bước 1 — Mentee gửi nguyện vọng

Mentee vào cổng, chọn lĩnh vực từ danh sách, mô tả muốn nghe gì (ít nhất 20 ký
tự), gửi.

Giới hạn: **mỗi bạn tối đa 3 nguyện vọng đang chờ**, và không gửi hai lần cho
cùng một lĩnh vực. Đây là để một bạn nhiệt tình không lấp kín hàng đợi.

---

## Bước 2 — Duyệt

`Vận hành → Cross-mentoring`. Hàng đợi hiện đề xuất mới nhất trước, kèm số ngày
đã chờ — chờ quá 7 ngày thì con số chuyển màu.

Mở một đề xuất, đọc, rồi **Duyệt** hoặc **Từ chối**.

**Từ chối bắt buộc ghi lý do.** Mentee sẽ đọc được lý do đó trong cổng của mình.
Đây là chỗ tiết kiệm nhiều thời gian nhất về sau: không ai phải nhớ vì sao một
đề xuất bị từ chối ba tuần trước.

*Ai làm được bước này:* super admin, admin, core team, **và support team**.

---

## Bước 3 — Mời mentor

Bấm **Gửi thư mời**. Hệ thống tìm mọi mentor đã khai lĩnh vực đó trong mùa và
gửi cho mỗi người một email kèm đường dẫn riêng.

Sau khi gửi xong, màn hình báo đầy đủ:

> *Đã mời 12 mentor, 3 người được nghỉ (chưa được chọn 2 lần), 2 người đã mời
> trước đó, 1 người chưa có email.*

Bốn con số này luôn hiện, kể cả khi bằng 0. Nếu anh/chị nghĩ có 20 mentor mà chỉ
12 thư đi, dòng này nói vì sao.

**Ba điều hệ thống tự lo:**

| | |
|---|---|
| **Mỗi mentor đúng một thư** | Bấm nút hai lần cũng không ai nhận hai thư. Hệ thống "giữ chỗ" trước rồi mới gửi. |
| **Không mời mentor của chính bạn mentee đó** | Cross-mentoring là gặp người ngoài cặp của mình. |
| **Người đã 2 lần nhận lời mà chưa được chọn thì được nghỉ** | Hết mùa mới tính lại. Vẫn mời tay được nếu cần. |

**Nếu chưa mentor nào khai lĩnh vực đó:** hệ thống báo thẳng, và không gửi thư
nào. Lúc đó cần nhắc mentor cập nhật, hoặc liên hệ tay.

*Ai làm được bước này:* như bước 2, có support team.

---

## Bước 4 — Mentor trả lời

Mentor bấm link trong email, thấy lĩnh vực và điều mentee muốn nghe, rồi chọn
**Tôi nhận lời** hoặc **Lần này tôi chưa sắp xếp được**.

Nếu nhận lời, mentor điền được tới 5 khung giờ rảnh — **không bắt buộc**. Mentor
chỉ muốn bấm một nút rồi đóng máy thì vẫn xong.

Thư mời có hạn **21 ngày**. Hết hạn thì link báo hết hạn và mời mentor trả lời
email trực tiếp.

Trang này **không bao giờ** cho mentor biết ai khác được mời, bao nhiêu người đã
nhận lời, hay ai được chọn.

---

## Bước 5 — Chốt mentor

Trong trang chi tiết, phần **Chốt mentor** liệt kê những người đã nhận lời, kèm:

- khung giờ họ đề nghị (hoặc dòng "không nêu khung giờ — cần liên hệ"),
- ghi chú của họ,
- **và nhãn cảnh báo nếu người đó đã 1 lần chưa được chọn trong mùa này.**

Nhãn đó có mặt để anh/chị nhìn thấy *trước khi* bấm, rằng người này nếu không
được chọn lần nữa sẽ bị hệ thống cho nghỉ.

Tick người được chọn rồi bấm **Chốt và gửi thư**. Ngay lúc đó:

- người được chọn nhận thư báo được phụ trách buổi,
- những người còn lại nhận thư cảm ơn, nói rõ **lý do là lịch và chia đều cơ
  hội, không phải hồ sơ hay chuyên môn**, và họ vẫn nằm trong danh sách mời lần
  sau.

**Hai thư này không rút lại được.** Vì vậy bước này cần core team trở lên.

---

## Bước 6 — Chốt giờ, địa điểm và tạo sự kiện

Điền thời gian và địa điểm (hoặc link nếu online), bấm **Chốt lịch và tạo sự
kiện**.

Từ giây phút này đề xuất **không quay lui được nữa** — sự kiện đã tồn tại và
mentee có thể đăng ký. Muốn đổi ý thì dùng nút **Huỷ**.

Mentee đề xuất buổi này nhận email báo đã có lịch.

Mentor được chốt được ghi thẳng vào danh sách người tham dự với vai trò mentor —
không cần mentor điểm danh, theo đúng quyết định của chủ chương trình.

*Ai làm được:* core team trở lên. Support team không thấy nút này.

---

## Bước 7 — Bài đăng fanpage

Bấm **Nhờ AI viết nháp**. Bản nháp hiện trong ô bên dưới để sửa, rồi **Lưu bài
đăng**.

**AI được biết:** tên, chức danh, công ty của mentor, lĩnh vực, thời gian, địa
điểm. Đúng những gì sẽ đăng công khai.

**AI không bao giờ được biết:** tên mentee, email, số điện thoại, mã số sinh
viên. Nội dung mentee viết được lọc sạch những thứ đó trước khi gửi đi — kể cả
khi bạn ấy tự gõ số điện thoại vào ô mô tả.

Nếu bản nháp trả về có gì đó giống email hay số điện thoại, hệ thống nói ra để
anh/chị kiểm tra. Bản nháp vẫn được lưu — người đọc lại vẫn là người quyết.

Chưa bật AI cũng không sao: ô soạn bài vẫn dùng bình thường.

---

## Bước 8 — Mở đăng ký

Bấm **Mở đăng ký**. Hệ thống tạo link và QR như mọi sự kiện khác.

Mentee đăng ký được **hai đường**:

1. **Trong cổng** — mở `Cross-mentoring`, thấy các buổi đang mở, bấm đăng ký.
2. **Qua link/QR công khai** — như training.

> **Nên khuyến khích đường thứ nhất.** Đăng ký trong cổng thì hệ thống biết chắc
> ai là ai. Đăng ký qua form công khai mà gõ email khác với email trong hồ sơ
> thì dòng đó không gắn được vào ai, và bạn đó dự 4 buổi vẫn hiện là dự 0 buổi.

---

## Bước 9 — Sau buổi gặp: chốt sổ

**Đây là bước hay bị quên, và là bước làm cho số liệu đúng.**

Sau khi buổi gặp diễn ra xong, mở trang chi tiết và bấm **Chốt sổ**. Lúc đó:

- ai đăng ký mà không check-in → ghi nhận **vắng**,
- mentor được chốt → ghi nhận **có mặt**.

Chưa bấm chốt sổ thì hệ thống không phân biệt được "đăng ký mà không tới" với
"buổi chưa diễn ra", và tỷ lệ tham dự sẽ sai.

---

## Cách hệ thống tính tỷ lệ tham dự

Bốn quy tắc, để đọc con số cho đúng:

| Trường hợp | Cách tính |
|---|---|
| Đăng ký rồi **báo huỷ** | Không tính vào đâu cả. Bạn ấy đã cư xử đúng. |
| **Tới mà không đăng ký trước** | Tính là có mặt, không tính vào mẫu số. Nên tỷ lệ không bao giờ vượt 100%. |
| Buổi **chưa chốt sổ** | Không tính. Chưa diễn ra thì chưa thể vắng. |
| Đăng ký **không gắn được vào ai** | Báo riêng thành một con số, không âm thầm bỏ đi. |

Công thức: **có mặt ÷ (có mặt + vắng)**. Không phải chia cho tổng đăng ký.

---

## Ai làm được gì

| Việc | super admin | admin | core team | support team | reviewer, viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Xem hàng đợi | ✔ | ✔ | ✔ | ✔ | — |
| Duyệt / từ chối đề xuất | ✔ | ✔ | ✔ | ✔ | — |
| Gửi thư mời mentor | ✔ | ✔ | ✔ | ✔ | — |
| Viết bài đăng | ✔ | ✔ | ✔ | ✔ | — |
| **Chốt mentor** | ✔ | ✔ | ✔ | — | — |
| **Chốt lịch, tạo sự kiện** | ✔ | ✔ | ✔ | — | — |
| **Mở đăng ký** | ✔ | ✔ | ✔ | — | — |
| **Chốt sổ, huỷ** | ✔ | ✔ | ✔ | — | — |

Support team làm được phần điều phối — đúng bản chất công việc. Bốn việc in đậm
đều tạo ra thứ không rút lại được (sự kiện công khai, thư đã gửi), nên giữ ở
core team trở lên.

---

## Những câu hay hỏi

**Gửi thư mời rồi mà muốn mời thêm một mentor nữa?**
Bấm lại **Gửi thư mời**. Ai đã nhận thư sẽ không nhận lần hai — dòng báo kết quả
ghi rõ "đã mời trước đó".

**Mentor nhận lời rồi báo bận?**
Chọn người khác. Người vừa báo bận không nhận thư "chưa được chọn" nếu ban tổ
chức đã huỷ buổi; nếu chỉ đổi người thì họ nhận thư như bình thường.

**Huỷ buổi thì mentor có bị tính là "chưa được chọn" không?**
**Không.** Huỷ bởi ban tổ chức không tính vào số lần của bất kỳ ai. Đây là yêu
cầu của chủ chương trình và hệ thống làm đúng như vậy.

**Một mentor bị nghỉ rồi, muốn mời lại?**
Việc "nghỉ" chỉ áp dụng cho đợt gửi thư tự động. Liên hệ trực tiếp vẫn được, và
số lần được tính lại từ đầu khi sang mùa mới.

**Một buổi có được nhiều mentor không?**
Có. Ở bước chốt, tick nhiều người là được.

**Mentee khác có đăng ký buổi do bạn khác đề xuất không?**
Có. Buổi cross là sự kiện mở cho cả mùa.

---

## Giới hạn của đợt này

- **Chưa có form chấm điểm buổi cross.** Chủ chương trình đã nói để sau. Chỗ móc
  đã chừa sẵn.
- **Bảng sự kiện chưa có ô địa điểm riêng.** Địa điểm được lưu ở đề xuất và chép
  vào phần mô tả sự kiện. Sửa bảng sự kiện là việc riêng.
- **Trước khi dùng thật cần chạy hai migration** `072` và `073` trên cơ sở dữ
  liệu, theo đúng quy trình sao lưu → chạy → kiểm tra như mọi lần.
