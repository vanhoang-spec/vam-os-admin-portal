# VAM OS — WP1-A2 Canonical Staff Scope Convergence

**Package status: AUTHORED, LOCALLY VALIDATED, NOT EXECUTED. Nothing in this package has been run against Production or Staging.**

Date: 16 Aug 2026
Base: `f8bdfafcbf1a3e18151d7d679da66fa6fb353100`
Branch: `fix/wp1a-canonical-scope`

| File | Purpose | Writes? |
|---|---|---|
| `staff_scope_manifest_v2.json` | The owner-approved staff convergence manifest: six inventoried rows, their exact current values, and their approved targets | No |
| `preflight_v2.sql` | Read-only proof that the manifest is safe to apply, and the `SAFE_TO_APPLY_V2` gate | No |
| `preflight.sql` | V1. Read-only classification of Production `admin_scope_access` and the `SAFE_TO_APPLY` gate. Preserved as prior evidence | No |
| `apply.sql` | **The convergence.** One transaction: locks, preconditions, audit pre-image, six in-place conversions, six inserts, six constraints, postconditions | **Yes — once** |
| `verifier.sql` | Read-only proof of the post-apply state, and the `A2_VERIFIED` gate | No |
| `rollback.sql` | Emergency reversal to the exact pre-A2 state, with its own eligibility guards | **Yes — emergency only** |

The three migration files were authored **only after** the owner ran `preflight_v2.sql` against Production on 16 Aug 2026 and it returned `SAFE_TO_APPLY_V2 = true` with every gating check passing: 6 rows (5 active, 1 inactive), 0 unknown rows, 0 drift, 0 target collisions, 0 projected constraint blockers, 4/4 real Admin accounts usable, 2/2 test accounts exact, and all `[DEMO_VIEWER_*]`, `[LIEU_LEGACY]`, `[HISTORICAL_INACTIVE]`, `[NO_REACTIVATION]` and `[RPC_COMPAT]` checks PASS. That result is the evidence this package's write set is built on; sections 12–15 describe what was built.

**Authoring is not authorization.** `staff_scope_manifest_v2.json` still carries `apply_authorized: false`, and a test asserts it. The owner executes deliberately, after independent security review, following the runbook in §13.

> The manifest's `gates.production_result` still reads `UNKNOWN_UNTIL_OWNER_EXECUTES`. That field is now stale — the owner has executed — and it is **deliberately left unedited**: the manifest is the locked owner decision record, and this authoring pass was scoped to the three SQL files, the tests and this README. The Production result is recorded here instead.

**Sections 1–6 describe WP1-A2 as originally scoped — the single UEH Admin row. Sections 7–11 supersede that scope with the full owner-approved staff manifest.** The earlier sections are kept because the V1 preflight and its findings are still the evidence baseline for the table's shape and its lack of constraints.

**Owner decision of 16 Aug 2026:** `viewer.vam.test@redsquarevietnam.com` is **retained as a controlled demo viewer, not retired** — see §7.4 for the disposition and §11 for the operating rules. Every one of the six inventoried rows now carries an encoded disposition, so this package's remaining gate is the owner's own read-only run against Production.

---

## 1. What WP1-A2 will do (documented here, performed nowhere)

The UEH Admin (`uehmentoring@gmail.com`) holds one active grant that stores a program **name** and a season **code**:

```
program_id = "UEH Mentoring"      -- program NAME; resolves nowhere in the application
season_id  = "UEHM-S11"           -- season CODE; resolves in the app, not in the RPC
role       = "full_access"
status     = "active"
```

WP1-A2 converts that row in place and adds the missing Season 12 grant:

```
-- row 1: UPDATE in place — id and created_at preserved
program_id = "61701ee8-64a6-4673-b261-ba12ce9a3ee3"   -- UEHM
season_id  = "710f4ec9-1cf7-461e-98d4-f33799047add"   -- UEHM-S11 (history)
role       = "full_access"   status = "active"

-- row 2: INSERT
program_id = "61701ee8-64a6-4673-b261-ba12ce9a3ee3"   -- UEHM
season_id  = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1"   -- UEHM-S12 (operating)
role       = "full_access"   status = "active"
```

**WP1-A2 does not create a program-wide grant.** A grant with `season_id IS NULL` is refused by `public.vam063_authorized_for_scope`, whose predicate is `s.season_id = p_season_id::text` — `NULL = 'uuid'` yields NULL, so the `exists` is false. A program-wide-only Admin would read Season 12 correctly and be denied every membership lifecycle mutation. Program-wide semantics require a one-predicate change to that function and belong to **WP1-A3, in its own release window**.

### Why this is a scope fix and not a data fix

Nguyễn Đức Thắng's Season 12 membership is present, canonical and correct. It is invisible to the Admin because `getAllowedSeasonIds` resolves the grant `"UEHM-S11"` to `[S11 uuid]` and stops there — a season-bearing grant never widens to its program — and `getPersonSeasonMemberships` then applies `.in("season_id", [S11 uuid])`. No membership row is created, corrected or touched by WP1-A2.

---

## 2. Running the preflight

Read-only. It contains no INSERT, UPDATE, DELETE, MERGE, TRUNCATE, COPY, DDL, GRANT or function definition, and each of its two blocks runs inside `BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;`, so the session refuses a write with SQLSTATE `25006` even if the file is later edited carelessly.

1. `set timezone = 'UTC';`
2. Run **BLOCK 1** — the per-row classification inventory.
3. Run **BLOCK 2** — the named checks and the `SAFE_TO_APPLY` verdict.

Run the blocks separately if your client returns only the last result set; they are independent and each carries its own read-only guard. Record both outputs in full.

**No warning is a pass.** A check is `INFO` only where its failure could not make the planned migration fail. Everything that could is a `FAIL`, and any `FAIL` sets `SAFE_TO_APPLY = false`.

### `SAFE_TO_APPLY = true` requires all of

- the UEH Admin resolves to exactly one active `admin_users` row with role `admin` and a non-null `auth_user_id`, holding exactly one active grant;
- `UEHM`, `UEHM-S11` and `UEHM-S12` each resolve exactly once, at the expected UUID, with correct ownership;
- the program name `"UEH Mentoring"` is carried by exactly one program (the conversion resolves the live grant by name);
- zero UNCONVERTIBLE active grants;
- zero rows of **any** status that would violate a planned constraint after conversion;
- zero grants with a null or blank `program_id`, active or not;
- zero target-key duplicates among active grants;
- the planned constraint and index names are unused, and the server is PG15+.

---

## 3. Classification model

Each row is classified on five axes, and the worst axis wins.

| Axis | CANONICAL | CONVERTIBLE | UNCONVERTIBLE |
|---|---|---|---|
| **User linkage** | `user_id` matches exactly one `admin_users.auth_user_id` | — | zero matches (orphan) or more than one (ambiguous) |
| **Program** | the stored text **is** a `programs.id` | a code or name resolving to exactly one program | NULL/blank, unknown, or ambiguous |
| **Season** | a `seasons.id` owned by the resolved program (or NULL — see below) | a code resolving to exactly one season owned by the resolved program | unknown, ambiguous, malformed, or owned by a **different** program |
| **Scope level** | `full_access` / `operations` / `review` / `read` | — | anything else, including NULL |
| **Status** | `active` / `inactive` | — | any other value (NULL is reported as `NULL_STATUS`) |

A season belonging to another program is reported as UNCONVERTIBLE rather than repaired. It is not a formatting defect — it is a cross-program authority claim, and silently rewriting it would decide an authorization question the migration has no standing to decide.

`season_id IS NULL` is classified `CANONICAL_PROGRAM_WIDE`: structurally valid, permitted by the planned CHECK, and therefore not a blocker — but reported as INFO, because such a grant is currently refused by `vam063_authorized_for_scope` and its holder would read across the program while being denied every lifecycle mutation.

### Inactive rows are classified too

WP1-A2 rewrites **active** grants only, but the planned NOT NULL and CHECK constraints are **table-wide**. A retired grant holding a non-canonical program identity would abort the migration at the constraint step even though no live authority depends on it. Check `[CONSTRAINT_ROW]` counts those rows separately so WP1-A2's write set can be scoped correctly before it is written rather than discovered mid-transaction.

---

## 4. Planned constraints — NOT APPLIED BY THIS PACKAGE

Validated as feasible by the preflight; authored and applied later, after the conversion, in the same transaction.

| # | Constraint | Name |
|---|---|---|
| 1 | `program_id` NOT NULL | `admin_scope_access_program_id_not_null` |
| 2 | `program_id` is a canonical UUID string | `admin_scope_access_program_id_canonical_check` |
| 3 | `season_id` is NULL or a canonical UUID string | `admin_scope_access_season_id_canonical_check` |
| 4 | `role IN ('full_access','operations','review','read')` | `admin_scope_access_role_check` |
| 5 | `status IN ('active','inactive')` | `admin_scope_access_status_check` |
| 6 | partial unique index on active scope | `admin_scope_access_active_scope_key` |

**Scope level is not part of the uniqueness key.** `supabase_migrations/020` keys its equivalent index on `(user_id, program_id, season_id, role)`, which permits an active `read` grant and an active `full_access` grant on the identical scope, resolving silently to the stronger one. That index was never applied to Production and must not be carried forward.

### Unique index representation

```sql
create unique index admin_scope_access_active_scope_key
  on public.admin_scope_access (user_id, program_id, season_id)
  nulls not distinct
  where status = 'active';
```

`NULLS NOT DISTINCT` (PG15+) is chosen over a sentinel expression such as `coalesce(season_id, '')`. A sentinel makes the index depend on a value that is only unrepresentable *because* constraint 3 forbids it, so the two objects become load-bearing for each other; and any sentinel — empty string, nil UUID — is a value the column could in principle hold. `NULLS NOT DISTINCT` states the intent directly: two program-wide grants for one user collide, which is exactly the rule. The preflight's `[PGVERSION]` check gates on `server_version_num >= 150000`; migration 062 already relies on `pg_index.indnullsnotdistinct`, so the platform is known to be PG15+.

### NULL semantics, stated explicitly

Constraints 4 and 5 are NULL-permissive by SQL semantics: a NULL `role` or `status` **satisfies** `x IN (…)`. Only `program_id` is protected against NULL, by constraint 1. This is why:

- WP1-A1 drops a NULL/unrecognised scope level at read time in the application, rather than relying on the database to reject it;
- the preflight reports NULL-status rows as INFO with a recommendation, instead of pretending constraint 5 would catch them.

**This open question is now closed by the owner.** The WP1-A2 contract of 16 Aug 2026 requires `role` NOT NULL and `status` NOT NULL, so `apply.sql` folds an `IS NOT NULL` conjunct into constraints 4 and 5 — see §12.2 for why it is a conjunct rather than a column attribute.

---

## 5. Not in scope for WP1-A2

- Program-wide UEHM Admin grant and the `vam063_authorized_for_scope` predicate change — **WP1-A3**.
- Foreign keys on `user_id`, `program_id`, `season_id`; UUID column conversion — safe follow-up.
- Staff provisioning and CSV — **WP1-C**.
- Season-first operating context and the season selector — **WP1-D**.
- Reviewer PII on `/matches` and `/matches/[id]` — **PRE-REVIEWER-ROLLOUT BLOCKER**, tracked separately. Reviewer accounts must not be broadly activated until it is closed. No file in this package touches that path. It is also why `CANONICALIZE_AS_REVIEWER` was refused for the demo account (§7.4).
- VAM062 replay; M070; trusted-context redesign; `seasons.status` remediation.

---

## 6. Validation performed on this preflight

The SQL was executed against a throwaway local PostgreSQL 15 container seeded with a fixture reproducing the Production shape (`admin_scope_access` with a primary key and no other constraint) and the owner-supplied catalog and grant data. Production was not contacted at any point.

- **Baseline scenario** (the live row alone): `SAFE_TO_APPLY = true`; the row classifies CONVERTIBLE with `target_program = 61701ee8-…` and `target_season = 710f4ec9-…`, matching the approved conversion above.
- **Hostile scenario** (11 additional rows): every branch classified as intended — orphan linkage, unknown program, cross-program season, unrecognised scope level, NULL scope level, null program, out-of-vocabulary status, target-key duplicate, inactive constraint blocker, program-wide INFO, NULL-status INFO. `SAFE_TO_APPLY = false`, naming all six failing checks.
- **Ambiguity scenario** (a second program named `UEH Mentoring`): `[PROGRAM]` name-uniqueness fails **and** the live row flips from CONVERTIBLE to UNCONVERTIBLE — the conversion refuses to guess which program the name meant.
- **Read-only guard**: `UPDATE` and `DELETE` inside the preflight's transaction are rejected with SQLSTATE `25006`.

---

# WP1-A2 · Staff scope convergence (V2)

## 7. The manifest, and why it is keyed on `scope_id`

`staff_scope_manifest_v2.json` is the owner-approved decision record. Every conversion in it is addressed by an exact `(scope_id, email)` pair. Nothing is derived from a stored legacy string, and `preflight_v2.sql` carries the same manifest verbatim so it can run standalone against Production.

The reason is visible in the inventory itself. **Four rows store the program identity `"VAM"`, and that one string means four different things:**

| Row | Stored today | Outcome |
|---|---|---|
| Hoàng `60ef3d0b…` | `VAM` / `UEHM-S11` / `operations` / active | converts **up** to UEHM / S11 / `full_access`, stays active |
| Toàn `1e58beb9…` | `VAM` / `UEHM-S11` / `operations` / active | converts **up** to UEHM / S11 / `full_access`, stays active |
| demo viewer `487a7562…` | `VAM` / `UEHM-S11` / `operations` / active | **retired**; account gets UEHM / S12 / `read` instead |
| admin test `eaa60d5c…` | `VAM` / `UEHM-S11` / `full_access` / inactive | identifiers canonicalized, stays inactive |

Hoàng's and the demo account's rows are indistinguishable in every stored field, and the owner's decisions on them point in **opposite directions** — one gains Admin authority, the other loses all of it. A rule of the form *"`VAM` means UEHM"* would treat all four alike and would hand a shared demonstration login real, working authority in Production. There is no such rule anywhere in this package, and a test asserts there never will be.

### The six rows

| Key | Account | Classification | Target |
|---|---|---|---|
| `ueh_shared_admin` | uehmentoring@gmail.com · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `lieu` | lieu.nguyen@hoatay.com.vn · admin · active | `RETIRE_LEGACY_PROGRAM_WIDE` | legacy row retired in place + S11 and S12 inserted |
| `hoang` | hoang.nguyen@embassy.edu.vn · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `toan` | lyductoan@gmail.com · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `synthetic_viewer_test` | viewer.vam.test@… · reviewer · active | `REPURPOSE_AS_CONTROLLED_DEMO_VIEWER` | S11 retired in place · role → `viewer` · S12 `read` inserted |
| `historical_admin_test` | admin.vam.test@… · admin · inactive | `HISTORICAL_CANONICALIZE_ONLY` | identifiers only, status untouched |

All four Admins keep platform role `admin` by explicit owner decision, and `[STAFF_IDENTITY]` fails if Production disagrees. **WP1-A2 changes exactly one platform role in total** — the demo account, `reviewer` → `viewer` — and `[DEMO_VIEWER_ROLE]` fails if any other account acquires a platform target.

The vocabulary carries one addition, `ADD_S11`, used once. Liễu has no S11 row that could be converted, because her only row is program-wide — see §7.2.

### 7.1 Interim target for all four Admins

```
UEHM / UEHM-S11 / full_access / active     -- Season 11 history stays readable
UEHM / UEHM-S12 / full_access / active     -- Season 12 operating authority
```

Both grants are explicit season grants because `public.vam063_authorized_for_scope` compares `s.season_id = p_season_id::text` and filters `s.role in ('full_access','operations')`. A canonical-UUID, `full_access`, active, season-bearing grant satisfies every predicate that function applies, so **A2 needs no change to the RPC and makes none**. Check `[RPC_COMPAT]` reads the function's definition from `pg_get_functiondef` to prove this; it never invokes it.

### 7.2 Liễu, and why her row cannot simply be converted

Her row is `UEHM` / `season_id NULL` / `"admin"` / active. It cannot remain active after A2 for two independent reasons:

- **`"admin"` is not a canonical scope level.** The base code coerced it to `read`, which is why she has real working read authority today. WP1-A1 drops it instead — so **deploying A1 before A2 converges her removes that authority and replaces it with nothing.** This is the release-ordering constraint the A1 review identified.
- **`season_id IS NULL` is refused by the live RPC.** `NULL = 'uuid'` yields NULL, so the `exists` is false. A program-wide holder reads across the program and is denied every lifecycle mutation. Program-wide semantics need a predicate change and are **WP1-A3**.

The plan therefore **retires the row in place** — id and `created_at` preserved, status `inactive`, never deleted — and inserts two explicit season grants beside it. It is deliberately *not* rewritten into a UEHM/S11 grant: it was a program-wide claim, and converting it in place would make the audit record describe something that never happened.

One value cannot survive: the table-wide `role` CHECK makes the literal `"admin"` unrepresentable on any row, retired or not. The retired row therefore records `full_access` — the authority the owner says the account was meant to have — and the manifest keeps the pre-image. **The apply must copy that pre-image into `admin_audit_log` before rewriting it.** The only alternative is to not apply the `role` CHECK at all, which leaves the vocabulary unenforced table-wide; that is an owner call, and it is recorded in the manifest rather than assumed.

### 7.3 The inactive historical row

It is in the plan only because the planned constraints are **table-wide**. The required canonicalization is exactly `program_id "VAM" → 61701ee8…` and `season_id "UEHM-S11" → 710f4ec9…`. The program identity is derived from **the program that owns this row's own season** — proved by `[SEASON_S11]` — never from the string `"VAM"`.

**Changing a stored identifier is not the same act as restoring authority**, and V2 keeps them separate: the account is inactive, the grant is inactive, the planned unique index is partial on `status = 'active'`, and every read path filters `status = 'active'`. `[NO_REACTIVATION]` fails if any target would flip an inactive row to active, or issue an active grant to a non-active account.

### 7.4 The controlled demo viewer — the owner's final decision

`viewer.vam.test@redsquarevietnam.com` **is retained, not retired.** The owner changed the earlier disposition on 16 Aug 2026: the account is kept alive as a **controlled demo / view-only login** for people who have not yet been provisioned individual staff accounts, and is stripped of everything else.

| | Today | After A2 |
|---|---|---|
| platform role (`admin_users`) | `reviewer` | **`viewer`** |
| account status | `active` | `active` (unchanged) |
| UEHM / S11 scope | `operations`, **active** | `operations`, **inactive** — canonicalized, retired in place |
| UEHM / S12 scope | none | **`read`, active** — one new row |

It must **not** have reviewer authority, `operations`, `full_access`, any active S11 authority, approval ability, review ability, or mutation authority. Three named checks would fail if it did.

#### Why retire-and-insert rather than update in place

This is the same semantic rule already applied to Liễu (§7.2), running the other way:

> **Update in place when the row's meaning is unchanged and only its spelling is wrong; retire and insert when the row's meaning itself is being replaced.**

The existing row *means* "Season 11 operations authority". The account will hold *Season 12 read authority*. That is a replacement of meaning, not a spelling correction, so the row is **retired in place** — `id` and `created_at` preserved, never deleted — and the new authority is a new row. Rewriting the S11 row into an S12 `read` row would make its `created_at` describe a grant that did not exist then, and would erase the only record that this account ever held operations authority.

One difference from Liễu's retirement: her level `"admin"` could not be preserved, because the table-wide `role` CHECK makes that literal unrepresentable. This row's level `operations` **is** preserved, because `operations` is already canonical — so the retired row keeps saying exactly what the account actually held, and no pre-image rewrite is needed beyond the identifiers.

#### `CANONICALIZE_AS_REVIEWER` is now explicitly refused

It was one of the three options put to the owner and it is off the table. The reviewer PII gap on `/matches` is still open, and this account is about to be shared with precisely the population that must not see reviewer-level PII.

#### Why `read` is inert, at three layers

- `vam063_authorized_for_scope` filters `s.role in ('full_access','operations')` — every membership lifecycle mutation is refused.
- `lib/program-scope.ts` `canOperateSeason` accepts only `full_access`/`operations`; `canReviewSeason` only `full_access`/`review`. `read` fails both, so the account cannot approve or review an application.
- The platform role `viewer` makes `app/matches/[id]/page.tsx` redirect away and `app/matches/page.tsx` render in PII-suppressed mode.

#### The gate did not disappear when the owner decided

`[SYNTHETIC_DISPOSITION]` still exists and still gates the verdict. It stopped asking *"has anyone decided?"* and now asks *"is what is encoded exactly the decision, and nothing wider?"* It fails if the flag is set without the three targets, if any target's shape differs by one field, or if a fourth target appears for this account. Five further named checks prove the post-plan account cannot review, operate, approve, or reach Season 11:

| Check | Expects |
|---|---|
| `[DEMO_VIEWER_ROLE]` | target platform role `viewer` (from `reviewer`); 0 platform targets on any other account |
| `[DEMO_VIEWER_ACCOUNT_STATUS]` | `active` today, `active` after; status change = none |
| `[DEMO_VIEWER_S12_SCOPE]` | exactly **one** active grant in total, and it is UEHM / S12 / `read` |
| `[DEMO_VIEWER_S11_ACTIVE]` | **0** active S11 grants; the old row present, inactive, canonical, level `operations` |
| `[DEMO_VIEWER_MUTATION_SCOPE]` | **0** active `operations` / `full_access` / `review` grants |

**These prove what the database grants. They do not prove every application route is PII-safe for a viewer.** Browser role UAT with Anti is required separately — see §11.

---

## 8. Running `preflight_v2.sql`

Read-only, in three independent blocks, each wrapped in `begin; set transaction read only; … rollback;`. It contains no DML, no DDL and no function invocation — the RPC is read from the catalog, not called.

1. `set timezone = 'UTC';`
2. **BLOCK 1** — exact staff identity and exact source rows, one output row per manifest entry.
3. **BLOCK 2** — the target plan, with two independent collision counts per target.
4. **BLOCK 3** — the named checks and the `SAFE_TO_APPLY_V2` verdict.

Record all three outputs in full. **No warning is a pass.** A check is `INFO` only where its failure could not make the migration fail; everything that could is a `FAIL`, and any `FAIL` sets `SAFE_TO_APPLY_V2 = false`.

### The Production result is UNKNOWN until the owner runs it

Every one of the six inventoried rows now carries an encoded owner disposition, so this package no longer has an *expected* failure. Against the exact locked fixture it reaches `SAFE_TO_APPLY_V2 = true` (§10). **Against Production the result is unknown, and nothing in the file asserts otherwise** — the verdict is derived from the checks at run time, and a test asserts that no `'PASS'` literal exists outside the true-branch of a CASE.

A `FAIL` in Production therefore means Production disagrees with the locked manifest. The response is to **re-cut the manifest from a fresh owner inventory**, never to adjust the target to fit what was found.

### The disposition still cannot be widened by one edit

Setting `synthetic_disposition_authorized` to `true` was never sufficient on its own and still is not. `[SYNTHETIC_DISPOSITION]` reads the flag **and** the three encoded targets **and** two "nothing beyond this" counters:

- `scope_target_count = 2` and `platform_target_count = 1` — the disposition is not partially encoded;
- `s11_retire_encoded = 1` and `s12_read_encoded = 1` — each target matches the owner's decision field for field;
- `scope_targets_beyond_decision = 0` — no fourth target was added for this account;
- `platform_targets_on_other_accounts = 0` — no other account acquired a platform-role change.

So the flag cannot widen the disposition, and targets cannot act without the flag.

### What `SAFE_TO_APPLY_V2 = true` requires

- all six manifest rows exist exactly once, owned by the account the manifest names, with **every stored value still matching the inventory** — drift is a `FAIL`, not a warning, because the owner approved a conversion of specific values;
- all four Admin accounts resolve to exactly one `admin_users` row each, role `admin`, status `active`, `auth_user_id` non-null;
- `UEHM`, `UEHM-S11`, `UEHM-S12` each resolve exactly once, at the expected UUID, with correct ownership;
- zero rows in the table that the manifest does not account for;
- zero target-key collisions, measured three ways — against existing rows, against the manifest itself, and against the post-plan table;
- the legacy program-wide row is in its known shape, and the plan leaves no active program-wide grant behind;
- the demo account's encoded plan is **exactly** the owner-approved disposition, and nothing wider;
- the demo account ends with platform role `viewer`, status `active`, exactly one active grant (UEHM/S12 `read`), no active S11 grant, and no `operations`/`full_access`/`review` grant;
- zero rows of **any** status violating a planned constraint after the plan;
- no reactivation, and no active grant issued to a non-active account;
- the live RPC accepts the planned targets unchanged.

---

## 9. The A2 apply — the design, now implemented

> This section was written before the apply existed. It is kept as the design of record; §12 documents what was actually built and where it went further.

`apply.sql` is a single transaction in this order:

1. **Lock and re-read the exact rows.** `select … where id in (…) for update`, addressed by the six manifest `scope_id`s. Never by a `program_id` pattern.
2. **Re-verify every source value inside the transaction.** Compare against the same inventory literals the preflight used, and `raise exception` on the first mismatch. The preflight proves the state at read time; only this step proves it at write time.
3. **Copy every pre-image to `admin_audit_log`** before any row is modified — most importantly Liễu's `"admin"` level and Hoàng's and Toàn's `operations`/`VAM` values, which no CHECK-compatible column can preserve.
4. **Canonicalize each Admin's S11 authority**, per the table below.
5. **Add the four S12 grants idempotently** — insert only where no active grant already holds the canonical key, so a re-run is a no-op rather than a duplicate.
6. **Retire Liễu's legacy row in place.** Never `DELETE`.
7. **Touch the synthetic and historical rows only as the encoded owner disposition allows**, and never in a way that changes `status` on the historical row.
8. **Add the constraints last**, once every row complies.
9. **Re-verify inside the transaction** — re-run the preflight's gating predicates as assertions.
10. **Commit only if every invariant holds**; otherwise let the exception roll the whole thing back.

### Update in place, or retire and insert?

| Row | Recommendation | Why |
|---|---|---|
| UEH shared Admin `68fe466c…` | **UPDATE IN PLACE** | Same account, same season, same authority; only the identifiers change. The row's meaning stays true, and `id`/`created_at` remain a stable audit anchor. |
| Hoàng `60ef3d0b…` | **UPDATE IN PLACE** | The row already claims Season 11 for this account. Retire-and-insert would open an authority gap mid-transaction and orphan the audit anchor for no gain. The level rise to `full_access` is the owner's explicit decision and belongs in `admin_audit_log`, not in a new row. |
| Toàn `1e58beb9…` | **UPDATE IN PLACE** | Identical reasoning. |
| Liễu `17a86485…` | **RETIRE IN PLACE + INSERT ×2** | The only row where converting in place would *misrepresent history*: a program-wide claim is not a season grant. Retirement keeps the record true; the two inserts carry the authority forward. |
| historical `eaa60d5c…` | **UPDATE IN PLACE** | Identifiers only. A new row would create a second historical artifact for one retired grant, and inserting anything for an inactive account is exactly the shape `[NO_REACTIVATION]` exists to refuse. |
| demo viewer `487a7562…` | **RETIRE IN PLACE + INSERT ×1** | Same rule as Liễu. The row means "S11 operations"; the account will hold "S12 read". The meaning is replaced, so the row is retired — level `operations` preserved, since it is already canonical — and the new authority is a new row. Plus one `admin_users` update: `reviewer` → `viewer`. |

The rule behind the table: **update in place when the row's meaning is unchanged and only its spelling is wrong; retire and insert when the row's meaning itself is being replaced.** Deletion never appears, in any branch.

The demo account is the only case where the apply also touches `public.admin_users`. That update is keyed on the exact email, sets `role = 'viewer'`, and must **not** touch `status`. Its pre-image belongs in `admin_audit_log` alongside the scope pre-images.

### Constraints, added last

Unchanged from §4, and validated table-wide by `[CONSTRAINT_ROW]` against the post-plan projection rather than against active rows only:

`program_id` NOT NULL + canonical UUID-text CHECK · `season_id` NULL or canonical UUID-text · `role IN (full_access, operations, review, read)` · `status IN (active, inactive)` · one active grant per `(user_id, program_id, season_id)` with `NULLS NOT DISTINCT`, **scope level excluded from the key**.

### Expected post-state

| | Count | Detail |
|---|---|---|
| active grants | **9** | four Admins × {S11, S12} at `full_access` (8) + the demo viewer's UEHM/S12 `read` (1) |
| inactive grants | **3** | Liễu's retired program-wide row, the demo viewer's retired S11 row, the historical test row |
| platform-role changes | **1** | `viewer.vam.test@…` only: `reviewer` → `viewer` |
| rows deleted | **0** | in every branch |
| undisposed rows | **0** | all six inventoried rows now carry an encoded disposition |

Per account, after the plan:

- **UEH shared Admin** — S11 `full_access` active, S12 `full_access` active
- **Liễu** — legacy program-wide row inactive/history-safe, S11 `full_access` active, S12 `full_access` active
- **Hoàng** — S11 `full_access` active, S12 `full_access` active
- **Toàn** — S11 `full_access` active, S12 `full_access` active
- **Controlled demo viewer** — platform role `viewer`, account active, S11 `operations` **inactive**, S12 `read` active, **no active S11 grant**
- **Historical inactive admin test** — account inactive, scope inactive, identifiers canonical, **no new authority**

---

## 10. Validation performed on V2

Executed against a throwaway local PostgreSQL 15.18 container seeded with a fixture reproducing the Production shape (`admin_scope_access` carrying a primary key and nothing else), the owner-supplied catalog, the six inventoried rows, and `vam063_authorized_for_scope` copied verbatim from `supabase_migrations/063`. **Production and Staging were not contacted at any point.**

- **Baseline** — all six rows report `EXACT`; the twelve targets report the planned actions from §9; **every gating check passes and `SAFE_TO_APPLY_V2 = true`.** The demo-viewer checks report `scope_targets=2/2 platform_targets=1/1 s11_retire_exact=1 s12_read_exact=1 beyond_decision=0`, `today=reviewer target=viewer`, `active_total=1 active_s12_read=1`, `active_s11=0 s11_row_retired_canonical=1`, and `0 mutation/review-capable active grant(s)`.
- **Wrong scope_id** (the fixture's UEH row placed at a transposed UUID) — `[SOURCE_ROW]` reports `5 of 6 found`, and `[UNKNOWN_ROW]`, `[STAFF_LINKAGE]`, `[SOURCE_DRIFT]` and `[VAM_LEGACY]` all fail. A mistyped identity cannot convert the wrong row; it converts nothing and stops the run.
- **Drift** (Hoàng's level altered) — `[SOURCE_DRIFT]` fails and his BLOCK 1 verdict flips to `BLOCKED`.
- **Unknown row** (a seventh active grant) — `[UNKNOWN_ROW]` and `[VAM_LEGACY]` both fail; it is not silently converted.
- **Historical row secretly active** — `[HISTORICAL_INACTIVE]` and `[SOURCE_DRIFT]` fail.
- **Admin account suspended** — `[STAFF_IDENTITY]` fails, and `[NO_REACTIVATION]` fails because the plan would issue active grants to a non-active account.
- **Wrong owner** (a scope row moved to another account) — `[STAFF_LINKAGE]` and `[ACTIVE_KEY_UNIQUE]` fail.
- **Pre-existing duplicates on a canonical target key** — `[TARGET_COLLISION]` and `[ACTIVE_KEY_UNIQUE]` fail.
- **Catalog ambiguity** (a second season coded `UEHM-S12`) — `[SEASON_S12]` fails.
- **Read-only guard** — `UPDATE` and `DELETE` inside the preflight's transaction are rejected with SQLSTATE `25006` (`cannot execute … in a read-only transaction`).

### Demo-viewer scenarios (V2 final)

Each was applied to the baseline fixture, run, and reverted. Every one drives `SAFE_TO_APPLY_V2` to `false`, which is what makes the guards evidence rather than decoration.

| Scenario | Fails on |
|---|---|
| the demo S11 row's level has drifted in Production | `[SOURCE_DRIFT]` |
| the demo account has already been deactivated | `[DEMO_VIEWER_ACCOUNT_STATUS]`, `[NO_REACTIVATION]` |
| the account already holds a rogue active UEHM/S12 `operations` grant | `[ACTIVE_KEY_UNIQUE]`, `[DEMO_VIEWER_S12_SCOPE]`, `[DEMO_VIEWER_MUTATION_SCOPE]` |
| the account already holds a second active S11 grant | `[DEMO_VIEWER_S12_SCOPE]`, `[DEMO_VIEWER_S11_ACTIVE]` |
| the S12 `read` target is removed while the flag stays set (partial encoding) | `[SYNTHETIC_DISPOSITION]`, `[DEMO_VIEWER_S12_SCOPE]` |
| a fourth target is slipped in granting the account S11 `operations` | `[SYNTHETIC_DISPOSITION]`, `[DEMO_VIEWER_S12_SCOPE]`, `[DEMO_VIEWER_S11_ACTIVE]`, `[DEMO_VIEWER_MUTATION_SCOPE]` |

The last two matter most: they are the shapes in which a demo login could quietly acquire real authority, and both are refused by the disposition gate itself, not merely by the safety checks downstream of it.

---

## 11. Operating the controlled demo viewer

The account is a **shared credential**. That is the whole point of it and also its whole risk, so the constraints are recorded here rather than left to convention.

- **It must never be used for real operational work.** Not to approve, review, decide, pause, withdraw, or edit anything. The database enforces this — `read` is refused by `vam063_authorized_for_scope` and by both `canOperateSeason` and `canReviewSeason` — but the rule is stated because a shared login invites people to try.
- **Audit attribution cannot identify the individual person.** With shared credentials, `admin_audit_log` can only ever record *this account*, never the human who acted. That limitation is accepted deliberately and is the main reason the grant is read-only: with no mutation authority there is nothing consequential left to misattribute.
- **The long-term target is individual provisioning under WP1-C.** This account is an interim measure and is expected to be retired once each person has their own login. **WP1-C is not implemented by this package.**
- **Anti/browser role UAT is required before the credentials are shared with anyone.** The preflight proves the database grants nothing beyond UEHM/S12 `read`; it does not prove every route renders PII-safely for a `viewer`. That verification happens in a browser, after WP1-A2 converges and WP1-A1 deploys.

### Release ordering

```
WP1-A1 code security PASS
        ↓
WP1-A2 final manifest + preflight            ← this package
        ↓
owner executes the READ-ONLY preflight on Production
        ↓
only if SAFE_TO_APPLY_V2 = true
        ↓
author A2 apply.sql / verifier.sql / rollback.sql   (separately, not here)
        ↓
security review
        ↓
A2 Production convergence
        ↓
verify the four Admins + the demo viewer
        ↓
deploy A1
        ↓
Anti/browser role UAT  →  only then share the demo credentials
```

The ordering constraint is unchanged and still load-bearing: **A1 must not deploy before A2 converges.** A1 drops the non-canonical scope level `"admin"` at read time, which is the only thing giving Liễu working authority today.

---

# WP1-A2 · The authored package

## 12. `apply.sql`

One transaction, in the order §9 designed. `BEGIN` → locks and preconditions → audit pre-image → six in-place conversions → one platform-role change → six inserts → six constraints → postconditions → `COMMIT`.

**Nothing partial can commit.** Every guard is a `raise exception`, which aborts the transaction; and a `COMMIT` issued inside an already-aborted transaction is executed by PostgreSQL as a `ROLLBACK`, so even a client without `ON_ERROR_STOP` cannot half-apply this file. There is no savepoint, no retry, and no branch that repairs what it finds. **Drift aborts.**

### 12.1 The six rows it creates

Deterministic UUIDs, authored into the package rather than generated. This is what lets `verifier.sql` prove *exactly these rows* and `rollback.sql` remove *exactly these rows*, instead of "any row matching these values" — which is the shape that deletes someone else's legitimate grant.

| id | Account | Grant | Why |
|---|---|---|---|
| `a2000001-0000-4a20-8a20-000000000001` | uehmentoring@gmail.com | UEHM / S12 / `full_access` / active | Season 12 operating authority |
| `a2000002-0000-4a20-8a20-000000000002` | lieu.nguyen@hoatay.com.vn | UEHM / S11 / `full_access` / active | Replaces the Season 11 read authority her retired program-wide row conferred |
| `a2000003-0000-4a20-8a20-000000000003` | lieu.nguyen@hoatay.com.vn | UEHM / S12 / `full_access` / active | Season 12 operating authority |
| `a2000004-0000-4a20-8a20-000000000004` | hoang.nguyen@embassy.edu.vn | UEHM / S12 / `full_access` / active | Season 12 operating authority |
| `a2000005-0000-4a20-8a20-000000000005` | lyductoan@gmail.com | UEHM / S12 / `full_access` / active | Season 12 operating authority |
| `a2000006-0000-4a20-8a20-000000000006` | viewer.vam.test@redsquarevietnam.com | UEHM / S12 / `read` / active | The controlled demo viewer's **entire** post-plan authority |

The `a2…` prefix is deliberate and permanent: a row created by this package is identifiable as such forever, in a table where every other id is opaque.

### 12.2 NOT NULL is a named CHECK, not a column attribute

The owner contract requires `program_id`, `role` and `status` to be NOT NULL. `apply.sql` expresses all three as conjuncts inside the named constraints — `check (program_id is not null)`, `check (role is not null and role in (…))`, `check (status is not null and status in (…))` — rather than as `ALTER COLUMN … SET NOT NULL`.

Two operational reasons, and one honest trade-off:

- **Exact reversibility.** A named constraint is droppable by name. A column attribute is not: reverting `SET NOT NULL` would require knowing whether the attribute predated this package, and Production's `status` column was added by a manual hotfix of unknown nullability — `[NAME_COLLISION]` proved migrations 020/026 were never applied there, so the schema history does not answer the question. Rollback would have had to guess.
- **The six names the preflight cleared.** `[NAME_COLLISION]` proved exactly six object names free. `admin_scope_access_program_id_not_null` is one of them, which is itself evidence the design intended a named constraint. `role`/`status` NOT NULL were given no seventh and eighth name, so they live inside the constraints that already carry their vocabulary.
- **The trade-off:** `pg_attribute.attnotnull` stays false, so introspection tools and the planner still see the columns as nullable. Enforcement for every write is identical. Promoting them to true column attributes is a clean follow-up once the owner decides, and is not assumed here.

### 12.3 Idempotency: refuse, don't re-converge

A second run aborts at `[ALREADY_APPLIED]` — the guard reads both its own six row ids and its own six constraint names. It is never a silent no-op and never a partial re-convergence, so operational history stays readable. The insert is a guarded `INSERT … SELECT … WHERE NOT EXISTS`, never an `ON CONFLICT` upsert: if something unexpected already holds a canonical target key, the row is simply not inserted and the postconditions then abort the whole transaction. Unexpected state stops the run; it never gets absorbed.

---

## 13. Audit: what A2 records, and what it refuses to invent

`apply.sql` writes **one `admin_audit_log` row per affected account, before any row is modified.** Six rows, using the mechanism and vocabulary the application already uses. No new table, no new event type, no schema change, and no weakening of any audit constraint.

| Field | Value | Evidence |
|---|---|---|
| `action_type` | `update_admin_user` | `lib/admin-users.ts` writes exactly this when an account's role and scope change together. It is present in **both** the legacy vocabulary and the VAM062 superset, so it is safe whichever `admin_audit_log_action_type_check` Production currently carries |
| `target_admin_user_id` | the affected `admin_users.id` | the column's FK target |
| `before_data` | live pre-image `{user, scopes}` | the shape `snapshotAdminUser` produces |
| `after_data` | the planned post-state | see below |
| `actor_admin_user_id` | **NULL** | the column is nullable precisely for writes with no interactive actor. This is a migration executed by the owner, not an admin acting through the console; attributing it to a person's `admin_users` row would be a fiction |

**`after_data` is the plan, not an observation** — and the postconditions abort the transaction unless the committed state equals it exactly. So an audit row can never survive describing something that did not happen, while the instruction "record the pre-image *before* rewriting it" is honoured literally.

The account snapshot is deliberately **narrower** than the application's: `id, auth_user_id, email, role, status`, with no `full_name`. `admin_audit_log` is readable by super_admins and this record needs no further personal data to be a complete account of the authority change.

### The apply refuses rather than guesses

`[AUDIT_CONTRACT]` is a precondition, not a hope. It aborts the run if `admin_audit_log` is absent, if any of the five columns it writes is missing, if a live `action_type` CHECK does not admit `update_admin_user`, or if an affected account does not resolve to an `admin_users.id`. **A hostile fixture with an incompatible vocabulary aborts at that check with no partial state.** Widening an audit constraint to make a write fit is not in this package's scope, and a test asserts no file here contains `ALTER TABLE public.admin_audit_log`.

### Liễu's `"admin"` → `full_access` rewrite, and where the truth survives

This is the one field in the whole convergence whose stored value cannot be preserved: the table-wide `role` CHECK makes the literal `"admin"` unrepresentable on any row, retired or not. The retired row records `full_access` — the authority the owner says the account was meant to hold — and the pre-image `{program_id: "UEHM", season_id: null, role: "admin", status: "active"}` is written to `admin_audit_log` **first**. A postcondition then fails the whole transaction if that exact pre-image was not recorded exactly once, and `[AUDIT_PREIMAGE]` re-proves it in the verifier. The only alternative was to not apply the `role` CHECK at all, which leaves the vocabulary unenforced table-wide; that is recorded in the manifest as the owner's rejected option, not assumed away.

---

## 14. The owner execution sequence

**Do not run any of this until independent security review has passed.** Run `apply.sql` and `rollback.sql` with `ON_ERROR_STOP` enabled.

1. Run **`preflight_v2.sql`** against Production. Read-only.
2. Confirm **`SAFE_TO_APPLY_V2 = true`** and that every gating check is PASS. A single FAIL means Production disagrees with the locked manifest: **re-cut the manifest from a fresh owner inventory, never adjust the target to fit what was found.**
3. **Snapshot and keep the full preflight output** — all three blocks — with the run timestamp. It is the evidence the apply's write set was built against.
4. Execute **`apply.sql` exactly once.** It will emit `NOTICE` lines for its preconditions and postconditions, then a one-row summary, then `COMMIT`. If it raises instead, nothing was written — see step 7.
5. **Immediately** execute **`verifier.sql`.** Read-only. Record all rows.
6. Proceed only if **`A2_VERIFIED = true`**.
7. **If `apply.sql` failed before COMMIT: no rollback is needed and none may be run.** The transaction aborted, so nothing was written; `rollback.sql` run in that state aborts at `[NOT_APPLIED]`. Read the abort message, reconcile the drift it names, and start again at step 1.
8. **If `apply.sql` committed but `verifier.sql` fails: STOP.** Do not deploy A1, do not share the demo credentials, and do not run anything else against the table. Read the failing checks, then evaluate rollback eligibility (§15) with the owner.
9. **Rollback only via `rollback.sql`, and only if its own guards pass.** It refuses if the database is no longer exactly the state A2 left behind.
10. After a successful verification:
    - verify the four real Admin accounts — each should see Season 11 and Season 12, and be able to operate Season 12;
    - verify the demo viewer account — read-only, Season 12 only, no `/matches` detail access;
    - **only then** proceed toward the WP1-A1 deployment.

> **DO NOT SHARE THE DEMO CREDENTIALS UNTIL ANTI/BROWSER VIEWER UAT PASSES.** The verifier proves what the database grants — nothing beyond UEHM/S12 `read`. It does not prove every application route renders PII-safely for a `viewer`. The reviewer PII gap on `/matches` is still open, and this is a shared credential intended for exactly the people who must not see reviewer-level PII.

---

## 15. `rollback.sql` — emergency only

A deliberate reversal to the exact pre-A2 state recorded by the final Production preflight. **It is not a routine undo.**

### What it restores

| Row | Restored to |
|---|---|
| `68fe466c…` UEH shared Admin | `"UEH Mentoring"` / `"UEHM-S11"` / `full_access` / active |
| `17a86485…` Liễu | `"UEHM"` / NULL / `"admin"` / **active** |
| `60ef3d0b…` Hoàng | `"VAM"` / `"UEHM-S11"` / `operations` / active |
| `1e58beb9…` Toàn | `"VAM"` / `"UEHM-S11"` / `operations` / active |
| `487a7562…` demo account | `"VAM"` / `"UEHM-S11"` / `operations` / **active** |
| `eaa60d5c…` historical admin | `"VAM"` / `"UEHM-S11"` / `full_access` / inactive |
| `admin_users` | viewer.vam.test: `viewer` → `reviewer` (status untouched) |

Plus: the six `a2…` rows are deleted, and the six A2 objects are dropped by exact name. `id` and `created_at` survive both directions of the round trip. **No inventoried row is deleted in any branch** — the single `DELETE` in the entire package targets only the six ids A2 authored, each additionally guarded on the exact values A2 wrote.

The constraints are dropped **first**, because the restored values are deliberately non-canonical: `"UEH Mentoring"` and `"VAM"` are not UUID strings and `"admin"` is not a canonical scope level. `DROP … IF EXISTS` is not used anywhere: the guards have already proved all six objects are present, and `IF EXISTS` would silently tolerate a state this file refuses.

### When it refuses

Later legitimate operational work is worth more than a clean reversal, so every one of these aborts the run with nothing changed:

| Condition | Abort |
|---|---|
| none of the six A2 rows exist (the apply never committed, or it was already rolled back) | `[NOT_APPLIED]` |
| the A2 constraints or index are missing | `[NOT_APPLIED]` |
| the table holds anything other than exactly those 12 rows | `[ORGANIC_CHANGE]` |
| any of the 12 rows holds a value A2 did not write | `[ORGANIC_CHANGE]` |
| any row has moved to a different account | `[ORGANIC_CHANGE]` |
| any of the six accounts has a platform role or status A2 did not leave | `[ORGANIC_CHANGE]` |
| the six apply audit rows are not intact | `[AUDIT_CONTRACT]` |

If it aborts, the state must be reconciled by hand from the evidence. It must not be forced.

### The audit trail is retained, not rewound

Nothing in the live audit contract treats `admin_audit_log` rows as reversible: the application only ever inserts and reads them, migration 062 revokes `DELETE` from `authenticated`, and no code path anywhere deletes one. So the rollback **deletes no audit row** and instead **appends its own six**, recording the reversal with the same mechanism and vocabulary. An audit trail that can be rewound is not an audit trail.

### What a rollback re-creates, and the ordering it forces

Reversing restores Liễu's legacy `"admin"` level — from which she regains authority **only** through the base code's coercion of `"admin"` to `read`. **After a rollback, WP1-A1 must not be deployed:** A1 drops that level at read time and would leave her with nothing. Reversing also restores `reviewer` and an active S11 `operations` scope to a shared demo credential while the `/matches` PII gap is open, so those credentials must be in nobody's hands when it runs.

---

## 16. Local validation of the authored package

Executed against a throwaway local PostgreSQL **15.18** container seeded with a fixture reproducing the Production shape (`admin_scope_access` carrying a primary key and nothing else), the owner catalog, the exact six-row inventory, the **legacy** `admin_audit_log_action_type_check` vocabulary — the stricter of the two states Production could be in — and `vam063_authorized_for_scope` copied verbatim from `supabase_migrations/063`. **Production and Staging were not contacted at any point.** 50 assertions, all passing.

**Round trip:** `preflight_v2` → `SAFE_TO_APPLY_V2 = true` · `apply.sql` → COMMIT · `verifier.sql` → `A2_VERIFIED = true` · `rollback.sql` → COMMIT · scope rows and accounts byte-identical to the pre-A2 baseline · audit trail 12 rows (6 apply + 6 rollback, none deleted) · `preflight_v2` again → `SAFE_TO_APPLY_V2 = true`, recognising the restored baseline. Re-running `apply.sql` after a successful commit aborts at `[ALREADY_APPLIED]` and changes nothing.

**Hostile cases.** Each was applied to the baseline, run, and reverted. Every one failed closed with no partial commit and no leaked constraint or index.

| Injected before apply | Aborts at |
|---|---|
| a source row's level drifted | `[SOURCE_DRIFT]` |
| an unexpected seventh scope row | `[UNKNOWN_ROW]` |
| a manifest row moved onto a canonical target key | `[SOURCE_DRIFT]` |
| a foreign active row already holding a canonical target key | `[UNKNOWN_ROW]` |
| the demo account's platform role changed | `[DEMO_VIEWER_ROLE]` |
| the historical account unexpectedly active | `[HISTORICAL_INACTIVE]` |
| the historical scope row unexpectedly active | `[SOURCE_DRIFT]` |
| an Admin account suspended | `[STAFF_IDENTITY]` |
| a scope row moved to another account | `[SOURCE_DRIFT]` |
| an `action_type` CHECK that cannot admit `update_admin_user` | `[AUDIT_CONTRACT]` |

| Injected after apply, before rollback | Aborts at |
|---|---|
| an A2-created row edited organically | `[ORGANIC_CHANGE]` |
| a thirteenth row appeared | `[ORGANIC_CHANGE]` |
| the demo account's platform role changed | `[ORGANIC_CHANGE]` |
| the apply never committed | `[NOT_APPLIED]` |
| rollback run a second time | `[NOT_APPLIED]` |

**Read-only guard:** `UPDATE` and `DELETE` inside `SET TRANSACTION READ ONLY` are rejected with SQLSTATE `25006`.

> One honest note on coverage: the apply carries a `[TARGET_COLLISION]` precondition, and **no hostile case reaches it.** Any row that could collide is either one of the inventoried six — in which case moving it onto a target key is itself `[SOURCE_DRIFT]` — or a row the manifest does not name, which is `[UNKNOWN_ROW]`. `[TARGET_COLLISION]` is therefore defence in depth against a state the earlier guards already exclude, not an independently exercised check. It is kept because the earlier guards' exhaustiveness is a property of today's six-row table, not a law.

**Static tests:** `__tests__/wp1a2-apply-package.test.ts` locks the properties whose erosion would silently move authority — the closed UUID set across all three files, one transaction per file, every write addressed by an exact id or email, no `DELETE` in the apply, no generic `VAM → UEHM` rule, the constraint contract including the NOT NULL conjuncts and the role-free uniqueness key, the verifier's read-only-ness and derived verdict, the rollback's exact guards and retained audit trail, and the blast radius (no function replacement, no RLS change, no migration replay, no write outside `admin_scope_access` / `admin_users` / `admin_audit_log`).
