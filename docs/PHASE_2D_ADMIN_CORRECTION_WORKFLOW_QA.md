# Phase 2D Admin Correction Workflow QA

Scope: `/admin` correction workflow for data issues, follow-up action items, and recap correction.

## Migration

Apply:

- `supabase_migrations/027_phase2d_admin_correction_workflow.sql`

Expected schema:

- `action_items.id`
- `action_items.type`
- `action_items.target_person_id`
- `action_items.season_code`
- `action_items.status`
- `action_items.owner_email`
- `action_items.created_at`
- `action_items.updated_at`
- `action_items.notes`

The migration also keeps compatibility with the broader Phase 4 `action_items` shape and allows `mentoring_recaps.status = 'deleted'` for soft delete.

## Route QA

- Login as `admin` or `super_admin`.
- Open `/admin`.
- Confirm tabs show:
  - `Data Issues`
  - `Follow-up`
- Login as `viewer` or `reviewer`.
- Open `/admin`.
- Confirm safe access-denied message, no blank crash.

## Data Issues Queue

Confirm queue counts and cards for:

- unmatched recap
- missing mentee
- missing mentor
- invalid date
- duplicate recap

Actions:

- Create action item from a data issue.
- Assign `owner_email`.
- Add note.
- Resolve action item.
- Confirm resolved item no longer blocks the issue card action.

## Follow-up Queue

Actions:

- Create manual follow-up.
- Assign owner.
- Change status to `in_progress`.
- Add note.
- Resolve.
- Mark `no_response`.

Expected:

- `updated_at` changes.
- Notes append with timestamp and admin email.
- Server logs do not expose secrets.

## Recap Correction

Actions:

- Add recap manual.
- Edit recap date/status/person IDs/notes.
- Soft delete recap.

Expected:

- Manual recap inserts into `mentoring_recaps`.
- Edit updates `mentoring_recaps`.
- Soft delete sets `status = 'deleted'`, does not physically delete.
- `activity_correction_log` gets correction records.
- `admin_audit_log` gets admin action records when available.

## Failure QA

Temporarily test on an environment before migration:

- `/admin` should show ErrorBox for missing `action_items`, not blank crash.
- Recap list should still load if `mentoring_recaps` is available.
- Mutations should return safe error messages if columns are missing.

## Pass Criteria

- Core team can resolve data issues and follow-ups without editing CSV/DB manually.
- No route shows blank crash on missing optional data.
- Every mutation has audit logging attempt.
- Soft delete preserves original recap record.
