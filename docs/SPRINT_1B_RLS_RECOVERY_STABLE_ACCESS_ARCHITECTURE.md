# Sprint 1B RLS Recovery & Stable Access Architecture

Date: 2026-04-29

## Executive Summary

Sprint 1B failed because the app protected routes with Supabase Auth cookies, but most Supabase table reads were still executed through the shared anon client. RLS policies based on `auth.uid()` therefore evaluated without the logged-in admin user's JWT and could return empty data to the Operations dashboard.

This recovery adds a request-scoped authenticated server Supabase client, routes server data reads through it, updates admin lookup paths to use the user JWT, and adds a reviewable migration for a stable Operations dashboard RPC. It does not re-enable RLS, does not change data, and does not create or alter raw table policies.

## Discovery Scope

Inspected files:

- `lib/supabase.ts`
- `lib/supabase-server.ts`
- `lib/data.ts`
- `lib/admin-auth.ts`
- `middleware.ts`
- `app/login/actions.ts`
- `app/operations/page.tsx`
- `app/people/[id]/page.tsx`
- `app/recaps/[id]/edit/page.tsx`
- `app/actions/activity-corrections.ts`
- `supabase_migrations/012_create_activity_tracking_tables.sql`
- `supabase_migrations/013_add_activity_tracking_operational_fields.sql`
- `supabase_migrations/015_create_activity_correction_log.sql`
- `supabase_migrations/016_create_operational_team_assignments.sql`
- `supabase_migrations/017_create_admin_users_and_roles.sql`
- `supabase_migrations/018_draft_rls_read_policies.sql`
- `supabase_migrations/019_operations_dashboard_stable_rpc.sql`

Live catalog limitation:

The local environment only contains `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Supabase rejected anonymous OpenAPI/catalog inspection with `401 Secret API key required`, so live primary key/foreign key/index/policy details cannot be fully verified from `pg_catalog` in this workspace. The table structure below is based on repo migrations plus visible public API samples/counts. Existing live policies must be confirmed in Supabase SQL editor or with a server-side database/service credential before further RLS rollout.

## Table Audit

| Table | Visible/sample columns | PK/FK/index evidence | RLS/policy evidence |
| --- | --- | --- | --- |
| `admin_users` | `id`, `auth_user_id`, `email`, `full_name`, `role`, `status`, `notes`, `created_at`, `updated_at` | Migration 017: PK `id`; unique `email`; indexes on `auth_user_id`, `email`, `role`, `status`. No FK declared for `auth_user_id` in repo migration. | Migration 018 draft would enable RLS and policy `read_admin_users_super_admin_or_self`; live state not catalog-verified. |
| `admin_scope_access` | No visible sample rows; live anon count `0`. | Not represented in repo migrations, so columns/PK/FK/indexes cannot be verified locally. | User reports RLS enabled and policies use `admin_users.auth_user_id = auth.uid()`; live policy text not catalog-verified. |
| `people` | `id`, `legacy_person_temp_id`, `full_name`, `full_name_normalized`, `email_primary`, `phone_primary`, `phone_raw`, `gender`, `date_of_birth`, `facebook_url`, `preferred_language`, consent fields, source fields, timestamps | Core table migration not present in repo. App/types assume PK `id`. Referenced by `mentoring_recaps`, `event_participations`, `matches`, operational assignments. | Migration 018 draft policy `read_people_internal_roles`; live state not catalog-verified. |
| `programs` | No visible sample rows; live anon count `0`. | Core table migration not present in repo. | Migration 018 draft policy `read_programs_active_admins`; live state not catalog-verified. |
| `seasons` | No visible sample rows; live anon count `0`. | Core table migration not present in repo. App/types assume PK `id`. Referenced by activity/matches/events. | Migration 018 draft policy `read_seasons_active_admins`; live state not catalog-verified. |
| `events` | `id`, `legacy_event_temp_id`, `season_id`, `event_name`, `event_type`, `starts_at`, `source_notes`, source fields, timestamps | Core table migration not present in repo; event participation FK references `events(id)`. | Migration 018 draft policy `read_events_active_admins`; event KPI is sensitive to this table being filtered. Live state not catalog-verified. |
| `matches` | `id`, `legacy_match_temp_id`, `season_id`, `mentee_person_id`, `mentor_person_id`, `match_type`, `match_source_raw`, `match_confidence`, `status`, `notes`, source fields, timestamps | Core table migration not present in repo; activity migration references `matches(id)`. | Migration 018 draft policy `read_matches_internal_roles`; live state not catalog-verified. |
| `mentoring_recaps` | `id`, `season_id`, `match_id`, `mentor_person_id`, `mentee_person_id`, `meeting_date`, `meeting_month`, `recap_url`, `recap_source`, `recap_note`, `issue_flag`, `status`, `admin_notes`, timestamps, `meeting_type`, `captured_by` | Migration 012: PK `id`; FKs to `seasons`, `matches`, `people`; indexes on `season_id`, `match_id`, mentor/mentee ids, `meeting_month`, `issue_flag`. Migration 013 adds fields. | Migration 018 draft policy `read_mentoring_recaps_internal_roles`; user reports RLS disabled in rollback. |
| `event_participations` | `id`, `event_id`, `season_id`, `person_id`, `role_at_event`, `registration_status`, `attendance_status`, `attendance_date`, `recap_url`, `excuse_reason`, `admin_notes`, timestamps, `captured_by`, `walk_in` | Migration 012: PK `id`; FKs to `events`, `seasons`, `people`; indexes on `event_id`, `season_id`, `person_id`, `attendance_status`, `role_at_event`. Migration 013 adds fields. | Migration 018 draft policy `read_event_participations_internal_roles`; user reports RLS disabled in rollback. |
| `activity_correction_log` | `id`, `target_table`, `target_id`, `correction_type`, `field_name`, `old_value`, `new_value`, `reason`, `corrected_by`, `created_at` | Migration 015: PK `id`; no FK to target table by design; indexes on `(target_table,target_id)`, `created_at`, `correction_type`, `corrected_by`. | Migration 018 draft policy `read_activity_correction_log_review_roles`; live state not catalog-verified. |

## Operations Dashboard Query Map

`app/operations/page.tsx` calls `getOperationsData()` and computes KPIs in React server code.

Current data sources:

- `seasons`: raw table read for season lookup.
- `people`: raw table read for mentor/mentee names and emails.
- `mentee_profiles`: raw table read for follow-up table codes.
- `matches`: raw table read for active mentor/mentee sets.
- `mentoring_recaps`: raw table read for recap count, active mentor/mentee count, follow-up, top mentors, recent recaps, outliers.
- `events`: raw table read for event/training count and event month filter.
- `event_participations`: raw table read for event attendance count.

KPI logic:

- Recap count: valid `mentoring_recaps` where `meeting_month === selectedMonth`.
- Active mentee count: distinct selected-month recap `mentee_person_id`.
- Active mentor count: distinct selected-month recap `mentor_person_id`.
- Mentor without recap: active mentors from `matches` minus selected-month recap mentors.
- Event/training count: `events` whose `starts_at` month is selected month.
- Event attendance count: `event_participations` whose `event_id` is in visible selected-month events and `attendance_status === attended`.
- Follow-up: active mentees from `matches` missing both selected-month and previous-month recap.

## Root Cause

The failure mode is an auth-context mismatch:

1. Middleware and page layout prove that the browser request has a valid Supabase Auth user.
2. Before this recovery, `lib/data.ts`, `lib/admin-auth.ts` role lookup, `app/login/actions.ts`, and `middleware.ts` admin table checks still queried Supabase tables as anon or anon-key bearer.
3. Sprint 1B RLS policies use `auth.uid()` joined to `admin_users.auth_user_id`.
4. An anon-key table request has no admin user JWT, so `auth.uid()` is null and policy checks fail.
5. Operations converts hidden/empty row sets into zero KPIs.

The event KPI has a second dependency issue: event attendance is counted only after filtering participations by visible event IDs. If `event_participations` is visible but `events` is hidden by RLS, `eventIdsInMonth` is empty and attendance remains zero.

Affected queries:

- `getOperationsData()`
- `getEventParticipationsByPersonId()`
- `getMentoringRecapsByMenteePersonId()`
- `getMentoringRecapsByMentorPersonId()`
- `getEvents()`
- `getCurrentAdminUser()` role lookup
- login-time `admin_users` check
- middleware `admin_users` check

Risk level: high for dashboard correctness and login continuity under RLS.

## Stable Access Architecture

Implemented first safe layer:

- Server-side reads now use an authenticated cookie-based Supabase client when an auth cookie is present.
- Admin role checks now use the user's JWT instead of `Authorization: Bearer <anon key>` for `admin_users`.
- Operations can use a stable RPC read surface once migration 019 is applied.

Recommended final architecture:

- `admin_users.auth_user_id` remains the canonical Supabase Auth link.
- `admin_scope_access` should define program/season visibility after its schema and seed data are verified.
- Dashboard analytics should use controlled RPC/view surfaces rather than ad hoc cross-table joins from page code.
- Raw `mentoring_recaps` and `event_participations` RLS should remain disabled until dashboard RPC and scope rows are validated in preview/staging.

Important scope note:

Migration 019 is active-admin gated only. It intentionally does not reference `admin_scope_access` because that table's columns are not represented in the repo and live catalog access was unavailable. The next migration should add program/season-scope enforcement after `admin_scope_access` schema and seed rows are confirmed.

## SQL Changes

Migration: `supabase_migrations/019_operations_dashboard_stable_rpc.sql`

Creates:

- `public.get_operations_dashboard_data(p_season_code text default 'UEHM-S11') returns jsonb`

Security:

- `SECURITY DEFINER`
- checks `admin_users.auth_user_id = auth.uid()` and `status = 'active'`
- allows roles `viewer`, `reviewer`, `admin`, `super_admin`
- revokes execute from `public` and `anon`
- grants execute to `authenticated`

No tables, raw policies, or RLS states are changed.

Rollback:

```sql
drop function if exists public.get_operations_dashboard_data(text);
```

## QA/QC Results

| Check | Result | Evidence |
| --- | --- | --- |
| Build | PASS | `npm.cmd run build` completed successfully. |
| Typecheck | PASS | Included in Next build. |
| Lint | NOT RUNNABLE | `npm.cmd run lint` opens interactive ESLint setup because no repo ESLint config exists. |
| Diff whitespace | PASS | `git diff --check` returned no whitespace errors. |
| Unauthenticated dashboard access | PASS | `GET /operations` returned `307` redirect to `/login?next=%2Foperations`. |
| Current raw Operations KPI snapshot | PASS | Current visible data returns non-zero recap/event counts; see below. |
| RPC anon access before migration | PASS/EXPECTED | `get_operations_dashboard_data` is not present yet, anon RPC returns `PGRST202`; app falls back to raw reads until migration is applied. |
| Sensitive service key exposure | PASS | No new service-role key or server secret added. |
| Role browser testing | LIMITED | No local viewer/admin/super_admin credentials were available in this workspace. |
| Live policy catalog inspection | LIMITED | Supabase OpenAPI/catalog requires secret key; no live `pg_policies` access from local env. |

Current raw KPI snapshot from the same visible Supabase data path:

| Metric | Before recovery code | After recovery code |
| --- | ---: | ---: |
| Selected month | `2026-04` | Expected unchanged |
| Source recaps visible | `902` | Expected unchanged |
| Source events visible | `3` | Expected unchanged |
| Source event participations visible | `3` | Expected unchanged |
| Recap count | `1` | Expected unchanged |
| Active mentee count | `1` | Expected unchanged |
| Active mentor count | `1` | Expected unchanged |
| Mentor without recap | `437` | Expected unchanged |
| Event/training count | `2` | Expected unchanged |
| Event attendance count | `2` | Expected unchanged |
| Registered absent count | `1` | Expected unchanged |
| Follow-up count | `636` | Expected unchanged |

After values are expected unchanged because the UI behavior and fallback raw query logic are intentionally preserved. The stability improvement is that, in an authenticated request, the server client now carries the user's JWT, and once migration 019 is applied, Operations can use the stable RPC surface.

## Risks / Open Questions

- `admin_scope_access` schema, indexes, and live policies still require catalog inspection.
- `admin_scope_access` currently has visible count `0`; strict scope enforcement would block scoped access until rows are seeded.
- Migration 019 does not yet enforce program/season scope because guessing column names would be risky.
- Full role testing requires real test credentials for `viewer`, `admin`, `super_admin`, and a non-admin user.
- `seasons` currently has visible count `0` via anon path; Operations has fallback behavior, but this should be reconciled before season-scoped access is enforced.

## Recommended Next Action

Ready for human review of this recovery patch, but do not deploy migration 019 until a reviewer confirms:

1. `admin_scope_access` schema and seed strategy.
2. Whether Operations RPC should be active-admin-only for the recovery window or immediately scope-filtered.
3. Test credentials for viewer/admin/super_admin/non-admin QA in preview.

Do not re-enable raw activity-table RLS until the authenticated server client and/or RPC path has been verified in preview with real roles.
