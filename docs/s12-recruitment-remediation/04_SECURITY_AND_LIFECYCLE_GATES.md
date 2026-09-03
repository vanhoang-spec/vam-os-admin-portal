# Security and Lifecycle Gates

Status: implemented locally; staging verification required

## Locked invariants

- Reviewer/Interviewer access is personal, explicit, scoped, active, and removable.
- Possessing an authenticated session is not sufficient authorization.
- Public self-registration cannot grant recruitment permissions.
- Bulk and individual final decisions use the same authoritative eligibility predicate.
- Client-side filtering is operator guidance only; the server/RPC revalidates at write time.
- Privileged functions have explicit caller checks, safe `search_path`, and restricted execute grants.

## Review checklist

- Auth identity linkage and active admin lookup.
- Program/season scope enforcement.
- Role grant/revoke boundaries and audit trail.
- RLS coverage and direct Data API reachability.
- RPC ownership, `SECURITY DEFINER` necessity, execute grants, and TOCTOU behavior.
- Mixed-eligibility bulk requests and rollback/partial-success semantics.

## Implemented boundary

- Exact season plus `reviewer`/`interviewer` membership is required by the participant RPC.
- Reviewer interview lists return owned active assignments only; unassigned self-claim creation is disabled.
- Review detail lookup retains the assigned reviewer ID constraint; all direct authenticated table access remains denied by the existing forced-RLS/server-only posture.
- Cancel/reassign is one SQL transaction: lock old row, cancel without deletion, create clean replacement when requested, append reason/actor/old/new audit event, recompute aggregate status.
- Review submission is one SQL transaction and requires the current actor to be the assignment owner and stage participant.
- Interview minimum completion transitions to `ready_for_final_decision`.
- Individual and bulk decisions call `vam084_apply_application_decisions`, which locks rows, requires expected statuses, checks operator scope and the shared lifecycle predicate, and returns per-row applied/blocked results.
- Claude review findings and dispositions are in `agent-reports/CLAUDE_AUTH_RLS_TRANSACTION_REVIEW.md`.
