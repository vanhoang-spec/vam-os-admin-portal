# VAM OS Pre-012 Baseline Objects — 2026-07-22

The repository begins at migration 012. Production existence comes from the offline inventory; “DDL exists” means a usable repository definition, not merely a later `ALTER` or reference.

| Object | Type | Used by later migrations/current app | Production exists | Repository DDL exists | Remediation |
|---|---|---:|---:|---:|---|
| `people`, `person_roles` | core tables | Yes | Yes | No authoritative pre-012 DDL | Collect authoritative DDL; required baseline |
| `mentor_profiles`, `mentee_profiles` | core tables | Yes | Yes | No authoritative pre-012 DDL | Collect authoritative DDL; required baseline |
| `seasons` | core table | Yes | Yes | No authoritative pre-012 DDL | Collect authoritative DDL; required baseline |
| `events` | operational table | Yes | Yes | No authoritative pre-012 DDL | Collect authoritative DDL; required baseline |
| `matches` | operational table | Yes | Yes | No authoritative pre-012 DDL | Collect authoritative DDL; required baseline |
| `applications`, `application_answers` | workflow tables | Yes | Yes | Candidate staging reconstruction in 059 | Owner reconcile against production metadata |
| `communications` | workflow table | Current code/schema | Yes | No authoritative pre-012 DDL | Collect if code-path confirmed; otherwise owner decision |
| `feedback_responses` | reporting table | Current reports | Yes | No authoritative pre-012 DDL | Collect exact DDL; required for reporting parity |
| `industries`, `function_areas`, `programs`, `intake_batches` | taxonomy/program tables | Yes | Yes | Created later in 036 | Reconstruct in later migration order, not pre-012 |
| `mentoring_recaps`, `event_participations` | activity tables | Yes | Yes | migration 012 | Apply after pre-012 core |
| `staging_*_import` tables | import helpers | No current runtime dependency established | Some exist | Mixed scripts/migrations | Exclude from minimum baseline |
| three `v_*` views | reporting views | Yes | Yes | migrations 012/031 candidate | Exact definitions via probe |
| admin/audit/governance tables | governance | Yes | Yes | migrations 015–028 | Apply after core baseline |

Minimum pre-012 staging foundation: `people`, `person_roles`, `mentor_profiles`, `mentee_profiles`, `seasons`, `events`, `matches`, `applications`, `application_answers`, and (subject to final code-path confirmation) `communications` and `feedback_responses`, plus their enum types, keys, defaults, indexes, and constraints. Historical import helpers are excluded unless a later migration dependency proves otherwise.

Because authoritative pre-012 table DDL is still absent, the executable baseline cannot yet be reconstructed.
