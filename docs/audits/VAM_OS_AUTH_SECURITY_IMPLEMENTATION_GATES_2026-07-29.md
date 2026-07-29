# VAM OS Auth Security Implementation Gates
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Purpose

Define the recommended implementation order and the owner approval gates required
before each phase can be applied. No migration in this package is authorized for
execution until explicitly approved by the project owner.

---

## Dependency Graph

```
Migration A — Admin & Business Table RLS
  └─ Requires: 018, 020, 023, 040, 041, 044a, 052 applied (all confirmed)
  └─ Blocks: Nothing (standalone)
  └─ Reversible: YES — section by section

Migration B — people.auth_user_id column
  └─ Requires: public.people table exists (confirmed)
  └─ Blocks: Migration C (participant policies need this column)
  └─ Reversible: YES (while no accounts are linked)

Migration D — Function Grant Hardening
  └─ Requires: Migration A applied (policies that call helpers exist)
  └─ Blocks: Nothing (standalone hardening)
  └─ Reversible: YES

Migration C — Participant RLS Policies
  └─ Requires: Migration B applied AND Migration A applied AND participant login built
  └─ Blocks: Nothing (standalone — deferred)
  └─ Reversible: YES (participant login must be disabled first)
```

**Recommended application order:**
```
1. Run VAM_OS_AUTH_RLS_READONLY_VERIFICATION.sql (pre-baseline, READ ONLY)
2. Apply Migration A (admin/business table RLS hardening)
3. Apply Migration D (function grant hardening)
4. Apply Migration B (people.auth_user_id column) — when participant login is being built
5. Apply Migration C (participant policies) — when participant login portal is ready
```

---

## Owner Gates

### Gate 1: Pre-Application Review

**Required before Migration A:**
- [ ] Owner has read `VAM_OS_AUTH_RLS_TARGET_INVENTORY_2026-07-29.md` and confirmed the risk summary.
- [ ] Owner has read `VAM_OS_AUTH_RLS_SECURITY_TEST_PLAN_2026-07-29.md` and approved the test plan.
- [ ] Owner has run `VAM_OS_AUTH_RLS_READONLY_VERIFICATION.sql` against production and shared the output.
- [ ] Owner has reviewed the pending owner decisions in `VAM_OS_AUTH_OWNER_DECISIONS_2026-07-29.md`.
- [ ] **Owner has explicitly authorized application of Migration A to staging.**

### Gate 2: Staging Validation

**Required before Migration A moves to production:**
- [ ] Migration A applied to staging.
- [ ] All Test Group 2, 3, 4, 5 test cases passed on staging.
- [ ] Operations Dashboard verified working on staging with `viewer`, `reviewer`, `admin`, `super_admin` accounts.
- [ ] No regressions in admin portal pages on staging.
- [ ] **Owner has explicitly authorized application of Migration A to production.**

### Gate 3: Function Hardening Review

**Required before Migration D:**
- [ ] Owner has reviewed `VAM_OS_SECURITY_DEFINER_FUNCTION_REVIEW_2026-07-29.md`.
- [ ] Owner decision on D2 (add core_team to current_admin_context) made.
- [ ] Migration A is confirmed applied.
- [ ] Test Group 7 test cases designed and ready to run.
- [ ] **Owner has explicitly authorized Migration D.**

### Gate 4: Participant Login Sprint Start

**Required before Migration B:**
- [ ] Owner has read `VAM_OS_PEOPLE_AUTH_LINKAGE_MIGRATION_DESIGN_2026-07-29.md`.
- [ ] Owner has decided deletion behavior (see owner decision B1).
- [ ] Participant login sprint is officially planned and scoped.
- [ ] `lib/types.ts` TypeScript update is planned as part of the sprint.
- [ ] **Owner has explicitly authorized Migration B.**

### Gate 5: Participant Policies

**Required before Migration C:**
- [ ] Migration B is applied and confirmed in production.
- [ ] Owner decisions P1–P6 (`VAM_OS_AUTH_OWNER_DECISIONS_2026-07-29.md`) are resolved.
- [ ] Participant login portal is built, tested, and ready for beta.
- [ ] `current_person_id()` function is tested with real participant test accounts.
- [ ] Migration C reviewed for performance (subquery join in USING clauses).
- [ ] **Owner has explicitly authorized Migration C.**

---

## Timeline Recommendation

| Phase | Recommended timing | Blocking? |
|---|---|---|
| Migration A (admin RLS) | Next sprint — this is the highest-value hardening with lowest risk | Not blocking for current S12 work |
| Migration D (function grants) | Same sprint as A | Not blocking |
| Run verification SQL | Before and after A+D | Not blocking |
| Migration B (people column) | Before participant login sprint starts | Blocking for participant login |
| Migration C (participant policies) | During participant login sprint | Blocking for participant portal go-live |

---

## Risk Classification per Migration

| Migration | Regression risk | Security impact | Owner effort |
|---|---|---|---|
| A1 — Re-enable mentoring_recaps RLS | LOW — service-role unaffected; only blocks direct API | HIGH — protects 1000s of recap records | 30 min testing |
| A2 — Re-enable event_participations RLS | LOW | HIGH | 30 min testing |
| A3 — admin_audit_log RLS | VERY LOW — audit log page already requires super_admin | HIGH — blocks cross-admin data leak | 15 min testing |
| A4 — person_season_memberships RLS | LOW | MEDIUM | 15 min testing |
| A5 — membership log RLS | VERY LOW — no app page reads this directly | MEDIUM | 5 min |
| A6 — event_links/registrations RLS | LOW | HIGH — registration tokens protected | 20 min testing |
| A7 — applications policy + core_team | VERY LOW — additive change | MEDIUM | 10 min testing |
| A8 — crm_notes RLS | LOW | MEDIUM | 10 min testing |
| A9 — audit log constraint | MEDIUM — may fail if non-canonical strings exist | LOW | Must run RV12 first |
| D — function grants | LOW — anon has no legitimate use for these RPCs | MEDIUM — defense-in-depth | 15 min testing |
| B — people.auth_user_id column | VERY LOW — additive column | ENABLES participant login | 5 min |
| C — participant policies | MEDIUM — new access surface for participants | Required for participant login | Full test group 9 |

---

## Pre-Flight Checklist for Migration A

Before running Migration A on production:

- [ ] `npm test` passes (all 632+ tests) — confirms no TypeScript regressions
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Run `VAM_OS_AUTH_RLS_READONLY_VERIFICATION.sql` on production; save output
- [ ] Run RV12 (distinct action_types in admin_audit_log) — if non-canonical values found, exclude A9 from first deployment
- [ ] Confirm staging deployment of Migration A is successful
- [ ] Owner sign-off documented (Gate 1 + Gate 2 complete)

---

*Design only. No production or staging connection used. No SQL executed.*
