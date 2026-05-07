# VAM OS — 90-Day Implementation Roadmap

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 07/05/2026 |
| **Giai đoạn** | Day 1–30: May 7–Jun 6 · Day 31–60: Jun 7–Jul 6 · Day 61–90: Jul 7–Aug 5 |
| **Mục tiêu cuối 90 ngày** | RLS hoàn chỉnh · Native recap live · Event registration · HAM audit done · Season 12 pilot-ready |

---

## Tổng quan

```
May 2026          June 2026          July 2026          August 2026
│                 │                  │                  │
├── Day 1-30 ─────┼── Day 31-60 ─────┼── Day 61-90 ─────┤
│  STABILIZE      │  BUILD CORE      │  PORTAL PREP     │
│  + SECURITY     │  WORKFLOWS       │  + MULTI-PROG    │
│                 │                  │                  │
│ • Team testing  │ • Native recap   │ • Mentor portal  │
│ • RLS audit     │   (admin-side)   │   (if RLS done)  │
│ • HAM audit     │ • Event reg.     │ • HAM structure  │
│ • Bug fixes     │ • Email notif.   │ • S12 launch     │
```

**Cách đọc roadmap này:**
- 🔴 = Blocking — không làm tiếp được nếu chưa xong
- 🟡 = High priority — ảnh hưởng lớn đến vận hành
- 🟢 = Important — cần làm trong giai đoạn nhưng không blocking
- ⬜ = Nice to have — chỉ làm nếu còn capacity

---

## Day 1–30: Stabilization & Security (May 7 – Jun 6)

**Mục tiêu giai đoạn:** Team testing hoàn chỉnh, RLS audit xong, HAM data audit xong, codebase ổn định không còn critical bugs.

### Week 1 (May 7–14) — Team Testing & Bug Triage

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 1.1 | Phát tài khoản test cho toàn bộ team pilot | 🔴 | Admin | Tất cả thành viên có thể đăng nhập |
| 1.2 | Chạy qua toàn bộ 5 flow trong test guide | 🔴 | Core Team | 5 flow pass không có critical bug |
| 1.3 | Thu thập bug reports theo mẫu | 🟡 | Tất cả testers | Bug list có ticket đầy đủ info |
| 1.4 | Phân loại bug: critical / high / low | 🔴 | Dev Lead | Có priority list |
| 1.5 | Fix critical bugs (blocking workflow) | 🔴 | Dev | Không còn bug blocking |
| 1.6 | Verify interview self-claim race condition | 🟡 | Dev + Tester | Xác nhận behavior khi 2 người cùng claim |

### Week 2 (May 15–21) — RLS Audit & Documentation

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 2.1 | List tất cả Supabase tables, kiểm tra RLS enabled/disabled | 🔴 | Dev | Spreadsheet đầy đủ |
| 2.2 | Viết required policy matrix: table × role × action | 🔴 | Dev + Admin | Matrix document hoàn chỉnh |
| 2.3 | Xác định staging environment (tách biệt với production) | 🔴 | Dev | Staging URL tồn tại, DB riêng |
| 2.4 | Implement RLS policies trên staging (admin, reviewer, viewer) | 🟡 | Dev | Staging policies live |
| 2.5 | Test reviewer isolation: chỉ thấy review được giao | 🔴 | QA | Test pass |
| 2.6 | Document: captured_by tags cho Season 12 (chuẩn hóa) | 🟢 | Dev | Decision doc written |

### Week 3 (May 22–28) — HAM Data Audit

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 3.1 | Mở HAM Season 6 Excel, đếm và catalog sheets | 🟡 | Core Team | Summary sheet count + structure |
| 3.2 | Phân loại mentors: map với person.email nếu đã có | 🟡 | Core Team | Danh sách mentor với email |
| 3.3 | Phân loại mentees: map với person.email nếu đã có | 🟡 | Core Team | Danh sách mentee với email |
| 3.4 | Phân loại recaps: 1on1 / cross / group / other | 🔴 | Core Team | Mỗi recap có label loại |
| 3.5 | Flag records cần data cleaning (thiếu email, trùng, không rõ) | 🟡 | Core Team | Flag list |
| 3.6 | Viết HAM Import Plan document | 🟢 | Dev + Core Team | Document có plan + timeline |

### Week 4 (May 29–Jun 6) — Season 12 Design

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 4.1 | Xác nhận Season 12 timeline (intake start date) | 🔴 | Core Team | Date confirmed |
| 4.2 | Design native recap submission UI (wireframe/flow) | 🟡 | Dev + UX | Flow diagram hoặc wireframe |
| 4.3 | Quyết định email notification vendor (Resend / SendGrid / khác) | 🟡 | Dev | Decision recorded |
| 4.4 | Design event pre-registration flow | 🟢 | Dev | Flow documented |
| 4.5 | Fix remaining high-priority bugs từ week 1 | 🟡 | Dev | Bug count giảm |
| 4.6 | QA pass toàn bộ tính năng sau bug fixes | 🟡 | Core Team | QA sign-off |

**Gate check Day 30:**
- [ ] Không còn critical bug trong core workflow
- [ ] RLS audit spreadsheet hoàn chỉnh
- [ ] HAM Season 6 data classified (mỗi recap có label)
- [ ] Season 12 intake start date confirmed
- [ ] Staging environment tồn tại và tách biệt với production

---

## Day 31–60: Core Native Workflows (Jun 7 – Jul 6)

**Mục tiêu giai đoạn:** Native recap submission hoạt động (admin-side), event pre-registration live, email infrastructure có, RLS phase 1 hoàn chỉnh, HAM structure trong DB.

### Week 5–6 (Jun 7–20) — Native Recap (Admin-side)

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 5.1 | Build form tạo recap cho admin/support: date + type + content + optional URL | 🔴 | Dev | Form live trong admin portal |
| 5.2 | Recap không cần URL — validate meeting_date, match_id, content | 🔴 | Dev | Validation rules clear |
| 5.3 | captured_by logic: `admin_manual_entry` cho admin-created recaps | 🟡 | Dev | Tag đúng trong DB |
| 5.4 | Test dashboard update sau khi admin tạo recap | 🔴 | QA | KPI counts cập nhật đúng |
| 5.5 | Migrate Season 11 DB để thêm program_id FK (staging trước) | 🟡 | Dev | program_id column exists |
| 5.6 | Insert `uehm_mentoring` program record, gắn Season 11 data | 🟡 | Dev | Season 11 gắn với program |

### Week 5–6 (Jun 7–20) — RLS Phase 1 Complete

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 5.7 | Apply tất cả RLS policies lên staging (từ matrix Week 2) | 🔴 | Dev | Policies active trên staging |
| 5.8 | Integration test: login với từng role, verify data isolation | 🔴 | QA + Dev | Test matrix pass |
| 5.9 | Fix RLS edge cases (recursive policy, cross-table joins) | 🔴 | Dev | Không còn unauthorized access |
| 5.10 | Document final RLS state | 🟡 | Dev | RLS doc updated |

### Week 7–8 (Jun 21 – Jul 6) — Event Pre-registration & Email

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 6.1 | Thêm registration table/relation cho events | 🟡 | Dev | Schema migration on staging |
| 6.2 | Build event registration form (admin add participants trước sự kiện) | 🟡 | Dev | Admin có thể thêm registrants |
| 6.3 | Distinguish: registered vs walk-in vs admin-added | 🟢 | Dev | Attendance source tracking |
| 6.4 | Email infrastructure setup: SMTP/Resend config | 🟡 | Dev | Gửi được email test |
| 6.5 | Email template: review assigned notification | 🟢 | Dev | Template live |
| 6.6 | Email template: admin decision notification | 🟢 | Dev | Template live |
| 6.7 | HAM program record trong DB (staging) | 🟡 | Dev | `ham_mentoring` program exists |
| 6.8 | Test: import 5-10 HAM records lên staging | 🟡 | Dev + Core Team | Import thành công, data đúng |

**Gate check Day 60:**
- [ ] Admin có thể tạo recap không cần URL trong portal
- [ ] RLS Phase 1 pass toàn bộ integration tests trên staging
- [ ] Event registration (pre-event) hoạt động trên staging
- [ ] Ít nhất 1 email notification type live
- [ ] HAM program structure có trong DB staging
- [ ] HAM sample import test (10 records) thành công

---

## Day 61–90: Portal Prep & Multi-Program (Jul 7 – Aug 5)

**Mục tiêu giai đoạn:** RLS Phase 2 live (nếu Phase 1 xong và pass), mentor portal alpha có thể demo, HAM structure production-ready, Season 12 intake sẵn sàng launch.

### Week 9–10 (Jul 7–20) — RLS Phase 2 + Portal Alpha

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 7.1 | RLS policies cho mentor role | 🔴 | Dev | Mentor chỉ thấy own data |
| 7.2 | RLS policies cho mentee role | 🔴 | Dev | Mentee chỉ thấy own data |
| 7.3 | Test RLS mentor: không đọc được recap của mentor khác | 🔴 | QA | Test pass |
| 7.4 | Test RLS mentee: không thấy profile của mentee khác | 🔴 | QA | Test pass |
| 7.5 | Build mentor portal alpha: login + view own profile + view match | 🟡 | Dev | Mentor có thể login |
| 7.6 | Build recap submission trong portal | 🟡 | Dev | Mentor submit được recap |
| 7.7 | Penetration test cơ bản trên staging (manual hoặc tool) | 🔴 | Dev | Không phát hiện critical issue |

### Week 11–12 (Jul 21 – Aug 5) — Season 12 Launch Prep

| # | Việc cần làm | Priority | Owner | Done khi nào |
|---|-------------|---------|-------|-------------|
| 8.1 | Season 12 intake batch record trong DB | 🔴 | Admin | Batch record tồn tại |
| 8.2 | Test toàn bộ intake flow với Season 12 form | 🔴 | Core Team | End-to-end pass |
| 8.3 | HAM Season 6 full import test trên staging | 🟡 | Dev + Core Team | Row counts chính xác |
| 8.4 | HAM production import (nếu staging OK) | 🟡 | Dev | Pending staging sign-off |
| 8.5 | Event lifecycle: test Kickoff S12 trên staging | 🟢 | Dev | Registration + attendance work |
| 8.6 | Support ticket MVP: form → email → track | 🟢 | Dev | Form live |
| 8.7 | User guide update cho Season 12 | 🟢 | Core Team | Guide updated |
| 8.8 | Go/No-go review: portal, recap, events, security | 🔴 | All | Sign-off document |

**Gate check Day 90:**
- [ ] RLS Phase 2 pass (mentor + mentee isolation confirmed)
- [ ] Mentor portal: login, view profile, view match, submit recap
- [ ] Season 12 intake ready (batch record + form working)
- [ ] HAM staging import successful (hoặc plan documented nếu chưa xong)
- [ ] Go/No-go signed off by Core Team + Dev

---

## Dependencies & Blocking Relationships

```
RLS Audit (W2)
    ↓
RLS Phase 1 Implementation (W5-6)
    ↓
RLS Phase 2: Mentor/Mentee (W9-10)
    ↓ ← BLOCKING
Mentor/Mentee Portal Launch

HAM Audit (W3)
    ↓
HAM Import Plan (W3)
    ↓
HAM Staging Import (W11)
    ↓ ← Verify OK
HAM Production Import

Native Recap Design (W4)
    ↓
Native Recap Build — Admin-side (W5-6)
    ↓
Native Recap in Portal (W9-10)

Email Vendor Decision (W4)
    ↓
Email Infrastructure (W7-8)
    ↓
Email Templates (W7-8 onwards)
```

---

## Risk Flags

| Rủi ro | Xác suất | Ảnh hưởng | Mitigation |
|--------|---------|----------|-----------|
| RLS phức tạp hơn ước tính → delay portal | Cao | Cao | Không mở portal trước khi xong; timeline flex |
| HAM data không clean → audit mất nhiều hơn 1 tuần | Trung bình | Trung bình | Scope audit: chỉ classify, không clean toàn bộ |
| Dev bandwidth không đủ → bị overload | Cao | Cao | Prioritize RLS + native recap; defer email |
| Season 12 intake date sớm hơn dự kiến | Trung bình | Cao | Confirm date Week 1, không để ngày 11 giờ |
| Mentor portal có security issue khi launch | Thấp | Rất cao | Penetration test bắt buộc trước khi launch |
| Email không deliver được (spam filter) | Trung bình | Trung bình | Test với real emails, dùng domain VAM chính thức |

---

## Metrics theo dõi sau 90 ngày

| Metric | Baseline (May 2026) | Target (Aug 2026) |
|--------|--------------------|--------------------|
| RLS coverage (% tables với policy) | ~20% | 100% |
| Native recaps submitted (không qua backfill) | 0 | >50 (từ admin-side) |
| Critical bugs open | Chưa đo | 0 |
| Event pre-registration coverage | 0% | 100% cho S12 events |
| HAM records classified | 0% | 100% |
| Email notifications sent | 0 | >10 test sends |

---

*VAM OS 90-Day Roadmap — 07/05/2026 — Internal only*
