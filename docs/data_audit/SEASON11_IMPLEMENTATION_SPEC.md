# VAM OS – Season 11 Data Implementation Specification

> **Purpose:** Consolidate every design decision (source-of-truth, metric dictionary, UI hierarchy, Vietnamese UX copy, follow-up logic, QA & deduplication rules) into a single implementation blueprint.
> **Next Technical Step:** Run a **Codex schema-gap analysis** to confirm which Supabase objects already exist, which can be reused, and which must be created. No data imports or production schema changes should happen yet.

---

## 1. Final Metric Dictionary

**Important Rules:**
* **Latest closed month** = March 2026.
* **Follow-up comparison months** = February 2026 and March 2026.
* **Open month** = April 2026 (strictly excluded from all KPIs).

| Vietnamese Label | Technical Name | Definition | Primary Source |
| :--- | :--- | :--- | :--- |
| **Tổng số bản recap** | `total_recap_entries` | Total recap entries submitted. Multiple per mentee allowed. | `Báo cáo Recap` (KPI) / `Cleaning data` (Drill-down) |
| **Bản recap mentoring hợp lệ** | `valid_mentoring_recap` | Recap entries specifically classified as 1:1 mentoring. | `Cleaning data` |
| **Số mentee có recap** | `distinct_mentees_with_recap` | Unique mentees with >=1 recap. Counts each mentee only once. | `Mentee Tracking` |
| **Số cặp mentor–mentee có recap**| `distinct_mentor_mentee_pairs` | Unique (mentor, mentee) combinations with >=1 recap. | `Cleaning data` |
| **Mentee hoạt động** | `active_mentees_latest_month`| Mentees with >=1 recap in March 2026. | `Mentee Tracking` |
| **Mentee thiếu recap** | `missing_recap_latest_month` | Mentees with NO recap in March 2026. | `Mentee Tracking` |
| **Mentee im lặng 2 tháng** | `silent_two_months` | Mentees with NO recap in both Feb 2026 AND Mar 2026. | `Mentee Tracking` |
| **Mentor có mentee hoạt động** | `mentors_with_active_mentees` | Mentors with at least one active mentee in Mar 2026. | `Cleaning data` |
| **Khối lượng hoạt động mentor** | `mentor_activity_volume` | Total recaps submitted by each mentor. | `Cleaning data` |
| **Hoạt động đặc biệt** | `activity_type_counts` | Training, cross-mentoring, company visit counts. | `Cleaning data` |
| **% mentee có recap** | `pct_mentees_with_recap` | (distinct_mentees_with_recap / total_mentees) * 100. | `Báo cáo Recap` |
| **Độ phủ recap theo mentor** | `recap_coverage_by_mentor` | % of assigned mentees who submitted a recap. | `Cleaning data` + Assignments |
| **Vấn đề dữ liệu** | `data_quality_issue_count` | Unresolved issues in the import/QA process. | `data_quality_issues` |

---

## 2. Source-of-Truth Rules

| Source Sheet | Designation | Usage |
| :--- | :--- | :--- |
| **`Báo cáo Recap`** | **Official KPI Benchmark** | Drives Founder Dashboard KPIs (Total volume, %). |
| **`Mentee Tracking`** | **Engagement & Follow-up** | Drives Distinct Mentee counts, Active/Missing/Silent status, and Follow-up lists. |
| **`Cleaning data`** | **Raw Event Source** | Drives raw drill-downs, activity type breakdowns, and mentor activity volume (post-deduplication). |
| **`Overview`** | **Historical Baseline** | Season 10 comparisons only. Not for current operational metrics. |

---

## 3. Dashboard Display Rules

### Founder Dashboard (KPI Cards)
* *Tổng số bản recap (Tháng 3/2026)*
* *% mentee có recap (Tháng 3/2026)*
* *Mentee hoạt động (Tháng 3/2026)*
* *Mentee thiếu recap (Tháng 3/2026)*
* *Mentee im lặng 2 tháng (Feb-Mar 2026)*
* *Vấn đề dữ liệu*

### Operations Page
* **Follow-up queue**: Lists "Mentee im lặng 2 tháng".
* **Missing latest closed month**: Lists mentees missing March 2026 recaps.
* **Active mentees**: Lists mentees with recaps in March 2026.
* **Data issues**: Unresolved QA warnings/blocks.

### Mentors / Mentees Pages
* Will feature new badges (e.g., `🟢 Active`, `🔴 Silent 2 months`, `⚠️ Quá tải`) and new derived columns (e.g., `Tháng recap mới nhất`, `Chỉ số quá tải`).

---

## 4. Operations Follow-up Logic

1.  **Logic Basis**: Follow-up is strictly based on whether a mentee has **at least one** recap. Submitting 1 recap or 5 recaps counts identically for follow-up purposes.
2.  **Priority 1 (Im lặng 2 tháng)**: NO recap in Feb 2026 AND NO recap in Mar 2026. This is the official warning threshold.
3.  **Priority 2 (Thiếu 1 tháng)**: NO recap in Mar 2026, but HAD recap in Feb 2026.

---

## 5. Data QA Rules

*   **Block (No-Go)**: 
    *   Missing/Invalid Mentor IDs or Mentee IDs in event rows.
    *   Duplicate exact rows surviving deduplication.
    *   Total recap count from events differs drastically (< 90%) from `Báo cáo Recap`.
    *   Closed flag not set for March 2026.
*   **Warning (Proceed with Note)**:
    *   Total recap rows differ by <= 5% from official totals.
    *   Activity type formatting inconsistencies.
*   **Action**: All discrepancies log to a `data_quality_issues` table. Blocks prevent staging/production rollout.

---

## 6. Deduplication Rules

1.  **Exact Duplicate Rows**: (Same Mentor + Mentee + Date + Type + Text) -> **REMOVE**.
2.  **Multiple Distinct Recaps**: Same mentee, multiple *different* recaps in the same month -> **KEEP**. (Counts multiple times for volume, counts once for mentee engagement).
3.  **Missing IDs**: Cannot map to `person_id` -> **REMOVE** from import, flag as Block error.
4.  **Invalid Type**: -> **NORMALIZE** to nearest valid enum.

---

## 7. Required Supabase Objects

### A. Definitely Needed (Must exist or be created)
*   `season_monthly_kpis`: Table or materialized view for official monthly aggregates. Must have a `closed` boolean column.
*   `recap_events`: Table for raw event-level data (source: `Cleaning data`).
*   `data_import_batches`: Table for auditability and import rollback.
*   `data_quality_issues`: Table for tracking QA discrepancies.

### B. Maybe Reusable (Likely exists, needs verification)
*   `mentor_profiles`: For mentor lookups and industry/function data.
*   `mentee_profiles`: For mentee lookups.
*   `mentor_assignments`: Mapping of mentees to assigned mentors.
*   `people`: Core user table.

### C. Should Wait Until Codex Schema Gap Analysis
*   `v_mentor_dashboard`: Materialized view pre-computing mentor stats (overload, coverage).
*   `v_mentee_dashboard`: Materialized view pre-computing mentee stats (silent 2 months, missing 1 month).
*   Trigger functions for data QA or audit logs.

---

## 8. Codex Next Task: Schema Gap Analysis

**Do not write the final SQL import yet.** 
The next required prompt for Codex is:
*"Please review the current Supabase schema and compare it against the 'Required Supabase Objects' listed in the Implementation Spec. Identify missing tables, missing columns (e.g., `closed` flag), and misaligned types. Output a schema migration plan."*

---

## 9. Supabase Staging Checklist

1.  [ ] Schema migration applied to `public_staging` (or equivalent staging environment).
2.  [ ] Lookups confirmed: `mentee_id` and `mentor_id` mappings succeed.
3.  [ ] `closed = TRUE` applied ONLY to March 2026 and prior.
4.  [ ] April 2026 strictly excluded (`closed = FALSE` or excluded from import).
5.  [ ] All inserts/updates wrapped in a transaction.
6.  [ ] Import batch logged.

---

## 10. Production Blocking Issues

Any of the following **MUST** block a production deployment:
1.  **Open Month Bleed**: April 2026 data appearing in KPI cards.
2.  **Missing Closed Flag**: March 2026 missing the `closed` status.
3.  **Duplicate Events**: Exact duplicates not removed prior to DB insertion.
4.  **Orphan Records**: `recap_events` with `NULL` mentor or mentee references.
5.  **Unresolved Blocks**: Any `Block`-severity issue in the Data QA audit report.
