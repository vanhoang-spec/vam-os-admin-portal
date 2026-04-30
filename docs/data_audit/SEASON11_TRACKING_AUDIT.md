# Season 11 Tracking Workbook Audit

Generated from: `C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\TRACKING _ SEASON 11.xlsx`

## Scope Guardrails

- No Supabase schema changes.
- No Supabase data changes.
- No dashboard or UI changes.
- No migrations, import SQL, or CSV import files generated.
- Discrepancies are flagged for review only, not auto-corrected.

## Closed-Month Logic

- Latest closed month: **2026-03 / March 2026**.
- Follow-up comparison months: **2026-02 and 2026-03 / February 2026 and March 2026**.
- **2026-04 / April 2026 is open and excluded** from closed-month operations KPIs.

## Workbook Sheets

| # | Sheet | Non-empty rows | Audit role |
| --- |--- |--- |--- |
| 1 | Overview | 28 | Season 10 baseline / historical comparison only |
| 2 | DATA TỔNG | 655 | Reference only |
| 3 | Mentee Tracking | 663 | Mentee-by-month tracking and silent/follow-up logic |
| 4 | Sheet20 | 1757 | Reference only |
| 5 | Báo cáo Recap | 23 | Season 11 official monthly KPI benchmark |
| 6 | Raw data | 1842 | Reference only |
| 7 | nháp tháng 1 | 2886 | Reference only |
| 8 | Sheet18 | 897 | Reference only |
| 9 | Mentor Tracking | 378 | Reference only |
| 10 | Sheet12 | 138 | Reference only |
| 11 | Sheet15 | 3384 | Reference only |
| 12 | Cleaning data | 3854 | Candidate normalized raw recap event source |

## Season 10 Baseline From Overview

| Metric | T11 | T12 | T1 | T2 | T3 | T4 | T5 | T6 | T7 | Tổng |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |--- |--- |
| TỔNG SỐ BÀI RECAP | 559 | 462 | 350 | 137 | 275 | 0 | 0 | 0 | 0 | 1783 |
| MENTORING 1-1 | 536 | 347 | 245 | 333 | 205 | 271 | 0 | 0 | 0 | 1937 |
| CROSSMENTORING | 3 | 11 | 12 | 4 | 12 | 0 | 0 | 0 | 0 | 42 |
| TRAINING | 9 | 104 | 86 | 3 | 44 | 0 | 0 | 0 | 0 | 246 |
| MENTEE VIẾT RECAP | 0 | 491 | 323 | 297 | 121 | 224 | 0 | 0 | 0 | - |
| MENTEE CHƯA VIẾT RECAP | 400 | 166 | 333 | 358 | 534 | 369 | 489 | 451 | 451 | - |
| TỔNG SỐ LƯỢNG MENTEE | 400 | 657 | 656 | 655 | 655 | 593 | 489 | 451 | 451 | - |

## Season 11 Monthly KPI Benchmark From Báo Cáo Recap

| Month | Số recap | Mentee viết recap | Tổng số mentee | Writer rate | Closed KPI? |
| --- |--- |--- |--- |--- |--- |
| 2025-11 | 533 | 491 | 657 | 74.7% | Yes |
| 2025-12 | 462 | 323 | 656 | 49.2% | Yes |
| 2026-01 | 343 | 297 | 655 | 45.3% | Yes |
| 2026-02 | 126 | 121 | 655 | 18.5% | Yes |
| 2026-03 | 271 | 224 | 593 | 37.8% | Yes |
| 2026-04 | 0 | 0 | 489 | 0% | No - open month |
| 2026-05 | 0 | 0 | 451 | 0% | No |
| 2026-06 | 0 | 0 | 451 | 0% | No |
| 2026-07 | 0 | 0 | 400 | 0% | No |

## Mentee Status Counts From Mentee Tracking

Data rows counted: **659**.

| Status | Count |
| --- |--- |
| Active | 591 |
| Off | 66 |
| Consider | 2 |

## Monthly Recap Counts Derived From Mentee Tracking

| Month | Recap count | Mentees with recap |
| --- |--- |--- |
| 2025-11 | 559 | 513 |
| 2025-12 | 462 | 369 |
| 2026-01 | 350 | 297 |
| 2026-02 | 137 | 133 |
| 2026-03 | 275 | 229 |
| 2026-04 | 0 | 0 |
| 2026-05 | 0 | 0 |
| 2026-06 | 0 | 0 |
| 2026-07 | 0 | 0 |

## Monthly Raw Recap/Event Counts Derived From Cleaning Data

Data rows counted: **1840**.

Type counts use explicit `Cleaning data` flag columns when present, with hashtag/text markers as a fallback when cached formula flags are blank.

| Month | Raw rows | Mentoring | Cross mentoring | Training | Company visit |
| --- |--- |--- |--- |--- |--- |
| 2025-11 | 564 | 546 | 4 | 21 | 2 |
| 2025-12 | 481 | 325 | 11 | 145 | 0 |
| 2026-01 | 372 | 238 | 15 | 113 | 0 |
| 2026-02 | 137 | 119 | 4 | 13 | 1 |
| 2026-03 | 286 | 203 | 15 | 61 | 0 |

## Difference Table

Comparison basis: official `Báo cáo Recap` monthly `Số recap` vs derived `Mentee Tracking` recap totals vs raw `Cleaning data` row counts.

| Month | Báo cáo Recap | Mentee Tracking | Cleaning data | Mentee diff | Cleaning diff | Flag | Month status |
| --- |--- |--- |--- |--- |--- |--- |--- |
| 2025-11 | 533 | 559 | 564 | 26 | 31 | Review | Closed month |
| 2025-12 | 462 | 462 | 481 | 0 | 19 | Review | Closed month |
| 2026-01 | 343 | 350 | 372 | 7 | 29 | Review | Closed month |
| 2026-02 | 126 | 137 | 137 | 11 | 11 | Review | Closed month |
| 2026-03 | 271 | 275 | 286 | 4 | 15 | Review | Closed month |
| 2026-04 | 0 | 0 | 0 | 0 | 0 | OK | Open month excluded from closed KPI |
| 2026-05 | 0 | 0 | 0 | 0 | 0 | OK | Future/reference only |
| 2026-06 | 0 | 0 | 0 | 0 | 0 | OK | Future/reference only |
| 2026-07 | 0 | 0 | 0 | 0 | 0 | OK | Future/reference only |

## Key Findings

- March 2026 appears present in all three relevant sources: Báo cáo Recap=271, Mentee Tracking=275, Cleaning data=286.
- April 2026 appears in the benchmark/tracking structure, but has zero recap activity and is treated as open/excluded.
- `Báo cáo Recap` is the official Season 11 monthly KPI benchmark.
- `Mentee Tracking` is useful for follow-up and silent mentee logic, but its monthly totals do not fully match the official KPI benchmark.
- `Cleaning data` is a candidate normalized raw event source, but its row counts do not fully match the official KPI benchmark.

## Recommended Next Step

Review the discrepancy rows for closed months, especially November 2025, January 2026, February 2026, and March 2026, then decide which differences are expected due to deduplication/type rules before designing any import SQL or database changes.
