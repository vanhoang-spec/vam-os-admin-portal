# Operations Role Data Fix — R3

Base: `60b3456` (R2). Not deployed. No Production database access was made.

R3 answers the two blockers raised by independent review against R2, and settles a
test-count discrepancy that made the two sides' evidence non-comparable.

---

## A. Dependency security — PARTIALLY REMEDIATED, one blocker remains

`npm audit --omit=dev` at R2 reported four HIGH advisory groups: `nanoid`, `postcss`,
`ws`, and `next`.

### Cleared

Three were transitive and are closed by pinning them forward inside their existing
semver ranges. `overrides` is used rather than a direct bump because the vulnerable
copies are nested: `postcss` is pinned by Next at exactly `8.4.31`, and `nanoid` is
pulled in beneath it.

| Package   | Was     | Now      | Why the pin is in range                          |
|-----------|---------|----------|--------------------------------------------------|
| `postcss` | 8.4.31  | 8.5.26   | Next pins `8.4.31`; `overrides` lifts the nested copy. Same major. |
| `nanoid`  | 3.3.11  | 3.3.18   | `postcss` asks for `^3.3.11`. Satisfied.          |
| `ws`      | 8.20.0  | 8.21.3   | `@supabase/realtime-js` asks for `^8.18.2`. Satisfied. |

The direct `devDependency` on `postcss` was moved to `^8.5.23` so it agrees with the
override; npm rejects an override that conflicts with a direct dependency.

### NOT cleared — Next.js

**`next@14.2.35` carries 21 unfixed advisories (7 HIGH) and there is no patched 14.x.**

This is not a case of "not upgraded yet". It was verified against the registry:

* `14.2.35` **is** the end of the 14 line (`dist-tag next-14 = 14.2.35`, already installed).
* Every advisory's fixed boundary lies at `15.5.21` or below. With the `postcss`
  override applied, npm reports the remaining vulnerable range as `9.5.0 - 15.5.20`,
  which states the fix boundary exactly: **`next >= 15.5.21`**.
* The smallest patched release is therefore `15.5.23` (`dist-tag backport`), a
  **major version bump**. `16.3.0` is what `npm audit fix --force` proposes and is
  not required — it would be an unnecessary second major.

Per the R3 brief this is reported rather than silently risk-accepted, and R3 is
frozen without it. The migration is prepared separately (see below).

Reachability was inspected and is **not** offered as a reason to dismiss:
several advisories are plainly unreachable here (Pages Router i18n bypass — this is
App Router only; SSRF on custom servers — no custom server), but others are not
(Server Actions DoS, Server Function endpoint disclosure, RSC cache poisoning), and
the release gate is the audit result regardless.

### Prepared, not merged: branch `next-15-upgrade`

The Next 15.5.23 migration is prepared on its own branch for a scoped review and
staging cycle. Measured scope:

* async request APIs — `cookies()` / `headers()` now return Promises:
  `lib/supabase-server.ts`, `lib/data.ts` (`dataClient` and its call sites),
  `lib/admin-auth.ts`, `app/layout.tsx`, `app/events/[id]/page.tsx`.
* a fourth override, `sharp ^0.35.3`. Next 15 adds `sharp` as an **optional**
  dependency at `^0.34.3`, which is itself HIGH (`<0.35.0`); `next@16.3.0` pins
  exactly `^0.35.3`, so that version is the vetted one for the same optimizer code.
  This app uses `next/image` once, with `unoptimized` on a data-URI QR code, so
  `sharp` is never loaded at runtime.

**What that branch cannot prove without a deploy:** Next 15 changes runtime defaults
that no unit test observes — `fetch` is no longer cached by default, `GET` route
handlers are no longer cached, and the client router cache uses `staleTime: 0`. Those
need a staging environment, which is why the upgrade is not in R3.

---

## B. Events pagination

Seven reads in `lib/events.ts` could exceed the PostgREST 1000-row cap. All now use
the R2 contract in `lib/paged-read.ts`. `event_links` and `event_registrations` were
added to `PAGE_ORDER` (both `id uuid primary key default gen_random_uuid()`,
migration 051).

| Read | Site | Class |
|---|---|---|
| Workspace registration totals across event ids | `getEventListData` | C |
| Per-event participations | `getEventDetailData` | C |
| Per-event registrations | `getEventDetailData` | C |
| Public duplicate + capacity calculation | `registerForEvent` | C |
| Check-in registrant lookup + walk-in capacity | `checkInForEvent` | C |
| Confirmation capacity enforcement | `ensureRegistrationCapacityForConfirm` | C |
| Bulk-add profile candidates | `bulkAddEventParticipants` | C |
| Bulk-add existing participations | `bulkAddEventParticipants` | C |

The check-in read was not on the review's list but is the same defect on a write
path, so it is fixed here rather than left for R4.

Reads that are genuinely bounded are now stated as such at the call site with
`readBounded`, which fails loudly instead of reading a prefix: the `event_links`
lookup (bounded at 2 by `unique (event_id, link_type)`), the `people` email match,
and the check-in participation sync.

New helper `selectAllWhere` applies the caller's filter **inside** the per-page
factory, so every page of a read carries byte-identical predicates by construction
rather than by convention.

### Write decisions that depended on a complete read

Four of these reads decide a write. Ranked by how badly truncation ends:

1. **Bulk-add existing participations.** `event_participations` has **no**
   `unique(event_id, person_id)` constraint — migration 051 says so and defers it.
   The read is the only duplicate guard. Truncated, every member past row 1000 is
   re-inserted and the roster silently doubles, reported as success. No database
   backstop at all.
2. **Confirmation capacity.** `consumingCount` saturates at the cap, so a full event
   keeps confirming seats. A clean UPDATE; nothing catches it.
3. **Public registration capacity.** Same saturation on the public form. The
   duplicate half of that read has a backstop
   (`event_registrations_event_lower_email_active_uidx` → 23505 → `already_registered`);
   the capacity half has none, and overselling is a clean INSERT.
4. **Check-in.** A registrant past the cap is told they are not registered, and in
   open mode is re-created as a walk-in against a capacity figure computed from the
   same truncated list.

### Ordering

Keyset paging orders by `id`. `getEventDetailData` re-establishes the newest-first
display order in JS across the **whole** result, because re-applying
`registered_at DESC` per page would order pages internally and leave the newest rows
on the last page.

### Tests — `__tests__/events-pagination-contract.test.ts` (25)

The harness is a small PostgREST emulator that **actually enforces a row cap**, not a
stub returning canned arrays. A read that does not page cannot pass it. Two tests
assert the emulator caps, so the rest are not vacuous.

* BOUNDARY tests: >1000 rows reach the decision, exactly-1000 is not mistaken for
  exhaustion, filters re-apply per page, display order holds across pages.
* LATER-PAGE tests: page 1 succeeds, page 2 errors — the caller must report failure
  and perform **no write**. Asserted against recorded inserts and updates.
* Positive controls: genuinely-open events past the cap still accept writes, so the
  boundary tests are not passing merely by refusing everything.

**Verified load-bearing:** reverted against the pre-R3 `lib/events.ts`, 20 of the 25
fail. The 5 that pass are the 2 harness-fidelity tests and 3 positive controls.

---

## C. Test count discrepancy — RESOLVED

Claude previously reported **2274 / 92**; independent review at the same HEAD ran
**2049 / 88**. Both numbers were correct. They measured different trees.

The implementation worktree carries four **uncommitted** test files belonging to the
M066–M068 migration workstreams:

```
__tests__/migration-066-profile-source-application-compat.test.ts
__tests__/migration-067-profile-person-fk-compat.test.ts
__tests__/migration-068-admin-audit-action-compat.test.ts
__tests__/migration-068-r2-admin-audit-schema-compat.test.ts
```

Measured directly: those four files contain **225** tests.

```
2274 − 225 = 2049      92 − 4 = 88
```

The discrepancy is accounted for exactly, with no remainder.

### Canonical

* **Command:** `npm test` (`vitest run`). `vitest.config.ts` includes
  `__tests__/**/*.test.ts` and `__tests__/**/*.test.tsx`.
* **Inventory:** whatever is committed. At `60b3456` that was **88 files / 2049
  tests**; at R3 it is **89 files / 2074 tests** (+`events-pagination-contract`).
* The four migration test files are **out of R3 scope** and stay uncommitted. They
  gate the M066–M068 packages, which are prepared-but-unapplied and are not part of
  this release. They must be committed with their own packages, not folded in here.

A release inventory is only trustworthy from a clean checkout. `git ls-files
'__tests__/**/*.test.ts*' | wc -l` is the check; a worktree count is not.

---

## D. Gates

| Gate | Result |
|---|---|
| `npm audit --omit=dev` | CRITICAL 0, **HIGH 1 (`next`)** — the blocker above |
| Full suite (`npm test`) | 93 files / 2299 passed, 0 failed (worktree, incl. 4 uncommitted) |
| Committed-inventory equivalent | 89 files / 2074 |
| Pagination / event / operations / role-parity / auth / Server Action tests | included above, all passing |
| `npx tsc --noEmit` | clean |
| `npx next lint` | no warnings or errors |
| `npx next build` | succeeds |
| `git diff --check` | clean |
| Security review of the R3 diff | CRITICAL 0, HIGH 0, MEDIUM 0 |

**R3 does not meet the required `npm audit --omit=dev` HIGH=0 gate.** The single
remaining HIGH is `next`, and closing it requires the framework major tracked on
`next-15-upgrade`.
