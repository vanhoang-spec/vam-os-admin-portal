# VAM OS Demo Data Readiness Audit — 2026-07-22

`scripts/seed_demo_s12_data.mjs` models one primary wave (`DEMO-S12-B1`), 5 mentors, 10 mentees, 9 varied applications, 2 matches, one orientation with capacity 8, 5 confirmed/2 waitlisted/1 pending registration, and 3 check-ins. It uses legacy tables and **does not require migration 061**.

Status: **DESIGN READY; EXECUTION NOT AUTHORIZED**. Dry-run is default and no hard-coded key exists. This pass added a permanent production-ref denial, exact staging-ref allowlist, a separate authorization flag, and cleanup scoping to `source_sheets=DEMO_SEED` instead of every `@example.com` person. Seed mode still performs cleanup-before-insert and therefore is operationally idempotent only for its tagged fixture; it is not transactionally atomic and individual insert errors are incompletely checked.

Write mode may be considered only after separate owner phrase `AUTHORIZE STAGING SYNTHETIC DEMO FIXTURE FOR DEMO-S12`, confirmed staging baseline compatibility, empty/disposable fixture scope, backup/recreate plan and a reviewed dry-run. Never point it at production. No write mode was executed during this audit.

Remaining blockers: staging schema/bootstrap authorization, account provisioning, authoritative column/status compatibility, transactional failure recovery, and owner acceptance of destructive fixture cleanup. Until cleared, use local/mock fixtures or prepared synthetic presentation assets.
