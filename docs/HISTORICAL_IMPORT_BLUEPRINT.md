# Historical Import Blueprint

Scope: prepare VAM OS to import Season 1-10 history without corrupting Season 11 operations or creating duplicate people.

Status: planning only. Do not import real data from this document alone.

## Goals

- Bring UEHM Season 1-10 into VAM OS as historical, queryable records.
- Preserve one `people` record per real person.
- Represent changing roles through `person_roles`.
- Keep Season 11 operations stable while historical data is imported.
- Make every import batch traceable and reversible.

## Data Tables Needed

Core:

- `seasons`
- `people`
- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `mentoring_recaps`
- `events`
- `event_participations`

Support:

- import templates in `import_templates/`
- import batch log, if added later
- manual review CSV/output before insert
- optional `action_items` for unresolved data issues

## Import Principles

- One real person -> one `people` row.
- Do not create duplicate people for each season.
- Use `person_roles` for season-specific role changes.
- Use `mentor_profiles` and `mentee_profiles` as person-level profile tables.
- A previous mentee can be `support_team` or `core_team` in a later season.
- A mentor can be active, inactive, and active again across different seasons.
- Prefer preserving source values in notes/metadata over overwriting clean current data.

## Deduplication Rules

Deduplicate in this order:

1. Email.
2. Phone.
3. `full_name + school`.

Recommended key format:

- `email:<normalized_email>`
- `phone:<normalized_digits>`
- `name_school:<normalized_full_name>|<normalized_school>`

Rows without a usable key must go to manual review.

## Import Flow

1. Inventory source workbooks for each season.
2. Map columns into templates.
3. Normalize email, phone, full name, school, role, dates.
4. Build person dedupe report.
5. Review ambiguous matches manually.
6. Import or upsert `seasons`.
7. Import or upsert `people`.
8. Import `person_roles`.
9. Import/update `mentor_profiles` and `mentee_profiles`.
10. Resolve IDs for `matches`.
11. Import `matches`.
12. Resolve IDs for events and participation.
13. Import `events` and `event_participations`.
14. Import `mentoring_recaps`.
15. Produce import summary and QA counts.

## Screens Needed

Initial internal screens:

- Historical Import Dashboard.
- Import Batch Detail.
- Duplicate Review Queue.
- Unresolved Person Match Queue.
- Season Data Completeness dashboard.

Later screens:

- Cross-season person journey.
- Mentor history by season.
- Mentee alumni/support-team transition view.
- Historical data correction queue.

## User Flow

Data steward flow:

1. Select source season.
2. Upload or place mapped template files.
3. Run dry-run.
4. Review duplicate and unresolved rows.
5. Approve import batch.
6. Run import.
7. Check season-level summary.
8. Lock or mark batch as accepted.

Admin/core team flow:

1. Open historical season.
2. Validate people count, role count, matches, recaps, events.
3. Flag suspicious rows.
4. Create action items for follow-up if needed.

## Admin Actions

- Create import batch.
- Mark row as matched to existing person.
- Mark row as new person.
- Reject row from import.
- Approve batch.
- Roll back batch if needed.
- Create data quality action item.
- Lock historical season after QA.

## Data Risks

High risk:

- Duplicate people from old emails/phone changes.
- Same person has different spelling across seasons.
- Role confusion: mentee vs support_team vs core_team.
- Historical mentor listed as active without actual participation.
- Missing season IDs in matches/recaps.
- Recaps with wrong month/date.

Medium risk:

- Old schools/majors not normalized.
- Events have inconsistent names.
- Attendance source confidence differs by season.

Mitigations:

- Dry-run only first.
- Manual review for weak dedupe matches.
- Batch ID on every imported row or import log.
- No destructive overwrite of current S11 profile data.
- Prefer append-only role/history over mutation.

## Migration Needs

Required before production historical import:

- Import batch logging table, unless existing metadata can fully trace source.
- Optional import issue table or use `action_items`.
- Confirm `person_roles` has season role/status/source fields.
- Confirm all imported operational tables can store `season_id`.

Nice to have:

- Source provenance fields or metadata on imported rows.
- Views for cross-season person history.
- Constraints preventing duplicate official role per person/season/role when active.

## Definition Of Ready

Historical import is ready only when:

- Templates are reviewed.
- Dry-run script exists.
- Dedupe report is generated.
- Manual review process is assigned.
- Rollback plan is documented.
- Staging import succeeds before production.
