# UEHM Season 11 Events — Audit & Import Plan

| | |
|---|---|
| **Version** | 2.0 |
| **Date** | 2026-05-07 |
| **Author** | VAM OS Codex |
| **Status** | Phase 2 Complete — Dedup + Import-Ready CSV Generated |
| **Scope** | UEH Mentoring Season 11 Event Files (4 events) |

---

## 1. Executive Summary

Four UEH Mentoring Season 11 event Excel workbooks were audited, cleaned, and mapped to the current VAM OS Events & Attendance MVP schema. All 7 output CSV files have been generated in `data_imports/uehm_s11_events/`.

**Key findings:**

- **4 events** identified: Kickoff (`kickoff` / fallback `other`), Mentee Orientation (`orientation`), Training 01 (`training`), Training 02 (`training`)
- **5,234 total participant rows** extracted across all sheets
- **1,933 cross-sheet duplicates** removed in Phase 2 dedup (expected behavior)
- **546 junk/test rows** filtered during dedup
- **2,755 unique import-ready participants** across all 4 events
- **Only Training 02** has clean attended rows (237 rows confirmed check-in)
- **Training 01** has 223 `registered_confirmed` + 5 `absent` (blacklist) rows
- **Kickoff** is classified as `business_event_type = kickoff`; DB fallback = `other` (schema gap documented)
- **Phase 2 complete** — `event_participations_import_ready_dedup.csv` generated

**Recommendation: Option B** — Import events + MVP attendance now, keep rich data as audit CSV.

---

## 2. Per-Event Summary Table

| Event Code | Event Name | Type | Date | Raw Rows | Dedup Unique | Attended | Confirmed | Registered | Absent | Duplicates Removed | Import Ready (Dedup) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UEHM_S11_KICKOFF | Season 11 Kickoff | `other` (business: `kickoff`) | 2025-08-11 | 1,035 | **651** | 0 | 0 | 651 | 0 | 384 | **651** |
| UEHM_S11_ORIENTATION | Mentee Orientation | `orientation` | Unknown | 2,453 | **1,480** | 0 | 0 | 1,480 | 0 | 973 | **1,480** |
| UEHM_S11_TRAINING01 | Training 01 – Crack the Code | `training` | 2025-11-21 | 642 | **307** | 0 | 223 | 79 | 5 | 335 | **307** |
| UEHM_S11_TRAINING02 | Training 02 – Data Analytics | `training` | 2025-11-25 | 558 | **317** | 237 | 0 | 80 | 0 | 241 | **317** |
| **TOTAL** | | | | **4,688** | **2,755** | **237** | **223** | **2,290** | **5** | **1,933** | **2,755** |

> *"Duplicates" = same person appearing across multiple sheets (registration + check-in + confirmation). This is expected behavior for multi-sheet workbooks, not data corruption.
> 
> **No check-in / attendance sheet found for Kickoff and Orientation in these files. The check-in data for Kickoff is in sheets `CHECK IN MENTOR` and `CHECK IN MENTEE` but attendance_status was not countable without a column explicitly marking check-in True/False — the check-in sheets contain names/phones only.

### 2.1 Event Date Notes

| Event | Date Source | Confidence |
|---|---|---|
| Kickoff | Found `12:39 11/08/2025` in workbook metadata | Medium — likely Aug 11, 2025 |
| Orientation | Not found in file | Unknown — needs manual lookup |
| Training 01 | `2025-11-21` (earliest timestamp in form) | High |
| Training 02 | `2025-11-25` (earliest timestamp in form) | High |

---

## 3. Sheet Classification by Event

### 3.1 UEHM_S11_KICKOFF — `[UEH MENTORING] REPORT KICK-OFF MÙA 11.xlsx`

| Sheet Name | Role | Notes |
|---|---|---|
| THỐNG KÊ | Statistics summary | 4 rows — aggregate counts only |
| MENTEE | Registration (mentee) | 422 data rows |
| MENTOR | Registration (mentor) | 180 data rows |
| CỰU MENTEE | Registration (alumni) | 3 data rows |
| CHECK IN MENTOR | Check-in (mentor) | 112 rows — name + phone only, no explicit boolean |
| CHECK IN MENTEE | Check-in (mentee) | 388 rows — timestamp + MSSV + phone |
| FEEDBACK | Feedback | 12 rows — multi-column score (scale 1-10 + 1-5 per activity) |

**Participant types found:** mentee, mentor, alumni (cựu mentee)

### 3.2 UEHM_S11_ORIENTATION — `Mente Orientation.xlsx`

| Sheet Name | Role | Notes |
|---|---|---|
| Sheet1 | Registration | 946 rows — name, MSSV, email |
| Sheet2 | Registration + check-in hybrid | 1,508 rows — includes `Check in 4/10` column |

> Note: Sheet2 has a `Check in 4/10` column which likely represents October 4 orientation check-in date. This should be parsed separately as attendance data. The current audit treats all rows as registration.

**Participant types found:** mentee (inferred — all UEH students by MSSV/email pattern)

### 3.3 UEHM_S11_TRAINING01 — `TRAINING 01 _ REPORT TRAINING CRACK THE CODE_ CV WRITING & INTERVIEW LIKE A PRO .xlsx`

| Sheet Name | Role | Notes |
|---|---|---|
| THỐNG KÊ | Statistics summary | 2 rows — reg/confirmed/attended counts |
| SHEET XÁC NHẬN + CHECK IN | Confirmation + check-in | 257 rows — email, MSSV, check-in date col |
| XIN OFF | Excused absence | 20 rows |
| CHƯA XÁC NHẬN - ĐỢT 1 + ĐỢT 2 | Unconfirmed (rounds 1+2) | 383 rows |
| BLACKLIST | No-show / blacklist | 33 rows |
| CHƯA XÁC NHẬN ĐỢT 1 | Unconfirmed (round 1 only) | 55 rows |
| SHEET ĐĂNG KÝ | Registration (Google Form export) | 380 rows |

**Participant types found:** mentee (primary), some non-UEH participants noted

### 3.4 UEHM_S11_TRAINING02 — `TRAINING 02.xlsx`

| Sheet Name | Role | Notes |
|---|---|---|
| Thống kê | Statistics summary | 2 rows |
| Đăng ký | Registration | 304 rows — name, MSSV, email, question for speaker |
| Xác nhận tham gia + check in | Confirmation + check-in | 255 rows — check-in boolean column present |
| Report | Empty | No data |

**Participant types found:** mentee (primary), with `Bạn có phải là Mentee không?` column

---

## 4. Data Audit Results

### 4.1 Identity Coverage

| Event | Has Email | Has Phone | Has MSSV | Missing All Three |
|---|---|---|---|---|
| Kickoff | ✅ Most rows | ✅ Most rows | Partial (mentee only) | 81 rows |
| Orientation | ✅ Most rows | ❌ Rarely | ✅ Most rows | 1 row |
| Training 01 | ✅ All | ✅ Most | ✅ Most | 0 rows |
| Training 02 | ✅ All | ❌ Rarely | ✅ Most | 0 rows |

### 4.2 Duplicate Analysis

> **Important:** "Duplicates" in this audit means the **same email appears in multiple sheets** of the same workbook (e.g., a person in both the registration sheet and the confirmation sheet). This is **normal and expected**. It does NOT mean the data is corrupted.

| Event | Cross-sheet duplicate emails | True data duplicates (same person, same sheet) |
|---|---|---|
| Kickoff | 0 flagged (sheets use different identity cols) | 0 confirmed |
| Orientation | 927 (Sheet1 + Sheet2 overlap) | Likely ~900+ same-person cross-sheet |
| Training 01 | 707 (reg + confirm + unconfirmed overlap) | Likely ~650+ same-person cross-sheet |
| Training 02 | 221 (reg + confirm+checkin overlap) | Likely ~200+ same-person cross-sheet |

**Action:** When importing to VAM OS, deduplicate by email — keep the row with the richest attendance status.

### 4.3 Attendance Rate Calculations

| Event | Registered | Attended | Att. Rate (vs Reg) | Confirmed | Att. Rate (vs Confirmed) |
|---|---|---|---|---|---|
| Kickoff | 1,117 | ~500* | ~45%* | N/A | N/A |
| Orientation | 946 (Sheet1) | Unknown | — | N/A | N/A |
| Training 01 | 380 | Unknown | — | 262 | — |
| Training 02 | 304 | 245 | **80.6%** | N/A | N/A |

> *Kickoff check-in sheets show 112 mentors + 388 mentees = ~500 checked in, but no boolean confirmation column — cannot cleanly derive from current parsing. Recommend manual re-parse of CHECK IN sheets.

### 4.4 Issues Summary

| Issue Type | Count | Severity | Recommended Action |
|---|---|---|---|
| `duplicate_email` (cross-sheet) | 1,855 | Medium | Keep richest row per email per event |
| `missing_identity` | 82 | High | Manual review — match by name |
| `walkin_not_in_registration` | 25 | Low | Mark as walk-in; verify identity |
| **Total** | **1,962** | | |

---

## 5. Event Lifecycle Recommendation for VAM OS

```
Season 11 events are HISTORICAL — full lifecycle is not needed.
Season 12+ events should follow full lifecycle.

Current MVP import for S11:
  [events_clean] → [event_participations_clean] → VAM OS DB

Preserved for future import:
  [event_registrations_clean]  — registration + confirmation details
  [event_attendance_clean]     — detailed attendance status + excused/blacklist flags
  [event_feedback_clean]       — feedback scores + text (12 rows from Kickoff)
```

**Blueprint 2.0 target lifecycle for Season 12:**
```
Registration → Confirmation → Reminder → Check-in → Post-event classification → Feedback → Report
```

---

## 6. Current MVP Import Scope

### 6.1 What CAN be safely imported now

| Data | File | Target Table | Notes |
|---|---|---|---|
| 4 event master records | `events_clean.csv` | `events` | Needs manual date for Orientation |
| Training 02 attended rows (245) | `event_participations_clean.csv` | `event_participations` | Cleanest data — check-in confirmed |
| Kickoff registration list (1,036 non-issue rows) | `event_participations_clean.csv` | `event_participations` | status = `registered` only |
| Orientation registration list (2,453 rows) | `event_participations_clean.csv` | `event_participations` | Dedup needed first |
| Training 01 confirmed list (262 rows) | `event_participations_clean.csv` | `event_participations` | status = `registered_confirmed` |
| Training 01 blacklist (33 rows) | `event_participations_clean.csv` | `event_participations` | status = `absent` |

### 6.2 What should NOT be imported yet

| Data | Reason | Preserved In |
|---|---|---|
| Training 01 check-in exact count | No clear boolean check-in column | `event_attendance_clean.csv` |
| Kickoff check-in counts | Sheets need separate re-parse | `event_attendance_clean.csv` |
| Orientation check-in (Sheet2 `Check in 4/10`) | Needs column-level re-parse | `event_attendance_clean.csv` |
| Feedback data (12 rows) | No feedback schema in current MVP | `event_feedback_clean.csv` |
| Excused absence flags (20 rows T01) | No `excused_absence` field in MVP | `event_attendance_clean.csv` |
| Questions for speaker | No field in current schema | `event_registrations_clean.csv` |

---

## 7. Schema Gaps in Current VAM OS

| Gap | Impact | Priority |
|---|---|---|
| No `excused_absence` field in `event_participations` | Cannot distinguish excused vs no-show | Medium |
| No `confirmation_status` field | Cannot record pre-event confirmation separately from attendance | Medium |
| No `feedback` table / relationship to events | 12 feedback rows from Kickoff cannot be imported | Medium |
| No `checkin_time` field | Timestamp of check-in lost | Low |
| No `blacklist_flag` field | Can only store as `absent`, lose nuance | Low |
| No `question_for_speaker` field | Training 02 pre-event questions lost | Low |
| No `walk_in` attendance status | 25 Training 02 walk-ins must be stored as `attended` | Low |
| `event_date` is single date — no start/end time | Kickoff time context lost | Low |

---

## 8. Recommended Staging Import Sequence

```
Step 1 — Create events (events_clean.csv)
  → events table: 4 rows
  → Validate: event_type enum matches production constraint
  → Manual fix: Orientation event_date (not found in file — check with team)

Step 2 — Dedup participations
  → Run dedup by (event_code, email): keep row with richest attendance_status_mvp
  → Precedence: attended > registered_confirmed > registered > unknown

Step 3 — Import Training 02 attended rows (245)
  → These are the cleanest — check-in column confirmed
  → attendance_status_mvp = "attended"

Step 4 — Import Training 01 confirmed + blacklist
  → 262 confirmed rows (status = registered_confirmed → map to attended or confirmed)
  → 33 blacklist rows (status = absent)

Step 5 — Import Kickoff registrations
  → 1,036 rows (status = registered)
  → Manual review 81 rows with missing identity

Step 6 — Import Orientation registrations
  → Dedup Sheet1 vs Sheet2 first
  → ~946 unique registrations likely
  → Re-parse Sheet2 Check-in column for attended status

Step 7 — Run QA
  → Verify event participant counts vs summary CSV
  → Flag any enum violations
```

---

## 9. Recommended Dashboard KPIs

| KPI | Source | Formula |
|---|---|---|
| Registered | event_participations | COUNT WHERE status IN (registered, registered_confirmed, attended) |
| Confirmed | event_participations | COUNT WHERE status = registered_confirmed |
| Attended | event_participations | COUNT WHERE status = attended |
| Attendance rate (vs registered) | — | attended / registered × 100 |
| Attendance rate (vs confirmed) | — | attended / confirmed × 100 |
| Absent / no-show | event_participations | COUNT WHERE status = absent |
| Excused absence | event_attendance_clean | COUNT WHERE excused_absence_flag = TRUE |
| Feedback count | event_feedback_clean | COUNT rows per event |
| Average feedback score | event_feedback_clean | AVG(feedback_score) |

**Target KPI values for current data (where available):**

| Event | Registered | Confirmed | Attended | Att% vs Reg | No-show |
|---|---|---|---|---|---|
| Kickoff | ~1,117 | — | ~500 (estimated) | ~45% | — |
| Orientation | ~946 | — | Unknown | — | — |
| Training 01 | 380 | 262 | Unknown (need re-parse) | — | 33 |
| Training 02 | 304 | — | **245** | **80.6%** | 9 unknown |

---

## 10. Manual Review Issues

| # | Issue | Event | Count | Action |
|---|---|---|---|---|
| 1 | Rows with no email/phone/MSSV | Kickoff | 81 | Match by name; likely mentor/alumni guests |
| 2 | Orientation date unknown | Orientation | 1 event | Ask team — likely Oct 4, 2025 |
| 3 | Kickoff check-in sheets need column-level re-parse | Kickoff | ~500 rows | Re-parse CHECK IN MENTOR + MENTEE sheets |
| 4 | Orientation Sheet2 check-in column (`Check in 4/10`) | Orientation | ~1,508 rows | Isolate that column, map True/False to attended |
| 5 | Training 02 walk-ins (25) not in registration | Training 02 | 25 | Mark as walk-in; verify identity |
| 6 | Training 01 `SHEET XÁC NHẬN + CHECK IN` — `Check in 30/11` column needs TRUE/FALSE parse | Training 01 | 257 rows | Re-parse check-in column for actual attendance boolean |
| 7 | Training 01 `CHƯA XÁC NHẬN` sheets overlap | Training 01 | 383 + 55 rows | May be same people — dedup by email |

---

## 11. Risks and Open Questions

> [!WARNING]
> **Orientation event date is unknown.** The file contains no date metadata and no sheet header with a date. Importing with a blank event_date will fail if the DB has a NOT NULL constraint. **Confirm with team before import.**

> [!WARNING]
> **Training 01 actual attendance count is unknown from this audit.** The `SHEET XÁC NHẬN + CHECK IN` contains a `Check in 30/11` column but the script could not cleanly resolve the TRUE/FALSE values due to mixed data types. Re-parse needed.

> [!NOTE]
> **Duplicate count (1,855) is NOT a data quality problem.** It reflects the same person appearing in multiple sheets (registration, confirmation, check-in). The dedup step in the import sequence handles this correctly.

> [!NOTE]
> **Feedback data (12 rows from Kickoff) is too small for meaningful analytics** but should be preserved. The questions use mixed scales (1–10 for overall, 1–5 per activity). No current schema for this.

**Open Questions:**
1. Is Orientation date October 4, 2025? Confirm with team.
2. Should Training 01 `registered_confirmed` rows be mapped to `attended` or remain as `confirmed` pending a separate check-in pass?
3. Are the Kickoff `CHECK IN MENTOR/MENTEE` sheets a complete attendance list, or were some attendees not check-in'd?
4. Should walk-in participants (Training 02, 25 rows) be added to the person registry if email not found?
5. What season batch code applies to these events?

---

## 12. Recommendation for Codex Next Step

**Recommendation: Option B** ✅

> Import events + MVP attendance now. Preserve rich data as audit CSVs.

**Rationale:** The current VAM OS MVP Events & Attendance module supports:
- `events` table with `event_type` enum — all 4 events map cleanly
- `event_participations` table with `attendance_status` — Training 02 has clean attended rows; others have registration-level data

The schema cannot safely store: feedback, confirmation timestamps, excused absence flags, check-in times, or walk-in distinction. These are preserved in the rich audit CSVs for future Phase 2 import when schema is extended.

**Do NOT wait for Phase 2** before importing — the event master records and Training 02 attendance are clean enough today.

### Next Steps for Codex (Staging Import)

```
1. Resolve Orientation event_date with team
2. Re-parse Kickoff CHECK IN sheets (separate sub-task)
3. Re-parse Training 01 SHEET XÁC NHẬN check-in column (separate sub-task)
4. Run staging import: events_clean.csv → events table
5. Run staging import: event_participations_clean.csv (post-dedup) → event_participations table
6. QA: verify counts match event_summary_by_file.csv
7. If staging passes → production import
```

---

## 13. Output Files Generated

| File | Rows | Purpose |
|---|---|---|
| `events_clean.csv` | 4 | MVP import — event master records (**updated**: Kickoff `business_event_type=kickoff`, `event_type=other`, `schema_gap` documented) |
| `event_participations_clean.csv` | 5,234 | Phase 1 output — all raw participant rows (pre-dedup) |
| `event_participations_import_ready_dedup.csv` | **2,755** | **Phase 2 output — deduped, import-ready** ✅ |
| `event_registrations_clean.csv` | 4,947 | Rich — registration + confirmation details |
| `event_attendance_clean.csv` | 5,234 | Rich — detailed attendance status per row |
| `event_feedback_clean.csv` | 12 | Rich — feedback data (Kickoff only) |
| `event_import_issues.csv` | 1,962 | All flagged issues for manual review |
| `event_summary_by_file.csv` | 4 | One-row summary per event (**updated**: `dedup_count`, `duplicate_removed`, `import_ready_count_dedup` added) |

All files use UTF-8 with BOM encoding. Phase 1 generated: 2026-05-07. Phase 2 generated: 2026-05-07.

---

## 14. Phase 2 Dedup — Technical Notes

### 14.1 Dedup Strategy Applied

| Priority | Identity Key | Notes |
|---|---|---|
| 1 | Email (normalised to lowercase) | Primary match key |
| 2 | Phone (normalised, `84x` → `0x`) | Secondary match |
| 3 | MSSV (uppercase) | Tertiary match |
| 4 | Name (lowercase, whitespace-collapsed) | Last resort fallback |

**Attendance priority** (highest wins within a dedup group):
`checked_in / attended (10) > walk_in (8) > registered_confirmed (5) > registered (3) > registered_unconfirmed (2) > absent (1) > unknown (0)`

### 14.2 Business Correction — Kickoff

| Field | Old Value | New Value |
|---|---|---|
| `event_type` (DB import column) | `networking` | `other` |
| `business_event_type` | *(not set)* | `kickoff` |
| `event_type_current_fallback` | *(not set)* | `other` |
| `schema_gap` | *(not set)* | `missing_kickoff_event_type_enum` |

> [!IMPORTANT]
> When the DB enum is extended to include `kickoff`, update `events_clean.csv` column `event_type` to `kickoff` and remove the `schema_gap` entry.

### 14.3 Junk Row Filter

546 rows were filtered out during Phase 2 (test/placeholder rows, rows with names like "Aaaaa", rows with no identity fields at all). These remain in `event_participations_clean.csv` (Phase 1) for audit purposes.

### 14.4 Phase 2 Script

Script: `data_imports/uehm_s11_events/scripts/phase2_dedup.py`  
Run: `python phase2_dedup.py` from project root  
Encoding: `$env:PYTHONIOENCODING="utf-8"` required on Windows PowerShell

---

*UEHM Season 11 Events Audit — VAM OS Codex — 2026-05-07*  
*Phase 2 Dedup completed: 2026-05-07*  
*Internal document. Do not distribute.*
