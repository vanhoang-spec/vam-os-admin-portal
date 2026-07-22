# Migration 061 Schema Verification Owner Runbook

Date: 2026-07-22

> **DO NOT RUN IN PRODUCTION UNTIL THE PROJECT IDENTITY IS CONFIRMED.**

This runbook authorizes no migration. The supplied probe is metadata/count-only and must be run manually by the owner.

## Preconditions

1. Open Supabase Dashboard.
2. Read the visible project name.
3. Copy the project reference from Project Settings and compare it with the intended staging inventory.
4. Confirm in writing that this project is **STAGING**, not production.
5. Confirm a current backup/snapshot and a tested restore point.
6. If there is no separate staging project, **stop**. Create a staging project or approved production clone first.
7. If project identity, ref, ownership or restore readiness is uncertain, stop.

## Run the probe

1. Open SQL Editor inside the confirmed staging project.
2. Create a new query.
3. Open `docs/audits/sql/VAM_OS_MIGRATION_061_READONLY_SCHEMA_PROBE.sql`.
4. Paste the complete file; do not paste migration 061 or rollback SQL.
5. Review the text before running. It must contain only `SELECT` and `WITH` statements. It must contain no CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE, GRANT, REVOKE, CALL, DO, SET ROLE, temporary tables, advisory locks or dynamic EXECUTE.
6. Run the complete query once.
7. Export every result set A through K as CSV or JSON, retaining each `result_section` label.
8. If J2 errors because the migration-history shape differs, preserve the error and J1 metadata; do not modify history.
9. If K errors because target objects are absent, preserve the error. Absence may support the first-install path, but only after all prerequisites are compared.
10. Do not export raw application rows or any email, name, phone, token, password, key or connection string.
11. Send the metadata/count exports and the confirmed project name/ref to Codex for comparison against the expected contract.
12. Do not run 061, rollback, seed, backfill or remediation SQL.

## Required owner record

- Project display name:
- Project reference:
- Environment owner:
- Evidence it is staging:
- Backup/snapshot timestamp:
- Restore method verified by:
- Probe execution timestamp:
- Export filenames:
- Errors/result sections missing:

Passing the probe is evidence for review, not staging migration authorization.
