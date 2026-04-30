# VAM OS Schema Audit

Audit date: 2026-04-30 Asia/Saigon.

Production target checked by read-only Supabase probe:

- Host: `qkkroesfiazsejkzflcd.supabase.co`
- Project ref: `qkkroesfiazsejkzflcd`
- Probe method: `select(...).limit(0)` against the columns currently used by the app. No business rows were read.

## Result Summary

| Table | Production status | Code usage status | Notes |
| --- | --- | --- | --- |
| `admin_users` | OK | Required | Used by auth resolution, admin console, workflow ownership. |
| `admin_scope_access` | OK | Required | Production has `status` and `updated_at`; official sync migration added in `026_production_schema_sync_admin_audit.sql`. |
| `admin_audit_log` | OK | Required | Production has requested audit columns including `details` and `updated_at`; official sync migration added. |
| `seasons` | OK | Required | Dashboard and imports resolve by `code`, especially `UEHM-S11`. |
| `people` | OK | Required | Master identity table. Import rule: one row per real person. |
| `person_roles` | OK | Required for historical imports | Not heavily rendered in dashboard yet, but required for multi-season role history. |
| `mentor_profiles` | OK | Required | Profile table is person-level; season activity lives in `person_roles` and `matches`. |
| `mentee_profiles` | OK | Required | Profile table is person-level; season activity lives in `person_roles` and `matches`. |
| `matches` | OK | Required | Operations and dashboard depend on active mentor/mentee links. |
| `mentoring_recaps` | OK | Required | Operations depends on `meeting_month`, `meeting_type`, `captured_by`, `status`. |
| `events` | OK | Required | Operations uses event month and event metadata. |
| `event_participations` | OK | Required | Operations uses attendance and event participation columns. |
| `feedback_responses` | OK | Optional | Present in production, not currently used by main dashboard. |
| `action_items` | Missing in production schema cache | Optional/Phase 4 | Workflow routes and RPCs must remain optional until Phase 4 migration is applied. |

## Runtime Query Surfaces

The app currently reads data through:

- `lib/data.ts`: dashboard, operations, detail pages, workflow RPC helpers.
- `lib/admin-auth.ts`: current admin resolution from `admin_users`.
- `lib/admin-users.ts`: super admin console for `admin_users`, `admin_scope_access`, `admin_audit_log`.
- `app/login/actions.ts`: login guard checks `admin_users`.

The high-risk schema mismatch points are:

- `admin_scope_access.status`
- `admin_scope_access.updated_at`
- `admin_audit_log` table existence
- `admin_audit_log.details`
- `admin_audit_log.updated_at`
- `action_items` and workflow RPCs on production until Phase 4 is deployed

## Required Production Invariants

Production and staging must both satisfy:

- `admin_scope_access.status` exists, defaults to `active`, and is constrained to `active` or `inactive`.
- `admin_scope_access.updated_at` exists and is maintained by trigger.
- `admin_audit_log` exists with `actor_admin_user_id`, `target_admin_user_id`, `action_type`, `before_data`, `after_data`, `details`, `created_at`, `updated_at`.
- Admin audit writes must not block the actual admin mutation if audit insert fails; the error must be logged server-side.
- Missing optional workflow tables must produce an ErrorBox or safe empty state, not a blank crash.

## Route Stability Notes

Checked routes for this audit:

- `/`
- `/operations`
- `/admin/users`
- `/login`
- `/admin/debug-auth`

Runtime hardening added:

- `lib/data.ts` logs Supabase query errors server-side and returns safe fallbacks through `QueryResult`.
- `lib/admin-auth.ts` logs admin auth lookup/backfill errors without exposing tokens or secrets.
- `lib/admin-users.ts` logs `admin_audit_log` insert failure without failing the user mutation.
- `app/layout.tsx` catches admin lookup failure so a broken auth query does not crash the whole shell.
- `app/error.tsx` provides a safe route-level fallback UI for unexpected runtime errors.

## Open Follow-up

`action_items` is not present in production as of the probe. Before enabling production workflow queues, apply `supabase_migrations/023_phase4_operations_workflow_system.sql` or a consolidated production-safe workflow migration, then rerun the probe.
