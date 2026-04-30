# Season 12 Recruitment Blueprint

Scope: design Season 12 intake, review, mentor reactivation, matching, and kickoff preparation.

Status: planning only. Applications do not create official roles until approved.

## Core Rule

`people` is identity. `applications`, `mentor_applications`, and `mentor_continuation` are candidate/review records. `person_roles` is official season participation.

Only approved candidates should create official Season 12 `person_roles`.

## Recruitment Streams

Season 12 has three parallel streams:

1. Mentee recruitment.
2. New mentor recruitment.
3. Existing mentor continuation/reactivation.

These streams converge into:

- approved mentee roles
- approved mentor roles
- matching pool
- mentor orientation
- kickoff

## Data Model

Needed tables:

- `seasons`
- `people`
- `person_roles`
- `applications`
- `application_reviews`
- `interviews`
- `mentor_applications`
- `mentor_continuation`
- `events`
- `event_participations`
- `matches`
- `action_items`

## S12 Mentee Recruitment

### Goal

Collect student applications, review them consistently, interview candidates if needed, and approve/reject/waitlist without prematurely creating official mentee roles.

### Data Needed

- `applications`
- `application_reviews`
- `interviews`
- `people`
- `person_roles`
- `action_items`

### Screens Needed

- S12 Mentee Application form.
- Application Review Queue.
- Application Detail.
- Interview Schedule.
- Interview Outcome input.
- Decision Board: approved/rejected/waitlisted.
- Duplicate Candidate Review.

### User Flow

1. Student submits mentee application.
2. System matches or creates candidate `people` identity.
3. Application status becomes `submitted`.
4. Reviewer screens profile.
5. Reviewer advances to interview, rejects, or waitlists.
6. Interviewer records outcome.
7. Admin approves/rejects/waitlists.
8. If approved, system creates Season 12 `person_roles` row with role `mentee`.
9. Approved mentee enters matching pool.

### Admin Actions

- Assign reviewer.
- Mark duplicate.
- Add review score/note.
- Schedule interview.
- Record interview outcome.
- Approve/reject/waitlist.
- Create follow-up action item.

### Data Risks

- Duplicate application from same person.
- Applicant has previous season identity but changed email/phone.
- Reviewer accidentally treats submitted application as official mentee.
- Interview notes contain sensitive data.

### Migration Needs

- `application_reviews`.
- `interviews`.
- Application status cleanup if current statuses are too limited.
- Optional candidate dedupe table or review queue.

## S12 Mentor Recruitment

### Goal

Receive new mentor registrations, review fit/capacity, ensure orientation completion, and approve official mentor roles.

### Data Needed

- `mentor_applications`
- `mentor_profiles`
- `people`
- `person_roles`
- `interviews`
- `events`
- `event_participations`
- `action_items`

### Screens Needed

- Mentor Application form.
- Mentor Review Queue.
- Mentor Candidate Detail.
- Mentor Interview/Screening.
- Mentor Orientation Attendance.
- Mentor Approval Board.

### User Flow

1. New mentor submits application.
2. System deduplicates against existing `people`.
3. Reviewer checks profile, experience, capacity, availability.
4. Interview/screening happens if required.
5. Mentor orientation event is created.
6. Attendance is recorded in `event_participations`.
7. Admin approves mentor.
8. System creates or updates `mentor_profiles`.
9. System creates Season 12 `person_roles` row with role `mentor`.
10. Mentor enters matching pool.

### Admin Actions

- Assign reviewer.
- Update capacity and availability.
- Request more info.
- Schedule interview.
- Mark orientation attendance.
- Approve/reject/waitlist.

### Data Risks

- New mentor duplicates an old mentor identity.
- Mentor profile facts are overwritten by application data without review.
- Orientation attendance is missed, but mentor is approved.
- Capacity is missing or stale.

### Migration Needs

- `mentor_applications`.
- Mentor application review fields or shared `interviews`.
- Event type support for `mentor_orientation`.

## S12 Mentor Continuation & Re-activation

### Goal

Ask current and previous mentors whether they will continue, become inactive, or return active for Season 12.

### Data Needed

- `mentor_continuation`
- `mentor_profiles`
- `person_roles`
- `people`
- `events`
- `event_participations`
- `action_items`

### Screens Needed

- Mentor Continuation Campaign.
- Mentor Response Board.
- No-response Follow-up Queue.
- Returning Inactive Mentor Review.
- Capacity Update screen.

### User Flow

1. Generate continuation list from Season 11 mentors and optionally older inactive mentors.
2. Send confirmation request.
3. Mentor responds: continue, inactive, maybe.
4. Admin reviews capacity/profile updates.
5. If returning inactive, reviewer may require orientation refresher.
6. Admin approves Season 12 mentor role.
7. System creates Season 12 `person_roles` row with role `mentor`.

### Admin Actions

- Generate continuation records.
- Mark response manually.
- Assign follow-up owner.
- Update mentor capacity.
- Require orientation/refresher.
- Approve Season 12 active mentor.
- Mark inactive for Season 12.

### Data Risks

- Assuming Season 11 active mentor automatically continues.
- Losing distinction between inactive globally and inactive for a season.
- No-response mentors counted as available.
- Old inactive mentor reactivated without profile review.

### Migration Needs

- `mentor_continuation`.
- `person_roles.status` must support season-specific `active` and `inactive`.
- `action_items` action type for `mentor_confirmation`.

## S12 Matching & Kickoff

### Goal

Create a vetted matching pool, draft matches, approve matches, and prepare kickoff attendance.

### Data Needed

- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `matches`
- `events`
- `event_participations`
- `action_items`

### Screens Needed

- Matching Pool: approved mentors and mentees.
- Mentor Capacity dashboard.
- Draft Matching Board.
- Match Review/Approval.
- Kickoff Event Detail.
- Kickoff Attendance dashboard.

### User Flow

1. Approved Season 12 mentees enter matching pool.
2. Approved Season 12 mentors enter matching pool with capacity.
3. Core team drafts matches.
4. Reviewer approves or changes draft match.
5. Approved match becomes `active` at kickoff or when announced.
6. Kickoff event attendance is recorded.
7. Monthly recap tracking starts.

### Admin Actions

- Generate draft matches.
- Manually assign mentor.
- Approve match.
- Pause/reject draft match.
- Mark kickoff attendance.
- Create follow-up for absent mentor/mentee.

### Data Risks

- Matching before mentor capacity is confirmed.
- Matching waitlisted/rejected candidates.
- Counting draft match as active.
- Kickoff attendance not linked to Season 12 people.

### Migration Needs

- Match lifecycle statuses: `draft`, `proposed`, `approved`, `active`, `paused`, `completed`, `dropped`.
- Match approval metadata.
- Event type `kickoff`.

## Definition Of Done For S12 Recruitment Readiness

- Season 12 exists with lifecycle status `planning` or `recruiting`.
- Mentee applications have review/interview/decision flow.
- Mentor applications have review/orientation/approval flow.
- Existing mentors have continuation records.
- Official `person_roles` are created only after approval.
- Matching pool uses approved roles only.
- Kickoff event and attendance can be tracked.
