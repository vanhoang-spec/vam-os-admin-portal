# VAM OS Staging Baseline Module Readiness — 2026-07-22

All modules remain **STAGING ONLY — DESIGN ONLY — NOT AUTHORIZED — NOT EXECUTED — MUST NEVER RUN ON PRODUCTION**.

| Module | Status | Reason / remaining action |
|---|---|---|
| `01_extensions.sql` | READY | Exact required extension names/versions recorded; execution still separately authorized |
| `02_types.sql` | READY | Ten enums and 51 labels/order authoritative |
| `03_sequences.sql` | NOT APPLICABLE | Production has zero public sequences |
| `04_tables.sql` | BLOCKED | Deterministic tables rendered; `matches.match_confidence` numeric typmod unresolved, so `matches` withheld |
| `05_constraints.sql` | BLOCKED | Authoritative FKs rendered after tables; constraints touching `matches` withheld |
| `06_indexes.sql` | BLOCKED | Exact non-constraint indexes rendered; `matches` indexes withheld |
| `07_functions.sql` | READY AFTER OWNER SECURITY DECISION | Seven SECURITY DEFINER functions require approved search path/caller/grants; dashboard functions depend on `matches` |
| `08_triggers.sql` | READY AFTER OWNER SECURITY DECISION | Exact trigger inventory known; target-table/function readiness required |
| `09_views.sql` | READY | Three exact definitions and dependencies known |
| `10_rls_policies.sql` | READY AFTER OWNER SECURITY DECISION | Table-by-table target not approved |
| `11_grants.sql` | READY AFTER OWNER SECURITY DECISION | Least-privilege role and execute matrix not approved |
| `12_verification.sql` | READY AFTER OWNER SECURITY DECISION | Read-only catalog checks designed; expected security state awaits owner choice |

Overall: **BLOCKED** by deterministic `matches` DDL, then owner security/recovery decisions. Migration 061 is outside every module.
