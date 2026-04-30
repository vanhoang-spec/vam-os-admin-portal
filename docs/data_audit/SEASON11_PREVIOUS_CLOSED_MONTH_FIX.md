# Season 11 Previous Closed Month Fix

## Current State & Problem
After committing the March 2026 recap import and establishing the official March KPI snapshot, `v_season_latest_closed_month` correctly identifies `2026-03` as the `latest_closed_month`. However, because `season_monthly_kpis` contains only one closed row (March), the `lag()` function in the view returns `NULL` for `previous_closed_month`. 

This breaks the follow-up logic on the dashboard, which expects `previous_closed_month` (February) to calculate which mentees have been silent for 2 consecutive months (February + March).

## Answers to Key Questions

**1. Should we seed February 2026 into `season_monthly_kpis` with `closed = true`, or change the view logic?**
We must **seed February 2026**. Changing the view logic to fallback to raw `mentoring_recaps` data violates the strict "governance-first" design principle we just established. `season_monthly_kpis` must remain the absolute source of truth for the timeline of officially closed months.

**2. What official February KPI values should be used?**
Since the dashboard KPI cards strictly display data for the *latest* closed month (March), the exact KPI values for February are not critical for the current UI. We can seed February with placeholder values (`0`) or rough estimates, adding a note that the row exists primarily to establish the `previous_closed_month` anchor for follow-up calculations.

**3. If exact February distinct mentee count is not available, should previous_closed_month be driven by closed month rows only, or by `meeting_month` in `mentoring_recaps`?**
It must be driven by **closed month rows only**. Mixing governance tables with raw activity tables inside the closed-month view creates dangerous coupling and risks "open-month bleed" happening in unexpected ways in the future.

**4. What is the safest staging fix before Vercel deploy?**
The safest fix is an idempotent SQL migration (`033_seed_season11_february_closed_month.sql`) that seeds a `2026-02` row into `season_monthly_kpis` for `UEHM-S11` with `closed = true`.

## Action Plan
A new migration `033_seed_season11_february_closed_month.sql` has been created. It performs a simple `INSERT ... ON CONFLICT DO NOTHING` (or `DO UPDATE`) to seed `2026-02`. This fixes the `lag()` calculation and unblocks the follow-up logic without altering any existing data, imports, or production logic.
