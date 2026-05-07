# VAM OS — Module Priority & Build Decision

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Mục đích** | Framework quyết định cái gì build trước, cái gì defer, cái gì không build |

---

## Framework ra quyết định

Mỗi module được đánh giá theo 4 tiêu chí:

| Tiêu chí | Câu hỏi |
|---------|---------|
| **Operational Impact** | Không có thì team vận hành bị block như thế nào? |
| **User Need** | Người dùng thực sự cần không hay chỉ nice-to-have? |
| **Technical Risk** | Xây dựng sai sẽ tạo bao nhiêu debt? |
| **Dependency** | Có block các tính năng khác không? |

**Tier phân loại:**

| Tier | Ý nghĩa | Timeline |
|------|---------|---------|
| **Tier 1 — Now** | Blocking hoặc critical. Làm ngay trong 30 ngày. | May–Jun 2026 |
| **Tier 2 — Next** | High value. Làm trong 60 ngày. | Jun–Jul 2026 |
| **Tier 3 — Later** | Important nhưng không urgent. Sau Season 12 ổn định. | Aug 2026+ |
| **Tier 4 — Not Yet** | Hợp lý về dài hạn nhưng không cần bây giờ. | TBD |
| **Tier 5 — No** | Không build. Ngoài phạm vi hoặc over-engineering cho scale hiện tại. | Never (v2) |

---

## Tier 1 — Build Now (May–June 2026)

### 1.1 RLS Audit & Phase 1 Implementation

**Quyết định:** ✅ Build immediately

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🔴 Blocking — portal không mở được nếu thiếu |
| User Need | 🔴 Security requirement, không phải feature |
| Technical Risk | 🔴 Cao nếu không làm — data breach nếu mở portal |
| Dependency | 🔴 Blocks: portal, mentor login, mentee login |

**Scope:**
- Audit toàn bộ tables: RLS enabled/disabled
- Viết policy matrix
- Implement trên staging: admin, reviewer, viewer isolation
- Test integration

**Không làm:**
- RLS Phase 2 (mentor/mentee) chưa cần ngay — chỉ sau Phase 1 xong

---

### 1.2 Native Recap Submission (Admin-side)

**Quyết định:** ✅ Build immediately

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🔴 Season 12 sẽ lặp lại debt của S11 nếu không có |
| User Need | 🔴 Admin cần nhập recap mà không có URL Facebook |
| Technical Risk | 🟡 Thấp — form đơn giản, reuse pattern hiện có |
| Dependency | Enables: dashboard real-time, mentor portal recap |

**Scope:**
- Form tạo recap trong admin portal: date + type + content + optional URL
- No URL requirement
- `captured_by = 'admin_manual_entry'`
- Dashboard update real-time

**Không làm:**
- Mentor self-service recap portal (chờ RLS Phase 2)
- Recap acknowledgement bởi mentee (Phase 2)

---

### 1.3 Bug Fixes từ Team Testing

**Quyết định:** ✅ Build immediately

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🔴 Bugs blocking workflow phải fix trước mọi thứ |
| User Need | 🔴 Team không thể test nếu flow bị block |
| Technical Risk | 🟡 Risk tăng nếu defer — bugs sẽ tích lũy |
| Dependency | Blocks: team adoption, season 12 launch |

**Scope:**
- Critical bugs (blocking): fix trong Week 1
- High priority: fix trong Week 2-3
- Low priority: defer sang backlog

---

### 1.4 HAM Data Audit (không phải import)

**Quyết định:** ✅ Do now (audit only — không import)

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🟡 HAM không thể import nếu không audit trước |
| User Need | 🟡 Core Team cần biết data quality của HAM trước khi commit |
| Technical Risk | 🔴 Import sai = noisy dashboard, hard to fix |
| Dependency | Enables: HAM staging import, multi-program structure |

**Scope:**
- Đếm và catalog sheets trong HAM S6 Excel
- Phân loại recaps: 1on1 / cross / group / other
- Map email với persons đã có trong DB
- Flag data quality issues

**Không làm:**
- Import HAM data (Tier 2 — sau khi audit xong)

---

## Tier 2 — Build Next (June–July 2026)

### 2.1 RLS Phase 2: Mentor/Mentee Isolation

**Quyết định:** ✅ Build in Day 31-60

**Phụ thuộc:** RLS Phase 1 phải xong trước

**Scope:**
- Policies cho `mentor` role: own profile, own match, own recaps
- Policies cho `mentee` role: own profile, own match, view recap
- Integration test isolation
- Penetration test cơ bản

---

### 2.2 Event Pre-Registration

**Quyết định:** ✅ Build in Day 31-60

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🟡 Không biết ai đăng ký trước → không gửi reminder được |
| User Need | 🟡 BTC cần quản lý capacity trước sự kiện |
| Technical Risk | 🟢 Thấp — table đơn giản, reuse event pattern |
| Dependency | Enables: email reminder, event report |

**Scope:**
- Thêm `event_registrations` table
- Admin add participants trước sự kiện
- Distinguish: registered / walk-in / admin-added
- Không cần self-registration portal ngay (Phase 2)

---

### 2.3 Email Notification Infrastructure

**Quyết định:** ✅ Build in Day 31-60

| Tiêu chí | Đánh giá |
|---------|---------|
| Operational Impact | 🟡 Hiện tại mọi notification đi qua Zalo thủ công |
| User Need | 🟡 Reviewer cần biết khi được giao review |
| Technical Risk | 🟡 Cần chọn vendor đúng, setup domain + DKIM |
| Dependency | Enables: event reminder, recap notification, support ticket |

**Scope (MVP):**
- Setup email vendor (Resend hoặc SendGrid)
- Template 1: "Bạn được giao review hồ sơ [name]"
- Template 2: "Quyết định về hồ sơ của bạn"
- Không cần email scheduling hay drip campaigns (Tier 3)

---

### 2.4 Multi-Program Structure: UEHM + HAM

**Quyết định:** ✅ Build in Day 31-60

**Phụ thuộc:** HAM audit (Tier 1) phải xong

**Scope:**
- Migrate Season 11 data: thêm `program_id` FK (staging trước)
- Insert `programs` records: uehm_mentoring, ham_mentoring
- Gắn Season 11 data với UEHM program
- HAM program structure trong DB (không import data ngay)

---

### 2.5 Mentor Portal Alpha

**Quyết định:** ✅ Build in Day 61-90 (phụ thuộc RLS Phase 2)

**Gate:** RLS Phase 2 phải pass trước khi deploy

**Scope Phase 1:**
- Mentor login (Supabase Auth)
- View own profile
- View matched mentee (read-only)
- Submit monthly recap (native)
- View recap history

**Không trong scope:**
- Edit profile (Phase 2)
- Mentor directory (Phase 2)
- Event registration (Phase 2)

---

## Tier 3 — Build Later (Aug 2026+)

### 3.1 Mentee Portal

**Lý do defer:** Mentor portal trước, mentee sau. Sau khi mentor portal ổn định và RLS tested.

**Scope khi làm:**
- Mentee login
- View own profile + matched mentor
- View recap của cặp
- Acknowledge recap (confirm buổi gặp thực sự xảy ra)

---

### 3.2 Mentor Directory với BTC Routing

**Lý do defer:** Nice-to-have, không blocking operations. Cần quyết định privacy model trước.

**Câu hỏi cần trả lời:**
- Mentor có quyền opt-out không?
- Mentee liên hệ trực tiếp hay qua BTC?
- Hiển thị SĐT hay chỉ email?

---

### 3.3 Event Feedback Form

**Lý do defer:** Cần event registration live trước. Feedback không có giá trị nếu attendance data không sạch.

---

### 3.4 HAM Season 6 Production Import

**Lý do defer:** Audit phải xong (Tier 1), staging test phải pass (Tier 2), rồi mới production import.

**Điều kiện mở khóa:**
- HAM audit hoàn chỉnh (100% recaps classified)
- Staging import test pass
- Row counts verified bởi Core Team

---

### 3.5 Support Ticket System (full)

**Lý do defer:** Phase 1 có thể là form → email. Full system (DB + tracking + portal) cần thêm effort.

**Scope Phase 1 (Tier 2):** Form → email đến team
**Scope Phase 2 (Tier 3):** DB-backed tickets, tracking trong admin portal

---

### 3.6 Email Scheduling & Reminders

**Lý do defer:** Cần email infrastructure (Tier 2) live trước. Scheduling thêm complexity.

**Scope khi làm:**
- Event reminder T-7, T-1
- Monthly recap reminder cho mentor
- Review deadline reminder

---

## Tier 4 — Not Yet (TBD — Có thể làm nếu scale tăng)

### 4.1 Automated/Algorithmic Matching

**Quyết định:** ⏸ Not yet

**Lý do:**
- Manual matching phù hợp với quy mô hiện tại (<200 cặp/season)
- Auto-match cần nhiều attribute data chất lượng cao (industry, goal, schedule)
- Risk của bad match cao hơn benefit của tự động hóa ở scale này

**Khi nào xem xét lại:** Nếu số cặp >500/season hoặc matching trở thành bottleneck rõ ràng.

---

### 4.2 Multi-Season Analytics & Longitudinal Reports

**Quyết định:** ⏸ Not yet

**Lý do:**
- Dữ liệu Season 12 trở đi mới sạch (native recap)
- Season 11 data có gaps cấu trúc — misleading nếu so sánh
- Cần ít nhất 2 seasons data sạch để có ý nghĩa

---

### 4.3 Mentee Recap Acknowledgement

**Quyết định:** ⏸ Not yet

**Lý do:** Cần mentor portal live trước (Tier 2). Acknowledgement là Phase 2 của portal.

---

## Tier 5 — No (Không build trong v2)

### 5.1 Mobile App (iOS/Android)

**Quyết định:** ❌ No

**Lý do:**
- Web responsive đủ cho 95% use cases
- Mobile app = 2-3x maintenance cost
- App store approval adds operational overhead
- Team không có mobile dev bandwidth

---

### 5.2 Public API

**Quyết định:** ❌ No

**Lý do:**
- Không có external consumer nào cần API
- API tăng attack surface
- Tất cả integration nội bộ có thể dùng Supabase SDK trực tiếp

---

### 5.3 SMS Notification

**Quyết định:** ❌ No

**Lý do:**
- Email + Zalo đủ
- SMS tốn chi phí (không nhỏ với volume VAM)
- GDPR/data privacy phức tạp hơn với SĐT
- Zalo notification miễn phí và phổ biến hơn SMS ở VN

---

### 5.4 Bulk Delete Operations

**Quyết định:** ❌ No (soft delete only)

**Lý do:**
- Xóa cứng là không thể hoàn tác
- Audit trail yêu cầu giữ lịch sử
- Soft delete (`status = 'deleted'`) đủ cho mọi use case

---

### 5.5 Integration với External Systems (HR, ERP, CRM)

**Quyết định:** ❌ No

**Lý do:**
- VAM không có HR/ERP system
- Không có external consumer
- Tích hợp tạo tight coupling, tăng maintenance burden

---

### 5.6 AI-powered Features (matching, review scoring)

**Quyết định:** ❌ No (hiện tại)

**Lý do:**
- Data volume chưa đủ để train model chất lượng
- Human judgment quan trọng hơn AI trong context mentoring chương trình nhỏ
- Cost của false positives (bad match, bad review score) cao

---

## Tóm tắt Decision Matrix

| Module | Tier | Timeline | Người quyết định |
|--------|------|---------|-----------------|
| RLS Audit + Phase 1 | 1 — Now | May 2026 | Dev Lead |
| Native Recap (admin-side) | 1 — Now | May-Jun 2026 | Dev + Core Team |
| Bug fixes từ team testing | 1 — Now | May 2026 | Dev |
| HAM Data Audit | 1 — Now | May 2026 | Core Team |
| RLS Phase 2 (mentor/mentee) | 2 — Next | Jun 2026 | Dev Lead |
| Event Pre-Registration | 2 — Next | Jun 2026 | Dev |
| Email Notification MVP | 2 — Next | Jun-Jul 2026 | Dev |
| Multi-program DB structure | 2 — Next | Jun 2026 | Dev |
| Mentor Portal Alpha | 2 — Next | Jul 2026 | Dev |
| Mentee Portal | 3 — Later | Aug 2026+ | Dev |
| Mentor Directory | 3 — Later | Aug 2026+ | Core Team |
| Event Feedback | 3 — Later | Aug 2026+ | Dev |
| HAM Production Import | 3 — Later | Aug 2026+ | Dev + Core Team |
| Support Ticket Full | 3 — Later | Aug 2026+ | Dev |
| Auto-matching | 4 — Not Yet | TBD | Core Team |
| Mobile App | 5 — No | Never (v2) | Project Lead |
| Public API | 5 — No | Never (v2) | Project Lead |
| SMS Notification | 5 — No | Never (v2) | Project Lead |
| Bulk Delete | 5 — No | Never (v2) | Project Lead |
| External Integrations | 5 — No | Never (v2) | Project Lead |

---

## Nguyên tắc ra quyết định cho tính năng mới

Khi có feature request mới, trả lời 5 câu hỏi:

1. **"Nếu không có tính năng này, team có bị block không?"** → Có = Tier 1-2 / Không = Tier 3+
2. **"Có thể xử lý thủ công ở Zalo/Sheet trong 3 tháng không?"** → Có = Defer / Không = Prioritize
3. **"RLS đã xong chưa nếu tính năng này liên quan đến user data?"** → Chưa = Block
4. **"Tính năng này tạo thêm DB schema/migration không?"** → Có = Test staging trước
5. **"Có manual workaround nào đủ dùng không?"** → Có = Document workaround, defer build

---

*VAM OS Module Priority Decision — 07/05/2026 — Internal only*
