# VAM OS Staging Synthetic Fixture Authorization Gate — 2026-07-22

Decision: **FIXTURE BLOCKED BY STAGING BASELINE**.

Static audit of `scripts/seed_demo_s12_data.mjs` passes the code safety gate: production ref `qkkroesfiazsejkzflcd` is permanently rejected; both URL host and explicit target must equal staging `ljfneyuvpxrmejpxsmpz`; a separate staging-authorization flag is mandatory; dry-run is the default; the dataset uses synthetic `example.com` identities; cleanup is anchored to season `DEMO-S12` and people tagged `DEMO_SEED`; cleanup-before-seed makes reruns idempotent; and there is no production fallback.

The write must remain blocked because the confirmed staging baseline is incomplete. The script depends on compatible `seasons`, `intake_batches`, `people`, mentor/mentee profiles, `applications`, `matches`, `events`, `event_registrations`, and `event_participations`, including the columns and enum values it inserts. Migration 061 is also not authorized: it is required for the wider Season 12 recruitment-campaign demonstration, although the current seed does not insert campaign rows. Validate the staging baseline and apply separately authorized prerequisites before fixture authorization.

Additional gates before an owner may authorize:

- Vercel Preview is proven to target staging and exclude production.
- Required staging tables, columns, and enums are verified without running this seed.
- Migration 061 has separate authorization and successful pre/postflight if campaign workflow is in demo scope.
- A rollback/cleanup operator is named and the latest safe staging recovery point is recorded.
- The exact future authorization phrase is issued only after those gates pass: `AUTHORIZE STAGING SYNTHETIC DEMO FIXTURE FOR DEMO-S12`.

This document does not issue authorization. The fixture was not executed.
