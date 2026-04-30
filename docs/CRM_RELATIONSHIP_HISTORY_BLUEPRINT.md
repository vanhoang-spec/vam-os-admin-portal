# VAM OS CRM & Relationship History Blueprint

Purpose: define the CRM layer for mentor, mentee, support team, core team, and alumni relationship history across seasons.

Status: planning only. No code or migration is applied by this document.

## Why This Layer Exists

VAM OS should not only answer "who matched with whom" or "who submitted recap." It should also answer:

- Who contacted this person before?
- What did they say?
- Why is this mentor inactive?
- When should we follow up again?
- Who owns the next relationship action?
- What feedback or concern has this person raised over time?

This is especially important for inactive mentors, alumni mentors, sensitive mentee concerns, and core team handover.

## Core Principles

- `people` remains the single identity record.
- CRM history is append-only by default; do not overwrite old notes.
- Contact logs and feedback are not official season roles.
- Follow-up tasks should be assignable and status-tracked.
- Sensitive feedback should support escalation and limited access later.
- CRM records may be season-linked, but a person timeline must work across all seasons.

## Proposed Data Model

### `contact_logs`

Purpose: immutable-ish record of a relationship touchpoint.

Recommended fields:

- `id`
- `person_id`
- `season_id` nullable
- `related_role_id` nullable, references `person_roles`
- `contacted_by_admin_user_id` nullable, references `admin_users`
- `contact_owner_admin_user_id` nullable, references `admin_users`
- `contact_type`: `email`, `phone`, `zalo`, `facebook`, `linkedin`, `in_person`, `event`, `other`
- `direction`: `outbound`, `inbound`, `internal_note`
- `contacted_at`
- `subject`
- `summary`
- `outcome`: `interested`, `not_interested`, `maybe_later`, `no_response`, `wrong_contact`, `needs_followup`, `concern_raised`, `info_updated`
- `next_follow_up_at`
- `visibility`: `core_team`, `admins_only`, `restricted`
- `source_type`: `manual`, `campaign`, `event`, `feedback`, `recap`, `import`
- `source_id` nullable
- `created_at`, `updated_at`

Notes:

- A contact log should not be deleted casually. If correction is needed, add a new note or audit correction.
- `next_follow_up_at` can generate a `relationship_tasks` row or sync into `action_items`.

### `feedback_items`

Purpose: capture mentor/mentee/support team/alumni feedback and concerns.

Recommended fields:

- `id`
- `person_id`
- `season_id` nullable
- `submitted_by_person_id` nullable
- `submitted_by_admin_user_id` nullable
- `target_person_id` nullable
- `related_match_id` nullable
- `related_event_id` nullable
- `related_recap_id` nullable
- `feedback_type`: `mentor_feedback`, `mentee_feedback`, `event_feedback`, `program_feedback`, `concern`, `compliment`, `suggestion`, `other`
- `sentiment`: `positive`, `neutral`, `negative`, `mixed`, `unknown`
- `severity`: `low`, `medium`, `high`, `urgent`
- `status`: `new`, `triaged`, `in_progress`, `resolved`, `closed`, `dismissed`
- `title`
- `body`
- `owner_admin_user_id` nullable
- `escalated_to_admin_user_id` nullable
- `escalated_at` nullable
- `resolved_at` nullable
- `resolution_notes`
- `visibility`: `core_team`, `admins_only`, `restricted`
- `created_at`, `updated_at`

Notes:

- Urgent feedback should create or link a task.
- Sensitive notes should not be exposed on broad dashboards without access control.

### `relationship_tasks`

Purpose: CRM-specific follow-up queue.

Recommended fields:

- `id`
- `person_id`
- `season_id` nullable
- `assigned_to_admin_user_id` nullable
- `created_by_admin_user_id` nullable
- `task_type`: `mentor_reactivation`, `feedback_followup`, `check_in`, `profile_update`, `event_followup`, `concern_escalation`, `other`
- `priority`: `low`, `medium`, `high`, `urgent`
- `status`: `open`, `in_progress`, `waiting`, `resolved`, `dropped`, `no_response`
- `due_at`
- `completed_at`
- `title`
- `description`
- `related_contact_log_id` nullable
- `related_feedback_item_id` nullable
- `related_campaign_id` nullable
- `action_item_id` nullable, references `action_items`
- `metadata jsonb`
- `created_at`, `updated_at`

Recommendation:

- Long-term, either merge this into `action_items` with CRM-specific `action_type`, or keep `relationship_tasks` as a CRM-friendly table that mirrors high-priority items into `action_items`.

### `mentor_reactivation_campaigns`

Purpose: annual or ad hoc outreach campaigns for inactive mentors.

Recommended fields:

- `id`
- `season_id` nullable, target season such as `UEHM-S12`
- `source_season_id` nullable, previous active season
- `campaign_code`
- `name`
- `goal`
- `status`: `draft`, `active`, `paused`, `completed`, `archived`
- `owner_admin_user_id`
- `starts_at`
- `ends_at`
- `target_segment`
- `template_notes`
- `created_at`, `updated_at`

### `campaign_participants`

Purpose: per-person campaign state.

Recommended fields:

- `id`
- `campaign_id`
- `person_id`
- `previous_role_id` nullable
- `assigned_to_admin_user_id` nullable
- `participant_status`: `not_started`, `contacted`, `responded`, `interested`, `maybe_later`, `not_interested`, `no_response`, `reactivated`, `do_not_contact`
- `last_contact_log_id` nullable
- `next_follow_up_at`
- `response_summary`
- `reason_not_joining`
- `preferred_future_season_code`
- `capacity_signal`
- `created_at`, `updated_at`

Rule:

- A reactivation response is not an official mentor role. Only approved reactivation should create `person_roles` for the target season.

## User Flows

### Add Contact Log

1. Admin opens a person profile.
2. Clicks "Add contact log."
3. Selects contact type, direction, outcome, season context, and summary.
4. Optionally sets `next_follow_up_at`.
5. System creates `contact_logs`.
6. If follow-up is needed, system creates `relationship_tasks` or `action_items`.

### Assign Follow-up Task

1. Admin creates a relationship task from a person profile, contact log, feedback item, or campaign participant.
2. Selects owner, priority, due date, and task type.
3. Owner sees task on Relationship Task Board.
4. Owner adds updates as contact logs or task notes.
5. Task resolves with an outcome.

### Mentor Inactive Reactivation Campaign

1. Core team creates a campaign for the target season.
2. System builds a participant list from mentors inactive in the target season but active in prior seasons.
3. Campaign owner assigns participants to core team members or active mentors.
4. Assignee contacts mentor and records contact log.
5. Participant status updates to interested, maybe later, not interested, no response, or reactivated.
6. Interested mentors enter mentor continuation/application review.
7. Approved mentors get official target-season `person_roles`.

### Record Feedback

1. Admin records feedback from a mentor, mentee, event, recap, or manual conversation.
2. Selects type, sentiment, severity, related person/match/event if applicable.
3. Low/medium feedback stays in inbox for triage.
4. High/urgent feedback creates an escalation task.
5. Resolution notes are appended and visible in the person timeline.

### Escalate Concern Or Urgent Feedback

1. Feedback is marked `high` or `urgent`.
2. Admin assigns owner and escalation recipient.
3. System creates urgent `relationship_tasks` or `action_items`.
4. Core team records actions taken.
5. Item is resolved or closed with resolution notes.

### View Full Person Timeline

1. User opens a person profile.
2. Timeline shows, in chronological order:
   - roles by season
   - matches
   - recaps
   - events attended
   - contact logs
   - feedback items
   - relationship tasks
   - action items
3. Filters allow viewing CRM-only, season-only, or sensitive items if permitted.

## UI Proposal

### Person Profile Timeline

- A chronological feed across seasons.
- Filters: `All`, `Roles`, `Matches`, `Recaps`, `Events`, `Contact logs`, `Feedback`, `Tasks`.
- Quick actions: add contact log, add feedback, assign task.
- Sensitive feedback hidden unless user has permission.

### Mentor CRM Tab

- Mentor status by season.
- Current and historical capacity.
- Last contacted date.
- Last outcome.
- Reactivation readiness: `interested`, `maybe later`, `not interested`, `no response`.
- Next follow-up.
- Contact history and feedback.

### Inactive Mentor Reactivation Board

- Kanban or table grouped by participant status.
- Columns: not started, contacted, responded, interested, maybe later, not interested, no response, reactivated.
- Filters by previous season, industry/company, assigned owner, due date.
- Bulk assign owners.
- Export campaign progress.

### Feedback Inbox

- Inbox grouped by severity/status.
- Filters by person, season, role, event, match, sentiment.
- Actions: assign owner, escalate, resolve, link to task, add note.
- High/urgent feedback visually prominent but not exposed broadly.

### Relationship Task Board

- CRM task queue for follow-up.
- Views: my tasks, overdue, urgent, mentor reactivation, feedback follow-up.
- Actions: change status, add contact log, add note, resolve.

## Links To Existing Modules

| Existing module/table | CRM relationship |
| --- | --- |
| `people` | Primary anchor for every contact log, feedback item, campaign participant, and task. |
| `person_roles` | Provides season-specific context for why someone is mentor/mentee/support/alumni. |
| `admin_users` | Owns assignments, contact owners, escalations, and audit context. |
| `seasons` | Links CRM records to target seasons or historical seasons. |
| `action_items` | Can mirror or replace `relationship_tasks` for unified operations workflow. |
| `events` | Event feedback and event-origin contact logs can link to events. |
| `event_participations` | Attendance/no-show can trigger follow-up contact logs or tasks. |
| `mentoring_recaps` | Recap issues or positive stories can create feedback/contact history. |
| `matches` | Feedback may target a mentoring relationship, not just an individual. |

## Data Risks

- Overexposing sensitive feedback to too many admins.
- Treating outreach interest as official reactivation.
- Losing history by editing notes instead of appending.
- Duplicating tasks between `relationship_tasks` and `action_items`.
- Creating CRM data for duplicate people before identity dedupe.
- Campaign participants becoming stale without status and due dates.

## Recommended Implementation Order

1. Person timeline read model: aggregate existing roles, matches, recaps, events.
2. Add `contact_logs`.
3. Add `relationship_tasks` or extend `action_items` for CRM follow-up.
4. Add `feedback_items` with escalation.
5. Add inactive mentor reactivation campaigns.
6. Add campaign participant board and campaign analytics.

## Not In Scope Yet

- Automated email/Zalo sending.
- Full marketing CRM automation.
- AI sentiment classification.
- Public feedback forms.
- Permission model beyond current admin roles.
