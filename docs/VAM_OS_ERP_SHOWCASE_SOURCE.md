# VAM OS — Bản kiểm kê tính năng đầy đủ

**Nguồn để tổng hợp thành tài liệu giới thiệu show case: "Làm ERP cho một tổ chức
giáo dục / đào tạo / mentoring".**

> **Bản song ngữ.** Bản tiếng Anh nằm ở
> [`VAM_OS_ERP_SHOWCASE_SOURCE_EN.md`](VAM_OS_ERP_SHOWCASE_SOURCE_EN.md), đánh số
> mục **1:1** với file này (47 tiêu đề khớp nhau), để ghép song ngữ theo từng mục
> mà không phải dò tay. Đối tượng của bản tiếng Anh: chủ đầu tư trường và tổ chức
> giáo dục nước ngoài.

| | |
|---|---|
| Chốt số liệu | 24/09/2026, commit `536446a` |
| Hệ thống thật | `os.alumni-mentoring.edu.vn` |
| Tổ chức | Vietnam Alumni Mentoring (VAM) — vận hành UEH Mentoring và 8 chương trình khác |
| Trạng thái | Đang chạy production, phục vụ mùa tuyển sinh S12 |

> **Cách dùng file này.** Đây là bản kiểm kê *sự thật*, không phải bản quảng cáo.
> Mọi con số đều đọc từ database production hoặc đếm từ mã nguồn tại commit ghi ở
> trên. Khi tổng hợp thành tài liệu giới thiệu, hãy giữ nguyên các con số và đừng
> làm tròn lên. Mục 9 ghi rõ những gì **chưa** có — giữ lại phần đó trong bản nội
> bộ; phần trình bày ra ngoài thì tuỳ, nhưng đừng để tài liệu hứa thứ chưa tồn tại.

**Ký hiệu trạng thái dùng xuyên suốt mục 4:**

| Ký hiệu | Nghĩa |
|---|---|
| ● | **Đang chạy production** — người thật đang dùng hôm nay |
| ◐ | **Đã dựng, chờ merge** — mã, migration và test đã có và đã qua bốn cổng, chưa lên production |
| ○ | **Đã thiết kế** — có bản thiết kế, chưa có mã |

Mục không mang ký hiệu nào mặc định là ●.

---

## 1. VAM OS là gì

Một hệ ERP nội bộ, viết riêng cho vòng đời của một chương trình mentoring: từ lúc
mở form nhận đơn, qua chấm hồ sơ, phỏng vấn, ghép cặp mentor–mentee, tổ chức sự
kiện, ghi nhận từng buổi mentoring, cho tới báo cáo tháng và chuyển mùa.

Điểm khác với một ERP doanh nghiệp thông thường không nằm ở module nào, mà nằm ở
**đối tượng phục vụ**: phần lớn người dùng hệ thống là **tình nguyện viên** —
mentor là người đi làm, dành buổi tối để chấm hồ sơ; ban tổ chức là sinh viên và
cựu sinh viên làm ngoài giờ. Không ai được đào tạo sử dụng phần mềm, không ai có
thời gian đọc hướng dẫn, và không ai bị sa thải nếu bỏ dở. Điều đó chi phối gần
như mọi quyết định thiết kế trong tài liệu này:

- **Không bắt đăng nhập ở chỗ không cần.** Ứng viên, người dự sự kiện, mentor gia
  hạn — tất cả làm việc qua link cá nhân trong hộp thư của chính họ.
- **Sai một ô không được bắt làm lại từ đầu.** Form giữ nguyên những gì đã điền.
- **Cổng quyền đóng khi hỏng.** Không đọc được bảng phân quyền thì trả lời
  "không", chứ không trả lời "có".
- **Nút nào hiện ra thì bấm được.** Menu không bao giờ mời một trang sẽ từ chối
  người bấm.

---

## 2. Quy mô thật

### 2.1 Dữ liệu đang vận hành (production, 24/09/2026)

| Đối tượng | Số dòng |
|---|---:|
| Người trong cộng đồng (`people`) | **1.360** |
| Đơn ứng tuyển | **1.919** |
| Câu trả lời trong đơn | **23.667** |
| Phiếu chấm hồ sơ / phỏng vấn | **854** |
| Cặp mentor–mentee | **637** |
| Tư cách thành viên theo mùa | **1.405** |
| Sự kiện | **23** |
| Lượt đăng ký sự kiện | **1.460** |
| Lượt tham dự đã ghi nhận | **964** |
| Recap buổi mentoring | **2.447** |
| Thư đã gửi (có nhật ký) | **2.186** |
| Dòng nhật ký kiểm toán | **1.880** |
| Tài khoản ban tổ chức | **75** (70 đang hoạt động) |
| Chương trình | **9** |

**Phân bố trạng thái 1.919 đơn** — cho thấy một pipeline tuyển sinh thật, không
phải dữ liệu demo:

| Trạng thái | Số đơn |
|---|---:|
| `submitted` — đã nộp, chờ xử lý | 921 |
| `screening_completed` — chấm hồ sơ xong | 494 |
| `approved_as_mentor` | 242 |
| `ready_for_final_decision` | 69 |
| `screening_assigned` — đã giao người chấm | 64 |
| `invited_to_interview` | 51 |
| `interview_scheduled` | 26 |
| `rejected_or_not_fit` | 25 |
| `interview_in_progress` | 12 |
| `approved_as_mentee` | 10 |
| `withdrawn` | 4 |
| `ready_for_screening` | 1 |

### 2.2 Quy mô mã nguồn

| | |
|---|---:|
| Commit | **753** (28/04/2026 → 24/09/2026, ~5 tháng) |
| Dòng mã ứng dụng (`app/` + `lib/` + `components/`) | **98.082** |
| Dòng mã kiểm thử (`__tests__/`) | **92.501** |
| Dòng SQL migration | **17.832** |
| File test | **376** |
| Ca kiểm thử | **7.649** |
| Trang (`page.tsx`) | **84** |
| Route API | **9** |
| Server action | **38 file** |
| Module nghiệp vụ (`lib/*.ts`) | **199** |
| Bảng trong `public` | **82** (RLS bật trên **82/82**) |
| Hàm database | **127** |
| RPC được ứng dụng gọi, có khai báo hợp đồng | **60** |
| Migration hiện hành | **53** (+52 file lịch sử) |

**Ngoài `main`, trên các nhánh đã dựng xong:** thêm **54.227 dòng** trải trên **233
file** — cross-mentoring, ghép cặp có AI hỗ trợ, xác nhận mentor đầu mùa, chọn
lọc hàng loạt, nhập recap, kho tài liệu chương trình. Mục 4.17–4.19 mô tả từng
lớp, kèm đường dẫn file để kiểm chứng.

> **Tỉ lệ mã kiểm thử / mã ứng dụng là 0,94 : 1.** Gần một dòng test cho mỗi dòng
> mã. Đây là con số đáng đưa vào tài liệu giới thiệu, vì nó giải thích vì sao một
> hệ thống chạm dữ liệu thật của hơn một nghìn người có thể deploy nhiều lần mỗi
> tuần.

---

## 3. Kiến trúc

```
Next.js 15 (App Router) + React 18.3.1 + TypeScript + Tailwind
        │
        ├─ Server Components đọc dữ liệu  ─┐
        ├─ Server Actions ghi dữ liệu      ├─ service_role client
        └─ Middleware: cổng đăng nhập,     ─┘   (bỏ qua RLS có kiểm soát)
           nhãn route công khai,
           no-store cho trang mang token
        │
Supabase (PostgreSQL)
        ├─ 82 bảng, RLS bật toàn bộ
        ├─ 127 hàm — nghiệp vụ nguy hiểm nằm trong SECURITY DEFINER
        └─ Auth (Custom SMTP)
        │
Brevo — gửi thư, ~300 thư/ngày gói miễn phí
Vercel — deploy tự động khi merge vào main
DeepSeek + Tavily — công cụ AI (tuỳ chọn, không lưu kết quả)
```

**Ba quy ước kiến trúc đáng nói trong show case:**

1. **`*-core.ts` là phần thuần.** Mọi module nghiệp vụ tách đôi: phần quyết định
   (không I/O, không Supabase) và phần đọc/ghi. Nhờ vậy luật nghiệp vụ kiểm được
   trọn vẹn mà không cần dựng bản giả của database — và cùng một luật được cả
   trang công khai (trình duyệt), server action (máy chủ) và bảng điều khiển đọc
   chung. Câu chữ trên màn hình không thể nói khác điều hàm ghi thật sự làm.

2. **RLS bật ở cả 82 bảng, nhưng chỉ 13 policy.** Đây là thiết kế cố ý, không
   phải thiếu sót: bật RLS mà **không** có policy nào nghĩa là chỉ `service_role`
   chạm được bảng đó. Khoá công khai (`anon`) nằm sẵn trong mã trang web, ai cũng
   lấy được; Supabase thì mặc định cấp quyền bảng cho `anon`. Ngày 16/09/2026 một
   lượt rà soát tìm ra **27 bảng đọc — và ghi — được từ bên ngoài** vì thiếu đúng
   hai dòng `enable row level security` và `revoke ... from anon`. Migration
   `20260916090000_lock_down_public_api.sql` đóng lại toàn bộ, và từ đó mọi bảng
   mới phải bật RLS ngay trong migration tạo bảng.

3. **Việc nguy hiểm nằm trong database, không nằm trong ứng dụng.** Bất cứ thao
   tác nào có tranh chấp (giữ chỗ phỏng vấn, nhận mentee trong hạn mức, phê duyệt
   hàng loạt) đều là một hàm `SECURITY DEFINER` khoá hàng rồi đếm lại, chứ không
   phải một vòng đọc-rồi-ghi trong JavaScript. Ứng dụng có thể chạy nhiều bản
   song song trên Vercel; database thì chỉ có một.

---

## 4. Kiểm kê tính năng theo module

### 4.1 Tuyển sinh — form ứng tuyển công khai

- **Hai form riêng** cho mentor và mentee (`/apply/mentor`, `/apply/mentee`), mỗi
  form có bộ câu hỏi, danh mục ngành nghề và chức năng công việc riêng.
- **Mở/đóng form từ giao diện**, không phải từ biến môi trường và không cần
  deploy (`Quản trị → Mùa & Form đăng ký`). Mỗi lần bật/tắt ghi một dòng kiểm
  toán. Quyền này **hẹp hơn mọi quyền admin khác** trong hệ thống — chỉ `admin`
  và `super_admin` — vì mở form là một hành vi xuất bản ra internet, còn đóng form
  giữa mùa là lặng lẽ cắt đường của người đang điền dở.
- **Sửa câu chữ của form** (lời mở đầu, ghi chú hạn nộp, đầu mối liên hệ) từ giao
  diện, tách khỏi quyền mở/đóng form: đổi một câu trên form đang mở không phải là
  một sự kiện xuất bản, nên nó rộng hơn một bậc.
- **Điểm cộng theo ngày nộp**: "nộp đến hết ngày X được cộng N điểm". Mốc đặt
  được khi form đã mở và đã có hàng trăm đơn, vì điểm cộng **tính lúc đọc** chứ
  không lưu vào từng đơn — sửa mốc là mọi màn hình đổi theo ngay, không cần chạy
  bù. Mỗi lần thêm/xoá mốc ghi nhật ký.
- **Thư xác nhận tự động** cho người nộp đơn, có nhật ký gửi.
- **Bù thư xác nhận** cho những người đã nộp trước khi tầng email tồn tại — một
  nút riêng, quyền hẹp ngang với việc mở form, vì bấm nhầm là thư đã nằm trong
  hộp thư của người ta và không thu hồi được.
- **Ngày nộp ghi theo giờ Việt Nam**, không phải giờ UTC. (Trước 16/09/2026 40
  đơn S12 lệch một ngày vì `toISOString().slice(0,10)` — đã sửa bằng migration
  và một hàm `vietnamDateKey` dùng chung.)

### 4.2 Chấm hồ sơ — vòng đánh giá nhiều người

- **Thang điểm 5 tiêu chí × 1–5 = 25 điểm**: Động lực · Rõ ràng mục tiêu · Cam
  kết · Phù hợp chương trình · Giao tiếp. Kèm một khuyến nghị và ghi chú của
  người chấm.
- **Giao hồ sơ**: giao từng phiếu, giao hàng loạt theo lô, hoặc giao đúng những
  đơn đã chọn trên màn hình. Mỗi lượt giao gửi thư báo cho người chấm.
- **Số phiếu tối thiểu cấu hình được theo mùa và theo vòng** (1–20). Một đơn chỉ
  chuyển sang bước sau khi đủ số phiếu đã nộp.
- **Bản nháp tự lưu** — người chấm thoát ra giữa chừng không mất điểm đã cho.
- **"Công việc của tôi"** (`/my-work`): hộp việc cá nhân, nằm **trên cùng** menu
  cho mọi vai trò có thể nhận việc. Đây là một *khung nhìn* của bảng
  `application_reviews`, không phải một bảng thứ hai — nên huỷ giao việc là item
  biến mất, giao lại là item chuyển sang người khác, nộp xong là item sang mục
  Hoàn tất, tất cả miễn phí, không cần mã đồng bộ.
- **Ban tổ chức sửa được nội dung phiếu** của người khác sau khi đã nộp — qua một
  hàm database riêng, ghi lại ai đổi gì. Đường của người chấm không bị đụng tới.
- **Bảng tiến độ chấm** và **danh sách nhân sự tuyển sinh** (`/reviews/progress`,
  `/reviews/reviewer-pool`).
- **Cấp quyền chấm cho người chưa có tài khoản**: hệ thống tạo tài khoản, cấp
  phạm vi mùa, gửi thư mời — một thao tác thay vì bốn.
- **Trang hướng dẫn chấm** ngay trong hệ thống (`/reviews/guide`).

### 4.3 Phỏng vấn

Hai luồng khác nhau, cho hai đối tượng khác nhau:

**a) Phỏng vấn mentor 1:1 — tự chọn giờ (đang chạy thật)**

- Interviewer khai **khung giờ rảnh** của mình trên lưới ngày × giờ.
- Ứng viên mentor nhận **link riêng** (`/dat-lich/<token>`), không cần đăng nhập,
  tự chọn một giờ trống.
- **Nhịp thư tự động**: thư mời, rồi nhắc ở ngày 3 – 6 – 9 nếu chưa đặt. Cron
  chạy 09:00 hằng ngày.
- **Huỷ hai chiều**: mentor tự huỷ khi còn hơn 24 giờ; ban tổ chức huỷ bất cứ
  lúc nào. Cả hai đều gửi thư cho cả hai phía.
- **Cổng mời**: chỉ những đơn đã **qua vòng chấm hồ sơ** mới nhận được link. (Đây
  là một lỗi thật đã xảy ra: 9 mentor nhận thư mời trước khi có ai chấm, và 12
  người nhận thư rồi mới bị từ chối. Cổng nay được siết ở cả ba nơi — hằng số
  TypeScript và hai hàm SQL — với một bài test đối chiếu hai chiều giữa mã và
  thân hàm SQL.)

**b) Phỏng vấn mentee — đặt ca cố định (đã dựng, chờ merge)**

- **12 ca cố định** trong hai ngày 03–04/10/2026, mỗi ngày 6 ca một tiếng.
- Mentee nhận link riêng (`/dat-ca/<token>`), chọn **một** ca.
- **Đổi ca không bao giờ mất chỗ cũ**: hàm database đếm ghế của ca mới trước, nếu
  đầy thì từ chối và giữ nguyên chỗ cũ; chỉ khi ca mới còn chỗ mới huỷ chỗ cũ và
  đặt chỗ mới. Có bài test tĩnh khẳng định thứ tự hai đoạn lệnh này trong thân
  hàm SQL.
- **Sức chứa là một phép đếm, không phải một khoá**: cưỡng chế bằng khoá hàng rồi
  đếm lại, không bằng unique index.
- **Để trống số ghế = ca ĐÓNG**, không phải "không giới hạn". Fail-closed.
- **Màn hình ban tổ chức điền số ghế và địa điểm** cho cả 12 ca: điền một lượt
  cho cả đợt hoặc sửa từng ca; hai nút áp hàng loạt tách riêng, nút ghế không ghi
  đè địa điểm và ngược lại.

### 4.4 Quyết định và phê duyệt

- **Quyết định từng đơn** và **quyết định hàng loạt**, mỗi lần ghi một dòng
  `application_decisions` + một dòng kiểm toán.
- **Kiểm tra điều kiện trước khi quyết định**: hàm database trả về từng đơn một
  lý do riêng nếu không áp dụng được, chứ không gộp thành một câu "thất bại".
- **Phê duyệt chính thức hàng loạt** — biến người ứng tuyển thành thành viên của
  mùa: tạo hồ sơ mentor/mentee, ghi tư cách thành viên, chép **số suất mentee mà
  chính mentor đã khai** vào `capacity_target`.
- **Phân chia quyền theo vai trò ứng tuyển**: `support_team` quyết định kết quả
  **mentee** tới tận phê duyệt chính thức; kết quả **mentor** thuộc core team trở
  lên. Vai trò ứng tuyển đọc từ **đơn đã lưu**, không đọc từ form gửi lên — một
  request khai "mentee" về một đơn mentor chính là cách đi vòng qua phép chia
  này, và database kiểm lại chính phép chia đó cho từng đơn.
- **Khôi phục đơn đã rút** (`vam095_restore_withdrawn_application`).
- **Mời vào vòng phỏng vấn hàng loạt** (`/applications/bulk-invite-interview`).
- **Xuất dữ liệu**: CSV và PDF cho từng đơn, CSV cho kết quả tuyển sinh và bảng
  điểm. Cổng tải file **hẹp hơn** cổng đọc trang, và đó là cố ý — một file xuất
  ra mang họ tên, email, số điện thoại và MSSV của hàng trăm người.

### 4.5 Ghép cặp mentor–mentee

- **Ghép tay có kiểm sức chứa**: đọc `capacity_target` của chính mentor đó (65
  mentor S12 khai 1 suất, 57 khai 2 — áp cứng 3 cho tất cả là giao ba mentee cho
  người đã nói một).
- **Ngăn kéo xem nhanh hồ sơ** ngay tại màn hình ghép: tên, trường, ngành mục
  tiêu và các câu trả lời đáng đọc — dùng **cùng một bộ nhãn và cùng danh sách
  loại trừ** với trang chi tiết đơn và file xuất. Một khoá có nhãn tiếng Việt ở
  đó thì có nhãn ở đây cùng ngày. Trường liên lạc bị loại trừ có chủ ý: ngăn kéo
  này để đánh giá độ hợp, không phải để liên hệ ai.
- **Tìm kiếm mentor/mentee** theo ngành, chức năng, từ khoá.
- **Lịch sử cặp ghép** và **huỷ cặp**.

### 4.6 Sự kiện — từ mở đăng ký tới điểm rèn luyện

Module lớn nhất của hệ thống.

- **13 loại sự kiện**, xếp theo **dòng thời gian của một mùa** chứ không theo
  bảng chữ cái: Orientation mentee · Orientation mentor · Orientation chung ·
  Ngày phỏng vấn · Kickoff · Training · Cross-mentoring · Company tour · Business
  case · Job shadowing · Networking · Tổng kết · Khác.
- **Chuỗi sự kiện nhiều buổi** với link đăng ký chung, người đăng ký chọn buổi —
  hoặc chọn cả hai buổi.
- **Form đăng ký công khai** (`/register/<token>`), sửa được câu chữ từ giao
  diện, có sức chứa từng buổi.
- **Vé cá nhân có mã QR** (`/ve/<code>`) — mở được trên điện thoại chưa đăng
  nhập, ở ngay cửa sự kiện. Trang này gắn `no-store` và `Referrer-Policy:
  no-referrer`.
- **Máy quét cho người hỗ trợ** (`/events/[id]/scan`): quét mã trên điện thoại
  người tham dự. Không ai phải gõ gì.
- **Tới 20 lần quét cho một sự kiện**, mỗi lần chọn một mục trong 6 loại: Check
  in · Check quầy đổi quà · Check quầy trải nghiệm · Check talkshow · Check
  seminar · Check out. Khoá của một lượt quét theo **mục** (`talkshow`,
  `talkshow_2`) chứ không theo **số thứ tự** — chèn thêm một trạm vào giữa không
  được phép đẩy số của mọi trạm phía sau.
- **Khảo sát sau sự kiện** (`/khao-sat/<token>`), và **nộp phiếu chính là thao
  tác check out**. Lý do: sinh viên dự Mentee Orientation được đề xuất điểm rèn
  luyện với căn cứ "có check in VÀ có check out", mà bắt các bạn xếp hàng quét mã
  lần nữa lúc tan buổi là thứ không ai làm được trong ba phút cuối.
- **Người hỗ trợ sự kiện** (`event_supporters`): giao quyền quét mã cho người
  không phải ban tổ chức.
- **Thư nhắc lịch** bấm gửi từ trang sự kiện, và **thư báo đổi giờ** tự gửi cho
  những người đang giữ vé của buổi đó.
- **Điểm danh thủ công**, **ghi nhận walk-in**, 7 trạng thái tham dự.
- **Xuất CSV** danh sách đăng ký và tham dự.
- **Ghép người đăng ký với hồ sơ có sẵn** theo email/điện thoại đã chuẩn hoá,
  không tạo trùng người.

### 4.7 Recap — nhật ký buổi mentoring

- **2.447 recap** đã ghi. Mỗi recap là một buổi gặp giữa một cặp.
- **Tạo và sửa recap** từ giao diện ban tổ chức.
- **Báo cáo tháng** (`/operations/monthly`): số recap, mentee/mentor đang hoạt
  động, **mentor chưa có recap nào trong tháng** — chỉ số chính để biết cặp nào
  đang nguội.
- **Thư nhắc tới kỳ thu recap** gửi cho ban tổ chức.

### 4.8 CRM và vòng đời thành viên

- **Hồ sơ một người** (`/people/[id]`) gom mọi thứ về họ: các mùa đã tham gia,
  vai trò trong từng mùa, đơn đã nộp, sự kiện đã dự, cặp đã ghép, ghi chú nội bộ.
- **Vòng đời tư cách thành viên** trong một mùa, đủ các chuyển trạng thái: tham
  gia · tạm dừng · kích hoạt lại · rút · xin không tham gia · huỷ · hoàn thành.
  Mỗi lần chuyển ghi một dòng `person_season_membership_log`.
- **Vai trò trong mùa**: mentor · mentee · trainer · speaker (thêm tay được), và
  reviewer · interviewer (chỉ sinh ra qua đường cấp quyền tuyển sinh — thêm tay
  một dòng trần chỉ tạo ra một reviewer không chấm được gì).
- **Phân chia quyền theo vai trò của người bị tác động**: core team đổi được
  mentor, support team chỉ đổi được mentee. Vai trò đọc từ **dòng đã lưu**, không
  đọc từ form.
- **Xoá hẳn một người khỏi hệ thống** — với một báo cáo *trước khi xoá* liệt kê
  đúng những gì sẽ mất, và một danh sách lý do khiến một hồ sơ **không được phép**
  xoá. Người vừa là mentor vừa là mentee tính theo mức quyền **chặt hơn**.
- **Ghi chú CRM** và **lịch sử liên lạc**.

### 4.9 Gia hạn mentor — mùa nối mùa

- **Link gia hạn cá nhân** (`/renew/<token>`) gửi cho mentor mùa trước.
- Mentor **xem lại hồ sơ cũ**, sửa những gì đã thay đổi, và xác nhận cam kết.
- **Đồng ý hoặc từ chối** đều ghi nhận; đồng ý thì tự tạo đơn và phê duyệt vào
  mùa mới.
- **Ô câu xác nhận báo ngay tại chỗ**: người gõ chưa khớp thấy phản hồi ngay khi
  gõ, chứ không phải sau khi bấm gửi rồi mới biết. (Một mentor gọi điện góp ý
  rằng gõ sai câu cam kết là phải điền lại toàn bộ từ đầu — ông sửa chỗ đó khá
  lâu.)
- **Form giữ nguyên những gì đã điền khi có lỗi.** React tự động xoá trắng form
  không kiểm soát sau khi server action chạy xong — **kể cả khi action trả về
  lỗi**. Đã áp `onReset` giữ giá trị cho toàn bộ form dài của hệ thống: gia hạn,
  đăng ký sự kiện, khảo sát, phiếu chấm.
- **Bảng điều khiển gia hạn** (`/admin/renewals`): ai đã trả lời, ai chưa, gửi
  lại link, thu hồi link.
- **Nhập mentor mùa cũ từ file**, có bước xem trước trước khi ghi.

### 4.10 Thư và truyền thông

- **25 loại thư** khai báo trong hệ thống, mỗi loại một builder riêng phía máy
  chủ. **Chữ của người nộp đơn không bao giờ được chèn vào thân thư** — một form
  công khai không được dùng để soạn hộ một bức thư.
- **Sổ thư đã gửi** (`/operations/emails`): lọc theo loại, trạng thái, tìm theo
  người nhận. 4 trạng thái: đang chờ · đã gửi · lỗi · bỏ qua.
- **Module Mail — soạn thư hàng loạt** (`/operations/mail`), với ba cổng quyền
  tách rời có chủ ý:
  - **Soạn nháp** — rộng nhất, gồm cả support team. Cả điểm của module này là để
    họ thôi phải mở ticket chỉ để sửa một câu.
  - **Duyệt mẫu thư** — chỉ admin trở lên. Sửa một mẫu đã duyệt thì nó rơi lại
    thành nháp, nên không ai gửi được câu chữ mà người duyệt chưa đọc.
  - **Bấm gửi** — hẹp nhất. Đặt tên riêng dù hôm nay cùng danh sách vai trò với
    quyền duyệt: hai câu hỏi khác nhau, và ngày một trong hai nới ra thì cái kia
    không được nới theo vì vô tình.
- **Mẫu thư giữ ô điền, không giữ tên thật**: `{{ten_nguoi_nhan}}` được thay lúc
  gửi, phía máy chủ. Nhờ vậy một mẫu thư có thể đưa người khác đọc, hay nhờ trợ
  lý viết hộ, mà không một dòng dữ liệu cá nhân nào rời khỏi hệ thống. Và hàm
  dựng thư **từ chối tạo ra một bức thư còn sót ô điền** — gửi cho một bạn sinh
  viên bức thư mở đầu "Chào {{ten_nguoi_nhan}}" tệ hơn là không gửi gì.
- **6 nhóm người nhận**, mỗi nhóm là một câu truy vấn viết sẵn chứ không phải bộ
  lọc gõ tự do: mentee · mentor · cả hai · ban tổ chức · mentor gia hạn · người
  đã đăng ký một sự kiện (có tham số: sự kiện nào, có gồm cả chuỗi không). Lý do:
  một lô không gửi xong trong một lần chạy, và lần "Gửi tiếp" phải dựng lại danh
  sách **đúng như lần đầu**; con số người bấm gõ để xác nhận phải bằng đúng con
  số máy chủ tự đếm.
- **Xem mẫu thư hệ thống** (`/operations/mail/samples`) — dựng từ dữ liệu bịa,
  không người nhận, không tên thật, không link chạy được. Support team đọc được
  để trả lời người nhận thư, mà không cần mở sổ thư thật.
- **Chống gửi trùng**: tra thư cùng loại đã gửi cho địa chỉ đó trong 60 phút gần
  nhất.
- **Tự dừng khi đụng hạn mức Brevo (429)** và gửi tiếp ở lượt sau.

### 4.11 Tài khoản, phân quyền và kiểm toán

**6 vai trò toàn cục**: `super_admin` · `admin` · `core_team` · `support_team` ·
`reviewer` · `viewer`.

**4 mức phạm vi theo chương trình/mùa**: `full_access` · `operations` · `review` ·
`read`. Một mức lạ **không cấp gì cả** và bị loại bỏ — trước đây nó được quy về
"read", tức là một lần ghi sai vào cột nullable là cấp quyền đọc thật.

**Mỗi cổng quyền là một hàm có tên riêng và có chú thích lý do.** File
`lib/permissions.ts` có hơn 40 predicate như vậy. Vài ví dụ cho thấy sự tách bạch
không phải là dư thừa:

| Cổng | Ai | Vì sao hẹp/rộng như vậy |
|---|---|---|
| `canToggleApplicationForm` | admin+ | Mở form là xuất bản ra internet |
| `canEditApplicationFormTexts` | core team+ | Sửa một câu trên form đang mở thì không |
| `canSendBulkEmail` | admin+ | Thư đã gửi không thu hồi được |
| `canComposeEmailTemplate` | support team+ | Soạn nháp thì chưa gửi gì cả |
| `canDecideApplicationResult` | tuỳ vai trò ứng tuyển | support team quyết mentee, core team quyết mentor |
| `canRunAiExecutiveReport` | admin+ | Công cụ AI duy nhất đọc dữ liệu chương trình |

**Bậc quản lý tài khoản**: admin quản core team, core team quản support team. Quy
tắc chỉ có một — **chỉ cấp thấp hơn mình**, không ngang cấp, không cấp trên,
không chính mình.

- **Nhập tài khoản ban tổ chức từ file**, có bước xem trước.
- **Mời mentor/mentee lập tài khoản đăng nhập** — một người hoặc cả mùa.
- **Tự đặt lại mật khẩu** ("Quên mật khẩu"), không cần hỏi ban tổ chức. Trả lời
  trung tính trong mọi trường hợp lỗi, để trang không thành một công cụ dò xem
  địa chỉ nào có tài khoản.
- **Nhật ký kiểm toán** `admin_audit_log` — 1.880 dòng, ràng buộc CHECK trên loại
  hành động, nên một loại hành động mới là một migration có người ký.
- **Phân công và trách nhiệm** (`/team`).

### 4.12 Công cụ AI

Sáu công cụ, tất cả **không lưu kết quả ở đâu cả**, và khoá API chỉ nằm trong
biến môi trường Vercel, không bao giờ mang tiền tố `NEXT_PUBLIC_`.

| Công cụ | Việc nó làm |
|---|---|
| Tìm ý tưởng hoạt động | Đề xuất ba hướng kèm nguồn lực, rủi ro, câu hỏi cần chốt |
| Viết content | Thông điệp chính, caption, bài dài, lời kêu gọi hành động |
| Brief thiết kế cho Canva AI | Prompt tiếng Anh dán thẳng vào Canva, kèm checklist cho người thiết kế |
| **Báo cáo Ban điều hành** | Tổng hợp tuyển sinh, ghép cặp, recap, sự kiện, việc vận hành |
| Xu hướng ngành tại Việt Nam | Có tìm kiếm web (Tavily), nêu rõ nguồn **trước** ô nhập |
| Soạn thảo văn bản | 8 loại văn bản hành chính, mỗi loại kèm **bố cục có thật** |

**Hai điều đáng kể trong show case:**

1. **Báo cáo Ban điều hành chỉ gửi đi con số, không gửi tên.** Kiểu dữ liệu đầu
   vào của nó **không có chỗ nào chứa tên, email hay mã người** — thứ rời khỏi
   VAM OS chỉ là nhãn cố định viết trong mã và con số đếm.
2. **Không đọc được là KHÔNG ĐỌC ĐƯỢC, không phải 0.** Một nguồn lỗi mà hiện
   thành 0 thì AI sẽ viết "tháng này không có recap nào" — một cảnh báo sai trình
   lên Ban điều hành, nghe hoàn toàn hợp lý.

Tám loại văn bản soạn được: Quyết định · Thông báo · Công văn gửi ra ngoài · Tờ
trình/Đề xuất · Biên bản · Quy định/Quy chế · Thư gửi mentor/tình nguyện viên ·
Khác. Mỗi loại mang một bố cục chuẩn đưa thẳng vào prompt — không có nó thì model
trả một bài văn xuôi đúng nội dung nhưng sai khuôn văn bản hành chính: thiếu
"Nơi nhận", thiếu căn cứ, thiếu chỗ ký.

Công cụ **đọc được file đính kèm**: PDF, Word, ảnh. Loại file quyết định bằng
**byte đầu của file**, không bằng MIME mà trình duyệt khai. Byte của file tải lên
chỉ được lấy ở đúng một chỗ trong toàn hệ thống.

**Xuất kết quả ra file Word** (`/api/ai-doc/docx`).

### 4.13 Vận hành và báo cáo

- **Tổng quan vận hành** (`/operations`) — KPI tháng đang chọn.
- **Nhiệm vụ và phân công** (`/operations/tasks`) — việc đang mở, việc quá hạn.
- **Báo cáo tháng** (`/operations/monthly`).
- **Phân tích mùa** (`/operations/intelligence`) — dashboard cho người sáng lập.
- **Rà soát dữ liệu** (`/data-issues`) — 276 vấn đề chất lượng dữ liệu đang được
  theo dõi, với quy trình sửa có kiểm duyệt (`activity_correction_log`).
- **Danh mục chương trình** (`/portfolio`) — 9 chương trình trên một màn hình,
  mỗi chương trình một chỉ báo sức khoẻ: bình thường · cần chú ý · lỗi dữ liệu ·
  chưa rõ.
- **Không gian làm việc riêng của một chương trình** (`/programs/<code>`).

### 4.14 Cổng công khai — làm việc không cần đăng nhập

Tám đường công khai, mỗi đường một nhãn riêng ở middleware:

| Đường | Ai mở | Bảo vệ |
|---|---|---|
| `/apply/mentor`, `/apply/mentee` | Người ứng tuyển | Cổng mở/đóng form |
| `/register/<token>` | Người đăng ký sự kiện | Token riêng |
| `/ve/<code>` | Người giữ vé | `no-store` + `no-referrer` |
| `/checkin/<token>` | Máy quét tại cửa | Token riêng |
| `/khao-sat/<token>` | Người vừa dự sự kiện | Token riêng |
| `/renew/<token>` | Mentor gia hạn | `no-store` + `no-referrer` |
| `/dat-lich/<token>` | Ứng viên mentor chọn giờ | `no-store` + `no-referrer` |
| `/dat-ca/<token>` | Ứng viên mentee chọn ca | `no-store` + `no-referrer` |
| `/blog`, `/blog/<slug>` | Bất kỳ ai | Mặc định NỘI BỘ |

**Nguyên tắc chung:** token là **chứng chỉ mang theo người** — ai cầm được token
là làm được việc của người đó. Nên mọi phép kiểm nằm trong hàm database, không
nằm ở trang; trang mang token không được nằm lại trong cache dùng chung; và
`Referrer-Policy: no-referrer` để token không rò sang trang khác qua header
referer.

**Cổng người tham gia** (`/ct`): mentor và mentee đăng nhập, xem các mùa mình đã
tham gia và chương trình của mình. Mã chương trình trên URL đến từ tay người
dùng, nên gõ mã của chương trình khác phải ra con số không — và câu trả lời cho
"mã không có thật" giống hệt câu trả lời cho "bạn không thuộc chương trình này",
vì phân biệt chúng là nói cho người ta biết chương trình nào tồn tại.

### 4.15 Blog

- Bài viết nội bộ và công khai, ba trạng thái: nháp · đã đăng · lưu trữ.
- **Mặc định là NỘI BỘ.** Quên chọn thì thành nội bộ, chứ không phải quên chọn
  thì thành công khai. Cái giá của hai lần quên rất khác nhau: một bài nội bộ để
  nhầm chế độ nội bộ thì chỉ ít người đọc hơn; để nhầm chế độ công khai thì cả
  internet đọc được — và khi Google đã đọc nó thì gỡ bài cũng không gỡ được bản
  lưu.
- Phép quyết định "ai đọc được bài nào" là **một hàm thuần duy nhất**, bị thử
  riêng với mọi tổ hợp nghĩ ra được. Không chỗ nào tự viết lại điều kiện của mình.

### 4.16 Đa chương trình và chuyển mùa

- **9 chương trình** đang hoạt động: UEH Mentoring · Hanoi Alumni Mentoring · BK
  Mentoring · DUE Mentoring · FTU Mentoring · HUB Mentoring · HUFLIT Mentoring ·
  Career Experience Program · Vietnam Alumni Mentoring.
- **Phạm vi truy cập theo chương trình × mùa**: một tài khoản có thể được cấp
  quyền vận hành UEHM-S12 mà không thấy gì của HAM.
- **Nhập dữ liệu lịch sử**: 11 bảng staging cho các mùa cũ (S11 đã nhập đủ:
  1.331 người, 637 cặp, 654 hồ sơ mentee, 448 hồ sơ mentor), với nhật ký những
  dòng bị bỏ qua và lý do.

### 4.17 ◐ Cross-mentoring — mentee gặp mentor ngoài cặp của mình

Nhánh `s12-phase8-cross-mentoring` · migration `072_cross_mentoring.sql` (654
dòng, 6 bảng) + `073_cross_mentoring_event_type.sql`.

Một mentee muốn hỏi về một lĩnh vực mà mentor của mình không làm. Cross-mentoring
là đường để điều đó xảy ra mà không phá vỡ cặp đang có.

- **Danh mục lĩnh vực** (`cross_mentoring_fields`) và **mentor khai mình nhận
  lĩnh vực nào** (`mentor_cross_fields`).
- **Mentee gửi nguyện vọng** từ cổng của chính mình (`/ct/<chương trình>/cross`)
  — không phải qua ban tổ chức.
- **Hệ thống hỏi các mentor phù hợp đúng một lần**, mỗi người một link riêng
  (`/cross/<token>`), không cần đăng nhập. Mentor chọn khung giờ mình nhận được.
- **Buổi cross-mentoring trở thành một bản ghi có vòng đời riêng**
  (`cross_requests` → `cross_invitations` → `cross_invitation_slots`), với nhật
  ký đầy đủ (`cross_request_log`).
- **Bảng điều khiển cho ban tổ chức**: `/operations/cross` và
  `/operations/cross/[id]`.
- **Bốn loại thư riêng** đã có sẵn trong `lib/email-core.ts` trên `main`:
  `cross_invite` · `cross_selected` · `cross_not_selected` · `cross_scheduled`.

### 4.18 ◐ Ghép cặp có AI hỗ trợ — AI chấm, mã nguồn quyết

Nhánh `s12-phase4-ai-matching` · `lib/ai-matching-core.ts` (581 dòng, kèm 581
dòng test) + migration `068_match_recommendations.sql`.

Đây là phần đáng đưa vào tài liệu giới thiệu nhất, vì nó trả lời câu hỏi mà mọi
tổ chức giáo dục đều hỏi khi nghe "AI": *rồi ai chịu trách nhiệm cho quyết định?*

Hai luật định hình toàn bộ module:

**1. Không một thông tin định danh nào rời khỏi hệ thống.** Một mentee là
`E001`, một mentor là `M001`; bảng tra từ mã ra người chỉ tồn tại ở phía VAM OS.
Thuộc tính lấy theo **allow-list** — không bao giờ bằng cách chép cả bản ghi rồi
xoá bớt trường, vì một câu hỏi mới thêm vào form ngày mai sẽ lập tức rò ra. Chữ
tự do được che (địa chỉ, số điện thoại, đường dẫn, tên của chính người viết)
**trước khi** được đưa vào.

**2. Model chấm điểm; mã nguồn phân công.** Nhà cung cấp AI chỉ được hỏi đúng một
câu: cặp này hợp đến đâu. Việc mentee nào về với mentor nào, và một mentor được
nhận mấy mentee, do hàm `assignPairs` quyết định, đối chiếu với **số suất chính
mentor đã xác nhận**. Một model bịa ra mã không có thật, trả về hai mươi cặp cho
một mentee, hay chấm 1.0 cho tất cả, **không thể tạo ra một cặp phạm luật**.

- **Phiên bản prompt được ghim** (`PROMPT_VERSION`), để một lượt chạy đã lưu còn
  đánh giá được bằng đúng thứ đã sinh ra nó.
- **Đề xuất được lưu, cặp thì không** — tên commit nói thẳng: *"store
  assisted-matching proposals, never the matches themselves"*. Ban tổ chức duyệt,
  và cặp chỉ sinh ra qua đường ghép có kiểm sức chứa.
- Màn hình: `/matches/recommendations` và `/matches/unmatched`.

### 4.19 ◐ Các lớp khác đã dựng trên nhánh

| Lớp | Nội dung | Nơi kiểm chứng |
|---|---|---|
| **Xác nhận mentor đầu mùa** | Mentor xác nhận tham gia mùa mới qua link riêng, không cần đăng nhập | `064_mentor_season_confirmations.sql` · `/confirm/[token]` · `/mentors/season-confirmations` |
| **Chọn lọc hàng loạt có thể giải thích** | Xếp hạng, cắt đúng số suất mentee đang có, đánh dấu nhóm dự bị | `066_selection_runs.sql` · `lib/selection-core.ts` |
| **Đặt lịch phỏng vấn (bản S12)** | Lưới lịch cho ban tổ chức | `067_interview_scheduling.sql` · `/interviews/schedule` |
| **Bộ thư sau ghép cặp** | 4 thư: báo mentee trúng tuyển, giới thiệu mentee–mentor, gói hồ sơ cho mentor, mời kickoff | `069_post_match_communications.sql` |
| **Nhập recap từ Facebook** | Đọc bài recap, chuẩn hoá permalink, lấy **ngày buổi gặp** trong tiêu đề chứ không lấy ngày đăng | `070_recap_import.sql` · `lib/recap-import-core.ts` · tiện ích Chrome `tools/recap-collector/` |
| **Kho tài liệu chương trình** | Bộ quy tắc ứng xử và cẩm nang, ban tổ chức tự soạn, mentee đọc không cần đăng nhập | `lib/program-documents-core.ts` · `/documents/[slug]` |
| **Hồ sơ mentee gửi mentor** | Link riêng để mentor đọc hồ sơ mentee được ghép | `/mentee-dossier/[token]` |

**Hai chi tiết cho thấy chất lượng của lớp này, đáng trích dẫn:**

*Chọn lọc hàng loạt* — "Không ai bị tách khỏi một điểm số bằng mình. Chỗ nào
đường cắt rơi vào giữa một nhóm đơn cùng điểm, cả nhóm lùi xuống dự bị chứ không
phải một nửa được mời còn một nửa thì không." Mọi trường hợp bằng điểm đều phá
bằng một luật **đã tuyên bố**, không phải bằng thứ tự dòng trong database — nên
kết quả giải thích được cho một ứng viên hỏi vì sao.

*Kho tài liệu* — đây là **chỗ duy nhất trong hệ thống** mà chữ ban tổ chức gõ vào
một form quản trị được hiển thị trên một trang không có đăng nhập chắn phía
trước. Bộ dựng HTML vì thế **escape mọi thứ trước**, rồi mới đặt lại thẻ của
chính nó: không có đường nào để markup ai đó gõ vào trở thành markup chạy được.

*Nhập recap từ Facebook* — Facebook trả cùng một bài dưới ba tên miền
(`m.` · `web.` · `www.`) kèm tham số theo dõi khác nhau mỗi lần. Không chuẩn hoá
về một chuỗi thì unique index trong migration 070 **không bảo vệ gì cả**.

---

## 5. Những thứ xuyên suốt mọi module

### 5.1 Múi giờ — một cửa duy nhất

Máy phát triển đặt giờ Việt Nam; Vercel chạy **UTC**. Một hàm định dạng quên ấn
định múi giờ vì thế **đúng trên máy và sai trên production**, và mọi ca test cũng
xanh trên máy.

- Mọi hiển thị đi qua 4 hàm dùng chung; không ai tự ghép `toLocaleString()`.
- Vitest đặt `TZ=UTC` **trước** khi nạp bất cứ thứ gì, để test chạy đúng múi giờ
  production.
- Ghi một NGÀY vào cột DATE đi qua `vietnamDateKey`, không qua
  `toISOString().slice(0,10)` — đó là ngày UTC.
- Định dạng ngày xuyên suốt sản phẩm là **DD/MM/YYYY**.

### 5.2 Fail-closed ở mọi cổng

Không đọc được bảng phân quyền thì trả `false`. Một lỗi hạ tầng không được biến
thành quyền. Và một phạm vi **không đọc được** phải hiện ra là lỗi, không được
hiện ra là "không có hoạt động nào" — vì phạm vi rỗng lọc mọi bảng về 0 dòng,
trông y hệt một mùa chưa bắt đầu.

### 5.3 Đường ghi hẹp

Sửa một trường thì viết hàm chỉ chạm trường đó. Gọi một hàm cập nhật cả biểu mẫu
nghĩa là ô nào không có mặt trên màn hình sẽ ghi đè lên giá trị đang đúng.

### 5.4 Cái đến từ biểu mẫu là thứ người gửi tự đặt được

Ô chọn đã lọc trên màn hình **không phải một phép kiểm**. Hàm ghi phải tự kiểm
lại, và mọi câu ghi lọc theo cả `id` lẫn `season_id`.

### 5.5 Nav không được hứa thứ route sẽ từ chối

Mỗi mục menu gate bằng **đúng predicate mà trang đó tự kiểm**. Đã có lần một
reviewer được mời sáu link đều đá họ về trang chủ; giờ có bài test đối chiếu
menu với quyền cho từng vai trò.

---

## 6. Kỷ luật kỹ thuật — phần đáng kể nhất cho một show case ERP

### 6.1 Bốn cổng, và cái mỗi cổng bắt được

| Cổng | Bắt được thứ mà cổng khác không bắt |
|---|---|
| `typecheck` | Sai kiểu, gọi hàm không tồn tại |
| `lint` | Hook gọi sai chỗ, biến thừa |
| `vitest` | **Hành vi** — cổng duy nhất bắt được `useActionState` trên React 18 |
| `build` | Ranh giới server/client component — sai ở đó biên dịch sạch, hỏng lúc chạy |

Chạy đủ cả bốn trước mỗi PR. 7.649 ca test.

### 6.2 Một ca test chưa dựng lại được lỗi thì chưa biết nó có bắt được lỗi hay không

Viết xong test, **cố ý làm hỏng mã theo đúng cách lỗi đó xảy ra** và xác nhận
test đỏ. Nếu nó vẫn xanh, thứ cần sửa là test.

Nếp này đã tìm ra lỗi thật nhiều lần, và lần nào cũng là lỗi **qua được cả bốn
cổng**:

- `venueKey` mất một dấu gạch chéo ngược trong regex — vẫn là regex hợp lệ, chỉ
  làm sai việc.
- Bản giả Supabase nuốt lệnh `.order()`, nên nó xanh y hệt cho bản đọc sai thứ tự.
- Câu kiểm "form mang đúng id" khớp nhầm form xoá ở cùng dòng.
- Một ca test khẳng định trên một chuỗi mà chuỗi đó cũng xuất hiện trong **chú
  thích giải thích chính nó** — lỗi này lặp lại ba lần trong một phiên làm việc.

### 6.3 Migration dán tay vào production TRƯỚC khi merge

Merge vào `main` là GitHub Actions tự test, build và deploy. **Nó không chạy
migration.** Có migration thì dán vào Supabase SQL Editor **trước**, rồi mới
merge — merge trước thì mã mới gọi vào bảng chưa tồn tại.

- **Dry run trong transaction cuộn lại**: dán cả migration với `commit;` đổi
  thành `rollback;` để xem nó có chạy được không mà không đổi gì. Kỹ thuật này
  đã bắt được một lỗ hổng thật: ba bảng mới thiếu `revoke all ... from
  service_role` trước khi `grant`, nên lệnh grant không thu hẹp gì cả và quyền
  DELETE vẫn còn.
- **Mỗi migration kết thúc bằng một khối tự kiểm** `do $$` raise nếu thiếu thứ
  gì. Migration báo thành công trong khi cột chưa được thêm là thứ chỉ lộ ra vào
  lúc cần nó nhất.
- **Nới ràng buộc CHECK theo lối cộng thêm**, đọc lại định nghĩa hiện có bằng
  `pg_get_constraintdef` rồi nối. Viết đè cả danh sách nghĩa là chép thiếu một
  giá trị thì những dòng loại đó lặng lẽ ngừng ghi được.
- **Đối chiếu md5 của `pg_proc.prosrc`** giữa repo và production sau khi dán.

### 6.4 Hợp đồng RPC được kiểm bằng test tĩnh

Một bản phát hành từng chuyển mã gọi 13 hàm mà **staging có còn production thì
không**. Không có gì trong CI đối chiếu "RPC mã nguồn gọi" với "RPC production
thật sự có", nên khoảng trống chỉ lộ ra thành lỗi chạy thật cho một người đang
đăng nhập.

Giờ: **mọi RPC ứng dụng gọi phải được khai báo trong đúng một nhóm** của
`lib/production-rpc-contract.ts`, kèm bằng chứng đã xác minh. Thêm một
`.rpc("...")` mà không khai báo là **hỏng build** — đúng loại lỗi đã phá
production. File này **cố ý không cần credential**: một khai báo tĩnh, kiểm bằng
test tĩnh, CI thường không cần khoá production và không gọi mạng.

### 6.5 Tài liệu vận hành xuất thành PDF một trang

7 hướng dẫn cho người vận hành trong `docs/huong-dan/`: cấp quyền reviewer · công
cụ AI · Canva AI · module Mail · module Sự kiện · lịch phỏng vấn · tự đặt lại mật
khẩu. Mỗi file có một **bài test hợp đồng** ghim các câu trích dẫn về đúng mã
nguồn và đếm `/Type /Page` để giữ đúng một trang — hướng dẫn nói sai so với phần
mềm là hướng dẫn tệ hơn không có.

---

## 7. Sáu góc kể chuyện cho bản show case

Đây là những chỗ mà một hệ ERP giáo dục khác biệt rõ nhất so với ERP doanh
nghiệp. Mỗi góc có một câu chuyện thật đứng sau.

### 7.1 Người dùng là tình nguyện viên, không phải nhân viên

Một nhân viên gặp phần mềm khó dùng thì vẫn phải dùng. Một mentor gặp phần mềm
khó dùng thì thôi không tham gia mùa sau. Đó là lý do có `/dat-lich/<token>`,
`/renew/<token>`, ô câu xác nhận báo ngay tại chỗ, và `onReset` giữ giá trị form.

### 7.2 Sai sót không đối xứng

Gần như mọi quyết định thiết kế trong hệ thống này đến từ việc hỏi *"hai cách sai
này, cái nào đắt hơn?"*:

- Bài blog: nhầm thành nội bộ = ít người đọc. Nhầm thành công khai = **không thu
  hồi được**. → Mặc định nội bộ.
- Số ghế để trống: hiểu là "không giới hạn" = ca vỡ trận. Hiểu là "đóng" = ai đó
  phải điền số. → Để trống là đóng.
- Thư gửi nhầm = **đã nằm trong hộp thư người ta**. → Cổng gửi hẹp nhất hệ thống.
- Phạm vi không đọc được hiện thành 0 = báo cáo sai trình lên ban điều hành, nghe
  hoàn toàn hợp lý. → Không đọc được phải hiện là lỗi.

### 7.3 Dữ liệu thật của người thật, mỗi lần deploy

1.360 người trong hệ thống là 1.360 người có tên, có email, có số điện thoại.
Một file CSV xuất nhầm không phải một bản ghi sai — đó là dữ liệu cá nhân của
hàng trăm sinh viên đã rời khỏi hệ thống. Nên **cổng tải file hẹp hơn cổng đọc
trang**, và đó là cố ý.

### 7.4 Lịch của một mùa không giống lịch tài chính

ERP doanh nghiệp xoay quanh quý và năm tài chính. ERP mentoring xoay quanh **mùa**
— và mùa chồng lên nhau: mentor mùa 11 gia hạn sang mùa 12 trong lúc mùa 11 chưa
kết thúc. Vì thế `person_season_memberships` là bảng trung tâm, không phải một
bảng "nhân viên" phẳng, và mọi phạm vi quyền đều là **chương trình × mùa**.

### 7.5 Quyền không phải một cây, mà là một lưới

Trong doanh nghiệp, quyền thường xếp thành cây: cấp trên thấy mọi thứ cấp dưới
thấy. Ở đây không như vậy. `support_team` quyết định được **kết quả mentee** tới
tận phê duyệt chính thức, nhưng **không** đụng được vào mentor. `reviewer` chấm
được hồ sơ nhưng không mở được trang vận hành. Một mentor được mời làm interviewer
có `admin_users` nhưng **không có tài khoản Auth**.

Đó là lý do `lib/permissions.ts` có hơn 40 predicate có tên riêng thay vì ba mức
"admin / user / guest" — và vì sao mỗi predicate mang một chú thích ghi **ngày
chủ dự án quyết định** và **lý do**.

### 7.6 Hệ thống tự kể được lý do của chính nó

Chú thích trong mã của dự án này viết bằng tiếng Việt và nói **vì sao**, không mô
tả lại dòng bên dưới. Chúng ghi cái giá của lựa chọn khác, và ngày quyết định.
Một người mới đọc `lib/blog-core.ts` sẽ biết ngay vì sao mặc định là nội bộ, mà
không cần hỏi ai.

Với một tổ chức mà đội ngũ thay mỗi mùa, đó không phải là trang trí — đó là cách
duy nhất để một quyết định sống lâu hơn người ra quyết định.

---

## 8. Dòng thời gian phát triển

| Mốc | Việc |
|---|---|
| 28/04/2026 | Commit đầu tiên — MVP chỉ đọc, chưa có đăng nhập, chưa có RLS |
| 05–06/2026 | Auth, RLS, phạm vi theo chương trình, nhập dữ liệu lịch sử S11 |
| 07–08/2026 | Sự kiện, recap, CRM vòng đời, ghép cặp |
| 09/2026 | Tuyển sinh S12: form công khai, chấm hồ sơ, phỏng vấn, Mail, công cụ AI |
| 16/09/2026 | Rà soát bảo mật — đóng 27 bảng đọc/ghi được từ bên ngoài |
| 22–24/09/2026 | Đặt lịch phỏng vấn mentor, đặt ca phỏng vấn mentee, tự đặt lại mật khẩu |

**753 commit trong 5 tháng**, deploy tự động mỗi lần merge vào `main`.

---

## 9. Ranh giới — giữ phần này trong bản nội bộ

Một tài liệu show case trung thực cần biết ranh giới của nó.

Kiến trúc của hệ thống đã phủ hết vòng đời một mùa mentoring — mục 4 liệt kê đủ,
gồm cả những lớp đã dựng xong trên nhánh. Phần dưới đây là **ranh giới thật**.

**Ngoài phạm vi có chủ ý — hệ thống này không làm, và không định làm:**
- Kế toán, thu chi, quản lý tài trợ.
- Quản lý kho, tài sản.
- Bảng lương, chấm công.

Đây là ERP cho **vòng đời con người trong một chương trình đào tạo**, không phải
ERP tài chính. Một tổ chức cần cả hai thì ghép VAM OS với một phần mềm kế toán,
không phải mở rộng VAM OS.

**Nợ kỹ thuật đã biết — nêu để người đọc kỹ thuật thấy hệ thống tự biết mình:**

| Điểm | Ảnh hưởng |
|---|---|
| Luật "một mentee một mentor" hiện cưỡng chế ở tầng ứng dụng (đọc-rồi-ghi), chưa ở database — 637 cặp cũ thiếu `mentee_profile_id` nên index unique chưa có gì để bám | Đã có bản thiết kế bù dữ liệu + RPC khoá hàng; là việc **ưu tiên 1** trước khi mở console cho 100+ mentor cùng thao tác |
| Sức chứa buổi sự kiện chỉ kiểm ở tầng ứng dụng | Chưa an toàn với hàng trăm lượt đăng ký đồng thời |
| `lib/interview-claim.ts` luôn từ chối tự nhận phỏng vấn, trong khi nút vẫn hiện | Một nút không làm gì — trái với nguyên tắc ở mục 5.5 |
| Màn hình ghép cặp chưa đọc kết quả phỏng vấn | Điểm và nhận xét của người đã gặp ứng viên còn vô hình với người ghép cặp |
| Hạn mức Brevo 300 thư/ngày | Một đợt ~500 thư phải chia theo ngày; bộ gửi đã tự dừng khi 429 và gửi tiếp lượt sau |

**Việc vận hành đang chờ, không phải việc kỹ thuật:**
- Dán migration `20260924210000` và merge chồng PR #160 → #161 → #162.
- Thư mời kèm link cho ứng viên mentee — trang đặt ca chạy được nhưng chưa ai có
  đường vào.

> **Ghi chú cho người tổng hợp.** Bảng nợ kỹ thuật ở trên **nên giữ lại** trong
> bản gửi đối tác kỹ thuật, và bỏ đi trong bản giới thiệu chung. Một tổ chức
> giáo dục đang chọn nhà cung cấp sẽ đọc bảng này như bằng chứng rằng hệ thống
> có người theo dõi nó — không phải như một danh sách lỗi.

---

## 10. Thẻ tóm tắt — dùng khi cần một đoạn ngắn

> **VAM OS** là hệ ERP nội bộ của Vietnam Alumni Mentoring, chạy thật tại
> `os.alumni-mentoring.edu.vn`, phục vụ 9 chương trình mentoring và hơn 1.360
> người. Hệ thống bao trọn vòng đời một mùa mentoring: form ứng tuyển công khai,
> chấm hồ sơ nhiều người theo thang 25 điểm, đặt lịch phỏng vấn bằng link cá
> nhân, quyết định và phê duyệt hàng loạt, ghép cặp có kiểm sức chứa, tổ chức sự
> kiện với vé QR và tới 20 trạm quét, nhật ký 2.447 buổi mentoring, thư hàng loạt
> có ba cổng duyệt tách rời, sáu công cụ AI không lưu dữ liệu, và báo cáo tháng.
> Thêm một lớp cross-mentoring và một lớp ghép cặp có AI hỗ trợ — trong đó **AI
> chỉ chấm điểm, mã nguồn mới phân công**, và không một thông tin định danh nào
> rời khỏi hệ thống.
>
> 98.000 dòng mã ứng dụng, 92.500 dòng mã kiểm thử, 7.649 ca test, 82 bảng đều
> bật RLS, 127 hàm database — cộng 54.000 dòng nữa đã dựng và kiểm thử trên
> nhánh. Xây trong 5 tháng, 753 commit, deploy tự động mỗi lần merge.
>
> Điều khiến nó khác một ERP doanh nghiệp: **người dùng là tình nguyện viên**.
> Không ai bị sa thải nếu bỏ dở, nên mọi thao tác phải làm được trên điện thoại,
> không cần đăng nhập ở chỗ không cần, và sai một ô không bao giờ phải điền lại
> từ đầu.

---

*Chốt tại commit `536446a`, 24/09/2026. Mọi con số đọc từ database production
(`qkkroesfiazsejkzflcd`) hoặc đếm từ mã nguồn.*
