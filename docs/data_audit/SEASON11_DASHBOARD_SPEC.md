# VAM OS – Season 11 Dashboard Implementation Spec

> **Purpose:** Define the UI/UX, logic, and implementation sequencing for the Founder Dashboard and Operations pages.
> **Core Principle:** Founder-readable in 5 seconds, Operations-useful for deep dives. 
> **Latest Closed Month:** March 2026. April 2026 is strictly excluded.

---

## 1. Founder Dashboard Top KPI Cards

Recommend exactly 6 KPI cards for optimal scanning. All calculations default to the latest closed month (March 2026).

| Vietnamese Label | Technical Name | Definition & Calculation | Expected Drill-down | Risk if Wrong |
| :--- | :--- | :--- | :--- | :--- |
| **Tổng số bản recap** | `total_recap_entries` | Total raw recaps submitted. Counts multiple per mentee. | Opens `/operations/recap-log` | Inflates perceived mentoring volume. |
| **% mentee có recap** | `pct_mentees_with_recap` | `(Distinct mentees with recap / Total season mentees) * 100` | Opens `/operations/active-mentees` | Misrepresents program engagement health. |
| **Mentee hoạt động** | `active_mentees` | `COUNT(DISTINCT mentee_id)` with >=1 recap in Mar 2026. | Opens `/operations/active-mentees` | Misses actual coverage metrics. |
| **Mentee thiếu recap** | `missing_recap` | Mentees with NO recap in Mar 2026. | Opens `/operations/missing-recap` | Overlooks short-term engagement drops. |
| **Im lặng 2 tháng** | `silent_two_months` | NO recap in Feb 2026 AND Mar 2026. | Opens `/operations/follow-up-queue` | Fails the official warning protocol. |
| **Vấn đề dữ liệu** | `data_quality_issues`| Unresolved QA warnings/blocks for the closed month. | Opens `/data-qa` | Masks underlying import/pipeline bugs. |

---

## 2. Operations Page Sections

The Operations page is the execution layer for admins.

1. **Current closed month status**: A banner declaring "Đang hiển thị dữ liệu tháng đóng: 03/2026" to prevent confusion with open months.
2. **Follow-up Queue (Im lặng 2 tháng)**: The most critical list. Shows mentees missing recaps for 2 consecutive months. Actions: Ping mentor, ping mentee.
3. **Missing latest closed month**: Mentees missing March 2026. Actions: Soft nudge.
4. **Active mentees**: List of mentees who successfully submitted recaps in March 2026. 
5. **Data quality issues**: A dedicated console for admins to resolve ID mismatches, duplicate events, or unmatched enums.

---

## 3. Monthly Trend Charts

Keep charts minimal and focused on the rolling history (Season 11 so far).

*   **Tổng số bản recap (Bar Chart)**: Shows total volume by month. Useful to spot seasonal spikes.
*   **% mentee có recap (Line Chart)**: The primary health trajectory. Target is typically >70%.
*   **Mentee im lặng 2 tháng (Line Chart, Red)**: Should ideally trend downwards as operations follows up.
*   *(Optional)* **Phân loại hoạt động (Stacked Bar)**: Breakdown of mentoring 1:1, cross-mentoring, training, etc.

---

## 4. Drill-Down Behavior

Every KPI must be clickable.

*   **Clicking "Tổng số bản recap"** -> Opens the **Raw Recap Log**. A flat table showing `Date | Mentor | Mentee | Type | Link`.
*   **Clicking "Mentee hoạt động" / "% mentee"** -> Opens the **Active Mentees List**. Shows `Mentee Name | Assigned Mentor | Recap Count this Month`.
*   **Clicking "Mentee thiếu recap"** -> Opens the **Missing Recap List**. Shows `Mentee Name | Assigned Mentor | Last Active Month`.
*   **Clicking "Im lặng 2 tháng"** -> Opens the **Follow-up Queue**. Specifically filters for the 2-month silent rule.
*   **Clicking a chart data point** -> Filters the operations table to that specific historical month.

---

## 5. Vietnamese Wording & Helper Texts

*   **Label:** Tổng số bản recap
    *   *Helper Text:* "Tổng số lượt ghi nhận hoạt động trong tháng đóng. Một mentee có thể có nhiều lượt."
*   **Label:** Số mentee có recap
    *   *Helper Text:* "Số lượng mentee tham gia ít nhất 1 hoạt động trong tháng."
*   **Label:** Mentee thiếu recap
    *   *Helper Text:* "Mentee không có hoạt động nào trong tháng đóng mới nhất (Tháng 3/2026)."
*   **Label:** Cần follow-up (Im lặng 2 tháng)
    *   *Helper Text:* "Mentee không có recap trong 2 tháng liên tiếp. Cần liên hệ ngay với Mentor/Mentee."
*   **Label:** Tháng đóng (Closed Month)
    *   *Helper Text:* "Tháng đã chốt dữ liệu chính thức. Tháng hiện tại (Tháng 4/2026) đang mở và không tính vào KPI."
*   **Empty State (Follow-up):** "Tuyệt vời! Không có mentee nào im lặng 2 tháng liên tiếp."

---

## 6. What NOT to Show Yet

To avoid clutter and confusion, defer these until Phase C:
*   **Mentor Overload Indicators**: Wait until `mentor_assignments` are 100% accurate.
*   **Mentor Coverage Ratios**: Wait until the denominator (assigned mentees) is verified.
*   **Open Month Data (April 2026)**: Must be completely hidden to prevent fluctuating KPIs.
*   **Predictive Churn Models**: Too complex; rely on the deterministic 2-month silent rule for now.
*   **Cross-mentoring Matrix**: Wait until activity type enums are perfectly clean.

---

## 7. Codex Implementation Sequencing

### Phase A: UI Shell & Static Logic
*   Build the frontend React components for the 6 KPI cards using dummy data or existing fallback logic.
*   Build the Operations page tab structure (Active, Missing, Follow-up, QA).
*   Add the Vietnamese UX wording and tooltips.
*   *Goal: Get Founder sign-off on the layout before wiring real data.*

### Phase B: Staging Data Wiring
*   *(After the Staging Schema and Data Import are complete)*
*   Wire the KPI cards to read from the staging `v_season_monthly_kpis` view.
*   Wire the Follow-up queue to read from the staging `v_mentee_dashboard` view.
*   Enforce the `WHERE closed = TRUE` or `month = 3 AND year = 2026` logic strictly in the API/Frontend.
*   *Goal: Perform UAT (User Acceptance Testing) in staging.*

### Phase C: Intelligence & Trends
*   Build the Recharts trend graphs.
*   Implement drill-down click handlers to pass the selected month to the Operations table.
*   Deploy to production once data QA is completely clear.
