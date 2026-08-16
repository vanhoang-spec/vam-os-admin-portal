# VAM OS — WP1-A2 Canonical Staff Scope Convergence

**Package status: PREFLIGHT ONLY. No migration exists in this package yet, and none may be applied from it.**

Date: 16 Aug 2026
Base: `f8bdfafcbf1a3e18151d7d679da66fa6fb353100`
Branch: `fix/wp1a-canonical-scope`

| File | Purpose | Writes? |
|---|---|---|
| `preflight.sql` | Read-only classification of Production `admin_scope_access` and the `SAFE_TO_APPLY` gate | No |

`apply.sql`, `verifier.sql` and `rollback.sql` are **deliberately absent**. They are authored only after this preflight has been run against Production by the owner and has returned `SAFE_TO_APPLY = true`, because the migration's write set depends on what the preflight finds.

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
