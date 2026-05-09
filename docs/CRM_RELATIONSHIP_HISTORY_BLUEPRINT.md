# VAM OS — CRM & Relationship History Blueprint
**Version 2.0 | 2026-05-09 | Supersedes planning stub v1 | Design only — no migrations applied**

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Use Cases](#2-use-cases)
3. [Core Design Principles](#3-core-design-principles)
4. [Note Type Taxonomy](#4-note-type-taxonomy)
5. [Visibility and Permission Model](#5-visibility-and-permission-model)
6. [Proposed Data Model](#6-proposed-data-model)
7. [Person Timeline Design](#7-person-timeline-design)
8. [Match Relationship Timeline Design](#8-match-relationship-timeline-design)
9. [Follow-up and Action Workflow](#9-follow-up-and-action-workflow)
10. [Mentor Pause / Off / Re-engagement Workflow](#10-mentor-pause--off--re-engagement-workflow)
11. [Integration with Member Lifecycle and Season Rollover](#11-integration-with-member-lifecycle-and-season-rollover)
12. [Implementation Phases](#12-implementation-phases)
13. [Risks and Trade-offs](#13-risks-and-trade-offs)
14. [QA Checklist](#14-qa-checklist)

---

## 1. Problem Statement

VAM OS tracks the operational facts of mentoring — matches, recaps, events, applications. But it does not track the **relational history** between the coreteam and individual members over time.

A mentor who paused in S11 is indistinguishable in the system from one who withdrew permanently. A mentee complaint about their mentor becomes invisible after the season closes. A coreteam member who called a mentor three months ago has no record of what was agreed. A new coreteam member starting S12 has no way to know that a specific mentor needs a personal call — not a form email — because they nearly quit in S10.

This gap causes real operational problems:

| Symptom | Root cause |
|---------|-----------|
| Team re-contacts mentor without knowing previous agreement | No contact log |
| Mentor feedback about a mentee "falls through the cracks" | No feedback → action → resolution chain |
| New coreteam inherits no institutional memory about members | Notes live only in Zalo/personal notebooks |
| Paused mentor re-engagement is inconsistent across team members | No structured re-engagement workflow |
| Sensitive complaints have no privacy controls | All notes, if any, are fully visible to everyone |
| Team cannot identify who has been uncontacted for 6+ months | No last-contact date tracking |

This blueprint proposes a lightweight but structured CRM layer built directly into VAM OS that answers the core operational question:

> **"Who contacted this person, when, about what, what was agreed, and what is the next action?"**

---

## 2. Use Cases

### UC-1 — Mentor pause intent recording
A mentor tells the coreteam they need to pause for one season. The team records: reason for pause, intended return season, who agreed, and creates a follow-up task to re-contact before the next rollover. Without this, the next coreteam cohort has no idea what was agreed — or even that a conversation happened.

### UC-2 — Program feedback handling
A mentor gives feedback that the application process is too manual. The team records it, marks it "in review," and updates it when the process improves. The mentor can be told in a future contact: "We've since changed this — here's what's different." The feedback becomes institutional memory rather than a one-time chat message.

### UC-3 — Mentee complaint about mentor
A mentee shares (via message or form) that their mentor has been unresponsive for two months. The team records the complaint confidentially, assigns follow-up to a specific coreteam member, and tracks whether it was resolved. Not visible to reviewer-level admins.

### UC-4 — Mentor feedback about mentee disengagement
A mentor reports that their mentee has stopped responding. The team records the feedback linked to the match, assigns a coreteam member to contact the mentee, and tracks the resolution. The note appears on both the mentor's timeline and the mentee's timeline.

### UC-5 — Pre-season mentor re-engagement
Before S12 rollover, the team contacts every paused mentor. They open the re-engagement queue, see last contact date, pause reason, and agreed return intent. Each outreach is logged as a contact note. Mentor status is updated based on the response. The whole team has visibility into what has been done and by whom.

### UC-6 — New coreteam onboarding
A new coreteam member takes over a mentor relationship mid-season. They open the mentor's profile and immediately see: every contact ever made, by whom, the tone of previous interactions, open follow-up items, and any sensitive notes they have access to. No institutional knowledge is lost in handover.

### UC-7 — Long-term alumni re-engagement
An alumni mentee from S08 is now at a target company and may be a strong mentor candidate. The team records an outreach note, the alumni's initial response, and a follow-up task to formalize the mentor application for S13. The arc is visible years later.

### UC-8 — Sensitive note (confidential)
A coreteam member learns that a mentor is going through a difficult personal period and may not be able to continue. This is recorded as an `ops_only` note so the team handles outreach sensitively — not surfaced to reviewer or viewer-level admins.

---

## 3. Core Design Principles

**P1 — Person is the anchor**
Every note attaches to a `person_id`. Optional secondary links (match, season, recap, event, application, season membership) provide context but are never the primary key.

**P2 — Notes are immutable after a grace period**
A note can be edited within 30 minutes of creation. After that, it cannot be changed — only a follow-up resolution note can be added. This protects audit integrity and institutional trust.

**P3 — Visibility is explicit, not inferred**
Every note carries a `visibility` field set by the creator. The system enforces it server-side. There is no "inherit from context" — the creator must choose visibility at creation time.

**P4 — Actions are first-class objects**
A follow-up task ("call this mentor before May 20") is not a comment on a note — it is a structured `person_note_actions` row with an assignee, due date, and resolution. This enables queue management and team accountability.

**P5 — CRM does not grant or modify system permissions**
Recording that someone is a "mentor" in a CRM note does not change their `admin_scope_access`. CRM is purely relational and operational. The community role taxonomy from the Member Lifecycle blueprint applies here for context only.

**P6 — Sensitivity defaults to conservative**
The default visibility for a new note is `ops_only`, not `team`. Admins must actively choose to make a note more visible. They cannot make it less visible after the grace period without escalation.

**P7 — System-generated notes are always visible and read-only**
Notes auto-created by lifecycle events (rollover, status changes) are visible to any admin with read access to that person's program scope. They contain no sensitive content. They cannot be edited or deleted.

---

## 4. Note Type Taxonomy

Note types describe **what kind of interaction or record** the note captures. They drive UI display, filtering, and integration with lifecycle workflows.

### Contact notes — direct interactions with the person

| Type | Description | Typical direction |
|------|-------------|------------------|
| `contact_outbound` | Coreteam reached out to person (call, Zalo, email) | Outbound |
| `contact_inbound` | Person reached out to coreteam | Inbound |
| `re_engagement` | Outreach specifically to re-engage a paused or inactive member | Outbound |

### Feedback notes — capturing what was expressed

| Type | Description | Subject |
|------|-------------|---------|
| `feedback_from_mentor` | Mentor shared feedback about mentee, program, or process | Mentor → team |
| `feedback_from_mentee` | Mentee shared feedback about mentor, program, or match | Mentee → team |
| `feedback_about_mentor` | Team recording observations or complaints about a mentor's conduct | Internal / mentee → team |
| `feedback_about_mentee` | Team recording observations about a mentee's engagement | Internal / mentor → team |
| `program_feedback` | General feedback about the program — not person-specific | Any direction |

### Intent notes — capturing declared future intentions

| Type | Description |
|------|-------------|
| `pause_intent` | Person has indicated they want to pause: season, duration, reason |
| `withdrawal_intent` | Person has indicated they want to withdraw permanently or long-term |
| `return_intent` | Paused person has confirmed they want to return: target season, conditions |
| `application_intent` | Alumni or supporter has expressed interest in applying as mentor, mentee, or coreteam |

### Operational notes — internal team records

| Type | Description |
|------|-------------|
| `observation` | Internal team observation — no direct contact (e.g. "noticed declining recap rate") |
| `escalation` | Issue escalated to senior coreteam, advisor, or external party |
| `resolution` | How a previously open issue or feedback was formally resolved |
| `handover` | Relationship responsibility transferred to a new coreteam owner |

### System-generated notes — auto-created by VAM OS

| Type | Description | Auto-trigger |
|------|-------------|-------------|
| `system_status_change` | Person's season membership status changed | `person_season_memberships` update |
| `system_rollover` | Person was included or excluded from season rollover | Rollover confirmation |
| `system_match_created` | A match was created for this person this season | Match creation |
| `system_match_closed` | A match was closed or completed | Match status change |

System-generated notes are read-only, always visible to any scoped admin with read access, and never carry sensitive content.

### Contact channel vocabulary (for contact notes)

| Channel | Description |
|---------|-------------|
| `zalo` | Zalo message or call |
| `phone` | Phone call (non-Zalo) |
| `email` | Email |
| `in_person` | In-person meeting |
| `video_call` | Zoom, Google Meet, Teams |
| `form` | Person submitted a structured form |
| `event` | Interaction happened at a program event |
| `other` | Describe in note body |

### Sentiment vocabulary (for feedback notes)

| Sentiment | Description |
|-----------|-------------|
| `positive` | Positive feedback or satisfaction expressed |
| `neutral` | Neutral, informational |
| `concern` | Concern raised — may need follow-up |
| `critical` | Serious issue — action required |

---

## 5. Visibility and Permission Model

### Visibility levels

| Visibility | Who can see | Use case |
|------------|-------------|---------|
| `private` | Creator only | Personal reminders, draft notes not yet shared with team |
| `ops_only` | Admins with `operations` or `full_access` scope for this program | Sensitive feedback, mentor health concerns, complaints |
| `team` | All admins with `read` scope or above for this program | Standard contact logs, general observations, resolved feedback |
| `system` | Any admin with read access to this person's scope | System-generated notes only — lifecycle events |

### Default visibility by note type

| Note type | Default visibility |
|-----------|-------------------|
| `contact_outbound`, `contact_inbound` | `team` |
| `re_engagement` | `ops_only` |
| `feedback_from_mentor`, `feedback_from_mentee` | `ops_only` |
| `feedback_about_mentor`, `feedback_about_mentee` | `ops_only` |
| `program_feedback` | `team` |
| `pause_intent`, `withdrawal_intent`, `return_intent` | `ops_only` |
| `application_intent` | `team` |
| `observation` | `ops_only` |
| `escalation` | `ops_only` |
| `resolution` | inherits from the note it resolves |
| `handover` | `team` |
| `system_*` | `system` (always visible, read-only) |

### Permission rules

```
Rule 1 — Scope check first
  A note for person P in program X is only visible to admins who have
  at least read scope for program X.
  A super_admin sees all notes regardless of program.

Rule 2 — Visibility check second
  Within scope, visibility further restricts:
    private  → creator only
    ops_only → operations+ scope admins
    team     → read+ scope admins
    system   → read+ scope admins (auto-notes only)

Rule 3 — Note creation rights
  operations+ scope: can create all note types
  reviewer scope: can create contact_inbound and program_feedback only
  viewer scope: cannot create any note
  No role can create feedback_about_* without operations+ scope

Rule 4 — Visibility change after grace period
  Creator can change visibility to MORE restrictive (team → ops_only) within grace period.
  After grace period: only full_access or super_admin can change visibility.
  Visibility can never be changed to LESS restrictive after grace period by any non-super-admin.

Rule 5 — Action item visibility
  A follow-up action inherits visibility from its parent note.
  An action cannot be more visible than its parent note.

Rule 6 — System notes
  System-generated notes cannot be edited or deleted by any role.
  System notes cannot be made private.
  System notes are created by the app with is_system_generated = true.
```

### Capability matrix

| Action | viewer | reviewer | operations | full_access | super_admin |
|--------|--------|----------|------------|-------------|-------------|
| Read `team` notes (scoped) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read `ops_only` notes (scoped) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Read `private` notes | own only | own only | own only | own only | own only |
| Create contact / program notes | ✗ | ✓ limited | ✓ | ✓ | ✓ |
| Create `ops_only` notes | ✗ | ✗ | ✓ | ✓ | ✓ |
| Create `feedback_about_*` notes | ✗ | ✗ | ✓ | ✓ | ✓ |
| Edit note (within grace period) | own | own | own | own | ✓ |
| Change visibility after grace period | ✗ | ✗ | restrict only | ✓ | ✓ |
| Create / assign actions | ✗ | ✗ | ✓ | ✓ | ✓ |
| Complete actions | ✗ | ✗ | ✓ | ✓ | ✓ |
| View action queue | ✗ | ✗ | ✓ | ✓ | ✓ |

---

## 6. Proposed Data Model

### 6a. Table: `person_notes`

The core CRM record. One row per interaction, observation, or event. All note types share this table; nullable columns carry type-specific data.

```
Table: person_notes

Column                    Type            Constraints / Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY, default gen_random_uuid()
person_id                 uuid            NOT NULL, FK → people.id

-- Classification
note_type                 text            NOT NULL  [see Note Type Taxonomy §4]
subject                   text            NOT NULL  max 200 chars — the searchable summary
body                      text            NOT NULL  full narrative content
visibility                text            NOT NULL  DEFAULT 'ops_only'
                                          [private | ops_only | team | system]

-- Contact-specific (null for non-contact types)
contact_direction         text            nullable  [outbound | inbound]
contact_channel           text            nullable  [zalo | phone | email | in_person |
                                                     video_call | form | event | other]
contact_date              date            nullable  date the interaction actually happened

-- Feedback-specific (null for non-feedback types)
sentiment                 text            nullable  [positive | neutral | concern | critical]
is_handled                boolean         NOT NULL  DEFAULT false
handled_at                timestamptz     nullable
handled_by_admin_id       uuid            nullable  FK → admin_users.id

-- Intent-specific (null for non-intent types)
intended_return_season_id uuid            nullable  FK → seasons.id
pause_reason              text            nullable
pause_duration_seasons    integer         nullable  how many seasons they said they'd be out

-- Optional context links (all nullable — notes may have zero, one, or several)
linked_season_id          uuid            nullable  FK → seasons.id
linked_program_id         uuid            nullable  FK → programs.id
linked_match_id           uuid            nullable  FK → matches.id
linked_recap_id           uuid            nullable  FK → mentoring_recaps.id
linked_event_id           uuid            nullable  FK → events.id
linked_application_id     uuid            nullable  FK → applications.id
linked_membership_id      uuid            nullable  FK → person_season_memberships.id

-- Status and audit
status                    text            NOT NULL  DEFAULT 'open'
                                          [open | resolved | archived]
is_system_generated       boolean         NOT NULL  DEFAULT false
grace_period_ends_at      timestamptz     NOT NULL  DEFAULT (now() + interval '30 minutes')
created_at                timestamptz     NOT NULL  DEFAULT now()
created_by_admin_id       uuid            NOT NULL  FK → admin_users.id
updated_at                timestamptz     NOT NULL  DEFAULT now()
updated_by_admin_id       uuid            nullable  FK → admin_users.id
```

**Indexes:**
- `(person_id, created_at DESC)` — person timeline queries (primary access pattern)
- `(person_id, note_type, status)` — filtered views (e.g. "open feedback for this person")
- `(linked_match_id)` — match relationship timeline
- `(linked_season_id, note_type)` — season-level aggregates
- `(linked_program_id, note_type, status)` — program-level ops queue
- `(created_by_admin_id, created_at DESC)` — "my recent notes" view
- `(status, visibility, linked_program_id)` — action queue and team dashboards

---

### 6b. Table: `person_note_actions`

A structured follow-up task attached to a note. Enables queue management and individual accountability.

```
Table: person_note_actions

Column                    Type            Constraints / Notes
────────────────────────  ──────────────  ──────────────────────────────────────────────────
id                        uuid            PRIMARY KEY, default gen_random_uuid()
note_id                   uuid            NOT NULL, FK → person_notes.id
person_id                 uuid            NOT NULL  [denormalized — avoids join in queue queries]
program_id                uuid            NOT NULL  [denormalized — for scope filtering]
action_type               text            NOT NULL
                                          [call_back | send_message | review_with_team |
                                           escalate | confirm_status | send_update |
                                           no_action_needed | other]
description               text            NOT NULL  what specifically needs to be done
due_date                  date            nullable
assigned_to_admin_id      uuid            nullable  FK → admin_users.id
status                    text            NOT NULL  DEFAULT 'pending'
                                          [pending | in_progress | completed | cancelled]
                                          — "overdue" is computed (due_date < today, status = pending)
completed_at              timestamptz     nullable
completed_by_admin_id     uuid            nullable  FK → admin_users.id
resolution_notes          text            nullable  what actually happened
created_at                timestamptz     NOT NULL  DEFAULT now()
created_by_admin_id       uuid            NOT NULL  FK → admin_users.id
```

**Indexes:**
- `(assigned_to_admin_id, status, due_date)` — "my open actions" queue
- `(person_id, status)` — open actions per person
- `(program_id, status, due_date)` — program-level action queue
- `(note_id)` — actions per note

---

### 6c. Table: `person_notes_read_log` (Phase 2)

Tracks which admins have read a sensitive note. Useful for confirming a confidential handover was received.

```
Table: person_notes_read_log

Column        Type          Notes
────────────  ────────────  ─────────────────────────
note_id       uuid          FK → person_notes.id
admin_id      uuid          FK → admin_users.id
read_at       timestamptz   DEFAULT now()
PRIMARY KEY (note_id, admin_id)
```

---

### 6d. Relationship to existing tables

```
people (1)
  └── person_notes (many — one per interaction or observation)
        ├── person_note_actions (many — follow-up tasks per note)
        ├── person_notes_read_log (many — Phase 2)
        └── optional links to:
              seasons, programs, matches,
              mentoring_recaps, events,
              applications, person_season_memberships

person_season_memberships (from Lifecycle Blueprint)
  └── person_notes.linked_membership_id → 0..many notes
  └── status changes auto-create system_status_change notes
```

### 6e. Relationship to the prior stub (v1)

The prior stub proposed separate tables: `contact_logs`, `feedback_items`, `relationship_tasks`, `mentor_reactivation_campaigns`, `campaign_participants`. This blueprint consolidates the first three into a single `person_notes` + `person_note_actions` model for these reasons:

- **Simpler schema**: one table to query for the person timeline, not three
- **Consistent visibility model**: one enforcement path, not three
- **Flexible linking**: all context links (match, event, recap) on every note type
- **Campaign tables deferred**: `mentor_reactivation_campaigns` and `campaign_participants` remain valid future-state ideas for Phase 3 when bulk outreach tooling is needed; at current scale, the action queue plus re-engagement notes cover the use case

The vocabulary from v1 (`outcome`, `next_follow_up_at`, `severity`, `escalated_to`) is absorbed into `person_note_actions` (outcome → `resolution_notes`; severity → `action_type` priority implied; escalation → `escalate` action_type).

---

## 7. Person Timeline Design

The person timeline is the primary CRM view — everything the team knows about a person, in chronological order, in one place.

### Timeline sources (aggregated at query time — no separate materialized table needed at Phase 1)

```
1. person_season_memberships        — lifecycle facts: joined, paused, graduated, returned
2. person_notes (visibility-filtered) — CRM interactions, feedback, observations
3. person_note_actions (open only)  — pending actions shown as pinned upcoming items
4. matches                          — pairing milestones: matched, completed, closed
5. mentoring_recaps (counts only)   — activity summary per season (no raw content)
6. event_participations (count)     — event attendance per season
7. applications (status only)       — application submissions and outcomes
```

### Timeline entry types and display labels

| Entry type | Source | Label example |
|-----------|--------|---------------|
| Season joined | `person_season_memberships` | "UEHM-S10 — Tham gia với vai trò Mentee" |
| Season graduated | `person_season_memberships` | "UEHM-S10 — Tốt nghiệp (Graduated)" |
| Season paused | `person_season_memberships` | "HAM-S6 — Tạm nghỉ (Paused)" |
| Match created | `matches` | "UEHM-S10 — Được ghép cặp với Mentor X" |
| Match completed | `matches` | "UEHM-S10 — Hoàn thành mentoring" |
| Recap activity | `mentoring_recaps` | "UEHM-S10 — 8 buổi mentoring ghi nhận" |
| Event attendance | `event_participations` | "UEHM-S10 — Tham dự 3 sự kiện" |
| Contact outbound | `person_notes` | "Liên hệ — Zalo — Xác nhận kế hoạch S12" |
| Feedback received | `person_notes` | "Phản hồi [concern] — Mentor phản hồi về tiến độ mentee" |
| Pause intent | `person_notes` | "Ý định tạm nghỉ — S11, lý do: bận dự án Q1" |
| Open action (pinned) | `person_note_actions` | "⏰ Cần gọi trước 20/05 — Assigned: Thắng" |
| System event | `person_notes` | "[Hệ thống] Chuyển sang Mentor — UEHM-S12 Rollover" |

### Timeline display rules

- All entries sorted by date descending (most recent first)
- Visibility-filtered server-side: viewer sees only `team` and `system` entries; ops+ sees all except other admins' `private` notes
- `private` notes: creator sees full note with a lock icon; others see a greyed placeholder — "Ghi chú riêng tư — không hiển thị ở cấp độ quyền này" (existence acknowledged, content hidden)
- Open actions are pinned to the top regardless of creation date, with due date and overdue highlighting
- System-generated entries are visually lighter and non-interactive
- Season grouping: entries within the same season are grouped under a collapsible season header
- Filters: by note type, by season, by visibility level (if ops+)

### Admin UI: person timeline (embedded in `/people/[id]`)

```
Person: Nguyen Thi A   [Mentor — UEHM-S12 active]
─────────────────────────────────────────────────────────────────
⏰ OPEN ACTIONS (2)
  • Gọi xác nhận kế hoạch ghép cặp S12 — Due: 2026-05-20 (Thắng)
  • Gửi thông tin enrollment — Due: 2026-06-01 (Linh)

─────────────────────────────────────────────────────────────────
TIMELINE

[2026-04-10]  [Hệ thống] Included in UEHM-S12 rollover as Mentor (Thắng)
[2026-03-15]  Liên hệ — Zalo (outbound) — Thắng
              "Xác nhận tham gia S12. Muốn ghép mentee ngành Finance."
[2025-11-01]  Ý định tạm nghỉ — Tạm nghỉ S11, dự kiến quay lại S12
              Lý do: bận dự án nội bộ. Agreed: re-contact Feb 2026.
              [ops_only 🔒]
[2025-01-20]  [Hệ thống] UEHM-S11 — Tạm nghỉ (Paused)
[2024-12-05]  Phản hồi — concern — Feedback từ mentee về tần suất gặp
              → Resolved 2024-12-12: mentor đồng ý tăng tần suất
[2024-06-01]  [Hệ thống] UEHM-S10 — Hoàn thành mentoring (Completed)
[2024-05-15]  8 buổi mentoring · 3 sự kiện tham dự — UEHM-S10
[2023-09-01]  [Hệ thống] UEHM-S10 — Tham gia với vai trò Mentor

[+ Thêm ghi chú]  [+ Thêm action]
─────────────────────────────────────────────────────────────────
```

---

## 8. Match Relationship Timeline Design

The match timeline is a focused view of the relationship between one mentor and one mentee across the duration of a specific match. It surfaces match-linked CRM notes alongside the operational recap record.

### Timeline sources (match-scoped)

```
1. matches record               — pairing itself, status, type, season
2. mentoring_recaps             — all recaps linked to this match_id
3. person_notes                 — notes where linked_match_id = this match
4. activity_correction_log     — corrections made to recaps in this match
```

### Match timeline display (admin UI: `/matches/[id]`)

```
Match: Nguyen A (Mentor) ↔ Tran B (Mentee)
Season: UEHM-S10 | Status: completed | Type: standard
─────────────────────────────────────────────────────────────────
MATCH NOTES (3)

[2024-05-01]  Phản hồi từ Mentee — concern  [ops_only 🔒]
              Mentee báo mentor không phản hồi Zalo 2 tuần
              → Action: Gọi mentor (Linh) — Resolved: mentor xác nhận
[2024-03-10]  Liên hệ Mentor — outbound — Zalo (Thắng)
              "Check-in giữa kỳ. Mentor hài lòng. Mentee tìm internship."
[2023-10-15]  [Hệ thống] Match được tạo — UEHM-S10

─────────────────────────────────────────────────────────────────
RECAP ACTIVITY — 8 buổi

Oct 2023: 1   Nov: 2   Dec: 1   Jan 2024: 1   Feb: 1   Mar: 1   Apr: 1

─────────────────────────────────────────────────────────────────
[+ Thêm ghi chú match]
─────────────────────────────────────────────────────────────────
```

### Match note routing

A note added from the match timeline is automatically linked to `linked_match_id = this match` and `person_id` of the relevant party:

- `feedback_about_mentee` → `person_id` = mentee, linked to match
- `feedback_about_mentor` → `person_id` = mentor, linked to match
- `contact_outbound` (about the match) → `person_id` = the person contacted, linked to match

This ensures the note appears on **both** the mentor's and the mentee's individual person timelines when filtered by `linked_match_id`. The UI on both person pages shows "Ghi chú liên quan đến match với [name]" as a contextual label.

---

## 9. Follow-up and Action Workflow

### Action lifecycle

```
[Note created — e.g. feedback_about_mentee, concern]
    │
    ├── Admin adds action item on the note
    │     action_type = call_back
    │     description = "Gọi mentee xác nhận tình trạng với mentor"
    │     due_date = 2026-05-15
    │     assigned_to = Thắng
    │     status = pending
    │
    ├── Thắng sees it in the action queue
    │
    ├── Thắng makes contact → status = in_progress (optional step)
    │
    └── Thắng marks completed
          status = completed
          completed_at = now()
          resolution_notes = "Mentee xác nhận mentor đã phản hồi đều hơn.
                              Không cần escalate."
```

### Action queue dashboard (admin UI — ops+ scope)

```
Action Queue — UEHM Program (Thắng — Ops)

─────────────────────────────────────────────────────────────────
⚠ OVERDUE (2)
  [Nguyen A]  Gọi xác nhận kế hoạch S12 — Due: 05/01 — Assigned: Linh
  [Tran B]    Follow up re: mentor complaint — Due: 04/25 — Assigned: Thắng

⏰ DUE THIS WEEK (5)
  [Le C]      Gửi link enrollment — Due: 05/12 — Assigned: Linh
  [Pham D]    Re-engagement call — Due: 05/13 — Assigned: Thắng
  ...

📅 UPCOMING (12)
  [Hoang E]   Zalo message — Due: 05/20 — Assigned: Thắng
  ...

─────────────────────────────────────────────────────────────────
Filter: [All types ▾]  [All assignees ▾]  [All people ▾]  [My actions only]
```

### Action types and their intent

| Action type | Typical use |
|------------|-------------|
| `call_back` | Phone or Zalo call required |
| `send_message` | Zalo or email — no call needed |
| `review_with_team` | Bring to next coreteam sync for discussion |
| `escalate` | Escalate to senior coreteam, advisor, or external |
| `confirm_status` | Confirm person's stated intent (e.g. still planning to return?) |
| `send_update` | Inform person of a change related to their feedback |
| `no_action_needed` | Explicitly mark: this note needs no follow-up |
| `other` | Describe in `description` field |

### Overdue detection

Overdue = `due_date < today` AND `status = 'pending'`. Computed at query time. No cron job needed. The queue UI highlights overdue rows in red with day count ("5 ngày quá hạn").

### Handover workflow

When a coreteam member leaves and their relationships must be transferred:

1. Departing member (or supervisor) creates a `handover` note on each affected person
2. Note body includes: relationship summary, key context, agreed commitments, communication style notes
3. Visibility: `team` (so incoming member can read it)
4. Open actions are reassigned: `assigned_to_admin_id` updated to incoming member
5. Incoming member reads the handover note (marked in read log — Phase 2)
6. Incoming member adds their first `contact_outbound` note after their first interaction

---

## 10. Mentor Pause / Off / Re-engagement Workflow

This workflow is the most critical CRM use case. It covers the full arc from pause → dormancy → re-engagement → return or withdrawal, across potentially multiple seasons.

### Stage 1 — Pause recorded (in-season)

**Trigger:** Admin sets `person_season_memberships.status = 'paused'` for a specific season.

**Immediate CRM prompt:**
System shows: "Bạn muốn ghi nhận lý do tạm nghỉ và tạo nhắc nhở follow-up?"

If admin confirms, a `pause_intent` note is pre-populated:
```
note_type = pause_intent
visibility = ops_only  (default — admin can override to team)
subject = "Tạm nghỉ [Season] — [person name]"
Fields to complete:
  pause_reason (free text)
  intended_return_season_id (dropdown: upcoming seasons)
  pause_duration_seasons (integer, if known)
  contact_channel (how this was communicated)
  body (full narrative of the conversation)
linked_membership_id = the paused membership row
```

**Automatic follow-up action created:**
```
action_type = confirm_status
description = "Re-engage trước rollover [intended_return_season]"
due_date = [estimated rollover date for that season — admin sets]
assigned_to = creator
status = pending
```

---

### Stage 2 — Dormancy monitoring

The mentor appears in a "Paused mentors" section on the season management view with:
- Name, last contact date (from most recent `contact_*` note)
- Pause reason
- Intended return season
- Days until their re-engagement action is due
- Overdue indicator if action is past due

During dormancy, coreteam can proactively add contact notes (e.g., "Checked in by Zalo — mentor still planning to return").

---

### Stage 3 — Pre-rollover re-engagement queue

**Trigger:** Admin opens rollover preparation for the upcoming season. System surfaces all mentors with `status = 'paused'` or `opted_out` in the outgoing season whose `intended_return_season_id` matches the upcoming season.

```
Paused Mentor Re-engagement — HAM-S6 → HAM-S7 Preparation

─────────────────────────────────────────────────────────────────
Nguyen A
  Paused: HAM-S6 · Intended return: HAM-S7
  Last contact: 2026-02-10 — Zalo (Thắng) — "Still planning to return"
  Pause reason: Bận dự án Q1
  Open action: "Gọi xác nhận S7" — Due 05/20
  [Log contact] [Mark returning] [Mark withdrawn] [Defer to S8]

Tran B
  Paused: HAM-S6 · Intended return: S7 (unconfirmed — no pause_intent note)
  Last contact: 2025-11-01 — Zalo (Linh)
  ⚠ No pause intent recorded · ⚠ Action overdue 45 days
  [Log contact] [Mark returning] [Mark withdrawn] [Defer to S8]
─────────────────────────────────────────────────────────────────
```

---

### Stage 4 — Contact and outcome recording

Admin contacts each mentor and records outcome:

**Outcome A — Will return this season:**
```
note_type = return_intent
subject = "Xác nhận tham gia HAM-S7"
body = "Anh đồng ý. Muốn ghép mentee ngành Finance."
linked_membership_id = S6 pause membership
intended_return_season_id = HAM-S7
```
Action: auto-create "Confirm inclusion in S7 rollover" — due before rollover date.

**Outcome B — Need one more season (defer):**
```
note_type = pause_intent (extended)
subject = "Tạm nghỉ thêm 1 mùa — dự kiến S8"
intended_return_season_id = HAM-S8
```
Existing re-engagement action updated: due_date = S8 rollover preparation date.

**Outcome C — Permanent withdrawal:**
```
note_type = withdrawal_intent
subject = "Xác nhận không tiếp tục tham gia"
body = "Anh xác nhận không tham gia nữa vì thay đổi công việc."
```
Admin sets `person_season_memberships.status = 'opted_out'` → `system_status_change` note auto-created.

**Outcome D — No response after multiple attempts:**
```
note_type = observation
subject = "Không liên lạc được sau 3 lần thử"
body = "Zalo x2 (05/01, 05/08) + gọi điện (05/10). Không phản hồi."
action_type = review_with_team
description = "Đưa ra cuộc họp — quyết định tiếp tục re-engage hay chuyển sang opted_out"
due_date = [next team sync]
```

---

### Stage 5 — Rollover integration

The rollover proposal screen (from the Season Rollover blueprint) surfaces each paused mentor with their CRM context:

```
Paused Mentors in Rollover Review — HAM-S6 → HAM-S7

─────────────────────────────────────────────────────────────────
Nguyen A
  CRM: return_intent confirmed (2026-04-10, Thắng)
  Last contact: 2026-04-10
  Recommendation: ✓ Include as mentor / invited in HAM-S7
  [✓ Include]   [Exclude]

Tran B
  CRM: No return_intent note · Last contact: 2025-11-01 (no outcome)
  ⚠ Insufficient information — re-engagement action overdue
  Recommendation: ⚠ Contact before deciding
  [Include as invited]   [Mark opted_out]   [Defer]
─────────────────────────────────────────────────────────────────
```

---

### Stage 6 — Returning mentor

If included in S7 as `mentor / invited`:
- `system_rollover` note auto-created: "Included in HAM-S7 rollover as Mentor (invited)"
- Admin confirms acceptance → status = `active` → `system_status_change` note
- CRM timeline now shows the complete arc: S6 active → S6 paused → S7 invited → S7 active
- All pause-period notes remain visible in context with correct season labelling

---

## 11. Integration with Member Lifecycle and Season Rollover

### Integration map

```
Lifecycle Event                          → CRM Response
──────────────────────────────────────────────────────────────────
person_season_memberships INSERT         → system_status_change note (auto)
membership status → 'paused'             → pause_intent note prompt (admin-triggered)
membership status → 'opted_out'          → withdrawal_intent note prompt
membership status → 'graduated'          → system_status_change note (auto)
rollover: person included                → system_rollover note (auto)
rollover: person excluded                → system_rollover note (auto)
match created (matches INSERT)           → system_match_created note (auto)
match status → 'completed' / 'closed'   → system_match_closed note (auto)

CRM Event                                → Lifecycle/Rollover Response
──────────────────────────────────────────────────────────────────
return_intent note created               → flags person in rollover proposal as "confirmed return"
withdrawal_intent note created           → flags person in rollover proposal as "opt-out"
open re_engagement action overdue        → warning shown on rollover proposal for this person
```

### Rollover proposal enrichment

The rollover proposal screen reads the most recent note per person across these types to build its CRM summary column:

```
SELECT DISTINCT ON (person_id)
  note_type, subject, created_at, created_by_admin_id
FROM person_notes
WHERE note_type IN ('pause_intent', 'return_intent', 'withdrawal_intent',
                    'contact_outbound', 'contact_inbound')
  AND linked_season_id = [outgoing_season_id]
ORDER BY person_id, created_at DESC
```

This gives the rollover screen: "Last contact: [date] | Intent: [return / withdraw / unknown]" for every paused mentor — without requiring any new tables.

### Open actions carry across rollover

`person_note_actions` rows are **not season-scoped**. They remain pending until explicitly completed or cancelled. After rollover, the action queue for S7 includes all unresolved actions created during S6, clearly attributed to the season in which they were created (via the parent note's `linked_season_id`).

### Alumni-to-mentor conversion

When a mentee is converted to mentor (from the Lifecycle blueprint), the system creates:
1. `system_status_change` note: "Converted to Mentor for UEHM-S12 — source: Mentee UEHM-S10"
2. Admin is prompted to add a `contact_outbound` note: how and when the conversion was initiated, what the mentor expressed

The full arc becomes visible on the person timeline: mentee history → alumni gap → mentor conversion → mentor active.

---

## 12. Implementation Phases

### Phase 1 — Core CRM (next sprint, staging first)

**Goal:** Team can record notes and see a person timeline. No action workflow yet.

| Task | Scope |
|------|-------|
| Migration 052: create `person_notes` table with all indexes | DB |
| `lib/crm.ts` — createNote, getNotesByPerson, getNotesByMatch helpers | App |
| Visibility enforcement at query layer (server-side, not just UI) | App |
| `/people/[id]` — CRM timeline section added below lifecycle section | UI |
| Note creation form: type, subject, body, visibility, channel, date | UI |
| Timeline: date-sorted, visibility-filtered, season-grouped | UI |
| System note auto-creation on membership status change | App |
| System note auto-creation on match create / close | App |
| 30-minute grace period enforcement (server-side) | App |
| Scope guard: `operations+` required to create `ops_only` / feedback notes | App |

**Not in Phase 1:**
- `person_note_actions` table (no action queue yet)
- Match timeline CRM notes (basic recap view remains)
- Rollover proposal CRM enrichment
- Pause intent prompt automation

**Acceptance criteria:**
- Admin can create a contact note from `/people/[id]`
- Note appears on timeline filtered by correct visibility
- Viewer-level admin cannot see `ops_only` notes (server-enforced)
- System note auto-created on membership status change
- typecheck ✓ · lint ✓ · build ✓

---

### Phase 2 — Action Workflow + Rollover + Match Timeline

**Goal:** Follow-up actions are tracked; rollover surfaces CRM context; match page shows linked notes.

| Task | Scope |
|------|-------|
| Migration 053: create `person_note_actions` table | DB |
| Action creation from note detail or note list | UI |
| Action queue dashboard: my actions, overdue, by program | UI |
| Overdue highlighting (computed, no cron) | UI |
| Assign actions to other admins | UI |
| Complete actions with required resolution notes | UI |
| Pause → pause_intent note prompt on membership status change | UI |
| Pre-rollover re-engagement queue: paused mentors with CRM summary | UI |
| Rollover proposal screen reads latest intent note and open actions | App |
| Rollover confirmation auto-creates `system_rollover` notes | App |
| Match timeline: show `person_notes` where `linked_match_id = this match` | UI |
| `handover` note type + action reassignment workflow | UI |

---

### Phase 3 — Analytics, Bulk Outreach, Self-service

**Goal:** CRM provides aggregate insights; bulk outreach is structured; mentors have limited self-service.

| Task | Scope |
|------|-------|
| Tags on notes (e.g. "re-engagement", "complaint", "endorsement") | DB + UI |
| Full-text search across notes (scoped, visibility-filtered) | UI |
| `person_notes_read_log` for sensitive note read-receipt tracking | DB |
| "Last contacted" column on `/mentors` and `/mentees` list views | UI |
| Cross-season engagement analytics: contact frequency trends | Analytics |
| Feedback sentiment trends per program per season | Analytics |
| Re-engagement campaign table (`mentor_reactivation_campaigns`) | DB |
| Campaign participant tracking (`campaign_participants`) | DB |
| Bulk contact log entry for campaign outreach | UI |
| Re-engagement email/Zalo template generation from CRM context | App |

---

## 13. Risks and Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Private notes become inaccessible when creator leaves | MEDIUM | Institutional knowledge lost | After 90 days without activity, private notes auto-prompt creator to archive or share; super_admin can access in declared emergencies |
| `ops_only` note accidentally shown to reviewer | LOW | Privacy breach | Visibility filter enforced at query layer, not just UI — server-side for every request |
| Note created with wrong person_id | MEDIUM | Confusing timeline | Notes can be archived (status = 'archived') within grace period by creator; full_access+ can archive after |
| Action queue grows unbounded | MEDIUM | Team overwhelmed | Actions older than 90 days with no update auto-flag for "review or cancel" (not auto-closed) |
| Team records PII from external sources in note body | MEDIUM | Privacy / compliance risk | UI warning: "Không ghi thông tin nhạy cảm từ nguồn bên ngoài hệ thống" — policy + training |
| System notes become timeline noise | LOW | UX clutter | System notes visually distinct (lighter weight) and collapsible as a group |
| Admin edits note after grace period via API | LOW | Audit integrity risk | Grace period enforced server-side; edited `updated_at` is logged; after grace period, update endpoint returns 403 |
| Vietnamese text search inaccurate | MEDIUM | Notes hard to find | `subject` field (max 200 chars) is the primary search target — indexed; Phase 3 adds `unaccent` full-text search on `body` |
| Pause intent note not created (admin skips prompt) | HIGH | Missing institutional memory | If membership status = 'paused' and no `pause_intent` note exists, warning shown on rollover proposal: "Không có ghi chú lý do tạm nghỉ" |
| `linked_match_id` notes appear on mentee timeline unexpectedly | MEDIUM | Unintended visibility | Note creator must confirm: "Note này sẽ hiển thị trên cả timeline của [mentor] và [mentee]. Tiếp tục?" |
| Note body contains mentor/mentee email or ID in plain text | MEDIUM | PII in application logs | Ensure note body is never logged in server logs; treated as sensitive payload |

### Trade-off: Single `person_notes` table vs. separate tables per entity

**Option A (chosen):** One `person_notes` table with nullable link columns.
- Pros: one query for the person timeline; one visibility model; one enforcement path; flexible for new link types
- Cons: sparse rows; discipline required on note_type; nullable columns may feel loose

**Option B:** Separate `contact_logs`, `feedback_items`, `intent_records`.
- Pros: cleaner per-table schema; no null columns
- Cons: three union queries for the timeline; three visibility enforcement paths; hard to link a single note that is both a contact and a feedback

Option A is correct at VAM OS scale. The nullable link columns are an accepted trade-off offset by index strategy and strict note_type taxonomy.

### Trade-off: Grace period vs. full immutability

**Full immutability** (no edits ever) is the highest-integrity option but creates UX friction for typo corrections. A **30-minute grace period** is a practical compromise used by many internal tools. It covers typos and accidental submissions without enabling retroactive audit manipulation.

---

## 14. QA Checklist

### Data model QA

```
□ person_notes with invalid person_id FK rejected by DB constraint
□ is_system_generated = true notes cannot be updated by any API call
□ Grace period enforcement: note update rejected after created_at + 30 minutes (server-side)
□ visibility accepts only: private | ops_only | team | system
□ visibility = system accepted only when is_system_generated = true
□ person_note_actions.note_id FK references a valid person_notes row
□ action status accepted only: pending | in_progress | completed | cancelled
□ Actions are not deleted when parent note is archived
□ Actions remain pending after rollover (not auto-cancelled)
```

### Visibility QA

```
□ Admin with read scope: sees team + system notes for scoped program only
□ Admin with read scope: does NOT see ops_only notes (server-enforced, not just UI)
□ Admin with read scope: sees placeholder (not content) for private notes from others
□ Admin with ops+ scope: sees ops_only notes for scoped program only
□ Creator sees their own private notes with lock icon
□ Creator cannot see another admin's private notes (even with full_access)
□ Super_admin: sees all notes except other admins' private notes
□ Notes for HAM person: NOT visible to UEHM-only admin
□ System notes for HAM person: NOT visible to UEHM-only admin
□ Note with linked_match_id: visible on both mentor's and mentee's timelines (filtered)
```

### Note creation QA

```
□ reviewer-scoped admin: can create contact_inbound and program_feedback
□ reviewer-scoped admin: CANNOT create feedback_about_mentor or feedback_about_mentee
□ viewer-scoped admin: CANNOT create any note (returns 403)
□ Minimum required fields: person_id, note_type, subject, body, visibility
□ Missing subject returns validation error
□ visibility = system from manual creation returns validation error
□ Note for person outside admin's scope returns 403 (server-side check)
□ System note creation: triggered by correct lifecycle events; not by direct API call
□ Pause intent prompt: shown when membership status changes to 'paused'
□ Prompt dismissal: note NOT created if admin dismisses (no silent creation)
```

### Action workflow QA

```
□ Action creation requires ops+ scope
□ Action assigned to admin outside this program's team returns validation warning
□ Overdue: action with due_date < today and status = pending shown as overdue in queue
□ Completing an action requires resolution_notes (non-empty)
□ Completed action cannot revert to pending (status is terminal)
□ Cancelled action does not appear in active queue
□ Action queue shows only actions within admin's scoped programs
□ Reassigning action updates assigned_to_admin_id (no duplicate action created)
```

### CRM + Lifecycle integration QA

```
□ Membership status → 'paused': system prompts for pause_intent note
□ Membership status → 'opted_out': system prompts for withdrawal_intent note
□ Rollover confirmation: system_rollover note created for each person processed
□ system_rollover note: linked_season_id = NEW season (not outgoing season)
□ system_status_change note: created for every membership status transition
□ system_status_change note: read-only in UI (no edit or delete controls shown)
□ Rollover proposal: shows last contact date from most recent contact_* note
□ Rollover proposal: shows stated intent from most recent pause/return/withdrawal note
□ Rollover proposal: warns if no pause_intent note exists for a paused mentor
□ Open actions from outgoing season: visible in action queue for new season
□ Open actions: NOT auto-cancelled by rollover confirmation
□ Match creation: system_match_created note auto-created on person timeline
□ Match status → completed: system_match_closed note auto-created
```

### Person timeline QA

```
□ Timeline entries in date descending order (most recent first)
□ System entries visually distinct from manual entries
□ Private note: shows lock icon to creator, shows placeholder to others
□ Open actions: pinned above chronological timeline entries
□ Overdue actions: highlighted differently from on-time actions
□ Filter by note_type returns only matching entries
□ Filter by season returns only entries with linked_season_id = selected season
□ Timeline for HAM person: not visible to UEHM-scoped admin
□ Timeline loads without error for person with zero CRM notes (empty state shown)
```

### Match timeline QA

```
□ Only notes where linked_match_id = this match appear on match timeline
□ Note created from match page: person_id set to mentor (or mentee — confirm on creation)
□ Note created from match page: visible on both mentor and mentee person timelines
□ Match timeline: empty state shown for new match (no notes yet)
□ Recap summary: shows count per month, not raw recap body content
□ Correction log entries: shown distinctly from CRM notes
```

### Security QA

```
□ Notes API endpoint: unauthenticated request returns 401
□ Notes API endpoint: request for out-of-scope person returns 403
□ Note body: never appears in URL parameters or query strings
□ Note body: never logged in server logs (treated as sensitive payload)
□ Action queue: does not expose persons outside admin's scope
□ HAM note created by UEHM-only admin: returns 403 server-side
□ Grace period bypass via API manipulation: returns 403 after grace_period_ends_at
□ system notes: cannot be created via any public API endpoint
□ system notes: cannot be deleted via any API endpoint (no delete route for is_system_generated = true)
```

---

*This document supersedes the v1 planning stub. It is design-only. No migrations have been applied. No code has been written. All implementation should follow existing VAM OS codex conventions: Server Actions for mutations, service-role client for data reads, scope guards on all admin routes, no PII in logs. Implement Phase 1 on staging and confirm with coreteam before production.*
