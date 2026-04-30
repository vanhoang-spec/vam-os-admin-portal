# Season 11 Confirmed Supabase Inspection Findings

## 1. Executive conclusion
The dashboard issue is caused by both:
* incomplete March 2026 recap import
* open-month bleed from Operations RPC selecting max month with recap/event data

## 2. Confirmed March 2026 Supabase state
* UEHM-S11 / 2026-03:
  * total_recap_entries = 23
  * valid_recap_entries = 23
  * distinct_mentees_with_valid_recap = 15
  * distinct_mentor_mentee_pairs_with_valid_recap = 15

## 3. Expected March 2026 from Excel audit
* Báo cáo Recap = 271
* Mentee Tracking = 275
* Cleaning data = 286

## 4. Confirmed April 2026 Supabase state
* UEHM-S11 / 2026-04:
  * total_recap_entries = 25
  * valid_recap_entries = 25
  * distinct_mentees_with_valid_recap = 10
  * distinct_mentor_mentee_pairs_with_valid_recap = 10
* UEHM-S11 has 2 events in April 2026.

## 5. Confirmed RPC logic
* `get_operations_dashboard_data` builds `months_with_data` from:
  * `mentoring_recaps.meeting_month`
  * `events.starts_at` converted to YYYY-MM
* It selects `v_selected_month` from max available month.
* This causes April 2026 to be selected when April has recap/event data.

## 6. Business risk
* false-positive missing recap counts
* false-positive silent 2-month follow-up list
* founder dashboard panic
* operational misdirection

## 7. Correct fix principle
* Do not simply remove events.
* Do not hardcode March 2026.
* Create explicit closed-month / KPI layer.
* Then import/validate March.
* Then rewire dashboard RPC to latest closed month.

## 8. Recommended sequence
* Create minimal staging-only closed-month/import/QA migration.
* Prepare March import into `mentoring_recaps` with batch tracking and QA.
* Insert official March KPI snapshot.
* Rewire dashboard RPC to latest closed month.
* Validate staging before production.
