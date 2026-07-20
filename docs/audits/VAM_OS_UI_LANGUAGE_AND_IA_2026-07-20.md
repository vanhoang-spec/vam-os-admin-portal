# VAM OS — UI Language & Information Architecture Audit
**Date:** 2026-07-20
**Scope:** All user-facing strings across all 46 routes; primary navigation structure
**Status:** READ-ONLY AUDIT — No labels changed, no DB values changed, no migration run
**Auditor:** Claude Sonnet 4.6 (automated) + owner review pending

---

## Table of Contents
1. [Context & Constraints](#1-context--constraints)
2. [Methodology](#2-methodology)
3. [Term Inventory by Route](#3-term-inventory-by-route)
4. [Top 20 Terminology Problems](#4-top-20-terminology-problems)
5. [Corporate Terms Found (Blocklist Audit)](#5-corporate-terms-found-blocklist-audit)
6. [Technical Identifiers Shown as UI Labels](#6-technical-identifiers-shown-as-ui-labels)
7. [Vietnamese Coverage by Route](#7-vietnamese-coverage-by-route)
8. [Proposed Programme Vocabulary (Source of Truth)](#8-proposed-programme-vocabulary-source-of-truth)
9. [Current Navigation Audit](#9-current-navigation-audit)
10. [IA Problems Found](#10-ia-problems-found)
11. [Proposed Vietnamese Primary Navigation (≤8 items)](#11-proposed-vietnamese-primary-navigation-8-items)
12. [Route Consolidation Proposals](#12-route-consolidation-proposals)
13. [Vocabulary-to-Route Mapping](#13-vocabulary-to-route-mapping)
14. [Batch 1 Implementation Notes](#14-batch-1-implementation-notes)
15. [Open Questions for Owner Decision](#15-open-questions-for-owner-decision)

---

## 1. Context & Constraints

**What VAM is:** Vietnam Alumni Mentoring — a social mentoring program connecting university alumni with current students. Volunteer mentors, no commercial transactions, no corporate hierarchy.

**What VAM OS is:** The internal admin portal used by a small core team (≈5–15 people) to manage the programme's operational data — recaps, matches, events, follow-ups, and data quality.

**Language policy:**
- Primary UI language is Vietnamese (admin team is Vietnamese-speaking).
- English is acceptable for internal technical identifiers (DB field names, status enums, code values) when shown in a clearly technical context (e.g. a debug table with column header `recap_source`).
- English corporate terms (CEO, Founder, Executive, Intelligence, Pipeline, Command Center, Health) must not appear in user-facing labels unless the VAM programme explicitly uses that term for its own role structure.
- Social/programme-specific terminology (mentee tham gia, cần hỗ trợ, chưa có recap) is preferred over punitive/clinical corporate terms (silent, dropped, invalid, excluded).

**Constraints for this audit:**
- No application code changed.
- No database values or enums changed.
- No migration run.
- This document is input for Batch 1 — it flags what must change, not how to implement it.

---

## 2. Methodology

All `app/**/*.tsx` and `components/app-shell.tsx` files were read in full. For each route the following were catalogued:
- `<PageHeader title=...>` value
- Nav label in `app-shell.tsx`
- `<h2>`, `<h3>` section headers
- `<KpiCard label=...>` values
- `<option value=...>` and display text in form selects
- Table column headers (`label:` in column definitions)
- Button and link text

A string is flagged if it:
1. Is on the user's explicit blocklist (CEO, Founder, Intelligence, Health, Silent, Dropped, Invalid, Excluded, Duplicate, Needs Review, Data Issues, Tasks, Operations, Admin), OR
2. Is English in a primarily Vietnamese context without clear technical necessity, OR
3. Implies a corporate hierarchy that VAM does not have, OR
4. Is punitive/clinical about programme participants.

---

## 3. Term Inventory by Route

### `/` — Dashboard

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Dashboard" | PageHeader title | EN | Page title | LOW — widely understood |
| "Sức khỏe mentoring" | h2 section header | VI | Section | MEDIUM — "sức khỏe" = health metaphor |
| "Mentee health - {month}" | operations/page.tsx h2 | EN | Section | HIGH — "health" on blocklist |
| "Im lặng 2 tháng liên tiếp / cần follow-up" | KpiCard label | VI | KPI | MEDIUM — "im lặng" = silent, punitive |
| "Chưa có recap tháng gần nhất" | KpiCard label | VI | KPI | OK |
| "Tình trạng vận hành dữ liệu" | h2 | VI | Section | OK |
| "Quy mô dữ liệu / Master data" | h2 | VI+EN | Section | LOW |

### `/operations` — Operations

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Operations" | PageHeader title + Nav | EN | Page title + Nav | HIGH — blocklist |
| "Tổng quan tháng (CEO view)" | Nav link text | VI+EN | Sub-nav link | CRITICAL — CEO on blocklist |
| "Mentee health - {month}" | h2 | EN | Section | HIGH — "health" on blocklist |
| "Số tháng silent" | Column label | EN | Table column | HIGH — "silent" on blocklist |
| "Im lặng 2 tháng liên tiếp / cần follow-up" | KpiCard label | VI | KPI | MEDIUM |
| "Xem danh sách cần follow-up" | Link label | VI | Action | OK |

### `/operations/monthly` — Monthly Operations

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Monthly Operations" | PageHeader title | EN | Page title | HIGH — English title |
| Content | All strings | VI | Body | OK |

### `/operations/tasks` — Công việc Operations

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Công việc Operations" | PageHeader title | VI+EN | Page title | MEDIUM — "Operations" retained |
| "Follow-up Queue" | h2 | EN | Section | HIGH — "Queue" is CS term |
| "Data Issues Queue" | h2 | EN | Section | HIGH — "Data Issues" + "Queue" |

### `/operations/intelligence` — Founder Intelligence

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Founder & Core Team Intelligence" | PageHeader title | EN | Page title | CRITICAL — "Founder" + "Intelligence" |
| "Mentor Intelligence" | h2 | EN | Section | HIGH — "Intelligence" |
| "Mentee Intelligence" | h2 | EN | Section | HIGH — "Intelligence" |
| "Matching Intelligence" | h2 | EN | Section | HIGH — "Intelligence" |
| "Activity by Segment" | h2 | EN | Section | HIGH — corporate analytics |
| "Recommended Actions" | h2 | EN | Section | MEDIUM — corporate |
| "Silent mentee by career interest" | h3 | EN | Section | HIGH — "Silent" |
| "Mentee im lặng" | KpiCard label | VI | KPI | MEDIUM |
| "Cộng đồng đang khỏe hay yếu ở đâu?" | Card description | VI | Body | MEDIUM — "khỏe/yếu" = health metaphor |

### `/data-issues` — Data Issues

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Data Issues" | PageHeader title + Nav | EN | Page title + Nav | HIGH — blocklist |
| "duplicate count" | Table column header | EN | Column | MEDIUM — English in table |

### `/admin` — Admin Correction Workflow

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| "Admin Correction Workflow" | PageHeader title | EN | Page title | HIGH — "Admin" on blocklist |
| "Admin Workflow" | Nav label | EN | Nav | HIGH — "Admin" on blocklist |
| "Data Issues" | Tab label | EN | Tab | HIGH — blocklist |
| "Follow-up" | Tab label | EN | Tab | MEDIUM |
| "Users" | Tab label | EN | Tab | LOW |
| "Data Issues Queue" | h2 | EN | Section | HIGH |
| "Follow-up Queue" | h2 | EN | Section | HIGH |
| "Unmatched recap" | KpiCard label | EN | KPI | MEDIUM |
| "Missing mentee" | KpiCard label | EN | KPI | MEDIUM |
| "Missing mentor" | KpiCard label | EN | KPI | MEDIUM |
| "Invalid date" | KpiCard label | EN | KPI | MEDIUM — "Invalid" on blocklist |
| "Duplicate recap" | KpiCard label | EN | KPI | MEDIUM — "Duplicate" on blocklist |
| "Open" | KpiCard label | EN | KPI | MEDIUM — English in VI context |
| "In progress" | KpiCard label | EN | KPI | MEDIUM |
| "No response" | KpiCard label | EN | KPI | MEDIUM |
| "Resolved" | KpiCard label | EN | KPI | MEDIUM |

### `admin-correction-forms.tsx` — Form selects

| String | Location | Language | Category | Flag? |
|--------|----------|----------|----------|-------|
| `<option value="dropped">dropped</option>` | Select option | EN raw enum | Form | HIGH — raw enum exposed |
| `<option value="needs_review">needs_review</option>` | Select option | EN raw enum | Form | HIGH — raw enum with underscore |
| `<option value="invalid">invalid</option>` | Select option | EN raw enum | Form | HIGH — "Invalid" on blocklist |
| `<option value="duplicate">duplicate</option>` | Select option | EN raw enum | Form | HIGH — "Duplicate" on blocklist |
| `<option value="excluded">excluded (sync-managed)</option>` | Select option | EN | Form | HIGH — "Excluded" on blocklist |

### `/app-shell.tsx` — Navigation

| Nav Label | Href | Flag? |
|-----------|------|-------|
| "Dashboard" | / | LOW |
| "Operations" | /operations | HIGH |
| "People" | /people | LOW |
| "Mentors" | /mentors | OK |
| "Mentees" | /mentees | OK |
| "Applications" | /applications | MEDIUM — could be Vietnamese |
| "Matches" | /matches | LOW |
| "Sự kiện" | /events | OK — good |
| "Data Issues" | /data-issues | HIGH — blocklist |
| "Reviews" | /reviews | LOW |
| "Phỏng vấn" | /interviews | OK — good |
| "Team & Trách nhiệm" | /team | OK — good |
| "Admin Workflow" | /admin | HIGH |
| "Quản lý người dùng" | /admin/users | OK — good |

---

## 4. Top 20 Terminology Problems

Ranked by severity (impact × frequency × alignment with VAM values):

| # | Term / String | File | Line | Severity | Reason |
|---|--------------|------|------|----------|--------|
| 1 | "Founder & Core Team Intelligence" | `app/operations/intelligence/page.tsx` | 76 | CRITICAL | "Founder" implies a corporate founder role VAM does not have. "Intelligence" is corporate analytics jargon. Page title visible on every load. |
| 2 | "Tổng quan tháng (CEO view)" | `app/operations/page.tsx` | 374 | CRITICAL | VAM has no CEO. This label was almost certainly copied from a corporate dashboard template and never updated. Visible to all ops users as a primary navigation link. |
| 3 | "Mentor Intelligence" / "Mentee Intelligence" / "Matching Intelligence" | `app/operations/intelligence/page.tsx` | 103, 154, 191 | HIGH | Three section headers using "Intelligence". Combined effect makes the page feel like a corporate BI tool rather than a social programme admin. |
| 4 | "Số tháng silent" | `app/operations/page.tsx` | 438 | HIGH | Table column label using English "silent" — on blocklist, visible in the main follow-up table used every month. |
| 5 | "Silent mentee by career interest" | `app/operations/intelligence/page.tsx` | 175 | HIGH | "Silent" characterizes programme participants negatively. Section header. |
| 6 | "Data Issues" (nav + page title) | `components/app-shell.tsx:36`, `app/data-issues/page.tsx:215` | 36, 215 | HIGH | English corporate/technical term in nav and page title. "Data Issues" sounds like a software error tracker, not a programme support tool. |
| 7 | "Admin Correction Workflow" / "Admin Workflow" | `app/admin/page.tsx:231`, `app-shell.tsx:45` | 231, 45 | HIGH | "Admin" as a nav label is ambiguous (admin = admin user? administrative function?). "Correction Workflow" is corporate process language. |
| 8 | "Monthly Operations" (page title) | `app/operations/monthly/page.tsx:107` | 107 | HIGH | English page title for a primarily Vietnamese audience. |
| 9 | "Operations" (nav + page title) | `app-shell.tsx:29`, `app/operations/page.tsx:318` | 29, 318 | HIGH | Not inherently bad but sets a corporate tone throughout the site. Vietnamese "Vận hành" is available and already used in body text. |
| 10 | "Follow-up Queue" / "Data Issues Queue" | `app/operations/tasks/page.tsx:295,300`, `app/admin/page.tsx:102,158` | multiple | HIGH | "Queue" is customer-service/CS terminology. Appears in h2 headers across two pages. |
| 11 | `dropped` (raw enum in select) | `app/admin/admin-correction-forms.tsx:69` | 69 | HIGH | Raw DB enum "dropped" exposed as visible option label. "Dropped" on blocklist. |
| 12 | `needs_review`, `invalid`, `duplicate`, `excluded` (raw enums) | `app/admin/admin-correction-forms.tsx:136-140` | 136–140 | HIGH | Four raw DB enum values shown as `<option>` labels with underscores. Technical identifiers exposed as UI text. |
| 13 | "Invalid date" / "Duplicate recap" (KpiCard) | `app/admin/page.tsx:84,85` | 84, 85 | MEDIUM | "Invalid" and "Duplicate" on blocklist. English KPI labels on an otherwise mixed-language page. |
| 14 | "Open" / "In progress" / "No response" / "Resolved" (KpiCard) | `app/admin/page.tsx:145-148` | 145–148 | MEDIUM | All English KPI card labels in FollowUpTab. Inconsistent — same page uses Vietnamese "Đang cần xử lý". |
| 15 | "Mentee im lặng" (KpiCard) | `app/operations/intelligence/page.tsx:47` | 47 | MEDIUM | "Im lặng" = silent. Punitive characterization of mentees who haven't submitted recaps. Better: "Cần liên hệ" or "Chưa có recap". |
| 16 | "Im lặng 2 tháng liên tiếp / cần follow-up" | `app/page.tsx:372`, `app/operations/page.tsx:313,368` | multiple | MEDIUM | "Im lặng" repeated across three files in KpiCard labels. |
| 17 | "Sức khỏe mentoring" / "Mentee health" | `app/page.tsx:376`, `app/operations/page.tsx:407` | 376, 407 | MEDIUM | "Health" metaphor for engagement metrics. In Vietnamese "sức khỏe" (health) sounds clinical. Better: "Tình trạng tham gia" or "Mức độ hoạt động". |
| 18 | "Activity by Segment" | `app/operations/intelligence/page.tsx:209` | 209 | MEDIUM | Corporate analytics term. "Segment" is a marketing/BI concept not used in VAM programme vocabulary. Better: "Hoạt động theo nhóm". |
| 19 | "Recommended Actions" | `app/operations/intelligence/page.tsx:251` | 251 | MEDIUM | Corporate strategic planning language. Better: "Đề xuất hành động" or "Việc nên làm tiếp theo". |
| 20 | "duplicate count" (table column) | `app/data-issues/page.tsx:365` | 365 | MEDIUM | Raw English column header in an otherwise Vietnamese data table. "Duplicate" on blocklist. Better: "Số lần trùng". |

---

## 5. Corporate Terms Found (Blocklist Audit)

| Blocklist Term | Found? | Occurrences | Location |
|----------------|--------|-------------|----------|
| CEO View | YES | 1 | `app/operations/page.tsx:374` |
| Founder | YES | 1 | `app/operations/intelligence/page.tsx:76` (page title) |
| Executive | NO | 0 | — |
| Intelligence | YES | 5 | intelligence page title + 3 section h2 + 1 KpiCard description |
| Command Center | NO | 0 | — |
| Pipeline | NO | 0 | — |
| Health | YES | 3 | "Mentee health" h2 in operations + "Sức khỏe mentoring" h2 in dashboard + "Cộng đồng đang khỏe" in intelligence card |
| Silent | YES | 4 | "Số tháng silent" column label + "Silent mentee" h3 + "Mentee im lặng" KpiCard + "Im lặng" in KpiCard labels (×3 files) |
| Dropped | YES | 2 | Raw option value in admin-correction-forms.tsx + logic filter in admin/page.tsx |
| Invalid | YES | 2 | KpiCard "Invalid date" + raw option "invalid" in forms |
| Excluded | YES | 1 | Raw option "excluded (sync-managed)" in forms |
| Duplicate | YES | 3 | KpiCard "Duplicate recap" + raw option "duplicate" + column "duplicate count" |
| Needs Review | YES | 1 | Raw option `needs_review` (underscore, not "Needs Review") |
| Data Issues | YES | 4 | Nav label + page title + tab label ×2 + h2 section headers ×2 |
| Tasks | PARTIAL | 1 | "Công việc Operations" (partially localized) |
| Operations | YES | 3 | Nav label + page title + retained in task page title |
| Admin | YES | 2 | Nav "Admin Workflow" + page title "Admin Correction Workflow" |

**Summary:** 14/17 blocklist terms present. Command Center, Executive, Pipeline are absent (clean).

---

## 6. Technical Identifiers Shown as UI Labels

These are internal technical identifiers (DB enum values, field names) exposed directly as visible UI text. They are a separate problem from corporate language — they make the UI feel like a developer console rather than a programme tool.

| Raw identifier | Shown where | Context | Proposed display text |
|---------------|-------------|---------|----------------------|
| `dropped` | `<option>` in admin-correction-forms.tsx | Recap status dropdown | "Đã dừng" |
| `needs_review` | `<option>` in admin-correction-forms.tsx | Recap status dropdown | "Cần rà soát" |
| `invalid` | `<option>` in admin-correction-forms.tsx | Recap status dropdown | "Không hợp lệ" |
| `duplicate` | `<option>` in admin-correction-forms.tsx | Recap status dropdown | "Trùng lặp" |
| `excluded (sync-managed)` | `<option>` in admin-correction-forms.tsx | Recap status dropdown | "Ngoài phạm vi (do hệ thống quản lý)" |
| `duplicate count` | Table column header | Data Issues table | "Số lần trùng" |
| `unmatched_recap` | typeLabel() fallback, KpiCard | Admin data issues | "Recap chưa khớp match" |
| `missing_mentee` | typeLabel() fallback, KpiCard | Admin data issues | "Thiếu thông tin mentee" |
| `missing_mentor` | typeLabel() fallback, KpiCard | Admin data issues | "Thiếu thông tin mentor" |
| `invalid_date` | typeLabel() returns "Invalid date" | Admin data issues | "Ngày không hợp lệ" |
| `duplicate_recap` | typeLabel() returns "Duplicate recap" | Admin data issues | "Recap trùng lặp" |
| `data_issue` | typeLabel() fallback | Admin data issues | "Lỗi dữ liệu" |

> NOTE: `typeLabel()` in `app/admin/page.tsx` (lines 31–41) does map several of these, but the mapped result still uses English ("Invalid date", "Duplicate recap", "Unmatched recap"). This is where Batch 1 label changes should be applied.

---

## 7. Vietnamese Coverage by Route

Based on primary visible strings (page title, nav label, section headers, KPI labels):

| Route | Page Title | Nav Label | Sections/KPIs | Overall |
|-------|-----------|-----------|---------------|---------|
| `/` | EN ("Dashboard") | EN | ~85% VI | MEDIUM |
| `/operations` | EN | EN | ~70% VI | LOW |
| `/operations/monthly` | EN ("Monthly Operations") | — | ~95% VI | MEDIUM |
| `/operations/tasks` | VI+EN | — | ~60% VI | LOW |
| `/operations/intelligence` | EN | — | ~30% VI | CRITICAL |
| `/data-issues` | EN | EN | ~80% VI | MEDIUM |
| `/admin` | EN | EN | ~50% VI | LOW |
| `/people`, `/mentors`, `/mentees` | EN | EN | ~90% VI | MEDIUM |
| `/events`, `/matches`, `/applications` | EN | VI/EN | ~80% VI | MEDIUM |
| `/reviews`, `/interviews` | EN | VI | ~75% VI | MEDIUM |
| `/team` | — | VI | ~95% VI | OK |
| `/admin/users` | EN | VI | ~80% VI | MEDIUM |

**Lowest-coverage routes:** `/operations/intelligence` (30% VI), `/admin` (50% VI), `/operations/tasks` (60% VI).

---

## 8. Proposed Programme Vocabulary (Source of Truth)

This glossary defines the preferred display text for all currently problematic terms. DB enums/values MUST NOT change — only the display layer changes.

### Navigation terms

| Current (EN) | Proposed (VI) | Notes |
|-------------|---------------|-------|
| Dashboard | Tổng quan | Standard. "Dashboard" also acceptable as subtitle. |
| Operations | Vận hành | Standard Vietnamese for programme operations. |
| Monthly Operations | Tổng quan tháng | Sub-page label. |
| Data Issues | Cảnh báo dữ liệu | "Dữ liệu cần rà soát" is longer alternative. |
| Admin Workflow | Quy trình nội bộ | Or "Xử lý nội bộ". |
| Admin Correction Workflow | Xử lý & chỉnh sửa | Page title. |
| Applications | Đơn ứng tuyển | Full Vietnamese. |

### Corporate term replacements

| Current term | Proposed replacement | Rationale |
|-------------|---------------------|-----------|
| Founder & Core Team Intelligence | Phân tích cộng đồng | The page shows analytics for the mentor/mentee community — "phân tích cộng đồng" is accurate. |
| CEO view | (remove parenthetical) | The link "Tổng quan tháng (CEO view)" → "Tổng quan tháng". No CEO in VAM. |
| Mentor Intelligence | Phân tích mentor | Direct, accurate. |
| Mentee Intelligence | Phân tích mentee | Direct, accurate. |
| Matching Intelligence | Phân tích ghép cặp | Accurate to what the section shows. |
| Activity by Segment | Hoạt động theo nhóm | "Nhóm" = group/cohort, appropriate for a programme. |
| Recommended Actions | Việc nên làm | Conversational, appropriate for a core-team tool. |
| Silent / im lặng (about mentees) | Chưa có recap / Cần liên hệ | Non-punitive. "Silent" implies fault; "chưa có recap" states the fact. |
| Health / sức khỏe (section) | Tình trạng tham gia | "Health" metaphor removed; "tình trạng" = status/condition, neutral. |
| Queue | Danh sách | "Danh sách" = list, widely understood. |
| Follow-up Queue | Danh sách cần follow-up | Descriptive. |
| Data Issues Queue | Danh sách lỗi dữ liệu | Descriptive. |

### Recap status display (form options)

| DB enum value | Current display | Proposed display |
|--------------|----------------|-----------------|
| `dropped` | `dropped` | Đã dừng |
| `needs_review` | `needs_review` | Cần rà soát |
| `invalid` | `invalid` | Không hợp lệ |
| `duplicate` | `duplicate` | Trùng lặp |
| `excluded` | `excluded (sync-managed)` | Ngoài phạm vi (hệ thống quản lý) |

### Data issue type display (`typeLabel()` in `app/admin/page.tsx`)

| Type key | Current return | Proposed return |
|----------|---------------|----------------|
| `unmatched_recap` | "Unmatched recap" | "Recap chưa khớp match" |
| `missing_mentee` | "Missing mentee" | "Thiếu mentee" |
| `missing_mentor` | "Missing mentor" | "Thiếu mentor" |
| `invalid_date` | "Invalid date" | "Ngày không hợp lệ" |
| `duplicate_recap` | "Duplicate recap" | "Recap trùng lặp" |
| `data_issue` | "Data issue" | "Lỗi dữ liệu" |

### Status display (`statusLabel()` in `app/admin/page.tsx`)

| Status key | Current return | Proposed return |
|-----------|---------------|----------------|
| `open` | "Đang mở" | OK (already Vietnamese) |
| `in_progress` | "Đang xử lý" | OK |
| `resolved` | "Đã xử lý" | OK |
| `dropped` | "Đã dừng" | OK |
| `no_response` | "Không phản hồi" | OK |

> NOTE: `statusLabel()` is already partly localized. The problem is that `FollowUpTab` uses raw English KpiCard labels ("Open", "In progress") instead of calling `statusLabel()`.

---

## 9. Current Navigation Audit

### Items visible to super_admin (most privileged role)
1. Dashboard (EN)
2. Operations (EN)
3. People (EN)
4. Mentors (EN)
5. Mentees (EN)
6. Applications (EN)
7. Matches (EN)
8. Sự kiện (VI) ✓
9. Data Issues (EN — blocklist)
10. Reviews (EN)
11. Phỏng vấn (VI) ✓
12. Team & Trách nhiệm (VI) ✓
13. Admin Workflow (EN — blocklist)
14. Quản lý người dùng (VI) ✓

**Total nav items for super_admin: 14** — far exceeds the ≤8 target.

**Vietnamese coverage: 4/14 items (28%)** — far below programme standards.

### Navigation structure problems

1. **No hierarchy.** All 14 items are flat at the same level. Related routes (mentors/mentees/people, operations sub-pages) are not grouped.

2. **`/operations/intelligence` is not in nav.** Accessible only from within `/operations` via a sub-nav link. Reduces discoverability for a tool the core team uses.

3. **Dual entry for data quality.** Both `/data-issues` and `/admin?tab=data-issues` surface data quality issues. They are separate nav paths with overlapping content.

4. **`/recaps/create` is not in nav.** The most-used data entry action has no nav entry — only discoverable from within `/data-issues` and `/operations`.

5. **Mixed language.** 4 items Vietnamese, 10 items English in the same sidebar creates an inconsistent experience.

---

## 10. IA Problems Found

| # | Problem | Severity | Evidence |
|---|---------|----------|---------|
| 1 | Nav has 14 items for super_admin — cognitive overload and no grouping | HIGH | app-shell.tsx lines 27–48 |
| 2 | `/operations/intelligence` has no nav entry — buried 2 clicks from root | HIGH | Only reachable from `/operations` sub-nav |
| 3 | Data quality has two separate entry points (`/data-issues` and `/admin?tab=data-issues`) with overlapping content | HIGH | Both pages list data issues; no clear primary |
| 4 | `/recaps/create` has no nav entry | MEDIUM | Linked from `/data-issues` and `/operations` as contextual action, never from nav |
| 5 | 10/14 nav labels are English in a Vietnamese UI | HIGH | app-shell.tsx lines 27–48 |
| 6 | `/operations/monthly` and `/operations/tasks` accessible only via `/operations` sub-nav links | MEDIUM | Not in primary nav |
| 7 | "Operations" in nav expands to 4 distinct sub-pages (monthly, tasks, intelligence, main) with no indication | MEDIUM | Sub-pages discovered only after landing on /operations |
| 8 | `/admin` and `/admin/users` are separate nav entries but conceptually the same "admin" group | LOW | Two nav items for closely related functions |

---

## 11. Proposed Vietnamese Primary Navigation (≤8 items)

The goal is ≤8 primary nav items with Vietnamese labels, sufficient for all roles.

### Proposed structure

| # | Label (VI) | Href | Sub-items | Roles |
|---|-----------|------|-----------|-------|
| 1 | Tổng quan | / | — | All |
| 2 | Vận hành | /operations | Theo dõi tháng · Công việc · Phân tích cộng đồng | All |
| 3 | Cộng đồng | /people | Tất cả · Mentor · Mentee | All |
| 4 | Ghép cặp | /matches | — | All |
| 5 | Sự kiện | /events | — | All |
| 6 | Hồ sơ ứng tuyển | /applications | Đơn ứng tuyển · Phỏng vấn · Đánh giá | All |
| 7 | Rà soát dữ liệu | /data-issues | — (absorbs /admin data-issues tab) | All |
| 8 | Quản trị | /admin | Quy trình · Nhóm · Tài khoản | core_team+ |

**Total: 8 items.** All in Vietnamese. Sub-items collapse for viewers.

### Changes from current structure

| Current label | Proposed change | Rationale |
|-------------|----------------|-----------|
| Dashboard → Tổng quan | Rename | Vietnamese |
| Operations → Vận hành | Rename | Vietnamese, blocklist |
| People → Cộng đồng | Rename + group | Groups people/mentors/mentees into one expandable item |
| Mentors (separate) | Sub-item under Cộng đồng | Reduces nav count |
| Mentees (separate) | Sub-item under Cộng đồng | Reduces nav count |
| Applications → Hồ sơ ứng tuyển | Rename + group | Groups applications/reviews/interviews |
| Matches → Ghép cặp | Rename | Vietnamese |
| Sự kiện | Keep | Already Vietnamese |
| Data Issues → Rà soát dữ liệu | Rename | Vietnamese, blocklist; consolidates with /admin data-issues |
| Reviews (separate) | Sub-item under Hồ sơ ứng tuyển | Reduces nav count |
| Phỏng vấn (separate) | Sub-item under Hồ sơ ứng tuyển | Reduces nav count |
| Admin Workflow → Quản trị | Rename + group | Groups admin/team/users |
| Team & Trách nhiệm (separate) | Sub-item under Quản trị | Reduces nav count |
| Quản lý người dùng (separate) | Sub-item under Quản trị | Reduces nav count |

### Role visibility

| Nav item | viewer | reviewer | core_team | admin | super_admin |
|----------|--------|----------|-----------|-------|-------------|
| Tổng quan | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vận hành | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cộng đồng | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ghép cặp | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sự kiện | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hồ sơ ứng tuyển | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rà soát dữ liệu | ✓ | ✓ | ✓ | ✓ | ✓ |
| Quản trị | — | — | ✓ | ✓ | ✓ |

> Sub-items within Hồ sơ ứng tuyển: Đánh giá (reviews) and Phỏng vấn visible for reviewer+.

---

## 12. Route Consolidation Proposals

These are structural IA changes that require owner decision before implementation. Listed here as proposals only.

### Proposal A: Merge `/data-issues` and `/admin?tab=data-issues`

**Current:** Two pages with overlapping data quality issue lists — `/data-issues` (read-mostly, data listing) and `/admin` (data-issues tab with action items).

**Proposed:** Keep `/data-issues` as the primary "Rà soát dữ liệu" page. Add action item creation inline (the `CreateIssueActionForm` currently in `/admin`) so admin users can act without switching pages. The `/admin` page focuses on follow-up queue and correction log only.

**Benefit:** Eliminates dual-entry confusion. Single entry point for data quality.

**Risk:** Requires moving Server Action to a different page/component.

### Proposal B: Add `/operations/intelligence` to primary nav (as sub-item)

**Current:** The intelligence page is accessible only via a link on `/operations`. Many core team members may not know it exists.

**Proposed:** Add "Phân tích cộng đồng" as a sub-item under "Vận hành" in the sidebar.

**Benefit:** Increased discoverability, consistent with how `/operations/monthly` and `/operations/tasks` are surfaced.

**Risk:** None — read-only page, just a nav addition.

### Proposal C: Add `/recaps/create` to contextual nav within Vận hành

**Current:** The recap create page has no nav entry.

**Proposed:** Add "Thêm recap" as a sub-item or action button within the Vận hành section, visible only to core_team+.

---

## 13. Vocabulary-to-Route Mapping

Which files must change in Batch 1 to implement the proposed vocabulary:

| Change | File | Location | Type |
|--------|------|----------|------|
| "Founder & Core Team Intelligence" → "Phân tích cộng đồng" | `app/operations/intelligence/page.tsx` | line 76 | PageHeader title |
| "(CEO view)" → remove | `app/operations/page.tsx` | line 374 | Link label |
| "Mentor Intelligence" → "Phân tích mentor" | `app/operations/intelligence/page.tsx` | line 103 | h2 |
| "Mentee Intelligence" → "Phân tích mentee" | `app/operations/intelligence/page.tsx` | line 154 | h2 |
| "Matching Intelligence" → "Phân tích ghép cặp" | `app/operations/intelligence/page.tsx` | line 191 | h2 |
| "Activity by Segment" → "Hoạt động theo nhóm" | `app/operations/intelligence/page.tsx` | line 209 | h2 |
| "Recommended Actions" → "Việc nên làm" | `app/operations/intelligence/page.tsx` | line 251 | h2 |
| "Silent mentee by career interest" → "Mentee chưa có recap theo định hướng" | `app/operations/intelligence/page.tsx` | line 175 | h3 |
| "Mentee im lặng" → "Cần liên hệ" | `app/operations/intelligence/page.tsx` | line 47 | KpiCard label |
| "Im lặng 2 tháng..." → "Chưa có recap 2 tháng liên tiếp" | `app/page.tsx` | line 204, 372 | multiple |
| "Im lặng 2 tháng..." → "Chưa có recap 2 tháng liên tiếp" | `app/operations/page.tsx` | line 313, 368 | multiple |
| "Số tháng silent" → "Số tháng chưa có recap" | `app/operations/page.tsx` | line 438 | Column label |
| "Monthly Operations" → "Tổng quan tháng" | `app/operations/monthly/page.tsx` | line 107 | PageHeader title |
| "Mentee health - {month}" → "Tình trạng tham gia - {month}" | `app/operations/page.tsx` | line 407 | h2 |
| "Sức khỏe mentoring" → "Tình trạng tham gia" | `app/page.tsx` | line 376 | h2 |
| "Operations" nav → "Vận hành" | `components/app-shell.tsx` | line 29 | Nav label |
| "Data Issues" nav → "Rà soát dữ liệu" | `components/app-shell.tsx` | line 36 | Nav label |
| "Admin Workflow" nav → "Quy trình nội bộ" | `components/app-shell.tsx` | line 45 | Nav label |
| "Data Issues" page title → "Rà soát dữ liệu" | `app/data-issues/page.tsx` | line 215 | PageHeader title |
| "Admin Correction Workflow" → "Xử lý & chỉnh sửa" | `app/admin/page.tsx` | line 231 | PageHeader title |
| "Follow-up Queue" h2 (tasks) → "Danh sách cần follow-up" | `app/operations/tasks/page.tsx` | line 295 | h2 |
| "Data Issues Queue" h2 (tasks) → "Danh sách lỗi dữ liệu" | `app/operations/tasks/page.tsx` | line 300 | h2 |
| "Follow-up Queue" h2 (admin) → "Danh sách cần follow-up" | `app/admin/page.tsx` | line 158 | h2 |
| "Data Issues Queue" h2 (admin) → "Danh sách lỗi dữ liệu" | `app/admin/page.tsx` | line 102 | h2 |
| "Unmatched recap" → "Recap chưa khớp match" | `app/admin/page.tsx` | line 81 | KpiCard + typeLabel |
| "Missing mentee" → "Thiếu mentee" | `app/admin/page.tsx` | line 82 | KpiCard |
| "Missing mentor" → "Thiếu mentor" | `app/admin/page.tsx` | line 83 | KpiCard |
| "Invalid date" → "Ngày không hợp lệ" | `app/admin/page.tsx` | lines 37, 84 | typeLabel + KpiCard |
| "Duplicate recap" → "Recap trùng lặp" | `app/admin/page.tsx` | lines 38, 85 | typeLabel + KpiCard |
| "Open" → "Đang mở" | `app/admin/page.tsx` | line 145 | KpiCard |
| "In progress" → "Đang xử lý" | `app/admin/page.tsx` | line 146 | KpiCard |
| "No response" → "Không phản hồi" | `app/admin/page.tsx` | line 147 | KpiCard |
| "Resolved" → "Đã xử lý" | `app/admin/page.tsx` | line 148 | KpiCard |
| Raw enum "dropped" → "Đã dừng" | `app/admin/admin-correction-forms.tsx` | line 69 | option label |
| Raw enum "needs_review" → "Cần rà soát" | `app/admin/admin-correction-forms.tsx` | line 136 | option label |
| Raw enum "invalid" → "Không hợp lệ" | `app/admin/admin-correction-forms.tsx` | line 137 | option label |
| Raw enum "duplicate" → "Trùng lặp" | `app/admin/admin-correction-forms.tsx` | line 138 | option label |
| Raw enum "excluded (sync-managed)" → "Ngoài phạm vi (hệ thống quản lý)" | `app/admin/admin-correction-forms.tsx` | line 140 | option label |
| "duplicate count" → "Số lần trùng" | `app/data-issues/page.tsx` | line 365 | Table column |

**Total Batch 1 label changes: 38 strings across 7 files.**
All are display-layer changes only. No DB values change. No enums change. No migrations needed.

---

## 14. Batch 1 Implementation Notes

### Safe to implement without owner approval
The following changes are display-only and semantically clear:
- All `typeLabel()` and `statusLabel()` return value updates
- Raw enum → Vietnamese in admin-correction-forms.tsx option labels
- "Im lặng" → "Chưa có recap" in KpiCard labels
- "Monthly Operations" → "Tổng quan tháng" (page title)
- "Follow-up Queue" / "Data Issues Queue" → Vietnamese section headers
- English KpiCard labels in FollowUpTab ("Open", "In progress" etc.) → Vietnamese

### Requires owner confirmation before implementing
The following change the visible brand name of a page or concept:
- "Founder & Core Team Intelligence" → "Phân tích cộng đồng" (renames a named page)
- Navigation restructure (flat 14 items → grouped 8 items) — changes the nav experience
- `(CEO view)` removal from link text (trivial, but confirm no internal reference uses this name)

### Must NOT change
- DB enum values (recap `status` column): `dropped`, `needs_review`, `invalid`, `duplicate`, `excluded` remain in DB
- URL routes: `/operations`, `/data-issues`, `/admin` paths do not change
- `VALID_RECAP_STATUSES` set in `lib/dashboard-month.ts`
- Any counting or reconciliation logic
- Any Supabase schema or migration

---

## 15. Open Questions for Owner Decision

1. **Page name for /operations/intelligence:** "Phân tích cộng đồng" is the proposed replacement for "Founder & Core Team Intelligence". Does this name accurately reflect how the core team refers to this analytics view? Alternative: "Bức tranh cộng đồng" (community picture).

2. **"im lặng" (silent):** The current label accurately conveys the technical fact (mentee has not submitted a recap). The concern is it may feel punitive in a social programme. Is "Chưa có recap" the right replacement, or does the programme have existing vocabulary for mentees who need follow-up?

3. **Navigation restructure:** The proposed 8-item nav groups People/Mentors/Mentees into "Cộng đồng" and Applications/Reviews/Interviews into "Hồ sơ ứng tuyển". Do all roles use these pages frequently enough to warrant direct nav access, or is grouping acceptable?

4. **Data issues consolidation (Proposal A):** Merging `/data-issues` and `/admin?tab=data-issues` requires moving a Server Action to a new context. Is this in scope for Batch 1 or deferred to a later batch?

5. **"/operations/intelligence" nav addition (Proposal B):** Confirm this page should be accessible directly from nav (sub-item under Vận hành) vs. remaining a secondary tool accessible only from within the operations flow.

---

*Audit complete. No application code was modified. No database operations were performed. All changes described above are deferred to Batch 1 pending owner approval.*

*File path: `docs/audits/VAM_OS_UI_LANGUAGE_AND_IA_2026-07-20.md`*
*Status: NOT COMMITTED — audit file only.*
