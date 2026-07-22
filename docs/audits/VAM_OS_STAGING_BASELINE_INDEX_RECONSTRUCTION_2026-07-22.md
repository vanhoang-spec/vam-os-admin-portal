# VAM OS Staging Baseline Index Reconstruction — 2026-07-22

Design only. Index definitions are copied verbatim from the safety-reviewed catalog. PK/unique-backed indexes are excluded because table constraints create them. Predicates, expressions, access methods, ordering and null behavior remain in the catalog definition.

| Table | Catalog indexes | Constraint-backed excluded | Emitted | Source | Status |
|---|---:|---:|---:|---|---|
| `programs` | 2 | 2 | 0 | catalog definition | READY |
| `seasons` | 2 | 2 | 0 | catalog definition | READY |
| `intake_batches` | 3 | 2 | 1 | catalog definition | READY |
| `people` | 6 | 3 | 3 | catalog definition | READY |
| `person_roles` | 4 | 2 | 2 | catalog definition | READY |
| `mentor_profiles` | 6 | 3 | 3 | catalog definition | READY |
| `mentee_profiles` | 7 | 3 | 4 | catalog definition | READY |
| `applications` | 7 | 2 | 5 | catalog definition | READY |
| `application_answers` | 1 | 1 | 0 | catalog definition | READY |
| `events` | 7 | 2 | 5 | catalog definition | READY |
| `event_links` | 5 | 3 | 2 | catalog definition | READY |
| `event_registrations` | 16 | 3 | 13 | catalog definition | READY |
| `event_participations` | 6 | 1 | 5 | catalog definition | READY |
| `mentoring_recaps` | 7 | 1 | 6 | catalog definition | READY |
| `season_monthly_kpis` | 3 | 2 | 1 | catalog definition | READY |
| `admin_users` | 6 | 2 | 4 | catalog definition | READY |
| `admin_scope_access` | 1 | 1 | 0 | catalog definition | READY |
| `application_reviews` | 7 | 1 | 6 | catalog definition | READY |
| `application_decisions` | 4 | 1 | 3 | catalog definition | READY |
| `review_assignment_batches` | 4 | 1 | 3 | catalog definition | READY |
| `person_season_memberships` | 6 | 2 | 4 | catalog definition | READY |
| `person_season_membership_log` | 5 | 1 | 4 | catalog definition | READY |
| `matches` | 11 | 0 | 0 | withheld | BLOCKED WITH TABLE |

Platform schemas and all historical `staging_*` indexes are excluded. Later-migration provenance is documented in the production-to-repository gap report; no index is reconstructed from its name alone.
