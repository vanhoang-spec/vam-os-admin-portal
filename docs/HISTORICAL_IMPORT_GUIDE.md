# Historical Import Guide

Scope: prepare imports for UEHM-S9, UEHM-S10, and UEHM-S11 historical data. Do not import real data until templates are reviewed and a dry-run script exists.

Templates live in `import_templates/`.

## Core Rules

- One real person has exactly one `people` record.
- A person can have multiple roles across seasons through `person_roles`.
- A mentor can be active in one season and inactive in another.
- A mentee from an earlier season can become `support_team` or another operational role in a later season.
- Deduplicate in this order: email, phone, then `full_name + school`.
- Never create duplicate people just because a role changed between seasons.

## Deduplication Key

Build a `dedupe_key` before import:

1. If normalized email exists: `email:<lowercase_email>`.
2. Else if normalized phone exists: `phone:<digits_only_phone>`.
3. Else if full name and school exist: `name_school:<lowercase_full_name>|<lowercase_school>`.
4. Else mark row for manual review and do not auto-import as a new person.

Recommended normalization:

- Email: trim, lowercase.
- Phone: keep digits, normalize Vietnamese leading `84`/`0` in the import runner.
- Full name: trim repeated spaces, lowercase for matching, preserve original display text.
- School: map common variants before matching.

## Import Sequence

1. `seasons.csv`
2. `people.csv`
3. `person_roles.csv`
4. `mentor_profiles.csv`
5. `mentee_profiles.csv`
6. `matches.csv`
7. `mentoring_recaps.csv`
8. `event_participations.csv`

Do not import `matches`, `mentoring_recaps`, or `event_participations` until all referenced people and seasons are resolved.

## Template Notes

### `seasons.csv`

One row per season code, for example `UEHM-S9`, `UEHM-S10`, `UEHM-S11`.

### `people.csv`

Master identity rows. This is the only template allowed to create a new person.

Required for auto-import:

- `dedupe_key`
- at least one of `email_primary`, `phone_primary`, or `full_name + school`

### `person_roles.csv`

Season-specific role history.

Suggested roles:

- `mentor`
- `mentee`
- `support_team`
- `core_team`
- `speaker`
- `trainer`
- `guest`

Use `status` to represent season-specific activity, for example `active` or `inactive`.

### `mentor_profiles.csv`

Person-level mentor profile fields. Do not use this table to represent active/inactive by season; use `person_roles` and `matches`.

### `mentee_profiles.csv`

Person-level mentee profile fields. If a former mentee becomes support team later, keep this profile and add a new `person_roles` row for the later season.

### `matches.csv`

Season-specific mentor/mentee pairing. Resolve both `mentor_person_id` and `mentee_person_id` from dedupe keys before insert.

### `mentoring_recaps.csv`

One row per recap. `meeting_month` must be `YYYY-MM` and should match `meeting_date`.

### `event_participations.csv`

One row per person per event participation record. Resolve `event_id`, `season_code`, and `person_id` before insert.

## Dry-run Requirements

Before real import:

- Count source rows per template.
- Count auto-matched people by email, phone, and name+school.
- Export manual review rows.
- Validate all foreign keys.
- Validate no duplicate `people` records will be created for existing emails/phones.
- Validate season role history for people who change role across seasons.
- Produce an import summary with `import_batch_id`.

## Rollback Strategy

Every imported row must carry `import_batch_id` in either a native column, metadata column, notes column, or an audit/import log. If a target table does not have a safe place for this value, add an import log table before importing real data.
