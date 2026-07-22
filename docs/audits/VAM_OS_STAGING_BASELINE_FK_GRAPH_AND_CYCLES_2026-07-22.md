# VAM OS Staging Baseline FK Graph and Cycles — 2026-07-22

All 49 core-scope FKs were parsed from authoritative catalog definitions. No directed FK cycle exists among the selected tables. FKs are nevertheless separated from table creation. Constraints touching unresolved `matches` remain blocked.

| Source table | Source columns | Target table | Target columns | Cycle | Creation phase | Status |
|---|---|---|---|---|---|---|
| `seasons` | `program_id` | `programs` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `intake_batches` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_roles` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_roles` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentor_profiles` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentor_profiles` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentor_profiles` | `source_application_id` | `applications` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentee_profiles` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentee_profiles` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentee_profiles` | `source_application_id` | `applications` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `applications` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `applications` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `applications` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_answers` | `application_id` | `applications` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `matches` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `matched_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `mentee_person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `mentee_profile_id` | `mentee_profiles` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `mentor_person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `mentor_profile_id` | `mentor_profiles` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `matches` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `events` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `events` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_links` | `event_id` | `events` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_registrations` | `event_id` | `events` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_registrations` | `event_link_id` | `event_links` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_registrations` | `linked_person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_registrations` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_participations` | `event_id` | `events` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_participations` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `event_participations` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentoring_recaps` | `match_id` | `matches` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED |
| `mentoring_recaps` | `mentee_person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentoring_recaps` | `mentor_person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `mentoring_recaps` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `season_monthly_kpis` | `batch_id` | `data_import_batches` | `id` | NO | Phase 3 ALTER TABLE | BLOCKED — target owner classification required |
| `season_monthly_kpis` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_reviews` | `application_id` | `applications` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_reviews` | `assigned_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_reviews` | `assignment_batch_id` | `review_assignment_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_reviews` | `reviewer_admin_user_id` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_decisions` | `application_id` | `applications` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `application_decisions` | `decided_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `review_assignment_batches` | `created_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `review_assignment_batches` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_memberships` | `created_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_memberships` | `intake_batch_id` | `intake_batches` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_memberships` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_memberships` | `program_id` | `programs` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_memberships` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_membership_log` | `changed_by` | `admin_users` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_membership_log` | `membership_id` | `person_season_memberships` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_membership_log` | `person_id` | `people` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_membership_log` | `program_id` | `programs` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |
| `person_season_membership_log` | `season_id` | `seasons` | `id` | NO | Phase 3 ALTER TABLE | RESOLVED |

Creation strategy: tables with PK/unique/check constraints; then non-cyclic FKs via `ALTER TABLE`; then indexes. No FK validation is disabled. Authoritative DEFERRABLE, INITIALLY DEFERRED, and ON DELETE clauses are preserved verbatim. The graph contains 55 authoritative relationships: 46 emitted and nine blocked. No directed FK cycle exists. Eight blocked relationships touch unresolved `matches`; the ninth targets `data_import_batches`, whose inclusion requires owner classification.
