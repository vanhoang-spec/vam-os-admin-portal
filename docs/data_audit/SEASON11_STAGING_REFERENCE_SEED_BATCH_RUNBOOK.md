# Season 11 Staging Reference Seed Batch Runbook

Owner: Thang  
Environment: Supabase staging only  
Do not run on production.

## Purpose

The original staging reference seed SQL Editor execution file is too large for Supabase SQL Editor. This batch pack splits it into smaller SQL Editor executions while preserving MVP UUIDs and using persistent staging helper tables between executions.

## Files

Folder: `docs/data_audit/sql/season11_reference_seed_batches/`

Expected helper counts before final apply:

- people: `1331`
- mentor_profiles: `448`
- mentee_profiles: `654`
- UEHM-S11 matches: `637`

## Run Order

1. Open Supabase SQL Editor connected to staging.
2. Run `001_create_staging_reference_seed_tables.sql` first.
3. Run every `010_seed_people_batch_*.sql` through `017_seed_people_batch_*.sql` file in filename order.
4. Run every `020_seed_mentee_profiles_batch_*.sql` through `023_seed_mentee_profiles_batch_*.sql` file in filename order.
5. Run every `030_seed_mentor_profiles_batch_*.sql` through `033_seed_mentor_profiles_batch_*.sql` file in filename order.
6. Run every `040_seed_matches_batch_*.sql` through `043_seed_matches_batch_*.sql` file in filename order.
7. Run `090_validate_reference_seed.sql` last.

## Stop Conditions

Stop immediately if any batch fails. Do not continue to later batches until the error is understood.

Stop before applying if helper counts are not exactly:

- people = `1331`
- mentor_profiles = `448`
- mentee_profiles = `654`
- UEHM-S11 matches = `637`

Stop if `090_validate_reference_seed.sql` raises any guardrail exception, reports missing people/profile references, or returns unexpected validation counts.

## Transaction Guidance For `090`

`090_validate_reference_seed.sql` starts with `BEGIN;` and ends with `ROLLBACK;` by default. The first run is for review only.

After the first `090` run, review:

- target application-table columns selected from the live staging schema
- upsert counts
- validation summary counts
- approved March sample ID checks

If everything is correct, run `090_validate_reference_seed.sql` again after changing only the final action:

- comment out `ROLLBACK;`
- uncomment `COMMIT;`

If anything is unexpected, keep `ROLLBACK;` and investigate before retrying.

If all `001` and `010`/`020`/`030`/`040` helper batches already loaded successfully and only `090_validate_reference_seed.sql` failed, do not rerun the helper batches. Fix/review `090_validate_reference_seed.sql`, then rerun `090` only.

## After Successful Seed

After the committed final run:

1. Confirm final validation counts still match the expected counts.
2. Spot-check the seeded people, mentor profiles, mentee profiles, and UEHM-S11 matches in staging.
3. Keep the helper tables for audit/review. Do not delete staging validation data.
4. Proceed with the separate March import flow only after this reference seed is confirmed.

Do not deploy, do not edit dashboard RPCs, and do not change the March import as part of this seed batch run.
