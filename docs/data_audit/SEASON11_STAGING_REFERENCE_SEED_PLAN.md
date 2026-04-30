# Season 11 Staging Reference Seed Plan

Generated: 2026-04-30

## Purpose

The March 2026 staging import failed safely because the mapped March rows use real VAM OS MVP UUIDs, while Supabase staging currently contains validation/test identities only. The March recap import must not bypass mentor/mentee/profile/match validation. Staging must first be seeded with the Season 11 MVP reference identity graph.

This package prepares a manual staging-only seed for:

- `people`
- `mentor_profiles`
- `mentee_profiles`
- `matches` for `UEHM-S11`

It does not import March recaps, does not rewrite dashboard RPCs, does not delete validation data, and does not deploy anything.

## Source Files

Expected MVP export folder: `data_imports/season11/reference_exports_mvp/`.

Workspace source used for this generated pack: `data_imports/season11/reference_exports_production`. The files are MVP-named exports and are ignored from Git.

| Export | Rows | Use |
| --- | ---: | --- |
| `people_mvp.csv` | 1331 | Preserve MVP `people.id` values used by March mapping. |
| `mentor_profiles_mvp.csv` | 448 | Preserve mentor profile/person linkage. |
| `mentee_profiles_mvp.csv` | 654 | Preserve mentee profile/person linkage. |
| `matches_uehm_s11_mvp.csv` | 637 | Preserve MVP match IDs and mentor/mentee pairings for UEHM-S11. |

## Seed Policy

1. Run on Supabase staging only.
2. Preserve original MVP UUIDs for people, profiles, and matches.
3. Use the existing staging `seasons` row where `code = 'UEHM-S11'` as the target `season_id` for seeded matches.
4. Upsert by primary key `id` and do not delete or truncate any staging data.
5. Seed only reference data; March recaps remain untouched.
6. Keep the March recap import validation intact. After this seed, the March import pack should be able to validate real mentor/mentee/profile IDs.

## Guardrails

The SQL checks all of the following before changing reference tables:

- Temp table row counts match the MVP exports: 1331 people, 448 mentor profiles, 654 mentee profiles, 637 UEHM-S11 matches.
- A staging season row exists for `UEHM-S11`.
- Every mentor/mentee profile points to an exported MVP person.
- Every UEHM-S11 match points to exported mentor and mentee people.
- Every UEHM-S11 match points to exported mentor and mentee profiles.

## Manual Workflow

1. Open `docs/data_audit/sql/SEASON11_STAGING_REFERENCE_SEED_SUPABASE_SQL_EDITOR_EXECUTION.sql` in Supabase SQL Editor against staging.
2. Confirm the connection is not production.
3. Run the transaction. It ends with both `ROLLBACK` and `COMMIT` commented out.
4. Review the validation output counts and sample March ID checks.
5. Uncomment exactly one final action: `COMMIT;` to keep the seed or `ROLLBACK;` to discard it.
6. After commit, rerun the March SQL Editor execution pack for manual review.

## Sensitive Data Handling

The SQL Editor execution pack embeds MVP reference data, including PII from `people_mvp.csv`. Keep it staging-only, do not commit ignored source exports, and do not share the generated SQL outside the approved review path.
