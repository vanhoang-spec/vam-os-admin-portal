# Phase 2 Activity & Event Tracking Plan Draft

Superseded: This draft has been superseded by [Phase 2 Activity & Event Tracking Plan](PHASE_2_ACTIVITY_AND_EVENT_TRACKING_PLAN.md). Keep this file as an archive only.

Status: Draft only. Do not implement schema until the business SOP is reviewed and finalized.

## Context

VAM OS Admin Portal MVP v0.1 is deployed as a read-only internal admin portal. Current production data includes people, mentor profiles, mentee profiles, matches, applications, events, event registrations, and feedback.

In the current operating model, mentees post recaps in a Facebook group after meeting mentors or attending training. For Phase 2 MVP, the admin/core team only needs to record lightweight activity evidence:

- Date of mentor meeting or event attendance.
- Facebook recap link.
- Basic attendance status.
- Optional admin notes.

The system does not need a mentee portal yet. It should not duplicate full Facebook recap content at this stage. Storing recap links is enough for MVP.

## Business Goals

- Give the core team a reliable view of mentoring and training activity.
- Track whether mentees are actually meeting mentors.
- Track event/training attendance.
- Support monthly operations review.
- Identify inactive relationships or mentees needing follow-up.
- Preserve links to existing Facebook recap posts without copying full recap content.

## MVP Scope

Phase 2 MVP should support:

- Importing or manually recording mentoring recap links.
- Importing or manually recording event/training participation.
- Viewing activity on mentee profiles.
- Viewing activity on mentor profiles.
- Viewing event attendance summaries.
- Flagging records that need follow-up.

## Out of Scope

Not included yet:

- Mentee login portal.
- Mentor login portal.
- Mentee self-submission form.
- Full recap content storage.
- Automated Facebook scraping.
- Automated attendance check-in.
- Email notifications.
- AI summary of recap content.
- Payment, certification, or reward workflows.
- Final database schema until SOP is confirmed.

## Draft Data Model

### `mentoring_recaps`

Purpose:

Track one mentoring meeting or recap evidence item between a mentee and mentor.

Draft fields:

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
- `created_by uuid`
- `updated_at timestamptz`

Suggested `recap_source` values:

- `facebook_group`
- `google_sheet`
- `admin_input`

Suggested `issue_flag` values:

- `true`
- `false`

### `events`

Purpose:

Represent official VAM events, workshops, trainings, matching sessions, or community activities.

Current system already has an `events` concept. Phase 2 should review existing fields before changing schema.

Draft fields:

- `id uuid`
- `season_id uuid`
- `season_code text`
- `event_code text`
- `event_name text`
- `event_type text`
- `event_date date`
- `starts_at timestamptz`
- `ends_at timestamptz`
- `location text`
- `online_url text`
- `status text`
- `admin_notes text`
- `created_at timestamptz`
- `updated_at timestamptz`

Suggested `event_type` values:

- `training`
- `workshop`
- `orientation`
- `community`
- `matching`
- `other`

### `event_participations`

Purpose:

Track registration and attendance for a person at an event/training.

Draft fields:

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
- `created_by uuid`
- `updated_at timestamptz`

Suggested `role_at_event` values:

- `mentee`
- `mentor`
- `speaker`
- `trainer`
- `organizer`
- `guest`
- `unknown`

Suggested `registration_status` values:

- `registered`
- `not_registered`
- `cancelled`
- `unknown`

Suggested `attendance_status` values:

- `attended`
- `absent_with_notice`
- `absent_without_notice`
- `unknown`

### `follow_up_flags`

Purpose:

Optional table for follow-up tasks triggered by inactive matches, missed attendance, missing recaps, or admin review.

Draft fields:

- `id uuid`
- `season_id uuid`
- `person_id uuid`
- `match_id uuid`
- `event_id uuid`
- `flag_type text`
- `priority text`
- `status text`
- `reason text`
- `assigned_to_user_id uuid`
- `due_date date`
- `resolved_at timestamptz`
- `admin_notes text`
- `created_at timestamptz`
- `created_by uuid`

Suggested `flag_type` values:

- `missing_recap`
- `no_recent_mentor_meeting`
- `missed_event`
- `relationship_risk`
- `data_quality`
- `other`

## Relationships

### Seasons

Activity records should be scoped to a season.

Recommended:

- Store `season_id` for relational integrity.
- Allow `season_code` in import templates for human-friendly import.

### People

Activity ultimately relates to `people.id`.

For imports:

- Use email and/or code to locate people.
- Preserve raw email/code for audit and troubleshooting.

### Matches

Mentoring recaps should preferably link to `matches.id`.

If `match_id` is missing:

- Resolve using mentee + mentor + season.
- If multiple matches exist, flag for review.

### Mentors and Mentees

Mentoring recaps should support:

- Mentee activity timeline.
- Mentor workload/activity view.
- Match-level activity history.

Event participation should support both mentor and mentee attendance.

## Admin Workflow: Adding Mentoring Recap Records

Draft workflow:

1. Core team reviews Facebook group recap posts.
2. Admin copies the Facebook post URL.
3. Admin fills one row in the mentoring recap template.
4. Admin identifies mentee by email or mentee code.
5. Admin identifies mentor by email, mentor code, or match ID.
6. Admin enters meeting date and meeting month.
7. Admin sets `recap_source = facebook_group`.
8. Admin sets `issue_flag = true` only if the record needs follow-up.
9. Admin imports rows after schema and import process are approved.

## Admin Workflow: Recording Event/Training Attendance

Draft workflow:

1. Core team prepares event code/name/date.
2. Admin exports or compiles attendance list.
3. Admin fills one row per participant.
4. Admin identifies participant by email or person code.
5. Admin sets role at event.
6. Admin records registration and attendance status.
7. Admin optionally adds recap URL or excuse reason.
8. Admin imports rows after schema and import process are approved.

## Mentee Profile Activity View

Future mentee profile should show:

- Recent mentoring recap links.
- Meeting dates by month.
- Total mentoring meetings recorded.
- Events attended.
- Events missed.
- Follow-up flags.

Useful metrics:

- Last mentor meeting date.
- Number of meetings this season.
- Number of attended trainings/events.
- Missing recap count.

## Mentor Profile Activity View

Future mentor profile should show:

- Assigned mentees.
- Recorded meetings by mentee.
- Total active mentees.
- Total mentoring meetings recorded.
- Recent recap links.
- Follow-up flags for mentees needing attention.

Useful metrics:

- Active mentee count.
- Mentees with no recent recap.
- Average meetings per mentee.

## Monthly Operations Dashboard Concept

Possible dashboard widgets:

- Meetings recorded this month.
- Mentees with at least one recap this month.
- Mentors with at least one recorded meeting this month.
- Mentees without any recorded mentor meeting.
- Event attendance this month.
- Follow-up flags open by priority.
- Recap source breakdown.

## Event Detail Dashboard Concept

For each event:

- Event name/date/type.
- Registered count.
- Attended count.
- Absent with notice.
- Absent without notice.
- Unknown attendance.
- Attendance by role.
- Mentee attendance list.
- Mentor/speaker attendance list.
- Recap links submitted after event.

## Open Questions for Claude/SOP Confirmation

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

## Recommendation

Do not implement schema, migrations, or app changes until the business SOP is reviewed.

Recommended next step:

1. Review this draft with Claude’s SOP.
2. Confirm definitions, statuses, and ownership.
3. Finalize CSV import process.
4. Only then create database migrations and app UI changes.
