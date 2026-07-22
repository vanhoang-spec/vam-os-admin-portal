# VAM OS Staging Schema Bootstrap and Verification Runbook

Date: 2026-07-22
Status: design only; no execution authorization.

## Preconditions and exact future sequence

1. Confirm Supabase project name is exactly `vam-os-staging`.
2. Confirm project reference is exactly `ljfneyuvpxrmejpxsmpz`.
3. Run the approved read-only staging baseline probe and record current contents.
4. Complete the owner disposability checklist: unique manual data, preview dependencies, test accounts, confidentiality, recreation and ownership.
5. Select and verify a staging backup/export/restore method.
6. Confirm no unique staging data or approved test artifact will be lost.
7. Resolve every BLOCKING REVIEW item in `staging_bootstrap/VAM_OS_STAGING_SCHEMA_ONLY_BASELINE_DESIGN.sql`.
8. Review normalized schema-only SQL, dependency order, RLS, policies and grants.
9. Obtain the future owner authorization phrase exactly as a new instruction.
10. Apply the reviewed baseline only to the confirmed staging project.
11. Run the post-bootstrap read-only metadata probe.
12. Verify types, tables, sequences, constraints, indexes, functions, triggers, views, RLS, policies and grants against the contract.
13. Create synthetic staging auth users under a separate approved process; never copy production auth users.
14. Create synthetic UEH/HAM fixtures separately; never copy production business rows.
15. Test anonymous denial, reviewer limits, Super Admin access and UEH/HAM program isolation.
16. Test legacy application, people, matching, operations, event and recap routes.
17. Re-run migration 061 fail-closed preflight only after baseline verification.
18. Request a separate migration 061 staging authorization.

## Future authorization phrases — documented, not issued

Baseline bootstrap phrase:

`AUTHORIZE STAGING SCHEMA-ONLY BASELINE BOOTSTRAP`

Migration 061 phrase:

`AUTHORIZE STAGING BATCH 5B1 RECRUITMENT CAMPAIGN MIGRATION 061`

Neither phrase is issued by this document. They must come from the owner in a future turn and authorize only their stated operation.

## Backup and recreate requirement

Because staging completeness and unique contents are not yet proven, reset/recreate is prohibited. Prefer a reproducible project recreation after a backup/restore rehearsal. Record who owns rollback and the maximum acceptable outage.

## Post-bootstrap verification gates

- Confirm no production rows, auth identities or storage objects exist.
- Confirm exact type labels/order and view definitions.
- Confirm all FKs/checks/indexes are valid and ready.
- Confirm VAM-owned functions use safe search paths and correct security mode.
- Confirm triggers are enabled as designed.
- Confirm RLS/grants meet the reviewed staging contract, not insecure production drift.
- Confirm synthetic-only fixtures and cross-program isolation.
- Confirm application build/tests and legacy routes pass.
- Confirm migration 061 target objects remain absent before its separate authorization.

## Abort gates

Stop if project identity differs, backup is absent, unresolved baseline markers remain, any production value appears, extension/platform internals are included, security contract is unapproved, or schema diff is non-zero outside documented equivalents.

No command in this runbook is currently authorized for execution.
