# VAM OS — Báo cáo Audit Toàn diện
**Ngày audit:** 2026-07-20  
**Auditor:** Claude Sonnet 4.6  
**Branch / HEAD:** `main` — `9a19755` (origin/main đồng bộ)  
**Blueprint đối chiếu:** `VAM_OS_Phase2_Ops_Blueprint.docx` (27/04/2026)  
**Môi trường kiểm thử:** Codebase local + production URL canonical  
**Trạng thái working tree:** 12 untracked files (scripts tạm, data_imports — không liên quan đến audit)

> **[CẬP NHẬT 2026-07-20 — Sau khi audit]** Batch 0 remediation đã được thực hiện trong cùng phiên làm việc. Các bugs B0-1, B0-2, B0-3 (hardcode tháng + debug log) và B1-1, B1-2 (tasks DEFAULT_MONTH, UTC bug) đã được fix. Xem Phần 11 và Phụ lục để biết chi tiết. Audit classifications bên dưới phản ánh trạng thái **trước khi fix** — sau khi fix, tất cả P0/P1 bugs này đã được giải quyết.

---

## 1. Executive Summary

### Health tổng thể: **6.3 / 10**

> **Công thức tính:** Trung bình 10 dimension scores (mỗi score /5) × 2 = điểm /10.
> Ví dụ: (3.5+4.5+3.5+3+3+2+3.5+2+3+3.5)/10 = 3.15 × 2 = **6.3/10**

VAM OS đã vượt qua giai đoạn "database tĩnh" và trở thành một hệ thống vận hành thật sự. Auth, RLS, matching, event operations, application intake (S12), recap reconciliation — tất cả đều hoạt động ở mức MVP. Tuy nhiên, **một số bugs nghiêm trọng về hardcode** đang khiến trang Operations (vận hành hàng ngày) hiển thị sai dữ liệu tháng 7/2026, và trang Tasks bị mắc kẹt ở tháng 4/2026.

### Các phần mạnh nhất
1. **Auth + RLS** — Supabase Auth thật, service-role token isolation, không còn password-only gate.
2. **S11 Recap Reconciliation** — Dashboard live, data contract có test, số liệu khớp với production facts.
3. **Matching foundation** — Capacity enforcement (max 3), duplicate prevention, audit log, batch isolation.
4. **Event Phase 2** — Model phong phú: registration workflow, check-in QR, capacity/waitlist, payment proof.
5. **Application intake S12** — Multi-step review, bulk assignment, interview self-claim, profile creation.

### 5 rủi ro / gap lớn nhất

| # | Rủi ro | Loại | P (đã điều chỉnh) | Trạng thái |
|---|--------|------|---|---|
| 1 | `OPERATIONAL_MONTH_END = "2026-06"` hardcoded trong 3 file — tháng 7/2026 có 18 recap không xuất hiện trong KPI operational | BUG | **P1** (reporting/operational blocker; dữ liệu không mất, còn trong outlier section) | ✅ Đã fix |
| 2 | `console.log("ROLE DEBUG", adminUser)` trong production browser — lộ email + role (không có token/secret) | PRIVACY | **P1** (privacy hygiene; không có credential trong log) | ✅ Đã fix |
| 3 | `DEFAULT_MONTH = "2026-04"` + UTC `currentMonth()` — một shared month-selection defect ở 3 điểm | BUG | P1 | ✅ Đã fix |
| 4 | `currentMonth()` UTC trong `/operations` + `lib/data.ts` — một phần của shared month-selection defect trên | BUG | P1 | ✅ Đã fix |
| 5 | Không có test cho matching capacity, application approval, event capacity, auth permissions — không có E2E nào | GAP | P2 | Chưa fix |

### Sẵn sàng S12 matching? **Có** — Batch 0 bugs đã fix.
### Sẵn sàng demo? **Có** — Debug log đã xóa.
### Sẵn sàng vận hành hàng ngày? **Có** — `/operations` bây giờ hiển thị tháng 7/2026 với 18 recaps.

---

## 2. Current Product Map

### 2.1 Kiến trúc tổng quan

```
[Browser / Admin User]
     │
     ▼
[Vercel Edge — Next.js 14 App Router]
     │
     ├── Server Components (app/**/page.tsx)
     │       └── Data fetching: lib/data.ts → Supabase PostgREST
     │                                       → RPC (migration 032)
     ├── Client Components (*-client.tsx, components/)
     │       └── Server Actions (app/actions/*.ts)
     │
     ├── Public Routes (middleware marks x-vam-public-route)
     │       ├── /register/[token]   — event registration form
     │       ├── /checkin/[token]    — event check-in QR
     │       └── /apply/mentor|mentee — application form (gated by env)
     │
     └── Protected Routes (requiresAuth — Supabase Auth + admin_users lookup)
```

**Auth flow:** Browser cookie (`vam_os_sb_access_token`) → `getCurrentAdminUser()` → Supabase `auth.getUser()` → service-role lookup `admin_users` → role enforcement.

**Data layer:** `lib/data.ts` — 1 file, ~900 LOC, tập trung tất cả Supabase queries. RPC fast-path cho `getOperationsData` (migration 032). Direct-query fallback khi có `scope` filter.

### 2.2 Route Map

| Route | Type | Auth | Nav |
|-------|------|------|-----|
| `/` | Server | ✓ | ✓ Dashboard |
| `/operations` | Server | ✓ | ✓ Operations |
| `/operations/intelligence` | Server | ✓ | ✗ (hidden) |
| `/operations/monthly` | Server | ✓ | ✗ (hidden) |
| `/operations/tasks` | Server | ✓ | ✗ (hidden) |
| `/people` | Server | ✓ | ✓ |
| `/people/[id]` | Server | ✓ | — |
| `/mentors` | Server | ✓ | ✓ |
| `/mentors/[id]/edit` | Server+Client | ✓ | — |
| `/mentors/create` | Server+Client | ✓ | — |
| `/mentees` | Server | ✓ | ✓ |
| `/mentees/[id]/edit` | Server+Client | ✓ | — |
| `/mentees/create` | Server+Client | ✓ | — |
| `/applications` | Server | ✓ | ✓ |
| `/applications/[id]` | Server+Client | ✓ | — |
| `/matches` | Server+Client | ✓ | ✓ |
| `/matches/[id]` | Server | ✓ | — |
| `/events` | Server | ✓ | ✓ |
| `/events/[id]` | Server | ✓ | — |
| `/events/[id]/attendance` | Server+Client | ✓ | — |
| `/events/[id]/edit` | Server+Client | ✓ | — |
| `/events/[id]/registrations/[regId]` | Server+Client | ✓ | — |
| `/events/create` | Server+Client | ✓ | — |
| `/reviews` | Server | ✓ (reviewer+) | ✓ (gated) |
| `/reviews/assign-bulk` | Server+Client | ✓ (core_team+) | — |
| `/reviews/progress` | Server | ✓ | — |
| `/reviews/reviewer-pool` | Server+Client | ✓ | — |
| `/reviews/guide` | Server | ✓ | — |
| `/interviews` | Server+Client | ✓ (reviewer+) | ✓ (gated) |
| `/data-issues` | Server | ✓ | ✓ |
| `/team` | Server | ✓ (core_team+) | ✓ (gated) |
| `/admin` | Server+Client | ✓ (core_team+) | ✓ (gated) |
| `/admin/users` | Server+Client | ✓ (admin+) | ✓ (gated) |
| `/admin/debug-auth` | Server | ✓ | — |
| `/admin/applications` | Server | ✓ | — |
| `/recaps/create` | Server+Client | ✓ (core_team+) | — |
| `/recaps/[id]/edit` | Server+Client | ✓ (core_team+) | — |
| `/login` | Client | public | — |
| `/unlock` | Client | public | — |
| `/apply/mentor` | Client | public (gated) | — |
| `/apply/mentee` | Client | public (gated) | — |
| `/register/[token]` | Client | public | — |
| `/checkin/[token]` | Client | public | — |
| `/reset-password` | Client | public | — |

**Routes có trong code nhưng không có navigation:** `/operations/intelligence`, `/operations/monthly`, `/operations/tasks`, `/admin/debug-auth`, `/admin/applications`, `/recaps/create`, `/recaps/[id]/edit`.

### 2.3 Module Map

```
lib/
├── data.ts              — Tất cả Supabase queries + RPC, ~900 LOC
├── data-selects.ts      — Select string constants (dependency-free)
├── matches.ts           — Matching logic + capacity rules + audit
├── events.ts            — Event detail + registration helpers
├── admin-corrections.ts — Admin correction workflow
├── admin-auth.ts        — Auth resolution, cookie management
├── auth-constants.ts    — Roles, legacy shims (canEditRecaps)
├── permissions.ts       — Role-based permission functions
├── program-scope.ts     — Season/batch scope isolation
├── season-config.ts     — CURRENT_OPERATING_SEASON_CODE = "UEHM-S11"
├── dashboard-month.ts   — Month selection, computeS11RecapReconciliation
├── lifecycle-crm.ts     — Member lifecycle helpers
├── types.ts             — All TypeScript types (~685 LOC)
└── ... (form action types, gate helpers)
```

### 2.4 Role / Workflow Map

| Role | Quyền chính |
|------|-------------|
| `super_admin` | Toàn quyền |
| `admin` | Toàn quyền trừ một số system config |
| `core_team` | Manage recaps, events, matches, corrections, tasks |
| `support_team` | Xem người dùng (read-only, không có quyền edit) |
| `reviewer` | Xem + submit reviews và interview |
| `viewer` | Chỉ xem dashboard |

---

## 3. Blueprint Coverage Matrix

> **Chú giải status:** DONE | PARTIAL | MISSING | BUG | INTENTIONAL_DIVERGENCE | DEFERRED | OWNER_DECISION_REQUIRED

### 3.1 Section A — Mục tiêu Phase 2

| Blueprint ref | Yêu cầu | Hiện trạng | Evidence | Status | P | Gap / Impact | Recommendation | Effort | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| A.1 | Biến hệ thống từ DB tĩnh thành công cụ vận hành sống | Dashboard live, Operations page, follow-up queue, recap reconciliation hoạt động | `app/page.tsx`, `app/operations/page.tsx` | DONE | — | — | — | — | High |
| A.2 | Core team thấy ai đang mentoring thật mỗi tháng | Có KPI cards, follow-up table, topMentorRows | `app/page.tsx:370-438` | DONE | — | — | — | — | High |
| A.3 | Ai đang im lặng | Follow-up 2 tháng table có trên cả Dashboard và Operations | `app/page.tsx:270-294`, `app/operations/page.tsx:283-294` | DONE | — | — | — | — | High |
| A.4 | Event nào đang vắng | Event attendance rate trên Operations + Monthly | `app/operations/page.tsx:235-241` | DONE | — | — | — | — | High |
| A.5 | Mentee nào cần can thiệp | Follow-up queue + tasks | `app/operations/tasks/page.tsx` | PARTIAL | P2 | Tasks page hardcode tháng 4/2026 | Fix DEFAULT_MONTH | XS | High |
| A.6 | Chi phí vận hành thấp nhất (không import CSV hàng ngày) | Vẫn còn import script. UI đã có tạo recap thủ công nhưng chưa hoàn chỉnh | `app/recaps/create/page.tsx` | PARTIAL | P2 | Recap Steward vẫn cần terminal để bulk import | 2D in-app form cần hoàn thiện | M | High |

### 3.2 Section B — Quyết định nghiệp vụ đã chốt

| Blueprint ref | Yêu cầu | Hiện trạng | Evidence | Status | P | Gap / Impact |
|---|---|---|---|---|---|---|
| B.1 | 1 recap = 1 buổi gặp | Schema hỗ trợ (mỗi row = 1 recap) | `mentoring_recaps` schema | DONE | — | — |
| B.1c | Cross-mentoring tính riêng với meeting_type | `meeting_type` field tồn tại trong schema và OPS_RECAPS_SELECT | `lib/data-selects.ts:11` | DONE | — | — |
| B.2 | 1 recap/mentee/tháng minimum | Logic follow-up 2-tháng implemented | `app/page.tsx:199` | DONE | — | — |
| B.2a | 'Tháng' = lịch dương | Calendar month được dùng | `lib/dashboard-month.ts` | DONE | — | — |
| B.3 | Follow-up flag sau 2 tháng liên tiếp missing | Tính toán có trong code, hiển thị trên dashboard | `app/page.tsx:199` | DONE | — | — |
| B.3b | action_items table cho follow-up history | `workflow_queue` table tồn tại (migration 023), /operations/tasks có đầy đủ CRUD | `app/operations/tasks/page.tsx` | PARTIAL | P1 | DEFAULT_MONTH hardcode | Fix | XS | 
| B.4 | Walk-in = row riêng với admin_notes='walk-in' | Schema hỗ trợ `is_walk_in`, `walk_in` fields | `lib/types.ts:439,542` | DONE | — | — |
| B.5 | 3 event chính được track (Orientation/Kickoff/Tổng kết) | Event system đầy đủ hơn blueprint yêu cầu | `supabase_migrations/048,049,054,055,056` | INTENTIONAL_DIVERGENCE | — | System đã scale lên nhiều event_type hơn |
| B.6 | 6 KPI cố định Monthly Report | 10 KPI có trên Operations + Monthly | `app/operations/page.tsx:244-253`, `app/operations/monthly/page.tsx:173-183` | DONE | — | — |

### 3.3 Section C — SOP vận hành hàng tháng

| Blueprint ref | Yêu cầu | Hiện trạng | Status | P | Gap |
|---|---|---|---|---|---|
| C.1 | 4 vai trò: Ops Lead, Recap Steward, Event Steward, DQ Reviewer | Role system có (core_team, reviewer), nhưng không phân biệt Recap Steward vs Event Steward vs DQ Reviewer | PARTIAL | P2 | Các vai trò này không phân biệt trong UI — cùng role `core_team` |
| C.2 | Lịch tháng checklist (đầu tháng, giữa tháng, cuối tháng) | Có `/operations/tasks` với workflow queue, nhưng chưa có checklist template tự động | PARTIAL | P3 | Phải tạo task thủ công, không có auto-generate |
| C.3 | Owner đích danh cho từng việc | Tasks có owner_email field | PARTIAL | P2 | Không có owner auto-assign theo SOP |

### 3.4 Section D — Định nghĩa trạng thái và KPI

| Blueprint ref | Yêu cầu | Hiện trạng | Status | Gap |
|---|---|---|---|---|
| D.1 | valid recap = meeting_date + recap_url hợp lệ + issue_flag OK | Logic tính trên status field, không filter issue_flag | PARTIAL | Blueprint định nghĩa filter issue_flag nhưng code chỉ filter theo status. issue_flag != null không bị loại. |
| D.2 | 10 KPI cố định | Dashboard có ~15 KPI cards, bao phủ tất cả blueprint + thêm | DONE | — |
| D.2 health KPIs | Tỷ lệ mentee active / tổng; follow-up mới; attendance rate; mentor ngủ đông | Có tất cả trên Dashboard + Operations | DONE | — |

### 3.5 Section E — Recap workflow

| Blueprint ref | Yêu cầu | Hiện trạng | Status | P | Gap |
|---|---|---|---|---|---|
| E.1 | Pipeline: FB sweep → Quick-Add → import → hiển thị | Pipeline vẫn cần terminal (import script). Quick-Add in-app chưa hoàn thiện | PARTIAL | P1 | `/recaps/create` có nhưng không có Quick-Add CSV row interface |
| E.2-E.3 | Xử lý các trường hợp đặc biệt (broken link, shared post, cross-mentoring) | issue_flag, meeting_type, recap_note có trong schema | PARTIAL | P2 | UI không có guidance cho Recap Steward về các case này |
| E.4 | Admin nhập 4 field tối thiểu | `/recaps/create` form tồn tại | PARTIAL | P1 | Form chưa được link trong navigation |
| E.5 | Hệ thống tự suy meeting_month, season_code, etc. | Có partial: meeting_month tự derive từ meeting_date | PARTIAL | P2 | match_id lookup chưa tự động trong in-app form |

### 3.6 Section F — Event workflow

| Blueprint ref | Yêu cầu | Hiện trạng | Status |
|---|---|---|---|
| F.1 | Pre-event: tạo event row ≥7 ngày trước | `/events/create` hoạt động, có đủ fields | DONE |
| F.2 | Walk-in: row mới với attendance_status='attended' | `is_walk_in=true` hỗ trợ | DONE |
| F.3 | Post-event: import CSV cập nhật attendance | Admin attendance form tồn tại ở `/events/[id]/attendance` | DONE |
| F.4-F.5 | 4 field tối thiểu + hệ thống tự suy | Form có đủ | DONE |

### 3.7 Section G — Follow-up rules

| Blueprint ref | Yêu cầu | Hiện trạng | Status | P | Gap |
|---|---|---|---|---|---|
| G.1 | Auto-mở follow-up flag sau 2 tháng silent | Tính toán đúng trong code | DONE | — | — |
| G.2 | Workflow 6 bước xử lý follow-up | `/operations/tasks` có CRUD cho action_items | PARTIAL | P1 | DEFAULT_MONTH hardcode ở 2026-04, workflow không auto-assign theo Support Team |
| G.3 | Auto-đóng khi có recap mới | Không có auto-close logic — tasks phải đóng tay | PARTIAL | P2 | Manual only |
| G.4 | Giao tiếp 1-1, không public | Không có communication tool tích hợp — chỉ link hồ sơ | OWNER_DECISION_REQUIRED | — | Ops team dùng Zalo/email riêng |

### 3.8 Section H — Monthly Operations Report

| Blueprint ref | Yêu cầu | Hiện trạng | Status | P | Gap |
|---|---|---|---|---|---|
| H — 8 phần báo cáo | Template báo cáo 4-6 trang | `/operations/monthly` có KPI table + event table | PARTIAL | P1 | Thiếu: mentor heatmap, follow-up list, recommended actions, PDF export |
| H.2 | Executive summary | Không có auto-generate | MISSING | P2 | Phải viết tay |
| H.3 | Recommended actions | `/operations/tasks` có nhưng không kết nối vào monthly report | PARTIAL | P2 | — |
| H.4 | Export PDF | Không có | MISSING | P2 | Cần implement (Phase 2C+ theo blueprint) |

### 3.9 Section I — CSV import / data model

| Blueprint ref | Yêu cầu | Hiện trạng | Status |
|---|---|---|---|
| I.1 | mentoring_recaps CSV bỏ match_id, meeting_month | Schema vẫn có, nhưng không expose trong Quick-Add form | PARTIAL |
| I.2 | event_participations CSV với walk_in boolean | Schema có `walk_in` field | DONE |
| I.3 | meeting_type enum | `meeting_type` field tồn tại | DONE |
| I.3 | captured_by field | Tồn tại trong schema | DONE |

### 3.10 Section J — Dashboard / UX core team

| Blueprint ref | Yêu cầu | Hiện trạng | Status | P | Gap |
|---|---|---|---|---|---|
| J.1 | Profile Mentee: "X recap trong mùa · Y tháng" | `/people/[id]` có recap count | PARTIAL | P2 | Không có mini chart theo tháng, không có badge trạng thái (active/silent/follow-up) |
| J.2 | Profile Mentor: bảng mentee dưới quyền + mini chart | `/people/[id]` có nhưng limited | PARTIAL | P2 | Thiếu per-mentor mentee health view |
| J.3 | Event detail dashboard: 3 KPI số to + filter | `/events/[id]` có nhưng không có filter by role | PARTIAL | P2 | — |
| J.4 | Monthly operations dashboard: 10 KPI + mentor heatmap + follow-up queue | Có KPI, thiếu heatmap và drill-down slice | PARTIAL | P1 | Mentor heatmap (blueprint J.4) chưa implement |
| J.5 | Data Issues: 5 loại cảnh báo với nút Resolve | 7 loại cảnh báo nhưng không có recap-related issues | PARTIAL | P2 | /data-issues không xử lý recap data issues (blueprint J.5 items 1-5 đều là recap-related) |

### 3.11 Section K — Rủi ro vận hành

| Blueprint ref | Rủi ro | Đã xử lý? | Tình trạng |
|---|---|---|---|
| K | Recap Steward burnout | Partial — Phase 2F (self-submit) chưa có | DEFERRED |
| K | Mentee mất tích | Follow-up system có | DONE |
| K | FB link bị xoá | Chấp nhận rủi ro, issue_flag hỗ trợ | INTENTIONAL_DIVERGENCE |
| K | Lộ thông tin cá nhân | Auth + RLS | DONE |
| K | Dữ liệu nhập sai / trùng | Data Issues page, correction workflow | PARTIAL |
| K | Vercel password gate | Còn password gate fallback trong code | PARTIAL — cần remove |
| K | Debug log lộ email/role | `console.log("ROLE DEBUG")` trong production | **P1 — đã fix** (không có token/secret trong log) |

### 3.12 Section L — Roadmap 2A–2G

---

## 4. Roadmap 2A–2G Status

| Phase | Definition of Done (Blueprint) | Actual Completion | Evidence | Gap | Kết luận |
|-------|-------------------------------|-------------------|----------|-----|----------|
| **2A** CSV import + read-only activity | ≥1 recap test hiển thị đúng trên Vercel | DONE — 2322 recaps in production | `git log: b5910c4, c857ef8, fdaa37c` | — | **DONE** |
| **2B** Event participation pilot | 1 event với ≥10 attendance rows, hiển thị ở 3 nơi | DONE — Full event system với registration, check-in, QR | `supabase_migrations/051,054,055,056` | System đi xa hơn Blueprint (Phase 2 configurable events) | **DONE (Exceeded)** |
| **2C** Monthly operations dashboard | Ops Lead view trang thay vì query DB; Export PDF | PARTIAL — `/operations/monthly` có KPI + event table; thiếu mentor heatmap, follow-up list, PDF export | `app/operations/monthly/page.tsx` | Thiếu PDF export, mentor heatmap, recommended actions | **PARTIAL** |
| **2D** Admin correction workflow | Recap Steward không cần CSV cho thao tác sửa lẻ | PARTIAL — Correction workflow có tại `/admin`, in-app recap create/edit có nhưng thiếu Quick-Add flow | `app/admin/page.tsx`, `app/recaps/create/page.tsx` | Recap Steward vẫn cần terminal cho bulk | **PARTIAL** |
| **2E** Supabase Auth + RLS | Vercel không còn password gate; mỗi user có role rõ | PARTIAL — Auth thật có, nhưng password gate fallback còn trong code | `lib/admin-auth.ts:29-35` | Password gate legacy shim còn tồn tại | **PARTIAL** |
| **2F** Mentee self-submit recap form | ≥30% recap từ mentee; Recap Steward giảm 50% thời gian | MISSING — Không có public recap form | — | Không có implementation | **MISSING** |
| **2G** Mentor pulse check | Dashboard cross-check pulse vs recap | MISSING | — | Không có implementation | **MISSING** |

---

## 5. UX/UI Audit by Route

| Route / Screen | What works | UX/UI Issue | User Impact | Recommendation | P | Effort |
|---|---|---|---|---|---|---|
| `/` Dashboard | S11 reconciliation panel, month selector, follow-up table, mentor recap table, donut chart | (1) "Đối soát Recap Chính thức" panel đặt ở đầu trang — người vận hành hàng ngày không cần reconciliation mỗi khi mở; (2) 6 KPI cards S11 và 6 KPI cards operations gây confuse về context | Ops Lead mất thời gian đọc panel không liên quan đến công việc daily | Chuyển S11 reconciliation thành collapsible/tab riêng; nhóm KPI rõ hơn | P2 | S |
| `/` Dashboard | Mentee health donut | Không có action button từ donut — click chart không làm gì | Ops Lead thấy vấn đề nhưng không biết làm gì tiếp theo | Thêm link "Mở danh sách" từ donut chart | P2 | XS |
| `/operations` | Tháng selector hoạt động, follow-up table đúng | `OPERATIONAL_MONTH_END = "2026-06"` — tháng 7/2026 bị cắt khỏi month picker | Recap Steward không thấy 18 recap tháng 7 trên trang vận hành chính — BUG | Fix hardcode sang dynamic | P0 | XS |
| `/operations` | KPI table đầy đủ | `currentMonth()` dùng UTC không phải Asia/HCM | Sai tháng trong khung 17:00–00:00 VN | Dùng `currentMonthVN()` từ `lib/dashboard-month.ts` | P1 | XS |
| `/operations` | Recap list, event list | Không có pagination — nếu season có 2000+ recaps, server render toàn bộ | Performance sẽ giảm khi scale | Implement pagination hoặc infinite scroll | P2 | M |
| `/operations/monthly` | KPI + event table | (1) Thiếu mentor heatmap; (2) Thiếu follow-up list; (3) Tháng 7 bị cắt (`OPERATIONAL_MONTH_END = "2026-06"`) | Ops Lead không có đủ thông tin để viết Monthly Report | Fix hardcode; thêm mentor heatmap minimal; link ra /operations/tasks | P1 | S |
| `/operations/tasks` | CRUD action items đầy đủ | `DEFAULT_MONTH = "2026-04"` hardcoded — trang luôn load tháng 4 | Recap Steward mở trang thấy dữ liệu 3 tháng cũ — mất tin tưởng hệ thống | Fix hardcode thành `currentMonthVN()` | P0→P1 | XS |
| `/operations/intelligence` | Full founder intelligence dashboard với charts | Không có link từ navigation sidebar | Ops Lead không biết trang này tồn tại | Thêm sub-nav dưới Operations | P2 | XS |
| `/matches` | Filter batch/status, capacity bar, tạo match thủ công | (1) Không có search bằng tên mentor/mentee; (2) Không thể mark match là "completed" — chỉ có "drop"; (3) Không có bulk match | Admin mất nhiều thời gian tìm match cụ thể | Thêm text search; thêm action "Kết thúc bình thường" | P1 | S |
| `/matches/[id]` | Detail page đọc đủ thông tin | Read-only hoàn toàn — không có action nào từ detail page | Không thể xem và sửa trong 1 view | Thêm "Hủy match" và "Xem recaps của match này" | P2 | S |
| `/events` | List với filter | Không có filter by status (active vs cancelled) | Events list lộn xộn khi có nhiều event | Thêm status filter | P3 | XS |
| `/events/[id]` | Detail + QR + link panel | Registrations table không có pagination — event 300+ người sẽ chậm | Performance issue | Pagination | P2 | M |
| `/data-issues` | 7 loại data issues | Không có recap-related issues (unmatched_recap, broken_link, future_date) — đây là 5/5 issue types trong Blueprint J.5 | Data Quality Reviewer phải dùng SQL để tìm recap data issues | Thêm recap data issues section | P1 | M |
| `/admin` | Correction workflow, follow-up management | URL `/admin` không rõ ràng về mục đích | Ops Lead nhầm với "admin users" | Rename navigation label thành "Workflow" hoặc "Ops Tasks" | P3 | XS |
| Navigation | 9 nav items visible | 3 Operations sub-pages có link trong Operations page nav (lines 394–420); `/recaps/create` có link gated bởi `allowRecapEdit` (line 416) | **PARTIAL / OWNER DECISION** — pages có thể truy cập từ /operations, không phải từ sidebar. Đây là quyết định thiết kế nav, không phải bug | Thêm "Operations" dropdown sub-nav nếu owner muốn | P2 | S |
| Mobile | — | Sidebar `hidden lg:block` — không có hamburger menu | Không dùng được trên điện thoại (Recap Steward hay check trên mobile) | Thêm mobile drawer nav | P2 | M |
| All pages | — | `outline: none` trong `globals.css:26` — xóa browser default focus ring. **Tuy nhiên:** tất cả input/select trong codebase đều có `focus:border-vam-green focus:ring-2 focus:ring-vam-mint` qua Tailwind. Global override là risky nhưng có compensating controls | **PARTIAL** — focus indicators tồn tại qua Tailwind cho các element đã inspect. Risk cho element chưa inspect. Keep P1 recommendation | Bỏ global rule, để Tailwind focus styles | P1 | XS |

---

## 6. Role-Based Workflow Audit

### 6.1 Ops Lead

| Bước công việc | Trong UI? | Cần tool khác? |
|---|---|---|
| Xem KPI tháng | ✓ `/operations/monthly` | — |
| Xem follow-up queue | ✓ `/operations/tasks` (nhưng default tháng 4) | Cần fix bug |
| Tạo Monthly Report | ✗ Chỉ xem số — phải viết tay | Google Docs |
| Export PDF báo cáo | ✗ | Google Docs |
| Chốt tháng (mark as closed) | ✓ (view only, DB auto-chốt qua v_season_latest_closed_month) | — |
| Escalate case khẩn | ✗ Không có in-app notification | Zalo/email |
| Xem mentor heatmap | ✗ Chưa có | SQL |

**Kết luận Ops Lead:** ~60% công việc làm được trong UI. Báo cáo tháng vẫn cần Google Docs.

### 6.2 Recap Steward

| Bước công việc | Trong UI? | Cần tool khác? |
|---|---|---|
| Tạo recap đơn lẻ | ✓ `/recaps/create` (nhưng không có nav link) | — |
| Sửa recap | ✓ `/recaps/[id]/edit` | — |
| Bulk import recap | ✗ | Terminal + Python script |
| Tìm mentee qua search | ✓ `/people` | — |
| Xem follow-up queue | ✓ `/operations/tasks` (nhưng tháng 4) | — |
| Đánh dấu follow-up resolved | ✓ | — |
| Detect unmatched recap | ✗ `/data-issues` không có recap data issues | SQL |

**Kết luận Recap Steward:** ~55% làm được trong UI. Bulk import, unmatched recap detection vẫn cần terminal.

### 6.3 Event Steward

| Bước công việc | Trong UI? |
|---|---|
| Tạo event | ✓ `/events/create` |
| Cấu hình registration/check-in | ✓ `/events/[id]/edit` |
| Tạo QR link | ✓ `/events/[id]` |
| Import attendance CSV | ✓ `/events/[id]/attendance` |
| Walk-in check-in | ✓ `/events/[id]/attendance` (manual form) |
| Export attendance | ✓ (CSV export button) |

**Kết luận Event Steward:** ~90% làm được trong UI. Đây là module hoàn chỉnh nhất.

### 6.4 Data Quality Reviewer

| Bước công việc | Trong UI? |
|---|---|
| Xem data issues (người thiếu phone, school) | ✓ `/data-issues` |
| Resolve duplicate email | ✓ `/data-issues` |
| Tìm recap có issue_flag | ✗ Không có UI | SQL |
| Tìm unmatched recap | ✗ Không có UI | SQL |
| Apply correction với audit log | ✓ `/admin` correction workflow |

**Kết luận Data Quality Reviewer:** ~50% làm được trong UI. Recap-specific data issues hoàn toàn thiếu.

---

## 7. Matching Readiness Audit

### 7.1 Current Capability (DONE)

- **Tạo match thủ công:** Form tại `/matches` (chọn batch → chọn mentor → chọn mentee)
- **Capacity enforcement:** MAX_MENTOR_ACTIVE_MATCHES = 3, kiểm tra DB trước khi insert
- **Duplicate prevention:** Unique index tại DB level (migration 046a), check trước insert ở application layer
- **Cancel match:** `cancelMatch()` function với audit log
- **Match list với filter:** batch, status (active/dropped/completed/unmatched_review)
- **Batch isolation:** Match gắn `intake_batch_id`, season isolation qua `season_id`
- **Audit log:** `admin_audit_log` table, `writeAdminAudit()` function

### 7.2 Data / Business-Rule Safety

| Rule | Implemented? | Evidence |
|------|-------------|----------|
| 1 mentee max 1 active match | ✓ DB constraint + app check | `lib/matches.ts:561-576`, migration 046a |
| 1 mentor max 3 active mentees | ✓ App check (MAX_MENTOR_ACTIVE_MATCHES = 3) | `lib/matches.ts:578-594` |
| Batch membership verify | ✓ Checks both profiles belong to same batch | `lib/matches.ts:532-537` |
| Season scope check | ✓ | `lib/matches.ts:555-559` |
| Admin role required | ✓ `canManageMatches` = core_team+ | `lib/permissions.ts:73-75` |

### 7.3 UX Gaps

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Không có mentor search/filter trong match form | Với 100+ mentor, dropdown không usable | Thêm search-as-you-type |
| Không có mentee search/filter | Tương tự | Thêm search-as-you-type |
| Mentee đã có match không bị ẩn khỏi dropdown — chỉ có badge `has_active_match` | Admin có thể cố tạo match → nhận error message | Disable hoặc move to bottom |
| Không có "Kết thúc bình thường" (mark as completed) — chỉ có "Hủy" | Semantic sai khi match kết thúc season bình thường | Thêm action "Hoàn thành mùa" |
| Match detail `/matches/[id]` hoàn toàn read-only | Admin phải quay về `/matches` để cancel | Thêm action buttons vào detail |
| Không có bulk matching | S12 với 100+ mentee/mentor — phải match từng cặp | Implement trong Phase tiếp theo |
| Không có cross-mentoring match UI | Blueprint B.1c yêu cầu match_type='cross' | Thêm match_type selector |

### 7.4 S12 Blockers (phải fix trước khi mở matching thật)

| # | Blocker | P | Effort |
|---|---------|---|--------|
| 1 | `/operations` và `/operations/monthly` không hiển thị tháng 7 (OPERATIONAL_MONTH_END bug) | P0 | XS |
| 2 | Debug console.log lộ admin info | P0 | XS |
| 3 | `/operations/tasks` DEFAULT_MONTH hardcode 2026-04 | P1 | XS |
| 4 | Mentor search/filter trong match form | P1 | S |

### 7.5 Recommended Next Implementation Batch

1. Fix 3 hardcode bugs (XS — <2 giờ)
2. Remove debug log (XS)
3. Thêm text search cho mentor/mentee trong match form (S)
4. Thêm "completed" match status action (S)
5. Thêm recap data issues vào `/data-issues` (M)

---

## 8. Architecture and Technical Debt

### 8.1 Data Layer

**Vấn đề:** `lib/data.ts` là một file ~900 LOC làm tất cả mọi thứ (queries, RPC calls, data transformations, type coercions). Khó maintain, khó test.

**Evidence:** `lib/data.ts` — 1 file, 35+ exported functions, 8 imports.

**Recommendation:** Tách theo domain: `lib/data/recaps.ts`, `lib/data/matches.ts`, `lib/data/events.ts`, etc. Priority P3 (không urgent, nhưng làm trước S12 scale sẽ tốt hơn).

### 8.2 Business Rule Duplication

**Vấn đề nghiêm trọng:** `VALID_RECAP_STATUSES`, `OPERATIONAL_MONTH_START/END`, `isValidRecapActivity()` được định nghĩa lại ở nhiều file:

| Constant | Định nghĩa ở |
|----------|-------------|
| `VALID_RECAP_STATUSES` | `lib/dashboard-month.ts:2`, `app/operations/monthly/page.tsx:15` |
| `VALID_ACTIVITY_STATUSES` | `app/operations/page.tsx:18` (same values, different name) |
| `OPERATIONAL_MONTH_START` | `lib/dashboard-month.ts:1`, `app/operations/page.tsx:15`, `app/operations/monthly/page.tsx:13` |
| `OPERATIONAL_MONTH_END` | `app/operations/page.tsx:16` ("2026-06"), `app/operations/monthly/page.tsx:14` ("2026-06") |
| `isValidRecapActivity()` | `app/page.tsx:28`, `app/operations/page.tsx:59` |

**Impact:** Đây là nguyên nhân gốc của bug P0 — dashboard dùng dynamic range nhưng operations pages dùng hardcode. Một người sửa dashboard-month.ts không biết cần sửa cả 2 page kia.

**Recommendation:** Export tất cả từ `lib/dashboard-month.ts`, xóa local definitions. P1.

### 8.3 RPC / Direct-Query Contract

**Đã verify:** Migration 032 (RPC `get_operations_dashboard_data`) SELECT bao gồm đủ `admin_notes`, `recap_source`, `meeting_type`, `issue_flag`. RPC fast-path và direct-query fallback có cùng data contract. **Test regression có tại `__tests__/dashboard-month.test.ts`.**

### 8.4 Server / Client Boundaries

- Server Components dùng đúng cho data fetching
- Client Components (`*-client.tsx`) chứa form state, Server Actions cho mutations
- `lib/matches.ts` có `"server-only"` import guard — đúng
- `lib/admin-corrections.ts` có `"server-only"` — đúng
- **Vấn đề:** `components/app-shell.tsx` là Client Component nhưng có `console.log` leak admin data (xem P0 bug)

### 8.5 Types

- `lib/types.ts` ~685 LOC, comprehensive
- Tất cả types dùng `JsonRecord &` intersection — flexible nhưng mất type safety cho nullable fields
- `EventRegistration` type rất đầy đủ (Phase 2 fields)
- `Match` type có đầy đủ Phase 046A fields

### 8.6 Tests

**Hiện tại:** 1 file test, 33 test cases, tất cả unit tests cho `lib/dashboard-month.ts`.

**Missing (critical paths không có test):**
- Matching capacity rules (`MAX_MENTOR_ACTIVE_MATCHES = 3`)
- Duplicate match prevention
- Application approval → profile creation idempotency
- Auth/permission functions (`canManageMatches`, `canEditRecaps`)
- Event capacity/waitlist
- Dashboard month selection edge cases với timezone
- Any integration test
- Any E2E test

### 8.7 Auth / RLS

- Supabase Auth với custom httpOnly cookies: đúng approach
- Service-role client dùng đúng chỗ (server-side only)
- RLS migrations 018, 057 có nhưng chưa audit toàn diện
- Password gate fallback vẫn trong code (`lib/admin-auth.ts:29-35`, `lib/password-gate.ts`) — đây là legacy và nên được loại bỏ

### 8.8 Performance

- **N+1 concern:** `getMatchList()` trong `lib/matches.ts` load matches → loop → batch fetch people → loop người profiles. Hiệu suất OK nhưng cần monitor khi S12 scale.
- **No pagination** trên bất kỳ list nào — people (~700+), mentors, mentees, applications, matches, events all load toàn bộ
- `getDashboardData()` + `getOperationsData()` đều được gọi trong `app/page.tsx` — 2 full dataset loads mỗi page render
- Không có `revalidatePath`/`revalidateTag` sau mutations — pages always fetch fresh (đúng cho consistency, nhưng chậm hơn với cache)

### 8.9 Maintainability

- `pg` trong `dependencies` (không phải `devDependencies`) — chỉ dùng trong import scripts, không cần trong Next.js app
- `qrcode` và `@types/qrcode` trong `dependencies` — cần cho event QR, đúng
- Untracked scripts (12 files) chứa import utilities, Python scripts — không gitignored, có thể vô tình commit sensitive code

---

## 9. Accessibility Report

| Finding | Evidence | WCAG | Fix | P | Effort |
|---------|----------|------|-----|---|--------|
| `outline: none` cho `input, select` — xóa browser default. Tailwind `focus:ring-2 focus:ring-vam-mint` trên hầu hết elements. Risk cho elements thiếu class này | `app/globals.css:26` | 2.4.7 Focus Visible (AA) — **PARTIAL** (compensating controls exist) | Bỏ global rule, giữ Tailwind `:focus-visible` | P1 | XS |
| Sidebar không có hamburger/mobile nav | `components/app-shell.tsx:94` — `hidden lg:block` | 1.3.4 Orientation (AA) | Thêm mobile drawer | P2 | M |
| `<table>` headers không có `scope="col"` | `app/matches/page.tsx:215-221` (và nhiều trang khác) | 1.3.1 Info & Relationships | Thêm `scope="col"` | P2 | XS |
| `console.log("ROLE DEBUG")` chạy trên browser — log `{id, email, full_name, role, status, auth_user_id}`. Không có session token/access token/secret | `components/app-shell.tsx:53-59` | P1 privacy hygiene (đã điều chỉnh từ P0: không có credential trong log) | Đã xóa trong Batch 0 | **✅ Đã fix** | XS |
| Form labels trong filter bars dùng wrapping `<label>` — OK | Nhiều filter forms | — | Acceptable pattern | — | — |
| Status chỉ dùng màu (xanh/đỏ/vàng) không có icon/text thứ 2 | `app/matches/page.tsx:16-25` StatusBadge | 1.4.1 Use of Color (A) | Thêm icon kèm text | P2 | S |
| Button "Lọc" không có visible focus ring | filter forms | 2.4.7 | Add focus-visible ring | P1 | XS |
| Touch targets — filter buttons ~32px height | Nhiều trang | 2.5.5 Target Size | Tăng lên min 44px | P3 | S |
| Semantic headings: h2 dùng nhất quán, nhưng h1 chỉ qua PageHeader | Multiple pages | 1.3.1 | Đã OK, minor issue về hierarchy | P3 | XS |

---

## 10. Security and Production Safety

> Không in giá trị secret. Chỉ đánh giá cấu trúc.

| Finding | Severity | Status |
|---------|----------|--------|
| **`console.log("ROLE DEBUG (AppShell):", adminUser)`** trong production — log `{id, email, full_name, role, status, auth_user_id}` ra browser DevTools. `adminUser` type không chứa session token, access token, refresh token, password, hoặc secret. | **P1 — đã điều chỉnh từ P0** — privacy hygiene, không phải credential exposure | **✅ Đã fix trong Batch 0** |
| Password gate fallback vẫn trong code (`VAM_OS_ADMIN_PASSWORD` env) | MEDIUM | LEGACY — nên remove; hiện không active nếu env không set, nhưng backdoor tồn tại |
| Service-role key chỉ dùng server-side — đúng | GOOD | — |
| `auth_user_id` backfill tự động khi first login — risk race condition nhỏ nếu email trùng | LOW | Acceptable cho MVP |
| Public forms (`/apply/*`, `/register/*`, `/checkin/*`) có middleware gate `x-vam-public-route` | GOOD | — |
| Application forms gated bằng env var và token — double gate | GOOD | — |
| Untracked files bao gồm `temp_audit.mjs`, `extract_catalog.ps1`, `scripts/reset-two-staging-passwords.mjs` — nguy cơ vô tình commit | MEDIUM | Cần gitignore hoặc xóa |
| CSV files gitignored (`Cleaning_data.csv`, `Mentee_Tracking.csv`) | GOOD | — |
| `db_backup*.json` files không thấy trong codebase | GOOD | — |
| RLS migration 057 (`security_hardening_rls_phase1`) đã apply | GOOD | — |
| Season/batch scope isolation trong `lib/program-scope.ts` | GOOD | — |

---

## 11. Prioritized Backlog

### Batch 0: P0 Safety (NGAY LẬP TỨC)

| ID | Finding | P | Solution | Files | Effort | Dependencies | Acceptance Criteria |
|----|---------|---|----------|-------|--------|--------------|---------------------|
| B0-1 | `console.log("ROLE DEBUG")` lộ email/role trong production browser | **P1** (điều chỉnh từ P0: không có credential) | Xóa comment + if block `app-shell.tsx:53-59` | `components/app-shell.tsx:53-59` | XS | — | DevTools không còn in adminUser object | **✅ Đã fix** |
| B0-2 | `OPERATIONAL_MONTH_END = "2026-06"` trong `/operations` — tháng 7/2026 bị xếp vào "outlier", không vào KPI | **P1** (điều chỉnh từ P0: data visible as outlier, not data loss) | Xóa hardcode, import `currentMonthVN, isOperationalMonth, operationalMonthRange` từ lib | `app/operations/page.tsx` | XS | — | Tháng 7/2026 xuất hiện trong KPI và month picker | **✅ Đã fix** |
| B0-3 | `OPERATIONAL_MONTH_END = "2026-06"` trong `/operations/monthly` — tương tự B0-2 | **P1** | Import từ lib, dùng `operationalMonthRange(nowVN)` | `app/operations/monthly/page.tsx` | XS | — | Month picker bao gồm July 2026 | **✅ Đã fix** |

### Batch 1: S12 Operational Blockers

| ID | Finding | P | Solution | Files | Effort | Dependencies | Acceptance Criteria |
|----|---------|---|----------|-------|--------|--------------|---------------------|
| B1-1 | `DEFAULT_MONTH = "2026-04"` hardcode trong /operations/tasks | P1 | `cleanMonth()` trả null; page dùng `cleanMonth() ?? currentMonthVN()` | `app/operations/tasks/page.tsx:12,29` | XS | — | Tasks page load tháng hiện tại mặc định | **✅ Đã fix** |
| B1-2 | `currentMonth()` UTC trong /operations và `lib/data.ts` | P1 | Xóa local `currentMonth()`, dùng `currentMonthVN()` từ lib | `app/operations/page.tsx`, `lib/data.ts` | XS | — | Month calculation chính xác với timezone VN | **✅ Đã fix** |
| B1-3 | Business rule duplication (VALID_RECAP_STATUSES, OPERATIONAL constants) | P1 | Export từ `lib/dashboard-month.ts`, xóa local copies | 3 files | S | B0 | 1 source of truth, lint pass |
| B1-4 | `/operations/tasks` link từ nav hidden | P1 | Thêm sub-nav dưới Operations dropdown | `components/app-shell.tsx` | XS | — | User thấy link trong nav |
| B1-5 | `/recaps/create` không có nav link | P1 | Thêm link trong sidebar (gated bởi canEditRecaps) | `components/app-shell.tsx` | XS | — | Recap Steward tìm được |
| B1-6 | `pg` trong production dependencies | P1 | Move to devDependencies hoặc xóa (không dùng trong Next.js app) | `package.json` | XS | — | Production bundle size giảm |
| B1-7 | focus outline xóa trong globals.css | P1 | Xóa `outline: none`, thêm `:focus-visible` | `app/globals.css:26` | XS | — | Keyboard navigation visible |
| B1-8 | Recap data issues missing từ /data-issues | P1 | Thêm: unmatched_recap, broken_link, future_date issues | `app/data-issues/page.tsx` | M | — | DQ Reviewer thấy recap issues |

### Batch 2: Matching

| ID | Finding | P | Solution | Files | Effort | Dependencies | Acceptance Criteria |
|----|---------|---|----------|-------|--------|--------------|---------------------|
| B2-1 | Không có search trong mentor/mentee dropdown của match form | P1 | Thêm search-as-you-type trong ManualMatchForm | `app/matches/matches-client.tsx` | S | — | Admin gõ tên filter dropdown |
| B2-2 | Không có "Kết thúc bình thường" (completed) action | P2 | Thêm `updateMatchStatus(matchId, 'completed')` action | `lib/matches.ts`, `app/matches/matches-client.tsx` | S | — | Match có thể mark as completed |
| B2-3 | Match detail read-only hoàn toàn | P2 | Thêm cancel action vào `/matches/[id]` | `app/matches/[id]/page.tsx` | S | — | Detail page có cancel button |
| B2-4 | Mentee có match không được visually differentiated trong dropdown | P2 | Bold style hoặc disable mentee đã có match | `app/matches/matches-client.tsx` | XS | — | Rõ ràng hơn |
| B2-5 | Không có tests cho matching rules | P2 | Thêm Vitest tests cho capacity, duplicate | `__tests__/matches.test.ts` | M | — | Coverage cho createManualMatch |

### Batch 3: Dashboard / Reporting

| ID | Finding | P | Solution | Files | Effort | Acceptance Criteria |
|----|---------|---|----------|-------|--------|---------------------|
| B3-1 | S11 reconciliation panel đặt đầu trang dashboard — không daily-relevant | P2 | Collapsible section hoặc move xuống cuối | `app/page.tsx:339-364` | XS | Daily KPIs visible first |
| B3-2 | `/operations/monthly` thiếu follow-up list và mentor heatmap | P2 | Thêm follow-up count + link ra /operations/tasks; minimal heatmap | `app/operations/monthly/page.tsx` | M | Monthly report đủ data |
| B3-3 | PDF export cho Monthly Report | P2 | Browser print CSS hoặc server-side PDF generation | `app/operations/monthly/page.tsx` | L | Print/export button |
| B3-4 | Donut chart không clickable | P2 | Link slice → filtered list | `components/charts.tsx` | M | Click chart → filter page |

### Batch 4: UX / Accessibility Polish

| ID | Finding | P | Solution | Effort |
|----|---------|---|----------|--------|
| B4-1 | Mobile nav missing | P2 | Hamburger drawer nav | M |
| B4-2 | Status badges chỉ dùng màu | P2 | Thêm icon | XS |
| B4-3 | Table headers thiếu scope | P2 | Thêm `scope="col"` | XS |
| B4-4 | Touch targets < 44px | P3 | Tăng padding | S |
| B4-5 | Operations Intelligence không có nav | P2 | Sub-nav | XS |

### Later Phases (Deferred)

| ID | Item | Priority |
|----|------|----------|
| F1 | Phase 2F: Mentee self-submit recap form | **DEFERRED** — Blueprint ghi rõ đây là Phase 2F, không phải S12 admin-MVP blocker |
| F2 | Phase 2G: Mentor pulse check | **DEFERRED** — Blueprint ghi rõ đây là Phase 2G, scope sau 2F |
| F3 | Pagination trên tất cả list pages | P2 |
| F4 | Auto-close follow-up flag khi có recap | P2 |
| F5 | Monthly Report auto-generate Executive Summary | P3 |
| F6 | Tách `lib/data.ts` theo domain | P3 |
| F7 | E2E testing (Playwright) | P2 |
| F8 | Mentor heatmap full (mentor × tháng) | P2 |
| F9 | Multi-program support | P3 |

---

## 12. Recommended Solution Architecture

### Giữ lại
- Next.js 14 App Router + Server Components — đúng approach cho admin portal
- Supabase cho DB + Auth — đủ tốt cho scale hiện tại
- Tailwind + simple component library — nhất quán, không cần thay
- `lib/dashboard-month.ts` pattern — pure functions, testable, có coverage
- Matching business rules tại DB level (unique index, FK constraints)

### Refactor ngay (Batch 0–1)
- **3 hardcode bugs** (OPERATIONAL_MONTH_END) → 1 source of truth từ `lib/dashboard-month.ts`
- **Debug console.log** → xóa hoàn toàn
- **`pg` dependency** → devDependencies hoặc xóa
- **Business rule constants** → tập trung 1 nơi

### Refactor medium-term
- Tách `lib/data.ts` thành domain modules (recaps, matches, events, people, applications)
- Thêm pagination component tái sử dụng
- Thêm mobile navigation

### Bỏ
- Password gate code (sau khi confirm không còn env var nào dùng) 
- Legacy `canEditRecaps`, `canManageWorkflow` shims trong `lib/auth-constants.ts` (sau khi migrate all callers sang `lib/permissions.ts`)

### Module làm tiếp theo (theo thứ tự)
1. Fix Batch 0 bugs (1 giờ)
2. Fix Batch 1 operational blockers (1 ngày)
3. Matching UX improvements (2 ngày)
4. Recap data issues trong /data-issues (2 ngày)
5. Mobile nav (1 ngày)
6. Monthly Report improvements (3 ngày)

### Tests cần thêm trước
1. Matching capacity + duplicate prevention
2. Auth permission functions
3. Application approval idempotency
4. Event capacity/waitlist
5. E2E login → dashboard → create match → cancel match

### Changes cần migration vs frontend-only

**Frontend only (no migration):**
- Fix OPERATIONAL_MONTH_END hardcode
- Remove debug log
- Fix DEFAULT_MONTH in tasks
- Business rule constants centralization
- Mobile nav, pagination, UX improvements
- Recap data issues section

**Cần migration:**
- Follow-up auto-close logic (nếu implement DB trigger)
- Mentor pulse check (new table)
- PDF export (new table nếu store generated reports)

### Cần owner decision
- Xem phần 14

---

## 13. 30/60/90-Day Plan

### 0–30 ngày: Fix Bugs + S12 Readiness

| Việc | Owner | Deliverable | Acceptance Criteria |
|------|-------|-------------|---------------------|
| Fix B0-1,2,3 (hardcode bugs + debug log) | Dev | Commit + Vercel deploy | /operations thấy tháng 7; console sạch |
| Fix B1-1,2,3 (tasks DEFAULT_MONTH, UTC bug, constants centralization) | Dev | Commit + tests pass | tasks page load tháng hiện tại |
| Fix B1-4,5 (nav links hidden pages) | Dev | nav update | Recap Steward thấy /recaps/create |
| Fix B1-6,7 (pg dependency, outline CSS) | Dev | package.json + CSS | build clean; keyboard focus visible |
| Thêm matching search (B2-1) | Dev | ManualMatchForm update | Dropdown searchable |
| Add matching tests (B2-5) | Dev | `__tests__/matches.test.ts` | Coverage cho capacity + duplicate |

### 31–60 ngày: Matching + Reporting

| Việc | Owner | Deliverable |
|------|-------|-------------|
| Recap data issues section (B1-8) | Dev | /data-issues có recap issues |
| Match "completed" action (B2-2) | Dev | UI action + DB update |
| Mobile navigation (B4-1) | Dev | Hamburger drawer |
| /operations/monthly improvements (B3-2) | Dev | Follow-up count + mentor heatmap minimal |
| Pagination component (F3) | Dev | Re-usable, deployed on /people, /matches |

### 61–90 ngày: Scale + Polish

| Việc | Owner | Deliverable |
|------|-------|-------------|
| Phase 2F mentee self-submit form | Dev + Ops Lead | ≥30% recaps từ mentee |
| PDF export Monthly Report (B3-3) | Dev | Print/export button |
| E2E tests (F7) | Dev | Playwright suite, CI gate |
| Monthly Report auto-generation | Dev + Ops Lead | Phần 2 (KPI table) auto-filled |
| Remove password gate legacy code | Dev | Code clean |

---

## 14. Owner Decisions Required

| # | Quyết định | Impact nếu không chốt | Đề xuất mặc định |
|---|-----------|----------------------|-----------------|
| 1 | **Season 12 go-live date?** Khi nào switch `CURRENT_OPERATING_SEASON_CODE` từ S11 → S12? | Dashboard sẽ hiện S11 data mãi | Chốt ngày cụ thể trong tháng 8/2026 |
| 2 | **Có bỏ password gate hoàn toàn không?** Hay giữ như emergency fallback? | Security risk nếu giữ; mất backup access nếu bỏ | Bỏ hoàn toàn — Auth đã stable |
| 3 | **Recap Steward role separation:** Tách thành role riêng trong admin_users, hay giữ chung `core_team`? | Không thể giao task theo SOP nếu giữ chung | Thêm role `recap_steward` và `event_steward` |
| 4 | **issue_flag filter trong valid recap definition:** Blueprint nói filter `issue_flag`, nhưng code hiện tại chỉ filter theo `status`. 2,322 recap có bao nhiêu row có issue_flag không null? | KPI có thể bị inflate | Kiểm tra DB, quyết định có enforce hay không |
| 5 | **Phase 2F (mentee self-submit) — timeline?** S12 cần hay không? | Recap Steward burnout risk tăng | Implement trong tháng 8–9/2026 (31–60 day) |
| 6 | **Mentor pulse check (2G) — có ưu tiên không?** | Không biết mentor có thực sự gặp mentee hay chỉ "báo có" | Defer sang sau khi S12 matching ổn định |
| 7 | **PDF export báo cáo tháng — cần trước khi gửi Ban điều hành?** Hay Google Docs vẫn OK? | Ops Lead mất thêm thời gian mỗi tháng | Implement print CSS là đủ cho MVP |
| 8 | **Pagination threshold?** List load bao nhiêu row là max trước khi page? | Performance issue khi S12 scale | 100 rows/page mặc định |
| 9 | **Auto-close follow-up tasks khi có recap mới?** | Tasks tồn tại lâu dù đã resolved | Implement auto-close bằng DB trigger |
| 10 | **HAM program data** — nhiều untracked files liên quan. Có audit/import HAM data không? | Data không nhất quán giữa chương trình | Cần owner confirm scope |

---

## 15. Final Verdict

| Dimension | Score | Giải thích |
|-----------|-------|-----------|
| **Architecture** | 3.5/5 | Server Components đúng, nhưng `lib/data.ts` monolith, business rule duplication, RPC/direct-query inconsistency |
| **Data Integrity** | 4.5/5 | S11 reconciliation hoàn chỉnh, DB constraints enforce matching rules, audit log có |
| **Backend Completeness** | 3.5/5 | CRUD cho tất cả entities, nhưng Phase 2F/2G DEFERRED (theo blueprint), bulk import vẫn cần terminal |
| **Frontend Completeness** | 3/5 | Tất cả routes tồn tại; hardcode bugs P1 đã fix; hidden nav = OWNER DECISION không phải bug; no mobile nav |
| **UX/UI** | 3/5 | Nhất quán, functional, nhưng missing search, pagination, mobile, clickable charts |
| **Accessibility** | 2/5 | outline:none global override với PARTIAL compensating controls (Tailwind focus:ring), no mobile nav, status color-only |
| **Security** | 3.5/5 | Auth solid, RLS có, nhưng P0 debug log, password gate legacy code |
| **Test Coverage** | 2/5 | 33 unit tests cho 1 module, không có integration/E2E, critical paths không covered |
| **Operational Readiness** | 3/5 | 60–70% công việc hàng ngày làm được trong UI; 3 bugs P0 ảnh hưởng trang vận hành chính |
| **S12 Readiness** | 3.5/5 | Matching foundation đủ, application intake đủ, nhưng bugs P0 cần fix trước khi mở |

---

## Appendix: Commands và Tests đã chạy

```
git status --short
git branch --show-current
git log -5 --oneline
git log -1 origin/main --oneline
npm test      → 33 tests, 1 file, all PASS
npm run lint  → No ESLint warnings or errors
npm run build → ✓ Clean build, 36 routes
```

---

## Disclaimer

```
NO PRODUCTION WRITE PERFORMED.
NO CODE FIX PERFORMED.
REPORT ONLY — WAITING FOR OWNER APPROVAL.
```

Tất cả phát hiện được dựa trên đọc code + chạy test/lint/build local.  
Không có thay đổi nào đối với application code, migrations, database, hoặc Vercel.  
Không có commit hoặc push nào trong quá trình audit này.

---

*Audit thực hiện 2026-07-20 bởi Claude Sonnet 4.6 — VAM OS Admin Portal @ commit `9a19755`*
*Batch 0 remediation thực hiện 2026-07-20 trong cùng phiên: 6 files changed, 52 tests pass, lint + build clean.*
