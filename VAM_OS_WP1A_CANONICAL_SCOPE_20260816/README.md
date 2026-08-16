# VAM OS — WP1-A2 Canonical Staff Scope Convergence

**Package status: PREFLIGHT ONLY. No migration exists in this package yet, and none may be applied from it.**

Date: 16 Aug 2026
Base: `f8bdfafcbf1a3e18151d7d679da66fa6fb353100`
Branch: `fix/wp1a-canonical-scope`

| File | Purpose | Writes? |
|---|---|---|
| `staff_scope_manifest_v2.json` | The owner-approved staff convergence manifest: six inventoried rows, their exact current values, and their approved targets | No |
| `preflight_v2.sql` | Read-only proof that the manifest is safe to apply, and the `SAFE_TO_APPLY_V2` gate | No |
| `preflight.sql` | V1. Read-only classification of Production `admin_scope_access` and the `SAFE_TO_APPLY` gate. Preserved as prior evidence | No |

`apply.sql`, `verifier.sql` and `rollback.sql` are **deliberately absent**. They are authored only after `preflight_v2.sql` has been run against Production by the owner and has returned `SAFE_TO_APPLY_V2 = true`, because the migration's write set depends on what the preflight finds. Section 8 documents the transaction strategy that apply will follow; it is a design, not a script.

**Sections 1–6 describe WP1-A2 as originally scoped — the single UEH Admin row. Sections 7–10 supersede that scope with the full owner-approved staff manifest.** The earlier sections are kept because the V1 preflight and its findings are still the evidence baseline for the table's shape and its lack of constraints.

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

Pairing constraint 5 with `SET NOT NULL` is a reasonable follow-up and is an owner decision, not a WP1-A2 assumption.

---

## 5. Not in scope for WP1-A2

- Program-wide UEHM Admin grant and the `vam063_authorized_for_scope` predicate change — **WP1-A3**.
- Foreign keys on `user_id`, `program_id`, `season_id`; UUID column conversion — safe follow-up.
- Staff provisioning and CSV — **WP1-C**.
- Season-first operating context and the season selector — **WP1-D**.
- Reviewer PII on `/matches` and `/matches/[id]` — **PRE-REVIEWER-ROLLOUT BLOCKER**, tracked separately. Reviewer accounts must not be broadly activated until it is closed. No file in this package touches that path.
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
| Hoàng `60ef3d0b…` | `VAM` / `UEHM-S11` / `operations` / active | converts to UEHM / S11 / `full_access` |
| Toàn `1e58beb9…` | `VAM` / `UEHM-S11` / `operations` / active | converts to UEHM / S11 / `full_access` |
| viewer test `487a7562…` | `VAM` / `UEHM-S11` / `operations` / active | **converts to nothing, and blocks the run** |
| admin test `eaa60d5c…` | `VAM` / `UEHM-S11` / `full_access` / inactive | identifiers canonicalized, stays inactive |

Hoàng's and the synthetic reviewer's rows are indistinguishable in every stored field. A rule of the form *"`VAM` means UEHM"* would convert all four and would hand a synthetic reviewer account real, working authority in Production. There is no such rule anywhere in this package, and a test asserts there never will be.

### The six rows

| Key | Account | Classification | Target |
|---|---|---|---|
| `ueh_shared_admin` | uehmentoring@gmail.com · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `lieu` | lieu.nguyen@hoatay.com.vn · admin · active | `RETIRE_LEGACY_PROGRAM_WIDE` | legacy row retired in place + S11 and S12 inserted |
| `hoang` | hoang.nguyen@embassy.edu.vn · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `toan` | lyductoan@gmail.com · admin · active | `KEEP_CONVERT_S11` | S11 converted in place + S12 inserted |
| `synthetic_viewer_test` | viewer.vam.test@… · reviewer · active | `SYNTHETIC_REQUIRES_OWNER_DECISION` | **none** |
| `historical_admin_test` | admin.vam.test@… · admin · inactive | `HISTORICAL_CANONICALIZE_ONLY` | identifiers only, status untouched |

All four Admins keep platform role `admin` by explicit owner decision. A2 changes no platform role, and `[STAFF_IDENTITY]` fails if Production disagrees.

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

### 7.4 The synthetic reviewer row is not dispositioned

It is active, non-canonical, and owned by a synthetic account whose platform role is `reviewer`. It is **not** silently mapped to a reviewer scope and **not** silently retired; either would be an authorization decision this package has no standing to make. It gets its own named check, `[SYNTHETIC_DISPOSITION]`, so it can never be read as a rounding error inside a generic unconvertible count.

Owner options are enumerated in the manifest under `no_target.options_for_the_owner`: retire, canonicalize as a reviewer, or defer the table-wide `program_id` CHECK. If the choice is to canonicalize it as a reviewer, note that `review` is refused by the RPC for mutations, and that the reviewer PII gap on `/matches` is a separate, still-open blocker on activating reviewer access.

---

## 8. Running `preflight_v2.sql`

Read-only, in three independent blocks, each wrapped in `begin; set transaction read only; … rollback;`. It contains no DML, no DDL and no function invocation — the RPC is read from the catalog, not called.

1. `set timezone = 'UTC';`
2. **BLOCK 1** — exact staff identity and exact source rows, one output row per manifest entry.
3. **BLOCK 2** — the target plan, with two independent collision counts per target.
4. **BLOCK 3** — the named checks and the `SAFE_TO_APPLY_V2` verdict.

Record all three outputs in full. **No warning is a pass.** A check is `INFO` only where its failure could not make the migration fail; everything that could is a `FAIL`, and any `FAIL` sets `SAFE_TO_APPLY_V2 = false`.

### The expected result of this package, as committed, is `false`

Two checks are expected to fail, and both trace to the single undisposed synthetic row:

- `[SYNTHETIC_DISPOSITION]` — no owner disposition is encoded.
- `[CONSTRAINT_ROW]` — because that row is untouched by the plan, it survives as an active non-canonical grant and blocks the table-wide `program_id` CHECK.

They clear together once the owner decides. That is the design: the gate is not a placeholder, it is the finding.

### Authorizing the synthetic disposition takes three deliberate acts

Flipping the flag alone is **not** sufficient, and is not meant to be — with no target encoded, the row still survives the plan and `[CONSTRAINT_ROW]` still fails:

1. record the chosen disposition in `staff_scope_manifest_v2.json` (`gates.synthetic_disposition` and a target or an explicit deferral);
2. add the matching target row to the `targets` CTE in **both** BLOCK 2 and BLOCK 3 of `preflight_v2.sql`;
3. set `synthetic_disposition_authorized` to `true` in BLOCK 3.

Then re-run against Production. None of this is reachable by running the preflight.

### What `SAFE_TO_APPLY_V2 = true` requires

- all six manifest rows exist exactly once, owned by the account the manifest names, with **every stored value still matching the inventory** — drift is a `FAIL`, not a warning, because the owner approved a conversion of specific values;
- all four Admin accounts resolve to exactly one `admin_users` row each, role `admin`, status `active`, `auth_user_id` non-null;
- `UEHM`, `UEHM-S11`, `UEHM-S12` each resolve exactly once, at the expected UUID, with correct ownership;
- zero rows in the table that the manifest does not account for;
- zero target-key collisions, measured three ways — against existing rows, against the manifest itself, and against the post-plan table;
- the legacy program-wide row is in its known shape, and the plan leaves no active program-wide grant behind;
- the synthetic row has an explicit owner-approved disposition;
- zero rows of **any** status violating a planned constraint after the plan;
- no reactivation, and no active grant issued to a non-active account;
- the live RPC accepts the planned targets unchanged.

---

## 9. The future A2 apply — design only, not authored

`apply.sql` does not exist and must not be written until `preflight_v2.sql` returns `SAFE_TO_APPLY_V2 = true`. When it is written, it should be a single transaction in this order:

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
| synthetic `487a7562…` | **NOTHING** | No disposition, no write. |

The rule behind the table: **update in place when the row's meaning is unchanged and only its spelling is wrong; retire and insert when the row's meaning itself is being replaced.** Deletion never appears, in any branch.

### Constraints, added last

Unchanged from §4, and validated table-wide by `[CONSTRAINT_ROW]` against the post-plan projection rather than against active rows only:

`program_id` NOT NULL + canonical UUID-text CHECK · `season_id` NULL or canonical UUID-text · `role IN (full_access, operations, review, read)` · `status IN (active, inactive)` · one active grant per `(user_id, program_id, season_id)` with `NULLS NOT DISTINCT`, **scope level excluded from the key**.

### Expected post-state

8 active grants (four Admins × S11/S12, all `full_access`), 2 inactive grants (Liễu's retired row, the historical test row), 0 rows deleted, and the synthetic row unchanged until the owner decides.

---

## 10. Validation performed on V2

Executed against a throwaway local PostgreSQL 15.18 container seeded with a fixture reproducing the Production shape (`admin_scope_access` carrying a primary key and nothing else), the owner-supplied catalog, the six inventoried rows, and `vam063_authorized_for_scope` copied verbatim from `supabase_migrations/063`. **Production and Staging were not contacted at any point.**

- **Baseline** — all six rows report `EXACT`; the ten targets report the planned actions from §9; `SAFE_TO_APPLY_V2 = false`, failing on exactly `[SYNTHETIC_DISPOSITION]` and `[CONSTRAINT_ROW]`, with `[CONSTRAINT_ROW]` naming `487a7562…` as the single blocking row.
- **Wrong scope_id** (the fixture's UEH row placed at a transposed UUID) — `[SOURCE_ROW]` reports `5 of 6 found`, and `[UNKNOWN_ROW]`, `[STAFF_LINKAGE]`, `[SOURCE_DRIFT]` and `[VAM_LEGACY]` all fail. A mistyped identity cannot convert the wrong row; it converts nothing and stops the run.
- **Drift** (Hoàng's level altered) — `[SOURCE_DRIFT]` fails and his BLOCK 1 verdict flips to `BLOCKED`.
- **Unknown row** (a seventh active grant) — `[UNKNOWN_ROW]` and `[VAM_LEGACY]` both fail; it is not silently converted.
- **Historical row secretly active** — `[HISTORICAL_INACTIVE]` and `[SOURCE_DRIFT]` fail.
- **Admin account suspended** — `[STAFF_IDENTITY]` fails, and `[NO_REACTIVATION]` fails because the plan would issue active grants to a non-active account.
- **Wrong owner** (a scope row moved to another account) — `[STAFF_LINKAGE]` and `[ACTIVE_KEY_UNIQUE]` fail.
- **Pre-existing duplicates on a canonical target key** — `[TARGET_COLLISION]` and `[ACTIVE_KEY_UNIQUE]` fail.
- **Catalog ambiguity** (a second season coded `UEHM-S12`) — `[SEASON_S12]` fails.
- **Authorized path** (a patched copy with the flag set and a retirement target encoded) — every check passes and `SAFE_TO_APPLY_V2 = true`, proving the gate is a real decision point and not an unreachable constant. The committed file is unchanged and still ships `false`.
- **Read-only guard** — `UPDATE` and `DELETE` inside the preflight's transaction are rejected with SQLSTATE `25006`.
