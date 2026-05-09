# VAM OS — Opportunities & Member Development Blueprint
**Version 1.0 | 2026-05-09 | Design only — no migrations applied**

Related documents:
- `docs/MEMBER_LIFECYCLE_AND_SEASON_ROLLOVER_BLUEPRINT.md` (v1.0)
- `docs/CRM_RELATIONSHIP_HISTORY_BLUEPRINT.md` (v2.0)

---

## Table of Contents

1. [Strategic Context](#1-strategic-context)
2. [Core Design Principles](#2-core-design-principles)
3. [The Generic Opportunity Framework](#3-the-generic-opportunity-framework)
4. [Opportunity Types and Workflow Stages](#4-opportunity-types-and-workflow-stages)
5. [When to Use JSON vs. Normalized Fields](#5-when-to-use-json-vs-normalized-fields)
6. [Proposed Data Model](#6-proposed-data-model)
7. [Mentee Completion and Graduation Model](#7-mentee-completion-and-graduation-model)
8. [Recognition Model](#8-recognition-model)
9. [Mentor Certification Model](#9-mentor-certification-model)
10. [Mentoring Hours Tracking](#10-mentoring-hours-tracking)
11. [Scholarship Application Workflow](#11-scholarship-application-workflow)
12. [Supporter Recruitment Workflow](#12-supporter-recruitment-workflow)
13. [CEP Job Shadowing Workflow](#13-cep-job-shadowing-workflow)
14. [CEP Business Case Workflow](#14-cep-business-case-workflow)
15. [Privacy and Permission Model](#15-privacy-and-permission-model)
16. [CRM Integration](#16-crm-integration)
17. [Lifecycle and Season Rollover Integration](#17-lifecycle-and-season-rollover-integration)
18. [Implementation Roadmap](#18-implementation-roadmap)
19. [Risks and Trade-offs](#19-risks-and-trade-offs)
20. [QA Checklist](#20-qa-checklist)

---

## 1. Strategic Context

VAM OS began as a tool to track mentoring seasons. The Member Lifecycle blueprint extended it to manage roles across seasons. The CRM blueprint extended it to track relational history and follow-up. This blueprint completes the picture: **structured opportunity programs** that sit alongside mentoring as development pathways for VAM members.

The programs in scope are fundamentally different from events (which are about attendance) and from CRM notes (which are about relationship history). They are structured **application → review → selection → assignment → completion** processes with privacy requirements, eligibility gates, and formal outcomes that feed back into a person's lifecycle.

The key architectural challenge is avoiding six separate bespoke systems for six different programs. This blueprint proposes a single generic opportunity framework that can express all six — while preserving the program-specific logic that makes each one meaningful.

---

## 2. Core Design Principles

**P1 — One person record, always**
No matter how a person enters a program (as a current mentee applying for scholarship, as an alumni applying to become a supporter, or as a completely external student applying to become a supporter), they eventually link to one `people` row. External applicants who are accepted create a new `people` row at acceptance, not at application time.

**P2 — Opportunities ≠ Events**
Events are for attendance and check-in. Opportunities are for application, review, selection, assignment, and completion. Never model a scholarship as an event registration. Never model a CEP cohort as a group event. The confusion of these two causes data model collapse.

**P3 — One generic framework, typed by opportunity_type**
A scholarship application, supporter recruitment, CEP enrollment, and award nomination all share the same lifecycle phases. They are expressed as typed rows in a shared `opportunities` table with shared `opportunity_applications`, `opportunity_reviews`, `opportunity_decisions`, and `opportunity_assignments` tables. CEP-specific extensions (hosts, teams, milestones) are additive — they do not require a separate application framework.

**P4 — JSON for form content, normalized columns for queryable decisions**
Application form answers are stored as a `form_answers jsonb` column — they are sealed content that varies per opportunity type. But outcomes (selected/not_selected/waitlisted), scores, source types, and status are normalized columns — they drive filtering, ranking, and analytics.

**P5 — Recognition is separate from completion**
A mentee who completes a season is not automatically recognized as outstanding. A mentor can receive a "Mentor of the Season" award without completing any certification. Recognition is an independent record that optionally links to a completion review, scholarship decision, or CEP outcome.

**P6 — Mentor certification is separate from mentor season participation**
Being a certified mentor and being an active mentor in a season are independent facts. A certified mentor may be paused. An active mentor may not yet be certified. Certification is a credential that persists across seasons and may expire or require renewal.

**P7 — Supporter community role ≠ system permission**
Being selected as a supporter creates a `person_season_memberships` row with `role = supporter`. It does NOT automatically create an `admin_scope_access` entry. System permission grants are always explicit and separate.

**P8 — External supporter applicants become VAM identities on acceptance**
An external student who applies to become a supporter is not a VAM member yet. If accepted, a `people` record is created and a `person_season_memberships` row is added. Their source is tracked as `external_applicant`. They are never retroactively called "mentees."

**P9 — Scholarship data is the most sensitive data in the system**
Financial information, family situations, personal essays, and academic records in scholarship applications are subject to the strictest visibility controls. They must never appear in broad dashboards, exports, or team-level views without explicit permission grants.

**P10 — Integrate, don't duplicate**
Every accepted application, earned certification, granted recognition, and completed program must appear as a system-generated note in the CRM timeline. No separate "activity log" should be maintained outside the unified person timeline.

---

## 3. The Generic Opportunity Framework

### The core insight

All of the following follow the same high-level lifecycle:

```
Program opens → Person applies → Application reviewed → Decision made
→ [If selected] Assignment made → Program completed → Recognition granted
```

| Program | Opportunity type |
|---------|----------------|
| Annual scholarship | `scholarship` |
| Supporter recruitment | `supporter_recruitment` |
| CEP Job Shadowing | `cep_job_shadowing` |
| CEP Business Case | `cep_business_case` |
| Mentor training module enrollment | `mentor_training` |
| Award/recognition nomination | `award_nomination` |
| Future: exchange, fellowship, etc. | `general_development` |

All of these share:
- An `opportunities` row describing the program
- `opportunity_applications` rows (one per applicant)
- `opportunity_reviews` rows (one per reviewer per application)
- An `opportunity_decisions` row (one per application — the final outcome)
- Optional `opportunity_assignments` rows (one per accepted applicant — the slot/role/team assignment)
- Optional `member_recognitions` rows (one per awarded person)

What differs per type:
- The form questions (handled by `form_answers jsonb`)
- The eligibility rules (expressed in `opportunity_eligibility_rules jsonb` on the opportunity)
- The assignment target (scholarship → monetary award; CEP → host/team; supporter → role/function)
- CEP-specific extensions (hosts, teams, milestones) — additive tables, not replacements

### Framework scope

This framework **replaces** the need for:
- A separate "scholarship application system"
- A separate "supporter application form"
- A separate "CEP registration system"
- A separate "mentor training enrollment system"

It **does not replace**:
- `event_registrations` (event attendance is not an opportunity)
- `applications` (the existing mentee/mentor intake — this is a separate admission process that is program-scoped and season-scoped; the opportunities framework handles post-admission development programs)
- `person_notes` (CRM contact history)
- `person_season_memberships` (lifecycle membership)

---

## 4. Opportunity Types and Workflow Stages

### Workflow stage vocabulary

Each opportunity type moves applications through a defined stage sequence. Not all stages apply to all types.

| Stage | Code | Applies to |
|-------|------|-----------|
| Draft | `draft` | Opportunity is being configured — not yet open |
| Open | `open` | Applications are being accepted |
| Screening | `screening` | Eligibility checks and initial filter |
| Review | `review` | Assigned reviewers score applications |
| Shortlisted | `shortlisted` | Subset selected for interview or final review |
| Interview | `interview` | Interviews scheduled and conducted |
| Decision | `decision` | Final decisions made and recorded |
| Accepted | `accepted` | Person accepted — assignment follows |
| Waitlisted | `waitlisted` | On waitlist — may be offered spot later |
| Not selected | `not_selected` | Reviewed and not selected this cycle |
| Withdrawn | `withdrawn` | Applicant withdrew |
| Assigned | `assigned` | Post-acceptance assignment made (host, team, role, function) |
| In progress | `in_progress` | Program underway (CEP milestones, training modules) |
| Completed | `completed` | Program completed, outcome recorded |
| Did not complete | `did_not_complete` | Enrolled but did not finish |
| Awarded | `awarded` | Recognition or certificate granted |

### Stage sequences by opportunity type

```
scholarship:
  open → screening → review → shortlisted → interview → decision
  → accepted(→ awarded) / waitlisted / not_selected / withdrawn

supporter_recruitment:
  open → screening → review → [interview] → decision
  → accepted(→ assigned → in_progress → completed) / not_selected / withdrawn

cep_job_shadowing:
  open → screening → review → decision
  → accepted(→ assigned → in_progress → completed → awarded) / not_selected / withdrawn

cep_business_case:
  open → screening → review → decision
  → accepted(→ assigned → in_progress[milestones] → completed → awarded) / not_selected / withdrawn

mentor_training:
  open → [no review — self-enrollment or admin-enrolled]
  → accepted(→ in_progress[modules] → completed → awarded[certification]) / did_not_complete

award_nomination:
  open → review → decision → awarded / not_selected
```

---

## 5. When to Use JSON vs. Normalized Fields

### Use a `jsonb` column for

**Application form answers.** Scholarship forms ask about family income, academic standing, and personal essays. CEP forms ask about team preferences and skill self-assessment. Supporter forms ask about availability and functional interest. These vary per opportunity type and may change year to year. Store them in `opportunity_applications.form_answers jsonb`. Do not create separate `form_question` and `form_answer` rows — this adds complexity with no benefit at current scale.

**Eligibility rules per opportunity.** The scholarship may require: "must be active mentee in the current season AND have minimum 6 validated recaps AND GPA ≥ 3.0." Store this ruleset as `opportunities.eligibility_rules jsonb`. The application can check these automatically and flag ineligible applicants, while the admin can override.

**CEP milestone tracking.** Business Case milestones (team charter, mid-point presentation, final deck) vary per cohort. Store them in `cep_milestones.content jsonb` rather than creating a normalized milestone schema that would need to change every year.

**Reviewer rubric scores.** A review may use a 5-dimension rubric. Store the full rubric response as `opportunity_reviews.rubric_scores jsonb` alongside a normalized `score` (numeric total) that can be ranked and filtered.

### Always normalize

**Outcomes and status.** `opportunity_decisions.outcome` (`selected / not_selected / waitlisted / withdrawn`) is normalized — it drives filtering, analytics, and lifecycle integration. Never bury this in JSON.

**Applicant source type.** `opportunity_applications.applicant_type` (`existing_mentee / alumni_mentee / external_applicant`) must be a normalized column for the supporter recruitment workflow — it drives the external identity creation flow.

**Eligibility status.** `opportunity_applications.eligibility_status` (`eligible / ineligible / override_eligible / pending`) is normalized — it gates the review stage.

**Scores.** `opportunity_reviews.score` (numeric, the rolled-up assessment) is normalized for ranking and shortlisting queries. The rubric detail lives in JSON.

**Privacy-sensitive flags.** `opportunity_applications.has_financial_data` (boolean) is a normalized flag that signals to the visibility layer that this application contains scholarship-grade financial information, even if the financial content itself is in `form_answers`.

**Dates.** Application date, review date, decision date, completion date — all normalized columns. Never reconstruct event dates from JSON.

---

## 6. Proposed Data Model

### 6a. Table: `opportunities`

One row per program offering (e.g., "VAM Scholarship 2026", "UEHM-S12 Supporter Batch", "CEP Job Shadowing Cohort 3").

```
Table: opportunities

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
opportunity_type          text            NOT NULL
                                          [scholarship | supporter_recruitment |
                                           cep_job_shadowing | cep_business_case |
                                           mentor_training | award_nomination |
                                           general_development]
code                      text            UNIQUE NOT NULL  e.g. VAM-SCHOLARSHIP-2026
name                      text            NOT NULL  display name
description               text            nullable  program overview
program_id                uuid            nullable  FK → programs.id  (program scope if applicable)
season_id                 uuid            nullable  FK → seasons.id  (season scope if applicable)
status                    text            NOT NULL  DEFAULT 'draft'
                                          [draft | open | screening | review | decision | closed]
visibility_level          text            NOT NULL  DEFAULT 'ops_only'
                                          [ops_only | full_access_only | team]
                                          The minimum visibility for applications in this opportunity

-- Dates
opens_at                  timestamptz     nullable
closes_at                 timestamptz     nullable
review_deadline_at        timestamptz     nullable
decision_at               timestamptz     nullable

-- Capacity
max_accepted              integer         nullable  null = unlimited

-- Configuration (JSON — varies per opportunity type)
eligibility_rules         jsonb           nullable  auto-check rules applied at application
form_schema               jsonb           nullable  question definitions for the form
workflow_stages           text[]          nullable  ordered stage sequence for this instance

-- Audit
created_at                timestamptz     NOT NULL  DEFAULT now()
created_by_admin_id       uuid            NOT NULL  FK → admin_users.id
updated_at                timestamptz     NOT NULL  DEFAULT now()
```

---

### 6b. Table: `opportunity_applications`

One row per applicant per opportunity. The application shell — normalized for querying.

```
Table: opportunity_applications

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
opportunity_id            uuid            NOT NULL  FK → opportunities.id
person_id                 uuid            nullable  FK → people.id
                                          NULL only for external_applicant before acceptance
                                          and identity creation
external_applicant_email  text            nullable  for external applicants pre-identity-creation
external_applicant_name   text            nullable  for external applicants pre-identity-creation

-- Applicant classification
applicant_type            text            NOT NULL
                                          [existing_mentee | alumni_mentee | external_applicant |
                                           mentor | coreteam | self | nominated]
                                          'self' for award nominations submitted by the person
                                          'nominated' for nominations submitted by someone else

-- Eligibility
eligibility_status        text            NOT NULL  DEFAULT 'pending'
                                          [pending | eligible | ineligible | override_eligible]
eligibility_check_notes   text            nullable  auto-check result summary
eligibility_override_by   uuid            nullable  FK → admin_users.id

-- Application content
form_answers              jsonb           nullable  sealed form payload — varies per opportunity type
has_financial_data        boolean         NOT NULL  DEFAULT false
                                          true when form_answers contains financial/sensitive fields

-- Stage tracking
stage                     text            NOT NULL  DEFAULT 'open'
                                          [see stage vocabulary in §4]
submitted_at              timestamptz     nullable  null = saved but not yet submitted
withdrawn_at              timestamptz     nullable

-- Source context (for supporter_recruitment)
source_season_id          uuid            nullable  FK → seasons.id  season they were mentee in
source_membership_id      uuid            nullable  FK → person_season_memberships.id

-- Visibility
visibility                text            NOT NULL  DEFAULT 'ops_only'
                                          inherited from opportunity.visibility_level at creation

-- Audit
created_at                timestamptz     NOT NULL  DEFAULT now()
updated_at                timestamptz     NOT NULL  DEFAULT now()
submitted_by_admin_id     uuid            nullable  if admin submitted on behalf of applicant

UNIQUE (opportunity_id, person_id)
  — one application per person per opportunity (for external: unique on email)
```

---

### 6c. Table: `opportunity_reviews`

One row per reviewer per application. Supports multi-reviewer scoring and rubric-based assessment.

```
Table: opportunity_reviews

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
application_id            uuid            NOT NULL  FK → opportunity_applications.id
reviewer_admin_id         uuid            NOT NULL  FK → admin_users.id
review_type               text            NOT NULL
                                          [initial_screen | full_review | committee | final]
status                    text            NOT NULL  DEFAULT 'assigned'
                                          [assigned | in_progress | submitted | abstained]
score                     numeric(5,2)    nullable  normalized numeric score for ranking
rubric_scores             jsonb           nullable  full rubric breakdown
recommendation            text            nullable
                                          [strongly_recommend | recommend | neutral |
                                           do_not_recommend | disqualify]
notes                     text            nullable  reviewer's written feedback
visibility                text            NOT NULL  DEFAULT 'ops_only'
assigned_at               timestamptz     NOT NULL  DEFAULT now()
submitted_at              timestamptz     nullable
conflict_of_interest      boolean         NOT NULL  DEFAULT false
conflict_notes            text            nullable

UNIQUE (application_id, reviewer_admin_id, review_type)
```

---

### 6d. Table: `opportunity_interviews`

```
Table: opportunity_interviews

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
application_id            uuid            NOT NULL  FK → opportunity_applications.id
interviewer_admin_id      uuid            NOT NULL  FK → admin_users.id
scheduled_at              timestamptz     nullable
conducted_at              timestamptz     nullable
duration_minutes          integer         nullable
format                    text            nullable  [online | in_person | phone]
status                    text            NOT NULL
                                          [scheduled | completed | cancelled | no_show]
score                     numeric(5,2)    nullable
notes                     text            nullable  interview notes — visibility controlled
recommendation            text            nullable
visibility                text            NOT NULL  DEFAULT 'ops_only'
```

---

### 6e. Table: `opportunity_decisions`

One final decision row per application. Written once; may be updated only by full_access+ within a grace period.

```
Table: opportunity_decisions

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
application_id            uuid            NOT NULL  UNIQUE  FK → opportunity_applications.id
opportunity_id            uuid            NOT NULL  [denormalized — for direct queries]
person_id                 uuid            nullable  [denormalized]
outcome                   text            NOT NULL
                                          [selected | not_selected | waitlisted | withdrawn |
                                           did_not_complete | completed | awarded]
outcome_reason            text            nullable  brief public-facing reason if shared
internal_notes            text            nullable  committee notes — ops_only visibility
award_amount              numeric(15,2)   nullable  for scholarship: monetary award (if applicable)
award_currency            text            nullable  DEFAULT 'VND'
notification_sent_at      timestamptz     nullable  when applicant was notified
decided_at                timestamptz     NOT NULL  DEFAULT now()
decided_by_admin_id       uuid            NOT NULL  FK → admin_users.id
visibility                text            NOT NULL  DEFAULT 'ops_only'
```

---

### 6f. Table: `opportunity_assignments`

Post-acceptance assignments — the concrete slot, role, team, or function a person is placed into.

```
Table: opportunity_assignments

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
application_id            uuid            NOT NULL  FK → opportunity_applications.id
opportunity_id            uuid            NOT NULL  [denormalized]
person_id                 uuid            NOT NULL  [denormalized]
assignment_type           text            NOT NULL
                                          [scholarship_recipient | supporter_role |
                                           cep_host_slot | cep_team | training_module |
                                           award_recipient | general]
assigned_role             text            nullable  e.g. "Supporter — Operations Team"
assigned_function         text            nullable  e.g. "Recruitment", "Communications"
assigned_season_id        uuid            nullable  FK → seasons.id
cep_host_id               uuid            nullable  FK → cep_hosts.id  (Job Shadowing)
cep_team_id               uuid            nullable  FK → cep_teams.id  (Business Case)
training_module_id        uuid            nullable  FK → mentor_training_modules.id
notes                     text            nullable
assigned_at               timestamptz     NOT NULL  DEFAULT now()
assigned_by_admin_id      uuid            NOT NULL  FK → admin_users.id
```

---

### 6g. Table: `member_recognitions`

A formal record of an award, certificate, or honor granted to a person.

```
Table: member_recognitions

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
person_id                 uuid            NOT NULL  FK → people.id
recognition_type          text            NOT NULL
                                          [outstanding_mentee | outstanding_supporter |
                                           mentor_of_season | community_contribution |
                                           scholarship_recipient | completion_certificate |
                                           cep_completion | cep_certificate |
                                           mentor_certification | custom]
title                     text            NOT NULL  display name of the award
description               text            nullable
season_id                 uuid            nullable  FK → seasons.id  (which season)
program_id                uuid            nullable  FK → programs.id
linked_decision_id        uuid            nullable  FK → opportunity_decisions.id
linked_completion_id      uuid            nullable  FK → person_season_completion_reviews.id
linked_certification_id   uuid            nullable  FK → mentor_certifications.id
certificate_url           text            nullable  link to digital certificate (if issued)
awarded_at                date            NOT NULL
awarded_by_admin_id       uuid            NOT NULL  FK → admin_users.id
visible_on_timeline       boolean         NOT NULL  DEFAULT true
notes                     text            nullable
created_at                timestamptz     NOT NULL  DEFAULT now()
```

---

### 6h. Table: `season_completion_requirements`

Configurable per season — defines what a mentee must achieve to graduate.

```
Table: season_completion_requirements

Column                        Type        Notes
────────────────────────────  ──────────  ──────────────────────────────────────────────────
id                            uuid        PRIMARY KEY
season_id                     uuid        NOT NULL  UNIQUE  FK → seasons.id
program_id                    uuid        NOT NULL  FK → programs.id
min_recap_count               integer     NOT NULL  DEFAULT 6
min_event_attendance          integer     NOT NULL  DEFAULT 1
required_event_ids            uuid[]      nullable  specific mandatory events/trainings
requires_admin_final_review   boolean     NOT NULL  DEFAULT true
outstanding_threshold_recaps  integer     nullable  recaps needed for outstanding recognition
outstanding_threshold_notes   text        nullable  additional criteria for outstanding
created_at                    timestamptz NOT NULL  DEFAULT now()
created_by_admin_id           uuid        NOT NULL  FK → admin_users.id
```

---

### 6i. Table: `person_season_completion_reviews`

One row per mentee per season — the actual completion assessment.

```
Table: person_season_completion_reviews

Column                        Type        Notes
────────────────────────────  ──────────  ──────────────────────────────────────────────────
id                            uuid        PRIMARY KEY
person_id                     uuid        NOT NULL  FK → people.id
season_id                     uuid        NOT NULL  FK → seasons.id
program_id                    uuid        NOT NULL  FK → programs.id
membership_id                 uuid        NOT NULL  FK → person_season_memberships.id

-- Computed metrics (snapshotted at review time)
actual_recap_count            integer     NOT NULL  DEFAULT 0
actual_event_attendance       integer     NOT NULL  DEFAULT 0
required_events_attended      uuid[]      NOT NULL  DEFAULT '{}'  which required events attended
required_events_missing       uuid[]      NOT NULL  DEFAULT '{}'

-- Eligibility
meets_recap_requirement       boolean     NOT NULL  DEFAULT false
meets_event_requirement       boolean     NOT NULL  DEFAULT false
meets_required_events         boolean     NOT NULL  DEFAULT false
auto_eligible                 boolean     NOT NULL  DEFAULT false  all three above = true

-- Admin review
admin_override                boolean     NOT NULL  DEFAULT false
admin_override_reason         text        nullable
admin_review_notes            text        nullable  internal
reviewed_by_admin_id          uuid        nullable  FK → admin_users.id
reviewed_at                   timestamptz nullable

-- Outcome
completion_outcome            text        nullable
                                          [completed | not_completed | outstanding]
recognition_flag              text        nullable
                                          [outstanding_mentee | none]
outcome_set_at                timestamptz nullable
outcome_set_by_admin_id       uuid        nullable

UNIQUE (person_id, season_id)
```

---

### 6j. Mentor certification tables

#### `mentor_certification_tracks`

A certification program (e.g., "VAM Certified Mentor — Level 1").

```
Column                    Type        Notes
────────────────────────  ──────────  ──────────────────────────────────────────
id                        uuid        PRIMARY KEY
code                      text        UNIQUE NOT NULL  e.g. VAM-CMT-L1
name                      text        NOT NULL
description               text        nullable
level                     integer     NOT NULL  DEFAULT 1  (1, 2, 3 etc.)
validity_months           integer     nullable  null = no expiry
renewal_required          boolean     NOT NULL  DEFAULT false
is_active                 boolean     NOT NULL  DEFAULT true
created_at                timestamptz NOT NULL  DEFAULT now()
```

#### `mentor_training_modules`

Individual modules within a track.

```
Column                    Type        Notes
────────────────────────  ──────────  ──────────────────────────────────────────
id                        uuid        PRIMARY KEY
track_id                  uuid        NOT NULL  FK → mentor_certification_tracks.id
code                      text        UNIQUE NOT NULL  e.g. VAM-CMT-L1-M01
name                      text        NOT NULL
description               text        nullable
sequence_order            integer     NOT NULL  DEFAULT 1
is_required               boolean     NOT NULL  DEFAULT true
delivery_format           text        nullable  [workshop | self_paced | hybrid | webinar]
duration_hours            numeric(4,1) nullable  estimated hours
is_active                 boolean     NOT NULL  DEFAULT true
```

#### `mentor_training_enrollments`

One row per person per module. Tracks completion.

```
Column                    Type        Notes
────────────────────────  ──────────  ──────────────────────────────────────────
id                        uuid        PRIMARY KEY
person_id                 uuid        NOT NULL  FK → people.id
module_id                 uuid        NOT NULL  FK → mentor_training_modules.id
track_id                  uuid        NOT NULL  [denormalized]
enrollment_source         text        NOT NULL  [self_enrolled | admin_enrolled | opportunity]
linked_application_id     uuid        nullable  FK → opportunity_applications.id
status                    text        NOT NULL  DEFAULT 'enrolled'
                                      [enrolled | in_progress | completed | did_not_complete |
                                       waived]
waived_reason             text        nullable
evidence_notes            text        nullable  what evidence was submitted
evidence_url              text        nullable  link to evidence artifact
score                     numeric(5,2) nullable
enrolled_at               timestamptz NOT NULL  DEFAULT now()
completed_at              timestamptz nullable
enrolled_by_admin_id      uuid        nullable

UNIQUE (person_id, module_id)
```

#### `mentor_certifications`

The earned certification record.

```
Column                    Type        Notes
────────────────────────  ──────────  ──────────────────────────────────────────
id                        uuid        PRIMARY KEY
person_id                 uuid        NOT NULL  FK → people.id
track_id                  uuid        NOT NULL  FK → mentor_certification_tracks.id
status                    text        NOT NULL
                                      [active | expired | revoked | pending_renewal]
issued_at                 date        NOT NULL
expires_at                date        nullable  null if no expiry
renewed_at                date        nullable
certificate_number        text        nullable  official certificate ID
certificate_url           text        nullable
issued_by_admin_id        uuid        NOT NULL  FK → admin_users.id
notes                     text        nullable
linked_recognition_id     uuid        nullable  FK → member_recognitions.id

UNIQUE (person_id, track_id)
  — one active certification per person per track (previous rows archived)
```

---

### 6k. Mentoring hours tables

#### `mentoring_hours_logs`

One row per hours entry, regardless of source.

```
Table: mentoring_hours_logs

Column                    Type            Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY
person_id                 uuid            NOT NULL  FK → people.id  (the mentor)
season_id                 uuid            nullable  FK → seasons.id
program_id                uuid            nullable  FK → programs.id

-- Session/source details
session_date              date            nullable
hours                     numeric(5,2)    NOT NULL  positive decimal
source                    text            NOT NULL
                                          [recap_derived | self_reported | admin_entered |
                                           session_log | import | cep_activity]
source_label              text            nullable  e.g. "Imported from S10 master sheet"

-- Context links (all nullable)
linked_match_id           uuid            nullable  FK → matches.id
linked_recap_id           uuid            nullable  FK → mentoring_recaps.id
linked_event_id           uuid            nullable  FK → events.id
linked_cep_assignment_id  uuid            nullable  FK → opportunity_assignments.id

-- Verification
verification_status       text            NOT NULL  DEFAULT 'pending'
                                          [pending | verified | rejected | auto_verified]
verified_at               timestamptz     nullable
verified_by_admin_id      uuid            nullable  FK → admin_users.id
rejection_reason          text            nullable

-- Certification linkage
contributes_to_track_id   uuid            nullable  FK → mentor_certification_tracks.id

-- Audit
created_at                timestamptz     NOT NULL  DEFAULT now()
created_by_admin_id       uuid            nullable  FK → admin_users.id
  null = system-generated (e.g. recap_derived)
```

---

### 6l. CEP extension tables

These are additive to the generic opportunity framework — used only for `cep_job_shadowing` and `cep_business_case` opportunities.

#### `cep_hosts`

Companies or professionals participating in Job Shadowing as hosts.

```
Column              Type        Notes
──────────────────  ──────────  ──────────────────────────────────
id                  uuid        PRIMARY KEY
opportunity_id      uuid        NOT NULL  FK → opportunities.id
host_name           text        NOT NULL  company or professional name
host_type           text        NOT NULL  [company | professional | ngo | government]
industry            text        nullable
host_contact_name   text        nullable
host_contact_email  text        nullable
host_contact_phone  text        nullable
description         text        nullable  what the shadowing experience offers
max_slots           integer     NOT NULL  DEFAULT 1
is_active           boolean     NOT NULL  DEFAULT true
notes               text        nullable
```

#### `cep_slots`

One slot = one place for one student at one host.

```
Column              Type        Notes
──────────────────  ──────────  ──────────────────────────────────
id                  uuid        PRIMARY KEY
host_id             uuid        NOT NULL  FK → cep_hosts.id
opportunity_id      uuid        NOT NULL  [denormalized]
slot_label          text        nullable  e.g. "Morning batch", "Group A"
assigned_person_id  uuid        nullable  FK → people.id  null = vacant
assigned_at         timestamptz nullable
attendance_status   text        nullable  [attended | absent | partial]
completed_at        date        nullable
student_feedback    jsonb       nullable  sealed feedback from student
host_feedback       jsonb       nullable  sealed feedback from host
```

#### `cep_teams`

Teams formed from accepted Business Case applicants.

```
Column              Type        Notes
──────────────────  ──────────  ──────────────────────────────────
id                  uuid        PRIMARY KEY
opportunity_id      uuid        NOT NULL  FK → opportunities.id
team_name           text        NOT NULL
case_company        text        nullable  company or organization for the case
case_description    text        nullable
assigned_mentor_id  uuid        nullable  FK → people.id (mentor/advisor person)
status              text        NOT NULL  DEFAULT 'forming'
                                [forming | active | completed | did_not_complete]
notes               text        nullable
```

#### `cep_team_members`

```
Column              Type        Notes
──────────────────  ──────────  ──────────────────────────────────
team_id             uuid        FK → cep_teams.id
person_id           uuid        FK → people.id
role_in_team        text        nullable  [member | lead | presenter]
joined_at           timestamptz DEFAULT now()
PRIMARY KEY (team_id, person_id)
```

#### `cep_milestones`

Milestone tracking for Business Case teams.

```
Column              Type        Notes
──────────────────  ──────────  ──────────────────────────────────
id                  uuid        PRIMARY KEY
team_id             uuid        NOT NULL  FK → cep_teams.id
opportunity_id      uuid        NOT NULL  [denormalized]
milestone_name      text        NOT NULL  e.g. "Team Charter", "Mid-Point Presentation"
sequence_order      integer     NOT NULL
due_date            date        nullable
submitted_at        timestamptz nullable
status              text        NOT NULL  DEFAULT 'pending'
                                [pending | submitted | approved | needs_revision | skipped]
content             jsonb       nullable  milestone deliverable content/links
reviewer_notes      text        nullable
reviewed_by_admin_id uuid       nullable
```

---

### 6m. Relationship map

```
people (1)
  ├── opportunity_applications (many)
  │     ├── opportunity_reviews (many — one per reviewer)
  │     ├── opportunity_interviews (many)
  │     ├── opportunity_decisions (1 — final outcome)
  │     └── opportunity_assignments (many — host/team/role)
  ├── member_recognitions (many — awards, certificates, scholarship)
  ├── person_season_completion_reviews (1 per season as mentee)
  ├── mentor_training_enrollments (many — one per module)
  ├── mentor_certifications (1 per track, with archive)
  └── mentoring_hours_logs (many — all hours across seasons)

opportunities (1)
  ├── opportunity_applications (many)
  ├── cep_hosts (many — Job Shadowing only)
  │     └── cep_slots (many — one per student place)
  └── cep_teams (many — Business Case only)
        ├── cep_team_members (many)
        └── cep_milestones (many)

mentor_certification_tracks (1)
  ├── mentor_training_modules (many)
  │     └── mentor_training_enrollments (many)
  └── mentor_certifications (many — one per certified person)
```

---

## 7. Mentee Completion and Graduation Model

### The problem with binary graduation

The current model records mentee completion implicitly — if the season closes and the mentee had a match, they're "done." This fails to distinguish between:
- A mentee who completed 8 validated recaps and attended all required trainings
- A mentee who had 1 recap and attended nothing
- A mentee who would have completed but had extenuating circumstances

Completion must be a documented outcome with clear criteria and an admin review gate.

### Completion eligibility check

For each mentee, the system computes eligibility against `season_completion_requirements`:

```
Step 1 — Count validated recaps
  actual_recap_count = COUNT(mentoring_recaps)
    WHERE match.mentee_person_id = this person
    AND recap.season_id = this season
    AND recap.status IN ('submitted', 'needs_review')

Step 2 — Count event attendance
  actual_event_attendance = COUNT(event_participations)
    WHERE person_id = this person
    AND season_id = this season
    AND attendance_status IN attended statuses

Step 3 — Check required events
  required_events_attended = which required_event_ids were attended
  required_events_missing = required_event_ids - attended

Step 4 — Compute auto_eligible
  auto_eligible = (actual_recap_count ≥ min_recap_count)
               AND (actual_event_attendance ≥ min_event_attendance)
               AND (required_events_missing = empty)
```

### Admin review

If `requires_admin_final_review = true` (the default), auto-eligibility is a recommendation, not a final decision. The admin reviews the computed metrics and:
- Confirms completion (normal or outstanding)
- Overrides an ineligible case (with reason — e.g. medical absence from required event)
- Confirms non-completion (with notes)

### Completion outcomes

| Outcome | Meaning | Effect |
|---------|---------|--------|
| `completed` | Met all requirements and admin confirmed | `person_season_memberships.status` → `graduated` |
| `not_completed` | Did not meet requirements and not overridden | `person_season_memberships.status` → `withdrawn` or `completed` with flag |
| `outstanding` | Met all requirements AND exceeded outstanding thresholds | Same as completed + `member_recognitions` row with `recognition_type = outstanding_mentee` |

### Outstanding recognition criteria

Outstanding mentee recognition requires ALL of:
- `auto_eligible = true` (or admin override)
- `actual_recap_count ≥ outstanding_threshold_recaps` (set per season)
- Admin explicitly grants outstanding (not automatic)

Outstanding is a `member_recognitions` row — separate from the completion outcome. A mentee can be `completed` without being `outstanding`. An admin can grant outstanding to a mentee who was completion-overridden only with full_access or above.

### Effect on season membership

```
completion_outcome = 'completed' or 'outstanding'
  → person_season_memberships.status = 'graduated'
  → system_completion_recorded CRM note auto-created

completion_outcome = 'not_completed'
  → person_season_memberships.status = 'withdrawn' (or kept as 'active' with note)
  → system_completion_recorded CRM note auto-created (with outcome)
  → admin should add person_notes follow-up note explaining circumstance
```

---

## 8. Recognition Model

### Recognition as an independent record

Recognition is decoupled from all other outcomes. It may be:
- Granted alongside a completion (outstanding mentee)
- Granted as part of a scholarship decision (scholarship recipient)
- Granted at a ceremony for past contributions (community contribution award)
- Granted upon certification (mentor certification recognition)
- Granted for CEP completion (CEP certificate)

Each recognition is one row in `member_recognitions`, optionally linked to a `linked_decision_id`, `linked_completion_id`, or `linked_certification_id`.

### Recognition types

| Type | Granted when | Typical link |
|------|-------------|-------------|
| `outstanding_mentee` | End of season, by admin | `linked_completion_id` |
| `outstanding_supporter` | End of season, by admin | — |
| `mentor_of_season` | End of season, by admin | `linked_season_id` |
| `community_contribution` | Any time, by admin | — |
| `scholarship_recipient` | Scholarship decision | `linked_decision_id` |
| `completion_certificate` | Mentee graduation | `linked_completion_id` |
| `cep_completion` | CEP program completed | `linked_decision_id` |
| `cep_certificate` | CEP with certificate issued | `linked_decision_id` |
| `mentor_certification` | Certification track completed | `linked_certification_id` |
| `custom` | Admin-defined | — |

### Recognition on the person timeline

All `member_recognitions` rows with `visible_on_timeline = true` appear in the person timeline as:

```
[2026-06-15]  🏆 Outstanding Mentee — UEHM-S11
[2026-06-15]  📜 Completion Certificate — UEHM-S11
[2025-12-01]  🎓 VAM Scholarship Recipient — 2025
[2025-11-20]  🌟 CEP Business Case Certificate — Cohort 3
```

The `certificate_url` field, if populated, renders as a clickable link in the timeline entry.

### Admin view: recognition management

Admins can:
- View all recognitions per person (on person timeline)
- View all recognitions per season (on season management page)
- Grant a new recognition (ops+ scope)
- Link a recognition to a completion review or decision
- Set `visible_on_timeline = false` to hide a recognition (rare — for corrections)

---

## 9. Mentor Certification Model

### Certification is not season participation

These are completely independent:
- A mentor can be active in S12 without any certification.
- A certified mentor can be paused (season status = paused) — their certification remains valid.
- A mentor can hold Level 1 certification while applying for Level 2.
- Certification does NOT grant or modify season participation status.

### Track and module structure

```
Certification Track: VAM Certified Mentor — Level 1 (VAM-CMT-L1)
  ├── Module 01: Foundations of Mentorship (required, 3h)
  ├── Module 02: Active Listening and Coaching Techniques (required, 2h)
  ├── Module 03: Goal Setting and Accountability (required, 2h)
  └── Module 04: Cross-Generational Communication (optional, 1.5h)

Certification Track: VAM Certified Mentor — Level 2 (VAM-CMT-L2)
  prerequisite: VAM-CMT-L1
  ├── Module 05: Advanced Feedback Frameworks (required, 3h)
  └── ...
```

### Enrollment sources

| Source | Description |
|--------|-------------|
| `self_enrolled` | Mentor enrolled themselves (Phase 3 — requires mentor portal) |
| `admin_enrolled` | Admin enrolled the mentor |
| `opportunity` | Enrollment triggered by acceptance into a `mentor_training` opportunity |

### Certification lifecycle

```
Modules enrolled → Modules completed (all required) → Certification issued
  → status = 'active'
  → expires_at set if validity_months is configured
  → member_recognitions row created with type = 'mentor_certification'
  → system_certification_earned CRM note auto-created

If expired:
  → status = 'expired'
  → system_status_change CRM note auto-created
  → admin prompted to offer renewal opportunity

If renewed:
  → renewed_at updated, expires_at extended
  → status = 'active'
```

### Evidence requirement

Each module enrollment has an `evidence_notes` and `evidence_url` field. For verified delivery formats (workshop attendance), evidence is automatically confirmed. For self-paced modules, the mentor must submit evidence (reflection notes, quiz result, link to session recording) before the enrollment is marked `completed`.

### Mentoring hours linkage

When a module is completed, if the module has `duration_hours > 0`, the system creates a `mentoring_hours_logs` row:
```
source = 'session_log'
source_label = "Module: VAM-CMT-L1-M01 — Foundations of Mentorship"
hours = module.duration_hours
contributes_to_track_id = module.track_id
verification_status = 'auto_verified'
```

---

## 10. Mentoring Hours Tracking

### Why hours matter

Hours provide the evidence base for:
- Mentor recognition ("Top mentor by hours this season")
- Certification progression ("Completed 20 hours of supervised mentoring")
- External reporting ("VAM mentors contributed 1,400 hours in 2025")
- Individual mentor profiles for career/professional documentation

### Source types and trust levels

| Source | Trust | Auto-verified? | Notes |
|--------|-------|---------------|-------|
| `recap_derived` | Medium | Yes (auto) | Estimated from recap count × avg session length |
| `session_log` | High | Yes (auto) | Verified session record |
| `admin_entered` | High | Yes (manual) | Admin enters confirmed hours |
| `self_reported` | Low | No | Requires verification |
| `import` | Medium | No | Imported historical data — requires batch review |
| `cep_activity` | High | Yes (auto) | Linked to CEP slot completion |

### Recap-derived hours

When a mentoring recap is recorded with `status IN ('submitted', 'needs_review')`, the system creates a `mentoring_hours_logs` row:
```
source = 'recap_derived'
hours = 1.5  (configurable system default — e.g. 1.5 hours per session)
linked_recap_id = recap.id
linked_match_id = recap.match_id
verification_status = 'auto_verified'
source_label = "Estimated from recap — [recap date]"
```

This is a **derived estimate**, not a confirmed session duration. Mentors may self-report a different duration for the same session. The system stores both and lets the admin or certification engine decide which to count.

### Verification workflow

```
Self-reported hours submitted
  → verification_status = 'pending'
  → admin sees pending hours in verification queue

Admin reviews:
  → verified: status = 'verified', hours credited to certification track
  → rejected: status = 'rejected', rejection_reason set
    → system note auto-created for mentor: "Giờ tự báo cáo [date] bị từ chối"
```

### Hours in person timeline

Mentoring hours are shown as a summary in the person timeline (not individual log entries, to avoid clutter):
```
UEHM-S12 (current season)
  Mentor hours: 18.5h verified · 3.0h pending verification
```

On the mentor's detail page, a full hours log is accessible, filtered by season, source, and verification status.

---

## 11. Scholarship Application Workflow

### Overview

The scholarship is modeled as one `opportunities` row with `opportunity_type = 'scholarship'`. Each applicant has one `opportunity_applications` row with their form answers sealed in `form_answers jsonb`. The `has_financial_data = true` flag activates the strictest visibility controls.

### Eligibility check (automated)

`eligibility_rules` on the scholarship opportunity may include:
```json
{
  "must_be_active_mentee": true,
  "min_season_id": "uuid-of-target-season",
  "min_recap_count": 4,
  "min_gpa": null,
  "program_ids": ["uuid-of-uehm"],
  "note": "Eligibility is checked at application submission time."
}
```

On submission, the system reads the rules and sets `eligibility_status`. Admin can override with reason.

### Form structure (sealed in `form_answers`)

```
Academic information:
  - Current school, faculty, year
  - GPA or academic standing
  - Academic achievement notes

Financial / personal situation:
  - Family financial situation (self-declared)
  - Dependents / family obligations
  - Employment status

Personal essay:
  - Why you are applying
  - Impact of the scholarship on your goals
  - VAM contribution and future intentions

Supporting evidence:
  - Document URLs (academic transcript, financial proof — admin uploads or applicant uploads)
```

### Review process

Scholarship reviews use a committee model:
1. Initial screen (eligibility confirmed, form completeness)
2. Full review by 2–3 committee members (rubric: need, merit, VAM contribution, essay quality)
3. Shortlist (top candidates by average score)
4. Optional interview
5. Committee final decision

`opportunity_reviews.has_financial_data` flag means committee members with `full_access_only` visibility see financial fields; others see a redacted summary.

### Decision and award

```
outcome = 'selected'
  → opportunity_decisions.award_amount set (if monetary award)
  → member_recognitions row created: type = 'scholarship_recipient'
  → person_season_memberships updated if scholarship modifies membership
  → system_opportunity_decided CRM note created (ops_only visibility)
  → applicant notified (notification_sent_at set)

outcome = 'not_selected'
  → system_opportunity_decided CRM note (ops_only)
  → outcome_reason set (for applicant-facing communication if shared)
```

### Visibility controls for scholarship

| Data | Visibility |
|------|-----------|
| Application exists (person applied) | `team` |
| Stage / status (shortlisted, decided) | `ops_only` |
| Review scores and committee notes | `ops_only` |
| Financial fields in form_answers | `full_access_only` |
| Personal essay | `full_access_only` |
| Award amount | `full_access_only` |
| Outcome (selected / not selected) | `ops_only` |
| Recognition (scholarship recipient) | `team` (if `visible_on_timeline = true`) |

---

## 12. Supporter Recruitment Workflow

### The three applicant sources

Supporter recruitment must track where each supporter came from. This is critical for:
- Understanding community pipeline health
- Applying different eligibility rules
- Handling the external applicant identity creation correctly

```
Source: existing_mentee
  Person is currently active as mentee in the season.
  opportunity_applications.person_id = their existing people.id
  No new people row needed.
  source_membership_id = their active mentee membership row.

Source: alumni_mentee
  Person graduated from a previous season but is no longer an active mentee.
  opportunity_applications.person_id = their existing people.id
  source_season_id = the season in which they were a mentee.

Source: external_applicant
  Person has no prior VAM identity.
  At application time: person_id = NULL, external_applicant_email + name captured.
  At acceptance: CREATE a new people row → set person_id on application.
  person_season_memberships row created: role = 'supporter', source_role = NULL.
  Their first VAM role is 'supporter' — they are NOT retroactively labeled 'mentee'.
```

### Eligibility by source

| Source | Default eligibility | Key check |
|--------|--------------------|------------|
| `existing_mentee` | Auto-check: active in target season | Must have min_recap_count in current season |
| `alumni_mentee` | Auto-check: graduated from prior season | No active block; CRM history reviewed |
| `external_applicant` | Admin-reviewed | No automatic check; admin validates identity and motivation |

### Application form (sealed in `form_answers`)

```
All applicants:
  - Motivation for becoming a supporter
  - Preferred function/team (Operations, Recruitment, Communications, Events, etc.)
  - Availability (hours per week, days)
  - Prior contributions to VAM or similar communities
  - References (optional)

External applicants additionally:
  - How they heard about VAM
  - Current school / organization
  - Why they want to join VAM as an external supporter
```

### Interview (optional per cohort)

The supporter recruitment opportunity may include an `interview` stage. If so:
- Shortlisted applicants are scheduled for interviews
- `opportunity_interviews` rows are created
- Interview notes are `ops_only` visibility

### Acceptance and assignment

```
Decision: outcome = 'selected'
  ├── If existing_mentee or alumni_mentee:
  │     → opportunity_assignments row: assignment_type = 'supporter_role',
  │       assigned_role, assigned_function, assigned_season_id
  │     → person_season_memberships row created:
  │         role = 'supporter', status = 'active', season_id = target season
  │         source_role = 'mentee', source_season_id = source_season_id
  │     → system_opportunity_decided CRM note (team visibility)
  │
  └── If external_applicant:
        → CREATE people row with external applicant's data
        → opportunity_applications.person_id = new people.id
        → opportunity_assignments row created
        → person_season_memberships row: role = 'supporter', status = 'active'
          source_role = NULL, notes = 'External applicant — accepted as supporter'
        → system_opportunity_decided + system_status_change CRM notes
        → IMPORTANT: This is their FIRST VAM identity entry. They are NOT mentees.
```

### System permission is NOT automatically granted

The `supporter` community role in `person_season_memberships` does NOT trigger any `admin_scope_access` change. If a supporter needs system access (e.g., to assist with data entry as a support_team member), an explicit `admin_scope_access` entry must be created by a `full_access` or `super_admin` administrator. This is always a separate, deliberate action.

---

## 13. CEP Job Shadowing Workflow

### Overview

CEP Job Shadowing is modeled as one `opportunities` row with `opportunity_type = 'cep_job_shadowing'`. Host companies/professionals are created as `cep_hosts` rows. Each host has `cep_slots` (one per student place).

### Step-by-step

**1. Opportunity opened**
Admin creates the opportunity with `opens_at`, `closes_at`, maximum capacity.
`cep_hosts` rows are added with their respective `cep_slots`.

**2. Application**
Students apply via `opportunity_applications`. Form includes:
- First/second preference host
- Motivation
- Relevant skills/background
- Availability

**3. Eligibility screening**
`eligibility_rules` may specify: must be active mentee or alumni mentee, or open to external.

**4. Review and slot assignment**

```
Decision: outcome = 'selected'
  → opportunity_assignments row:
      assignment_type = 'cep_host_slot'
      cep_host_id = assigned host
  → cep_slots.assigned_person_id = person.id
  → system_cep_assigned CRM note (team visibility)
```

**5. Program completion**
After the shadowing experience:
- `cep_slots.attendance_status` = attended / absent
- `cep_slots.student_feedback` = sealed jsonb (student's reflection — ops_only)
- `cep_slots.host_feedback` = sealed jsonb (host's assessment — full_access_only)
- `opportunity_decisions.outcome` updated: `completed` or `did_not_complete`

**6. Certificate / recognition**
```
outcome = 'completed'
  → member_recognitions row: type = 'cep_completion'
  → certificate_url set if certificate issued
  → type = 'cep_certificate' if formal certificate issued
  → system_recognition_granted CRM note
```

---

## 14. CEP Business Case Workflow

### Overview

CEP Business Case is modeled as one `opportunities` row with `opportunity_type = 'cep_business_case'`. Post-selection, accepted students are organized into `cep_teams`, assigned a case/company, and tracked through milestones.

### Step-by-step

**1. Application**
Students apply via `opportunity_applications`. Form includes:
- Skill background, track of interest
- Team preferences
- Prior case/project experience

**2. Review and selection**
Standard `opportunity_reviews` → `opportunity_decisions`. Outcome: `selected` or `not_selected`.

**3. Team formation**

```
Post-selection — admin creates cep_teams:
  → team_name, case_company, case_description
  → cep_team_members rows: one per person assigned to this team
     (role_in_team: member / lead / presenter)
  → cep_teams.assigned_mentor_id = mentor/advisor person.id
  → opportunity_assignments row per person:
      assignment_type = 'cep_team'
      cep_team_id = this team
```

**4. Milestone tracking**

`cep_milestones` rows are created per team per phase. Admin updates status as teams submit:
- `pending` → `submitted` → `approved` / `needs_revision`

Milestone content (submitted link, reviewer notes) stored in `content jsonb`.

**5. Final presentation**

Final presentation is a milestone with `milestone_name = 'Final Presentation'`. After evaluation:
- `cep_teams.status` → `completed` or `did_not_complete`
- Evaluation notes in the final milestone

**6. Certificate / recognition**

```
Team completes successfully:
  → For EACH team member:
      opportunity_decisions.outcome = 'completed'
      member_recognitions row: type = 'cep_certificate'
      mentoring_hours_logs row for assigned mentor (source = 'cep_activity')
      system_recognition_granted CRM note per person
```

---

## 15. Privacy and Permission Model

### Visibility hierarchy for opportunities data

| Data | viewer | reviewer | operations | full_access | super_admin |
|------|--------|----------|------------|-------------|-------------|
| Opportunity exists and is open | ✓ | ✓ | ✓ | ✓ | ✓ |
| Application submitted (basic) | ✗ | ✓ limited | ✓ | ✓ | ✓ |
| Application stage / status | ✗ | own scope | ✓ | ✓ | ✓ |
| Review scores | ✗ | own reviews | ✓ | ✓ | ✓ |
| Interview notes | ✗ | ✗ | ✓ | ✓ | ✓ |
| Decision (outcome) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Scholarship form answers (non-financial) | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Scholarship financial fields** | ✗ | ✗ | ✗ | ✓ | ✓ |
| **Award amount** | ✗ | ✗ | ✗ | ✓ | ✓ |
| CEP host feedback | ✗ | ✗ | ✗ | ✓ | ✓ |
| Recognition (public) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mentoring hours (verified) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Self-reported hours (pending) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Certification status | ✗ | ✓ | ✓ | ✓ | ✓ |

### Reviewer assignment scope

Opportunity reviewers are `admin_users` with at minimum `reviewer` scope for the linked program. They can only see applications assigned to them. They cannot see other reviewers' scores until the review phase is closed (configurable on the opportunity).

### Conflict of interest

`opportunity_reviews.conflict_of_interest` must be declared before reviewing. If declared:
- Review is marked `abstained`
- A different reviewer is assigned
- Conflict record is preserved for audit

### External supporter applicants after acceptance

Once an external supporter applicant is accepted and given a `people` record, they enter the member lifecycle. If they later receive system access (a separate decision), their access level starts at `viewer` at minimum — never higher than what the program admin explicitly grants.

### Audit requirements

All `opportunity_decisions` rows are immutable after a 30-minute grace period (consistent with CRM notes). Changes after grace period require `full_access` or above and append an audit entry. The `person_notes_read_log` (Phase 2 CRM feature) is extended to cover `opportunity_decisions` rows with `has_financial_data = true` — any admin reading a scholarship decision must be logged.

---

## 16. CRM Integration

### System-generated notes (auto-created, always visible, read-only)

| Event | CRM note type | Visibility |
|-------|--------------|-----------|
| Application submitted | `system_opportunity_applied` | `team` |
| Eligibility check failed | `system_opportunity_ineligible` | `ops_only` |
| Application shortlisted | `system_opportunity_shortlisted` | `ops_only` |
| Decision: selected | `system_opportunity_decided` | `ops_only` |
| Decision: not selected | `system_opportunity_decided` | `ops_only` |
| Assignment made (CEP/supporter) | `system_cep_assigned` / `system_supporter_assigned` | `team` |
| CEP program completed | `system_opportunity_completed` | `team` |
| Completion review outcome set | `system_completion_recorded` | `team` |
| Recognition granted | `system_recognition_granted` | `team` |
| Certification earned | `system_certification_earned` | `team` |
| Certification expired | `system_certification_expired` | `ops_only` |
| Mentoring hours rejected | `system_hours_rejected` | `ops_only` |
| External supporter identity created | `system_identity_created` | `ops_only` |

All system notes are linked to `linked_season_id` and `linked_program_id` where applicable.

### Manual notes for sensitive cases

The CRM note system (from `CRM_RELATIONSHIP_HISTORY_BLUEPRINT.md`) is used for:
- Documenting why a scholarship applicant was not selected (if admin wants to record more than `outcome_reason`)
- Recording a mentor's feedback about a CEP student they advised
- Following up with a not-selected supporter applicant (re-engagement note)
- Recording conversation about a failed completion (with `observation` or `contact_outbound` note)
- Escalating concerns about a Business Case team's progress

### Follow-up actions from opportunity events

Standard `person_note_actions` patterns triggered by opportunity outcomes:

| Trigger | Auto-suggested action |
|---------|----------------------|
| Application not_selected | action: send_message — notify applicant of outcome |
| Shortlisted — interview pending | action: confirm_status — schedule interview |
| Certification expired | action: send_message — renewal offer |
| External applicant accepted | action: send_update — onboarding welcome |
| Milestone needs_revision | action: send_message — request revision |
| Scholarship review overdue | action: review_with_team — follow up with committee |

---

## 17. Lifecycle and Season Rollover Integration

### Completion updates season membership

```
completion_outcome = 'completed' or 'outstanding':
  → person_season_memberships.status = 'graduated'
  → person_season_membership_log entry created
  → system_completion_recorded note created

completion_outcome = 'not_completed':
  → person_season_memberships.status left as 'active' (admin decides how to record)
  → system_completion_recorded note (ops_only)
  → admin prompted to create a follow-up CRM note with context
```

### Supporter selection creates new season membership

```
Supporter accepted (any source):
  → person_season_memberships row created:
      role = 'supporter'
      status = 'active'
      season_id = assigned_season_id
      source_role = 'mentee' or 'alumni_mentee' or NULL (external)
  → system_status_change note created

During rollover:
  → Active supporters proposed for carry-forward by default (same logic as mentors)
  → CRM summary shown per supporter in rollover proposal
```

### External supporter → VAM identity creation

```
External applicant accepted as supporter:
  → people row created (person_id now exists)
  → opportunity_applications.person_id linked to new people row
  → person_season_memberships: role = 'supporter', status = 'active'
  → system_identity_created note: "External supporter accepted —
      new VAM identity created [date]"
  → No mentee_profile or mentor_profile created — they are solely a supporter
  → They appear on /people list for their scoped program/season
  → Future seasons: treated as alumni supporter → may apply as mentor or supporter again
```

### Scholarship recognition in timeline

```
Scholarship decided (selected):
  → member_recognitions row: type = 'scholarship_recipient'
  → Appears in person timeline: "🎓 VAM Scholarship Recipient — 2026"
  → Not shown in broad dashboards (ops_only until visible_on_timeline action)
  → Admin may flip visible_on_timeline = true to show it publicly on person profile
```

### CEP participation in timeline

```
CEP completed:
  → member_recognitions row: type = 'cep_completion' or 'cep_certificate'
  → Appears in person timeline: "🌟 CEP Business Case — Cohort 3 (2026)"
  → system_opportunity_completed note
```

### Mentor certification enriches profile — does not grant season participation

```
Certification earned:
  → mentor_certifications row: status = 'active'
  → member_recognitions row: type = 'mentor_certification'
  → Appears in mentor profile and person timeline
  → Does NOT create or modify person_season_memberships
  → Does NOT create or modify admin_scope_access
  → Rollover proposal notes: "Certified mentor — VAM-CMT-L1" (informational)
```

---

## 18. Implementation Roadmap

### Phase 1 — Blueprint and Foundation (this document)

Deliverable: this document. No migrations. No code.
Outcome: shared design language; team aligned on data model; development queue ready.

---

### Phase 2 — Generic Opportunities MVP

**Goal:** Admin can create an opportunity, accept applications, record decisions.

| Task | Scope |
|------|-------|
| Migrations: `opportunities`, `opportunity_applications`, `opportunity_decisions` | DB |
| `lib/opportunities.ts` — createOpportunity, createApplication, setDecision | App |
| Admin: `/opportunities` — list and create opportunities | UI |
| Admin: `/opportunities/[id]` — application list, stage management, decisions | UI |
| System note auto-creation on application + decision | App |
| Scope guard: `operations+` to create opportunities and decisions | App |
| Public opportunity application form (no auth — same pattern as event registration) | Public UI |
| typecheck ✓ · lint ✓ · build ✓ | — |

Not in Phase 2: reviews, interviews, scholarship, supporter source tracking.

---

### Phase 3 — Scholarship MVP

**Goal:** Full scholarship workflow with privacy controls and committee review.

| Task | Scope |
|------|-------|
| Migrations: `opportunity_reviews`, `opportunity_interviews` | DB |
| `has_financial_data` flag and `full_access_only` visibility enforcement | App |
| Review assignment and submission workflow | UI |
| Shortlisting and interview scheduling | UI |
| Committee decision with award amount | UI |
| `member_recognitions` table + recognition creation | DB + UI |
| Recognition display on person timeline | UI |
| Scholarship visibility audit log (read_log integration) | App |

---

### Phase 4 — Supporter Recruitment MVP

**Goal:** Full supporter recruitment with source tracking and external identity creation.

| Task | Scope |
|------|-------|
| `applicant_type` source tracking on applications | App |
| External applicant flow: submit with email → accept → create people record | App |
| `person_season_memberships` creation on acceptance | App |
| Source display on supporter profile | UI |
| Supporter list per season with source column | UI |
| CRM notes: system_supporter_assigned, system_identity_created | App |

---

### Phase 5 — Mentor Certification and Hours MVP

**Goal:** Mentors can track certification progress; hours are logged and verified.

| Task | Scope |
|------|-------|
| Migrations: certification tracks, modules, enrollments, certifications | DB |
| Migration: `mentoring_hours_logs` | DB |
| Recap-derived hours: auto-create log row on recap submission | App |
| Admin: enroll mentor in module | UI |
| Admin: verify/reject self-reported hours | UI |
| Hours verification queue | UI |
| Certification issuance | UI |
| `mentor_certifications` display on mentor profile and person timeline | UI |
| `member_recognitions` created on certification issuance | App |

---

### Phase 6 — CEP Job Shadowing and Business Case

**Goal:** Full CEP program support with host/slot assignment and team/milestone tracking.

| Task | Scope |
|------|-------|
| Migrations: `cep_hosts`, `cep_slots`, `cep_teams`, `cep_team_members`, `cep_milestones` | DB |
| CEP host management (admin creates hosts and slots) | UI |
| Slot assignment post-selection | UI |
| CEP team formation and member assignment | UI |
| Milestone creation and tracking | UI |
| Student and host feedback (sealed) | App |
| Team completion and certificate issuance | UI |
| Mentoring hours log for CEP advisor on completion | App |

---

### Phase 7 — Analytics and Reporting

**Goal:** Aggregate insights across all opportunity programs.

| Task | Scope |
|------|-------|
| Season graduation dashboard: completion rate, outstanding count | Analytics |
| Scholarship pipeline funnel: applied → shortlisted → selected → awarded | Analytics |
| Mentor certification rate by program | Analytics |
| Total mentoring hours by season, program, mentor | Analytics |
| Supporter source breakdown: mentee / alumni / external by cohort | Analytics |
| CEP participation and completion rate | Analytics |
| Export: recognition and completion records to CSV | Admin |

---

## 19. Risks and Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Overbuilding too early** | HIGH | Wasted effort if program designs change | Phases 2–7 are sequential; do not start Phase 3 until Phase 2 is in production and validated |
| **Scholarship financial data exposed in broad views** | MEDIUM | Legal and trust risk | `has_financial_data` flag + `full_access_only` enforcement at query layer; never in list views |
| **Duplicate form systems** (opportunity form vs. event registration) | MEDIUM | Confusion, duplicate submissions | Strictly enforce: opportunities use `opportunity_applications`; events use `event_registrations` — never mix |
| **External supporter applicant not linked to people record** | HIGH | Orphaned application data | Hard constraint: if external applicant is accepted, people record MUST be created before assignment is written |
| **Supporter community role → system permission confusion** | MEDIUM | Unauthorized access | UI must clearly distinguish "Vai trò cộng đồng" from "Quyền hệ thống"; supporter acceptance never touches `admin_scope_access` |
| **Source context for external supporter lost over time** | LOW | Historical reporting inaccurate | `applicant_type` is normalized, immutable after creation; `source_season_id` preserved |
| **JSON form_answers overused — unqueryable fields** | MEDIUM | Analytics blocked | Rule: anything that will be filtered, ranked, or counted MUST be a normalized column, not in JSON |
| **JSON form_answers underused — premature normalization** | LOW | Schema rigidity | Rule: application content that varies per opportunity type stays in JSON; only outcomes and identifiers are normalized |
| **mentor_certifications not linked to season** | LOW | Certification floating without context | Certification is intentionally cross-season; linked via `member_recognitions` which has `season_id` for context |
| **Mentoring hours double-counted** (recap-derived + self-reported for same session) | MEDIUM | Inflated certification progress | Keep both; certification engine uses `recap_derived` by default; self-reported requires verification and deduplication check |
| **CEP teams formed from wrong accepted applicants** | LOW | Wrong assignment | Team member must be accepted (`opportunity_decisions.outcome = 'selected'`); server-side validation before `cep_team_members` insert |
| **Mixing CEP with event module** | HIGH | Wrong data model | CEP cohorts are not events; no `event_registrations` for CEP; enforce in onboarding docs and code review |
| **Migration from current applications table** | MEDIUM | Existing UEHM/HAM applications in old schema | Current `applications` table is for intake (mentee/mentor admission); the new `opportunity_applications` is for post-admission development programs — they coexist and do not replace each other |
| **Scholarship award amount in exports or logs** | HIGH | Financial data leak | `award_amount` column never appears in list queries; never logged; accessible only via direct single-record fetch with full_access+ auth |

---

## 20. QA Checklist

### Data model QA

```
□ opportunities.opportunity_type constrained to known values
□ opportunity_applications UNIQUE (opportunity_id, person_id) — no double applications
□ External applicant applications (person_id = NULL) have external_applicant_email populated
□ opportunity_decisions UNIQUE (application_id) — one decision per application
□ member_recognitions: person_id FK valid
□ mentor_training_enrollments UNIQUE (person_id, module_id)
□ mentor_certifications UNIQUE (person_id, track_id)
□ mentoring_hours_logs: hours > 0 constraint enforced
□ cep_slots: assigned_person_id is accepted applicant only (validated at assignment)
□ cep_team_members: person_id must be accepted applicant in the same cep_business_case opportunity
```

### Permission QA

```
□ Scholarship financial fields (award_amount, financial form_answers sections):
    not returned by any API endpoint for ops or below scope
□ has_financial_data = true applications: verified no ops-level list query returns form_answers
□ opportunity_reviews: reviewer sees only their own reviews until review phase closed
□ conflict_of_interest = true review: marked abstained, reviewer cannot re-access form_answers
□ External applicant before acceptance: person_id = NULL, application not linked to any person profile
□ External applicant after acceptance: people row created, application linked, system note created
□ Supporter acceptance: NO admin_scope_access row created automatically
□ Supporter acceptance: only person_season_memberships row created
□ Viewer-level admin: cannot see opportunity applications, decisions, or review scores
□ HAM opportunity: not visible to UEHM-only admin
```

### Application workflow QA

```
□ Eligibility check runs on form submission (not just on admin command)
□ eligibility_status = 'ineligible' does not block submission — flags application
□ Admin can override ineligibility with reason recorded
□ Application stage progression is linear — cannot skip stages
□ Withdrawn application cannot be re-submitted (status is terminal)
□ Stage update creates system CRM note for person timeline
□ Public application form: unauthenticated access accepted; person_id linked via email match
□ Duplicate submission (same email, same opportunity): blocked with clear message
```

### Review and interview QA

```
□ Reviewer can only access applications assigned to them
□ Reviewer cannot see other reviewers' scores in active review phase
□ Review submitted_at set when reviewer submits — cannot edit after without ops+ override
□ Interview notes visibility = ops_only enforced at query layer
□ Score normalization: if rubric_scores present, score = computed total, not manually entered
□ Reviewer conflict_of_interest declaration required before viewing form_answers
```

### Recognition QA

```
□ member_recognitions.person_id FK constraint valid
□ outstanding_mentee recognition requires completion_outcome = 'outstanding' on the completion review
  (or explicit ops+ admin grant)
□ scholarship_recipient recognition requires opportunity_decisions.outcome = 'selected'
□ Recognition visible_on_timeline = true: appears in person timeline
□ Recognition visible_on_timeline = false: does NOT appear in person timeline (hidden, not deleted)
□ recognition_type constrained to known values
□ certificate_url (if present) is a valid URL format
```

### Completion and graduation QA

```
□ season_completion_requirements exists for the season before completion reviews begin
□ actual_recap_count computed from validated recaps only (status = 'submitted' or 'needs_review')
□ auto_eligible correctly computed from all three conditions
□ admin_override requires admin_override_reason (non-empty)
□ completion_outcome = 'outstanding' requires ops+ scope at minimum
□ completion_outcome = 'outstanding' creates member_recognitions row automatically
□ completion_outcome updates person_season_memberships.status correctly
□ Completion review for person outside admin's scope is rejected (403)
```

### Supporter source QA

```
□ applicant_type = 'existing_mentee': person_id must be a person with active mentee membership
□ applicant_type = 'alumni_mentee': person_id must be a person with graduated mentee membership
□ applicant_type = 'external_applicant': person_id = NULL at submission time
□ External applicant accepted:
    → people row created exactly once (idempotency on re-acceptance attempt)
    → opportunity_applications.person_id updated to new people.id
    → person_season_memberships.role = 'supporter' (NOT 'mentee')
    → system_identity_created CRM note created
□ External accepted supporter: admin_scope_access NOT created
□ Source tracking fields (applicant_type, source_season_id, source_membership_id)
    are immutable after submission
```

### Mentor certification QA

```
□ Enrollment allowed only for is_active = true modules
□ Enrollment source ('self_enrolled' vs 'admin_enrolled') recorded correctly
□ Module completion: all required modules must be 'completed' before certification issued
□ Optional modules do not block certification issuance
□ mentor_certifications: only one 'active' row per (person_id, track_id)
  Previous certifications archived (status = 'expired') before new issuance
□ Certification issued: member_recognitions row created and system_certification_earned note fired
□ Certification expired: system_certification_expired note fired
□ Evidence URL (if required): validated as non-empty URL before marking module 'completed'
```

### Mentoring hours QA

```
□ hours > 0 constraint enforced
□ recap_derived hours auto-created on recap submission (not on draft)
□ self_reported hours: verification_status = 'pending' on creation
□ verified hours: verification_status changes only by ops+ admin
□ rejected hours: rejection_reason non-empty
□ Hours outside admin's scope: not visible (program_id filter enforced)
□ Duplicate hours for same recap: prevented (UNIQUE on linked_recap_id where source = 'recap_derived')
□ Hours totals in person timeline: summary only (count + verified hours), not full log rows
```

### CRM integration QA

```
□ System note created on: application submitted, shortlisted, decided, assigned, completed,
  recognized, certified, hours rejected, external identity created
□ System note: is_system_generated = true, read-only, cannot be deleted
□ System note visibility matches the table above (§16)
□ Linked_person_id on system note matches the person who was processed
□ Follow-up action suggested (not forced) after: not_selected, certification expired,
  milestone needs_revision, external applicant accepted
□ CRM note for scholarship decision: visibility = ops_only confirmed
□ CRM note for scholarship financial data references: body never contains award_amount
```

### Lifecycle integration QA

```
□ Completion outcome = 'completed': person_season_memberships.status = 'graduated'
□ Completion outcome = 'not_completed': membership status handled as agreed (not auto-withdrawn)
□ Supporter acceptance (any source): person_season_memberships row created in target season
□ External supporter acceptance: people row created before person_season_memberships row
□ Certification earned: does NOT modify person_season_memberships
□ Certification earned: does NOT modify admin_scope_access
□ Rollover proposal: shows supporter source type for each supporter
□ Rollover proposal: shows certification status for each mentor (informational)
□ CEP completion: member_recognitions visible on person timeline
□ Scholarship recognition: visible on timeline only if visible_on_timeline = true (set by admin)
```

### Regression QA (existing system)

```
□ Existing applications table (mentee/mentor intake): unaffected by new opportunities tables
□ Event registrations: unaffected — no CEP or opportunity routing to event_registrations
□ person_season_memberships: existing rows unaffected; new rows additive
□ people table: no schema changes from this blueprint
□ CRM person_notes: system note additions are new note_types only — do not change existing types
□ /mentors, /mentees, /matches, /people: no functional regression
□ typecheck ✓ · lint ✓ · build ✓
```

---

*This document is design-only. No migrations have been applied. No code has been written. All implementation should follow existing VAM OS codex conventions: Server Actions for mutations, service-role client for data reads, scope guards on all admin routes, no PII in logs. Each phase should be implemented on staging first with coreteam review before production. Scholarship and financial data fields require full_access+ scope enforcement at the query layer — never rely on UI alone.*
