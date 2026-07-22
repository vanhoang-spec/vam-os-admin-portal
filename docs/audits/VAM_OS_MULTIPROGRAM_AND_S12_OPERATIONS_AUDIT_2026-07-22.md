# VAM OS Multi-program & Season 12 Operations Audit

Audit date: 2026-07-22
Baseline: `37e0b36460bc800fbb46d636cc955aed3f9b0f7d` (`main`, PR #1 merge)
Audit branch: `phase-5-multiprogram-operations-audit`
Scope: static code/schema/workflow audit only. No migration, seed, production mutation, notification, or runtime workflow change was performed.

## 1. Executive Summary

VAM OS already has a credible multi-program foundation, but it is not yet a safe, complete multi-program product. The canonical catalog is `programs -> seasons -> intake_batches`; migration 036 seeds UEHM and HAM as separate **programs**, not organizations. A global `people` record can be reused across programs, mentor-to-program membership exists, and migration 052 adds a program/season-aware lifecycle membership with scope-consistency and append-only history.

The main gaps are orchestration and enforcement. There is no institution/organization entity, no shared program/season/batch context selector, no portfolio dashboard, and no program creation workflow. Several primary dashboards and public recruitment entry points still use the global constants in `lib/season-config.ts`. Scope filtering exists in `lib/program-scope.ts` and much of `lib/data.ts`, but `admin_scope_access` stores mixed text IDs/codes and some service-role-backed paths depend on application guards rather than database RLS. Migration 052 explicitly leaves RLS for lifecycle and CRM tables to a later design. This is a P0 isolation concern before broad HAM/UEH admin access is enabled.

Season 12 mentee recruitment is **partially operational**: public forms, token/feature gates, application records, review assignment, reviewer workload, interview self-claim, decisions, approval-to-profile conversion, audit rows, and S12 batch linkage exist. Missing or incomplete areas include a recruitment campaign entity, configurable public links per program/season/batch, draft applications, scheduling slots/self-booking, acceptance confirmation, onboarding/matching-ready state, reliable transactional approval, and notification orchestration. Mentor recruitment reuses much of the same path, but rollover has schema primitives only and no dedicated workflow/UI.

Recommendation: **Security/data isolation blocker must be fixed first.** Begin Batch 5A only after owner decisions on organization/program semantics and portfolio PII access. Batch 5A should first normalize context and enforce program/season scope; the portfolio UI should follow in the same batch after isolation tests pass.

Evidence anchors: `supabase_migrations/036_mentor_taxonomy_and_programs.sql` (program catalog and hierarchy), `supabase_migrations/052_phase1a_member_lifecycle_crm_foundation.sql` (membership model and stated RLS omission), `lib/program-scope.ts` (`getAdminScopeContext`, `getScopeFilter`), `lib/season-config.ts`, `lib/data.ts`, `middleware.ts`, and `__tests__/permissions.test.ts`.

## 2. Current Architecture

### 2.1 Runtime and access architecture

- Next.js App Router with server-rendered pages and server actions (`app/**/page.tsx`, `app/actions/*.ts`).
- Supabase Auth provides identity; an active `admin_users` row is required by `middleware.ts::hasActiveAdminUser`. The shared-password unlock gate is only an outer MVP gate, not authorization.
- Server reads/writes primarily use Supabase through `lib/data.ts`, domain services, and a service-role client (`lib/supabase-server.ts`). Because service role bypasses RLS, every such path must enforce scope in code.
- Global roles are `viewer`, `reviewer`, `support_team`, `core_team`, `admin`, and `super_admin` (`lib/auth-constants.ts::ADMIN_ROLES`). Program/season grants use `admin_scope_access` and levels `read`, `review`, `operations`, `full_access` (`lib/program-scope.ts`).
- Scope is resolved to allowed UUIDs by loading `programs` and `seasons`; legacy grants may contain either code or UUID text (`supabase_migrations/020_admin_scope_access_schema_alignment.sql`).
- No generated Supabase database-types file is present. `lib/types.ts` uses `JsonRecord & {...}` shapes, reducing compile-time protection against schema drift.

### 2.2 Route inventory

“Scoped” below means a route calls `getAdminScopeContext/getScopeFilter` or a scoped data service. “Global role” means access is role-gated but not selected through a program workspace.

| Route/group | Access | Program/season scope | Function | Completion | Main issue |
|---|---|---|---|---|---|
| `/` | Active admin | Scoped reads, then fixed operating season | Overview/KPIs/reconciliation | Partial | No portfolio mode or selector; fixed `CURRENT_OPERATING_SEASON_CODE` (`app/page.tsx`) |
| `/operations` | Active admin; edit by operations role | Scoped reads, fixed operating season | Monthly operational KPI/activity | Partial | One global season; no program workspace (`app/operations/page.tsx`) |
| `/operations/monthly` | Active admin | Scoped reads, fixed season | Closed-month report | Partial | Fixed global season (`app/operations/monthly/page.tsx`) |
| `/operations/tasks` | Core/admin roles for writes | Fixed season RPC | Actions/follow-up/data issues/export | Partial | Calls `getOperationsWorkflowData(CURRENT_OPERATING_SEASON_CODE)` without selected context (`app/operations/tasks/page.tsx`) |
| `/operations/intelligence` | Active admin | Scope plus fixed season | Founder analytics/CSV | Partial | No cross-program portfolio; RPC default historically UEHM-S11 |
| `/team` | Active admin | Scoped reads | Operational team view | Partial | No programme context UI (`app/team/page.tsx`) |
| `/people`, `/people/[id]` | Active admin | Scoped derived person IDs | People detail, membership/CRM | Partial | Person visibility is derived from linked scoped records; global/null CRM notes need stricter policy (`lib/data.ts::getScopedPersonIds`, `lib/lifecycle-crm.ts`) |
| `/mentors`, `/mentors/create`, `/mentors/[id]/edit` | Operations scope for writes | Scoped reads; mentor program M:N | Mentor directory/profile | Partial | Program participation exists, season membership/rollover UI absent |
| `/mentees`, `/mentees/create`, `/mentees/[id]/edit` | Operations scope for writes | Scoped reads via batch/records | Mentee directory/profile | Partial | School is free text/code; no institution catalog; lifecycle not first-class in UI |
| `/apply/mentor`, `/apply/mentee`, `/apply/thanks` | Public, token + feature flag | Fixed S12 season/batch constants | Public applications | Partial | No campaign/slug entity; one global target (`app/actions/apply.ts`, `lib/apply-gate.ts`) |
| `/applications`, `/applications/[id]` | Review/admin roles | Scoped by application season | Queue/detail/assign/decision/approval | Substantial | Acceptance confirmation/onboarding absent; approval is non-transactional (`lib/application-approvals.ts`) |
| `/admin/applications` | Admin | Scoped query | Admin application view | Partial | Duplicates application route surface |
| `/reviews`, `/reviews/[id]` | Reviewer/admin | Scoped application joins; reviewer own queue supported | Screening/interview rubric | Substantial | No conflict declaration or optimistic lock; concurrent edit warning absent |
| `/reviews/assign-bulk` | Core/admin | Batch constrained to scoped season | Bulk assignment | Substantial | Confirmation exists in UI flow but no immutable decision lock; reviewer eligibility is global |
| `/reviews/progress` | Core/admin | Batch filters | Workload/progress | Substantial | Program selector missing |
| `/reviews/reviewer-pool` | Core/admin | Mentors/batch scoped | Enable mentor reviewer | Partial | Creates global admin role; grant semantics by program need review |
| `/reviews/guide` | Reviewer/admin | None (documentation) | Reviewer instructions | Complete as guide | Contains operational SQL examples; must remain non-production guidance |
| `/interviews` | Reviewer/admin | Scoped candidate load | Interview review self-claim | Partial | No slots, capacity, calendar, self-book/reschedule/no-show workflow |
| `/matches`, `/matches/[id]` | Core/admin for mutations | Batch/season scoped | Manual matching, candidates, cancel | Partial | No transparent weighted suggestions, draft/review/approval, workbook diff import |
| `/events`, `/events/create`, `/events/[id]`, `/events/[id]/edit` | Active admin; operations writes | Event season + optional batch | Event lifecycle/config | Substantial | Program derived only through season; transaction safety and automatic waitlist promotion incomplete |
| `/events/[id]/registrations/[regId]` | Active admin/operations actions | Event detail scope | Registration/payment/proof/status | Substantial | PII-heavy view; export/audit authorization needs explicit policy |
| `/events/[id]/attendance` | Operations scope | Event season scope | Participation/walk-in/attendance | Substantial | `event_participations` uniqueness explicitly not guaranteed by migration 051 |
| `/register/[token]` | Public token | Token resolves event -> season | Event registration | Substantial | Public-token rate limiting/expiry threat controls not evident |
| `/checkin/[token]` | Public token | Token resolves event -> season | QR/self check-in | Substantial | Token expiry/rotation and PII exposure controls require hardening |
| `/recaps/create`, `/recaps/[id]/edit` | Operations scope | Season-scoped | Recap capture/correction | Substantial | Some mojibake denial strings; fixed-season navigation context |
| `/data-issues` | Active admin | Scoped | Data-quality reconciliation | Partial | No generalized import/export review center |
| `/admin` | Core/admin | Uses fixed season in actions/data | Corrections/action items/audit | Partial | `getAdminCorrectionData` is not context-selected; service-role guard review needed |
| `/admin/users` | Super admin | Manages global role + one scope form | User/scope management/audit | Partial | Mixed code/UUID scope storage; multi-grant UX limited |
| `/admin/debug-auth` | Admin/debug | None | Auth diagnostics | Operational support | Must be disabled or tightly restricted in production |
| `/login`, `/unlock`, `/reset-password` | Public auth | None | Authentication | Substantial | Shared unlock is not identity; correctly documented as coarse gate |

No routes exist for: community workspace, institution/program creation, season creation, recruitment campaign administration, interview slots/calendar, dedicated reporting catalog, export job history, mentor rollover, or portfolio dashboard.

### 2.3 Database entity inventory

The repository starts at migration 012, so base definitions for `people`, `seasons`, `applications`, `matches`, `events`, and profiles are inferred only from later alters/queries. Production schema parity must be verified separately before any migration.

| Entity/table/view | Purpose | program_id | season_id | Audit fields/log | RLS evidence | Risk |
|---|---|---:|---:|---|---|---|
| `programs` | Programme catalog | self | No | timestamps | Read policy in migration 018 | No institution/owner/timezone/settings fields; migration 036 seed is catalog-only |
| `seasons` | Programme season | FK `program_id` | self | base unknown | Read policy in 018 | No admin creation workflow; verify FK/constraints in live schema |
| `intake_batches` | Recruitment batch | via season | Yes | timestamps | No specific policy found | Direct table access policy unclear (`036`) |
| `people` | Global identity/person | No | No | base unknown | Broad internal-role read policy in 018 | Global PII row can leak if linked-scope derivation fails |
| `person_roles` | Requested concept | Not found | Not found | — | — | Replaced partly by profiles/admin roles/memberships |
| `mentor_profiles` | Reusable mentor profile | via M:N participation | via `intake_batch_id`; no direct season in type | timestamps/base unknown; source application | Read policy in 018 | Global profile plus season-specific fields mixed |
| `mentor_program_participations` | Mentor-program M:N | Yes | No | timestamps | No policy found | Current engagement only, not season history (`036`) |
| `mentee_profiles` | Reusable mentee profile | No direct | via batch | source application/batch | Read policy in 018 | Program inferred; school is not institution FK |
| `person_season_memberships` | Canonical person/program/season role | Yes | Yes | actor/timestamps | Explicitly no RLS in 052 | Strong scope trigger, but P0 until access policy/app guards are complete |
| `person_season_membership_log` | Append-only lifecycle history | Yes | Yes | changed_by/time; update/delete blocked | Explicitly no RLS in 052 | Good audit integrity; read authorization absent at DB layer |
| `applications` | Recruitment application | via season/batch | Yes | timestamps, payload, consent | Conflicting history: 018 policy, 059 notes staging RLS disabled | Contains PII/raw payload; production RLS parity is a P0 question |
| `application_answers` | Structured answers | via application | via application | timestamps | 059 staging bootstrap only | Not represented in app types/queries except bootstrap; deployment parity uncertain |
| `application_reviews` | Screening/interview assignment + scores | via application | via application | assigned/submitted/timestamps | RLS read policy in 040 | Writes use service role/app checks; no edit version/lock |
| `review_assignment_batches` | Bulk assignment audit | via intake batch | via batch | creator/time/counts | RLS read policy in 044a | Assignment rollback/history semantics incomplete |
| `application_decisions` | Decision history | via application | via application | actor/time/previous/new status | RLS read policy in 041 | Approval audit insert is non-fatal, so trail can be missing |
| Interview slots/interviews | Scheduling | — | — | — | — | No dedicated entity; interview is a review round |
| `matches` | Mentor-mentee relationship | via season | Yes | matched_by/time/end fields | Broad internal read in 018 | Guards exist, but no program FK or approval workflow |
| `events` | Event configuration | via season | Yes | creator/update fields in later migrations | Read policy in 018 | Program is indirect; optional batch consistency must be validated |
| `event_links` | Registration/check-in token | via event | via event | created/expiry fields | RLS enabled/admin select/anon deny in 057 | Public server action uses token; expiry/rate/rotation controls need verification |
| `event_registrations` | Public registration/payment/check-in | via event | via event | many actor/time fields | RLS enabled/admin select/anon deny in 057 | PII; capacity check is read-then-write and needs transaction protection |
| `event_participations` | Internal attendance ledger | via event/season | Yes | captured_by/admin notes | RLS later disabled in 023/025 | Duplicate uniqueness intentionally absent (`051`) |
| `mentoring_recaps` | Mentoring activity | via season | Yes | captured/admin notes/correction log | RLS later disabled in 023/025 | Service-role/app guard reliance |
| `action_items`, `action_item_comments` | Operational tasks | via season | Yes | owner/status/timestamps/comments | RPC/app checks | Fixed default season remains in RPC migrations |
| `crm_notes` | Contact/history/follow-up note | optional | optional | creator/owner/timestamps | Explicitly no RLS in 052 | Null program/season notes and visibility enforcement are app-only |
| `activity_correction_log` | Recap/attendance correction audit | via season added later | Yes/nullable | actor/time/before/after | read policy in 018; later evolution | Nullable scope can complicate isolation |
| `admin_users` | Global portal identity/role | No | No | status/timestamps | self/super-admin read in 018 | Global role can overgrant unless actions also check programme level |
| `admin_scope_access` | Program/season grants | text | text | status/timestamps | self/super-admin read in 020 | IDs or codes allowed; no FK integrity |
| `admin_audit_log` | Admin mutation audit | sometimes metadata | sometimes metadata | actor/action/before/after/time | schema sync in 024/026 | Some domain audit writes are intentionally non-fatal |
| `data_import_batches`, `data_quality_issues`, `season_monthly_kpis` | Import/reconciliation/KPI | indirect | Yes | timestamps/status | No reviewed policy found | Staging-oriented migration 031; environment parity uncertain |
| Exports/communications | Requested capabilities | Not found | Not found | Not found | Not found | CSV is client-side in selected pages; no export audit/job/template system |

## 3. Existing Programme and Season Model

### 3.1 Canonical hierarchy found

```text
VAM OS (application boundary; no organization table)
└── programs
    └── seasons (program_id)
        └── intake_batches (season_id)
            ├── applications (season_id + intake_batch_id)
            ├── profiles (source_application_id + intake_batch_id)
            ├── matches (season_id + optional intake_batch_id)
            └── events (season_id + optional intake_batch_id)
```

Migration 036 explicitly documents and seeds programme codes `UEHM`, `HAM`, `FTU`, `BK`, `HUFLIT`, `HUB`, and `DUE`. It does **not** model institutions. The safe default is therefore: UEH and HAM are programs under the VAM OS portfolio; add an optional `organizations/institutions` parent only after owner confirms the business distinction.

`people` should remain global and deduplicated. Programme/season participation should be expressed through `person_season_memberships`, not duplicated people or destructive profile copies. A person can safely hold multiple `(person_id, season_id, role)` memberships; migration 052 enforces uniqueness and program-season consistency.

### 3.2 Scope allocation

- Must carry direct `program_id`: `seasons`; programme settings/campaigns; programme admin grants; lifecycle memberships; programme-level exports/jobs/templates.
- May carry only `season_id` when FK integrity guarantees season -> program: applications, reviews (through application), matches, events, recaps, action items. High-risk public or bulk tables may denormalize `program_id` only with a consistency trigger.
- Must carry `season_id` and optionally batch: applications, person-season memberships, matching cohorts, season events, reports.
- Global: people and reusable core profile/contact identity. Access must be derived from scoped memberships/records.

### 3.3 Dependency/hard-code inventory

| File/query/action | Current scope/hard-code | Mixing risk | Recommended treatment |
|---|---|---|---|
| `lib/season-config.ts` | UEHM-S11 operations, UEHM-S12 applications/B1 | High | Replace runtime global target with validated context/campaign; retain only migration-safe fallback flags |
| `app/page.tsx`, `app/operations/**` | `CURRENT_OPERATING_SEASON_CODE` | High | Accept program/season context; portfolio uses aggregate RPC with explicit authorization |
| `app/actions/apply.ts`, `lib/applications-create.ts` | S12 constants resolve season/batch | High | Resolve immutable campaign token -> program/season/batch/role server-side |
| `lib/data.ts::getOperationsData` | scoped reads but RPC called with configured season | Medium/high | Require explicit season ID/code in allowed scope; fail closed when season missing |
| `lib/data.ts::getScopedPersonIds` | derives people from scoped matches/recaps/participations/applications | Medium | Add memberships/profiles; integration-test no cross-program PII |
| `lib/program-scope.ts` | accepts code or UUID text grants | Medium | Normalize to UUID FKs in reviewed migration; retain compatibility read during transition |
| `lib/lifecycle-crm.ts::getCrmNotesByPerson` | permits null-scope notes in OR filter | High | Define global-note visibility; never expose null-scope PII to programme admin by default |
| `lib/application-approvals.ts::approveApplication` | service role, multiple non-transactional writes | High integrity risk | Transactional RPC with idempotency and mandatory audit before S12 volume |
| `lib/events.ts::submitPublicEventRegistration` | token event scope; read-count-write capacity | Medium/high | Transactional capacity/waitlist function and rate limiting |
| `lib/matches.ts::createManualMatch` | season/batch guards and unique active mentee constraint | Medium | Add programme/season consistency tests and auditable override reasons |
| migrations 019/022/023/025/028–030/032 | RPC defaults `UEHM-S11` | Medium | New versions require explicit season; do not rewrite history |
| migration 036 seed | UEH/HAM plus future programs | Low catalog risk | Treat as programmes; archive rather than delete; add settings via later authorized migration |
| UI placeholders (`event-form`, mentor/mentee forms) | Examples include UEHM/UEH | Low | Replace shared-component examples with context-aware examples |

## 4. UEH and HAM Data Isolation

1. UEH and HAM are currently distinguished by `programs.code` (`UEHM`, `HAM`) and by seasons linked through `seasons.program_id`.
2. HAM is not an organization in the current schema. No `organizations` or `institutions` table was found.
3. Isolation exists in application reads via `ScopeFilter.allowedProgramIds/allowedSeasonIds`, event/match services, and scope-aware pages.
4. Isolation is incomplete at the database layer. `admin_scope_access` lacks FKs; lifecycle/CRM RLS is explicitly deferred; some earlier migrations disable RLS for operational ledgers; service-role queries bypass policies.
5. Orphan/cross-program risks include profiles linked only by batch, mismatched event batch/season unless validated, null-scope CRM notes, non-scoped global reviewer eligibility, and a missing canonical context in dashboard/recruitment.
6. Roles are both global and scoped: `admin_users.role` is global identity capability, while `admin_scope_access.role` is programme/season level. The relationship is not consistently expressed in every mutation.
7. The schema can represent a super admin, an admin of UEH, a viewer of HAM, and a mentor in several programmes. Multiple grants per user are supported in principle, though the management UX and text-key integrity are weak.
8. One person can be mentor/mentee/reviewer across seasons through `person_season_memberships`; the same person record should be reused.
9. Adding a programme safely requires catalog/settings, owner grants, first season, optional batch, RLS/app-scope tests, onboarding checklist, and archive state. A name-only form is insufficient.

P0 proof required before enabling HAM admins: automated tests that a user scoped to HAM cannot read or mutate UEH applications, people, profiles, reviews, matches, events, registrations, recaps, CRM notes, tasks, or exports, and vice versa. Existing `__tests__/permissions.test.ts`, `auth-safety.test.ts`, `review-db-safety.test.ts`, `match-direct.test.ts`, and `event-lifecycle.test.ts` cover roles/error safety but not a complete two-program isolation matrix.

## 5. Super Admin Portfolio Requirements

### 5.1 Portfolio dashboard

Create a super-admin-only `/portfolio` (or make `/` context-aware) with aggregate, privacy-minimized cards: programme count/active programmes, active seasons, mentor/mentee memberships, open/submitted applications, pending reviews, upcoming interviews, active matches, upcoming events, data issues, and overdue tasks. Per-program rows should show current season and the requested recruitment/operations counts. Each row links to a program workspace.

The portfolio query must aggregate by programme/season in one authorized server-side surface. It must not fetch all PII rows and aggregate in the browser. Counts should derive from `person_season_memberships` where available, with documented legacy fallbacks until backfill is authorized.

### 5.2 Shared context selector

- Context: `program`, dependent `season`, dependent `intake_batch`; month remains season-dependent.
- Super admin can choose `all`; non-super admins only receive allowed programs.
- Canonical URL recommendation: `/p/[programCode]/...?...season=...&batch=...`; portfolio remains `/portfolio`.
- On program change, validate and reset stale season/batch/month server-side and client-side.
- Context must be signed/validated against server grants; URL is not authorization.
- Persist only the last valid programme for convenience; never persist an inaccessible stale filter.

### 5.3 Missing portfolio capabilities

No portfolio route, selector, aggregate-by-program RPC, or portfolio tests exist. `components/app-shell.tsx` and `lib/nav-model.ts` provide navigation structure but no programme workspace context. This is Batch 5A after P0 scope tests.

## 6. New Programme Creation

No programme/institution creation route or action exists. `programs` currently holds `code`, `name`, active/timestamps (migration 036 plus 053). Recommended audited design:

1. Owner chooses whether `institution` is a separate reusable parent. Default: add optional organization only when one institution can own multiple mentoring programs or cross-institution reporting is required.
2. Super-admin wizard captures unique code/name, institution, description, status, timezone, optional logo/contact, owner, defaults, optional first season and batch.
3. Server validates normalized unique code and reserves immutable code after data exists.
4. In one transaction: create programme/settings, owner scope grant, optional season/batch, and audit log.
5. Show an onboarding checklist: scope grants, season dates, campaign, forms/consent, reviewers, event defaults, reporting timezone.
6. Archive instead of hard-delete once referenced.

Migration will be required for organization/settings fields and audit-safe creation, but none is proposed or executed in this audit.

## 7. Season 12 Mentee Recruitment

### 7.1 Current workflow and evidence

| Step | Current state | Evidence/gap |
|---|---|---|
| Season/batch setup | Schema + staging bootstrap | `intake_batches` in 036; S12 fields in 038; no admin UI |
| Campaign/open/close | Missing entity | Feature flags/token in `lib/season-config.ts` and `lib/apply-gate.ts`; no dates/capacity/config |
| Public form | Implemented for fixed target | `/apply/mentee`, `app/actions/apply.ts::submitMenteeApplicationAction`, `lib/applications-create.ts::submitPilotApplication` |
| Confirmation/reference | Basic thanks page | `/apply/thanks`; application reference/confirmation workflow incomplete |
| Duplicate protection | Partial | `applications-create.ts` checks/insert behavior; needs campaign-role-season policy test |
| Data check/status | Partial | Status model in migrations 038/041/060 and application pages |
| Reviewer assignment | Implemented | `application_reviews`, `assignApplicationReview`, bulk assignment migration 044a |
| Screening rubric | Implemented | `application_reviews` score/recommendation constraints; `/reviews/[id]` |
| Interview scheduling | Missing | Interview represented as review round; no slots/calendar/self-book |
| Interview execution | Partial | `/interviews`, `claimInterviewReview`, interview rubric |
| Decision | Implemented with audit | `recordApplicationDecision`, migration 041; role guard `canDecide` |
| Applicant acceptance | Missing | No accepted/declined/no-response confirmation entity/workflow |
| Profile conversion | Implemented but non-transactional | `approveApplication` reuses person/profile and links application; tests explicitly cover orphan retry risk |
| Onboarding/matching-ready | Partial/missing | Membership foundation exists; no recruitment-driven onboarding state machine |

### 7.2 Required campaign model

A recruitment campaign should immutably bind program, season, role, batch, open/close timestamps, timezone, public slug/token hash, status, form version/config, eligibility and consent versions, capacity, interview policy, and confirmation deadline. Public actions resolve the campaign server-side and fail closed after close. Do not trust role/season/batch fields submitted by the browser.

### 7.3 Review/interview/acceptance gaps

- Add conflict-of-interest declaration, required rubric validation, edit version/optimistic locking, decision prerequisites, and bulk confirmation.
- Add interview slots, interviewer assignment/capacity, booking/reschedule/no-show and calendar-export/integration boundary. Default: applicant self-book only after owner approval.
- Separate `approved` from `confirmed`. Recommended default: approval does **not** create an active mentee membership/profile until the applicant confirms; reserve idempotent person linkage earlier if needed.
- Convert approval/profile/membership/audit writes into a transaction. `__tests__/approval-direct.test.ts` documents the current non-transactional orphan risk and retry mitigation.
- Notifications remain templates/outbox preview only until provider, sender, consent, retries and production authorization are approved.

## 8. Mentor Recruitment and Rollover

Mentor public form and application review/decision/profile conversion exist in parallel with mentee (`/apply/mentor`, `submitMentorApplicationAction`, `approveApplication(targetRole='mentor')`). The fixed campaign limitation and acceptance gaps are the same.

Rollover has useful primitives but no workflow: global `people`, reusable `mentor_profiles`, programme M:N (`mentor_program_participations`), season role membership and append-only log (`person_season_memberships`, `person_season_membership_log`). No rollover candidate table, status queue, bulk UI, export, or transition service exists.

Recommended semantics:

- Reuse `people`; do not copy a person.
- Keep reusable mentor profile fields; create a new season membership with `source='rollover'`.
- Default status: `invited`/pending confirmation, not active. Recommended business default is explicit opt-in.
- Store continue/stop/pending/unreachable/update-required as auditable rollover decisions or membership transitions; “stop” creates/updates target-season `opted_out`, never alters previous season.
- Carry only approved reusable fields; do not carry consent, matches, registrations, expired availability, or season-specific capacity.
- Bulk continue/stop requires preview, reason for stop, confirmation, per-row result, and append-only audit.

## 9. Matching

Current manual matching is a solid foundation: batch selection, scoped candidate loads, active-status/capacity-related checks, same-season validation, duplicate active mentee guard, creation audit fields, cancellation/end reason, and tests (`lib/matches.ts`, migration 046a, `__tests__/match-direct.test.ts`, `matching-workflow.test.ts`, `match-search.test.ts`).

Missing for operational maturity:

- Complete matching inputs (availability, language, timezone, mode, goals, conflict flags, remaining capacity per season).
- Draft -> review -> approved -> active workflow and notification state.
- Transparent rule-based weighted suggestions with displayed reasons; no automatic activation.
- Manual override reason and conflict-of-interest record.
- Bulk workspace, unresolved queue, export workbook and validated import with dry-run diff.
- Database-level cross-program/season constraints beyond application guards.

## 10. Events

The event subsystem is the most complete operational domain. It supports event creation/configuration, optional batch, registration/check-in links, public registration, duplicate active email guard, approval, capacity/waitlist status, payment/proof review, self/manual check-in, walk-ins, no-show/blacklist flags, attendance and cancellation (`lib/events.ts`, migrations 045a, 049, 051, 054–057, `__tests__/event-lifecycle.test.ts`).

Gaps and controls:

- Capacity enforcement is read/count/write; use a transactional DB function or lock to prevent oversubscription.
- Waitlist status exists, but deterministic automatic promotion with acceptance expiry is absent.
- Migration 051 explicitly avoids `event_participations` uniqueness; add reviewed idempotency/uniqueness only after legacy duplicate assessment.
- Programme is derived through event season; enforce optional batch belongs to same season.
- Add token expiry/rotation/rate limiting, audit for manual override, privacy-minimized public responses, participant export authorization, attendance reconciliation, and feedback linkage.

## 11. Reporting and Exports

Current reporting is page-specific: operations/monthly dashboards, intelligence CSV buttons, task CSV, event tables and reconciliation. There is no report catalog, `.xlsx` generator, board PDF template, export audit record, or asynchronous export job.

Minimum catalog:

- Portfolio: programme/season/application/member/match/event/activity/data-quality counts.
- Recruitment funnel by role/program/season/batch/source/reviewer/date.
- Matching: active/unmatched/utilization/waiting/cancelled/replacement/capacity.
- Event: registration/approval/waitlist/attendance/no-show/walk-in/feedback.
- Activity: recaps, active mentors/mentees, follow-up, silent mentees, mentors without recap.

Export controls:

- CSV: UTF-8 BOM option for Vietnamese Excel, stable machine headers, privacy-aware column sets.
- XLSX: typed dates/numbers, freeze panes/filter, multiple sheets, metadata sheet with filters/generated time.
- PDF: executive presentation only, context/timestamp/page numbers and unbroken tables.
- All exports: role + programme scope, PII warning, audit action, row count/filter metadata, no browser aggregation outside scope.
- Large exports: queued job with expiration and download authorization in a later batch.

## 12. Manual Work Replacement Matrix

| Current work | Manual tool | Actor | Frequency | Risk | VAM OS replacement | Mode | Priority |
|---|---|---|---|---|---|---|---|
| Create/send recruitment link | Forms/email/chat | Admin | Per campaign | Wrong season/link | Campaign link + preview | Assisted | P1 |
| Duplicate applicant check | Spreadsheet | Ops | Daily | Duplicate PII/person | Deterministic normalized check | Automatic with review queue | P1 |
| Assign reviewers | Sheet/messages | Core team | Daily | Uneven workload | Existing bulk assign + suggestions | Assisted | P1 |
| Chase reviews | Messages | Core team | Daily | Delays | Progress/overdue tasks | Automatic reminders only after approval | P2 |
| Schedule interviews | Sheet/calendar/chat | Interviewer | Daily | Double booking | Slot/capacity/self-book | Assisted | P1 |
| Interview reminders | Email/chat | Ops | Daily | No-show | Outbox/templates | Automatic after notification authorization | P2 |
| Enter results | Sheet/form | Reviewer | Per interview | Lost rubric/history | Existing review form + locks | Manual with guardrails | P1 |
| Participation confirmation | Email/sheet | Ops | Daily | Premature profiles | Confirmation portal/queue | Assisted | P1 |
| Create profile | Manual DB/admin | Admin | Per approval | Orphan/duplicate | Transactional conversion | Automatic after human decision/confirmation | P1 |
| Mentor rollover | Sheet/chat | Ops | Seasonal | Lost history/implicit opt-in | Rollover queue/bulk preview | Assisted | P1 |
| Matching workbook | Spreadsheet | Matching team | Seasonal | Cross-scope/capacity | Rule-based workspace + export/import diff | Assisted | P1/P2 |
| Capacity tracking | Spreadsheet | Matching team | Weekly | Over-allocation | Season membership/capacity counters | Automatic calculation | P1 |
| Event registration | External form/sheet | Event team | Per event | Duplicate/overbook | Existing public registration | Mostly automatic | P2 |
| Attendance/check-in | Sheet/QR tools | Event team | Per event | Reconciliation gaps | Existing token/manual attendance + hardening | Assisted | P2 |
| Follow-up | Chat/sheet | Support team | Weekly | Missed participant | Tasks + CRM notes | Assisted | P2 |
| Monthly report | Spreadsheet/slides | Ops | Monthly | Definition drift | Scoped report catalog | Automatic calculation, human sign-off | P2 |
| Board report | Slides/PDF | Leadership | Monthly/quarterly | Manual errors | Governed PDF template | Assisted | P2 |
| Data correction | Direct DB/CSV | Admin | Ad hoc | Data loss/no audit | Existing correction workflow | Manual with guardrails | P0/P2 |

High-impact recruitment decisions and final matching remain human-approved.

## 13. Security and Audit

| Risk | Impact | Current control | Gap | Required fix |
|---|---|---|---|---|
| Cross-program PII leakage | P0 | ScopeFilter and page/service guards | Service role bypass; incomplete two-program tests; null-scope notes | Canonical context, DB/app enforcement, integration matrix |
| Unauthenticated admin access | P0 | Middleware Supabase session + active admin row | Debug route/shared gate configuration risk | Production route audit, debug disable, auth tests |
| Public token exposes PII | P0 | Opaque event token; anon table deny | Expiry/rate/rotation/privacy response not fully evidenced | Hash/expiry/rotation/rate limits, minimal responses |
| Role escalation | P0 | Super-admin user console; role functions | Global reviewer/admin role vs programme grant ambiguity | Mutation-level global + scope checks; audit grants |
| Export outside scope | P0 | Only ad hoc scoped page exports | No central policy/audit | Server-side export authorization and audit |
| Destructive bulk action | P0 | Some confirmations/audit tables | No universal dry-run/idempotency/per-row audit | Bulk command framework with preview/reason/results |
| Missing audit trail | High | decision/log/correction/admin audit tables | Some audit inserts non-fatal | Transactional mandatory audit for critical mutations |
| Approval partial write | High | Retry/idempotency mitigation tests | Person/profile may exist before application update | Transactional RPC |
| Event oversubscription | High | Capacity count checks | Race between count and insert/confirm | Transaction/locking |
| Schema drift | High | Migrations and runtime fallbacks | No generated DB types; staging/prod alignment migrations | Schema snapshot/type generation in CI |
| Historical data damage | High | Soft cancel/status/history tables | Some cascade deletes; manual correction paths | Archive policy, backups, migration dry-runs |
| Demo/test contamination | High | Demo season constant | Environment isolation not systemic | Explicit environment/tenant flags and test data policy |

RLS conclusion: **not sufficient as a complete control**. Migration 018 adds broad role-based reads; migrations 023/025 disable RLS on operational ledgers; migration 052 deliberately uses app-only control; migration 057 hardens event-link/registration tables. Production policy state must be inventoried directly under separate read-only authorization before implementation.

## 14. Gap Analysis

| Capability | Existing | Partial | Missing/manual workaround | Priority | Dependencies |
|---|---|---|---|---|---|
| Program catalog | Yes | No settings/institution UI | SQL/migration | P1 | Owner semantics |
| Program isolation | Scope layer | Inconsistent DB/action coverage | Admin discipline | P0 | Schema/RLS audit, tests |
| Portfolio dashboard | No | Existing single-season dashboard | Manual cross-sheet reporting | P1 | Isolation + aggregate query |
| Context selector | No | Scope grants exist | Global season constants | P1 | Canonical URL/context |
| Season/batch creation | Schema | No UI/workflow | SQL | P1 | Programme admin policy |
| Recruitment campaign | No | Feature flags/token | External form/link ops | P1 | Campaign schema |
| Mentee public application | Yes | Fixed target/no draft | Manual campaign coordination | P1 | Campaign context |
| Review | Yes | No COI/locking | Messages for coordination | P1 | Review versioning |
| Interview | Review round | No scheduling | Calendar/sheet/chat | P1 | Slot model |
| Acceptance/onboarding | No | Direct approval conversion | Email/sheet | P1 | Confirmation model |
| Mentor recruitment | Yes | Same campaign gaps | Manual coordination | P1 | Batch 5B reuse |
| Mentor rollover | Membership primitives | No workflow/UI | Spreadsheet/chat | P1 | Lifecycle + decisions |
| Matching | Manual creation | No assisted/draft/bulk diff | Spreadsheet | P1/P2 | Rich preference/capacity data |
| Events | Strong | Transaction/token/promotion gaps | Some manual reconciliation | P2 | Security hardening |
| Reporting | Dashboards/CSV fragments | No catalog/XLSX/PDF/audit | Spreadsheet/slides | P2 | Context + definitions |
| Notifications | No provider/outbox | UI text only | Email/chat | P2/P3 | Consent/provider authorization |
| CRM/follow-up | Notes/tasks foundation | No complete queue policy | Chat/sheet | P2 | RLS/visibility |
| Audit | Several logs | Non-fatal/inconsistent | Manual investigation | P0/P2 | Transactional command pattern |

## 15. Prioritized Roadmap

| Batch | Scope | Tables affected | Routes | Migration | Tests | Risk | Definition of Done |
|---|---|---|---|---|---|---|---|
| 5A | Isolation, canonical context, portfolio, program onboarding design | `programs`, `seasons`, `admin_scope_access`; possible settings/org | `/portfolio`, shared shell, admin programme pages | Likely, separately authorized | Two-program read/write/export matrix; stale-filter tests | High/P0 | HAM cannot access UEH and vice versa; super admin portfolio; URL context; audited archive/create |
| 5B | S12 mentee campaign through confirmed onboarding | campaign/application/decision/membership/outbox | `/apply`, applications, reviews, interviews | Yes | campaign close/duplicate/transaction/confirmation | High | One campaign completes end-to-end without manual DB/profile work |
| 5C | Mentor campaign + rollover | memberships/log, rollover decisions | mentor recruitment/rollover | Likely | carry-field, opt-out/reverse, bulk audit | High | No duplicate person; old season unchanged; explicit confirmation |
| 5D | Matching workspace | matches + preference/capacity fields | `/matches` | Likely | cross-program, capacity, scoring reason, override audit | High | Draft/review/activate; no automatic final decision |
| 5E | Event transaction/security completion | events/links/registrations/participations | `/events`, public links | Likely | race/idempotency/token/waitlist promotion | Medium/high | Capacity-safe, auditable attendance and exports |
| 5F | Report catalog and exports | export jobs/audit/templates | `/reports` | Likely | scope/PII/format/large job | Medium | Governed CSV/XLSX and first executive PDF |
| 5G | Automation/notifications | outbox/templates/tasks | operational queues | Yes | dry-run, idempotency, retries, suppression | High | No real send without explicit production enable; human decisions preserved |
| 5H | Operational polish/analytics | KPI definitions/quality | portfolio/workspaces | Maybe | metric definitions, performance, accessibility | Medium | Stable definitions and owner UAT |

The first implementation batch should be a constrained 5A: (1) isolation test harness and fail-closed scope helpers, (2) canonical programme context, (3) portfolio aggregate read surface, (4) selector/shell. Programme creation mutation may be a follow-up PR inside 5A after the organization decision and migration authorization.

## 16. Migration Requirements

No migration was created or run during this audit. Likely future migrations, each requiring separate owner authorization and production schema verification:

1. Normalize `admin_scope_access` to FK-backed program/season grants while preserving legacy text compatibility.
2. Add/review RLS for lifecycle, CRM, intake batches, programme participations and operational ledgers.
3. Optional organization/institution and programme settings/ownership model.
4. Recruitment campaign/form-version/consent/confirmation model.
5. Transactional approval conversion and mandatory audit function.
6. Interview slots/bookings.
7. Rollover decisions or explicit transition metadata.
8. Matching preferences/capacity/draft approval.
9. Event capacity/waitlist transactional functions and token hardening.
10. Export jobs/audit and notification outbox/templates.

Historical UEH/HAM data must be preserved. Any normalization should add validated links/backfills with dry-run counts and rollback strategy; never rewrite history to fit the new model.

## 17. Decisions Required from Owner

| Decision | Recommended default | Alternatives | Impact |
|---|---|---|---|
| UEH/HAM classification | Programs | Organizations; mixed hierarchy | Determines institution schema and portfolio grouping |
| Super-admin PII | Allowed only by explicit need, fully audited | Counts-only portfolio; unrestricted | Privacy and export design |
| Program admin seasons | All seasons in assigned program unless season grant narrows | One season only | Grant UX and scope semantics |
| Person in multiple programs | Yes, one global person | Duplicate per program | Identity dedupe/history |
| Mentor in multiple programs/seasons | Yes through memberships | One active program | Rollover/capacity model |
| Rollover default | Explicit confirmation/opt-in | Auto-active; opt-out | Consent and staffing certainty |
| Mentee approval conversion | Wait for applicant confirmation before active profile/membership | Create immediately | Orphan/no-response handling |
| Interview mandatory | Campaign-configurable; default required for mentee S12 if current process requires | Always/never | Campaign state machine |
| Bulk approve/reject | Super admin/admin/core team with full-access grant | Super admin only | Throughput vs risk |
| PII export roles | Super admin + program full-access; explicit audited permission | Admin/core team broadly | Leakage risk |
| First PDFs | Portfolio executive + monthly programme operations | Recruitment/event first | Batch 5F scope |
| Notification provider/sender | Outbox preview first; owner-approved transactional sender later | Existing mailbox/manual | Consent, deliverability, production safety |
| Applicant self-book | Yes only after slot model and owner pilot approval | Admin booking only | Interview ops load |
| Spreadsheet fallback | Keep governed export/import with dry-run during transition | Remove immediately | Operational continuity |
| Historical normalization | Additive links only after reconciliation | Full rewrite; no normalization | Data safety and report accuracy |

## 18. Recommended First Implementation Batch

Proceed only after the first two owner decisions and a read-only production schema/RLS comparison. Recommended first PR sequence within Batch 5A:

1. Add a two-program isolation test fixture covering reads and mutations across every P0 domain.
2. Make scope helpers fail closed and require explicit authorized program/season context for shared operations.
3. Introduce a server-validated context model and dependent selectors; remove global season assumptions from shared routes incrementally.
4. Add privacy-minimized super-admin portfolio aggregates and route.
5. Add programme onboarding UI only after a separately authorized schema/settings migration.

Do not start S12 campaign migrations, production data backfills, notifications, or programme creation mutations until the roadmap and owner decisions are reviewed.

### Audit validation baseline

- Tests: 395/395 passed (`npm test`; pnpm unavailable on this Windows host).
- Lint: no ESLint warnings or errors (`npm run lint`).
- TypeScript: 0 errors (`npm run typecheck`).
- Production build: successful; 36/36 static-generation steps, 46 listed application routes plus `/_not-found`, middleware generated (`npm run build`).
- Baseline tracked working tree: clean; 12 pre-existing untracked files preserved.
- No database connection, migration, seed, email, notification or production mutation was used for this audit.
