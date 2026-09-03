# Execution Plan

Status: in progress

## Checkpoint 1 — complete

- Production-main baseline: `0244e67f4b6fbc034f6321e546cd782244396191`.
- Original account-provisioning worktree: clean and untouched.
- Dedicated worktree: `C:\vam-s12-recruitment-remediation`.
- Dedicated branch: `feat/s12-recruitment-operational-remediation` (retained instead of restarting solely to rename it).
- Recovered only the three M2.1 interview assignment/operations commits; rejected wholesale merge of old 079–082 history.
- Independent evidence: `agent-reports/CODEX_CHECKPOINT_1_RECONCILIATION.md`.

## Workstreams

1. Establish repository and deployed-state baseline.
2. Reconcile production `main` with the staged interview-assignment work.
3. Implement season/stage reviewer-threshold configuration and enforce it server-side.
4. Make personal Reviewer/Interviewer provisioning usable and least-privileged for Core Team.
5. Ensure bulk final decisions share authoritative lifecycle gates with single decisions.
6. Add regression, authorization, performance, and browser UAT coverage.
7. Perform independent Codex diff review and Claude Auth/RLS/RPC review.
8. Record staging/production release evidence; no environment mutation is claimed without captured proof.

## Delivery gates

- No hard-coded S12 reviewer threshold in workflow logic.
- Server-side authorization and lifecycle validation are authoritative.
- No public recruitment-role enrollment path.
- Relevant unit/integration tests, typecheck, lint, build, and browser UAT pass or are recorded with a concrete blocker.
- Security/RLS/RPC review findings are resolved or explicitly accepted before production rollout.
