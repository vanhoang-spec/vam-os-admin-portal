# Phase 2D Correction Workflow Spec

Purpose: let core team fix Season 11 operational data in VAM OS instead of editing CSV files or production DB manually.

Status: implementation exists in `/admin`; production requires migration before use.

## Scope

In scope:

- Data Issues queue.
- Follow-up queue.
- `action_items` table for owner/status/notes.
- Add/edit/soft-delete mentoring recap.
- Add/edit event participation.
- Audit logging for every mutation attempt.

Out of scope:

- Season 12 recruitment.
- Historical season import.
- Direct hard-delete of operational data.
- Automated production data correction without admin approval.

## Required Migration

Migration file:

- `supabase_migrations/027_phase2d_admin_correction_workflow.sql`

Why required:

- Production currently does not have `public.action_items` in schema cache.
- Phase 2D queue needs lightweight columns:
  - `id`
  - `type`
  - `target_person_id`
  - `season_code`
  - `status`
  - `owner_email`
  - `created_at`
  - `updated_at`
  - `notes`
- Recap soft delete needs `mentoring_recaps.status = 'deleted'`.

The migration is additive/idempotent and also keeps compatibility with the broader Phase 4 `action_items` model if that migration is later applied.

## User Roles

| Role | Permission |
| --- | --- |
| `viewer` | No correction workflow access. |
| `reviewer` | No mutation access in current implementation. |
| `admin` | Manage queues and recap corrections. |
| `super_admin` | Manage queues, recap corrections, and user management. |

## UI

Route:

- `/admin`

Tabs:

- `Data Issues`
- `Follow-up`

Navigation:

- `Admin Workflow` appears for `admin` and `super_admin`.

## Data Issues Queue

Issues detected from production rows:

- unmatched recap
- missing mentee
- missing mentor
- invalid date
- duplicate recap

Each issue card should show:

- issue type
- severity
- recap id
- season code
- meeting date
- mentee display
- mentor display
- recap link
- details
- current action item if one exists

Actions:

- Create action item.
- Assign owner by `owner_email`.
- Resolve existing action.

## Follow-up Queue

Action item statuses:

- `open`
- `in_progress`
- `resolved`
- `dropped`
- `no_response`

Actions:

- Create manual follow-up.
- Assign owner.
- Change status.
- Add note.
- Resolve.

Notes are append-only in the UI flow: new notes are added with timestamp and admin email.

## Recap Correction

### Add Recap Manual

Fields:

- `season_code`
- `match_id`
- `mentor_person_id`
- `mentee_person_id`
- `meeting_date`
- `recap_url`
- `recap_note`
- `meeting_type`
- `status`
- `admin_notes`

Rules:

- `meeting_date` must be `YYYY-MM-DD`.
- `meeting_month` is derived from `meeting_date`.
- `recap_source` is `admin_input`.
- If no URL is known yet, implementation uses a safe placeholder instead of crashing.

### Edit Recap

Editable fields:

- `match_id`
- `mentor_person_id`
- `mentee_person_id`
- `meeting_date`
- `recap_url`
- `recap_note`
- `meeting_type`
- `status`
- `issue_flag`
- `admin_notes`

Rules:

- Correction reason should be supplied.
- Edit writes audit record to `activity_correction_log`.
- Edit attempts admin-level audit record in `admin_audit_log`.

### Soft Delete Recap

Rules:

- No physical delete.
- Set `status = 'deleted'`.
- Set `issue_flag = true`.
- Append reason to `admin_notes`.
- Write audit logs.

## Event Participation Correction

Required for full Phase 2D parity:

- Add event participation.
- Edit event participation.
- Soft-remove or mark invalid participation.

Recommended fields:

- `event_id`
- `season_id` or `season_code`
- `person_id`
- `role_at_event`
- `registration_status`
- `attendance_status`
- `attendance_date`
- `recap_url`
- `excuse_reason`
- `admin_notes`
- `captured_by`
- `walk_in`

Implementation status:

- Existing app already reads `event_participations`.
- Phase 2D migration/action foundation is ready.
- Dedicated `/admin` event participation forms should be added next if the team wants event correction in the same console.

## Audit Log

Every mutation should attempt:

- `activity_correction_log` for operational correction history.
- `admin_audit_log` for admin action history.

Audit failure must not white-screen the app. It should return safe UI feedback and log server-side details.

## No Crash Requirements

If tables/columns are missing:

- `/admin` should show ErrorBox.
- Query failures should be logged server-side.
- UI must not expose secrets.
- Mutations should return safe messages.

## Current Production Gaps

| Gap | Impact | Fix |
| --- | --- | --- |
| `action_items` missing | Data Issues and Follow-up queues cannot persist owner/status/notes. | Apply `027_phase2d_admin_correction_workflow.sql`. |
| `seasons` table empty | Season filtering cannot strictly resolve `UEHM-S11`. | Add/backfill Season 11 via approved migration/backfill, not manual DB edits. |
| Operations RPC missing | `/operations` uses fallback, not RPC. | Apply RPC migration or make fallback canonical. |
| Event participation correction forms not yet in `/admin` | Core team still lacks in-app event attendance edit flow. | Add forms/actions mirroring recap correction. |

## QA Checklist

Before production use:

- Apply migration to staging.
- Login as `admin`.
- Open `/admin`.
- Confirm Data Issues tab loads.
- Create action item from issue.
- Assign owner.
- Add note.
- Resolve item.
- Add manual recap.
- Edit recap.
- Soft delete recap.
- Confirm audit rows are written.
- Confirm viewer/reviewer cannot mutate.
- Repeat in production only after staging passes.

## QA Command Results

Final local command results:

- `npm.cmd run lint`: pass.
- `npm.cmd run typecheck`: pass.
- `npm.cmd run build`: pass.
