# Migration 061 Schema Discrepancy Template

Date: 2026-07-22
Target project name/ref:
Confirmed staging by:
Probe export location:

| Object | Expected | Actual | Result | Risk | Recommended action |
|---|---|---|---|---|---|
| Environment identity | Confirmed staging project/ref |  | UNKNOWN | Critical | Stop until owner confirms |
| Prerequisite tables/types | Match 061 assumptions |  | UNKNOWN | High | Compare catalog |
| Campaign table/columns | Expected contract |  | UNKNOWN | High | Classify each definition |
| Constraints/FKs | Checks and safe delete semantics |  | UNKNOWN | High | Compare definitions |
| Indexes/duplicate semantics | Canonical race-safe strategy |  | UNKNOWN | High | Compare key and predicate |
| Functions/triggers | Safe path, atomic scope/governance |  | UNKNOWN | Critical | Compare full definitions |
| RLS/grants | Scoped reads; no anon app read/direct mutation |  | UNKNOWN | Critical | Run permission negatives |
| Migration provenance | Understood ledger/history |  | UNKNOWN | High | Preserve history |
| Data-shape counts | No mismatch/duplicates/orphans |  | UNKNOWN | Critical | Remediate separately |

Allowed Result values only: **MATCH**, **EQUIVALENT**, **MISSING**, **CONFLICT**, **UNKNOWN**.

## Decision rules

### A. SAFE TO APPLY 061 UNCHANGED

Only when the target is confirmed staging, every prerequisite matches, all 061 target objects are absent, data preflight is safe, backup exists, and owner separately authorizes execution.

### B. 061 ALREADY EQUIVALENT — DO NOT REAPPLY

Use when target objects exist, every material semantic is MATCH/EQUIVALENT, data shape is safe, and provenance is understood. Record the ledger decision; never rerun fail-closed 061 blindly.

### C. CREATE ALIGNMENT MIGRATION 062

Use when objects exist and bounded discrepancies can be aligned without destructive history changes. Create and review a new idempotent/fail-closed migration; do not edit an applied 061.

### D. MANUAL REMEDIATION REQUIRED

Use for incompatible types, duplicate/orphan/mismatched data, unsafe grants/RLS, destructive FK behavior, or unknown provenance that cannot be resolved safely.

### E. WRONG OR UNKNOWN ENVIRONMENT

Use whenever the project cannot be proven staging. Stop all migration work.

Never rewrite applied migration history. Never change migration 061 merely to match an environment that already contains similarly named objects.
