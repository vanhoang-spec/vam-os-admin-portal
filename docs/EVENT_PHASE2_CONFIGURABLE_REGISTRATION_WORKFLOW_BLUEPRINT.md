# VAM OS — Event Phase 2: Configurable Registration & Check-in Workflow Blueprint

**Version:** 1.0  
**Date:** 2026-05-13  
**Status:** Design / Pre-implementation — no code or migrations applied  
**Author:** VAM OS design session  
**Do not:** edit code, run migrations, deploy, push to production, use git add .

---

## Table of Contents

1. [Current Module Assessment](#1-current-module-assessment)
2. [Proposed Per-Event Configuration Fields](#2-proposed-per-event-configuration-fields)
3. [Proposed event_registrations Fields](#3-proposed-event_registrations-fields)
4. [Status Model](#4-status-model)
5. [Check-in Rules Engine](#5-check-in-rules-engine)
6. [User Flows](#6-user-flows)
7. [UI Implications](#7-ui-implications)
8. [Security and Privacy](#8-security-and-privacy)
9. [Recommended Implementation Phases](#9-recommended-implementation-phases)
10. [Production Rollout Plan](#10-production-rollout-plan)
11. [Open Questions for Anh Thắng / Coreteam](#11-open-questions-for-anh-thắng--coreteam)

---

## 1. Current Module Assessment

### 1.1 What the Event MVP Already Supports

The production Event module (Phases 045A–045B) currently provides:

**Event management:**
- Create, edit, cancel events
- Link events to a season (`season_id`) and optionally an intake batch (`intake_batch_id`)
- Event types: orientation, training, kickoff, company_tour, networking, closing, business_case, job_shadowing, other
- Event status: active / cancelled

**Public links:**
- Token-based registration link (`event_links.link_type = 'registration'`) with time-window (`opens_at` / `closes_at`) and toggle (`is_active`)
- Token-based check-in link (`event_links.link_type = 'checkin'`) with same window controls
- QR code generated from check-in URL and displayed in admin detail page

**Public registration form (current fields):**
- Full name (required), email (required), phone, student_id, school, program_of_study, role_text, notes, consent_given checkbox
- Duplicate detection by email (blocks re-submission)
- Auto-matches registrant to `people` table by exact email
- All registrations recorded with `registration_status = 'registered'` immediately (no review step)

**Public check-in form:**
- Email (required), full name, phone, student_id, notes
- If email matches an existing registration: updates `attendance_status = 'checked_in'`
- If email does NOT match: creates a new walk-in registration record with `is_walk_in = true`
- No check on whether walk-in is allowed or whether the registrant was confirmed

**Admin features:**
- Events list page with filters (season, type, batch, status)
- Event detail page: registration list, KPI cards (registrations, checked-in, walk-in, pending match review), registration link panel, check-in QR panel
- Attendance management page: add individual participants, bulk add from intake batch, update attendance status, remove participants
- Quick-mark attendance status
- Admin audit log (`admin_audit_log`) and correction log (`activity_correction_log`)

**Access control:**
- Full season-scoped access control; admins can only manage events in their allowed season(s)
- `canEditRecaps` permission gate for all event write operations

### 1.2 What the MVP Does NOT Yet Support

| Missing capability | Business case |
|---|---|
| `registration_required` for check-in | UEH trainings: only registered students should be able to check in |
| `approval_required` for registration | Limited-capacity trainings need admin review before confirming slots |
| Capacity limit | "WORK READY #01": 90 students max |
| Waitlist | Overflow handling when capacity is full |
| `allow_walk_in` toggle | Disable walk-in for confirmed-only events |
| Per-event check-in mode | Some events open to all; others confirmed-only |
| Check-in window (`checkin_opens_at` / `checkin_closes_at`) | Check-in starts before event time but not too early |
| Proof/screenshot submission | Completion of steps 1 & 2 required before registration |
| Mentee code field (`mentee_code`) | UEH-specific identity field |
| Speaker/organizer question field | Collect pre-event questions for speakers |
| No-show policy display | Warn registrants about blacklist consequence |
| Admin confirm/reject/waitlist registration | Review workflow for approval-required events |
| Payment proof collection | Hiking, company visits, transport-fee events |
| Payment confirmation workflow | Admin review of payment proof |
| Proof review workflow | Accept/reject submitted proof |
| `no_show` flagging | Post-event marking of absent confirmed registrants |
| Blacklist flag | Consequence of repeated no-shows |
| Post-event feedback form | Phase 2C capability |

### 1.3 Current Production Safety Considerations

1. **`event_registrations` table exists in production with real data.** All Phase 2 schema changes must be purely additive — new nullable columns only. No column renames, no type changes, no NOT NULL constraints on existing columns.
2. **`events` table is the config anchor.** New per-event config fields go on the `events` table (or a separate `event_config` table — see Section 9.1). All new columns must be nullable with safe defaults.
3. **`event_links` table controls public access windows.** Check-in window fields (`checkin_opens_at`, `checkin_closes_at`) belong here as they are per-link, not per-event globally. Or alternatively as new columns on `events` with a separate `checkin_window_enabled` flag.
4. **`lib/events.ts` — the public check-in function (`checkInForEvent`) does not validate registration status or capacity.** Any check-in mode enforcement must be added here without breaking the existing open check-in behavior for events that do not enable the new config.
5. **Feature flags default to disabled.** Every new config field defaults to `false` / `null` so that existing events continue working exactly as before.
6. **No migration runs until staging QA passes.** All schema design in this document is for planning only.

---

## 2. Proposed Per-Event Configuration Fields

These fields extend the `events` table (or a companion `event_config` table — see Section 9 for the decision). All fields are nullable and default to `false` or `null` so existing events are unaffected.

### 2.1 Registration Mode

| Column | Type | Default | Description |
|---|---|---|---|
| `registration_required` | `boolean` | `false` | If `true`, only people with a non-cancelled registration record may check in. Walk-in is blocked unless `allow_walk_in = true`. |
| `approval_required` | `boolean` | `false` | If `true`, new registrations start with `registration_status = 'pending_review'` instead of `'registered'`. Admins must manually confirm, reject, or waitlist. |

### 2.2 Capacity and Waitlist

| Column | Type | Default | Description |
|---|---|---|---|
| `capacity_limit_enabled` | `boolean` | `false` | Master toggle for capacity enforcement. |
| `capacity_limit` | `integer` | `null` | Maximum number of confirmed registrants. Enforced when `capacity_limit_enabled = true`. |
| `waitlist_enabled` | `boolean` | `false` | If `true` and capacity is full, new registrations automatically get `registration_status = 'waitlisted'` instead of being rejected outright. |

### 2.3 Walk-in Policy

| Column | Type | Default | Description |
|---|---|---|---|
| `allow_walk_in` | `boolean` | `true` | If `false`, the check-in form will not create a new walk-in registration. The participant must have pre-registered. |

### 2.4 Check-in Mode

| Column | Type | Default | Description |
|---|---|---|---|
| `checkin_mode` | `text` | `'open'` | Controls who may check in at the door. Enum values defined below. |

**`checkin_mode` values:**

| Value | Meaning |
|---|---|
| `open` | Anyone who knows the check-in URL may check in. Walk-in records created automatically. Current production behavior. |
| `registration_required` | Participant must have a registration record (any `registration_status` except `cancelled`). Walk-in blocked. |
| `confirmed_only` | Participant must have `registration_status = 'confirmed'`. Pending-review and waitlisted are blocked. |
| `manual_admin_only` | QR/public check-in is entirely disabled. Only admins can mark attendance via admin portal. |

### 2.5 Check-in Window

| Column | Type | Default | Description |
|---|---|---|---|
| `checkin_window_enabled` | `boolean` | `false` | If `true`, enforce `checkin_opens_at` and `checkin_closes_at`. |
| `checkin_opens_at` | `timestamptz` | `null` | Check-in window start. If `null` and window is enabled, check-in is open immediately. |
| `checkin_closes_at` | `timestamptz` | `null` | Check-in window end. If `null` and window is enabled, no close time is enforced. |

> **Note:** The existing `event_links.opens_at` and `closes_at` control when the public link is accessible at all. `checkin_opens_at` / `checkin_closes_at` are a second, finer-grained layer for the check-in action specifically (e.g., link accessible but check-in not started yet).

### 2.6 Proof Submission

| Column | Type | Default | Description |
|---|---|---|---|
| `proof_required` | `boolean` | `false` | Master toggle for proof collection. |
| `proof_label` | `text` | `null` | Custom label shown above proof field. e.g., "Ảnh chụp màn hình xác nhận đã hoàn thành Steps 1 & 2". |
| `proof_description` | `text` | `null` | Helper text explaining what proof is required. Shown below the field. |
| `proof_required_for_registration` | `boolean` | `false` | If `true`, proof must be submitted at registration time. |
| `proof_required_for_checkin` | `boolean` | `false` | If `true`, proof must be submitted at check-in time (separate from registration). |

> **Implementation note:** In Phase 2A, proof is collected as a URL (external link) submitted via a text input field. File upload via Supabase Storage is Phase 2D.

### 2.7 Speaker/Organizer Question

| Column | Type | Default | Description |
|---|---|---|---|
| `question_collection_enabled` | `boolean` | `false` | If `true`, a question-to-speaker textarea appears in the registration form. |
| `speaker_question_label` | `text` | `null` | Custom label for the question field. e.g., "Câu hỏi dành cho diễn giả / ban tổ chức". |

### 2.8 No-show Policy

| Column | Type | Default | Description |
|---|---|---|---|
| `no_show_policy_enabled` | `boolean` | `false` | If `true`, display `no_show_policy_text` prominently on the registration form. |
| `no_show_policy_text` | `text` | `null` | Policy text. e.g., "Học viên đã đăng ký và xác nhận nhưng không tham dự có thể bị đưa vào danh sách hạn chế tham gia các hoạt động tiếp theo." |

### 2.9 Fee and Payment

| Column | Type | Default | Description |
|---|---|---|---|
| `fee_required` | `boolean` | `false` | Master toggle for payment requirement. |
| `fee_amount` | `numeric(10,2)` | `null` | Fee amount. |
| `fee_currency` | `text` | `'VND'` | Currency code. |
| `fee_description` | `text` | `null` | What the fee covers. e.g., "Phí xe + ăn trưa cho chuyến company visit". |
| `payment_instruction` | `text` | `null` | How to pay. e.g., bank account number, QR code description, contact person. |
| `payment_proof_required` | `boolean` | `false` | If `true`, registrant must submit payment proof (URL or file) to complete registration. |

### 2.10 Field Visibility Controls (per event)

These control which fields appear in the public registration form for this specific event.

| Column | Type | Default | Description |
|---|---|---|---|
| `show_student_id_field` | `boolean` | `true` | Show/hide MSSV field. |
| `student_id_required` | `boolean` | `false` | Make MSSV required if shown. |
| `show_mentee_code_field` | `boolean` | `false` | Show/hide VAM mentee code field. |
| `mentee_code_required` | `boolean` | `false` | Make mentee code required if shown. |
| `show_school_field` | `boolean` | `true` | Show/hide school field. |
| `show_program_field` | `boolean` | `true` | Show/hide program of study field. |
| `show_role_text_field` | `boolean` | `false` | Show/hide role/group field. |
| `show_notes_field` | `boolean` | `true` | Show/hide general notes field. |

### 2.11 Event Description (public-facing)

| Column | Type | Default | Description |
|---|---|---|---|
| `event_description` | `text` | `null` | Long-form event description shown on the public registration and check-in pages. Replaces/supplements `source_notes` for public display. |

---

## 3. Proposed event_registrations Fields

All new columns are nullable with safe defaults. The existing columns are preserved exactly.

### 3.1 Existing Fields (Production — Do Not Change)

```
id, event_id, event_link_id, linked_person_id,
full_name, email, phone, student_id, school, program_of_study,
role_text, notes, consent_given, registration_source,
registration_status, attendance_status, is_walk_in,
registered_at, checked_in_at, checkin_source,
match_method, match_review_status, matched_at,
created_at, updated_at
```

### 3.2 New Identity Fields

| Column | Type | Default | Notes |
|---|---|---|---|
| `mentee_code` | `text` | `null` | VAM-assigned mentee code. Collected only when `show_mentee_code_field = true`. |

### 3.3 Proof Fields

| Column | Type | Default | Notes |
|---|---|---|---|
| `proof_url` | `text` | `null` | URL submitted by registrant as proof. Phase 2A. |
| `proof_file_url` | `text` | `null` | Signed URL if uploaded to Supabase Storage. Phase 2D. |
| `proof_note` | `text` | `null` | Optional note accompanying the proof submission. |
| `proof_status` | `text` | `'not_required'` | See status model. |
| `proof_reviewed_at` | `timestamptz` | `null` | When an admin reviewed the proof. |
| `proof_reviewed_by` | `uuid` | `null` | FK → `admin_users.id`. |
| `proof_review_note` | `text` | `null` | Reason for accepting or rejecting proof. |

### 3.4 Speaker Question Field

| Column | Type | Default | Notes |
|---|---|---|---|
| `speaker_question` | `text` | `null` | Registrant's question for speaker/organizer. |

### 3.5 Admin Review Fields

| Column | Type | Default | Notes |
|---|---|---|---|
| `review_status` | `text` | `'not_required'` | Workflow status for approval-required events. `not_required` | `pending` | `approved` | `rejected`. |
| `review_note` | `text` | `null` | Admin note when confirming or rejecting. |
| `confirmed_at` | `timestamptz` | `null` | When admin confirmed this registration. |
| `confirmed_by` | `uuid` | `null` | FK → `admin_users.id`. |
| `waitlisted_at` | `timestamptz` | `null` | When this registration was moved to waitlist. |
| `rejected_at` | `timestamptz` | `null` | When this registration was rejected. |

### 3.6 Payment Fields

| Column | Type | Default | Notes |
|---|---|---|---|
| `payment_status` | `text` | `'not_required'` | See status model. |
| `payment_proof_url` | `text` | `null` | URL of payment proof (Phase 2A: link; Phase 2D: signed URL). |
| `payment_proof_note` | `text` | `null` | Registrant's note accompanying payment proof. |
| `payment_confirmed_at` | `timestamptz` | `null` | When admin confirmed payment. |
| `payment_confirmed_by` | `uuid` | `null` | FK → `admin_users.id`. |
| `payment_rejected_at` | `timestamptz` | `null` | When admin rejected payment proof. |
| `payment_rejected_by` | `uuid` | `null` | FK → `admin_users.id`. |
| `payment_rejection_note` | `text` | `null` | Reason for rejecting payment. |

### 3.7 No-show / Blacklist Fields

| Column | Type | Default | Notes |
|---|---|---|---|
| `no_show_flagged` | `boolean` | `false` | Set to `true` by admin post-event for confirmed-but-absent registrants. |
| `no_show_flagged_at` | `timestamptz` | `null` | When the flag was set. |
| `no_show_flagged_by` | `uuid` | `null` | FK → `admin_users.id`. |
| `blacklist_flag` | `boolean` | `false` | Escalation from `no_show_flagged`. Requires manual admin action. |
| `blacklist_note` | `text` | `null` | Reason for blacklist flag. |

---

## 4. Status Model

### 4.1 `registration_status`

Controls whether the registrant has a slot at the event.

| Value | Meaning |
|---|---|
| `registered` | Default for open events. Registration accepted, no review needed. |
| `pending_review` | Submitted; awaiting admin confirmation. Used when `approval_required = true`. |
| `confirmed` | Admin confirmed. Required for `checkin_mode = 'confirmed_only'`. |
| `waitlisted` | Capacity full; on waitlist. May be promoted to `confirmed` if a slot opens. |
| `rejected` | Admin rejected. Registrant may not attend. |
| `cancelled` | Registrant or admin cancelled. Excluded from capacity count and check-in. |

**Valid transitions (admin-driven):**

```
pending_review → confirmed
pending_review → rejected
pending_review → waitlisted
registered    → confirmed (manual upgrade, e.g., after proof accepted)
registered    → cancelled
confirmed     → cancelled
waitlisted    → confirmed (when capacity opens)
waitlisted    → rejected
waitlisted    → cancelled
rejected      → (terminal — can be reopened only by super_admin)
```

### 4.2 `attendance_status`

Controls what happened at the event.

| Value | Meaning |
|---|---|
| `pending` | Registered but not yet checked in. Default at registration time. |
| `checked_in` | Checked in (self QR, admin manual, or admin portal). |
| `no_show` | Was confirmed/registered but did not attend. Set post-event by admin. |
| `cancelled` | Attendance cancelled (mirrors registration_status = cancelled). |

**Valid transitions:**

```
pending    → checked_in (check-in action)
pending    → no_show    (admin post-event action)
pending    → cancelled
checked_in → (terminal; admin can reverse to pending if error)
no_show    → pending    (admin correction)
```

### 4.3 `payment_status`

| Value | Meaning |
|---|---|
| `not_required` | Event has no fee. Default. |
| `pending` | Fee required; payment proof not yet submitted. |
| `submitted` | Registrant submitted proof; awaiting admin confirmation. |
| `confirmed` | Admin confirmed payment. |
| `rejected` | Admin rejected proof (wrong amount, unclear screenshot, etc.). Registrant should resubmit. |

**Valid transitions:**

```
not_required → (terminal; set by event config, not user action)
pending      → submitted (registrant action)
submitted    → confirmed (admin action)
submitted    → rejected  (admin action)
rejected     → submitted (registrant resubmits)
confirmed    → (terminal; admin can reverse in exceptional cases)
```

### 4.4 `proof_status`

Applies to the activity/training proof (e.g., screenshot of steps completed), separate from payment proof.

| Value | Meaning |
|---|---|
| `not_required` | Event does not require proof. Default. |
| `submitted` | Proof URL or file submitted by registrant. |
| `accepted` | Admin accepted the proof as valid. |
| `rejected` | Admin rejected. Registrant should resubmit. |

**Valid transitions:**

```
not_required → (terminal)
submitted    → accepted  (admin action)
submitted    → rejected  (admin action)
rejected     → submitted (registrant resubmits)
accepted     → (terminal; admin can reverse in exceptional cases)
```

### 4.5 `review_status`

Tracks the admin review workflow independently of `registration_status` for clarity in the UI.

| Value | Meaning |
|---|---|
| `not_required` | No review needed for this registration (open event). |
| `pending` | Awaiting admin review. |
| `approved` | Admin approved. Maps to `registration_status = 'confirmed'`. |
| `rejected` | Admin rejected. Maps to `registration_status = 'rejected'`. |

> **Note:** `review_status` is denormalized for UI convenience. The canonical source of truth for access decisions is `registration_status`. On every admin review action, both columns must be updated atomically.

---

## 5. Check-in Rules Engine

The `checkInForEvent()` function in `lib/events.ts` must evaluate rules in this order before allowing check-in.

### 5.1 Pre-flight checks (all modes)

1. **Token validity** — valid UUID, `event_links` row exists, `link_type = 'checkin'`.
2. **Link active** — `event_links.is_active = true`.
3. **Link time window** — `opens_at` / `closes_at` from `event_links` (existing behavior).
4. **Event status** — `events.status != 'cancelled'`.
5. **Event exists** — `events` row exists for this link.

### 5.2 Check-in window validation (new)

If `checkin_window_enabled = true` on the event:
- If `checkin_opens_at` is set and `now < checkin_opens_at`: return `{ status: 'checkin_not_open', message: 'Check-in chưa bắt đầu. Vui lòng quay lại đúng giờ.' }`
- If `checkin_closes_at` is set and `now > checkin_closes_at`: return `{ status: 'checkin_closed', message: 'Check-in đã kết thúc.' }`

### 5.3 Mode-specific check-in rules

**`open` (default — existing behavior):**
- Any email may check in.
- If email matches existing registration: update to `checked_in`.
- If no match and `allow_walk_in = true`: create new walk-in record.
- If no match and `allow_walk_in = false`: return `{ status: 'walk_in_blocked', message: 'Bạn chưa đăng ký trước. Sự kiện này không nhận walk-in.' }`

**`registration_required`:**
- Look up registration by email (`registration_status != 'cancelled'`).
- If no registration found: return `{ status: 'not_registered', message: 'Email của bạn chưa có trong danh sách đăng ký. Vui lòng đăng ký trước.' }`
- If found: allow check-in (any `registration_status` except `cancelled`).
- Walk-in blocked regardless of `allow_walk_in`.

**`confirmed_only`:**
- Look up registration by email (`registration_status = 'confirmed'`).
- If not found: determine why and return the most helpful message:
  - No registration at all: `{ status: 'not_registered', message: 'Bạn chưa đăng ký sự kiện này.' }`
  - Registered but `pending_review`: `{ status: 'not_confirmed', message: 'Đăng ký của bạn đang chờ xác nhận từ ban tổ chức. Vui lòng chờ email xác nhận.' }`
  - Registered but `waitlisted`: `{ status: 'waitlisted', message: 'Bạn đang trong danh sách dự phòng. Vui lòng liên hệ ban tổ chức.' }`
  - Registered but `rejected`: `{ status: 'rejected', message: 'Đăng ký của bạn đã bị từ chối. Vui lòng liên hệ ban tổ chức.' }`
- Walk-in blocked regardless of `allow_walk_in`.

**`manual_admin_only`:**
- Return immediately: `{ status: 'self_checkin_disabled', message: 'Sự kiện này không hỗ trợ tự check-in. Vui lòng liên hệ ban tổ chức tại sự kiện.' }`
- No registration lookup performed.

### 5.4 Duplicate check-in blocking (all modes)

After registration is found (or created for walk-in), before updating:
- If `attendance_status = 'checked_in'`: return `{ status: 'already_checked_in', message: 'Bạn đã check-in sự kiện này rồi.' }` (friendly, not an error)

### 5.5 Capacity validation at check-in (new)

If `capacity_limit_enabled = true` and `checkin_mode` is `open` or `registration_required` (walk-in scenarios):
- Count active confirmed + checked-in registrations.
- If count >= `capacity_limit`:
  - For existing registrants: allow check-in (they hold a slot).
  - For walk-in attempts: return `{ status: 'event_full', message: 'Sự kiện đã đủ chỗ. Không thể check-in walk-in.' }`

> **Note:** Capacity enforcement at registration time (pre-event) is more important and is handled in the registration workflow (Section 6.2). Capacity at check-in time only blocks new walk-in creations.

### 5.6 Walk-in validation (new)

- Only create walk-in if `allow_walk_in = true` AND `checkin_mode = 'open'`.
- Walk-in full name is required (existing behavior).
- Walk-in capacity is subject to Section 5.5.

---

## 6. User Flows

### 6.1 Flow A — Normal Open Event (Current Behavior — No Changes Needed)

Config: `registration_required = false`, `approval_required = false`, `capacity_limit_enabled = false`, `checkin_mode = 'open'`, `allow_walk_in = true`

```
Registrant → Opens registration link
           → Fills name + email (+ optional fields)
           → Submits
           → registration_status: 'registered', attendance_status: 'pending'
           → No admin action needed

Day-of → Opens QR check-in link / scans QR
       → Enters email
       → If registered: attendance_status → 'checked_in'
       → If not registered: walk-in record created, attendance_status = 'checked_in'
```

### 6.2 Flow B — Limited-Capacity Event

Config: `approval_required = false` OR `approval_required = true`, `capacity_limit_enabled = true`, `capacity_limit = 90`, `waitlist_enabled = true`, `checkin_mode = 'registration_required'` or `'confirmed_only'`

```
Registration flow:
  Count current confirmed/registered (non-cancelled) registrations.
  If count < capacity_limit:
    → Create registration with registration_status = 'registered' (or 'pending_review' if approval_required)
  Else if waitlist_enabled:
    → Create registration with registration_status = 'waitlisted'
    → Show message: "Bạn đã vào danh sách chờ. Ban tổ chức sẽ liên hệ nếu có chỗ trống."
  Else:
    → Block registration: "Sự kiện đã đủ chỗ. Đăng ký đã đóng."

Admin waitlist management:
  If a confirmed registrant cancels:
    → Admin manually promotes first waitlisted → 'confirmed' or 'registered'
    → (Phase 2B: bulk promote, auto-notify by email — Phase 2C/3)

Check-in:
  If checkin_mode = 'confirmed_only':
    → Only 'confirmed' registrants may check in
  If checkin_mode = 'registration_required':
    → Any registered (non-cancelled) may check in
  Walk-in always blocked when capacity is full
```

### 6.3 Flow C — Approval-Required Training (e.g., UEH Mentoring Training)

Config: `approval_required = true`, `registration_required = true`, `checkin_mode = 'confirmed_only'`, `allow_walk_in = false`

```
Registrant:
  → Fills registration form
  → registration_status: 'pending_review', attendance_status: 'pending'
  → Sees message: "Đăng ký của bạn đã được ghi nhận. Ban tổ chức sẽ xác nhận trong thời gian sớm nhất."

Admin review:
  → Opens admin event detail → Registration review table
  → Sees list of pending_review registrations
  → For each: [Xác nhận] [Từ chối] [Waitlist] buttons
  → Confirm: registration_status → 'confirmed', review_status → 'approved', confirmed_at + confirmed_by set
  → Reject: registration_status → 'rejected', review_status → 'rejected', review_note required
  → Waitlist: registration_status → 'waitlisted'

Day-of check-in:
  → Registrant scans QR, enters email
  → System checks registration_status = 'confirmed'
  → If confirmed: check-in succeeds
  → If pending/waitlisted: "Đăng ký chưa được xác nhận."
  → If rejected: "Đăng ký của bạn đã bị từ chối."
  → If not registered at all: "Bạn chưa đăng ký sự kiện này."
```

### 6.4 Flow D — Training Requiring Proof (Screenshot of Steps 1 & 2)

Config: `proof_required = true`, `proof_required_for_registration = true`, `proof_label = "Ảnh chụp màn hình xác nhận Step 1 & Step 2"`, `proof_description = "Vui lòng hoàn thành Steps 1 & 2 và chụp màn hình xác nhận..."`, `approval_required = true`

```
Registrant:
  → Opens registration form
  → Sees proof field with custom label + description
  → Submits proof URL (link to Google Drive, Facebook post, etc.)
  → proof_status: 'submitted'
  → registration_status: 'pending_review'

Admin:
  → Opens registration → sees proof_url column
  → Clicks link to verify proof
  → [Chấp nhận bằng chứng] → proof_status: 'accepted'
  → [Từ chối bằng chứng] + note → proof_status: 'rejected', registration_status stays 'pending_review'
  → After proof accepted, admin can confirm: registration_status → 'confirmed'

If proof rejected:
  → Registrant needs to resubmit (Phase 2B: email notification; Phase 2A: registrant must contact admin)
  → Admin can update proof_url manually in admin portal (Phase 2B: self-service resubmit)
```

### 6.5 Flow E — Paid Event (e.g., Event with Registration Fee)

Config: `fee_required = true`, `fee_amount = 50000`, `fee_currency = 'VND'`, `fee_description = "Phí xe + ăn trưa"`, `payment_instruction = "Chuyển khoản vào tài khoản ABC..."`, `payment_proof_required = true`, `approval_required = true`

```
Registrant:
  → Opens registration form
  → Sees fee amount + payment instructions
  → After submitting, prompted to upload payment proof URL
  → payment_status: 'submitted' (or 'pending' if proof not yet submitted)
  → registration_status: 'pending_review'

Admin:
  → Opens payment review table
  → Views payment_proof_url, checks amount
  → [Xác nhận thanh toán] → payment_status: 'confirmed', payment_confirmed_at + payment_confirmed_by set
  → [Từ chối] + note → payment_status: 'rejected', registrant must resubmit
  → After payment confirmed, admin confirms registration: registration_status → 'confirmed'
  
Rule: Registration cannot be confirmed while payment_status = 'pending' or 'rejected'.
Admin UI enforces this: "Xác nhận" button disabled until payment_status = 'confirmed'.
```

### 6.6 Flow F — Company Visit / Hiking / Transport-Fee Event

Same as Flow E with additional context:

```
Config: fee_required = true, payment_proof_required = true
Additional: event_description field includes logistics information (meeting point, time, what to bring)

The registration form shows:
  → Event description section (markdown-rendered or plain text)
  → Fee amount + payment instructions
  → Payment proof URL field
  → Consent checkbox updated to include fee acknowledgment

Admin:
  → Confirms payment → confirms registration
  → Confirmed list = final participant list for logistics planning
  → Post-event: marks no-show for any confirmed registrant who did not attend
```

### 6.7 Flow G — No-show / Blacklist Flag Workflow

```
Pre-event setup:
  Admin sets no_show_policy_enabled = true on the event
  Registrants see policy warning in the registration form and confirmation

Day-of event:
  Confirmed registrants who do not check in → attendance_status remains 'pending'

Post-event:
  Admin reviews confirmed registrants with attendance_status = 'pending'
  For each: [Đánh dấu vắng mặt]
  → attendance_status: 'no_show'
  → no_show_flagged: true, no_show_flagged_at, no_show_flagged_by set

Escalation (optional, manual):
  Admin reviews no_show_flagged registrants across multiple events
  If pattern of no-shows detected:
  → blacklist_flag: true, blacklist_note filled
  → This is a manual decision; no automatic blacklisting in Phase 2

CRM integration (Phase 3+):
  no_show_flagged → creates a system note on the person's CRM record
  blacklist_flag  → creates a high-visibility CRM note with tag 'no_show_risk'
  These integrate with the CRM/Relationship History Blueprint
```

---

## 7. UI Implications

### 7.1 Admin Event Create/Edit Form

Add a new collapsible section **"Cấu hình đăng ký & check-in"** after the existing basic fields.

**Registration settings subsection:**
- Toggle: `registration_required` — "Yêu cầu đăng ký trước để check-in"
- Toggle: `approval_required` — "Xét duyệt đăng ký trước khi xác nhận"
- Toggle: `allow_walk_in` — "Cho phép walk-in (check-in không cần đăng ký trước)"

**Capacity subsection:**
- Toggle: `capacity_limit_enabled`
- Number input: `capacity_limit` (shown only when toggle is on)
- Toggle: `waitlist_enabled` (shown only when `capacity_limit_enabled` is on)

**Check-in mode subsection:**
- Select: `checkin_mode` — Open / Yêu cầu đăng ký / Chỉ đã xác nhận / Chỉ admin

**Check-in window subsection:**
- Toggle: `checkin_window_enabled`
- Datetime: `checkin_opens_at` (shown when toggle on)
- Datetime: `checkin_closes_at` (shown when toggle on)

**Proof collection subsection:**
- Toggle: `proof_required`
- Text: `proof_label` (shown when toggle on)
- Textarea: `proof_description` (shown when toggle on)
- Toggle: `proof_required_for_registration`
- Toggle: `proof_required_for_checkin`

**Question collection subsection:**
- Toggle: `question_collection_enabled`
- Text: `speaker_question_label` (shown when toggle on)

**No-show policy subsection:**
- Toggle: `no_show_policy_enabled`
- Textarea: `no_show_policy_text` (shown when toggle on)

**Fee subsection:**
- Toggle: `fee_required`
- Number: `fee_amount` (shown when toggle on)
- Text: `fee_currency` — default VND
- Textarea: `fee_description` (shown when toggle on)
- Textarea: `payment_instruction` (shown when toggle on)
- Toggle: `payment_proof_required` (shown when toggle on)

**Form fields subsection:**
- Toggles for each optional field: student_id, mentee_code, school, program_of_study, role_text, notes
- Required toggles for student_id and mentee_code when shown

**Event description:**
- Textarea: `event_description` (shown on public form, supports multi-line)

### 7.2 Admin Event Detail Page — Registration Review Table

The existing registration list (`Danh sách đăng ký & check-in`) expands into a full review table when `approval_required = true` or `proof_required = true` or `fee_required = true`.

**New columns in the table:**
- Registration status badge (color-coded: pending_review = amber, confirmed = green, waitlisted = blue, rejected = red, cancelled = grey)
- Proof status badge + link (if `proof_required`)
- Payment status badge + link (if `fee_required`)
- Speaker question snippet (if `question_collection_enabled`)
- Action buttons (see Section 7.3)

**Capacity summary bar (when `capacity_limit_enabled = true`):**
```
Đã xác nhận: 72 / 90  |  Đang chờ duyệt: 5  |  Danh sách dự phòng: 3  |  Đã check-in: 68
```

**Filter tabs (when approval workflow active):**
- Tất cả | Chờ duyệt | Đã xác nhận | Đang chờ | Từ chối | Đã hủy

### 7.3 Admin Action Buttons (per-registration row)

These are contextual — only visible when the relevant config is active.

**Registration management:**
- `[Xác nhận]` — Confirm registration (pending_review → confirmed). Only when `approval_required = true` and status is `pending_review`.
- `[Từ chối]` — Reject with required note. Opens inline text input for `review_note`.
- `[Chuyển vào danh sách dự phòng]` — Move to waitlist.
- `[Hủy đăng ký]` — Cancel (any status).

**Proof review:**
- `[Xem bằng chứng →]` — External link to `proof_url`. Opens in new tab.
- `[Chấp nhận bằng chứng]` — Set `proof_status = 'accepted'`. Only when `proof_status = 'submitted'`.
- `[Từ chối bằng chứng]` — Set `proof_status = 'rejected'` with optional `proof_review_note`.

**Payment review:**
- `[Xem bằng chứng thanh toán →]` — External link to `payment_proof_url`.
- `[Xác nhận thanh toán]` — Set `payment_status = 'confirmed'`.
- `[Từ chối thanh toán]` — Set `payment_status = 'rejected'` with `payment_rejection_note`.

**Post-event:**
- `[Đánh dấu vắng mặt]` — Set `attendance_status = 'no_show'` and `no_show_flagged = true`. Only for confirmed registrants with `attendance_status = 'pending'` after event date.
- `[Gắn cờ blacklist]` — Set `blacklist_flag = true` with required `blacklist_note`. Only `full_access` role.

### 7.4 Public Registration Form — Dynamic Fields

The public form renders fields based on event config fetched server-side when loading the token page.

**Always shown:**
- Full name (required)
- Email (required)
- Consent checkbox (required)

**Conditionally shown (based on event config):**
- Phone (`show_phone_field` — always shown in current MVP; could be made optional later)
- Student ID / MSSV (if `show_student_id_field = true`, required if `student_id_required = true`)
- Mentee code (if `show_mentee_code_field = true`, required if `mentee_code_required = true`)
- School (if `show_school_field = true`)
- Program of study (if `show_program_field = true`)
- Role / group (if `show_role_text_field = true`)
- Notes (if `show_notes_field = true`)

**Always shown if configured:**
- Proof URL field (if `proof_required_for_registration = true`), with `proof_label` and `proof_description`
- Speaker question textarea (if `question_collection_enabled = true`), with `speaker_question_label`
- Payment instructions block (if `fee_required = true`): fee amount, currency, description, bank info
- Payment proof URL field (if `payment_proof_required = true`)

**Always shown if configured — informational only:**
- Event description block (if `event_description` is set) — shown above the form
- No-show policy warning (if `no_show_policy_enabled = true`) — shown above submit button in a warning box

**Bilingual field labels (recommended):**
Where space allows, labels should include both Vietnamese and English or the relevant acronym:
- "Email *" (universal)
- "Họ và tên / Full name *"
- "Mã số sinh viên / MSSV"
- "Mã Mentee / Mentee Code"
- "Câu hỏi cho diễn giả / Questions for speaker"

### 7.5 Public Check-in Form — Friendly Error Messages

Replace the current generic server-side error strings with specific, user-friendly messages:

| Situation | Message (Vietnamese) |
|---|---|
| Not registered | "Email của bạn chưa có trong danh sách đăng ký sự kiện này." |
| Not confirmed (pending_review) | "Đăng ký của bạn đang chờ xác nhận từ ban tổ chức. Vui lòng chờ." |
| Not confirmed (waitlisted) | "Bạn đang trong danh sách dự phòng. Vui lòng liên hệ ban tổ chức." |
| Not confirmed (rejected) | "Đăng ký của bạn đã bị từ chối. Vui lòng liên hệ ban tổ chức." |
| Event full (walk-in blocked) | "Sự kiện đã đủ chỗ. Walk-in không khả dụng." |
| Check-in not open yet | "Check-in chưa bắt đầu. Vui lòng quay lại đúng giờ." |
| Check-in closed | "Thời gian check-in đã kết thúc." |
| Already checked in | "Bạn đã check-in sự kiện này rồi. Không cần check-in lại." |
| Self check-in disabled | "Sự kiện này không hỗ trợ tự check-in. Vui lòng liên hệ ban tổ chức." |
| Registration cancelled | "Đăng ký của bạn đã bị hủy. Vui lòng liên hệ ban tổ chức." |

---

## 8. Security and Privacy

### 8.1 Proof and Payment Screenshot Handling

**Phase 2A (URL-based):**
- `proof_url` and `payment_proof_url` are plain text URLs submitted by registrants (e.g., Google Drive links, Imgur, Facebook post).
- These URLs may contain personal information visible in the proof (ID cards, bank statements, personal photos).
- **Access control:** These URLs must only be visible to authorized admins in the admin portal. They must never appear in:
  - Public API responses
  - Public registration status pages
  - Emails to other participants
  - Admin list export without appropriate access check

**Phase 2D (Supabase Storage):**
- Use a **private bucket** (not public). Files are not accessible via direct URL.
- Serve files via signed URLs with short TTL (15–30 minutes), generated server-side only when an authorized admin requests to view a proof.
- Delete files if a registration is cancelled and the participant requests removal.
- File name must not expose participant identity (use UUID as filename, store original name in metadata).

### 8.2 Payment Data Visibility

- `payment_proof_url`, `payment_confirmed_by`, `payment_rejection_note` should only be visible to `full_access` or `ops` role admins — not `viewer` role.
- Do not include payment fields in any public-facing route or export.
- `fee_amount` and `payment_instruction` are public (shown on the registration form) — they contain no sensitive participant data.

### 8.3 Public Link Safety

- Public registration and check-in links use random UUID tokens. The token does not encode the event name or any other information.
- The server does not return participant lists, registration counts, or capacity numbers to unauthenticated requests.
- The public form response only tells the registrant their own status — not whether others are registered.
- Capacity-full message is acceptable to show publicly ("Sự kiện đã đủ chỗ").

### 8.4 No-show and Blacklist Data

- `no_show_flagged` and `blacklist_flag` are internal admin data.
- They must never appear on any public-facing page or in registration confirmation messages.
- Access to blacklist data should be restricted to `full_access` and `super_admin` roles only.
- CRM notes generated from no-show events follow the visibility rules in the CRM Blueprint (visibility = `ops_only` or `team`, never `public`).

### 8.5 Proof URL Recommendation Summary

```
Phase 2A (recommended to start):
  proof_url           = text field, participant submits external link
  payment_proof_url   = text field, participant submits external link
  Pros: no storage complexity, no signed URL infrastructure, faster to ship
  Cons: admin cannot control access to the linked file; link may expire or become unavailable
  Risk mitigation: accept that Phase 2A proof links may not persist; treat them as "best effort"

Phase 2D (when ready):
  Use Supabase Storage private bucket
  Generate signed URLs server-side with short TTL
  This is the right long-term approach but is not Phase 2A scope
```

---

## 9. Recommended Implementation Phases

### Phase 2A — Schema Foundation + Check-in Modes + Capacity + Dynamic Form (First Coding Sprint)

**Scope:**
1. Additive migration: new columns on `events` table for all config fields (nullable, safe defaults).
2. Additive migration: new columns on `event_registrations` table (nullable, safe defaults).
3. Update `lib/events.ts`: `checkInForEvent()` to implement the check-in rules engine (Section 5).
4. Update `lib/events.ts`: `registerForEvent()` to enforce capacity check and `waitlist_enabled` routing.
5. Update `lib/events.ts`: `registerForEvent()` to set `registration_status = 'pending_review'` when `approval_required = true`.
6. Update `app/events/event-form.tsx`: Add the config section UI (collapsible, all config toggles + fields).
7. Update `app/actions/events.ts`: Pass new config fields to `createEvent()` and `updateEvent()`.
8. Update `lib/events.ts`: `createEvent()` and `updateEvent()` to save config fields.
9. Update `app/register/[token]/page.tsx` + `registration-form.tsx`: Fetch event config, render dynamic fields conditionally, show event description + no-show warning.
10. Update `app/checkin/[token]/page.tsx` + `checkin-form.tsx`: Use improved error messages matching check-in rules.
11. Update `lib/types.ts`: Add new fields to `Event` and `EventRegistration` types.
12. Update `lib/event-action-types.ts`: Add new action status values (`not_registered`, `not_confirmed`, `checkin_not_open`, `checkin_closed`, `event_full`, `walk_in_blocked`, `self_checkin_disabled`).

**Does NOT include:** proof review workflow, payment review, no-show flagging buttons, admin review/confirm/reject actions.

### Phase 2B — Admin Review Workflow (Second Coding Sprint)

**Scope:**
1. New server actions: `confirmRegistrationAction`, `rejectRegistrationAction`, `waitlistRegistrationAction`, `confirmPaymentAction`, `rejectPaymentAction`, `acceptProofAction`, `rejectProofAction`, `flagNoShowAction`.
2. Update `app/events/[id]/page.tsx`: Expand registration list into a full review table with filter tabs and action buttons.
3. Capacity summary bar component.
4. Admin-side proof URL display (opens in new tab).
5. Admin payment proof URL display.
6. No-show flag action (post-event only).
7. Blacklist flag action (`full_access` only).
8. CRM integration: auto-create `person_notes` entry when `no_show_flagged = true` (if CRM Blueprint Phase 1 is implemented).

### Phase 2C — Post-Event Feedback Form

**Scope:**
1. New `event_feedback` table: `event_id`, `registration_id`, `linked_person_id`, `rating`, `feedback_text`, `submitted_at`.
2. Public feedback form accessible after event closes (new token type `feedback` in `event_links`).
3. Admin feedback summary panel on event detail page.
4. Optional: aggregate feedback export.

### Phase 2D — Private File Upload for Proof and Payment

**Scope:**
1. Supabase Storage private bucket setup.
2. Upload endpoint (server action): validates file type/size, stores in private bucket, returns signed URL for display.
3. Update proof and payment fields to support both URL and file upload.
4. Signed URL generation with short TTL for admin viewing.
5. File deletion on registration cancellation.

---

## 10. Production Rollout Plan

### 10.1 Migration Principles

- All new columns must be nullable with default values compatible with current production data.
- No column drops, no column renames, no type changes on existing columns.
- No NOT NULL constraints on new columns.
- No backfill of existing registrations beyond setting safe defaults (defaults applied by database).
- Migrations run on staging only until QA passes; never run directly on production.

**Example safe migration pattern:**
```sql
-- All additive, all nullable, all with safe defaults
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS registration_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_limit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_limit integer,
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_walk_in boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checkin_mode text NOT NULL DEFAULT 'open',
  -- ... all other config fields
  ;

ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS mentee_code text,
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS proof_file_url text,
  ADD COLUMN IF NOT EXISTS proof_note text,
  ADD COLUMN IF NOT EXISTS proof_status text NOT NULL DEFAULT 'not_required',
  -- ... all other new fields
  ;
```

> **Note:** `ADD COLUMN IF NOT EXISTS` makes migrations idempotent — safe to re-run if interrupted.

### 10.2 Staging QA Checklist

**Before deploying to production:**

- [ ] Run migration on staging database; verify all existing `events` rows still load correctly.
- [ ] Verify existing `event_registrations` rows still display correctly on admin detail page.
- [ ] Create a new event with all config fields at default (no config). Confirm behavior is identical to pre-Phase-2 behavior.
- [ ] Create an event with `capacity_limit_enabled = true`, capacity = 3. Register 3 people. Verify 4th registration is waitlisted (if `waitlist_enabled`) or blocked.
- [ ] Create an event with `approval_required = true`. Verify new registrations have `registration_status = 'pending_review'`.
- [ ] Create an event with `checkin_mode = 'confirmed_only'`. Verify that pending-review registrants cannot check in.
- [ ] Create an event with `proof_required_for_registration = true`. Verify proof URL field appears on public form. Verify registration is blocked if field is empty.
- [ ] Create an event with `allow_walk_in = false`. Verify walk-in check-in returns friendly error.
- [ ] Create an event with `checkin_window_enabled = true` and future `checkin_opens_at`. Verify check-in returns "not open yet" error before that time.
- [ ] Create an event with `no_show_policy_enabled = true`. Verify policy text appears on public form.
- [ ] Create an event with `fee_required = true`. Verify fee instructions appear on public form.
- [ ] Run `npm run typecheck` — zero errors.
- [ ] Run `npm run lint` — zero errors.
- [ ] Run `npm run build` — 36/36 pages compiled.
- [ ] Verify existing production event data loads correctly in admin list and detail pages.
- [ ] Test public check-in duplicate detection still works.
- [ ] Test public registration duplicate detection still works.
- [ ] Test walk-in check-in still works on `checkin_mode = 'open'` events.

### 10.3 Deployment Sequence

1. Apply migration to **staging** database.
2. Deploy Phase 2A code to **staging** environment.
3. Run full QA checklist above on staging.
4. Get explicit sign-off from Anh Thắng on checklist results.
5. Apply migration to **production** database (during low-traffic window).
6. Deploy Phase 2A code to **production**.
7. Smoke test: create one test event with non-default config, verify config saves and public form reflects it.
8. Announce Phase 2A availability to coreteam.

---

## 11. Open Questions for Anh Thắng / Coreteam

These decisions affect the design before Phase 2A coding begins. Please review and decide.

### Q1 — Proof submission format (Phase 2A)
> Should proof be collected as an external URL (Google Drive / Imgur link) or as a direct file upload?  
> **Recommendation:** Start with external URL in Phase 2A (simpler, faster, no storage infrastructure). Move to Supabase Storage private upload in Phase 2D.  
> **Decision needed:** Accept URL-only for Phase 2A, or require full file upload from the start?

### Q2 — Capacity auto-confirm vs. manual review
> For limited-capacity events without `approval_required`: should the first N registrants be automatically confirmed, or should all registrations be in `pending_review` status until admin manually confirms up to the capacity limit?  
> **Recommendation:** Auto-accept first N registrants as `registered` (no pending_review) unless `approval_required` is also set. Keep simple.  
> **Decision needed:** Agree with auto-accept, or require manual confirmation for capacity events?

### Q3 — Waitlist: automatic vs. manual promotion
> When a confirmed registrant cancels, freeing a slot: should the next waitlisted registrant be automatically promoted to `registered` / `confirmed`, or should admin manually promote?  
> **Recommendation:** Manual promotion in Phase 2A/2B. Automatic promotion requires email notification infrastructure (Phase 3+).  
> **Decision needed:** Confirm manual promotion only for now?

### Q4 — No-show and blacklist: flag only vs. automatic consequence
> Should `no_show_flagged` automatically trigger any consequence (e.g., block future registrations), or remain purely an informational flag for admin awareness?  
> **Recommendation:** Informational flag only. No automatic blocking. Blacklist escalation is manual and rare.  
> **Decision needed:** Agree with flag-only approach? Or should flagged participants be blocked from registering for future events immediately?

### Q5 — Payment confirmation gate
> Should `registration_status` be forcefully locked at `pending_review` until `payment_status = 'confirmed'`? Or should admins be allowed to confirm registration before payment is verified?  
> **Recommendation:** Yes, enforce the gate in UI but not in DB (allow admin override for exceptional cases). Admin sees a warning if they try to confirm before payment.  
> **Decision needed:** Hard gate (DB-level) or soft warning (UI-level)?

### Q6 — UEH students vs. non-UEH participants
> Which fields should be required for UEH students that may be optional for non-UEH guests?  
> For example: MSSV required for UEH mentees attending training, but not for alumni or company guests.  
> **Recommendation:** Make `student_id_required` a per-event toggle (not automatic). Admin sets it for UEH-targeted trainings.  
> **Decision needed:** Is a single `student_id_required` toggle sufficient, or do we need participant-type-based required fields?

### Q7 — Mentee code: collected at registration or pre-filled from people match?
> The UEH form asks for the VAM mentee code (mã mentee UEH). Should this be:  
> (a) A free-text field submitted by the registrant and then verified by admin, or  
> (b) Pre-filled automatically when the registrant's email matches a `people` record that has a known mentee code?  
> **Recommendation:** Free-text field in Phase 2A. Auto-prefill from matched person in Phase 2B.  
> **Decision needed:** Agree with Phase 2A free-text approach?

### Q8 — No-show policy display: required or optional consent?
> Should the no-show policy warning be:  
> (a) Informational text only (shown but not acknowledged), or  
> (b) A required checkbox: "Tôi hiểu và đồng ý với chính sách vắng mặt"?  
> **Recommendation:** Required checkbox when `no_show_policy_enabled = true`, so consent is explicitly recorded.  
> **Decision needed:** Text-only display or required acknowledgment checkbox?

### Q9 — Speaker question field: public or admin-only?
> Should submitted speaker questions be visible to the public (e.g., "other participants asked these questions"), or strictly internal admin-only?  
> **Recommendation:** Admin-only. Questions are collected for organizers to prepare, not for public display.  
> **Decision needed:** Confirm admin-only.

### Q10 — Config table: inline on `events` or separate `event_config` table?
> Two implementation options:  
> (a) Add all config columns directly to the `events` table (simpler, fewer joins, all config in one row)  
> (b) Create a separate `event_config` table with `event_id` FK (cleaner schema, separates config from core event data)  
> **Recommendation:** Option (a) — inline on `events` table. The config fields are tightly coupled to the event and there will only ever be one config set per event. A separate table adds a join with no benefit at this scale.  
> **Decision needed:** Confirm option (a) or prefer option (b)?

---

## Appendix A — New `CheckinActionStatus` Values

Add to `lib/event-action-types.ts` (Phase 2A):

```typescript
export type CheckinActionStatus =
  | "idle"
  | "success"
  | "already_checked_in"
  | "not_registered"          // NEW: email not in registrations
  | "not_confirmed"           // NEW: pending_review or waitlisted
  | "registration_rejected"   // NEW: registration was rejected
  | "registration_cancelled"  // NEW: registration was cancelled
  | "checkin_not_open"        // NEW: before checkin_opens_at
  | "checkin_closed"          // NEW: after checkin_closes_at
  | "event_full"              // NEW: capacity reached, walk-in blocked
  | "walk_in_blocked"         // NEW: allow_walk_in = false
  | "self_checkin_disabled"   // NEW: checkin_mode = manual_admin_only
  | "validation_error"
  | "link_error"
  | "server_error";
```

## Appendix B — New `RegistrationActionStatus` Values

Add to `lib/event-action-types.ts` (Phase 2A):

```typescript
export type RegistrationActionStatus =
  | "idle"
  | "success"
  | "pending_review"          // NEW: approval_required = true; awaiting admin
  | "waitlisted"              // NEW: capacity full, waitlist created
  | "capacity_full"           // NEW: capacity full, waitlist disabled
  | "already_registered"
  | "validation_error"
  | "link_error"
  | "server_error";
```

## Appendix C — Recommended First Coding Task

**Start with:** Phase 2A schema migration + check-in rules engine.

**Reason:** The check-in rules engine (`checkInForEvent()` in `lib/events.ts`) is pure server logic with no UI surface. It is fully testable in isolation. Implementing it first:
1. Proves the schema changes are safe (migration runs cleanly on staging).
2. Unblocks the most urgent business need (approved-only check-in for UEH trainings).
3. Does not require any admin UI changes — existing events that do not set the new config fields continue to work exactly as before.

**Sequence for first sprint:**
1. Write and apply schema migration on staging.
2. Update `lib/types.ts` with new fields.
3. Update `lib/event-action-types.ts` with new status values.
4. Implement check-in rules in `checkInForEvent()` behind config field checks.
5. Implement capacity check in `registerForEvent()`.
6. Add config section to `EventForm` (create/edit).
7. Update public registration form for dynamic fields.
8. Update public check-in form for new error messages.
9. Run full typecheck + lint + build.
10. Staging QA.
```
