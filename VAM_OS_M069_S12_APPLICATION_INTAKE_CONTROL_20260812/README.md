# VAM OS — M069 Season 12 Application Intake Control

**Status: PREPARED, NOT APPLIED.** No SQL in this package has been run against
Production. Both forms are CLOSED and stay CLOSED.

| | |
|---|---|
| Application base commit | `74c8ce39b51bf93a018833597e797a6bc5908b2a` |
| Branch | `m069-s12-application-intake-control` |
| Target | Production `vam-os-mvp` / `qkkroesfiazsejkzflcd` |
| Prerequisite | S12 release R4.2 applied and verified (specifically T1) |
| Binding | `UEHM` / `UEHM-S12` / `UEHM-S12-B1` |
| Initial state | mentor = `closed`, mentee = `closed` |

---

## 1. What the gate used to be, and what it is now

This is the reconstruction the pilot-token finding required. It is written out
because the replacement deliberately preserves the old semantics rather than
substituting something simpler.

### Before (base commit)

`lib/apply-gate.ts` decided the **page render** with two conditions:

1. `VAM_OS_ENABLE_MENTOR_APPLICATION` / `..._MENTEE_APPLICATION` = `"true"`
2. AND (`?token=` matches `VAM_OS_APPLY_TOKEN` — falling back to
   `VAM_OS_APPLICATION_PILOT_TOKEN` — **OR**
   `VAM_OS_ALLOW_TOKENLESS_APPLICATIONS` = `"true"`)

with a third behaviour: in development, an unset token env var produced
`dev_warning` and **opened the form** rather than closing it.

`lib/applications-create.ts` decided the **submission** with condition 1 only.

### The finding, precisely

The submission path enforced the enable flag but **never looked at the token**.
So while a form was enabled in pilot mode, a direct Server Action invocation —
a stale tab, a replayed POST, a handcrafted request — submitted successfully
**with no token at all**. The page's token requirement was decorative on the
write path. The `dev_warning` branch compounded it by making the dev and
production decision tables different.

### After (M069)

Three states, in the database, authoritative:

| state | page | submission |
|---|---|---|
| `closed` | closed notice | rejected |
| `pilot` | requires correct `?token=` | requires the **same** token |
| `open` | public | public |

Both paths call **one** function, `evaluateApplyGate(token, role)`. There is no
second decision table to drift. The token is compared with `timingSafeEqual`,
relayed to the action through a single named hidden field
(`APPLY_TOKEN_FIELD` = `__apply_token`), read explicitly, never logged, and
never written to `raw_payload`, `application_answers`, or any column.

`CLOSED` has **no token escape hatch**: holding the token does not grant pilot
access. Pilot is a state the owner selects, not a side effect of a secret.

The `dev_warning` branch is gone. An unset token in `pilot` state fails closed
in every environment.

### Dead configuration

`VAM_OS_ENABLE_MENTOR_APPLICATION`, `VAM_OS_ENABLE_MENTEE_APPLICATION` and
`VAM_OS_ALLOW_TOKENLESS_APPLICATIONS` are **no longer read by anything**.
Setting them has no effect and cannot open a form. Remove them from Vercel
after rollout so nobody believes otherwise.
`VAM_OS_APPLY_TOKEN` / `VAM_OS_APPLICATION_PILOT_TOKEN` are still used, but
only in `pilot` state.

---

## 2. Audit compatibility — read this before applying

Production's `admin_audit_log_action_type_check` is a **closed, VALIDATED
52-value list** installed by the S12 release T1. **It admits no value for a
form state change.**

M069's audit write would therefore abort with `23514` — and because the write
shares a transaction with the state change, the toggle itself would fail. This
is not a theoretical concern; it is the same defect class recorded for the
approval path.

`apply.sql` **extends the vocabulary from 52 to 53**, adding exactly:

```
set_application_form_state
```

Nothing is removed. All 52 release values are preserved verbatim and asserted
by test.

### The 52 are proven by SET EQUALITY, not by counting

`apply.sql` replaces the constraint with a **hard-coded** list, so that is only
safe if the list it replaces is *exactly* the canonical pre-M069 52. A count of
52 is not evidence: a different 52-value list — one legitimate Production
action type renamed, or swapped for another — passes a count check, and the
replacement would then silently delete it.

Every artifact therefore parses `pg_get_constraintdef()` into the set the
constraint **actually admits** and compares it in both directions:

| where | proves |
|---|---|
| `preflight.sql` | actual == canonical 52, and `set_application_form_state` absent |
| `apply.sql` Section 0 | the same, inside the apply transaction |
| `apply.sql` / migration Section 4 | the same again immediately before the drop, and *after* the add that the result is the canonical 52 **+** exactly `set_application_form_state` |
| `verifier.sql` V17 | post-apply set == canonical 52 + `set_application_form_state` |

Refusals name the offending values: `MISSING (expected, not present)` and
`UNEXPECTED (present, not expected)`.

The parse is proven complete before the set is trusted — every quote character
in the constraint definition must belong to a captured `'value'::text` element
— so a value the parser could not read cannot hide from the comparison.
Duplicates, a `NOT VALID` constraint, more than one `action_type` CHECK, or a
CHECK under an unexpected name are each separate refusals. The constraint is
found **by definition, not by name**; the name is then asserted rather than
assumed.

### One canonical representation

The 52 values are written once as a source of truth in
[`__tests__/support/m069-audit-vocabulary.ts`](../__tests__/support/m069-audit-vocabulary.ts),
and `migration-069-application-intake-control.test.ts` proves that **every**
copy in this package — the preflight guard, the preflight token CTE, both
`apply.sql` copies, the migration copy, both verifier CTEs and the `rollback.sql`
restore list — is set-equal to it. Preflight, apply and verifier cannot drift
apart on what "the pre-M069 vocabulary" means.

Two deliberate choices:

- **One action type, not two.** With three states, `open_application_form` /
  `close_application_form` cannot express a `closed → pilot` transition
  without ambiguity. `previous_state` and `new_state` live in `details`, which
  is precise and keeps Production's vocabulary growth to one value.
- **Not `open_event_registration` / `close_event_registration`.** Those exist
  in the 52 and are about **events**. Reusing them would corrupt every event
  audit query. Asserted by test.

`action`, `actor_email`, `target_email` and `metadata` are legacy Production
columns that the release T1 made nullable. `preflight.sql` refuses if any is
still `NOT NULL` without a default, because that would abort the audit INSERT
with `23502`.

---

## 3. Authorization decision (Phase 2)

| role | view screen | change state |
|---|---|---|
| `super_admin` | yes | **yes** (bypass, as always) |
| `admin` | yes | yes — **only with operations scope on UEHM-S12** |
| `core_team` | yes | **no** |
| `reviewer` / `support_team` / `viewer` | no | no |

**Core Team is read-only, and this is a deliberate decision.** core_team holds
`canDecide` and `canManageMatches`, but every one of those acts on records
already inside the system. None is an externally-visible publication event, so
none is evidence that core_team was intended to control public recruitment. No
existing permission safely maps to this action, so core_team stays read-only
until the owner decides otherwise.

An admin with **no UEHM-S12 scope cannot toggle UEHM-S12** — the check is
`canOperateSeason(ctx, seasonId)` against the season resolved from the control
row itself. An unreadable `admin_scope_access` is treated as denial, not as an
empty grant.

The RPC re-checks actor identity, `status = 'active'` and role independently,
so a caller reaching the database by another route is still refused.

---

## 4. Files

| file | role |
|---|---|
| `preflight.sql` | READ-ONLY. 25 refusal conditions. Emits a pass token, an audit column seal and an audit vocabulary seal. |
| `apply.sql` | One transaction. Section 0 re-asserts the **whole** baseline; **does not depend on preflight having been run.** |
| `verifier.sql` | READ-ONLY. 24 checks, all must PASS. |
| `rollback.sql` | Refuses while any form is open. Never deletes audit history. |

The repository migration `supabase_migrations/069_application_form_controls.sql`
is identical in effect; `apply.sql` adds only the header and the Section 0
re-assertion. Everything from `-- ── 1. The control table` onward is
byte-identical between the two, asserted by test.

### apply.sql is self-contained

Section 0 re-asserts, inside the apply transaction and before the first
mutation:

| | re-asserted |
|---|---|
| **A** | environment identity — no `vam062_*` functions, i.e. not Staging |
| **B** | `admin_users` exists; `id`/`email`/`role`/`status` all present, `id` is `uuid`, `role`/`status` are text-comparable, `id` carries a primary/unique key — the exact prerequisites of the SECURITY DEFINER authorization path and of the `updated_by` FK |
| **C** | M069 is completely unapplied — no control table, no `vam069_*` function, no leftover `application_form_controls*` relation, trigger or constraint |
| **D** | exactly one `UEHM`; exactly one `UEHM-S12` whose `program_id` is that `UEHM`; exactly one `UEHM-S12-B1` whose `season_id` is that exact `UEHM-S12`; no S11 resolution; the code-join the seed performs resolves to exactly one chain |
| **E** | `admin_audit_log` exists with the 13 post-release columns; the four legacy columns are nullable-or-defaulted; exactly one `action_type` CHECK, found by definition, named as expected, VALIDATED, parseable, duplicate-free, **set-equal to the canonical 52**, and not already admitting `set_application_form_state` |
| **F** | no conflicting control rows |

Any mismatch raises before the first mutation and the transaction aborts.
Running `preflight.sql` first is still recommended — it reports the same
refusals read-only, without taking a lock — but **skipping it, or a baseline
that drifted after it passed, cannot make the apply unsafe.**

Expected preflight token on the reviewed R4.2 baseline:

```
M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:S12OK
```

`VOCAB52EXACT` is emitted only when the admitted set is **set-equal** to the
canonical 52. A different 52-value list emits `VOCABDRIFT`, and the
`audit_vocab_missing` / `audit_vocab_unexpected` columns name the values. (The
previous token spelled this field `52`, which any 52-value list satisfied.)

Run every script with `set timezone = 'UTC'` or the seals are not comparable.

---

## 5. Owner-run Production rollout

**Do not run any of this until the change is reviewed and you intend to ship.**
Applying the migration does **not** open anything — it creates two CLOSED rows.

### Step 1 — preflight (read-only, safe to run any time)

```sql
set timezone = 'UTC';
\i VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812/preflight.sql
```

Expect `M069 PREFLIGHT PASSED` and the token above. **If it refuses, stop.**
Every refusal names its condition in brackets; none is safe to skip. If the
audit vocabulary refusal fires, read `audit_vocab_missing` and
`audit_vocab_unexpected` — they name exactly which values disagree with the
canonical 52, and the package must be re-derived against this database before
Section 4 is allowed to replace the constraint.

This step is a convenience, not a prerequisite: Step 2 re-proves all of it.

### Step 2 — apply (one transaction)

```sql
set timezone = 'UTC';
\i VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812/apply.sql
```

Expect `M069: audit vocabulary extended to 53 values` and a clean `COMMIT`.

### Step 3 — verify

```sql
set timezone = 'UTC';
\i VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812/verifier.sql
```

**All 24 checks must read PASS.** `control_rows_not_closed` must be `0`.
If V05 is not PASS, a form is open — close it immediately through the UI.

The verifier reads definitions, not names, because a name is not evidence:

| check | proves |
|---|---|
| V07 / V08 | the CHECK **expressions** admit exactly `{mentor, mentee}` and exactly `{closed, pilot, open}` — a same-named CHECK with different values FAILs |
| V09 | the trigger's table, `BEFORE`, `INSERT OR UPDATE`, `FOR EACH ROW`, enabled state, and the **function it points at** — a same-named trigger on another function FAILs |
| V19 | the trigger function is the intended SECURITY DEFINER body (pinned `search_path`, returns `trigger`, all three binding refusals present) + an `md5` body seal |
| V13 / V20 | exact schema, name, argument signature `(uuid, text, text, text, text)` and the exact `TABLE(...)` result contract |
| V14 | `SECURITY DEFINER` and exactly one pinned setting, `search_path=public, pg_temp` |
| V21 | the function **owner** — a SECURITY DEFINER function runs as its owner, so the owner must not be a web role and must be the same principal that owns the control table |
| V15 | no `anon` / `authenticated` / `PUBLIC` EXECUTE, read from the ACL including `acldefault()`, so a function whose default PUBLIC grant was never revoked also FAILs |
| V22 | `service_role` **does** hold EXECUTE — without it the Admin screen is dead |
| V23 | the RPC body still carries the authorization contract (active status, the `super_admin`/`admin` allow-list, `42501`, the row lock, the stale-state compare, the atomic audit INSERT, and no `core_team`) + an `md5` body seal, so a substituted same-signature function FAILs |
| V17 | the audit vocabulary is **set-equal** to the canonical 52 + `set_application_form_state` — no original lost, nothing extra, nothing substituted |
| V24 | exactly one `UEHM` → one `UEHM-S12` → one `UEHM-S12-B1`, and both control rows hang off **that** intake row and are the only control rows — a same-code batch under another program/season FAILs |

### Step 4 — deploy the application

Deploy the M069 commit. Until it is deployed, the DB rows exist but nothing
reads them; the forms stay closed either way.

### Step 5 — remove dead config

Delete `VAM_OS_ENABLE_MENTOR_APPLICATION`, `VAM_OS_ENABLE_MENTEE_APPLICATION`
and `VAM_OS_ALLOW_TOKENLESS_APPLICATIONS` from Vercel. Keep
`VAM_OS_APPLY_TOKEN` only if you intend to use pilot mode.

---

## 6. Staged runtime validation (before opening anything)

Run these against Production with **both forms still CLOSED**:

1. `GET /apply/mentor` → closed notice. No form fields rendered.
2. `GET /apply/mentee` → closed notice.
3. `GET /apply/mentor?token=<correct token>` → **still** the closed notice.
   This proves CLOSED has no token bypass.
4. Sign in as Super Admin → Quản trị → Mùa & Form đăng ký. Both cards read
   `ĐÓNG`. Program/season/intake read `UEHM` / `UEHM-S12` / `UEHM-S12-B1`.
5. Copy Link on both cards yields the correct absolute URLs.
6. Sign in as a Reviewer → the nav item is absent and the route is refused.
7. Confirm `/operations` aggregates, Events, and login still behave (M069
   touches none of them; this is a regression spot-check).

### When the owner decides to open

8. Toggle Mentor → confirmation dialog names the role, the season, and the
   resulting state. Confirm.
9. Card re-reads from the server: state `MỞ CÔNG KHAI`, actor and timestamp
   populated. A row appears in Lịch sử thay đổi.
10. `GET /apply/mentor` → the form renders. Submit one real application.
    Confirm in `/admin/applications` that it bound to `UEHM-S12-B1`.
11. Mentee is **still** CLOSED — independence check.
12. Open a second tab on the mentor form, close the form from the first tab,
    then submit from the stale tab. It **must** be rejected and no row
    inserted. This is the race the release most needs proven live.

---

## 7. Rollback / recovery

| situation | action |
|---|---|
| A form was opened by mistake | Toggle it CLOSED in the UI. Immediate, audited, no SQL. **This is the fix — not rollback.** |
| The toggle UI is broken while a form is open | `update public.application_form_controls set state='closed';` then investigate. Closing by hand is unaudited but safe. |
| The migration must be removed | Close both forms through the UI first, then run `rollback.sql`. |

`rollback.sql` **refuses** while any control row is not `closed`, so it cannot
silently terminate a live recruitment. It restores the 52-value vocabulary
only if no audit row uses the M069 value — audit history is never deleted to
satisfy a constraint.

**Rolling back leaves both forms CLOSED** (the gate fails closed with no
control table). That is safe, but it is not a way to keep recruitment running.

---

## 8. What this package deliberately does not do

- It does not open a form. No artifact here can.
- It does not touch Season 11 — asserted by preflight and by verifier V18.
- It does not grant `anon` or `authenticated` anything. RLS is on with **zero**
  policies; only the service-role path can read or write the control rows.
- It does not introduce a multi-batch recruitment workflow. One intake,
  `UEHM-S12-B1`, fixed in code and re-verified on every read.
- It does not adopt Production's four untracked audit columns beyond keeping
  `action` populated.
