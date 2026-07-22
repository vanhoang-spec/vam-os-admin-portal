# VAM OS Staging Synthetic Fixture Authorization Gate — 2026-07-22

Decision: **FIXTURE BLOCKED BY STAGING BASELINE**.

Preview targeting is no longer the blocker: owner evidence confirms Preview uses staging `ljfneyuvpxrmejpxsmpz`, excludes production `qkkroesfiazsejkzflcd`, and has the required Preview-scoped server variables.

The static seed safety gate remains satisfied: production is permanently rejected; URL host and explicit target must both equal staging; separate staging authorization is mandatory; dry-run is default; data is synthetic; cleanup is anchored to DEMO-S12/`DEMO_SEED`; cleanup-first reruns are idempotent; and no production fallback exists.

The fixture still cannot be authorized because staging baseline compatibility has not been proven for all required tables, columns, constraints, and enum values across `seasons`, `intake_batches`, `people`, mentor/mentee profiles, `applications`, `matches`, `events`, `event_registrations`, and `event_participations`. Migration 061 remains separately unauthorized and is needed only if the wider recruitment-campaign demonstration is in scope; the current seed does not insert campaign rows.

## Readiness steps before a future owner authorization

1. Complete the separately authorized staging baseline verification/remediation and retain its evidence.
2. Confirm every seed dependency against staging without executing the seed.
3. Record the staging recovery point and named cleanup operator.
4. Complete at least one synthetic login/logout smoke test and verify no production data is visible.
5. Re-run static tests and review the dry-run plan only; do not write.
6. Only then may the owner separately decide whether to issue `AUTHORIZE STAGING SYNTHETIC DEMO FIXTURE FOR DEMO-S12`.

This record does not issue authorization. The fixture was not executed, no SQL was run, and migration 061 was not run.
