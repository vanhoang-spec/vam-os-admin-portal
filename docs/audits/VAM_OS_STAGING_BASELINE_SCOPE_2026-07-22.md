# VAM OS Staging Baseline Scope

Date: 2026-07-22
Approach: **A — pre-061 baseline**. Migration 061 remains a separate, later, explicitly authorized change.

| Classification | Public objects |
|---|---|
| 1. Core baseline required | programs, seasons, intake_batches, people, person_roles, mentor_profiles, mentee_profiles, applications, application_answers, matches, events, event_links, event_registrations, event_participations, mentoring_recaps, admin_users, admin_scope_access |
| 2. Optional operational module | application_reviews, application_decisions, review_assignment_batches, action_items, activity_correction_log, admin_audit_log, operational_team_assignments, communications, crm_notes, feedback_responses, person_season_memberships, person_season_membership_log, industries, function_areas, mentor_program_participations, mentor_industries, mentor_function_areas, data_import_batches, data_issues, data_quality_issues, season_monthly_kpis |
| 3. Historical import/staging helper | all `staging_*` tables; import content/rows are excluded |
| 4. Generated/reporting view | v_mentee_monthly_tracking, v_monthly_activity_summary, v_season_latest_closed_month |
| 5. Deprecated/owner decision | public helpers with no current route/repository dependency; determine after dependency graph review |

## Included schema object kinds

Necessary extension names, reviewed public enum/types, sequences, tables, constraints, indexes, VAM-owned functions, triggers, views, RLS settings, policies and grants.

## Supabase-managed schemas excluded

Supabase-managed auth, storage, vault, realtime and extension internals are excluded from manual clone.

## Explicit exclusions

- auth internal tables/users/identities/sessions/tokens
- storage internal tables and all storage objects
- vault secrets and internals
- realtime internals
- extension-managed internals/functions
- production business/import/audit rows
- PII, application answers and production identifiers
- migration 061 campaign objects

## Offline baseline-gaps reassessment

Resolved by owner-provided catalog metadata: all ten enum label sets/order; exact definitions and direct dependencies for all three views; 13 VAM OS-owned versus 45 extension-managed functions; all 20 triggers; 22 comments; and zero actual public sequences. The 441 misnamed ownership rows are general catalog dependencies and are excluded, along with `auth`, `storage`, `realtime`, `vault`, `pg_toast`, and extension-managed routines.

Still blocking: exact pre-012 base table creation DDL and reviewed cycle handling; owner-approved RLS/policies/grants and SECURITY DEFINER target; staging disposability/recovery; and reviewed executable modules. The baseline remains a design manifest, not bootstrap authorization.
