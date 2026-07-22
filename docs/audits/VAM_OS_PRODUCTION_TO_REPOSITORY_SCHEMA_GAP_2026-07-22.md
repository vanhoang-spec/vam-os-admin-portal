# VAM OS Production-to-Repository Schema Gap

Date: 2026-07-22

## Conclusion

Repository migration history begins at 012 and does not deterministically reproduce the current production public schema. Migrations 001–011 are absent. Later gaps 037, 039 and 042 have no files; 044/045/046 use lettered files and are sequencing conventions rather than necessarily missing changes. Production contains pre-012 types/tables and manual/import helpers with no complete versioned origin.

| Object | Production definition | Repository source | Missing history | Drift | Baseline action |
|---|---|---|---|---|---|
| programs | UUID table, RLS enabled | 036, 053 | Created late | Production-aligned incrementally | Include after exact review |
| seasons | Existing UUID table with season_status | Assumed by 012+, policies in 018 | Pre-012 DDL absent | Type labels absent | BLOCKED pending type source |
| intake_batches | UUID season child | 036 | Base programs/seasons history partial | Production has later trigger/index state | Include after exact review |
| people/person_roles | Core identity tables | Assumed by 012+, changed later | Pre-012 DDL absent | Enums and exact origin missing | BLOCKED pending authoritative type DDL |
| mentor/mentee profiles | Core profile tables | Assumed, altered 025/036/043/050 | Base DDL absent | Accumulated production columns | Reconstruct only after exact DDL review |
| applications/answers | 31/6 columns | 038/040/041/059/060; 059 gap bootstrap | Original base absent | Production differs from clean migration chain | Manual baseline synthesis |
| matches | 25 columns | Assumed; altered 025/035/046a | Base DDL/type history absent | Production lifecycle evolved | Manual synthesis |
| events | 66 columns | Assumed; altered 045a/048/054-056 | Base DDL/event enum absent | Significant accumulated drift | Manual synthesis |
| registrations/links | Large event workflow tables | 051, 054-057 | Depends on pre-existing events/types | Production-aligned incrementally | Include after dependency ordering |
| recaps/participations | Production operational tables | 012/013 plus later fixes | Depends on pre-012 core | Constraints evolved | Use migrations plus catalog comparison |
| admin_users/scope | Present; mixed RLS state | 017/020/024/026/047 | Auth relationship assumptions | admin_users RLS disabled | Include with explicit reviewed grants/RLS |
| membership/CRM | Present | 052 | Core dependencies predate history | Mostly versioned | Optional module |
| import/data-quality helpers | Multiple public and staging_* tables | 031/034 and ad hoc imports | Several unversioned | Historical helper drift | Exclude by default |
| reporting views | Three views | 012/031 and later | Inventory lacks view SQL | Definition cannot be validated | BLOCKED until definitions captured |
| public enums/types | 10 referenced UDTs | Only role_type/application_status partly in 059; event change in 048 | Most base labels absent | Exact labels/order unknown | BLOCKING manual source |
| public functions/triggers | 58 functions/20 triggers | Incremental migrations | Some pre-existing/manual | Extension functions mixed into public | Clone VAM-owned only after provenance map |
| RLS/policies/grants | Mixed; broad grants | 018/020/057 and ad hoc | Production state not derivable cleanly | Major security drift | Preserve observed design only after owner security decision |
| recruitment campaign objects | Absent | design-only 061 | Not applied | Expected pre-061 absence | Keep separate from baseline |

## Predating migration 012

Seasons, people, person_roles, mentor_profiles, mentee_profiles, matches, events, applications and their public enum types necessarily predate or are assumed by migration 012–018. Their creation DDL is not in the repository.

## Manual or unversioned production objects

The `staging_*` import tables, some data-quality/import artifacts and production-specific alignment state appear historical or manually provisioned. Names alone do not prove ownership; they are excluded from core baseline pending owner decision.

## Supabase-managed objects

Objects in auth, storage, vault, realtime, extensions and extension-managed public functions must not be cloned manually. Their migration ledgers are platform component ledgers, not VAM OS history.

## Reconstructibility decision

The public schema is **not deterministically reconstructible** today. Required missing sources are enum labels/order, view definitions, sequence definitions/ownership, authoritative pre-012 DDL, and an approved grants/RLS target state.

## Tracked migration-by-migration inventory

| Migration file | DDL objects named | Baseline finding |
|---|---|---|
| `012_create_activity_tracking_tables.sql` | event_participations, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `013_add_activity_tracking_operational_fields.sql` | event_participations, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `014_seed_phase2_events.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `015_create_activity_correction_log.sql` | activity_correction_log | Depends partly on pre-012 core schema or incremental operations history |
| `016_create_operational_team_assignments.sql` | operational_team_assignments | Depends partly on pre-012 core schema or incremental operations history |
| `017_create_admin_users_and_roles.sql` | admin_users | Depends partly on pre-012 core schema or incremental operations history |
| `018_draft_rls_read_policies.sql` | activity_correction_log, admin_users, applications, event_participations, events, matches, mentee_profiles, mentor_profiles, mentoring_recaps, operational_team_assignments, people, programs, seasons | Depends partly on pre-012 core schema or incremental operations history |
| `019_operations_dashboard_stable_rpc.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `020_admin_scope_access_schema_alignment.sql` | admin_scope_access | Depends partly on pre-012 core schema or incremental operations history |
| `021_seed_admin_scope_access_uehm_s11.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `022_operations_dashboard_rpc_scope_gate.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `023_phase4_operations_workflow_system.sql` | action_item_comments, action_items, activity_correction_log, admin_users, event_participations, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `024_super_admin_user_console.sql` | admin_audit_log | Depends partly on pre-012 core schema or incremental operations history |
| `025_founder_intelligence_dashboard.sql` | event_participations, matches, mentee_profiles, mentor_profiles, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `026_production_schema_sync_admin_audit.sql` | admin_audit_log, admin_scope_access | Depends partly on pre-012 core schema or incremental operations history |
| `027_phase2d_admin_correction_workflow.sql` | action_items, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `028_production_season11_sync_and_operations_rpc.sql` | action_items, activity_correction_log, mentoring_recaps | Depends partly on pre-012 core schema or incremental operations history |
| `029_founder_intelligence_rpc.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `030_enrich_founder_intelligence_dashboard.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `031_staging_season11_schema_setup.sql` | data_import_batches, data_quality_issues, season_monthly_kpis | Depends partly on pre-012 core schema or incremental operations history |
| `032_season11_closed_month_dashboard_fix.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `033_seed_season11_february_closed_month.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `034_prod_season11_march_recap_import.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `035_fix_operations_rpc_match_status_enum.sql` | functions/views/policies/data-only or validation | Depends partly on pre-012 core schema or incremental operations history |
| `036_mentor_taxonomy_and_programs.sql` | function_areas, industries, intake_batches, mentor_function_areas, mentor_industries, mentor_program_participations, programs | Incremental change; dependencies must be ordered against authoritative base |
| `038_s12_intake_foundation.sql` | applications | Incremental change; dependencies must be ordered against authoritative base |
| `040_application_reviews.sql` | application_reviews, applications | Incremental change; dependencies must be ordered against authoritative base |
| `041_application_decision_workflow.sql` | application_decisions, applications | Incremental change; dependencies must be ordered against authoritative base |
| `043_profile_season_batch_linkage.sql` | mentee_profiles, mentor_profiles | Incremental change; dependencies must be ordered against authoritative base |
| `044a_reviewer_bulk_assignment.sql` | application_reviews, review_assignment_batches | Incremental change; dependencies must be ordered against authoritative base |
| `044b_interview_self_claim.sql` | application_reviews | Incremental change; dependencies must be ordered against authoritative base |
| `045a_events_batch_status.sql` | events | Incremental change; dependencies must be ordered against authoritative base |
| `046a_manual_matching_foundation.sql` | matches | Incremental change; dependencies must be ordered against authoritative base |
| `047_fix_admin_users_role_constraint_core_support_team.sql` | admin_users | Incremental change; dependencies must be ordered against authoritative base |
| `048_add_kickoff_event_type.sql` | events | Incremental change; dependencies must be ordered against authoritative base |
| `049_expand_event_participation_status_model.sql` | event_participations | Incremental change; dependencies must be ordered against authoritative base |
| `051_event_registration_qr_checkin_foundation.sql` | event_links, event_registrations | Incremental change; dependencies must be ordered against authoritative base |
| `052_phase1a_member_lifecycle_crm_foundation.sql` | crm_notes, person_season_membership_log, person_season_memberships | Incremental change; dependencies must be ordered against authoritative base |
| `053_programs_is_active_schema_alignment.sql` | does, programs | Incremental change; dependencies must be ordered against authoritative base |
| `054_event_phase2_config_foundation.sql` | event_registrations, events | Incremental change; dependencies must be ordered against authoritative base |
| `055_event_phase2_production_schema_alignment.sql` | event_registrations, events | Incremental change; dependencies must be ordered against authoritative base |
| `056_event_optional_meal_payment.sql` | event_registrations, events | Incremental change; dependencies must be ordered against authoritative base |
| `057_security_hardening_rls_phase1.sql` | event_links, event_registrations | Incremental change; dependencies must be ordered against authoritative base |
| `058_add_excluded_status.sql` | mentoring_recaps | Incremental change; dependencies must be ordered against authoritative base |
| `059_staging_application_workflow_bootstrap.sql` | application_answers, application_decisions, application_reviews, applications, ENABLE, review_assignment_batches | Gap bootstrap; not a canonical full baseline |
| `060_align_application_interview_in_progress_status.sql` | applications | Incremental change; dependencies must be ordered against authoritative base |
| `061_design_only_recruitment_campaigns.sql` | applications, recruitment_campaigns | Design-only preflight; excluded from pre-061 baseline |

## Schema-focused design/document sources reviewed

- Migration 061 expected contract, pre-authorization review and campaign migration plan.
- Batch 5A security/migration plan and production/staging schema-diff audits.
- Schema audit, migration production-sync notes, RLS blueprints/checklists and Season 11 schema-gap packs.
- Application code/types were treated as consumers, not authoritative database DDL.
