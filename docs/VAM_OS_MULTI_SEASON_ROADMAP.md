# VAM OS Multi-Season Roadmap

Purpose: evolve VAM OS from Season 11 operations into a multi-season lifecycle platform covering historical seasons, current operations, Season 12 recruitment, matching, kickoff, and recurring reports.

Status: roadmap only. No code changes in this document.

## North Star

VAM OS should treat a person as one long-lived identity, and each season as a separate participation lifecycle.

Core principles:

- One real person has one `people` record.
- Roles are season-specific through `person_roles`.
- Applications are not official roles.
- Mentor continuation is not automatic approval.
- Approved applications/continuations create official `person_roles`.
- Matches, recaps, events, attendance, and action items must be season-aware.

## Roadmap Modules

| Module | Name | Primary outcome |
| --- | --- | --- |
| A | Historical Import Season 1-10 | Import old seasons safely without duplicate people. |
| B | Season 11 Operations | Continue monthly operations until close/graduation. |
| C | Season 12 Mentee Recruitment | Intake, review, interview, approve/reject/waitlist mentees. |
| D | Season 12 Mentor Recruitment & Re-activation | New mentor intake and existing mentor continuation. |
| E | Season 12 Matching & Kickoff | Build approved matching pool, approve matches, run kickoff. |
| F | Monthly Operations Report | Repeatable monthly reporting across active seasons. |
| Phase 3F | CRM & Relationship History | Track contact history, feedback, follow-up, mentor reactivation, and person timeline across seasons. |

## Module A. Historical Import Season 1-10

### Goal

Bring Season 1-10 data into VAM OS as historical records while preserving current Season 11 operations.

### Tables Needed

- `seasons`
- `people`
- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `mentoring_recaps`
- `events`
- `event_participations`
- optional `action_items` or import issue table

### Screens Needed

- Historical Import Dashboard.
- Import Batch Detail.
- Duplicate Review Queue.
- Season Completeness dashboard.
- Cross-season Person History.

### User Flow

1. Data steward prepares templates.
2. Run dry-run dedupe.
3. Review ambiguous people.
4. Approve import batch.
5. Import season, people, roles, profiles, matches, events, recaps.
6. QA season summary.
7. Lock or mark historical batch accepted.

### Admin Actions

- Approve batch.
- Resolve duplicate person.
- Mark row as manual review.
- Roll back batch.
- Create data quality action item.

### Data Risks

- Duplicate people.
- Old names/emails/phones mismatch.
- Role changed across seasons.
- Missing season IDs.
- Recap dates out of range.

### Migration If Needed

- Import batch log.
- Import issue table or `action_items` extension.
- `person_roles` source/status fields.
- Import provenance fields or metadata.

## Module B. Season 11 Operations

### Goal

Continue running Season 11 until completion: monthly recaps, trainings, gatherings, graduation/tong ket, event attendance, and data correction.

### Tables Needed

- `seasons`
- `people`
- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `mentoring_recaps`
- `events`
- `event_participations`
- `action_items`
- `activity_correction_log`

### Screens Needed

- Dashboard.
- Operations Dashboard.
- Operations Tasks.
- Event Attendance.
- Recap Correction.
- Founder/Core Team Intelligence.
- Season Close dashboard.

### User Flow

1. Select Season 11.
2. Review monthly recap status.
3. Identify mentees/mentors needing follow-up.
4. Track training/gathering/graduation attendance.
5. Correct data issues with audit trail.
6. Generate monthly and end-of-season reports.

### Admin Actions

- Correct recap date/status/notes.
- Record event attendance.
- Generate follow-up action items.
- Assign owners.
- Close resolved issues.
- Mark season as closing/closed when ready.

### Data Risks

- Production missing workflow table.
- Recap status/date inconsistency.
- Event attendance duplicates.
- Season 11 hard-coding blocks future season views.

### Migration If Needed

- Apply/confirm `action_items` in production.
- Add season lifecycle fields.
- Add event types for gathering/graduation.
- Add season selector later.

## Module C. Season 12 Mentee Recruitment

### Goal

Accept student mentee applications and move candidates through review, interview, and decision before creating official Season 12 mentee roles.

### Tables Needed

- `seasons`
- `people`
- `applications`
- `application_reviews`
- `interviews`
- `person_roles`
- `action_items`

### Screens Needed

- S12 Mentee Application form.
- Application Review Queue.
- Application Detail.
- Interview Schedule.
- Decision Board.
- Duplicate Review.

### User Flow

1. Student submits application.
2. System deduplicates candidate identity.
3. Reviewer screens application.
4. Interview is scheduled if needed.
5. Interview outcome is recorded.
6. Admin approves/rejects/waitlists.
7. Approved candidate gets Season 12 `person_roles` row as `mentee`.

### Admin Actions

- Assign reviewer.
- Add review score/note.
- Schedule interview.
- Record outcome.
- Approve/reject/waitlist.
- Create follow-up action.

### Data Risks

- Duplicate applicants.
- Application treated as official mentee too early.
- Sensitive review/interview notes.
- Waitlist candidates accidentally matched.

### Migration If Needed

- `application_reviews`.
- `interviews`.
- Application status cleanup.
- Dedupe review support.

## Module D. Season 12 Mentor Recruitment & Re-activation

### Goal

Manage new mentor applications and existing mentor continuation/reactivation, including orientation before official Season 12 mentor approval.

### Tables Needed

- `people`
- `mentor_profiles`
- `mentor_applications`
- `mentor_continuation`
- `interviews`
- `events`
- `event_participations`
- `person_roles`
- `action_items`

### Screens Needed

- Mentor Application form.
- Mentor Review Queue.
- Mentor Continuation Campaign.
- No-response Follow-up Queue.
- Mentor Orientation Attendance.
- Mentor Approval Board.

### User Flow

1. Generate continuation records for current mentors.
2. Existing mentors respond continue/inactive/maybe.
3. New mentors submit applications.
4. Reviewer checks profile, capacity, availability.
5. Orientation attendance is recorded if required.
6. Admin approves Season 12 mentor.
7. Approved mentor gets Season 12 `person_roles` row as `mentor`.

### Admin Actions

- Send/record continuation request.
- Mark inactive for Season 12.
- Approve returning mentor.
- Review new mentor application.
- Update capacity.
- Mark orientation attendance.
- Create follow-up tasks.

### Data Risks

- Assuming Season 11 mentors continue automatically.
- No-response mentors counted as available.
- Inactive previous mentor cannot reactivate cleanly.
- New mentor duplicates existing person.

### Migration If Needed

- `mentor_applications`.
- `mentor_continuation`.
- Event type `mentor_orientation`.
- `action_items` type `mentor_confirmation`.

## Module E. Season 12 Matching & Kickoff

### Goal

Create matches only from approved Season 12 mentors and mentees, then prepare kickoff and activate mentoring operations.

### Tables Needed

- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `events`
- `event_participations`
- `action_items`
- `mentoring_recaps`

### Screens Needed

- Approved Matching Pool.
- Mentor Capacity dashboard.
- Draft Matching Board.
- Match Approval page.
- Kickoff Event Attendance.
- Post-kickoff Follow-up Queue.

### User Flow

1. Approved mentors and mentees enter matching pool.
2. Core team creates draft matches.
3. Reviewer approves or adjusts matches.
4. Approved matches become active at kickoff/announcement.
5. Kickoff attendance is recorded.
6. Monthly recap workflow starts for S12.

### Admin Actions

- Draft match.
- Approve/reject match.
- Change assigned mentor.
- Activate match.
- Mark kickoff attendance.
- Create follow-up for absent participants.

### Data Risks

- Draft matches counted as active.
- Waitlisted/rejected candidates matched.
- Mentor capacity exceeded.
- Kickoff attendance not linked to approved S12 roles.

### Migration If Needed

- Match lifecycle statuses.
- Match approval metadata.
- Event type `kickoff`.
- Matching audit trail.

## Module F. Monthly Operations Report

### Goal

Produce repeatable monthly reports for active seasons, starting with Season 11 and extending to Season 12.

### Tables Needed

- `seasons`
- `matches`
- `mentoring_recaps`
- `events`
- `event_participations`
- `action_items`
- `activity_correction_log`
- `person_roles`

### Screens Needed

- Monthly Report Dashboard.
- Export CSV/Markdown/PDF.
- Season Selector.
- Report QA Checklist.
- End-of-season Report.

### User Flow

1. Admin selects season and month.
2. System calculates recap count, active mentees, active mentors, follow-up count, event attendance, open actions.
3. Admin reviews anomalies.
4. Admin exports report.
5. Founder/core team reviews and signs off.

### Admin Actions

- Select reporting month.
- Review outliers.
- Resolve or defer data issues.
- Export report.
- Lock monthly report snapshot if needed.

### Data Risks

- Hard-coded S11 metrics.
- Report changes when late corrections happen.
- Missing event attendance.
- Open action items not deployed in production.

### Migration If Needed

- Report snapshot table if monthly numbers must be frozen.
- Season selector support.
- Action item production migration.

## Phase 3F. CRM & Relationship History

### Goal

Turn VAM OS into a lightweight CRM for mentors, mentees, support team, core team, and alumni so core team can preserve relationship memory across seasons.

This layer is especially important for inactive mentor reactivation, feedback tracking, sensitive concerns, and handover when new core team members join.

### Tables Needed

- `people`
- `person_roles`
- `admin_users`
- `seasons`
- `contact_logs`
- `feedback_items`
- `relationship_tasks`
- `mentor_reactivation_campaigns`
- `campaign_participants`
- `action_items`
- `events`
- `event_participations`
- `mentoring_recaps`
- `matches`

### Screens Needed

- Person Profile Timeline.
- Mentor CRM tab.
- Inactive Mentor Reactivation Board.
- Feedback Inbox.
- Relationship Task Board.
- Campaign Detail.

### User Flow

1. Admin opens a person profile and reviews the full timeline across seasons.
2. Admin adds contact log after calling/emailing/messaging a mentor or mentee.
3. Admin records outcome such as interested, maybe later, not interested, no response, needs follow-up, or concern raised.
4. Admin assigns relationship follow-up task with owner and due date.
5. For inactive mentors, campaign owner creates reactivation campaign and assigns participants to core team members or active mentors.
6. Assignees contact mentors and update campaign participant status.
7. Interested mentors enter mentor continuation/application review; only approved mentors get target-season `person_roles`.
8. Feedback items are triaged, escalated if urgent, and resolved with notes.

### Admin Actions

- Add contact log.
- Assign relationship owner.
- Create follow-up task.
- Record mentor response and reactivation intent.
- Record feedback from mentor/mentee/support team.
- Escalate urgent feedback.
- Resolve or drop CRM tasks.
- View full person timeline.
- Export campaign progress.

### Data Risks

- Sensitive feedback exposed too broadly.
- Outreach interest treated as official reactivation.
- Notes overwritten instead of appended.
- Duplicate tasks in `relationship_tasks` and `action_items`.
- CRM records attached to duplicate `people` rows.
- Inactive mentor status confused with global person status.

### Migration If Needed

- `contact_logs`.
- `feedback_items`.
- `relationship_tasks` or `action_items` CRM extension.
- `mentor_reactivation_campaigns`.
- `campaign_participants`.
- Timeline view or RPC aggregating person history.
- Permission/visibility fields for sensitive records.

## Suggested Delivery Order

1. Stabilize Season 11 operations and production workflow table.
2. Finalize multi-season data model and Season 12 recruitment migrations.
3. Build S12 mentee recruitment.
4. Build S12 mentor continuation and mentor application flow.
5. Build matching pool and draft/approval workflow.
6. Add historical import tooling after dedupe and rollback are ready.
7. Generalize monthly reports across seasons.
8. Add CRM & Relationship History after identity, roles, and admin ownership are stable.

## Do Not Do Yet

- Do not import Season 1-10 without dry-run dedupe.
- Do not create official Season 12 roles from submitted applications.
- Do not treat mentor continuation response as automatic approval unless founder/core team explicitly accepts that policy.
- Do not treat mentor reactivation interest as official Season 12 mentor role until approved.
- Do not count draft matches as active matches.
- Do not overwrite current Season 11 profile data with old historical source values.
- Do not overwrite relationship notes; append contact logs or feedback updates.
