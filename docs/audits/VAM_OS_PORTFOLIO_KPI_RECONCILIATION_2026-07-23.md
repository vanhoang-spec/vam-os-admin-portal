# VAM OS Portfolio KPI Reconciliation — 2026-07-23

## Scope and evidence

This is a repository-only audit. No SQL or database query was run and no environment, schema, migration, seed, production, or staging state was changed. The visible values (UEHM-S12, 902 applications, 0 mentors, 0 mentees, 637 matches, 1 event) are owner-provided evidence. Repository evidence includes the application source, migrations, tests, and the 2026-07-22 production schema inventory. Inventory row estimates are metadata snapshots, not asserted exact counts.

Route: `app/portfolio/page.tsx` → `getSuperAdminPortfolio` → `loadProgramContextCatalog` and `loadAggregateRows` in `lib/portfolio.ts` → pure reconciliation in `lib/portfolio-core.ts`. Program workspace cards use the same loader through `getProgramWorkspaceSummary`.

## KPI trace before correction

| KPI | Query/function | Source table | Join key | Scope key | Filters | Fallback |
|---|---|---|---|---|---|---|
| Current season | inline `seasons.find(...active... ) ?? seasons.at(-1)` | `seasons` catalog | `seasons.program_id = programs.id` | program | status in active/open/ongoing/current | last unordered catalog row |
| Applications | `countByProgram` | `applications` | `season_id` → catalog season | program inferred from season | excluded terminal statuses | empty program bucket became 0; query error null |
| Mentors | `countByProgram` | `person_season_memberships` | direct `program_id` or season map | program, across every season | role mentor, status active | empty bucket 0; query error null |
| Mentees | `countByProgram` | `person_season_memberships` | direct `program_id` or season map | program, across every season | role mentee, status active | empty bucket 0; query error null |
| Matches | `countByProgram` | `matches` | `season_id` → catalog season | program inferred from season | status active | empty bucket 0; query error null |
| Events | `countByProgram` | `events` | `season_id` → catalog season | program inferred from season | future, not cancelled/completed | empty bucket 0; query error null |
| Data issues | `countByProgram` | `action_items` | `season_id` → catalog season | program inferred from season | type data_issue, open/in_progress/parked | empty bucket 0; query error null |
| Overall status | `health` | derived from action items | program aggregate | program, across every season | data issue first, then overdue | unknown when either query is unavailable |

No profile table, `source_application_id`, `intake_batch_id`, or `mentor_program_participations` participated in the old portfolio counts. There is no SQL join in this loader, so a LEFT-to-INNER join conversion is not involved.

## UEH reconciliation

The exact visible combination is explained by mixed semantics, not by evidence that the underlying people are absent:

- The card resolved and displayed UEHM-S12, but applications, memberships, matches, events, issues, and tasks were counted across all UEH-linked seasons.
- `running` (the status seeded for UEHM-S12 by migration 038) was not recognized as active. The fallback used catalog array order, which had no explicit ordering.
- Mentor and mentee KPIs depended exclusively on active `person_season_memberships`. Historical matches can exist before lifecycle memberships were introduced; the production inventory describes the membership table as a newer lifecycle table.
- Matches were counted as rows and selected neither `mentor_person_id` nor `mentee_person_id`, so the loader could not reconcile valid historical match identities.
- Membership rows were counted, not distinct `person_id`, allowing duplicates across role/link rows.
- Query errors already produced null plus a warning, rather than zero. The misleading zero arose from a successful empty membership result.
- Production schema evidence confirms person IDs exist on matches and memberships and that `intake_batch_id` is nullable. The old code did not require batch linkage, nor did it count profiles by profile IDs.

The owner-provided 902 and 637 align with the old whole-program aggregation path, but this audit does not claim which database rows produced them.

## HAM current-season audit

Canonical program code is `HAM`; migration 036 seeds the program catalog. Repository staging documents use canonical season `HAM-S6` and report that it is linked to HAM in staging. However, the live portfolio screenshot shows no season, and this audit did not query live data. Fixtures and staging evidence cannot prove a production season row or `seasons.program_id` linkage.

Classification: **INSUFFICIENT EVIDENCE**.

There is no portfolio hard-code for UEH and no default-season fallback into HAM. After correction, HAM remains “Chưa có dữ liệu” only when the loaded catalog has no season linked by `program_id`. If a linked HAM season is present, only that season’s rows are counted.

## Canonical counting rule and compatibility strategy

Selected strategy: **C. dual-source reconciliation with deduplication**, with **D. explicit incomplete-linkage display** when identities are not safely derivable.

- Resolve exactly one season per program: recognized active/running status first, then highest numeric `-S<n>` code deterministically.
- Scope every KPI by that exact `season_id`; program scope follows `seasons.program_id`. Batch is not a portfolio scope and is never mixed into season totals.
- Applications: open/non-terminal `applications` rows for the resolved season.
- Mentors/mentees: distinct person identities from active memberships unioned with valid person IDs on active matches for that season. This preserves legacy match compatibility and deduplicates identities.
- Matches: active match rows for the resolved season.
- Events: future, non-completed/non-cancelled event rows for the resolved season.
- Issues/tasks: open scoped action rows for the resolved season.
- A source query error remains null and emits a warning. It is distinguishable from a successful true zero.
- If active matches exist but identities are missing and no canonical memberships can establish participants, mentor/mentee values are null and the portfolio displays `Chưa liên kết đủ dữ liệu`.
- A program with no linked season displays `Chưa có dữ liệu`, not fabricated zeroes.

## Reconciliation table

| Program | Season | Applications | Mentors | Mentees | Matches | Events | Consistent | Cause |
|---|---|---:|---:|---:|---:|---:|---|---|
| UEH Mentoring | UEHM-S12 (owner-provided visible result) | 902 | 0 | 0 | 637 | 1 | No | Old code labeled one season while aggregating all seasons; participants required lifecycle memberships and ignored match person IDs |
| Hanoi Alumni Mentoring | No data (owner-provided visible result) | 0 | 0 | 0 | 0 | 0 | Not assessable | Live season/linkage cannot be established from repository evidence; staging HAM-S6 evidence is not production evidence |

## Corrective change

`lib/portfolio-core.ts` now centralizes deterministic season resolution, strict season scoping, distinct identity reconciliation, and unknown/incomplete states. `lib/portfolio.ts` selects membership and match person IDs and delegates every KPI to that rule. The portfolio table renders incomplete participant linkage explicitly. No database remediation is performed.

## Decision

**PORTFOLIO KPI AND DATA LINKAGE BOTH REQUIRE REMEDIATION**

The code defect is corrected. Existing rows may still need owner-reviewed membership/season linkage remediation, especially HAM production season linkage and legacy records, but no backfill is authorized or performed.
