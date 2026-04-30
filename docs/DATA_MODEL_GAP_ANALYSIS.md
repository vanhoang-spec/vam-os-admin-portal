# VAM OS Data Model Gap Analysis

Purpose: audit whether the current VAM OS schema can support a multi-season lifecycle: historical import Season 1-10, ongoing Season 11 operations, and Season 12 recruitment/matching.

Status: planning only. No code or migration is applied by this document.

## Executive Summary

VAM OS already has the core identity and operations spine for multi-season data:

- `people` can be the one-record-per-person master table.
- `seasons` can separate UEHM-S9, UEHM-S10, UEHM-S11, UEHM-S12.
- `person_roles` exists and should become the official season-specific role history.
- `matches`, `mentoring_recaps`, `events`, and `event_participations` already carry or can carry `season_id`.
- `action_items` is designed for operations workflow, but production was previously observed missing this table in schema cache.

The main gap is recruitment lifecycle and relationship history. Current `applications` appears mentee-oriented and does not fully separate:

- mentee application vs official mentee role
- mentor application vs official mentor role
- mentor continuation from one season to the next
- mentor orientation attendance before official approval
- review/interview decisions before role creation

VAM OS also does not yet have a CRM layer for long-term relationship memory:

- contact history with mentors/mentees/support/alumni
- mentor inactive reactivation outreach
- feedback and concern triage
- relationship follow-up ownership
- full person timeline across roles, events, recaps, contact logs, and feedback

The most important design rule: applications and continuation signals are candidates, not official roles. Only approved records should create `person_roles` for the target season.

## Current Schema Fit By Entity

| Entity | Current fit | Gap | Recommendation |
| --- | --- | --- | --- |
| `seasons` | Good base entity. Existing app hard-codes `UEHM-S11` in several places. | Needs lifecycle/status/date fields for planning, recruitment, active ops, closed/archive. | Add season lifecycle fields and introduce app-level season selector later. |
| `people` | Good master identity table. | Needs stronger dedupe/import provenance for S1-10 if not already available. | Keep one row per person; add import logs or source metadata if needed. |
| `person_roles` | Exists and is the right place for season role history. | Underused in current UI and likely lacks lifecycle fields for role status, source, approved_by. | Make it the official output of approved applications/continuations. |
| `applications` | Exists for applicant data and current application screens. | Blends application state with later official role if not carefully governed. May be mentee-specific. | Keep for mentee recruitment or generalize with `applicant_type`; add review/interview tables. |
| `application_reviews` | Not currently confirmed in app/migrations. | Needed for multi-reviewer scoring and audit trail. | Add table linked to `applications`. |
| `interviews` | Not currently confirmed in app/migrations. | Needed for scheduling, outcome, interviewer notes. | Add table linked to `applications`; optionally reusable for mentor applications. |
| `mentor_applications` | Not currently confirmed. | Needed because mentor intake has different profile/capacity/review fields from mentee intake. | Add separate table or generalize `applications`; separate table is clearer for S12. |
| `mentor_continuation` | Missing. | Needed for existing mentors to confirm continue/inactive for S12. | Add season-to-season continuation table. |
| `mentor_orientation_attendance` | Missing as a named table. | Could be represented by `events` + `event_participations`, but a dedicated view/table can simplify approval gating. | Prefer `events` + `event_participations`; add view or table only if orientation has special fields. |
| `matches` | Good operational table. | Needs draft/proposed/approved lifecycle for S12 matching before kickoff. | Extend statuses and add approval metadata if missing. |
| `events` | Good base. | Needs lifecycle and event category coverage for recruitment/interview/orientation/kickoff/graduation. | Extend event types/statuses as needed. |
| `event_participations` | Good attendance table. | May need registration/check-in source, required/optional flag, no-show reason. | Reuse for orientation, training, kickoff, graduation attendance. |
| `mentoring_recaps` | Good for S11 monthly operations. | Needs season filtering everywhere and historical import provenance. | Keep one row per recap; ensure S1-10 imports map season and match/person safely. |
| `action_items` | Good workflow model. | Production deploy gap observed; may need entity links for application/interview/mentor continuation. | Apply workflow migration before relying on it; use for recruitment follow-ups. |
| `contact_logs` | Missing. | Needed for CRM touchpoints, especially inactive mentor outreach and core team handover. | Add append-first contact history linked to `people`, optional `season_id`, owner, outcome, and next follow-up. |
| `feedback_items` | Missing. | Needed to track mentor/mentee feedback, concerns, compliments, and escalations. | Add feedback inbox model with severity/status/owner and links to person/match/event/recap. |
| `relationship_tasks` | Missing as CRM-specific task model. | `action_items` can cover some workflow, but CRM needs person-centric follow-up, due dates, owners, and campaign context. | Either extend `action_items` with CRM action types or add `relationship_tasks` and mirror high-priority items. |
| `mentor_reactivation_campaigns` | Missing. | Needed for annual inactive mentor reactivation workflow. | Add campaign header table for target season, owner, status, target segment. |
| `campaign_participants` | Missing. | Needed to track each inactive mentor's outreach state, response, reason, and next follow-up. | Add participant table linked to campaign and person; do not create official roles until approved. |

## Proposed Data Model

### `seasons`

Purpose: one season/cohort of a program.

Recommended fields:

- `id`
- `program_id`
- `code`, for example `UEHM-S12`
- `name`
- `lifecycle_status`: `planning`, `recruiting`, `matching`, `active`, `closing`, `closed`, `archived`
- `start_date`
- `end_date`
- `application_open_at`
- `application_close_at`
- `mentor_confirmation_due_at`
- `kickoff_at`
- `graduation_at`
- `created_at`, `updated_at`

### `people`

Purpose: master identity. One real person has one row.

Recommended governance:

- Deduplicate by email, then phone, then `full_name + school`.
- Do not create a new person for a new role or season.
- Store stable contact/profile facts here or in profile tables, not season-specific role decisions.

### `person_roles`

Purpose: official season-specific role membership.

Recommended fields:

- `id`
- `person_id`
- `season_id`
- `role`: `mentee`, `mentor`, `support_team`, `core_team`, `speaker`, `trainer`, `guest`, `alumni`
- `status`: `candidate`, `active`, `inactive`, `waitlisted`, `completed`, `dropped`
- `source_type`: `mentee_application`, `mentor_application`, `mentor_continuation`, `historical_import`, `manual`
- `source_id`
- `approved_by_admin_user_id`
- `approved_at`
- `start_date`
- `end_date`
- `notes`
- `created_at`, `updated_at`

Rule: for Season 12, `person_roles` should be created only after approval, except for explicitly staged `candidate` roles if the team chooses that pattern. The safer rule is no official role until approved.

### `applications`

Purpose: mentee application intake.

Recommended fields:

- `id`
- `season_id`
- `person_id`
- `role_applied`: usually `mentee`
- `status`: `submitted`, `in_review`, `interview_scheduled`, `interviewed`, `approved`, `rejected`, `waitlisted`, `withdrawn`, `duplicate`
- `submitted_at`
- `review_status`
- `interview_status`
- `decision_at`
- `decision_by_admin_user_id`
- `decision_reason`
- `profile_url`
- `consent_pdpa`
- applicant preference fields or linked answer rows

Rule: approved application creates a Season 12 `person_roles` row for `mentee`.

### `application_reviews`

Purpose: review notes/scores for mentee applications.

Recommended fields:

- `id`
- `application_id`
- `reviewer_admin_user_id`
- `score`
- `recommendation`: `advance_to_interview`, `approve`, `reject`, `waitlist`, `needs_more_info`
- `rubric jsonb`
- `notes`
- `created_at`, `updated_at`

### `interviews`

Purpose: scheduled and completed interviews for mentee candidates, and optionally mentor candidates if shared.

Recommended fields:

- `id`
- `season_id`
- `application_id` nullable
- `mentor_application_id` nullable
- `candidate_person_id`
- `interview_type`: `mentee`, `mentor`
- `scheduled_at`
- `interviewer_admin_user_id`
- `status`: `scheduled`, `completed`, `no_show`, `rescheduled`, `cancelled`
- `outcome`: `approve`, `reject`, `waitlist`, `needs_review`
- `notes`
- `created_at`, `updated_at`

### `mentor_applications`

Purpose: mentor intake for new mentors or returning inactive mentors.

Recommended fields:

- `id`
- `season_id`
- `person_id`
- `application_type`: `new_mentor`, `returning_inactive`
- `status`: `submitted`, `in_review`, `interview_scheduled`, `interviewed`, `orientation_required`, `approved`, `rejected`, `waitlisted`, `withdrawn`, `duplicate`
- `capacity_target`
- `availability`
- `industry`
- `function_area`
- `seniority_level`
- `motivation`
- `reviewed_by_admin_user_id`
- `decision_at`
- `decision_reason`
- `created_at`, `updated_at`

Rule: approved mentor application creates or updates `mentor_profiles`, then creates Season 12 `person_roles` row for `mentor`.

### `mentor_continuation`

Purpose: ask existing mentors whether they continue into Season 12.

Recommended fields:

- `id`
- `from_season_id`
- `to_season_id`
- `person_id`
- `previous_role_id`
- `response_status`: `pending`, `continue`, `inactive`, `maybe`, `no_response`
- `capacity_target`
- `availability`
- `updated_profile_confirmed`
- `responded_at`
- `confirmed_by_admin_user_id`
- `notes`
- `created_at`, `updated_at`

Rule: `continue` does not automatically create official mentor role unless the team chooses auto-approval for trusted returning mentors. Safer path: `continue` + profile check + orientation if required -> approved `person_roles`.

### `mentor_orientation_attendance`

Preferred model: use `events` and `event_participations`.

If a dedicated table is needed later:

- `id`
- `season_id`
- `person_id`
- `event_id`
- `attendance_status`
- `completion_status`
- `required_for_approval boolean`
- `notes`
- `created_at`, `updated_at`

Rule: orientation attendance can be a prerequisite for official Season 12 mentor role.

### `matches`

Purpose: mentor/mentee assignment by season.

Recommended fields:

- Existing: `season_id`, `mentor_person_id`, `mentee_person_id`, `status`, `match_type`, `match_source_raw`, `match_confidence`, `notes`
- Add/standardize statuses: `draft`, `proposed`, `approved`, `active`, `paused`, `completed`, `dropped`, `replaced`
- Add if missing: `approved_by_admin_user_id`, `approved_at`, `started_at`, `ended_at`, `end_reason`

Rule: Season 12 matching can create `draft/proposed` rows before kickoff. Only `approved/active` should count as official matching.

### `events`

Purpose: event/session calendar.

Recommended event types:

- `mentee_recruitment`
- `mentor_recruitment`
- `interview`
- `mentor_orientation`
- `kickoff`
- `training`
- `gathering`
- `graduation`
- `other`

### `event_participations`

Purpose: registration, attendance, check-in, and event evidence.

Recommended fields:

- Existing attendance fields remain useful.
- Add/standardize `participation_status`: `invited`, `registered`, `attended`, `absent`, `excused`, `walk_in`
- Keep `role_at_event` as event-specific, not official season role.

### `mentoring_recaps`

Purpose: monthly activity evidence.

Recommended fields:

- Existing model is sufficient for Season 11 operations and historical import.
- Keep `season_id`, `match_id`, `mentor_person_id`, `mentee_person_id`, `meeting_date`, `meeting_month`, `status`.
- Add import provenance only if needed: `source_season_code`, `source_row_id`, `import_batch_id`.

### `action_items`

Purpose: internal work queue for follow-up, review, data correction, recruitment tasks.

Recommended additional entity support:

- `entity_type`: `person`, `application`, `mentor_application`, `mentor_continuation`, `interview`, `match`, `event`, `recap`, `data_issue`
- `entity_id`
- `season_id`
- `action_type`: include `application_review`, `interview_schedule`, `mentor_confirmation`, `orientation_followup`, `matching_review`

### `contact_logs`

Purpose: append-first CRM contact history.

Recommended fields:

- `id`
- `person_id`
- `season_id` nullable
- `related_role_id` nullable
- `contacted_by_admin_user_id`
- `contact_owner_admin_user_id`
- `contact_type`: `email`, `phone`, `zalo`, `facebook`, `linkedin`, `in_person`, `event`, `other`
- `direction`: `outbound`, `inbound`, `internal_note`
- `contacted_at`
- `subject`
- `summary`
- `outcome`: `interested`, `not_interested`, `maybe_later`, `no_response`, `wrong_contact`, `needs_followup`, `concern_raised`, `info_updated`
- `next_follow_up_at`
- `visibility`: `core_team`, `admins_only`, `restricted`
- `source_type`, `source_id`
- `created_at`, `updated_at`

Rule: do not overwrite old contact history. Add new logs for new interactions or corrections.

### `feedback_items`

Purpose: mentor/mentee/support/alumni feedback and concern tracking.

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
- `owner_admin_user_id`
- `escalated_to_admin_user_id`
- `escalated_at`
- `resolved_at`
- `resolution_notes`
- `visibility`
- `created_at`, `updated_at`

Rule: high/urgent feedback should create or link a follow-up task and should support restricted visibility later.

### `relationship_tasks`

Purpose: person-centric CRM follow-up queue.

Recommended fields:

- `id`
- `person_id`
- `season_id` nullable
- `assigned_to_admin_user_id`
- `created_by_admin_user_id`
- `task_type`: `mentor_reactivation`, `feedback_followup`, `check_in`, `profile_update`, `event_followup`, `concern_escalation`, `other`
- `priority`: `low`, `medium`, `high`, `urgent`
- `status`: `open`, `in_progress`, `waiting`, `resolved`, `dropped`, `no_response`
- `due_at`
- `completed_at`
- `title`
- `description`
- `related_contact_log_id`
- `related_feedback_item_id`
- `related_campaign_id`
- `action_item_id`
- `metadata jsonb`
- `created_at`, `updated_at`

Recommendation: avoid duplicate task ownership. Decide whether CRM tasks live directly in `action_items` or whether `relationship_tasks` mirrors into `action_items`.

### `mentor_reactivation_campaigns`

Purpose: annual or targeted outreach campaign for inactive mentors.

Recommended fields:

- `id`
- `season_id` nullable, target season
- `source_season_id` nullable
- `campaign_code`
- `name`
- `goal`
- `status`: `draft`, `active`, `paused`, `completed`, `archived`
- `owner_admin_user_id`
- `starts_at`, `ends_at`
- `target_segment`
- `template_notes`
- `created_at`, `updated_at`

### `campaign_participants`

Purpose: track one person's state inside a campaign.

Recommended fields:

- `id`
- `campaign_id`
- `person_id`
- `previous_role_id`
- `assigned_to_admin_user_id`
- `participant_status`: `not_started`, `contacted`, `responded`, `interested`, `maybe_later`, `not_interested`, `no_response`, `reactivated`, `do_not_contact`
- `last_contact_log_id`
- `next_follow_up_at`
- `response_summary`
- `reason_not_joining`
- `preferred_future_season_code`
- `capacity_signal`
- `created_at`, `updated_at`

Rule: campaign interest is not official reactivation. Only approved reactivation creates a target-season `person_roles` row.

## Key Gaps Before Season 12

P0 gaps:

- Recruitment state model for mentee applications.
- Review/interview model.
- Mentor continuation model.
- Mentor application model.
- Rule that application approval creates `person_roles`, not the other way around.

P1 gaps:

- Season lifecycle fields and UI season selector.
- Match draft/proposed/approval workflow.
- Event type/status coverage for orientation/kickoff/graduation.
- Action item production availability.
- CRM contact history and relationship tasks.
- Feedback inbox and escalation path.

P2 gaps:

- Import provenance/audit for S1-10.
- Longitudinal person journey views.
- Cross-season reports and archival rules.
- Inactive mentor reactivation campaigns and campaign analytics.

## Recommended Migration Bundles Later

Do not implement yet, but plan migrations in these bundles:

1. Season lifecycle and `person_roles` hardening.
2. Mentee recruitment: `application_reviews`, `interviews`, application status cleanup.
3. Mentor recruitment/reactivation: `mentor_applications`, `mentor_continuation`.
4. Matching lifecycle: statuses and approval metadata.
5. Event lifecycle/type cleanup.
6. Import provenance/logging for historical seasons.
7. CRM relationship history: `contact_logs`, `feedback_items`, `relationship_tasks`.
8. Mentor reactivation campaigns: `mentor_reactivation_campaigns`, `campaign_participants`.
