# Staging Home Dashboard Governance Fix

This document outlines the root cause and fix for the discrepancy between the Home Dashboard and the Operations page KPIs during staging QA.

## Issue Summary
* **Operations Page:** Correctly displayed `Tháng đã chốt = 2026-03`, `recap = 271`, `active mentee = 224`.
* **Home Dashboard:** Displayed `Số recap tháng này = 25`, `Mentee active = 0`, `Sức khỏe mentee - 2026-04`.

## Root Cause
The Home Dashboard was unintentionally defaulting to the current open month (`2026-04`) instead of the official closed month (`2026-03`) due to a failed table lookup inside `lib/data.ts`:

1. **Schema Cache Miss on `seasons` table**: `getDashboardData()` was fetching seasons using a standard `select("*")` without explicitly selecting columns. Because of a schema cache issue (likely triggered by the missing `applications` table or recent schema changes), the `seasons` query failed or returned empty.
2. **Missing Season Match**: Because the `seasons` list was empty, the Home Dashboard could not find the current season `UEHM-S11`.
3. **Missing `officialClosedMonth`**: Because the `season_id` couldn't be resolved, the dashboard could not match it against `v_season_latest_closed_month`. This caused the `officialClosedMonth` to evaluate to `null`.
4. **Fallback to 2026-04**: Since `officialClosedMonth` was `null`, the dashboard's fallback logic kicked in (`defaultMonth = officialClosedMonth ?? latestNonFutureMonth`). `latestNonFutureMonth` resolved to `2026-04`.
5. **KPI Recalculation**: The dashboard then pulled all activity for `2026-04`, resulting in the raw, unverified data counts (`25 recaps`).

## Fixes Applied

1. **Robust Data Fetching (`lib/data.ts`)**: 
   - Replaced `getSeasons()` (which used `select *`) with `selectAllTable<Season>("seasons", "id,code,name")`. By explicitly stating the columns, we bypass schema cache errors related to missing optional columns.
2. **Explicit Governance KPI Binding (`app/page.tsx`)**: 
   - Updated the Home Dashboard to explicitly calculate and bind `officialClosedMonth` from the governance view (`v_season_latest_closed_month`), exactly matching the robust logic used in the Operations page.
   - Removed any dependency on dynamic/fallback UI months for the primary KPI cards. 
   - Replaced all legacy `rpcSelectedMonth` references with `officialClosedMonth` to ensure consistent data binding.

## Manual QA Checklist (Post-Redeploy)
- [ ] Hard refresh `/`.
- [ ] Verify the label explicitly states `Tháng đã chốt: 2026-03`.
- [ ] Verify `Số recap tháng này = 271`.
- [ ] Verify `Mentee active tháng này = 224`.
- [ ] Verify `Mentor active tháng này = 180`.
- [ ] Verify `Sức khỏe mentee` chart is labeled with `2026-03` and not `2026-04`.
- [ ] Verify the "Mentee cần follow-up" table matches the Operations page.
