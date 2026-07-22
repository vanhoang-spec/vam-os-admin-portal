# VAM OS Owner Action Checklist to 8 August 2026

## Actions required now

- [ ] Review/merge readiness package and approve the critical path.
- [ ] Separately decide whether to issue `AUTHORIZE READ-ONLY PRODUCTION BASELINE-GAPS INVENTORY`.
- [ ] Choose preview or limited local synthetic UAT; record exact commit and target ref.

## Before Support UAT (26 July)

- [ ] Prove preview uses staging, not production; verify callback/login/error behavior.
- [ ] Prepare placeholder roles/accounts via an approved process and private credential channel.
- [ ] If fixture writes are required, separately consider `AUTHORIZE STAGING SYNTHETIC DEMO FIXTURE FOR DEMO-S12` after baseline/schema review.
- [ ] Publish URL, tester guide, issue channel and escalation contact.

## Before demo

- [ ] Close/mitigate UAT S0–S2, execute manual accessibility/isolation matrices, rehearse by 5 August.
- [ ] Freeze/pin build on 6 August; verify accounts/routes/fallbacks on 7 August.
- [ ] Keep migration-061-dependent campaign features labelled design/roadmap.

## Intentionally deferred

- `AUTHORIZE STAGING SCHEMA-ONLY BASELINE BOOTSTRAP` — separate decision after metadata/security gates.
- `AUTHORIZE STAGING BATCH 5B1 RECRUITMENT CAMPAIGN MIGRATION 061` — separate decision after baseline/staging validation.
- Production deployment, production mutation, seed/backfill and launch authorization.

Listing phrases does not issue authorization. Never combine them.
