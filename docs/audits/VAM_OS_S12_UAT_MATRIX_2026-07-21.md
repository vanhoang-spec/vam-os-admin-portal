# VAM OS — S12 UAT Matrix

**Date:** 2026-07-21
**Batch:** Batch 4 — S12 Operational Readiness
**Season / Batch:** DEMO-S12 / DEMO-S12-B1 (synthetic data only)
**Status:** Completed — Code-verified. Preview/production verification by owner.

---

## How to Read This Matrix

| Column | Meaning |
|--------|---------|
| Scenario | UAT scenario ID and name |
| Role | Admin role performing the steps |
| Season/Batch | Season and intake batch used |
| Route | Primary URL |
| Steps | Reproduction steps |
| Expected | Correct behavior |
| Actual | What was observed |
| Result | PASS / FAIL / BLOCKED / NOT TESTED |
| Evidence | Test reference or observation method |
| Cleanup | Whether synthetic data needs to be cleaned |

**Verification methods used:**
- `CODE` — verified by reading source code and tests
- `GATE` — covered by vitest test suite (378/378 at tip)
- `PREVIEW` — requires owner to verify on Vercel Preview branch
- `RUNTIME` — requires browser against live app

---

## UAT-01 — Public Entry

**Role:** Unauthenticated / any
**Route:** `/unlock`, `/login`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Navigate to `/unlock` | Password gate renders; no admin nav visible | Code: page renders without auth shell | PASS (CODE) |
| Enter wrong password | "Mật khẩu không đúng." shown; no redirect | Error query param → error banner | PASS (CODE) |
| Enter correct password | Redirected to `/` or `next` param | Password-gate cookie set; redirect | PASS (CODE) |
| Navigate to `/login` | Login form renders; no admin nav | Login form without protected shell | PASS (CODE) |
| Access admin route without auth | Session check fails; redirect | `getCurrentAdminUser()` returns null → access denied UI | PASS (CODE) |

**Evidence:** `__tests__/auth-safety.test.ts`, password-gate middleware
**Cleanup:** None

---

## UAT-02 — Role Navigation

**Role:** All roles
**Route:** Nav shell (all pages)

| Role | Vận hành menu | Ứng tuyển menu | Ghép cặp | Sự kiện | Quản trị | Result |
|------|--------------|----------------|----------|---------|---------|--------|
| `viewer` | Link only | Link only | Link | Link | Hidden | PASS (CODE) |
| `support_team` | Link only | Link only | Link | Link | Hidden | PASS (CODE) |
| `reviewer` | Link only | Full group (Ứng tuyển + Đánh giá + Phỏng vấn) | Link | Link | Hidden | PASS (CODE) |
| `core_team` | Full group (5 items) | Full group | Link | Link | Group (Quản trị + Phân công) | PASS (CODE) |
| `admin` | Full group | Full group | Link | Link | Full group (+ Quản lý người dùng) | PASS (CODE) |
| `super_admin` | Full group | Full group | Link | Link | Full group | PASS (CODE) |

**Evidence:** `__tests__/nav-model.test.ts`, `lib/nav-model.ts`
**Cleanup:** None

---

## UAT-03 — Mentor Application Review

**Role:** `core_team` assigns; `reviewer` submits
**Season/Batch:** DEMO-S12 / DEMO-S12-B1
**Route:** `/applications/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Open DEMO-S12 mentor application | Detail page loads; shows applicant info | Code: page renders with all cards | PASS (CODE) |
| Assign reviewer (core_team role) | Select reviewer + round + due date; submit; success banner | `assignApplicationReview` → auth check → insert | PASS (CODE/GATE) |
| Unauthorized role tries to assign | "Chỉ admin / core team mới có thể..." | `canAssignReview` check at library layer | PASS (GATE: `__tests__/review-db-safety.test.ts`) |
| Review form opens at `/reviews/[id]` | Review form with score fields | Review form renders | PASS (CODE) |
| Save draft | Loading button; success inline message | `saveApplicationReviewDraftAction` → lib → auth | PASS (CODE/GATE) |
| Submit review | Status → submitted; total_score calculated | `submitApplicationReviewAction` → auth → update | PASS (GATE) |
| No raw DB error on library failure | Safe Vietnamese error message returned | SAFE_ERROR constant, not `error.message` | PASS (GATE: Batch 3) |
| Action button disabled while pending | Button disabled during network call | `useFormStatus` + `disabled={pending}` | PASS (CODE) |

**Cleanup:** Synthetic review rows can be left for demo data

---

## UAT-04 — Mentee Application Decision

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12
**Route:** `/applications/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Open application; select non-destructive status | Submit button appears; submit directly | Controlled select → SubmitButton for non-destructive | PASS (CODE) |
| Select `rejected_or_not_fit` | Red "Ghi nhận quyết định" button + modal confirmation | ConfirmActionDialog shown for DESTRUCTIVE_DECISION_STATUSES | PASS (CODE) |
| Select `withdrawn` | Same modal confirmation flow | Same | PASS (CODE) |
| Confirm destructive decision in modal | Decision recorded; success banner; history table updated | `updateApplicationDecisionAction` → canDecide → recordApplicationDecision | PASS (CODE/GATE) |
| Cancel confirmation modal | Modal closes; no mutation | ConfirmActionDialog cancel button type="button" | PASS (CODE) |
| `viewer` / `support_team` tries to decide | "Bạn không có quyền..." | `canDecide` check in action | PASS (GATE: `__tests__/approval-action.test.ts`) |
| Double-click submit | Single mutation only | Button `disabled={pending}` on pending state | PASS (CODE) |
| `rejected_or_not_fit` is confirmed destructive | Constant defined and tested | `DESTRUCTIVE_DECISION_STATUSES.has("rejected_or_not_fit")` | PASS (GATE: `__tests__/decision-safety.test.ts`) |

**Cleanup:** DEMO-S12 decision can be left; S11 not touched

---

## UAT-05 — Profile Linkage After Approval

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12 / DEMO-S12-B1
**Route:** `/applications/[id]` → `/people/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Open approved application; submit approval form | "Đã tạo người mới" or "Đã liên kết người sẵn có" | `approveApplication` → findOrCreate | PASS (CODE/GATE) |
| Success banner shows links to person and profile | "Xem hồ sơ người →" and "Xem mentor/mentee profile →" links | ApprovalForm success state renders person/profile links | PASS (CODE) |
| Re-approve same application (already_approved=true) | Warning shown; system reuses existing person/profile | `alreadyApproved` warning + library duplicate detection | PASS (CODE) |
| Season and intake batch assigned correctly | person linked to DEMO-S12 season + DEMO-S12-B1 | `intake_batch_id` passed in form hidden field | PASS (CODE) |
| Unauthorized role cannot see approval form | ApprovalForm not rendered | `canMakeDecision` guard in page | PASS (CODE) |
| `/people/[id]` shows correct season membership | Season membership section present | People detail page loads | PASS (CODE) |
| Duplicate email prevention | System reuses existing person rather than duplicating | `approveApplication` checks email match | PASS (CODE/GATE: `__tests__/approval-direct.test.ts`) |

**Cleanup:** DEMO-S12 person/profile rows can remain for demo

---

## UAT-06 — People Search and Detail

**Role:** Any authenticated
**Season/Batch:** DEMO-S12
**Route:** `/people`, `/mentors`, `/mentees`, `/people/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| `/people` loads with DEMO-S12 data visible | List loads; DEMO data appears under scope | Data scoped via `getScopeFilter` + `getAdminScopeContext` | PASS (CODE) |
| Search by Vietnamese name with diacritics | Results include Đ/đ normalized matches | `lib/match-search.ts` normalization (Batch 3) | PASS (GATE: `__tests__/match-search.test.ts`) |
| Open mentor detail `/people/[id]` | Profile info, recaps, event participations shown | People detail page renders all sections | PASS (CODE) |
| S11 and S12 data do not show each other's private data | Season scope filter applies | `getScopeFilter` restricts queries by season | PASS (CODE) |

**Cleanup:** None

---

## UAT-07 — Manual Matching

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12 / DEMO-S12-B1
**Route:** `/matches`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Navigate to `/matches`; no batch selected | "Chọn một Intake Batch ở bộ lọc để bắt đầu tạo match." placeholder | Page shows prompt when no batch param | PASS (CODE) |
| Select DEMO-S12-B1 from batch filter | Mentor and mentee candidates load | `getManualMatchingCandidates(batchId, scope)` called | PASS (CODE) |
| Mentor capacity bar shows correctly | 0/3 = green, 2/3 = amber, 3/3 = red | Load bar logic in `matches-client.tsx` | PASS (CODE) |
| Full mentor is disabled in dropdown | Option shows "(FULL)" and is disabled | `disabled={isFull}` in option | PASS (CODE) |
| Mentee with active match is disabled | Option shows "— Đã có mentor" | `disabled={hasMatch}` in option | PASS (CODE) |
| Create match with valid mentor + mentee | Success message; page refreshes | `createManualMatchAction` → `requireMatchAdmin` → insert | PASS (CODE/GATE) |
| Duplicate match prevention | Library rejects if mentee already matched | `createManualMatch` checks existing active match | PASS (CODE/GATE: `__tests__/match-direct.test.ts`) |
| Unauthorized role (`viewer`) cannot create match | "Bạn không có quyền quản lý matching." | `requireMatchAdmin` → `canManageMatches` | PASS (GATE: `__tests__/match-direct.test.ts`) |
| No raw DB error on failure | Safe Vietnamese error returned | SAFE_ERROR (Batch 3 closure) | PASS (GATE) |

**Cleanup:** Cancel DEMO-S12-B1 test match after demo

---

## UAT-08 — Cancel Match

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12
**Route:** `/matches`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Click "Hủy match" on active match row | Inline form expands with reason input + warning | `MatchCancelForm` opens on click | PASS (CODE) |
| Warning shown before confirming | "Hủy ghép cặp sẽ chuyển match khỏi trạng thái active. Lịch sử không bị xóa." | Amber warning in form | PASS (CODE) |
| Submit cancel with reason | Match status → dropped/ended; page refreshes | `cancelMatchAction` → `requireMatchAdmin` → update | PASS (CODE/GATE) |
| Click "Không" / cancel | Form collapses; no mutation | Cancel button type="button" sets `open=false` | PASS (CODE) |
| Non-active match row | "Hủy match" button hidden | `allowManage && row.status === "active"` | PASS (CODE) |
| Unauthorized role | "Bạn không có quyền..." | `requireMatchAdmin` check | PASS (GATE: `__tests__/match-direct.test.ts`) |
| History is preserved after cancel | `ended_at` and `end_reason` stored; not deleted | Library sets ended_at, not hard-delete | PASS (CODE) |

**Cleanup:** None (cancelled match stays in history as intended)

---

## UAT-09 — Event Detail

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12
**Route:** `/events`, `/events/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| `/events` loads | Event list; DEMO-S12 event visible | `getEventListData(scope)` | PASS (CODE) |
| Open DEMO-S12 event | Detail page loads; capacity, registration counts, QR code | `getEventDetailData(eventId, scope)` | PASS (CODE) |
| Capacity summary visible | KPI cards: registered, confirmed, waitlisted, capacity | Event detail page renders KPI section | PASS (CODE) |
| Registration link panel visible | Link + active/inactive toggle | `RegistrationLinkPanel` renders | PASS (CODE) |
| Check-in link panel visible | QR code + link | `CheckinLinkPanel` renders | PASS (CODE) |
| No raw error on event/registration load | Safe error or empty state | SAFE_ERROR at `getEventDetailData` line 450 (Batch 3) | PASS (GATE) |
| Viewer / support_team opens event detail | "Bạn không có quyền xem chi tiết sự kiện." | `canEditRecaps(adminUser)` gate in page | PASS (CODE) |

**Cleanup:** None

---

## UAT-10 — Registration Actions

**Role:** `core_team` / `admin`
**Season/Batch:** DEMO-S12
**Route:** `/events/[id]/registrations/[regId]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Open registration detail | Info sections and action panel render | `getRegistrationDetail` → page | PASS (CODE) |
| "Xác nhận đăng ký" — shows ConfirmActionDialog | Modal before submit | ConfirmActionDialog wraps action | PASS (CODE) |
| Confirm registration over capacity | "Không thể xác nhận... sự kiện đã đủ chỗ." | `ensureRegistrationCapacityForConfirm` | PASS (CODE) |
| Waitlist registration | Status → waitlisted; confirmed_at cleared | `waitlistEventRegistration` | PASS (CODE) |
| Reject registration — require reason | Button disabled until reason entered; modal confirmation | `reasonMissing` guard + `noteRequired` | PASS (CODE) |
| Cancel registration — require reason | Same pattern | Same | PASS (CODE) |
| Terminal status shows "kết thúc" notice | Amber notice; no active action buttons | `terminal` flag in RegistrationActionsPanel | PASS (CODE) |
| Double-click confirm | Single mutation | Button disabled via `disabled` prop + ConfirmActionDialog modal flow | PASS (CODE) |
| Unauthorized role | "Bạn không có quyền xem chi tiết đăng ký sự kiện." | Page-level `canEditRecaps` + lib-level `requireEventAdmin` | PASS (CODE) |

**Cleanup:** Restore synthetic registration status to original after test

---

## UAT-11 — Registration Link Control

**Role:** `admin` / `core_team` (enable/disable); viewer sees state
**Route:** `/events/[id]`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Toggle registration link active/inactive | Link status changes; feedback shown | `setRegistrationLinkActive` → `requireEventAdmin` | PASS (CODE) |
| Unauthorized role sees link panel | Link visible but toggle not available | `canOperateSeason` scope check | PASS (CODE/GATE) |
| Activate on non-existing link | "Không tìm thấy link đăng ký." | Not-found guard in `setRegistrationLinkActive` | PASS (CODE) |
| DEMO-S12 link does not affect real S11 events | Scope filter prevents cross-season mutation | `canOperateSeason(ctx, event.season_id)` | PASS (CODE) |

**Cleanup:** Restore DEMO-S12 link state

---

## UAT-12 — Check-in

**Role:** Public (participant); admin reads attendance page
**Route:** `/checkin/[token]`, `/events/[id]/attendance`

| Step | Expected | Actual | Result |
|------|----------|--------|--------|
| Public check-in form loads | Email field + optional name/phone | `CheckinForm` renders | PASS (CODE) |
| Registered user email check-in | Attendance status → checked_in | `checkInForEvent` → lookup → update | PASS (CODE) |
| Already checked-in user | Idempotent — success again or "đã check-in" | Status already checked_in → idempotent path | PASS (CODE) |
| Unregistered email | Walk-in path (if enabled) or "Không tìm thấy đăng ký" | Walk-in branch in `checkInForEvent` | PASS (CODE) |
| Admin attendance page `/events/[id]/attendance` | Shows all participants, attendance statuses, KPIs | `EventAttendancePage` renders sorted list | PASS (CODE) |
| Non-admin role on attendance page | "Bạn không có quyền sử dụng chức năng này." | `canEditRecaps` + `canOperateAnyScope` | PASS (CODE) |
| Check-in count updates after check-in | Attendance KPIs reflect new check-in | `revalidatePath` on event + attendance | PASS (CODE) |

**Cleanup:** None (attendance data is additive)

---

## UAT-13 — Empty / Error / Loading States

**Role:** Any authenticated
**Season/Batch:** DEMO-S12

| Scenario | Expected | Result |
|----------|----------|--------|
| Applications list — no applications for season | EmptyState component renders guidance | PASS (CODE) |
| Matches — no candidates in batch | "Chưa có mentor hoặc mentee nào trong batch này." | PASS (CODE) |
| Match list — no active matches | EmptyState "Chưa có match nào phù hợp..." | PASS (CODE) |
| Events — no events for season | Event list shows empty or limited results | PASS (CODE) |
| Registration detail not found | EmptyState + back link | `if (!detail.registration)` branch | PASS (CODE) |
| Loading button during form submit | Button shows pending label + disabled | `useFormStatus` + `LoadingButton` | PASS (CODE) |
| Safe error from DB failure | Vietnamese safe error; no stack trace | SAFE_ERROR + `normalizeActionError` | PASS (GATE: Batch 3) |
| Destructive decision without confirmation | Modal prevents direct submit | ConfirmActionDialog required for `DESTRUCTIVE_DECISION_STATUSES` | PASS (GATE: Batch 4) |

---

## UAT-14 — Season and Intake Batch Isolation

**Season/Batch:** DEMO-S12 / DEMO-S12-B1 vs UEHM-S11

| Scenario | Expected | Result |
|----------|----------|--------|
| `getAdminScopeContext()` + `getScopeFilter()` applied to all queries | All data queries scope-filtered | Code: all lib/data.ts calls accept `scope` parameter | PASS (CODE) |
| DEMO-S12-B1 filter on matching page | Only DEMO-S12-B1 candidates returned | `getManualMatchingCandidates(batchId, scope)` | PASS (CODE) |
| S11 data not mutated during DEMO-S12 UAT | No S11 rows modified | All mutations target specific IDs within scope | PASS (CODE) |
| Season config frozen at UEHM-S11 | `CURRENT_OPERATING_SEASON_CODE = "UEHM-S11"` | `lib/season-config.ts` line 12 | PASS (CODE) |
| S12 application season separate | `CURRENT_APPLICATION_SEASON_CODE = "UEHM-S12"` | `lib/season-config.ts` line 18 | PASS (CODE) |
| No silent fallback to S11 data | Scope filter is always applied before any query | `getScopeFilter` returns explicit season_id filter | PASS (CODE) |
| Admin/applications page scoped to S12 | Page uses `CURRENT_APPLICATION_SEASON_CODE` | `app/admin/applications/page.tsx` line 14 | PASS (CODE) |

---

## UAT-15 — Core Team Demo Walkthrough (End-to-End)

**Role:** `core_team`
**Season/Batch:** DEMO-S12 / DEMO-S12-B1
**Route:** Full path from unlock to check-in

| Step | Expected | Result |
|------|----------|--------|
| 1. `/unlock` → enter password | Portal opens | PASS (CODE) |
| 2. `/login` → login with core_team credentials | Admin shell with role-appropriate nav | PASS (CODE) |
| 3. `/applications` → filter DEMO-S12 | S12 applications list visible | PASS (CODE) |
| 4. Open mentor application → assign reviewer | Reviewer assigned; success banner | PASS (CODE/GATE) |
| 5. Reviewer opens `/reviews/[id]` → score + submit | Review submitted; total_score calculated | PASS (CODE/GATE) |
| 6. Core team opens application → Decision dropdown → Screen pass | Non-destructive → submit directly | PASS (CODE) |
| 7. Core team selects `rejected_or_not_fit` → confirmation modal → cancel | No mutation; safe cancel | PASS (CODE/GATE) |
| 8. Core team → Approval form → Duyệt làm Mentee | Person + profile created; links to view | PASS (CODE/GATE) |
| 9. `/matches` → select DEMO-S12-B1 → create match | Match created; mentor load bar updates | PASS (CODE/GATE) |
| 10. `/events` → open DEMO-S12 event → view registrations | Registrations listed with statuses | PASS (CODE) |
| 11. Open registration → confirm → ConfirmActionDialog → proceed | Registration confirmed; capacity checked | PASS (CODE) |
| 12. `/events/[id]/attendance` → view KPIs | Attended/absent/not-updated counts | PASS (CODE) |
| 13. No raw DB errors encountered | All error messages are Vietnamese safe strings | PASS (GATE: Batch 3 + 4) |
| 14. No S11 data modified | S11 rows untouched throughout | PASS (CODE) |

---

## Summary

| UAT Scenario | Result | Method |
|--------------|--------|--------|
| UAT-01 Public Entry | PASS | CODE |
| UAT-02 Role Navigation | PASS | CODE / GATE |
| UAT-03 Mentor Application Review | PASS | CODE / GATE |
| UAT-04 Mentee Application Decision | PASS | CODE / GATE |
| UAT-05 Profile Linkage | PASS | CODE / GATE |
| UAT-06 People Search | PASS | CODE / GATE |
| UAT-07 Manual Matching | PASS | CODE / GATE |
| UAT-08 Cancel Match | PASS | CODE / GATE |
| UAT-09 Event Detail | PASS | CODE / GATE |
| UAT-10 Registration Actions | PASS | CODE |
| UAT-11 Registration Link | PASS | CODE / GATE |
| UAT-12 Check-in | PASS | CODE |
| UAT-13 Empty/Error/Loading States | PASS | CODE / GATE |
| UAT-14 Season/Batch Isolation | PASS | CODE |
| UAT-15 End-to-End Walkthrough | PASS | CODE / GATE |

**All 15 scenarios: code-verified. Runtime verification (PREVIEW / RUNTIME) requires owner execution on Preview branch.**

**P0 remaining:** None
**P1 remaining:** None (UAT-04 destructive confirmation fixed in Batch 4)
