# Phase 2 Activity & Event Tracking Plan

Status: Finalized MVP planning document. Do not create SQL migrations or change Supabase schema until the technical schema review is completed.

## Context

VAM OS Admin Portal MVP v0.1 is live as an internal, read-only admin portal. The current system connects to Supabase production data and already includes people, mentor profiles, mentee profiles, matches, applications, events, event registrations, and feedback.

Phase 2 focuses on lightweight activity and event tracking for internal operations. Mentees currently post recap links in the Facebook group after meeting mentors or joining training/events. For MVP, VAM OS should store operational evidence and links, not duplicate full Facebook content.

## Final Business Rules

- One recap row represents exactly one mentor-mentee meeting.
- One recap cannot represent multiple meetings in Phase 2 MVP.
- Each mentee is expected to submit at least one recap per month.
- A missing recap follow-up flag is created only after two consecutive months without recap.
- Event attendance statuses are limited to:
  - `attended`: Tham dự
  - `registered_absent`: Đăng ký nhưng không tham dự
- Event registration statuses are limited to:
  - `registered`
  - `unknown`
- Phase 2 event/training tracking includes only:
  - Mentee Orientation
  - Kickoff
  - Tổng kết

## Business Goals

- Track whether mentees are meeting mentors monthly.
- Preserve Facebook recap links as evidence of mentoring activity.
- Track attendance for the three core Season events/trainings.
- Support monthly operations review for the founder/core team.
- Identify mentees or mentoring relationships that need follow-up.
- Keep the workflow simple enough for admin/core team manual entry or CSV import.

## MVP Scope

- Import or record mentoring recap rows.
- Import or record event participation rows.
- Show activity history on mentee profile pages.
- Show activity history and workload on mentor profile pages.
- Show event participation summaries.
- Show monthly operations KPIs.
- Generate follow-up candidates for mentees missing recap for two consecutive months.

## Out Of Scope

- Mentee login portal.
- Mentor login portal.
- Mentee self-submission form.
- Automated Facebook scraping.
- Copying full Facebook recap content into VAM OS.
- Automated notification emails.
- AI recap summarization.
- Editing workflow, approval workflow, or audit log implementation.
- Production schema change before technical review.

## Proposed Data Model

This model is a technical draft for the next implementation step. It is not implemented yet.

### `mentoring_recaps`

Purpose: Track one mentor-mentee meeting recap.

Recommended fields:

- `id uuid`
- `season_id uuid`
- `season_code text`
- `match_id uuid`
- `mentee_person_id uuid`
- `mentor_person_id uuid`
- `mentee_email text`
- `mentee_code text`
- `mentor_email text`
- `mentor_code text`
- `meeting_date date`
- `meeting_month text`
- `recap_url text`
- `recap_source text`
- `recap_note text`
- `issue_flag boolean`
- `admin_notes text`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:

- One row equals one meeting recap.
- `meeting_month` should use `YYYY-MM`.
- `recap_url` should usually be the Facebook group post URL.
- `recap_source` allowed values:
  - `facebook_group`
  - `google_sheet`
  - `admin_input`
- `issue_flag` allowed values:
  - `true`
  - `false`

### `events`

Purpose: Track the event/training master records that are in Phase 2 scope.

Recommended fields:

- `id uuid`
- `season_id uuid`
- `season_code text`
- `event_code text`
- `event_name text`
- `event_date date`
- `event_type text`
- `admin_notes text`
- `created_at timestamptz`
- `updated_at timestamptz`

Allowed event names for Phase 2:

- `Mentee Orientation`
- `Kickoff`
- `Tổng kết`

### `event_participations`

Purpose: Track registration and attendance for people attending Phase 2 events.

Recommended fields:

- `id uuid`
- `season_id uuid`
- `season_code text`
- `event_id uuid`
- `event_code text`
- `event_name text`
- `event_date date`
- `person_id uuid`
- `person_email text`
- `person_code text`
- `role_at_event text`
- `registration_status text`
- `attendance_status text`
- `recap_url text`
- `excuse_reason text`
- `admin_notes text`
- `created_at timestamptz`
- `updated_at timestamptz`

Allowed values:

- `registration_status`: `registered`, `unknown`
- `attendance_status`: `attended`, `registered_absent`

Notes:

- `recap_url` is optional for event participation.
- Event feedback count may be calculated from the existing feedback data if available.

### `follow_up_flags`

Purpose: Track operational follow-up items generated from activity rules.

Recommended fields:

- `id uuid`
- `season_id uuid`
- `season_code text`
- `person_id uuid`
- `match_id uuid`
- `flag_type text`
- `flag_month text`
- `status text`
- `reason text`
- `admin_notes text`
- `created_at timestamptz`
- `resolved_at timestamptz`

Initial Phase 2 rule:

- Create a missing recap follow-up flag only when a mentee has two consecutive months without a recorded recap.

## Relationships

- `mentoring_recaps.mentee_person_id` relates to `people.id`.
- `mentoring_recaps.mentor_person_id` relates to `people.id`.
- `mentoring_recaps.match_id` relates to `matches.id`.
- `event_participations.person_id` relates to `people.id`.
- `event_participations.event_id` relates to `events.id`.
- `season_code` should remain available in import templates for easier admin operations and reconciliation.

## Admin Workflow: Mentoring Recaps

1. Core team reviews recap posts in the Facebook group.
2. For each mentor-mentee meeting, create one row in the mentoring recap template.
3. Fill meeting date, meeting month, recap URL, mentee identifier, and mentor or match identifier.
4. Mark `issue_flag=true` only if the recap needs admin review.
5. During monthly review, identify mentees with no recap for two consecutive months and create follow-up flags.

## Admin Workflow: Event Attendance

1. Create or confirm the event record for Mentee Orientation, Kickoff, or Tổng kết.
2. Add one participation row per person.
3. Use `registration_status=registered` when the person registered.
4. Use `registration_status=unknown` when registration data is unavailable but attendance status is known.
5. Use `attendance_status=attended` for attendees.
6. Use `attendance_status=registered_absent` for people who registered but did not attend.

## Profile Activity Views

Mentee profile activity should show:

- Monthly recap history.
- Latest meeting date.
- Latest recap URL.
- Missing recap/follow-up status.
- Event participation history for the three scoped events.

Mentor profile activity should show:

- Recaps submitted by assigned mentees.
- Active mentee count.
- Mentees missing recap for two consecutive months.
- Event participation if mentor attendance is tracked.

## Monthly Operations Dashboard

Monthly report KPIs:

- Recap count.
- Active mentee count.
- Active mentor count.
- Number of trainings/events.
- Attendance count.
- Feedback count.

Suggested drilldowns:

- Mentees with recap this month.
- Mentees missing recap for one month.
- Mentees missing recap for two consecutive months.
- Mentor workload by active mentee count.
- Attendance by event.

## Event Detail Dashboard

Each event page should eventually show:

- Event name and date.
- Registration count.
- Attendance count.
- Registered absent count.
- Attendance rate.
- Participation table.
- Optional recap links.
- Feedback count if feedback data exists.

## Recommendation

The next technical step is to design SQL migrations and read-only UI additions in a staging branch, then review them against this finalized business plan before applying anything to production.
