# VAM OS Roadmap

## Phase 0: Data Import and Admin Read-Only MVP — Completed

- Cleaned and imported core Season 11 data.
- Built read-only Admin Portal MVP.
- Connected Supabase production data.
- Implemented Dashboard, People, Mentors, Mentees, Applications, Matches, Person Detail, Match Detail, Application Detail, and Data Issues.
- Added display cleanup and operational summaries.

## Phase 1: Stabilize and Deploy Internal Admin Portal

- Complete QA checklist.
- Deploy internal preview.
- Gather feedback from VAM core team.
- Fix critical usability and data review issues.
- Add basic operational documentation.

## Phase 2: Edit/Update Profile and Issue Resolution Workflow

- Add authenticated admin access.
- Add safe edit forms for selected fields.
- Add issue statuses, reviewer notes, and resolution workflow.
- Add audit trail for edits.
- Add export/import support for review workflows.

## Phase 3: Event Management and RSVP

- Model events, sessions, workshops, and attendance.
- Add RSVP tracking.
- Add participant views by event.
- Add attendance and follow-up reporting.

## Phase 4: Mentor/Mentee Login Portal

- Add mentor and mentee authentication.
- Add self-service profile review.
- Add limited update workflows.
- Add personal match/session dashboards.

## Phase 5: Session, Recap, Feedback Workflow

- Track mentoring sessions.
- Capture recaps and action items.
- Collect mentor/mentee feedback.
- Monitor relationship health and intervention signals.

## Phase 6: Email Automation and Notifications

- Add template-based email notifications.
- Notify mentors/mentees about matches, sessions, RSVP, and reminders.
- Add delivery status and resend workflow.

## Phase 7: Role-Based Access, RLS, Audit Log

- Design admin, core team, mentor, mentee, and reviewer roles.
- Enable Supabase RLS policies.
- Add audit logging for sensitive reads and all writes.
- Add production security review.

## Phase 8: AI Matching/Support

- Add AI-assisted matching review.
- Add profile summarization.
- Add data quality suggestions.
- Add admin copilot for search, triage, and communication drafting.
