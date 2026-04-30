# Season 11 Data QA Report

QA date: 2026-04-30 Asia/Saigon.

Production target:

- Supabase project ref: `qkkroesfiazsejkzflcd`
- Probe method: read-only Supabase queries using service role from local env.
- No production data was modified.

## Executive Summary

Season 11 operational data is mostly queryable and internally linked for people/profiles/matches/recaps/events. The main blockers are schema/control-plane issues:

- `seasons` table is empty in production, so `UEHM-S11` cannot be resolved to a `season_id`.
- `/operations` RPC `get_operations_dashboard_data(p_season_code)` is missing from schema cache, so the app uses raw-read fallback.
- `action_items` is missing from production schema cache, so Phase 2D queues cannot work until migration is applied.

Because `UEHM-S11` is missing from `seasons`, current dashboard logic falls back to all rows instead of season-filtered rows. The numbers below should be treated as "current production operational dataset assumed to be Season 11", not strict `season_id = UEHM-S11`.

## Core Counts

| Metric | Count |
| --- | ---: |
| Total people | 1,331 |
| Total mentor profiles | 448 |
| Total mentee profiles | 654 |
| Active matches | 637 |
| Events | 3 |
| Event participations | 3 |
| Event attendance, attended total | 2 |
| Mentoring recaps total | 902 |
| Valid recaps total | 902 |

Valid recap statuses used by dashboard logic: `submitted`, `needs_review`, or blank.

## Recap By Month

| Month | Recaps |
| --- | ---: |
| 2005-11 | 1 |
| 2015-11 | 1 |
| 2025-01 | 4 |
| 2025-02 | 6 |
| 2025-11 | 508 |
| 2025-12 | 278 |
| 2026-01 | 38 |
| 2026-02 | 64 |
| 2026-04 | 1 |
| 2026-12 | 1 |

Findings:

- `2005-11`, `2015-11`, `2025-01`, `2025-02`, and `2026-12` are outside the Season 11 operational range used by the app (`2025-10` to `2026-06`) or look suspicious.
- `2026-03` has no valid recap rows.
- `2026-04` has 1 recap, which makes the dashboard select April 2026 as the current operational month.

## Data Issues

| Issue | Count | Classification | Notes |
| --- | ---: | --- | --- |
| `seasons` has no `UEHM-S11` row | 1 | missing schema/data setup | Dashboard falls back to all data when it cannot resolve season. |
| Mentees without active match | 17 | data issue | Based on mentee profiles whose `person_id` is not in active match mentee ids. |
| Mentors without active match | 10 | data issue | Based on mentor profiles whose `person_id` is not in active match mentor ids. |
| Recaps missing mentor/mentee | 0 | pass | No recap has missing or unresolvable mentor/mentee person id. |
| Duplicate recap groups | 0 | pass | Duplicate key: season/match/mentor/mentee/date/url. |
| Event participation missing person | 0 | pass | All event participations have a resolvable person. |
| Event participation missing event | 0 | pass | All event participations have a resolvable event. |
| Mentor profiles missing person | 0 | pass | All mentor profiles link to people. |
| Mentee profiles missing person | 0 | pass | All mentee profiles link to people. |
| Active admin users missing `auth_user_id` | 0 | pass | No admin auth mismatch found in `admin_users`. |
| `action_items` missing | 1 | missing schema | Needed for Phase 2D queue. Apply migration `027_phase2d_admin_correction_workflow.sql`. |
| Operations RPC missing | 1 | missing schema | App fallback works, but RPC schema should be synced if still part of intended architecture. |

Sample IDs for data review are available from the QA probe output in the terminal history. No production data was changed.

## Dashboard KPI Validation

Dashboard selected operational month: `2026-04`.

Previous operational month: `2026-03`.

| KPI | `/` expected from code | `/operations` expected from code | DB query result | Status |
| --- | ---: | ---: | ---: | --- |
| Số recap tháng này | 1 | 1 | 1 | match |
| Mentee active tháng này | 1 | 1 | 1 | match |
| Mentor active tháng này | 1 | 1 | 1 | match |
| Mentee im lặng 1 tháng | 0 | 0 | 0 | match |
| Mentee im lặng 2+ tháng / Follow-up | 636 | 636 | 636 | match by current logic |
| Event attendance tháng này | n/a on `/` KPI cards | 2 | 2 | match |
| Events in selected month | n/a on `/` KPI cards | 2 | 2 | match |
| Mentor chưa có recap | shown in `/operations` | 437 | 437 | match |

Notes:

- `/operations` RPC is missing, so app will use raw-read fallback.
- Follow-up count is very high because April 2026 has only 1 recap and March 2026 has no recaps. This may be correct if April is genuinely the operating month, but it is likely a data readiness/date coverage issue.
- `/` and `/operations` both rely on hard-coded `UEHM-S11`, but since `seasons` is empty, they effectively calculate over all current production rows.

## Discrepancy Classification

| Finding | Classification | Suggested fix |
| --- | --- | --- |
| Empty `seasons` table / missing `UEHM-S11` | missing schema/data setup | Add official `UEHM-S11` season row and backfill `season_id` on matches, recaps, events, event participations if missing. Do not do this directly in production without approved migration/backfill script. |
| `action_items` missing | missing schema | Apply `supabase_migrations/027_phase2d_admin_correction_workflow.sql`. |
| Operations RPC missing | missing schema | Either apply `019/022` RPC migration or formally remove RPC dependency and keep raw-read fallback as canonical. |
| Outlier recap months | data issue | Review rows in 2005-11, 2015-11, 2025-01, 2025-02, 2026-12. Correct dates/months through Phase 2D workflow after approval. |
| Follow-up count 636 | data issue or logic issue | If March/April recap data is incomplete, treat as data issue. If current-month selection should ignore sparse/outlier current month, adjust logic to select latest complete operational month. |
| Mentees without active match: 17 | data issue | Review if these are waitlist/inactive/withdrawn mentees or missing matches. |
| Mentors without active match: 10 | data issue | Review if these are inactive mentors or missing matches. |

## Phase 2D Readiness Impact

Core team can start using in-app correction only after:

1. `action_items` migration is applied.
2. Soft-delete recap status `deleted` is allowed by DB constraint.
3. Audit tables exist: `activity_correction_log` and `admin_audit_log`.
4. `/admin` is available to `admin` / `super_admin`.

No data should be corrected directly in production from this QA report alone.

## QA Command Results

Final command results:

| Command | Result |
| --- | --- |
| `npm.cmd run lint` | Pass: `No ESLint warnings or errors` |
| `npm.cmd run typecheck` | Pass: `tsc --noEmit` |
| `npm.cmd run build` | Pass: Next.js production build compiled successfully |

Note: an earlier parallel run of `typecheck` and `build` produced transient `.next/types` missing-file errors while build regenerated `.next`. A subsequent standalone `npm.cmd run typecheck` passed.
