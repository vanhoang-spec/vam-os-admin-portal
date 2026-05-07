# HAM Season 6 Staging Import Plan

Status: Draft for review. Do not run on production.

Date: 2026-05-07

## Scope

Prepare the staging-only foundation import for Hanoi Alumni Mentoring Season 6.

Included in this foundation phase:

- Program metadata: `HAM`
- Season metadata: `HAM-S6`
- Intake batch metadata: `HAM-S6-B1`
- People identity map and safe people creation/linking
- Mentor/mentee profile creation where missing
- Primary mentor/mentee match creation

Excluded from this foundation phase:

- Recap import
- Group mentoring import
- Training/community/orientation event import
- Manual-review identity rows
- Production import

## Canonical Naming

Use `HAM-S6` as the canonical `seasons.code`.

Reasoning:

- Existing VAM OS convention in migration 036 is `<program_code>-S<n>`, for example `UEHM-S12`.
- Source files use `HAM_S6`; scripts preserve that value in notes/source payload, but store the database season as `HAM-S6`.
- Intake batch code follows the same convention: `HAM-S6-B1`.

## Schema Findings

Staging currently has the required foundation tables:

- `programs`
- `seasons`
- `intake_batches`
- `people`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `mentoring_recaps`

Important model details:

- No `person_roles` table exists in staging; role is stored on `people.role`, and mentor/mentee behavior is represented by `mentor_profiles` / `mentee_profiles`.
- `matches` supports direct `mentor_person_id` and `mentee_person_id`, plus legacy `mentor_id` and `mentee_id`.
- `mentoring_recaps` has no activity-type constraint found in staging, but recaps are intentionally held for a later phase.
- `programs.code` and `seasons.code` are unique.
- `intake_batches` is available and unique by `(season_id, code)`.

## Prepared Scripts

Run order for staging only:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_01_seed_program_season.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_02_import_people.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_verify_foundation.sql
```

Do not run these commands against production.

## People Import Rules

Source files:

- `data_imports/ham/ham_people_clean.csv`
- `data_imports/ham/ham_identity_resolution_dry_run.csv`

Dry-run identity result:

| Result | Count |
|---|---:|
| Total HAM people rows | 112 |
| Safe existing-person links | 2 |
| New people candidates | 106 |
| Manual-review name-only candidates | 4 |
| Duplicate email values | 0 |
| Duplicate normalized name values | 1 |

Expected people foundation behavior:

| Action | Expected count |
|---|---:|
| Link existing people | 2 |
| Create new `people` rows | 106 |
| Skip manual-review identities | 4 |

Rules:

- Do not auto-link the 4 manual-review rows.
- Do not create people for manual-review rows.
- Do not create duplicate people when normalized email already exists.
- Store HAM source metadata in `source_sheets` and `data_quality_flags`.
- Persist source-to-person mapping in `public.staging_ham_s6_people_identity_map`.
- Log skipped rows in `public.staging_ham_s6_import_skips`.

## Profile And Match Import Rules

Source file:

- `data_imports/ham/ham_matches_clean.csv`

Expected match dry-run using safe identity rows:

| Result | Count |
|---|---:|
| Source match rows | 60 |
| Rows with both identities resolved | 56 |
| Rows skipped for unresolved mentor | 3 |
| Rows skipped for unresolved mentee | 1 |
| Rows skipped for both unresolved | 0 |

Rules:

- Create `mentor_profiles` only where the resolved person does not already have a mentor profile.
- Create `mentee_profiles` only where the resolved person does not already have a mentee profile.
- Link created profiles to `HAM-S6-B1`.
- Create a match only when both mentor and mentee identities resolve.
- Do not create duplicate matches for the same `(season_id, mentor_person_id, mentee_person_id)`.
- Log unresolved match rows in `public.staging_ham_s6_import_skips`.

## Recap Import Readiness

Recaps are not imported in this foundation phase.

Current recap counts:

| Category | Import-ready rows | Decision |
|---|---:|---|
| `1on1_primary` | 52 | Candidate for next recap phase after foundation verification |
| `1on1_cross` | 21 | Hold; needs cross-match handling decision |
| `group_mentoring` | 6 | Hold; needs group session model |
| `training_event` | 15 | Hold; needs HAM event model |
| `community_activity` | 2 | Hold; needs HAM event/activity model |
| `orientation_or_intro` | 1 | Hold; likely pre-program/activity model |
| `application_or_selection_activity` | 1 | Hold; should not be official event attendance |
| `unknown_manual_review` | 0 import-ready / 5 held | Manual review |
| Non-ready `1on1_primary` | 39 | Manual review |
| Non-ready `1on1_cross` | 4 | Manual review |

Recommended next recap step:

1. Verify the 56 imported primary matches.
2. Confirm whether the 52 import-ready `1on1_primary` recap rows all map to imported matches.
3. Keep `1on1_cross`, group, event, community, orientation, and application/selection activities held until their target models are approved.

## Risks

- Manual-review identity rows can cause incorrect person merges if linked by name only.
- HAM uses a separate program; all future reporting/imports must filter by `HAM-S6` or `program.code = HAM`.
- The staging schema has no `person_roles`; any future multi-program role model may require a migration before production rollout.
- Existing profiles are reused if present; HAM-specific profile enrichment is only added when a profile is missing.
- Recaps reference people by display names and social-post text, so recap import must not proceed until match/person FKs are verified.

## Go / No-Go

Foundation staging import is ready for review, but not yet approved to run.

Go criteria before running:

- Review the 4 manual-review identity rows.
- Confirm `HAM-S6` naming.
- Confirm profile reuse behavior is acceptable for people who already have mentor/mentee profiles.
- Confirm the 56 expected match rows is acceptable before recaps.
- Run scripts on staging only, then run `ham_s6_verify_foundation.sql`.
