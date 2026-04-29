# VAM OS Live Ops Test Checklist

Status: Ready-for-pilot checklist for the 2-week live ops test with one Support Team.

Pilot window: 2 weeks
Pilot surface: `/operations` and `/operations/tasks`
Production note: Do not touch production data, KPI logic, RLS on `mentoring_recaps` or `event_participations`, or cron/background jobs during this pilot.

## Scope

- Validate the Phase 4 Workflow System in a real Support Team operating rhythm.
- Use `/operations` as the KPI and monthly health dashboard.
- Use `/operations/tasks` as the working queue for follow-up, data issues, corrections, ownership, comments, and status changes.
- Confirm role behavior for admin, viewer, and non-admin access.
- Collect daily feedback on clarity, missing states, assignment flow, and operational handoff friction.

Out of scope:

- Production rollout.
- KPI formula changes.
- New RLS policies on `mentoring_recaps` or `event_participations`.
- Automated jobs, cron, scheduled generation, or background processing.
- Bulk data mutation outside the agreed pilot records.

## Test Users

- Ops Lead: one admin or super_admin responsible for pilot coordination and final go/no-go.
- Recap Steward: one admin or super_admin responsible for recap review and monthly follow-up generation.
- Support Team Member: one admin or super_admin who updates assigned tasks and comments.
- Viewer: one viewer or reviewer account to confirm read-only access.
- Non-admin: one authenticated or unauthenticated user not present as an active `admin_users` row to confirm access is blocked.

## Daily Actions

- Ops Lead opens `/operations` and confirms KPI cards still match the expected staging baseline for the selected month.
- Recap Steward opens `/operations/tasks`, filters `Cần follow-up`, and reviews new or open follow-up rows.
- Support Team updates assigned tasks with owner, status, and internal notes.
- Ops Lead filters by owner and overdue status to check handoff health.
- Export the current filtered task list to CSV when daily handoff or offline review is needed.
- Log any confusing empty state, unclear owner/status choice, or permission mismatch in the pilot notes.

## Weekly Actions

- End of week 1: review open, overdue, resolved, and parked tasks with the Support Team.
- End of week 1: confirm no KPI drift on `/operations` after workflow updates.
- End of week 2: export final task list, summarize resolved vs unresolved work, and tag any remaining blockers.
- End of week 2: run role checks again for admin, viewer, and non-admin users.
- End of week 2: decide READY FOR BROADER ROLLOUT or FIX BEFORE BROADER ROLLOUT.

## Success Criteria

- `/operations` KPI values remain unchanged by workflow task updates.
- `/operations/tasks` loads reliably for the selected month.
- Admin or super_admin can generate follow-up, create manual tasks, update owner/status, and add comments.
- Viewer or reviewer can load queues but cannot create, generate, update, or comment.
- Non-admin users are redirected or blocked by the auth gate.
- Owner, status, type, priority, and overdue filters support daily triage without manual URL editing.
- CSV export produces the currently filtered queue for handoff.
- Recap Steward and Ops Lead helper text is clear enough for live use without extra training.

## Failure Signals

- KPI cards on `/operations` change after task-only updates.
- `/operations/tasks` fails to load, returns RPC errors, or shows blank content without a clear error/empty state.
- Viewer or reviewer can mutate workflow records.
- Admin cannot update follow-up owner/status/comment during pilot operations.
- Non-admin can access protected operations pages.
- Filters hide work in a way the Support Team cannot explain or recover from.
- CSV export omits visible filtered rows or exports the wrong month.
- Support Team needs recurring manual database intervention to complete normal daily actions.

## Rollback Notes

- Stop the pilot immediately if permissions fail, KPI values drift, or task updates affect core recap/event records unexpectedly.
- Revert user workflow to the previous manual tracking process for the Support Team.
- Leave existing recap and event data untouched.
- Do not enable RLS on `mentoring_recaps` or `event_participations` as a pilot rollback step.
- Do not add cron/background jobs as a pilot mitigation.
- Preserve pilot notes and exported CSV files for root-cause review before retrying.
