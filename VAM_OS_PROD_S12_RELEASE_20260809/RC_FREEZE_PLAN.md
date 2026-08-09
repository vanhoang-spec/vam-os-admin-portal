# RC source-control freeze plan

**Nothing has been committed, pushed, tagged or deployed.** This is the
proposal.

| | |
|---|---|
| Branch | `migration-062-v3-membership-lifecycle` |
| Pre-freeze HEAD | `24556ad3519b64bc12e17eb33faa1128124be795` |
| Main branch | `main` (deployed Production app is `6abec74`, 52 commits behind this RC) |
| Existing tags | none — this repository has no tags at all |

---

## 1. Two commits, in this order

Evidence and release are separated so a reviewer can read the release diff
without 200 KB of staging packages in it.

### Commit 1 — evidence

```
chore(evidence): record owner-run Production probes and the staging M065–M068 R2 packages

The Production S12 release is derived from live object evidence and cites
these packages directly: the canonical 52-value audit vocabulary is copied
verbatim from M068 R2's preflight, and the 13-value transition vocabulary is
M065's DDL. Without them in the tree the release's two central constants
cannot be checked by a reviewer.

None of these packages has been applied to Production, and none may be:
every one is headed "STAGING ONLY".
```

Files:

```
.gitignore                                                   (M)
docs/audits/sql/VAM_OS_PROD_S12_RELEASE_FORENSIC_A_CATALOG_READONLY_PROBE.sql
docs/audits/sql/VAM_OS_PROD_S12_RELEASE_FORENSIC_A2_LEDGER_READONLY_PROBE.sql
docs/audits/sql/VAM_OS_PROD_S12_RELEASE_FORENSIC_B_DATA_READONLY_PROBE.sql
VAM_OS_M065_PACKAGE_20260807/
VAM_OS_M066_R2_PROFILE_SOURCE_APPLICATION_COMPAT_20260808/
VAM_OS_M067_PROFILE_PERSON_FK_COMPAT_20260808/
VAM_OS_M068_R2_ADMIN_AUDIT_SCHEMA_COMPAT_20260809/
__tests__/migration-066-profile-source-application-compat.test.ts
__tests__/migration-067-profile-person-fk-compat.test.ts
__tests__/migration-068-r2-admin-audit-schema-compat.test.ts
```

The `.gitignore` change carries three things: the pre-existing `.env*` rule
already in the working tree, plus `.tmp_*/` and `supabase/.temp/` added by this
freeze so execution artefacts and Supabase CLI state can never reach a release
commit by accident.

### Commit 2 — the release

```
feat(release): Production-specific S12 release package and Add-Role default fix

PREPARED — NOT APPLIED. Four ordered transactions covering the smallest safe
Production delta: the canonical 52-value audit vocabulary, the Day-1 RLS and
grant minimum, the membership lifecycle RPC family with the trusted-context
remediation built in, and a Probe-C-gated execution grant. M066 and M067 are
classified NOT REQUIRED on live evidence and are asserted rather than replayed.

Also fixes the Add-Role form silently pre-selecting the first Program, the
first Season and Mentor, which could write a membership for the wrong
program/season/role for an approved candidate.
```

Files:

```
VAM_OS_PROD_S12_RELEASE_20260809/
docs/audits/sql/VAM_OS_PROD_S12_CLEANUP_FORENSIC_D_TEST_RECORDS_READONLY_PROBE.sql
app/people/[id]/membership-lifecycle-controls.tsx            (M)
__tests__/membership-add-role-no-default-selection.test.tsx
```

`app/people/[id]/membership-lifecycle-controls.tsx` is the **only** application
file that changes in this release.

---

## 2. Explicitly excluded

| Excluded | Why |
|---|---|
| `.tmp_675bb380…/`, `.tmp_c64bf475…/` ×4, `.tmp_db81a8dc…/`, `.tmp_r3/` | agent scratch directories — staging execution artefacts. Now gitignored. |
| `supabase/.temp/` | Supabase CLI machine state: linked project ref, platform versions. |
| `.env`, `.env.local`, any credential | never committed. `.env*` is gitignored. |
| `test-results/`, `.next/`, `tsconfig.tsbuildinfo` | build and browser-test output. |
| `uat-apply-20260805-01.log` | staging execution log. |
| `VAM_OS_M066_PROFILE_SOURCE_APPLICATION_COMPAT_20260808/` (R1) | superseded by R2; R2 is the cited evidence. |
| `VAM_OS_M068_ADMIN_AUDIT_ACTION_COMPAT_20260809/` (R1) | superseded by R2; R1's preflight assumed a 9-column table that does not exist on either environment. |
| `__tests__/migration-068-admin-audit-action-compat.test.ts` | tests the superseded R1. |
| `VAM_OS_M064_PACKAGE_20260807/` (outside the repo) | applied to staging, not to Production, and its remediation is inlined in T3 rather than replayed. Stays where it is. |
| Any diagnostic output or scratch SQL | not release content. |

---

## 3. Proposed RC tag

```
git tag -a rc-prod-s12-20260809 -m "VAM OS Production Season 12 RC — package PREPARED, NOT APPLIED"
```

**`rc-prod-s12-20260809`**, on commit 2. First tag in the repository, so the
convention starts here: `rc-<target>-<scope>-<YYYYMMDD>`.

The tag marks the code the Production database delta was derived against. It
does **not** mean applied, and it does **not** mean deployed.

## 4. What the freeze does not do

* **No push.** Both commits are local until the owner says otherwise.
* **No deploy.** Vercel Production stays on `6abec74` until the owner promotes
  it deliberately. Note the ordering constraint: **the RC must be deployed
  before T4 is applied**, because Probe C proves the *deployed* key's context,
  and lifecycle is only reachable from RC code.
* **No merge to `main`.** The RC is 52 commits ahead and not an ancestor of
  `main`; that merge is its own decision.
* **No SQL applied, no record deleted, no credential rotated.**

## 5. Gate results at freeze

| Gate | Result |
|---|---|
| `npm run test -- --run` | **79 files, 1968 tests passed** |
| `npm run typecheck` | **clean** |
| `npm run lint` | **no ESLint warnings or errors** |
| `npm run build` | **succeeded** |
| `git diff --check` | **clean** |

Plus, outside the required gates: the whole SQL package was executed against a
disposable `postgres:17-alpine` reproduction of the Probe A/B baseline —
preflight, T1–T4, verifier 24/24, tests 23/23, and the complete R4→R3→R2→R1
reversal after which the preflight passes again with an identical baseline
token. See `VALIDATION.md`.
