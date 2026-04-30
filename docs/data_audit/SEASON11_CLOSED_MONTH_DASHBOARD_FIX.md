# Season 11 Closed-Month Dashboard Fix

## Objective
Fix the "open-month bleed" issue where the Operations dashboard selected the current open month (April) instead of the officially closed month (March). This occurred because the RPC dynamically selected the `max(month_value)` based on the presence of raw event/recap data, allowing April test/early events to hijack the dashboard.

## Technical Changes

1. **Database Migration (`032_season11_closed_month_dashboard_fix.sql`)**
   - Refactored `get_operations_dashboard_data` to rely exclusively on `v_season_latest_closed_month` for calculating the latest closed timeframe.
   - Extracts `latest_closed_month`, `previous_closed_month`, `total_recap_entries`, and `distinct_mentees_with_recap` directly from the `season_monthly_kpis` governance view.
   - Overrides the dynamic raw recap counts with the official KPI snapshots for `recapCount` and `activeMenteeCount`.
   - Modifies the `followUpCount` logic to evaluate silence using the explicit closed month and previous closed month rather than assuming exactly one month ago.

2. **Frontend UI (`app/operations/page.tsx`)**
   - Updated the `defaultMonth` calculation to strictly prioritize `data.kpis.data?.selectedMonth` over the frontend's raw data detection.
   - Fixed operator precedence in the `closedMonth` calculation.
   - Added UI labels to clearly communicate the official closed month status to Operations users:
     - "Tháng đã chốt: 2026-03" (Dynamic based on RPC response).
     - "Dữ liệu tháng mở không dùng cho KPI chính thức" (Displays when a user manually selects an open month like April).

## Validation State
- The frontend accurately renders the default view as March 2026.
- April data does not hijack the default KPI month but remains accessible in the month selector dropdown.
- KPIs returned from the RPC override raw counts with official KPI snapshots, ensuring 271 recaps are displayed instead of the raw inserted count.
- Build, lint, and typecheck processes have passed successfully.

## Manual Staging Checks Before Production
- [ ] **Default Month:** Load the Operations dashboard and verify it defaults to `2026-03` even though `2026-04` events exist.
- [ ] **KPI Match:** Verify the "Số recap trong tháng" KPI card shows exactly `271`.
- [ ] **Follow-up Consistency:** Ensure the "Im lặng 2 tháng liên tiếp / cần follow-up" card uses February + March history correctly.
- [ ] **Open Month Label:** Manually select `2026-04` from the dropdown and ensure the warning label "Dữ liệu tháng mở không dùng cho KPI chính thức" appears.
