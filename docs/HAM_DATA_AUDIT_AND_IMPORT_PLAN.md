# HAM Data — Audit & Import Plan

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-05-07 |
| **Author** | VAM OS Codex |
| **Status** | Phase 1 Complete — Audit + Clean CSVs Generated |
| **Scope** | Ha Noi Alumni Mentoring (HAM) Season 6 — `Data HAM mùa 6.xlsx` |

---

## 1. Executive Summary

One HAM source workbook was audited, classified, and cleaned into import-ready CSVs. The file contains data for **HAM Season 6**, covering mentors, mentees, and 163 Facebook-scraped mentoring recap posts. The data is structurally rich but requires identity-linking before full DB import — recap posts reference mentor/mentee by name only, not by system ID.

**Key findings:**

- **1 source file** — `Data HAM mùa 6.xlsx` (215 KB, 3 sheets)
- **112 people** identified: 52 mentors + 60 mentees — all import-ready (no missing identity)
- **60 mentor–mentee matches** confirmed from Mentee S6 sheet — all import-ready
- **163 recap posts** classified into 8 activity types
- **73 recap rows** import-ready (1on1 primary/cross with resolvable mentor + extracted mentee)
- **25 group/event rows** import-ready
- **65 issues** flagged for manual review (mostly missing mentee extraction or body too short)
- **No duplicate emails** found in people data
- **Critical schema gap**: recap posts use Vietnamese honorifics + informal names — identity linking to VAM OS `people` table requires fuzzy matching
- **Go/No-Go**: **CONDITIONAL GO** — people + matches are clean; recaps require identity resolution step before import

---

## 2. Source Files Inspected

| File | Path | Size | Sheets |
|---|---|---|---|
| `Data HAM mùa 6.xlsx` | `VAM_OS_Data_Cleaning/Input/Ha Noi Alumni Mentoring HAM/` | 215 KB | 3 |

### Sheet inventory

| Sheet | Rows | Purpose | Key Fields |
|---|---|---|---|
| `Mentor S6` | 52 | Mentor identity, field, match assignments | Name, Email, Phone, DOB, Title, Company, Expertise, Field, Mentee count, FB/LinkedIn |
| `Mentee S6` | 60 | Mentee identity + mentor assignment | Name, Email, Phone, School, Direction, Matched Mentor |
| `Recap S6` | 163 | Scraped FB recap posts (structured) | FB Link, Date, Body text, Mentor, Mentee, Type tag, Topic |

---

## 3. Data Quality Findings

### 3.1 Mentor S6

| Check | Result |
|---|---|
| Missing name | 0 rows |
| Missing email | 0 rows |
| Missing phone | 0 rows |
| Duplicate email | 0 rows |
| Import-ready | **52 / 52** |

**Notes:**
- Email format: mix of personal Gmail, corporate, and `.edu.vn` addresses
- Phone: some include country code `+84` — normalised to `0xxx` format in output
- Mentor honorifics in name column ("Anh", "Chị") stripped for canonical name
- `Hoạt động Mentoring có thể tham gia` column = activity preferences (group, 1on1, cross) — useful for VAM OS preference tagging
- Column `Họ tên Mentee` contains raw mentee name strings — used to cross-check matches

### 3.2 Mentee S6

| Check | Result |
|---|---|
| Missing name | 0 rows |
| Missing email | 0 rows |
| Missing mentor assignment | 0 rows |
| Duplicate email | 0 rows |
| Import-ready | **60 / 60** |

**Notes:**
- `Định hướng` (direction) = mentee's career/skill focus — maps to VAM OS `mentee_profiles.interests` or `career_goals`
- `Trường` (school) = university — maps to `people.school`
- All 60 mentees have a named mentor assignment → 60 match rows generated

### 3.3 Recap S6

| Check | Result |
|---|---|
| Mentee column raw | `"undefined"` for **all 163 rows** (scraper artifact) |
| Mentee extracted from body | Successful for **~116 rows** (~71%) |
| Missing mentor name | 13 rows (mentor column blank or `"undefined"`) |
| Body too short (<50 chars) | 2 rows |
| Missing FB post link | 0 rows |
| Unclassifiable type | 5 rows |
| Import-ready (recaps) | **73 / 121** (1on1 rows) |
| Import-ready (group/events) | **25 / 42** |

**Known scraper artifacts:**
- `Mentees` column: always `"undefined"` — real data is in `Body` field, parseable with regex
- `Mentor` column: often prefixed with `** ` or `* ` markdown markers
- `Header` column: mostly `"undefined"` — topic comes from `Body` parsing
- `Type` column: inconsistent tags (`#mentoring1`, `#doublecrossmentoring`, empty)

---

## 4. Activity Classification Summary

| Activity Type | Count | Target Output |
|---|---|---|
| `1on1_primary` | **91** | `ham_recaps_clean.csv` → `mentoring_recaps` |
| `1on1_cross` | **25** | `ham_recaps_clean.csv` → `mentoring_recaps` (cross-match) |
| `training_event` | **22** | `ham_events_or_group_activities_clean.csv` → `event_participations` |
| `group_mentoring` | **14** | `ham_events_or_group_activities_clean.csv` → `mentoring_recaps` (group flag) |
| `community_activity` | **2** | `ham_events_or_group_activities_clean.csv` → `event_participations` |
| `application_or_selection_activity` | **2** | `ham_events_or_group_activities_clean.csv` → manual review |
| `orientation_or_intro` | **2** | `ham_events_or_group_activities_clean.csv` → `event_participations` |
| `unknown_manual_review` | **5** | `ham_manual_review_issues.csv` |
| **TOTAL** | **163** | |

### Classification logic

Classification was applied in the following priority order:

1. **Explicit type tag** in post: `#mentoring1-1`, `#doublecrossmentoring`, `#crossmentoring`
2. **Body keywords**: `training`, `workshop`, `nhóm mentor`, `giao lưu`, `cộng đồng`, `tuyển chọn`
3. **Mentee count heuristic**: ≥3 mentees → `group_mentoring`; exactly 2 mentees → `1on1_cross`
4. **Presence of valid mentor name** → `1on1_primary`
5. **Default**: `unknown_manual_review`

> [!NOTE]
> Cross-mentoring (`1on1_cross`) in HAM involves one mentee meeting with a mentor who is not their primary assigned mentor. It is distinct from cross-program mentoring. The `mssv_tag` field (e.g., [REDACTED_MSSV]) encodes the mentee's registration code.

---

## 5. What Can Be Imported Safely Now

| Data Set | Import-Ready Rows | Target VAM OS Table |
|---|---|---|
| Mentor people | **52** | `people` + `person_roles` (mentor) |
| Mentee people | **60** | `people` + `person_roles` (mentee) |
| Mentor–Mentee matches | **60** | `matches` |
| 1on1 recaps (primary + cross) | **73** | `mentoring_recaps` |
| Group / event recaps | **25** | `event_participations` or `mentoring_recaps` with `group` flag |
| **TOTAL** | **270** | |

**Pre-conditions for import:**
1. `people` table must have HAM mentors + mentees loaded first (or cross-referenced against existing VAM OS people records)
2. `matches` table requires `people.id` FKs → must resolve name→ID before inserting
3. `mentoring_recaps` requires `match_id` FK → matches must be imported first

### 5.1 Staging identity-resolution dry run

A staging-only dry run was completed against the VAM OS `people`, `mentor_profiles`, and `mentee_profiles` tables using `ham_people_clean.csv`.

Output files:

- `data_imports/ham/ham_identity_resolution_dry_run.csv`
- `data_imports/ham/ham_identity_resolution_summary.csv`
- `data_imports/ham/ham_identity_duplicate_names.csv`

Matching priority used:

1. Normalized email.
2. Normalized phone.
3. Unique normalized name plus school/company/profile context overlap.
4. Otherwise mark as manual review or new-person candidate.

Dry-run result:

| Result | Count |
|---|---:|
| Total HAM people rows | 112 |
| Exact email matches | 0 |
| Phone matches | 1 |
| High-confidence name + context matches | 1 |
| Ambiguous matches | 0 |
| Manual review name-only candidates | 4 |
| No-match / new people candidates | 106 |
| Duplicate email values in HAM source | 0 |
| Duplicate normalized name values in HAM source | 1 |
| Safe matches to existing mentor profiles | 1 |
| Safe matches to existing mentee profiles | 1 |
| Manual-review candidates with existing profiles | 4 |
| Rows unsafe to import automatically | 4 |

Interpretation:

- Only 2 HAM rows can be linked automatically to existing staging people.
- 106 rows should be treated as new HAM people candidates in a future staging import.
- 4 rows are unsafe for automatic linking because they are name-only matches without enough school/company/context evidence.
- The duplicate-name source case is [REDACTED_NAME] across mentor and mentee rows; emails differ, so email should remain the import key.

Do not auto-link manual-review rows by name only. Resolve them by email, phone, or human-confirmed identity before importing matches or recaps.

---

## 6. What Must Be Manually Reviewed

| Issue | Rows | Reason |
|---|---|---|
| Missing mentee (not extractable from body) | 48 | Body text too informal/unstructured |
| Missing mentor (column + body both blank) | 13 | Unclear post attribution |
| Unknown activity type | 5 | Cannot safely classify |
| Short body (<50 chars) | 2 | Insufficient content |
| **Total flagged** | **65** | (some rows have multiple issues) |

All flagged rows are in `ham_manual_review_issues.csv`.

---

## 7. Recommended VAM OS Target Tables

```
Mentor S6 + Mentee S6
  → people (name, email, phone, school, company, gender)
  → person_roles (role=mentor/mentee, program=HAM, season=HAM_S6)

Mentee S6 (mentor assignment column)
  → matches (mentee_id, mentor_id, season=HAM_S6, status=matched)

Recap S6 (1on1_primary, 1on1_cross)
  → mentoring_recaps (match_id, recap_url, meeting_date, activity_type, body_snippet)

Recap S6 (training_event, orientation_or_intro, community_activity)
  → events (event_name, event_date, location, type)
  → event_participations (event_id, person_id, role)

Recap S6 (group_mentoring)
  → mentoring_recaps with group_flag=TRUE OR → event_participations
```

> [!IMPORTANT]
> HAM is a **separate program** from UEHM. The VAM OS schema must support `program_code = HAM` and `season_code = HAM_S6`. Verify that `seasons` and `programs` tables (or equivalent) can accommodate this before staging import.

---

## 8. Risks If Imported Naively

| Risk | Severity | Detail |
|---|---|---|
| Name collision | HIGH | Vietnamese names are short + repetitive. "[REDACTED_NAME_OR_NICKNAME]" exists in multiple mentor rows. Must use email as primary key. |
| Honorific pollution | MEDIUM | Raw mentor names include `Anh/Chị` prefixes — normalised in output but must double-check before FK lookup |
| FB-only identity | HIGH | Several mentors/mentees in recap body are identified only by first name or nickname (e.g., "[REDACTED_NAME_OR_NICKNAME]", "[REDACTED_NAME_OR_NICKNAME]") — cannot reliably match to `people` table |
| Group recap FK | MEDIUM | Group mentoring recaps involve 3–13 people — no standard `match_id` applies; would need group session object or multi-row fan-out |
| Program isolation | LOW | HAM data must not bleed into UEHM stats — ensure `program_code` filter on all KPI queries |
| Duplicate recap | LOW | Same recap may have been posted by multiple people (author != mentor) — check for identical `fb_post_link` |
| Season enum missing | LOW | `HAM_S6` may not exist in VAM OS `seasons` table — add before import |

---

## 9. Recommended Staging Import Sequence

```
Step 1 — Seed program/season metadata
  INSERT INTO programs (code='HAM', name='Ha Noi Alumni Mentoring')
  INSERT INTO seasons (code='HAM_S6', program='HAM', label='Season 6')

Step 2 — Import people
  Source: ham_people_clean.csv (112 rows, all import-ready)
  Target: people + person_roles
  Key: email (primary), phone (secondary), name (fuzzy fallback)

Step 3 — Import matches
  Source: ham_matches_clean.csv (60 rows, all import-ready)
  Target: matches
  Requires: mentee.person_id + mentor.person_id from Step 2

Step 4 — Import 1on1 recaps
  Source: ham_recaps_clean.csv (73 import-ready rows)
  Target: mentoring_recaps
  Requires: match_id from Step 3
  Skip: rows where import_ready=FALSE until manual review resolves identity

Step 5 — Import group/event activities
  Source: ham_events_or_group_activities_clean.csv (25 import-ready rows)
  Target: events + event_participations (training/orientation/community)
         mentoring_recaps with group_flag (group_mentoring rows)
  Requires: events table extended with HAM-specific types (training, community)

Step 6 — Manual review resolution
  Source: ham_manual_review_issues.csv (65 rows)
  Action: Human resolves identity for rows with missing mentor/mentee
  Then: Re-run import with resolved rows
```

---

## 10. Go / No-Go Recommendation

| Component | Decision | Condition |
|---|---|---|
| People (mentors + mentees) | ✅ **GO** | All 112 rows import-ready |
| Matches | ✅ **GO** | All 60 rows import-ready — pending Step 2 completion |
| 1on1 Recaps (73 rows) | ⚠️ **CONDITIONAL GO** | Requires identity resolution: mentor name → person_id |
| Group/Event activities (25 rows) | ⚠️ **CONDITIONAL GO** | Requires events table HAM type support |
| 48 flagged recap rows | 🔴 **NO-GO** | Manual review required first |
| 5 unknown-type rows | 🔴 **NO-GO** | Cannot classify safely |

> [!IMPORTANT]
> **Do not import recap rows until mentor/mentee identity has been cross-referenced against the `people` table.** The current data links people by display name only — this is insufficient for FK integrity.

---

## 11. Key Schema Gaps Identified

| Gap | Table | Detail |
|---|---|---|
| `program_code = HAM` | `programs` / `seasons` | HAM is not UEHM — needs its own program row |
| `season_code = HAM_S6` | `seasons` | Season 6 not yet in DB |
| `activity_type = 1on1_cross` | `mentoring_recaps` | Cross-mentoring type may not exist in enum |
| `group_mentoring` flag | `mentoring_recaps` | No group session concept in current MVP schema |
| Mentee `direction` / career goal | `mentee_profiles` | Rich field in source — schema gap if not stored |
| Mentor `activity_preferences` | `mentor_profiles` | Rich field in source — what mentoring formats they prefer |
| `mssv_tag` ([REDACTED_MSSV]) | `people` | HAM registration codes — not in current VAM OS schema |

---

## 12. Output Files Generated

| File | Rows | Purpose |
|---|---|---|
| `ham_people_clean.csv` | **112** | All mentors + mentees, import-ready |
| `ham_matches_clean.csv` | **60** | Mentor–mentee assignments, import-ready |
| `ham_recaps_clean.csv` | **121** | All 1on1 recap rows (73 import-ready, 48 flagged) |
| `ham_events_or_group_activities_clean.csv` | **42** | Group/event rows (25 import-ready, 17 flagged) |
| `ham_manual_review_issues.csv` | **65** | All flagged issues across all sheets |
| `ham_summary_by_file.csv` | **5** | Per-sheet summary with counts |

All files: UTF-8 with BOM, comma-separated, in `data_imports/ham/`.  
Audit script: `data_imports/ham/scripts/ham_audit_clean.py`

---

## 13. Recommended Next Step for Codex

1. **Identity resolution pass** — cross-reference `ham_people_clean.csv` against existing VAM OS `people` table (if HAM mentors/mentees overlap with UEHM). Use email as primary key.
2. **Season seed** — add `HAM` program and `HAM_S6` season to staging DB.
3. **People import** — run Step 2 of the import sequence above.
4. **Match import** — after people are resolved, import matches with proper `person_id` FK.
5. **Manual review of 65 flagged rows** — human review of `ham_manual_review_issues.csv`, update mentee names, then re-classify.
6. **Recap import** — run Steps 4–5 only after identity FKs are confirmed.

---

*HAM Season 6 Data Audit — VAM OS Codex — 2026-05-07*  
*No DB import performed. Audit only. All outputs are staging-preparation CSVs.*  
*Internal document. Do not distribute.*
