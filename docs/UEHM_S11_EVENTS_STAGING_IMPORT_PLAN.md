# UEHM Season 11 Events Staging Import Plan

Status: Draft for review. Do not run on production.

Date: 2026-05-07

## Scope

Prepare staging-only schema/import artifacts for UEHM Season 11 event master records and MVP event participation rows.

Included in first staging import:

| Event code | Event | Import status | Expected dedup rows |
|---|---|---:|---:|
| `UEHM_S11_KICKOFF` | Season 11 Kickoff | include | 651 |
| `UEHM_S11_TRAINING01` | Training 01 - Crack the Code | include | 307 |
| `UEHM_S11_TRAINING02` | Training 02 | include | 317 |
| `UEHM_S11_ORIENTATION` | Mentee Orientation | hold | 1,480 |

Expected in-scope dedup rows: 1,275.

Orientation is explicitly held because the official event date is still unknown.

## Schema Findings

Local migration history:

- `supabase_migrations/012_create_activity_tracking_tables.sql` creates `event_participations`.
- `supabase_migrations/014_seed_phase2_events.sql` assumes an `event_type` enum and casts seed values using `seed_events.event_type::event_type`.
- Later dashboard RPC migrations read `events.event_type` and `event_participations` fields but do not redefine the event schema.

Live staging inspection on `ljfneyuvpxrmejpxsmpz`:

- `events.event_type` is currently plain `text`.
- No `public.event_type` enum exists on staging.
- No `events.event_type` check constraint exists on staging.
- The app layer currently validates event type through `lib/event-constants.ts`.

Current app-level event type values:

`orientation`, `training`, `kickoff`, `company_tour`, `networking`, `closing`, `business_case`, `job_shadowing`, `other`

Historical migration comments also mention:

`workshop`, `community`, `matching`

Event participation schema:

- Key columns: `event_id`, `season_id`, `person_id`, `role_at_event`, `registration_status`, `attendance_status`, `attendance_date`, `recap_url`, `excuse_reason`, `admin_notes`, `captured_by`, `walk_in`.
- Local migration constraints allow `registration_status in ('registered', 'unknown')`.
- Local migration constraints allow `attendance_status in ('attended', 'registered_absent')`.
- Migration draft `049_expand_event_participation_status_model.sql` expands the existing two status columns instead of adding new columns.
- Local migration constraints allow `role_at_event in ('mentor', 'mentee', 'core_team', 'speaker', 'trainer', 'guest', 'unknown')`.
- Live staging currently has these columns as nullable text/uuid/date fields and has no check constraints on `event_participations`.
- There is no profile_id/email/phone/MSSV column on `event_participations`; participants must be linked through `person_id`.
- Source trace can be preserved in `admin_notes` and `captured_by`.

## Kickoff Event Type Decision

Kickoff is a core season-opening event and should not be classified as networking.

Migration draft:

`supabase_migrations/048_add_kickoff_event_type.sql`

Behavior:

- If `public.event_type` enum exists, add `kickoff` if missing.
- If the known `events_event_type_check` constraint exists, recreate it with `kickoff` while preserving existing app/historical values.
- If `events.event_type` is plain text with no check constraint, no restrictive DB change is needed; the migration records the official decision through a column comment.

App note:

`lib/event-constants.ts` now includes `kickoff`, so `/events` filters, labels, and create/edit validation can handle Kickoff as its own type.

## Status Model Upgrade

The initial dry-run found that the first import SQL mapped `registered` and `registered_confirmed` rows to `registered_absent`. That is held because registered-only is not absent.

Registered-only means a person appears in registration data, but the source does not prove they skipped the event. Confirmed-only means the person confirmed before the event, but the source still does not prove attendance or absence. Treating either as `registered_absent` would create false no-show/absence KPI data.

Migration draft:

`supabase_migrations/049_expand_event_participation_status_model.sql`

Recommended minimal model:

| Column | Values |
|---|---|
| `registration_status` | `registered`, `confirmed`, `declined`, `no_response`, `cancelled`, `unknown` |
| `attendance_status` | `attended`, `absent_excused`, `absent_unexcused`, `registered_no_response`, `walk_in`, `unknown`, `registered_absent` legacy |

This keeps existing columns and separates registration lifecycle from attendance outcome. Attendance KPIs should count only `attended` as attended and only `absent_excused`, `absent_unexcused`, or legacy `registered_absent` as absence. `registered_no_response` and `unknown` are not absence.

## Staging Import Script

Script path:

`data_imports/uehm_s11_events/scripts/048_stage_uehm_s11_events_import.sql`

Verification query path:

`data_imports/uehm_s11_events/scripts/048_verify_uehm_s11_events_staging_import.sql`

Source file:

`data_imports/uehm_s11_events/event_participations_import_ready_dedup.csv`

The script is psql-oriented because it uses `\copy` to load the local CSV into a temporary table.

Suggested staging-only sequence from repo root:

```powershell
# 1. Point DATABASE_URL to staging only.
# 2. Apply migration 048 on staging.
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase_migrations/048_add_kickoff_event_type.sql

# 3. Apply migration 049 on staging.
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase_migrations/049_expand_event_participation_status_model.sql

# 4. Run the staging import script.
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/uehm_s11_events/scripts/048_stage_uehm_s11_events_import.sql

# 5. Run verification queries.
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data_imports/uehm_s11_events/scripts/048_verify_uehm_s11_events_staging_import.sql
```

Do not run these commands against production.

## Import Rules

Event master records:

- Upsert by canonical `legacy_event_temp_id`.
- Canonical event codes use underscores: `UEHM_S11_KICKOFF`, `UEHM_S11_TRAINING01`, `UEHM_S11_TRAINING02`.
- Existing older hyphenated seed rows such as `UEHM-S11-KICKOFF` are reused and updated rather than duplicated.
- Kickoff imports as `event_type = 'kickoff'`.
- Kickoff `starts_at = '2025-11-08 08:00:00+07'`.
- Kickoff location and business notes are preserved in `source_notes`.

Kickoff source note:

`Business event type: kickoff. Core season-opening event. Mandatory for Season 11 mentors and mentees; alumni also invited. Location: Hội trường A.116, cơ sở A Đại học UEH, 59C Nguyễn Đình Chiểu, Phường Xuân Hòa, TP.HCM. Source: Antigravity Phase 2 dedup import-ready file.`

Participation rows:

- Insert only rows from the three included event codes.
- Do not import Orientation.
- Do not create fake people.
- Do not import rows that cannot resolve to exactly one `people.id`.
- Do not import rich feedback/registration details into unsupported schema.
- Store source trace in `admin_notes` and `captured_by`.
- Avoid duplicate participation rows with `not exists (event_id, person_id)`.

Identity resolution precedence:

1. Email: `people.email_primary`.
2. Phone: normalized `people.phone_primary`.
3. MSSV: normalized `mentee_profiles.mssv` or `mentee_profiles.mentee_code`.
4. Otherwise skip and log to `public.staging_uehm_s11_event_import_skips`.

Attendance mapping:

| Source `attendance_status_mvp` | DB `registration_status` | DB `attendance_status` | KPI meaning |
|---|---|---|---|
| `attended` | `registered` | `attended` | Counts as attended |
| `registered_confirmed` | `confirmed` | `unknown` | Not attended, not absent |
| `registered` | `registered` | `registered_no_response` | Not attended, not absent |
| `absent` + excused flag | `declined` | `absent_excused` | Counts as absence |
| `absent` without excused flag | `registered` | `absent_unexcused` | Counts as absence |

After status model update, the import can safely bring in registered-only and confirmed-only rows because they no longer inflate absence/no-show counts.

## Verification Queries

Use:

`data_imports/uehm_s11_events/scripts/048_verify_uehm_s11_events_staging_import.sql`

It checks:

1. Events inserted/skipped by event_code.
2. Participant count by event.
3. Attendance status count by event.
4. Duplicate participation check.
5. Rows skipped due to missing/ambiguous identity.
6. Orientation was not imported.

Expected source counts before identity matching:

| Event code | Expected source rows |
|---|---:|
| `UEHM_S11_KICKOFF` | 651 |
| `UEHM_S11_TRAINING01` | 307 |
| `UEHM_S11_TRAINING02` | 317 |

Final inserted participation counts may be lower if staging lacks matching `people` / `mentee_profiles` rows.

## Rollback / Cleanup Notes

Staging event import cleanup:

```sql
delete from public.event_participations ep
using public.events e, public.seasons s
where ep.event_id = e.id
  and e.season_id = s.id
  and s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
  and ep.captured_by = 'uehm_s11_events_048_staging_import';

delete from public.events e
using public.seasons s
where e.season_id = s.id
  and s.code = 'UEHM-S11'
  and e.legacy_event_temp_id in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02')
  and not exists (
    select 1 from public.event_participations ep where ep.event_id = e.id
  );
```

Skip-log cleanup:

```sql
delete from public.staging_uehm_s11_event_import_skips
where event_code in ('UEHM_S11_KICKOFF', 'UEHM_S11_TRAINING01', 'UEHM_S11_TRAINING02');
```

Migration 048 rollback:

- Plain text/check-constraint environments can remove or adjust `kickoff` rows and recreate the prior check if needed.
- Enum environments cannot directly remove `kickoff`; rollback requires a replacement enum type and controlled column type swap.

## Production Go / No-Go Checklist

Production remains blocked until all are true:

- Migration 048 applied and verified on staging.
- Staging import script runs successfully.
- Verification queries show no duplicate `(event_id, person_id)` participation rows.
- Kickoff imports as `event_type = kickoff`, not `networking`.
- Orientation is absent from imported event rows.
- Skipped identity rows are reviewed and accepted.
- `/events` and event detail pages load on staging.
- Counts are signed off by operations owner.
- A separate production import script/runbook is prepared and reviewed.
