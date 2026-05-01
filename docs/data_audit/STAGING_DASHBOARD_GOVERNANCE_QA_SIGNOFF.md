# Staging Dashboard Governance QA Sign-Off

**Date/Time of QA:** 2026-05-01T10:50:49+07:00
**Status:** PASS

## Summary
The staging dashboard governance QA is now formally marked as **PASS**. The discrepancies between the Home Dashboard and the Operations page have been successfully resolved, and all KPI metrics are perfectly aligned and accurately anchored to the official closed-month data.

## Pages Checked
1. **Home Dashboard** (`/`)
2. **Operations - Closed Month** (`/operations?month=2026-03`)
3. **Operations - Open Month Edge Case** (`/operations?month=2026-04`)

## Expected vs Observed KPI Table

| Metric | Expected Value | Observed on `/` | Observed on `/operations?month=2026-03` |
|--------|----------------|-----------------|-----------------------------------------|
| Tháng đã chốt / Governance Label | 2026-03 | 2026-03 | 2026-03 |
| Số recap | 271 | 271 | 271 |
| Mentee active | 224 | 224 | 224 |
| Mentor active | 180 | 180 | 180 |
| Mentee active tháng đã đóng | 213 | 213 | (Metric on Home Chart) |
| Chưa có recap tháng gần nhất | 451 | 451 | (Metric on Home Chart) |
| Im lặng 2 tháng liên tiếp / follow-up | 451 | 451 | 451 |

**`/operations?month=2026-04` Validation:**
* **Tháng vận hành:** 2026-04
* **Tháng đã chốt:** 2026-03
* **Warning Label:** `Dữ liệu tháng mở không dùng cho KPI chính thức`
* **Observation:** The April open-month context is accessible, but it correctly flags that it is not the official KPI month. Follow-up suggestions remain cleanly anchored to the closed-month logic, preventing any data bleed.

## Notes & Architecture Validation
* **Environment:** The Vercel staging environment now accurately points to the Supabase staging database instance.
* **Refactoring:** The Home Dashboard official KPI cards successfully reuse the `getOperationsData()` governance payload, guaranteeing single-source-of-truth accuracy.
* **Edge Cases:** The open month of April (`2026-04`) is correctly isolated and labeled as non-official.

## Remaining Known Issues
* **Vietnamese Mojibake:** There are known encoding corruptions (mojibake) in mentor and mentee display names. 
* **Impact:** This is strictly a data remediation and source-import issue, not a dashboard or governance logic blocker. It does not affect KPI calculations.

## Production Rollout Status
* **Approval Status:** **NOT YET APPROVED.**
* **Next Steps:** 
  1. A separate production migration and deployment plan must be drafted.
  2. A strategic decision must be made on whether to execute the Vietnamese encoding data remediation *before* or *after* the production rollout.
