# VAM OS Production Schema Inventory — Partial Evidence

Date: 2026-07-22

## Confirmed target and scope

- Project: `vam-os-mvp`
- Reference: `qkkroesfiazsejkzflcd`
- Environment: PRODUCTION
- Owner manually executed the authorized read-only metadata probe.
- Database mutation, migration 061, staging bootstrap, seed/backfill and production PII export remain unauthorized.
- Only the final `PRODUCTION_TABLE_ESTIMATES` result set was supplied. Complete columns, constraints, indexes, functions, triggers, RLS, grants and migration provenance are **not available yet**.
- Supplied output contained no PII and the owner reported no database mutation.

## Available estimates

| Table | Estimated rows |
|---|---:|
| action_items | -1 |
| activity_correction_log | 52 |
| admin_audit_log | -1 |
| admin_scope_access | -1 |
| admin_users | 20 |
| application_answers | 15,207 |
| application_decisions | -1 |
| application_reviews | 2 |
| applications | 888 |
| communications | -1 |
| crm_notes | -1 |
| data_import_batches | -1 |
| data_issues | -1 |
| data_quality_issues | 276 |
| event_links | -1 |
| event_participations | 942 |
| event_registrations | 51 |
| events | 7 |
| feedback_responses | -1 |
| function_areas | -1 |
| industries | -1 |
| intake_batches | -1 |
| matches | 637 |
| mentee_profiles | 655 |
| mentor_function_areas | 135 |
| mentor_industries | 135 |
| mentor_profiles | 449 |
| mentor_program_participations | -1 |
| mentoring_recaps | 2,447 |
| operational_team_assignments | -1 |
| people | 1,331 |
| person_roles | 1,331 |
| person_season_membership_log | -1 |
| person_season_memberships | -1 |
| programs | -1 |
| review_assignment_batches | -1 |
| season_monthly_kpis | -1 |
| seasons | -1 |
| staging_application_answers_import | 15,207 |
| staging_applications_import | 888 |
| staging_event_registrations_import | -1 |
| staging_events_import | -1 |
| staging_feedback_import | -1 |
| staging_matches_import | 637 |
| staging_mentee_profiles_import | 654 |
| staging_mentor_profiles_import | 448 |
| staging_people_import | 1,331 |
| staging_person_roles_import | 1,331 |
| staging_uehm_s11_event_import_skips | 330 |

`-1` is PostgreSQL's unavailable/stale estimate, not confirmed zero. Estimates do not establish exact counts, column shape, constraints, indexes, RLS, grants or provenance.

## Multi-result probe UX audit

The existing probe has 10 top-level SELECT/WITH statements and result sections: table metadata, columns, constraints, indexes, policies, functions, aggregates, triggers, extensions and table estimates. Supabase SQL Editor conveniently leaves the final result visible/exportable. Earlier result grids require navigation and separate exports. Columns, indexes and function definitions can exceed default UI row limits; large definitions also make manual copy error-prone. Asking the owner to select/run/export many sections risks omission, mixed project context and inconsistent snapshots.

The replacement single-result probe packages every section in one JSONB document returned as one row. Large JSON cell/export limits remain possible, but there is one coherent artifact and one execution snapshot.
