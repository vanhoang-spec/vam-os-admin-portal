# VAM OS — Member Lifecycle & Season Rollover Blueprint
**Version 1.0 | 2026-05-09 | Design document — no migrations applied**

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Model Assessment](#2-current-model-assessment)
3. [Core Design Principles](#3-core-design-principles)
4. [Role Taxonomy](#4-role-taxonomy)
5. [Status Taxonomy](#5-status-taxonomy)
6. [Proposed Data Model](#6-proposed-data-model)
7. [Season Rollover Workflow](#7-season-rollover-workflow)
8. [Alumni-to-Mentor Conversion Workflow](#8-alumni-to-mentor-conversion-workflow)
9. [Person Profile Timeline](#9-person-profile-timeline)
10. [Permission Implications](#10-permission-implications)
11. [Data Migration Plan](#11-data-migration-plan)
12. [Risks and Trade-offs](#12-risks-and-trade-offs)
13. [Phase 1 / 2 / 3 Roadmap](#13-phase-1--2--3-roadmap)
14. [QA Checklist](#14-qa-checklist)

---

## 1. Problem Statement

VAM OS currently tracks mentors, mentees, and their matches per season. However, it has no model for the **lifecycle of a person across seasons**. A person's journey is more complex than a single role:

- A mentee in S10 may become a supporter in S11 and a mentor in S12.
- A mentor may pause in S11 but return in S12.
- A coreteam member may simultaneously be a mentee.
- A reviewer may be an alumni mentee from three seasons ago.

Without an explicit lifecycle model, VAM OS faces these operational problems:

| Problem | Consequence |
|---------|-------------|
| Mentor pausing requires disabling the mentor profile globally | Mentor cannot be distinguished between "paused this season" and "left the program" |
| No audit trail for role transitions | Cannot answer: "When did Nguyễn A become a mentor?" |
| Former mentees who return as mentors may get duplicate records | Data fragmentation, identity confusion |
| Season rollover is fully manual | Admins must re-enter mentor lists for every new season |
| No concept of "alumni mentee" as a tracked state | Lost community continuity |
| `/mentors` and `/mentees` lists are filtered by intake batch — but mentors don't have batches | Inconsistent filtering logic |

This blueprint proposes a practical, additive model that solves these problems without requiring a rewrite of the existing schema.

---

## 2. Current Model Assessment

### 2a. Existing tables and their purpose

| Table | Current purpose | Lifecycle gap |
|-------|----------------|---------------|
| `people` | Central identity record | ✓ Correct — must remain the single source of truth |
| `mentor_profiles` | Professional profile: company, title, industry, years experience | Not season-specific. No way to mark "paused in S11 only" |
| `mentee_profiles` | Academic profile: school, major, mentee_code | Linked to `intake_batch_id` — season-aware via batch but no explicit status |
| `programs` | Program-level grouping (UEHM, HAM) | ✓ Correct |
| `seasons` | Season within a program (UEHM-S11, HAM-S6) | ✓ Correct, but no "closing" / "closed" status |
| `intake_batches` | Sub-grouping of mentees per season | Used as the de-facto season link for mentees — fragile |
| `matches` | Mentor ↔ mentee pairing per season | ✓ Season-scoped, good |
| `person_roles` | Per-person role tags (purpose unclear at scale) | Appears to be global, not season-scoped |
| `mentor_program_participations` | Mentor × program status | Program-level only, no season granularity; used for mentor listing |
| `operational_team_assignments` | Coreteam assignments | Has `assigned_scope` but lacks formal season linkage |

### 2b. Key structural gaps

1. **No season-level membership table** — there is no single place to record "person P held role R in season S with status X."

2. **Mentor pausing is global** — `mentor_program_participations.status` is per-program, not per-season. Marking a mentor inactive removes them from the entire program, not just one season.

3. **Mentee graduation is implicit** — there is no record that a mentee "graduated" from a season. They simply stop appearing in active matches. Alumni status is not tracked.

4. **`intake_batches` is doing double duty** — it groups mentees for import purposes AND serves as the season-link for mentee profiles. Season rollover would require creating new batches just to link profiles, which is structurally awkward.

5. **No transition audit** — there is no log of "person A transitioned from mentee to supporter on [date] in S12."

6. **Multi-role support is absent** — a person who is simultaneously a reviewer and a mentee in the same season has no clean representation.

### 2c. What is working well and must be preserved

- `people` as the central identity — **do not add role logic to this table**
- `mentor_profiles` as the professional profile container — keep this; it's a one-time profile, not per-season
- `mentee_profiles` as the academic profile snapshot — keep this; it captures the person's academic context at time of application
- `matches` as the season-scoped pairing record — keep this; it's the ground truth for mentoring activity
- `mentoring_recaps` as the activity log — keep this
- Program-scoped access in `admin_scope_access` — this is the **system permission layer**, entirely separate from community roles

---

## 3. Core Design Principles

**P1 — One person record, forever**
A person never gets a new people row when their role changes. All transitions link back to the same `people.id`. This is non-negotiable.

**P2 — Community roles and system permissions are separate systems**
`person_season_memberships.role` (community role: mentee, mentor, supporter) is never used to derive system access. System access is always explicit in `admin_scope_access`. No automatic permission grants from community role changes.

**P3 — Season is the unit of lifecycle**
Every role a person holds is scoped to a season. "Mentor" is meaningless without "mentor in UEHM-S12." "Paused" is meaningless without "paused in HAM-S7."

**P4 — The new table is additive, not replacive**
`person_season_memberships` adds a new layer of truth. It does not replace `mentor_profiles`, `mentee_profiles`, or `matches`. Those tables continue to serve their current purposes.

**P5 — Rollover is always admin-confirmed, never fully automatic**
The system may propose a rollover roster, but a human must confirm it before any data is written. Automation is a suggestion engine, not an action executor.

**P6 — Multiple roles per person per season are valid**
A person can be `(supporter, active)` and `(reviewer, active)` in the same season. These are separate rows in `person_season_memberships`. There is no limit on role combinations.

**P7 — All transitions are auditable**
Every status change in `person_season_memberships` records who changed it, when, and why (notes field). No silent overwrites.

---

## 4. Role Taxonomy

These are **community roles** — they describe a person's participation in the program, not their system permissions.

### Primary participation roles

| Role | Description | Who holds it |
|------|-------------|-------------|
| `mentee` | Active mentee in this season | Accepted mentee applicants |
| `mentor` | Active mentor in this season | Confirmed mentors for this season |
| `supporter` | Community supporter — contributes without formal mentoring | Alumni mentees, former mentors who stay involved |

### Program-operation roles

| Role | Description | Who holds it |
|------|-------------|-------------|
| `reviewer` | Reviews mentee/mentor applications | Alumni, coreteam, designated reviewers |
| `interviewer` | Conducts selection interviews | Subset of reviewers |
| `coreteam` | Runs program operations | Full-time program staff and key volunteers |
| `advisor` | Senior advisor to the program | Board members, senior alumni |

### Historical / informational roles

| Role | Description | Who holds it |
|------|-------------|-------------|
| `alumni_mentee` | Explicitly marked as graduated from this season | Former mentees — added during rollover |
| `guest` | Attended events, no formal program role | Walk-ins, one-time event participants |

### Role rules

- A person may hold **multiple roles** in the same season (e.g., `supporter` + `reviewer`).
- `alumni_mentee` is added to the **graduating season**, not the next season. It is a record of what happened, not a forward-looking role.
- `mentor` and `mentee` may coexist in theory (e.g., HAM alumni who mentor while in a related program). This is unusual but must not be prevented at the data layer.
- Roles are **season-scoped**. "Mentor" without a season is not a valid entry in `person_season_memberships`.

---

## 5. Status Taxonomy

Status describes the **state of a person's participation** within a specific season and role.

| Status | Meaning | Applies to |
|--------|---------|-----------|
| `invited` | Nominated or invited, not yet confirmed | All roles |
| `active` | Confirmed participant, currently engaged | All roles |
| `paused` | Temporarily paused — will return (season-specific) | `mentor`, `coreteam` |
| `withdrawn` | Left mid-season — not returning this season | All roles |
| `completed` | Finished the season in good standing | `mentor`, `supporter`, `coreteam` |
| `graduated` | Mentee completed their mentoring journey this season | `mentee` only |
| `opted_out` | Explicitly declined to carry forward to next season | `mentor`, `supporter` |
| `cancelled` | Removed by admin (conduct, admin error, duplicate) | All roles |

### Status transition rules

```
invited     → active         (admin confirms participation)
invited     → cancelled      (not accepted or admin cancels)
active      → paused         (mentor requests pause — season-specific)
active      → withdrawn      (leaves mid-season)
active      → completed      (season ends, mentor/coreteam/supporter completes)
active      → graduated      (season ends, mentee completes)
paused      → active         (returns from pause)
paused      → withdrawn      (paused, then confirms withdrawal)
completed   → [next season]  (rollover creates new active row in next season)
graduated   → [next season]  (rollover creates alumni_mentee row; optionally supporter/mentor row)
opted_out   → [skipped]      (no row created in next season for this role)
```

### The "paused" distinction

`paused` is the most important new status for mentor management. It means:
- The mentor is still a registered mentor in the program
- They are not available for matching **this season**
- They should be **offered** an active slot in the next season (not automatically assigned)
- Their mentor profile (company, expertise, history) is preserved
- Their past matches and recaps are not affected

This replaces the current practice of setting `mentor_program_participations.status = 'inactive'`, which cannot be distinguished from permanent withdrawal.

---

## 6. Proposed Data Model

### 6a. New table: `person_season_memberships`

This is the cornerstone of the lifecycle model. It records every person's role and status within each season.

```
Table: person_season_memberships

Column                  Type            Constraints / Notes
──────────────────────  ──────────────  ───────────────────────────────────────────────────
id                      uuid            PRIMARY KEY, default gen_random_uuid()
person_id               uuid            NOT NULL, FK → people.id
season_id               uuid            NOT NULL, FK → seasons.id
program_id              uuid            NOT NULL, FK → programs.id  [denormalized for scope queries]
role                    text            NOT NULL  [see role taxonomy]
status                  text            NOT NULL  DEFAULT 'active'  [see status taxonomy]
source_role             text            nullable  [previous role that led to this, e.g. 'mentee_s10']
source_season_id        uuid            nullable  FK → seasons.id  [season of source_role]
notes                   text            nullable  [reason for status, free text]
created_at              timestamptz     NOT NULL  DEFAULT now()
updated_at              timestamptz     NOT NULL  DEFAULT now()
created_by_admin_id     uuid            nullable  FK → admin_users.id
updated_by_admin_id     uuid            nullable  FK → admin_users.id

UNIQUE (person_id, season_id, role)
  — one row per person × season × role
  — a person may have multiple rows in the same season for different roles
```

**Indexes:**
- `(season_id, role, status)` — for season roster queries
- `(person_id)` — for person timeline queries
- `(program_id, season_id)` — for program-scoped admin views

### 6b. New columns on `seasons` table

```
season_status           text    DEFAULT 'active'
  — values: 'planning', 'active', 'closing', 'closed'
  — 'closing' triggers the rollover workflow prompt in admin UI
  — 'closed' is the terminal state

rollover_from_season_id uuid    nullable FK → seasons.id
  — links each season to the one it was rolled over from
  — enables auditable rollover chain: S10 → S11 → S12

closed_at               timestamptz  nullable
  — set when status transitions to 'closed'
```

### 6c. New table: `person_season_membership_log`

Audit trail for every status change. This is write-only — rows are never updated or deleted.

```
Table: person_season_membership_log

Column              Type            Notes
──────────────────  ──────────────  ─────────────────────────────────────────────
id                  uuid            PRIMARY KEY
membership_id       uuid            NOT NULL, FK → person_season_memberships.id
person_id           uuid            NOT NULL  [denormalized for direct queries]
season_id           uuid            NOT NULL  [denormalized]
role                text            NOT NULL
old_status          text            nullable  [null for creation events]
new_status          text            NOT NULL
changed_by_admin_id uuid            nullable
reason              text            nullable
changed_at          timestamptz     NOT NULL  DEFAULT now()
```

### 6d. Relationship to existing tables

```
people (1)
  └── person_season_memberships (many — one per season per role)
      └── person_season_membership_log (many — audit trail)
  └── mentor_profiles (0 or 1 — professional profile, global)
  └── mentee_profiles (0 or many — academic profile per batch)
  └── matches (many — as mentor or mentee, season-scoped)
  └── mentoring_recaps (many — activity logs)
  └── event_participations (many — attendance records)
  └── event_registrations (many — event sign-ups)
```

`mentor_profiles` continues to exist as the **professional profile** (company, title, industry). It is not season-specific and does not need to change. Season-specific mentor status lives in `person_season_memberships`.

`mentee_profiles` continues to exist as the **academic profile snapshot** (school, major). It is linked to `intake_batch_id`. This is appropriate — the academic profile at time of application is batch-specific. Season membership is tracked separately in `person_season_memberships`.

### 6e. What replaces what

| Old approach | New approach |
|-------------|-------------|
| `mentor_program_participations.status = 'inactive'` to pause a mentor | `person_season_memberships` row with `status = 'paused'` for specific season only |
| No alumni tracking | `person_season_memberships` row with `role = 'alumni_mentee'`, `status = 'graduated'` in graduating season |
| Manual re-entry of mentors each season | Rollover workflow generates next-season rows from completed rows |
| Multi-role via separate profile tables | Multiple rows in `person_season_memberships` for same person × season |
| No transition audit | `person_season_membership_log` captures every status change |

---

## 7. Season Rollover Workflow

### Overview

The rollover is a structured, admin-confirmed process. It is never automatic. The system proposes; the admin decides.

### Workflow: HAM-S6 → HAM-S7 (or UEHM-S11 → UEHM-S12)

#### Step 1 — Mark season as closing

Admin action: set `seasons.season_status = 'closing'` for the outgoing season (e.g. HAM-S6).

System response:
- Admin UI shows a "Start Rollover" banner on the HAM-S6 season detail page.
- No data changes yet.

---

#### Step 2 — System generates rollover proposal

When admin clicks "Start Rollover," the system reads the current active memberships in HAM-S6 and constructs a proposal. No data is written at this step.

**Proposal rules by role:**

| Current role in S6 | Current status | Default proposal for S7 |
|--------------------|---------------|-------------------------|
| `mentor` | `active` or `completed` | Include as `mentor / active` in S7 |
| `mentor` | `paused` | Include as `mentor / invited` in S7 — admin must confirm |
| `mentor` | `withdrawn` or `opted_out` | **Exclude** from S7 — do not include by default |
| `mentee` | `active` or `graduated` | Mark as `alumni_mentee / graduated` in S6. Offer optional `supporter / active` in S7 |
| `mentee` | `withdrawn` | Mark as `alumni_mentee / withdrawn` in S6. No S7 row by default |
| `supporter` | `active` or `completed` | Include as `supporter / active` in S7 |
| `supporter` | `opted_out` | Exclude |
| `coreteam` | `active` | Include as `coreteam / active` in S7 |
| `reviewer` | `active` | Offer as `reviewer / active` in S7 — admin confirms per person |
| `alumni_mentee` | any | No action — informational rows do not roll over |

**Proposal output (admin review screen):**

```
Rollover Proposal: HAM-S6 → HAM-S7

──────────────────────────────────────────────────────────
Carrying forward (default: include)          48 mentors
  ✓ Nguyen A — mentor → mentor (active)
  ✓ Tran B  — mentor → mentor (active)
  ⚠ Le C   — mentor (paused) → mentor (invited) — review required
  ...

──────────────────────────────────────────────────────────
Graduating (default: alumni_mentee)          58 mentees
  All 58 mentees → alumni_mentee / graduated in S6
  Offer supporter role in S7?  [Select all] [Deselect all]
  ☐ Pham D — add as supporter in S7?
  ☐ Hoang E — add as supporter in S7?
  ...

──────────────────────────────────────────────────────────
Exclusions (withdrawn / opted-out)            3 mentors
  Bui F — opted_out — not included in S7
  ...

──────────────────────────────────────────────────────────
                              [Save as Draft] [Confirm Rollover]
```

---

#### Step 3 — Admin reviews and edits

Admin can:
- Remove any mentor from the carry-forward list (opt them out)
- Add individual mentees as supporters in S7
- Promote individual alumni to reviewer or coreteam in S7
- Change proposed status (e.g., demote from `active` to `invited` for any new entrant)
- Add notes for each decision

---

#### Step 4 — Admin confirms rollover

When admin clicks "Confirm Rollover":

1. All `active` rows in S6 for non-mentor roles transition to `completed` or `graduated`
2. `alumni_mentee / graduated` rows are written to S6 for each graduating mentee
3. Carry-forward mentor rows are written to S7 as `mentor / active` (or as specified)
4. Optional supporter rows are written to S7 for selected alumni
5. A new `seasons` row for HAM-S7 is created with `rollover_from_season_id = HAM-S6.id`
6. `person_season_membership_log` records all transitions with `changed_by_admin_id` and timestamp
7. S6 status transitions to `closed`

**What is NOT created automatically by rollover:**
- New intake batch for S7 (created separately when new mentee applications open)
- New matches for S7 (matching is a separate workflow)
- New mentor profiles for returning mentors (they keep their existing profile)
- System access grants (admin_scope_access is never auto-modified)

---

#### Step 5 — New season begins

- S7 is `active`, populated with carry-forward mentor rows and optional supporter rows
- New mentee batch is created manually when applications open
- Matching process begins using the S7 mentor pool (drawn from `person_season_memberships` where season=S7, role=mentor, status=active)
- S6 is `closed` and read-only

---

## 8. Alumni-to-Mentor Conversion Workflow

This workflow handles the case where a former mentee wants to become a mentor in a future season.

### Preconditions
- Person already exists in `people` (they registered as a mentee in a previous season)
- They may or may not have a `mentor_profile` row (probably not, if they were only ever a mentee)

### Step-by-step

**Step 1 — Identify the person**

Admin searches `/people` for the alumni mentee. Their profile shows:
- Past seasons as mentee (from `person_season_memberships`)
- Most recent status: `alumni_mentee / graduated` in S10

**Step 2 — Create mentor profile (if not exists)**

Admin navigates to `/mentors/create`, selects "Link to existing person" (rather than creating a new person), and fills in the professional profile fields:
- Current company, title
- Years of experience
- Industry and function area

This creates a `mentor_profiles` row linked to the existing `people.id`. No new `people` row is created.

**Step 3 — Add season membership**

Admin adds a `person_season_memberships` row:
- `person_id` = existing person
- `season_id` = target season (e.g., UEHM-S12)
- `role` = `mentor`
- `status` = `active`
- `source_role` = `mentee`
- `source_season_id` = their graduating season (e.g., UEHM-S10)
- `notes` = "Alumni mentee from S10 — first season as mentor"

**Step 4 — Person appears in mentor pool**

The person is now visible in the S12 mentor list. Their profile shows both their mentee history and their new mentor profile. The admin can proceed with matching.

**Step 5 — History is preserved**

On the person's profile timeline:
```
UEHM-S10   mentee      → graduated
UEHM-S11   alumni_mentee (no active role)
UEHM-S12   mentor      → active  [source: alumni mentee from S10]
```

No data is lost. The mentoring recaps from their time as a mentee remain. Their mentor profile is new but linked to the same person.

---

## 9. Person Profile Timeline

The timeline is constructed by the application layer — it does not require a separate table. It aggregates from existing data.

### Timeline sources (in chronological order)

```
person_season_memberships
  — "Season: UEHM-S10 | Role: mentee | Status: graduated"
  — "Season: UEHM-S11 | Role: alumni_mentee | Status: graduated"
  — "Season: UEHM-S12 | Role: mentor | Status: active"

matches (as mentee or mentor)
  — "UEHM-S10: matched with Mentor Nguyen A (active)"
  — "UEHM-S12: matched with Mentee Tran B (active)"

mentoring_recaps (counts per season)
  — "UEHM-S10: 8 recaps as mentee"
  — "UEHM-S12: 3 recaps as mentor (season in progress)"

event_participations (count per season)
  — "UEHM-S10: 4 events attended"
  — "UEHM-S12: 1 event attended"

person_season_membership_log (status transitions)
  — "2024-01-15: mentee → graduated (UEHM-S10 ended)"
  — "2026-02-01: mentor added for UEHM-S12 (alumni conversion)"
```

### Timeline display (admin UI, `/people/[id]`)

```
Person: Nguyen Thi A
──────────────────────────────────────────────────────────
UEHM-S10  (2024)
  Role: Mentee           Status: Graduated  ✓
  Mentor: Tran Van B
  Activity: 8 recaps · 4 events
  Mentee profile: School X, Major Y

UEHM-S11  (2025)
  Role: Alumni Mentee    (no active role this season)

UEHM-S12  (2026 — current)
  Role: Mentor           Status: Active  ●
  Mentee: Pham C  (current match)
  Activity: 3 recaps · 1 event
  Mentor profile: Company Z, Title Q, Industry R
──────────────────────────────────────────────────────────
```

### Timeline rules

- Seasons are shown in chronological order regardless of program.
- If a person has roles in multiple programs in the same season, both are shown.
- `alumni_mentee` rows are shown as informational (no active match expected).
- The timeline is read-only. Changes are made through the membership management workflow, not inline on the timeline.

---

## 10. Permission Implications

### The separation principle

```
Community role (person_season_memberships.role)
  ≠
System permission (admin_scope_access.role + admin_users.role)
```

These two systems are completely independent. Assigning someone the community role of `coreteam` does NOT automatically grant them system access. Granting system access does NOT automatically create a `person_season_memberships` row.

### When community roles may inform permission decisions

Some role transitions may prompt an admin to also update system permissions:

| Community transition | Possible (not automatic) system action |
|---------------------|----------------------------------------|
| Mentee → Coreteam | Admin may add `admin_scope_access` entry with `operations` scope |
| Alumni → Reviewer | Admin may add `admin_scope_access` entry with `review` scope |
| Coreteam leave | Admin may remove `admin_scope_access` entry |
| Mentor pause | No system action needed — mentor portal access (future) handled separately |

**Rule:** The admin must take these system permission actions explicitly. The rollover workflow and membership transitions are designed to never touch `admin_scope_access` automatically.

### Future: mentor self-service portal

When a mentor portal is built (Phase 3+), mentors will need a login. At that point:
- A mentor's `person_season_memberships` entry with `role = 'mentor'` and `status = 'active'` may be used to determine portal access
- This will require a new access mechanism separate from `admin_scope_access`
- Design this at the time — do not pre-build hooks now

### Read-only implications for admin roles

- Admin with `read` scope on a season can view `person_season_memberships` for that season
- Admin with `operations` scope can add, edit, and transition membership rows
- Admin with `full_access` or `super_admin` can perform rollover
- No admin can modify `person_season_membership_log` (audit records are insert-only)

---

## 11. Data Migration Plan

The migration is **additive and non-destructive**. Existing tables are not modified. `person_season_memberships` is seeded from existing data.

### Migration 051 (proposed)

```
Add to seasons: season_status, rollover_from_season_id, closed_at
Create: person_season_memberships
Create: person_season_membership_log
```

### Backfill strategy

After the migration is applied, run a one-time backfill script (staging first, then production after review):

**Backfill mentees from mentee_profiles + intake_batches:**
```
For each mentee_profile:
  Find the season via intake_batch.season_id
  If a match exists for this person in that season:
    status = 'graduated' (best inference — they completed)
  Else:
    status = 'completed' (no match, but profile exists — enrolled)
  Insert person_season_memberships(person_id, season_id, program_id, role='mentee', status)
```

**Backfill mentors from mentor_profiles + matches:**
```
For each distinct (mentor_person_id, season_id) in matches:
  If match.status = 'active' and season is current:
    status = 'active'
  Else if match.status in ('completed', 'closed'):
    status = 'completed'
  Else:
    status = 'completed'  (default — they did participate)
  Insert person_season_memberships(mentor_person_id, season_id, program_id, role='mentor', status)
```

**Backfill from mentor_program_participations:**
```
For any mentor with program_participations.status = 'paused' or 'inactive'
  and no active match in the current season:
    Insert with status = 'opted_out' or 'paused' as appropriate
    Requires manual review — flag for admin confirmation
```

**Important:**
- Backfill is idempotent: use `INSERT ... ON CONFLICT DO NOTHING`
- Run backfill on staging, review output, confirm counts match expected people/mentor/mentee totals, then apply to production
- After backfill, existing `mentor_program_participations` is retained (not deleted) until team confirms `person_season_memberships` is the authoritative source

### Transition plan for data ownership

| Phase | Authority for mentor status | Authority for mentee status |
|-------|-----------------------------|------------------------------|
| Now (pre-migration) | `mentor_program_participations` | `mentee_profiles.intake_batch_id` |
| Phase 1 (post-migration) | Both — `person_season_memberships` is additive, not yet primary | Both |
| Phase 2 | `person_season_memberships` is primary; `mentor_program_participations` is legacy/read | `person_season_memberships` is primary |
| Phase 3 | `mentor_program_participations` may be deprecated | `mentee_profiles` retained for academic profile only |

---

## 12. Risks and Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Backfill infers wrong status for historical records | MEDIUM | Data quality degraded | Mark all backfilled rows with `notes = 'backfill — inferred'`; admin review queue |
| Admin accidentally triggers rollover before season is truly complete | MEDIUM | Incorrect graduation records | Two-step confirmation + rollback script that can delete all S(n+1) rows created in a single rollover |
| Duplicate person_season_memberships rows from bad backfill | LOW | Overcounting in KPIs | UNIQUE constraint on (person_id, season_id, role) prevents duplicates at DB level |
| Mentor opt-out not captured → incorrectly carried forward | MEDIUM | Mentor receives S7 match against their wishes | Default carry-forward list is a proposal only; mentor portal (future) will add self-service opt-out |
| person_season_memberships grows very large over many seasons | LOW | Query performance | Season-scoped indexes on (season_id, role, status); old seasons are rarely queried at full depth |
| Community role displayed as system permission | LOW | Security confusion | UI must clearly label: "Vai trò cộng đồng" vs "Quyền hệ thống" — never merge the two displays |
| Vietnamese name collision causes wrong alumni-to-mentor link | MEDIUM | Wrong person gets mentor profile | Always link by people.id (UUID), never by name. Search by email/phone first. |
| Rollover run twice by mistake | LOW | Duplicate rows in next season | UNIQUE constraint blocks duplicate (person_id, season_id, role) rows; second run fails cleanly |
| Season rollover and intake open simultaneously | MEDIUM | S7 mentor pool incorrect during matching | Lock rollover confirmation before opening intake batch |
| `mentor_program_participations` and `person_season_memberships` diverge | MEDIUM | Conflicting truth | Define a clear Phase 2 cutover date; communicate to team which table is authoritative |

### Trade-off: Why not just extend mentor_profiles?

Adding `season_id` to `mentor_profiles` would make it season-specific, but:
- A mentor's professional profile (company, title, experience) does not change per season
- It would require creating a new profile row each season — redundant data
- Existing queries using `mentor_profiles` for professional display would break
- `person_season_memberships` is more flexible: it handles all roles, not just mentors

### Trade-off: Why not put roles directly on people?

Adding a `current_role` column to `people` would be simpler but:
- It cannot represent multiple simultaneous roles
- It has no season context
- It has no history (overwrites on change)
- It conflates the identity record with operational state

### Trade-off: person_season_memberships vs season_participants

Both names describe the same concept. `person_season_memberships` is preferred because:
- "Membership" implies an ongoing relationship, not just attendance at one season
- It aligns with how the team talks about the program ("thành viên", not just "người tham gia")
- It is explicitly person-centric, consistent with the P1 principle

---

## 13. Phase 1 / 2 / 3 Roadmap

### Phase 1 — Foundation (next sprint)

**Goal:** The data model exists and is populated. Basic visibility in admin UI.

| Task | Scope |
|------|-------|
| Migration 051: add `season_status`, `rollover_from_season_id`, `closed_at` to seasons | DB |
| Migration 051: create `person_season_memberships` | DB |
| Migration 051: create `person_season_membership_log` | DB |
| Backfill script: seed memberships from mentee_profiles + matches + mentor_profiles | Data |
| Run backfill on staging, review, apply to production | Data |
| `/people/[id]` — add Season Membership timeline section | UI |
| `/people/[id]` — admin can manually add/edit memberships | UI |
| `lib/member-lifecycle.ts` — helper functions for membership queries | App |
| No rollover UI yet — rollover is manual (admin adds rows per person) | — |

**Acceptance criteria:**
- Every person who has a match or profile has at least one `person_season_memberships` row
- Timeline visible and correct on 5 test person profiles
- typecheck ✓ lint ✓ build ✓

---

### Phase 2 — Rollover Workflow (following sprint)

**Goal:** Admins can run a season rollover with system-proposed, admin-confirmed logic.

| Task | Scope |
|------|-------|
| `seasons` management page: set `season_status`, trigger rollover | UI |
| Rollover proposal engine: generate draft S(n+1) memberships from S(n) | App |
| Rollover review screen: table of proposed transitions, with checkboxes | UI |
| Rollover confirmation: write approved rows, log all transitions | App + DB |
| `person_season_memberships` becomes primary source for `/mentors` and `/mentees` season filter | App |
| Mentor pause workflow: admin can set `status = 'paused'` for a specific season | UI |
| Alumni-to-mentor conversion UI: "Convert to mentor" on person detail page | UI |
| `mentor_program_participations` marked as legacy; still read but not written | App |

**Acceptance criteria:**
- UEHM-S11 → S12 rollover runs in full on staging with correct proposed roster
- Pausing a mentor for S12 does not affect their S11 history
- Alumni-to-mentor conversion tested on 3 historical mentees
- Rollover can be repeated on staging without creating duplicate rows (UNIQUE constraint holds)

---

### Phase 3 — Self-service & Analytics (later)

**Goal:** Mentors have agency over their own status. Program analytics use lifecycle data.

| Task | Scope |
|------|-------|
| Mentor opt-out form (public, no login): mentor can opt out via link | Public |
| Cross-season participation analytics: how many mentors returned for 2+ seasons? | Analytics |
| Alumni funnel: mentee → supporter → mentor conversion rates | Analytics |
| Seasonal KPIs on program dashboard: graduation rate, mentor retention rate | UI |
| `mentor_program_participations` fully deprecated (if team agrees) | DB |
| Mentor portal: self-service profile update, availability for next season | Mentor portal |
| Export: season roster export to CSV for external coordination | Admin |

---

## 14. QA Checklist

### Data model QA

```
□ person_season_memberships UNIQUE constraint on (person_id, season_id, role) is enforced
□ Inserting a duplicate (person, season, role) returns a clear error, not silent ignore
□ person_season_membership_log is append-only (no UPDATE/DELETE permissions granted)
□ Backfill counts: mentee rows ≥ count of unique mentee_profiles
□ Backfill counts: mentor rows ≥ count of unique (mentor_person_id, season_id) in matches
□ No person_season_memberships row exists without a valid people.id FK
□ No person_season_memberships row exists without a valid seasons.id FK
□ program_id on each row matches the program of the referenced season
```

### Lifecycle logic QA

```
□ Graduating a mentee creates: (role=mentee, status=graduated) in current season
□ Graduating a mentee does NOT delete their mentee_profile or matches
□ Pausing a mentor for S12 does NOT change their S11 membership row
□ Pausing a mentor does NOT remove them from the historical mentor list
□ Opt-out: mentor is not included in rollover proposal for next season
□ Opt-out: mentor's completed status in current season is preserved
□ Alumni-to-mentor: person has one people row before and after conversion
□ Alumni-to-mentor: mentee history is visible on the same person profile
□ Alumni-to-mentor: creating a mentor_profile for an alumni does not create a new people row
□ Multi-role: a person with (mentor, active) and (reviewer, active) in same season has 2 rows
□ Multi-role: both roles display correctly on the person timeline
```

### Rollover workflow QA

```
□ Rollover proposal is generated correctly for a test season with:
    — 10 active mentors
    — 5 paused mentors
    — 20 active mentees
    — 3 withdrawn mentors
□ Withdrawn mentors are excluded from proposal by default
□ Opted-out mentors are excluded from proposal by default
□ Paused mentors appear as 'invited' (not 'active') in proposal
□ Admin can remove a mentor from proposal before confirming
□ Admin can add an alumni as supporter in next season during rollover
□ Confirming rollover writes exactly the correct number of new rows
□ Confirming rollover does NOT touch admin_scope_access
□ Confirming rollover does NOT touch mentor_profiles or mentee_profiles
□ Running rollover twice on staging produces no additional rows (UNIQUE constraint blocks)
□ After rollover, previous season status = 'closed'; new season status = 'active'
```

### Security and permission QA

```
□ Admin with 'read' scope can view season memberships but cannot create or edit
□ Admin with 'operations' scope can add/edit memberships for their scoped seasons only
□ Admin cannot view memberships for seasons outside their scope
□ person_season_membership_log entries cannot be edited or deleted by any admin role
□ Community role field (mentor, mentee, supporter) is never used in admin_scope_access lookups
□ Rollover confirmation requires 'full_access' or 'super_admin' scope
□ No automatic system permission changes occur during any lifecycle transition
```

### Regression QA (existing features must not break)

```
□ /matches — existing match queries unaffected by new tables
□ /mentors — mentor list still loads correctly (currently from mentor_program_participations)
□ /mentees — mentee list still loads correctly (currently from intake_batches)
□ /operations — KPIs unaffected
□ /people/[id] — existing data still displays; timeline section is additive
□ Scoped access — UEHM admin cannot see HAM season memberships
□ typecheck ✓ · lint ✓ · build 36/36 ✓
```

---

*This document is design-only. No migrations have been applied. No code has been written. All implementation should follow existing VAM OS codex conventions and be applied to staging first for review before production.*
