# VAM OS — Master Blueprint 2.0

| | |
|---|---|
| **Phiên bản** | 2.0 |
| **Ngày** | 07/05/2026 |
| **Tác giả** | VAM OS Project Team |
| **Trạng thái** | Strategy Document — Internal Only |
| **Inputs** | Admin portal v1 (Season 11), VAM System user guides, HAM S6 Excel, UEH S11 event files, Season 11 recap backfill lessons |

---

## Executive Summary

VAM OS bắt đầu như một admin portal để quản lý hồ sơ và xét duyệt Season 11. Sau một năm vận hành thực tế, Blueprint 2.0 mở rộng tầm nhìn thành **hệ thống vận hành mentoring toàn diện** — phục vụ nhiều chương trình (UEHM, HAM, và tương lai), với quy trình hoạt động chuẩn hóa từ intake đến recap, và nền tảng để triển khai portal cho mentor/mentee sau khi bảo mật được đảm bảo.

**5 định hướng chiến lược của Blueprint 2.0:**

1. **Bảo mật trước portal** — RLS phải hoàn thiện trên staging trước khi mở bất kỳ tính năng nào cho mentor/mentee.
2. **Recap native từ Season 12** — Không phụ thuộc vào Facebook URL; mentor tự submit recap trong hệ thống.
3. **Multi-program từ nền tảng** — UEHM và HAM chia sẻ kiến trúc, không chia sẻ dữ liệu thô.
4. **Event lifecycle đầy đủ** — Từ registration đến feedback report, không chỉ điểm danh sau sự kiện.
5. **Không build vội** — Một số tính năng trong VAM System (auto-matching, SMS, public API) không cần thiết ở giai đoạn này.

---

## Phần 1 — Tầm nhìn sản phẩm

### 1.1 VAM OS là gì?

VAM OS (Vietnam Alumni Mentoring Operating System) là **cổng vận hành nội bộ** cho toàn bộ vòng đời của chương trình mentoring VAM — từ tiếp nhận hồ sơ, xét duyệt, ghép cặp, vận hành mentoring, đến báo cáo cuối mùa.

Về dài hạn, VAM OS hướng đến:

- **Một nền tảng** để vận hành bất kỳ chương trình mentoring nào của VAM (UEHM, HAM, chương trình tương lai).
- **Một điểm nhập liệu duy nhất** — mentor và mentee submit recap trực tiếp, không qua Facebook hay Zalo.
- **Khả năng hiển thị thời gian thực** — ban vận hành thấy trạng thái chính xác của mỗi cặp, mỗi tháng, không cần điều tra spreadsheet.
- **Chất lượng dữ liệu từ nguồn** — dữ liệu được chuẩn hóa lúc nhập, không phải vá sau.

### 1.2 Ba tầng của VAM OS

```
┌────────────────────────────────────────────────────────────┐
│  TẦNG 3 — ENGAGEMENT (User-facing)                         │
│  Mentor/Mentee Portal · Native Recap · Notifications       │
│  Support Ticket · Event Registration · Mentor Directory    │
│  [Chưa build — phụ thuộc vào tầng 2 + RLS hoàn chỉnh]    │
├────────────────────────────────────────────────────────────┤
│  TẦNG 2 — DATA (Visibility & Intelligence)                 │
│  Recap Dashboard · Multi-program Analytics                 │
│  Event Report · Backfill Audit Trail                       │
│  [Một phần hoàn chỉnh — Season 11]                        │
├────────────────────────────────────────────────────────────┤
│  TẦNG 1 — FOUNDATION (Ops Infrastructure)                  │
│  Application Intake · Review · Decision                    │
│  Matching · Events Attendance MVP · Season DB              │
│  [Hoàn chỉnh — Season 11]                                 │
└────────────────────────────────────────────────────────────┘
```

**Trạng thái hiện tại:** Tầng 1 đầy đủ. Tầng 2 một phần. Tầng 3 chưa bắt đầu.

---

## Phần 2 — VAM OS Là Gì và Không Là Gì

### 2.1 VAM OS LÀ:

| Mô tả | Chi tiết |
|-------|---------|
| Admin operations portal | Giao diện cho Core Team VAM vận hành chương trình |
| Multi-program data registry | Quản lý UEHM, HAM và các chương trình tương lai trên cùng nền tảng |
| Workflow engine | Intake → Review → Match → Mentoring → Close |
| Audit trail | Lịch sử đầy đủ: ai làm gì, lúc nào, trên hồ sơ nào |
| Nền tảng mở rộng | Có thể thêm mentor/mentee portal sau khi RLS hoàn chỉnh |

### 2.2 VAM OS KHÔNG LÀ:

| KHÔNG LÀ | Lý do |
|----------|-------|
| Ứng dụng công khai | Chưa có RLS đầy đủ — không mở cho mentor/mentee login |
| Thay thế Zalo/Facebook | Đây là tool vận hành nội bộ, không phải mạng xã hội |
| Hệ thống matching tự động | Manual matching đủ cho quy mô hiện tại |
| CRM cho đối tác/nhà tài trợ | Ngoài phạm vi VAM OS v2 |
| Ready cho mentor/mentee portal | **RLS chưa xong — đây là rủi ro bảo mật nghiêm trọng** |

---

## Phần 3 — Đánh giá Trạng thái Hiện tại (May 2026)

### 3.1 Tính năng đã hoàn chỉnh ✅

| Module | Trạng thái | Ghi chú |
|--------|-----------|---------|
| Application intake | ✅ | Form đăng ký mentor/mentee có pilot token |
| Review workflow | ✅ | Assign, draft, submit, read-only sau khi nộp |
| Interview self-claim | ✅ | Interviewer tự nhận ứng viên |
| Admin decision | ✅ | Mời PV / Waitlist / Reject / Needs review |
| Approval to mentor/mentee profile | ✅ | Tạo person + profile khi duyệt |
| Events & attendance MVP | ✅ | Tạo sự kiện, thêm người, đánh dấu trạng thái |
| Manual matching | ✅ | Ghép cặp thủ công, hủy cặp, load tracking |
| Season 11 recap dashboard | ✅ | KPI monthly, silent pairs, active counts |
| Season 11 recap backfill | ✅ | 281 recaps imported (61 URL + 220 no-URL) |
| Reset password | ✅ | Supabase Auth flow |
| Roles | ✅ | super_admin, admin, reviewer, viewer |

### 3.2 Khoảng trống nghiêm trọng ❌

| Khoảng trống | Mức độ | Ảnh hưởng |
|-------------|--------|----------|
| RLS chưa hardened | 🔴 Nghiêm trọng | Không thể mở portal cho user |
| Không có native recap submission | 🔴 Nghiêm trọng | Season 12 sẽ lặp lại debt của S11 |
| Không có email notification | 🟡 Cao | Workflow chậm, phụ thuộc Zalo thủ công |
| Event pre-registration không có | 🟡 Cao | Chỉ post-event — không biết ai sẽ tới |
| Không có support ticket | 🟡 Trung bình | Bug report qua Zalo, không track được |
| Multi-program chưa thiết lập | 🟡 Trung bình | HAM data không có chỗ import |
| Interviewer chưa phải role DB | 🟡 Trung bình | Hiện dùng role tạm |

---

## Phần 4 — So sánh với VAM System và Bài học

### 4.1 Bảng so sánh tính năng

| Tính năng | VAM System | VAM OS v1 | VAM OS v2 Plan |
|-----------|-----------|-----------|----------------|
| Mentor/mentee profile update | ✅ | ✅ (admin-side) | ✅ + self-service (sau RLS) |
| View matched counterpart | ✅ | Partial | ✅ (portal phase 1) |
| Mentee recap submission | ✅ | ❌ | ✅ (native workflow) |
| Mentor recap feedback | ✅ | ❌ | ✅ (phase 2) |
| Mentor directory via BTC | ✅ | ❌ | Phase 2 |
| Event registration | ✅ | ❌ (chỉ attendance) | ✅ (trong 60 ngày) |
| Event feedback | ✅ | ❌ | Phase 2 |
| Contact BTC / support ticket | ✅ | ❌ | Phase 2 |
| Email notification | ✅ | ❌ | Phase 2 |
| RLS / data isolation per user | Không rõ | ❌ | Phase 1 (trước portal) |
| Multi-program | ❌ | ❌ | ✅ (UEHM + HAM) |
| URL-optional recap | ❌ | ✅ (backfill) | ✅ (native workflow) |

### 4.2 Bài học từ VAM System — Áp dụng vào VAM OS

**Áp dụng trực tiếp:**
- Recap submission là tính năng cốt lõi — mentor phải tự submit, không phụ thuộc Facebook.
- Email notification làm tăng engagement và giảm công việc thủ công cho BTC.
- Support ticket giúp track và phân loại phản hồi thay vì mất trong Zalo.
- Event registration + feedback tạo vòng lặp vận hành hoàn chỉnh.

**Cải thiện so với VAM System:**
- **URL không bắt buộc** — Lesson từ Season 11: nhiều recap hợp lệ không có URL. Hệ thống mới không yêu cầu URL để submit recap.
- **Routing hỗ trợ qua BTC, không qua dev team** — Support ticket phải đến đúng người.
- **Multi-program native** — VAM System chỉ dành cho một chương trình; VAM OS thiết kế để chạy nhiều.
- **Dữ liệu không phụ thuộc Facebook scraping** — Toàn bộ dữ liệu nhập trực tiếp vào system.

---

## Phần 5 — Kiến trúc Multi-Program

### 5.1 Mô hình dữ liệu multi-program

```
programs
├── uehm_mentoring     (Vietnam Alumni Mentoring — UEHM)
└── ham_mentoring      (Hội Alumni Mentoring)
    └── ... (future programs)

programs → seasons → (mentors, mentees, matches, events, recaps)
persons  → (program-agnostic: email là unique key)
         → mentor_profiles  (một person có thể là mentor ở UEHM + mentee ở HAM)
         → mentee_profiles
```

**Nguyên tắc thiết kế:**
- `person` là đơn vị người — không phụ thuộc chương trình.
- `mentor_profile` / `mentee_profile` gắn với `season` (và qua đó với `program`).
- `match` scoped theo season.
- `mentoring_recaps` scoped theo match (không duplicate khi một người tham gia nhiều chương trình).
- `events` scoped theo season.

### 5.2 Chương trình UEHM — Trạng thái hiện tại

- UEHM Season 11: Data đã backfill, dashboard đang hoạt động.
- UEHM Season 12: Cần intake mới, matching mới, recap native từ đầu.
- Không dùng Season 11 data làm mẫu cho Season 12 import (khác workflow).

### 5.3 Chương trình HAM — Kế hoạch tiếp cận

**HAM Season 6 Excel — Quy trình tiếp cận đúng:**

| Bước | Hành động | Ai làm | Khi nào |
|------|-----------|--------|---------|
| 1 | Audit Excel thủ công: phân loại mentor/mentee/match | Core Team | Tuần 3-4 (tháng 5) |
| 2 | Phân loại recaps: 1-on-1 / cross / group / other | Core Team | Tuần 3-4 (tháng 5) |
| 3 | Map vào data model VAM OS: person, profile, match | Dev Team | Tuần 5-6 (tháng 6) |
| 4 | Test import trên staging | Dev + QA | Tuần 7 (tháng 6) |
| 5 | Import production sau khi validate | Dev Team | Sau khi staging OK |

> ⚠ **Quan trọng:** Không import HAM data theo kiểu "dump tất cả vào DB." HAM có nhiều loại recap (cross-mentoring, peer coaching, group session) — mỗi loại phải được phân loại đúng trước khi import. Import sai sẽ tạo noise trong dashboard.

**Điều không làm với HAM:**
- Không import toàn bộ Excel như 1-on-1 mentoring recaps.
- Không tạo persons mới nếu email đã có trong DB (dedup trước).
- Không import vào production trước khi staging test xong.

---

## Phần 6 — Mô hình Event Operations

### 6.1 Vấn đề với MVP hiện tại

MVP hiện tại của events chỉ hỗ trợ: tạo sự kiện → thêm người sau sự kiện → đánh dấu trạng thái.

Điều này thiếu:
- Ai đăng ký trước (không biết capacity, không gửi reminder được)
- Xử lý vắng có lý do vs vắng không báo
- Feedback sau sự kiện
- Báo cáo tổng hợp

### 6.2 Event Lifecycle đầy đủ (Target)

```
[REGISTRATION]     [CONFIRMATION]    [CHECK-IN]       [POST-EVENT]     [REPORT]
     │                   │                │                 │              │
     ▼                   ▼                ▼                 ▼              ▼
Người đăng ký  →  Xác nhận + nhắc  →  Điểm danh    →  Phân loại   →  Admin report
(form/admin)      nhở T-7, T-1        ngày diễn ra      & feedback     + analytics
```

**Chi tiết từng giai đoạn:**

| Giai đoạn | Hành động | Actor | Tự động? |
|----------|-----------|-------|----------|
| Registration | Đăng ký tham dự (web form hoặc admin add) | Participant / Admin | Partially |
| Confirmation | Xác nhận đã đăng ký, gửi link/thông tin | System | Email auto |
| Reminder | Nhắc nhở T-7 và T-1 trước sự kiện | System | Email auto |
| Check-in | Đánh dấu đã tới / walk-in | Support Team | Manual |
| Post-event classification | Vắng có lý do / vắng không báo / về sớm | Admin | Manual |
| Feedback | Form đánh giá sau sự kiện | Participant | Self-serve |
| Report | Tổng hợp attendance rate + feedback summary | Admin | Semi-auto |

### 6.3 Mapping với UEH Season 11 Event Files

| File sự kiện | Loại | Tình trạng trong DB | Cần làm |
|-------------|------|---------------------|---------|
| Kickoff | `networking` | Chưa có đủ data | Import registration list nếu còn |
| Mentee Orientation | `orientation` | Chưa có đủ data | Import từ file |
| Training 01 | `training` | Chưa có đủ data | Import từ file |
| Training 02 | `training` | Chưa có đủ data | Import từ file |

> **Note:** Season 11 event data là lịch sử — import để tham chiếu, không cần lifecycle đầy đủ. Season 12 mới cần lifecycle đầy đủ từ đầu.

### 6.4 Event Types hợp lệ (DB constraint)

```
orientation | training | company_tour | networking | closing
business_case | job_shadowing | other
```

> Không dùng: `kickoff`, `tong_ket`, `community`, `workshop` — map sang giá trị tương đương.

---

## Phần 7 — Native Recap Workflow Model

### 7.1 Bài học từ Season 11 Backfill

**Số liệu thực tế:**
- 281 recaps backfilled từ tracking spreadsheet (61 có URL + 220 không có URL)
- DB sau backfill: ~1,405 / 1,735 recaps theo báo cáo tracking gốc
- Gap còn lại ~330 (cấu trúc, không thể tự động khôi phục)
- Root cause của gap: recap qua Zalo, báo cáo miệng, thiếu mã mentee, không map được match

**Vấn đề với workflow hiện tại (Facebook-based):**

| Vấn đề | Hậu quả |
|--------|---------|
| Phụ thuộc Facebook post tồn tại | Xóa post = mất recap vĩnh viễn |
| URL là mandatory → tạo placeholder URL | Technical debt, data không sạch |
| Backfill thủ công tốn nhiều công | Mỗi mùa đều phải làm lại |
| Recap qua Zalo không capture được | Luôn có gap không giải quyết được |
| Không biết recap có thật hay không | Phải spot-check thủ công |

### 7.2 Target: Native Recap Workflow cho Season 12+

**Phase A — Short-term (trước khi có portal):**

Mentor không có portal → Support Team submit thay hoặc admin nhập:

```
Mentor báo cáo qua Zalo / Google Form
        │
        ▼
Support Team / Admin vào VAM OS
        │
        ▼
Tạo recap: meeting_date, meeting_type, content, optionally URL
issue_flag = FALSE (nếu do admin nhập, đã verify)
captured_by = 'admin_manual_entry'
        │
        ▼
Dashboard cập nhật real-time
```

**Phase B — Full native (sau khi portal sẵn sàng):**

```
Mentor đăng nhập portal
        │
        ▼
"Recap tháng này" → Chọn tháng → "Thêm Recap"
        │
        ▼
Điền form: Ngày gặp · Hình thức · Nội dung [· URL tùy chọn]
        │
        ▼
Submit → recap: status=submitted, issue_flag=FALSE
         captured_by=mentor_self_report
        │
        ▼
Mentee nhận notification → Acknowledge (Phase 2)
        │
        ▼
Dashboard cập nhật real-time
```

### 7.3 Nguyên tắc Recap Data Quality

| Nguyên tắc | Áp dụng thực tế |
|-----------|----------------|
| URL là optional, không phải identity | recap_url = NULL là hợp lệ trong native workflow |
| Meeting month phải chính xác | Không cho phép batch backdating; admin phải approve |
| Không tạo recap fake để fill KPI | Nếu không có recap thực tế → để trống, ghi nhận gap |
| issue_flag=TRUE chỉ cho data quality issues | Không dùng để force-import dữ liệu không chắc chắn |
| captured_by là audit trail | Mỗi nguồn phải có captured_by riêng |

---

## Phần 8 — Mentor/Mentee Portal Roadmap

### 8.1 Tại sao chưa mở portal ngay?

> 🔴 **Rủi ro bảo mật nghiêm trọng:** Supabase RLS (Row Level Security) chưa được thiết kế và kiểm tra đầy đủ. Nếu mở portal cho mentor/mentee login mà không có RLS:
> - Một mentor có thể đọc dữ liệu của mentor khác
> - Một mentee có thể xem hồ sơ của mentee khác
> - Dữ liệu nhạy cảm (email, SĐT, nội dung recap) có thể bị lộ
>
> **Không mở portal trước khi RLS được kiểm tra đầy đủ trên staging.**

### 8.2 Prerequisites bắt buộc trước khi build portal

| Điều kiện | Trạng thái | Ước tính |
|-----------|-----------|---------|
| RLS audit: liệt kê tất cả tables | ❌ Chưa | 1 tuần |
| RLS policies viết cho từng role | ❌ Chưa | 2 tuần |
| RLS test trên staging | ❌ Chưa | 1 tuần |
| Auth flow cho mentor/mentee | ❌ Chưa | 1 tuần |
| Data visibility rules documented | ❌ Chưa | 3 ngày |
| Penetration test cơ bản | ❌ Chưa | 1 tuần |

### 8.3 Portal Phase 1 (sau khi RLS xong)

Mục tiêu tối thiểu viable:

| Tính năng | Ai dùng | Priority |
|-----------|---------|---------|
| Đăng nhập với email VAM | Mentor + Mentee | P0 |
| Xem profile của mình | Mentor + Mentee | P0 |
| Xem thông tin cặp ghép (đối phương) | Mentor + Mentee | P0 |
| Submit recap tháng | Mentor | P0 |
| Xem lịch sử recap của mình | Mentor + Mentee | P1 |
| Xem danh sách sự kiện | Mentor + Mentee | P1 |
| Liên hệ BTC / report issue | Mentor + Mentee | P2 |

### 8.4 Portal Phase 2 (sau Season 12 ổn định)

| Tính năng | Ghi chú |
|-----------|---------|
| Chỉnh sửa profile (limited fields) | Không cho sửa email, intake batch |
| Mentor directory với routing qua BTC | Không lộ SĐT trực tiếp |
| Event registration | Đăng ký tham dự sự kiện |
| Recap acknowledgement bởi mentee | Mentee confirm recap của mentor |
| Support ticket tracking | Xem trạng thái ticket đã gửi |
| Email notification preferences | Opt-in/out từng loại thông báo |

---

## Phần 9 — Support Ticket Model

### 9.1 Vấn đề hiện tại

Bug và yêu cầu hỗ trợ hiện đi qua Zalo, email cá nhân, hoặc trực tiếp cho dev. Không có:
- Categorization (kỹ thuật vs vận hành vs dữ liệu)
- Routing đúng người
- SLA tracking
- Lịch sử ticket để tránh xử lý trùng

### 9.2 Target Model

```
Ticket Categories:
├── technical_issue      → Dev Team
├── match_issue          → Core Team
├── event_question       → BTC / Support Team
├── data_correction      → Admin
└── other                → BTC
```

**Ticket Lifecycle:**

```
submitted → acknowledged → in_progress → resolved → closed
                                    ↑
                            (escalated nếu quá SLA)
```

**SLA target:** Acknowledge trong 1 ngày làm việc, resolve trong 3 ngày làm việc.

### 9.3 Implementation (đơn giản nhất có thể)

Không cần Zendesk hay Intercom ở scale này. Đủ với:

```sql
-- support_tickets (future table)
id, submitted_by_person_id, category, status,
subject, message, assigned_to_user_id,
created_at, acknowledged_at, resolved_at, closed_at
```

Phase 1: Nút "Liên hệ BTC" → form → email đến team (không cần DB)
Phase 2: Lưu vào DB → track trong admin portal
Phase 3: Self-serve tracking trong mentor/mentee portal

---

## Phần 10 — Nguyên tắc Quản trị Dữ liệu

### 10.1 Nguồn dữ liệu tin cậy

> **Từ Season 12 trở đi: VAM OS DB là nguồn dữ liệu duy nhất.**
> Google Sheet, Excel, Facebook chỉ là nguồn import — không phải ongoing record.

### 10.2 Các nguyên tắc không thể thỏa hiệp

| Nguyên tắc | Quy tắc cụ thể |
|-----------|----------------|
| **Không có dữ liệu giả** | Không tạo record test trong production. Staging là môi trường test. |
| **Không có URL giả** | Placeholder URL (`system.local/...`) là technical debt — hạn chế tối đa. |
| **Tháng gặp mặt phải chính xác** | `meeting_date` phản ánh ngày thực tế. Không cho phép backdating hàng loạt. |
| **Person deduplication** | Một email = một person record. Không tạo duplicate khi re-approve qua nhiều mùa. |
| **Audit trail bắt buộc** | Mọi thao tác admin (decision, bulk import, approve) phải có timestamp + actor. |
| **Issue flag có nghĩa** | `issue_flag=TRUE` = cần người review. Không dùng cho data chắc chắn hợp lệ. |
| **HAM/UEHM tách biệt** | Dashboard UEHM không tính HAM recaps và ngược lại nếu không có explicit filter. |
| **Captured_by là audit** | Mỗi bulk import phải có captured_by riêng. Không dùng chung tag cho các batch khác nhau. |

### 10.3 Data Lifecycle

```
Source → Audit → Staging Test → Production Import → Dashboard
  │         │           │               │               │
  │      (classify     (verify       (idempotent     (verify
  │       & clean)    row counts)    NOT EXISTS)     counts)
```

---

## Phần 11 — Security & RLS Roadmap

### 11.1 Trạng thái bảo mật hiện tại

| Lớp bảo mật | Trạng thái | Rủi ro |
|-------------|-----------|--------|
| Application-level auth (Supabase Auth) | ✅ Hoạt động | Thấp cho admin-only use |
| Next.js middleware route protection | ✅ Hoạt động | Thấp |
| Supabase RLS policies | ❌ Chưa hardened | **CAO — blocking cho portal** |
| Role-based data isolation trong DB | ❌ Chưa | CAO |
| Staging environment tách biệt | Chưa rõ | Trung bình |
| Input sanitization | Partial | Trung bình |

### 11.2 RLS Roadmap (3 phase)

**Phase 1 — Audit & Foundation (trước Season 12 pilot, ~4 tuần):**

```
Việc cần làm:
1. List tất cả tables trong Supabase DB
2. Kiểm tra RLS enabled/disabled từng table
3. Viết policy matrix: table × role × action (SELECT/INSERT/UPDATE/DELETE)
4. Implement policies trên staging
5. Test với từng role: admin, reviewer, viewer
6. Verify: reviewer chỉ thấy review được giao cho mình
7. Verify: viewer không INSERT/UPDATE được bất kỳ table nào
```

**Phase 2 — Portal-ready RLS (~3 tuần sau Phase 1):**

```
Thêm policies cho:
- mentor role: SELECT own profile, own match, own recaps
               INSERT own recaps
               UPDATE limited profile fields
- mentee role: SELECT own profile, own match, view mentor recap
- Kiểm tra: mentor A không đọc được dữ liệu mentor B
- Kiểm tra: mentee không thấy recap của cặp khác
- Penetration test cơ bản trên staging
```

**Phase 3 — Hardening (~sau portal launch):**

```
- Rate limiting trên Supabase Edge Functions
- Input validation audit (SQL injection, XSS)
- Audit log cho sensitive operations
- Optional: third-party security review
```

### 11.3 Quy tắc an toàn tuyệt đối

> 🔴 **Không bao giờ:**
> - Mở mentor/mentee login trên production trước khi Phase 2 hoàn chỉnh
> - Test RLS trực tiếp trên production DB
> - Dùng service_role key trong client-side code
> - Disable RLS trên bất kỳ table nào có dữ liệu người dùng

---

## Phần 12 — Không Build Gì Trong Giai đoạn Này

### 12.1 Tính năng KHÔNG build (và lý do)

| Tính năng | Lý do không build |
|-----------|-----------------|
| Algorithmic/auto matching | Manual matching đủ; auto-match cần nhiều data chất lượng cao hơn hiện có |
| Mobile app | Web responsive đủ cho scale hiện tại; mobile là tốn kém |
| Public API | Không có external consumer nào cần API hiện tại |
| SMS notification | Email + Zalo đủ; SMS tốn chi phí, phức tạp hóa stack |
| Integration với HR/ERP | Ngoài phạm vi; VAM không cần sync với hệ thống doanh nghiệp |
| Bulk delete operations | Quá rủi ro; cần soft delete với audit trail |
| Analytics BI dashboard | KPI hiện tại đủ; Metabase/Power BI là over-engineering |
| Mentor/mentee portal | **Cần RLS trước. Không mở trước khi Phase 2 xong.** |
| HAM data import | Cần audit Excel trước. Không import bulk chưa được classify. |
| Automated email scheduling | Cần email infrastructure trước; scheduling là phase sau |

### 12.2 "Không build" không có nghĩa là "không bao giờ"

Tất cả các tính năng trên đều có thể xem xét trong phiên bản tương lai, khi:
- Quy mô program tăng đủ để justify effort
- Infrastructure cơ bản (RLS, notifications, portal) đã ổn định
- Có đủ nhân lực để maintain thêm complexity

---

## Phần 13 — Các Quyết định Kiến trúc Quan trọng

| Quyết định | Lý do chọn | Trade-off chấp nhận được |
|-----------|-----------|--------------------------|
| Supabase làm DB + Auth | Đã chọn; không thay đổi | Vendor lock-in nhẹ |
| Next.js App Router | Đã chọn; không thay đổi | Learning curve cao hơn Pages Router |
| TypeScript strict | Đã chọn | Chậm hơn khi dev nhưng ít bug hơn |
| Server-side data fetching | Đã chọn | Phức tạp hơn client-side state |
| Manual matching (không auto) | Đủ cho scale hiện tại | Không scale nếu >500 matches/season |
| Recap URL optional | Lesson từ S11 backfill | Cần UX rõ ràng để tránh bỏ trống URL khi có |
| Multi-program qua program_id FK | Extensible mà không phá schema | Phải migrate Season 11 data sang program_id |
| issue_flag boolean | Đơn giản, đủ dùng | Không granular bằng status enum riêng |

---

*Blueprint 2.0 — VAM OS Project Team — 07/05/2026*
*Tài liệu nội bộ. Không phân phối ra ngoài team.*
