# Season 11 Confirmed Supabase Inspection Findings

Generated: 2026-04-30

## 1. Confirmed Inspection Result
The Supabase inspection confirms exactly how the dashboard selects its default month. The RPC `get_operations_dashboard_data` builds a `months_with_data` set by combining two sources:
1. `public.mentoring_recaps.meeting_month`
2. `public.events.starts_at` (converted to `YYYY-MM`)

It then sets `v_selected_month` by calculating `max(month_value)` from the combined `months_with_data` set.

## 2. Root Cause
The Season 11 (`UEHM-S11`) dataset contains 2 records in the `public.events` table with `starts_at` dates in `2026-04`. 

## 3. Trigger
Because those 2 events exist in `2026-04`, the `max(month_value)` calculation evaluates to `2026-04`. The presence of these event records triggers the dashboard to automatically roll over to April.

## 4. Dashboard Impact
The Operations dashboard selects `2026-04` as the default month. This confirms the **open-month bleed**. Because April 2026 has virtually no recap data (as it is currently ongoing), the dashboard calculates that nearly the entire program is failing (massive false positives for missing recaps and silent mentees).

## 5. Business Risk
April 2026 is an open, ongoing month and **must not** drive official KPI cards or follow-up logic. Relying on available event or recap data to define the "current reporting month" fundamentally mismatches the business requirement, creating panic and operational misdirection.

## 6. Recommended Fix Principle
The correct target is **not** to simply ignore the `events` table in the query. The correct target is to abandon the `max(month_value)` heuristic entirely for official KPIs. Instead, the logic must select the **latest explicit closed reporting month** from a dedicated closed-month/KPI source (e.g., a `season_monthly_kpis` table where `closed = TRUE`).

## 7. What NOT to Do
* **Do NOT simply remove events from the query** as the long-term fix (this is a band-aid, not a cure).
* **Do NOT hardcode March 2026 (`2026-03`)** in the production logic.
* **Do NOT import March 2026 recap data** until the closed-month, import batch, and QA controls are fully ready.

## 8. Next Codex Task
* Prepare a minimal closed-month fix plan.
* **No production changes.**
* Provide a staging-only migration plan first (focusing on `season_monthly_kpis`, `data_import_batches`, and `data_quality_issues`).
