# VAM OS — Batch 3 S12 Launch Safety — Production Checkpoint

**Date:** 2026-07-21  
**Status:** PRODUCTION — MERGED AND PUSHED  
**Final commit:** `6704a0700a4a631e8aba70581999063695e2d3df`

---

## Objective

Harden the Season 12 admin portal for safe public launch. Batch 3 addressed three areas:

1. **Operational navigation** — Add S12 operational nav links visible to `core_team`/`admin`.
2. **Matching search normalization** — Vietnamese diacritic normalization including Đ/đ for mentor/mentee search.
3. **Security closure** — Eliminate raw database/provider error messages from all identified S12 launch-surface user-facing return paths, and verify authorization boundaries on admin mutations.

---

## Commit Chain

```
343179f  feat: add accessible grouped navigation shell         ← prior main (Batch 2)
a0e39dd  feat: harden S12 launch workflows and operations
05fd4f9  fix: sanitize S12 admin action errors
6704a07  fix: extend raw-error sanitization to review and event-detail paths  ← production tip
```

All three Batch 3 commits are on a direct linear ancestry from `343179f`. No merge commit was created. Fast-forward only.

---

## Production Deployment

| Item | Value |
|------|-------|
| Branch | `batch-3-s12-launch-safety` |
| Merge method | `git merge --ff-only` |
| Push | `git push origin main` |
| Final `origin/main` | `6704a0700a4a631e8aba70581999063695e2d3df` |
| Vercel trigger | Automatic on push to `main` |
| Preview authorization | Owner confirmed: `BATCH 3 FINAL PREVIEW READY; PROCEED PRODUCTION` |

---

## Files in Scope

**Production code modified or added:**

| File | Change |
|------|--------|
| `components/app-shell.tsx` | Add operational navigation section for core_team/admin |
| `lib/nav-model.ts` | Add S12 operational nav entries |
| `app/operations/intelligence/page.tsx` | Authorization guard for seasonal intelligence page |
| `app/matches/matches-client.tsx` | Vietnamese diacritic normalization for search |
| `lib/match-search.ts` | New — Vietnamese search normalization library (Đ/đ) |
| `lib/matches.ts` | Fix 9 raw-error leak sites; matching authorization evidence |
| `lib/events.ts` | Fix 8 raw-error leak sites (setRegistrationLinkActive, createEventLinkForEvent, getEventDetailData, getRegistrationDetail) |
| `lib/application-approvals.ts` | Application approval retry/reuse evidence; authorization chain |
| `lib/application-reviews.ts` | Fix 4 raw-error leak sites (assign/draft/submit/status) |

**Tests added:**

| File | Tests | Classification |
|------|-------|----------------|
| `__tests__/approval-action.test.ts` | 10 | Direct server-action auth tests |
| `__tests__/approval-direct.test.ts` | (existing — extended) | Direct production tests |
| `__tests__/event-lifecycle.test.ts` | 47 | Direct production tests |
| `__tests__/match-direct.test.ts` | 21 | Direct production tests |
| `__tests__/match-search.test.ts` | (search normalization) | Direct production tests |
| `__tests__/matching-workflow.test.ts` | (matching logic) | Direct production tests |
| `__tests__/permissions.test.ts` | (role set consistency) | Unit tests |
| `__tests__/review-db-safety.test.ts` | 4 | Direct production tests — DB error suppression |
| `__tests__/season-config.test.ts` | 8 | Contract/config tests |
| `__tests__/nav-model.test.ts` | (extended) | Contract tests |

---

## Raw Error Leak Sites Closed — 21 Total

All changed from `` `${SAFE_ERROR} (${err.message})` `` to `SAFE_ERROR` constant only.

| File | Function | Sites |
|------|----------|-------|
| `lib/events.ts` | `createEventLinkForEvent` | 3 |
| `lib/events.ts` | `setRegistrationLinkActive` | 3 |
| `lib/events.ts` | `getEventDetailData` (event load) | 1 |
| `lib/events.ts` | `getRegistrationDetail` (reg load) | 1 |
| `lib/matches.ts` | `getManualMatchingCandidates` | 4 |
| `lib/matches.ts` | `createManualMatch` | 3 |
| `lib/matches.ts` | `cancelMatch` | 2 |
| `lib/application-reviews.ts` | `assignApplicationReview` | 1 |
| `lib/application-reviews.ts` | `saveApplicationReviewDraft` | 1 |
| `lib/application-reviews.ts` | `submitApplicationReview` | 1 |
| `lib/application-reviews.ts` | `updateApplicationStatus` | 1 |
| **Total** | | **21** |

Server-side `log()` calls at each site are preserved (structured, `console.error`, never sent to browser).

---

## Authorization Checks Verified

| Server Action | Auth Chain | Result |
|---------------|-----------|--------|
| `toggleRegistrationLinkAction` | `ensureAuth()` → `getCurrentAdminUser()` + `canEditRecaps()` → `requireEventAdmin()` (library-level second check) | Correct — no unauthorized path |
| `approveApplicationAction` | `getCurrentAdminUser()` → `canDecide(role)` → input validation → `approveApplication()` | Correct — viewer/support/reviewer blocked before mutation |
| `assignApplicationReviewAction` | `getCurrentAdminUser()` → `canAssignReview(role)` | Correct |
| `saveApplicationReviewDraftAction` | `getCurrentAdminUser()` → `canReview(role)` | Correct |
| `submitApplicationReviewAction` | `getCurrentAdminUser()` → `canReview(role)` | Correct |
| `updateApplicationStatusAction` | `getCurrentAdminUser()` → `canAssignReview(role)` | Correct |

---

## Gate Results at Production Tip (6704a07)

| Gate | Result |
|------|--------|
| `npx vitest run` | **370/370 passed**, 14 test files |
| `npx next lint` | **No warnings or errors** |
| `npx tsc --noEmit` | **Clean (exit 0)** |
| `npx next build` | **Compiled successfully** |
| `git diff --check` | **Clean (exit 0)** |

---

## Preview Verification

- **Preview commit:** `6704a07`
- **Owner authorization:** `BATCH 3 FINAL PREVIEW READY; PROCEED PRODUCTION`
- **Claude terminal verification:** Not possible (no `gh` CLI, Vercel CLI prohibited per standing rules)
- **Manual verification:** Owner confirmed Preview at correct commit tip was Ready before production merge

---

## Operating Restrictions Still in Effect

The following restrictions remain in place until separately authorized:

- No production database writes
- No migrations
- No seed/import
- No recap sync
- No S11 counting-rule change
- No `.env.local` access
- No password-gate change
- No RLS change (Migration 057 not applied)
- No season flip (operating season remains UEHM-S11 per config)
- No public-application flag change
- No force-push
- No Vercel CLI deployment
- No automatic rollback

---

## Accepted Temporary MVP Mitigations (Still Active)

1. Event registration approval performed sequentially by one Event Steward until database-level concurrency protection is separately approved.
2. Application approval is non-transactional; on partial failure, retry the same application so the existing person/profile is reused.
3. Deep event check-in flows must pass isolated S12 UAT before go-live.

---

## Deferred Items (Batch 4)

The following raw-error patterns were identified during the Batch 3 sweep but are explicitly deferred. They are pre-existing, admin-facing only, and were not introduced by Batch 3.

| File | Pattern | Scope |
|------|---------|-------|
| `lib/data.ts` | Systemic `` `${VI_ERROR} (${table}: ${error.message})` `` across all data fetchers | All admin data queries |
| `lib/events.ts:278,316` | `selectAll`/`selectAllScopedBySeason` helpers return `error.message` | Data-loading helpers |
| `lib/events.ts:368,1802,1913` | `resolveSeasonId()` error flows into `createEvent`/`updateEvent` | Event mutation paths |
| `lib/events.ts:486` | `partsErr.message` combined into `errors[]` in `getEventDetailData` | Participation load partial error |
| `lib/events.ts:1869-2379` | `createEvent`, `updateEvent`, participation management functions | Event mutation paths |
| `lib/matches.ts:218,246` | `getMatchList` batch/match query errors | Match list data path |
| `lib/matches.ts:337` | Scope-guard branch in `getManualMatchingCandidates` | Admin-only scope filter |
| `lib/people-create.ts` | Profile creation error strings | Person/profile creation path |

---

## Unrelated Files — Confirmed Untouched

All 12 known unrelated untracked files remain present and unmodified:

1. `data_imports/ham/ham_summary_by_file.csv`
2. `data_imports/season11/build_s11_backfill_candidates.py`
3. `data_imports/season11/generate_backfill_sql.py`
4. `data_imports/uehm_s11_events/scripts/phase2_dedup.py`
5. `docs/HAM_S6_EXTERNAL_TEST_RELEASE_CHECKPOINT.md`
6. `extract_catalog.ps1`
7. `scripts/create-ham-staging-admins.mjs`
8. `scripts/extract_catalog.sql`
9. `scripts/generate_schema_diff_md.ps1`
10. `scripts/reset-two-staging-passwords.mjs`
11. `supabase_migrations/050_staging_profile_intake_batch_linkage.sql`
12. `temp_audit.mjs`

S11 historical data and configuration remain unmodified.

---

## Next Steps

**Batch 3 is closed.**

Do not automatically begin Batch 4. The following decisions require explicit owner authorization as a new separate directive:

1. **Batch 4 — S12 Go-Live Controls and Security Closure:** Address deferred raw-error patterns (lib/data.ts systemic VI_ERROR, createEvent/updateEvent paths, getMatchList, getManualMatchingCandidates scope path, people-create.ts). Define S12 activation preflight checklist. Safe season-transition procedure. Public-application open/close flow.

2. **Batch 5 — S12 UAT and Launch Closure:** Isolated end-to-end UAT (application → review → approval → profile → matching → event). Role-based Core Team UAT script. Go-live runbook. Incident/rollback procedure. Production accessibility sign-off.

**Product direction after launch-safety:** The next priority should return to Season 12 operational readiness — event and activity tracking for the S12 cohort, monthly operations reporting, and match management tooling — rather than continuing to expand security hardening indefinitely.

The minimum S12 launch path requires owner decisions on:
- Operating season transition from UEHM-S11 to UEHM-S12
- Public application form open/close timing
- Whether Migration 057 (RLS) should be applied to production before go-live
- Core Team UAT sign-off
