# VAM OS Phase 2 Claude Review Brief

Superseded: The key business decisions have been finalized and incorporated into [Phase 2 Activity & Event Tracking Plan](PHASE_2_ACTIVITY_AND_EVENT_TRACKING_PLAN.md) and [Activity Import Guide](ACTIVITY_IMPORT_GUIDE.md). Keep this file as an archive of the Claude review package.

This brief is for Claude’s business/SOP review. It is intentionally concise and does not include the full repo.

## 1. Current VAM OS Status

- VAM OS Admin Portal MVP v0.1 is deployed to Vercel Preview.
- Supabase production data is live and connected.
- The Admin Portal is read-only.
- A temporary internal password gate is enabled via `VAM_OS_ADMIN_PASSWORD`.
- Supabase Auth and RLS are not implemented yet.
- The Preview URL should remain private.
- Existing app pages include Dashboard, People, Mentors, Mentees, Applications, Application Detail, Matches, Match Detail, People Detail, and Data Issues.

## 2. Phase 2 Goal

Phase 2 aims to track lightweight activity and event participation:

- Track mentee monthly recaps after mentor meetings.
- Track event/training registration and attendance.
- Allow admins to view activity by:
  - mentee
  - mentor
  - month
  - event/training
- Support operations review without building a mentee portal yet.

## 3. Current Real-World Process

- Mentees post recaps in a Facebook group after meeting mentors or joining training/events.
- Admin/core team records:
  - meeting or event date
  - Facebook recap link
  - basic attendance status
  - optional admin notes
- VAM OS should not duplicate full Facebook recap content at this stage.
- Storing recap links is enough for MVP.
- There is no mentee self-service portal yet.

## 4. Draft Data Capture Templates

### Mentoring Recaps Template

File:

`templates/mentoring_recaps_import_template.csv`

Fields:

- `season_code`
- `mentee_email`
- `mentee_code`
- `mentor_email`
- `mentor_code`
- `match_id`
- `meeting_date`
- `meeting_month`
- `recap_url`
- `recap_source`
- `recap_note`
- `issue_flag`
- `admin_notes`

Suggested values:

- `recap_source`: `facebook_group`, `google_sheet`, `admin_input`
- `issue_flag`: `true`, `false`

### Event Participations Template

File:

`templates/event_participations_import_template.csv`

Fields:

- `season_code`
- `event_code`
- `event_name`
- `event_date`
- `person_email`
- `person_code`
- `role_at_event`
- `registration_status`
- `attendance_status`
- `recap_url`
- `excuse_reason`
- `admin_notes`

Suggested values:

- `registration_status`: `registered`, `not_registered`, `cancelled`, `unknown`
- `attendance_status`: `attended`, `absent_with_notice`, `absent_without_notice`, `unknown`

## 5. Open Business Questions

- What counts as an official mentor meeting?
- Is a Facebook recap required for every mentor meeting?
- Can one recap represent multiple meetings?
- Who is responsible for copying recap links?
- Should missing recap automatically create a follow-up flag?
- What is the expected meeting frequency by month?
- What event types should be tracked in Phase 2?
- Should event attendance include mentors, mentees, speakers, and organizers?
- What is the official definition of absent with notice vs absent without notice?
- Should event recap links be required or optional?
- Should activity data be editable after import?
- Who can approve or correct activity records?
- What monthly reports does the founder/core team need?
- Should activity affect matching or relationship health scoring later?
- What counts as active, inactive, or at-risk for a mentee/mentor relationship?

## 6. Decisions Needed From Claude

Claude should help finalize:

- Required vs optional fields for mentoring recap records.
- Required vs optional fields for event participation records.
- Official values/statuses for recap source, issue flag, registration status, attendance status, and role at event.
- Monthly SOP for collecting recap links.
- Monthly SOP for checking event/training attendance.
- Follow-up rules when recaps or attendance are missing.
- Definitions of active, inactive, and at-risk relationships.
- Which dashboards/reports are needed for monthly operations.
- Who owns each step in the workflow.

## 7. Explicit Instruction For Claude

Claude should not write code.

Claude should focus on:

- Finalizing the business SOP.
- Finalizing operational rules.
- Clarifying responsibilities.
- Confirming statuses and definitions.
- Confirming what is required before database schema or app implementation begins.

No SQL migration or app implementation should happen until the SOP decisions are finalized.
