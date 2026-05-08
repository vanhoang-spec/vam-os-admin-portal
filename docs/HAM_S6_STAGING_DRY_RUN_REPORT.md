# HAM Season 6 Staging Dry-Run Report

Status: prepared for approval; no database write performed.

Date: 2026-05-07

## Target

Staging only.

- Expected staging env file: `.env.staging.local`
- Staging Supabase project ref observed from env URL: `ljfneyuvpxrmejpxsmpz`
- Production env files were not used.
- `.env.local` points at a different Supabase project and should not be used for this import.

## Files Inspected

HAM private/import files:

- `data_imports/ham/ham_people_clean.csv`
- `data_imports/ham/ham_matches_clean.csv`
- `data_imports/ham/ham_recaps_clean.csv`
- `data_imports/ham/ham_events_or_group_activities_clean.csv`
- `data_imports/ham/ham_manual_review_issues.csv`
- `data_imports/ham/ham_identity_resolution_dry_run.csv`
- `data_imports/ham/ham_identity_resolution_summary.csv`
- `data_imports/ham/ham_identity_duplicate_names.csv`
- `data_imports/ham/ham_summary_by_file.csv`

HAM script/package files:

- `data_imports/ham/scripts/ham_audit_clean.py`
- `data_imports/ham/scripts/ham_inspect.py`
- `data_imports/ham/scripts/ham_s6_01_seed_program_season.sql`
- `data_imports/ham/scripts/ham_s6_02_import_people.sql`
- `data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql`
- `data_imports/ham/scripts/ham_s6_verify_foundation.sql`

Audit docs:

- `docs/HAM_DATA_AUDIT_AND_IMPORT_PLAN.md`
- `docs/HAM_S6_STAGING_IMPORT_PLAN.md`

## PII Classification

Keep private/untracked:

- `ham_people_clean.csv`: direct PII including names, emails, phones, profile links, school/company context.
- `ham_matches_clean.csv`: direct PII for mentor/mentee names, emails, phones, school/context.
- `ham_recaps_clean.csv`: direct/indirect PII and social post URLs/body excerpts.
- `ham_events_or_group_activities_clean.csv`: direct/indirect PII and social post URLs/body excerpts.
- `ham_manual_review_issues.csv`: direct PII and source issue context.
- `ham_identity_resolution_dry_run.csv`: direct PII plus matched identity metadata.
- `ham_identity_duplicate_names.csv`: names; keep private.

Safe to commit later after review:

- SQL scripts in `data_imports/ham/scripts/ham_s6_*.sql`; inspected scripts contain CSV paths and table logic, not inline person rows.
- Sanitized docs in `docs/`; keep docs free of raw names, emails, phones, social URLs, and row-level payloads.

## Dry-Run Counts

Source counts from CSV parsing:

| Dataset | Rows | Import-ready |
|---|---:|---:|
| People | 112 | 112 |
| Matches | 60 | 60 |
| 1on1 recaps | 121 | 73 |
| Events/group activities | 42 | 25 |
| Manual review issues | 65 | 0 |

Identity resolution:

| Category | Count |
|---|---:|
| Safe existing-person links | 2 |
| Safe new-person candidates | 106 |
| Unsafe/manual-review identities | 4 |

Foundation import expected result:

| Object | Expected |
|---|---:|
| HAM program row | 1 |
| HAM-S6 season row | 1 |
| HAM-S6-B1 intake batch row | 1 |
| People linked/created into identity map | 108 |
| People skipped for manual review | 4 |
| Matches created/resolved | 56 |
| Match rows skipped for unresolved identities | 4 |
| Recaps imported | 0 |
| Events/group activities imported | 0 |

## Staging Execution Order

Use only a staging `DATABASE_URL`, loaded from `.env.staging.local` or an equivalent staging-only secret.

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_01_seed_program_season.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_02_import_people.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_03_import_profiles_matches.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/ham/scripts/ham_s6_verify_foundation.sql
```

Do not run these commands against production.

## Rollback/Cleanup Plan

Run only on staging, after confirming no dependent manual work needs to be preserved.

1. Delete HAM-S6 matches:

```sql
delete from public.matches
where season_id in (select id from public.seasons where code = 'HAM-S6');
```

2. Delete profiles created for the HAM-S6 intake batch:

```sql
delete from public.mentor_profiles
where intake_batch_id in (select ib.id from public.intake_batches ib join public.seasons s on s.id = ib.season_id where s.code = 'HAM-S6');

delete from public.mentee_profiles
where intake_batch_id in (select ib.id from public.intake_batches ib join public.seasons s on s.id = ib.season_id where s.code = 'HAM-S6');
```

3. Delete people created by HAM staging import provenance only:

```sql
delete from public.people
where source_sheets like '%HAM_S6%'
  and id in (
    select person_id
    from public.staging_ham_s6_people_identity_map
    where action in ('created_new_person', 'linked_existing_email_on_rerun')
  );
```

4. Delete staging helper tables:

```sql
drop table if exists public.staging_ham_s6_people_identity_map;
drop table if exists public.staging_ham_s6_import_skips;
```

5. Optional metadata cleanup:

```sql
delete from public.intake_batches where code = 'HAM-S6-B1';
delete from public.seasons where code = 'HAM-S6';
delete from public.programs where code = 'HAM';
```

## QA Checklist

- Super admin can see HAM rows in `/people`, `/mentors`, `/mentees`, `/matches`, `/team`, and relevant dashboards.
- UEHM-only scoped user cannot see HAM people, matches, events, recaps, or team assignments.
- HAM-scoped user can see HAM rows and cannot see UEHM rows.
- Multi-scope user can see both UEHM and HAM rows without cross-program leakage.
- `/matches` still shows UEHM active matches correctly when scoped to UEHM.
- `/events` and operations dashboards do not mix UEHM and HAM metrics.
- `/mentors/create` and `/mentees/create` pickers only show people/programs in the user's allowed scope.
- `/operations/intelligence` uses scoped data for non-super-admin users.
- `/team` does not show assignments for people outside the user's scoped people set.

## Decision

Foundation staging import package is ready for review.

Actual staging write requires explicit approval and a staging-only database connection.
