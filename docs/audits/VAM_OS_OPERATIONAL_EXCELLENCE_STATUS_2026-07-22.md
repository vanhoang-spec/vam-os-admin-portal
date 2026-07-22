# VAM OS Operational Excellence Status

Date: 2026-07-22
Audit branch: `batch-5a-3-role-kpi-consistency`

## 1. Executive Summary

VAM OS has a working multi-program access foundation, a Super Admin portfolio, core recruitment review screens, manual matching, event operations and an operational dashboard. It is not yet an end-to-end Season 12 operating system: recruitment campaigns, applicant confirmation, mentor rollover, governed exports, notification delivery, complete RLS and legacy route migration remain incomplete.

The role/KPI audit found a concrete consistency defect in the legacy `/operations` fallback path. Super Admin used the season-scoped RPC, while scoped users used application-side rows for every allowed season. The fallback KPI helper selected the configured season but did not filter recap/event inputs to that season. A user granted multiple seasons could therefore receive cross-season counts. Batch 5A-3 makes the aggregate explicitly season/month scoped and role-independent, and exposes the program, season, month and aggregate source in the UI.

The two screenshots originally supplied remain consistent with a month mismatch: one shows July and one June. They do not prove a role discrepancy. A credentialed production A/B comparison could not be completed from this workspace because its read-only Supabase configuration contains no active Reviewer account. No password, token or PII was requested or recorded.

## 2. Current Production Capabilities

- Authenticated admin portal with role-aware navigation and actions.
- Applications, review assignment, review detail and decision foundations.
- Mentor, mentee, people and match administration.
- Monthly Operations dashboard, workflow tasks and intelligence views.
- Event creation, registration, attendance and check-in foundations.
- Super Admin portfolio and read-only program workspace.
- Program/season/batch access resolution and isolation tests.

Production capability does not imply every route is canonical-program aware or every table has final RLS.

## 3. Multi-program Foundation

UEH and HAM remain `programs`; `people` remains global identity. Canonical hierarchy is `programs -> seasons -> intake_batches`. Batch 5A introduced server-resolved context, fail-closed guards, scoped program choices, dependent season/batch choices and two-program isolation tests. Legacy routes such as `/operations` still use `CURRENT_OPERATING_SEASON_CODE`; they are a compatibility layer, not the final multi-program URL architecture.

## 4. Role and KPI Consistency

Program-level KPI semantics:

- recap count, active mentor/mentee, mentor without recap, silent mentee, event/training and attendance are invariant across authorized roles for identical program/season/month;
- reviewer assignment and current-user identity must not enter the aggregate function;
- PII and editable/drill-down controls may vary by role;
- personal review/task counts belong under a separate “Công việc của tôi” section.

### Operations data path

| KPI | Source | Program filter | Season filter | Month filter | Role filter | Expected behavior |
|---|---|---|---|---|---|---|
| Recap | `mentoring_recaps` | Through season | Explicit season ID | `meeting_month` | None | Same count for authorized roles |
| Active mentee/mentor | valid recaps | Through season | Explicit season ID | selected month | None | Same distinct counts |
| Mentor without recap | `matches` + recaps | Through season | Explicit season ID | selected month | None | Same set difference |
| Silent mentee | `matches` + recaps | Through season | Explicit season ID | selected and previous closed month | None | Same count |
| Event/training | `events` | Through season | Explicit season ID | `starts_at` month | None | Same count |
| Attendance | `event_participations` + events | Through event/season | Explicit season/event IDs | event month | None | Same count |
| Personal reviews/tasks | review/task tables | Authorized context | Authorized context | workflow-specific | Current user | May differ; label as personal work |

Super Admin may load the SECURITY DEFINER RPC using the user JWT. Scoped users use service-role-backed application queries only after `getAdminScopeContext` and `getScopeFilter`; empty grants fail closed. The count-only aggregate now applies season and month filters again after loading, preventing role-path differences from changing program KPI semantics.

## 5. Season 12 Mentee Recruitment

Application schema, public form, review assignment and decision primitives exist. Campaign configuration, versioned public link lifecycle, interview scheduling, transactional acceptance conversion and applicant confirmation before active membership are incomplete. Current state: partial, not production-ready as a complete S12 workflow.

## 6. Mentor Recruitment

Mentor application/profile primitives exist. Campaign lifecycle, selection pipeline, confirmation and audit-complete activation are incomplete.

## 7. Mentor Rollover

Membership primitives can represent participation across seasons, but there is no assisted rollover workspace, carry-forward diff, opt-in/opt-out decision log or reversible bulk operation. Historical seasons must remain unchanged.

## 8. Matching

Manual match creation/cancellation and validation exist. Preference/capacity modeling, explainable recommendations, draft/review/activate flow, override audit and bulk planning remain incomplete. Final matching must remain human-approved.

## 9. Events

Event CRUD, public registration links, registration detail, attendance and QR/check-in foundations exist. Transactional capacity/waitlist promotion, token lifecycle hardening and full participation reconciliation remain incomplete.

## 10. Reporting and Export

Dashboards and limited CSV-oriented data surfaces exist. There is no governed report catalog, XLSX/PDF production flow, export job tracking, consistent definitions or PII export audit. Portfolio remains count-only by design.

## 11. Automation and Notifications

No approved production provider/outbox workflow exists. Automated email, retry, suppression, consent and delivery audit are missing. Human approval boundaries must be preserved before enabling delivery.

## 12. Security and RLS

Application guards and several RLS policies exist, but repository migrations document known gaps and production policy parity is not proven. `mentoring_recaps` and `event_participations` have historical compatibility decisions; membership/CRM tables still rely partly on application enforcement. `admin_scope_access` uses legacy text code/UUID semantics. Any normalization/RLS migration requires separate owner authorization, dry-run mapping, rollback and production verification.

## 13. Legacy Route Migration

`/portfolio` and `/programs/[programCode]` use the new context foundation. `/operations` now has explicit visible context and a season-safe aggregate, but still uses global operating-season configuration. Other domain routes continue through scoped compatibility adapters. Batch 5H should migrate route families incrementally and remove duplicate context logic only after parity tests.

## 14. Manual Work Remaining

- Credentialed owner A/B check of Super Admin and Reviewer using identical URL/context.
- Campaign setup and public-link governance.
- Interview scheduling and acceptance confirmation.
- Mentor rollover review and approval.
- Matching recommendations and capacity review.
- Event waitlist/capacity reconciliation.
- Governed exports and monthly report publication.
- Notification preview/approval/delivery operations.
- RLS verification and legacy scope normalization.

## 15. Completion Percentage by Capability

Percentages below are evidence-based implementation-checklist ratios, not effort estimates. Each capability uses the listed completed checkpoints divided by its defined minimum production checkpoints; they should not be combined into a single overall percentage.

| Capability | Evidence ratio | Completion | Basis |
|---|---:|---:|---|
| Multi-program foundation | 7/9 | 78% | Context, guards, portfolio, switchers, isolation, workspace, tests done; legacy routes and final RLS pending |
| Role/KPI consistency | 6/7 | 86% | Canonical aggregate, season/month scope, role invariance, PII-free result, tests, visible context done; credentialed production A/B pending |
| Mentee recruitment | 4/9 | 44% | Form/schema/review/decision foundations; campaign, interview, transaction, confirmation, activation pending |
| Mentor recruitment/rollover | 2/8 | 25% | Profile/membership primitives; campaign and rollover workflow pending |
| Matching | 4/8 | 50% | Manual CRUD/validation/tests; recommendation, capacity, draft approval, override audit pending |
| Events | 5/8 | 63% | CRUD/link/registration/check-in/attendance; transaction, waitlist, hardening pending |
| Reporting/export | 2/7 | 29% | Dashboards/basic data surfaces; catalog/XLSX/PDF/jobs/audit/definitions pending |
| Automation/notifications | 0/6 | 0% | Provider/outbox/preview/retry/suppression/audit absent |
| Security/RLS | 5/9 | 56% | Auth, guards, scoped loaders, isolation, some RLS; production parity, normalization and remaining policies pending |

## 16. Recommended Next Batches

| Batch | Scope | Exit condition |
|---|---|---|
| 5A-3 | KPI consistency and context clarity | Same-context role parity test and owner preview review |
| 5B-1 | Recruitment campaign/public link | Governed campaign and versioned, closable public link |
| 5B-2 | Review/interview/acceptance transaction | Transactional human decision through confirmed membership |
| 5C | Mentor recruitment and assisted rollover | Explicit decisions, reversible/audited activation |
| 5D | Matching workspace | Explainable draft/review/activate workflow |
| 5E | Event hardening | Capacity-safe registration, waitlist and attendance reconciliation |
| 5F | Excel/PDF/reporting | Scoped exports, definitions and export audit |
| 5G | Notifications and automation | Preview-first outbox with approved provider and retries |
| 5H | Legacy route migration and polish | Canonical URL context across domain routes |

## 17. Blockers

1. Credentialed production role parity requires owner-controlled Super Admin and Reviewer sessions; current workspace has no active Reviewer record.
2. Production schema/RLS parity needs separately authorized read-only verification.
3. Scope normalization and remaining RLS need migration authorization.
4. Recruitment, confirmation, rollover and notifications need owner workflow decisions.

## 18. Owner Decisions

- Confirm whether `/operations` remains UEH-only until Batch 5H or should move earlier under `/programs/[programCode]/operations`.
- Approve credentialed UAT matrix for Super Admin/Reviewer with June and July URLs.
- Approve later read-only production RLS inspection.
- Decide campaign/interview/confirmation policy before Batch 5B migrations.
- Approve PII export roles and notification provider before Batches 5F/5G.

## Audit Safety

- No migration created or executed.
- No seed executed.
- No production row mutation.
- No email or notification sent.
- Read-only diagnostic output excluded names, emails, phones, passwords and tokens.
