# VAM OS Pre-012 Table DDL Reconstruction — 2026-07-22

Design only. No SQL was executed. The safety-reviewed production catalog is authoritative for names, defaults, nullability, constraints and index definitions; migrations 012+ resolve later alterations. The inventory omitted numeric typmod attributes, so `matches.match_confidence` remains unresolved and no `matches` DDL is emitted.

| Table | Columns complete | PK | Unique | Checks | FKs | Indexes | Source | Status |
|---|---:|---:|---:|---:|---:|---:|---|---|
| `programs` | YES | 1 | 1 | 0 | 0 | 2 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `seasons` | YES | 1 | 1 | 0 | 1 | 2 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `intake_batches` | YES | 1 | 1 | 2 | 1 | 3 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `people` | YES | 1 | 2 | 0 | 0 | 6 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `person_roles` | YES | 1 | 0 | 0 | 2 | 4 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `mentor_profiles` | YES | 1 | 0 | 0 | 3 | 6 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `mentee_profiles` | YES | 1 | 0 | 0 | 3 | 7 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `applications` | YES | 1 | 1 | 1 | 3 | 7 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `application_answers` | YES | 1 | 0 | 0 | 1 | 1 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `matches` | NO | 1 | 1 | 1 | 7 | 11 | catalog + migrations 012+ | INCOMPLETE |
| `events` | YES | 1 | 1 | 1 | 2 | 7 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `event_links` | YES | 1 | 2 | 1 | 1 | 5 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `event_registrations` | YES | 1 | 1 | 1 | 4 | 16 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `event_participations` | YES | 1 | 0 | 3 | 3 | 6 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `mentoring_recaps` | YES | 1 | 0 | 4 | 4 | 7 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `season_monthly_kpis` | YES | 1 | 1 | 1 | 2 | 3 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `admin_users` | YES | 1 | 1 | 2 | 0 | 6 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `admin_scope_access` | YES | 1 | 0 | 0 | 0 | 1 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `application_reviews` | YES | 1 | 0 | 8 | 4 | 7 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `application_decisions` | YES | 1 | 0 | 0 | 2 | 4 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `review_assignment_batches` | YES | 1 | 0 | 1 | 2 | 4 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `person_season_memberships` | YES | 1 | 1 | 4 | 5 | 6 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |
| `person_season_membership_log` | YES | 1 | 0 | 4 | 5 | 5 | catalog + migrations 012+ | DETERMINISTIC WITH LATER ALTERATIONS |

## Separate classifications

- **EXCLUDE FROM CORE BASELINE:** all eleven `staging_*` import tables; production rows/import content are never copied.
- **OWNER CLASSIFICATION REQUIRED:** `data_import_batches`, `data_issues`, and `data_quality_issues` as historical/import support.
- **Reporting/operations optional module:** `action_items`, `operational_team_assignments`, `season_monthly_kpis` (the latter is included because an authoritative required view depends on it).
- **CRM optional module:** `communications`, `crm_notes`, `feedback_responses`.
- **Audit/governance optional module:** `activity_correction_log`, `admin_audit_log`.
- **Taxonomy/link helpers:** `industries`, `function_areas`, `mentor_industries`, `mentor_function_areas`, `mentor_program_participations`; later migrations are authoritative but they are outside minimum UAT fixture scope.

Decision: the minimum pre-061 baseline remains blocked by one unresolved core column typmod and the dependent `matches` table. No missing DDL is guessed.
