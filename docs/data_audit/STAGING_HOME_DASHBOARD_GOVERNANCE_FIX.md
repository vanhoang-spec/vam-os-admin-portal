# Staging Home Dashboard Governance Fix

This document outlines the root cause and fix for the discrepancy between the Home Dashboard and the Operations page KPIs during staging QA, specifically after the previous attempted fix failed.

## Issue Summary
* **Operations Page:** Correctly displayed `Tháng đã chốt = 2026-03`, `recap = 271`, `active mentee = 224`, `Follow-up = 451`.
* **Home Dashboard:** Displayed `Số recap tháng này = 25`, `Mentee active = 0`, `Sức khỏe mentee - 2026-04`.

## Root Cause (Why Previous Fix Failed)
The previous fix attempted to extract the closed month directly in `app/page.tsx` using `data.latestClosedMonth.data.find(...)`. However, it still relied solely on `getDashboardData()`, which fetches its own `seasons` list using an explicit column select (to avoid schema cache issues).

But `app/operations/page.tsx` receives its fully verified data (including `kpis` and dynamic RPC logic) directly from `getOperationsData()`, completely bypassing RLS issues and schema cache issues because it retrieves the `seasons` and current `latestClosedMonth` inside an SQL RPC (`get_operations_dashboard_data`). By executing the query server-side via the RPC, Operations avoided client-side RLS filtering or schema cache mismatches that `getDashboardData` was experiencing. 

Because `app/page.tsx` was still pulling raw client-side fetched data, it silently failed to match `season_id`, `officialClosedMonth` stayed `null`, and it fell back to generating `2026-04` raw unverified metrics (resulting in 25 recaps).

## Refactoring Fix Applied

1. **Directly Reused `getOperationsData()`**:
   Instead of maintaining separate fallback and fetch logic in `app/page.tsx`, we imported `getOperationsData()` into the Home Dashboard to act as the ultimate source of truth for all official KPIs.
   
2. **Explicit Governance KPI Binding**: 
   We explicitly mapped the official KPIs directly from `opsData`:
   - `homeRecapKpi` pulls from `total_recap_entries` (or `opsData.kpis.data.recapCount`).
   - `homeMenteeActiveKpi` pulls from `distinct_mentees_with_recap` (or `opsData.kpis.data.activeMenteeCount`).
   - `homeMentorActiveKpi` pulls from `opsData.kpis.data.activeMentorCount`.
   - `homeFollowUpKpi` leverages the exact same `closedMonth` and `closedPreviousMonth` logic that successfully produced `451` on the Operations page.

3. **Removed Legacy Fallbacks**:
   The dashboard no longer falls back to `latestNonFutureMonth` (`2026-04`) for official KPI values. If `officialClosedMonth` is missing, the dashboard will warn the user: `Đang hiển thị tháng mở {opsSelectedMonth} do chưa có dữ liệu chốt`.

4. **Dev Diagnostics Added**:
   A visual debug block has been added to the top of the Home Dashboard displaying the backend variables (e.g., `homeOfficialClosedMonth`, `homeOperationsSelectedMonth`) so QA can instantly verify the data binding path.

## Manual QA Checklist (Post-Redeploy)
- [ ] Hard refresh `/`.
- [ ] Ensure the `[DEBUG DIAGNOSTICS]` block is hidden in staging/production (it is now behind a `process.env.NODE_ENV === "development"` flag).
- [ ] Verify the label explicitly states `Tháng đã chốt: 2026-03`.
- [ ] Verify `Số recap tháng này = 271`.
- [ ] Verify `Mentee active tháng này = 224`.
- [ ] Verify `Mentor active tháng này = 180`.
- [ ] Verify `Im lặng 2 tháng liên tiếp / cần follow-up = 451`.
- [ ] Verify `Sức khỏe mentee` chart is labeled with `2026-03` and not `2026-04`.
