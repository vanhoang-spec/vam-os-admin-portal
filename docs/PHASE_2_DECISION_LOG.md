# Phase 2 Activity & Event Tracking Decision Log

| decision_area | question | proposed_default | final_decision | owner | notes |
|---|---|---|---|---|---|
| Mentor meeting definition | What counts as an official mentor meeting? | A scheduled 1:1 or group mentoring interaction between matched mentor and mentee, confirmed by date and recap link. | TBD | Claude / VAM core team | Confirm whether informal check-ins count. |
| Recap requirement | Is a Facebook recap required for every mentor meeting? | Required for MVP tracking when available; missing recap should be flagged but not block recording the meeting. | TBD | Claude / VAM core team | Avoid losing meeting evidence if recap is late. |
| Multiple meetings | Can one recap represent multiple meetings? | Default no; one recap row should represent one meeting date. | TBD | Claude / VAM core team | If exceptions are allowed, add note field guidance. |
| Recap link owner | Who is responsible for copying recap links? | Admin/core team records links from Facebook group during weekly/monthly operations review. | TBD | Claude / VAM core team | No mentee portal yet. |
| Missing recap follow-up | Should missing recap automatically create a follow-up flag? | Yes, if a meeting is known but recap link is missing after the SOP deadline. | TBD | Claude / VAM core team | Need deadline definition. |
| Meeting frequency | What is the expected meeting frequency by month? | At least one mentor meeting or meaningful interaction per mentee per month. | TBD | Claude / VAM core team | Confirm Season 11 operating expectation. |
| Event types | What event types should be tracked in Phase 2? | training, workshop, orientation, community, matching, other. | TBD | Claude / VAM core team | Align with VAM program language. |
| Attendance population | Should event attendance include mentors, mentees, speakers, and organizers? | Yes, support all roles via `role_at_event`. | TBD | Claude / VAM core team | Reporting can focus on mentees first. |
| Attendance status | What is absent with notice vs absent without notice? | With notice means participant informed core team before or shortly after event; without notice means no valid notice. | TBD | Claude / VAM core team | Need exact cutoff time. |
| Event recap requirement | Should event recap links be required or optional? | Optional for event participation; required only if SOP says mentees must recap specific trainings. | TBD | Claude / VAM core team | Attendance can exist without recap. |
| Editability | Should activity data be editable after import? | Yes, by admin only, with audit log in future implementation. | TBD | Claude / VAM core team | MVP templates are import-only drafts. |
| Correction approval | Who can approve or correct activity records? | Admin/core operations lead; reviewer can propose corrections later. | TBD | Claude / VAM core team | Needs role boundary. |
| Monthly reports | What monthly reports does founder/core team need? | Meetings recorded, mentees active/inactive, mentor workload, event attendance, missing recap/follow-up list. | TBD | Claude / VAM core team | Confirm preferred summary format. |
| Matching impact | Should activity affect matching or relationship health scoring later? | Not in Phase 2 MVP; preserve data for future scoring. | TBD | Claude / VAM core team | Avoid premature automation. |
| Active relationship | What counts as active? | Mentee has at least one valid mentor meeting/recap in the current or previous month, or admin marks relationship active. | TBD | Claude / VAM core team | Needs tolerance for holidays/exams. |
| Inactive relationship | What counts as inactive? | No recorded meeting/recap for more than one expected monthly cycle. | TBD | Claude / VAM core team | Confirm threshold. |
| At-risk relationship | What counts as at-risk? | Missing recap, repeated missed events, no recent meeting, or admin issue flag. | TBD | Claude / VAM core team | Should trigger follow-up workflow. |
| Required recap fields | Which mentoring recap fields are required? | season_code, meeting_date, recap_url, mentee identifier, and mentor/match identifier. | TBD | Claude / VAM core team | Identifier can be email/code/match_id. |
| Required event fields | Which event participation fields are required? | season_code, event_name or event_code, event_date, person identifier, attendance_status. | TBD | Claude / VAM core team | Registration status can be unknown. |
| Privacy | Should full Facebook recap content be copied into VAM OS? | No; store URL only for MVP. | TBD | Claude / VAM core team | Reduces privacy and moderation risk. |

