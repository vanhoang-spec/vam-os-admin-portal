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
| Round | R4 — the unapplied guard is scoped to migration-owned objects ([§4.1](#41-what-this-migration-owns-r4)) |

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
| `preflight.sql` | READ-ONLY. 27 refusal conditions. Emits a pass token, an audit column seal, an audit contract seal and an audit vocabulary seal. |
| `apply.sql` | One transaction. Section 0 re-asserts the **whole** baseline; **does not depend on preflight having been run.** |
| `verifier.sql` | READ-ONLY. 24 checks, all must PASS. Each one compares a complete definition, not a fragment of one. |
| `rollback.sql` | Refuses while any form is open. Never deletes audit history. Drops only migration-owned identities — never a `vam069_*` prefix match. |

The repository migration `supabase_migrations/069_application_form_controls.sql`
is identical in effect; `apply.sql` adds only the header and the Section 0
re-assertion. Everything from `-- ── 1. The control table` onward is
byte-identical between the two, asserted by test.

### 4.1 What this migration owns (R4)

R3's unapplied guard refused when **any** function matched `vam069_*`. That is
broader than the fact it needs to prove, and on Production the two sets are not
the same.

**The finding.** An owner-run, read-only Production forensic found exactly one
function under that prefix:

```
public.vam069_trusted_context_probe()
  language sql, SECURITY DEFINER, owner postgres, search_path=public
  EXECUTE: postgres + service_role
  body calls public.vam063_trusted_api_role()
  probe_version = 'VAM_PROD_S12_PROBE_C_v1'
```

It is a legitimate historical artifact of the **completed** Production S12
release — `VAM_OS_PROD_S12_RELEASE_20260809/apply/T3_membership_lifecycle_objects.sql`,
Section 3, the Probe C runtime proof that gated T4. It has nothing to do with
application intake.

The same forensic proved M069 itself was entirely **unapplied**:
`application_form_controls` absent, no M069 relation, trigger or control
constraint, and the canonical pre-M069 52-value audit vocabulary intact. R3's
preflight refused that database with `[FUNCTION_PRESENT]` anyway. A false
positive — and `rollback.sql` carried the mirror-image defect: its
post-condition asserted the *prefix* was unused, so a **correct** rollback on
Production would have been reported `ROLLBACK FAILED` because Probe C survived
it, exactly as it should.

**The rule, restated.** The guards now express

> objects belonging to THIS migration must be absent

and not

> no object anywhere may use the `vam069` prefix.

Nothing is whitelisted by name. `vam069_trusted_context_probe` appears in **no**
M069 SQL artifact — a test asserts that, so nobody can "fix" a future collision
by adding an exemption.

**The migration-owned inventory**, derived from
`supabase_migrations/069_application_form_controls.sql` by
`__tests__/support/m069-canonical-definitions.ts`, which fails the build if the
arrays hard-coded in `preflight.sql` and `apply.sql` Section 0 drift from it:

| kind | object |
|---|---|
| function | `public.vam069_assert_control_binding()` |
| function | `public.vam069_set_application_form_state(uuid, text, text, text, text)` |
| relation | `public.application_form_controls` (table) |
| relation | `application_form_controls_pkey` (implicit PK index) |
| relation | `application_form_controls_batch_role_key` (unique index) |
| trigger | `application_form_controls_binding` |
| constraint | `application_form_controls_pkey`, `application_form_controls_role_check`, `application_form_controls_state_check`, and the four `application_form_controls_*_fkey` rows |

**Signature-independent, on purpose.** The function test matches the two owned
*names* in `public` at any signature, because both collisions are unsafe: the
intended identity already present would be silently **replaced** by
`create or replace function`, overwriting a body this package cannot vouch for;
a conflicting **overload** under an owned name would **survive** both the apply
and the rollback as a stray SECURITY DEFINER function under a name this
migration owns. The refusal prints the full identity of whatever it found.

**Why the other prefix stays.** The relation / trigger / constraint scan still
matches `application_form_controls%`. Unlike `vam069_`, that prefix *is* this
migration's own object namespace — every catalog name it can match is a name
migration 069 creates — so there a prefix scan is exact ownership, and it is
what catches a half-applied package (a trigger without its table, an index left
by a failed rollback).

**What R4 does not change.** No other refusal is weakened or removed: the exact
52-value vocabulary and its set-equality proof, the complete 13-column audit
INSERT contract, the `UEHM → UEHM-S12 → UEHM-S12-B1` cardinality and parentage,
the sealed verifier definitions, RLS and grants, and the CLOSED/CLOSED seed are
all exactly as reviewed in R3. The preflight token is unchanged. Canonical
migration 069 is unchanged — this is a guard defect, not a runtime one — and
`verifier.sql` needed no change, because it already located both functions by
exact name and judged them by sealed body identity.

Two evidence columns are added to the preflight's summary row:
`m069_owned_objects_present` (expected `<none>` — the unapplied proof stated
positively) and `unrelated_vam069_functions`, which on the reviewed Production
baseline reads exactly `public.vam069_trusted_context_probe()`. Both the
preflight and Section 0 also `RAISE NOTICE` naming any unowned prefixed
function they saw, so the transcript shows the exclusion was deliberate.

#### R4, executed on disposable PostgreSQL

`__tests__/m069-r4-unapplied-guard-live.test.ts` builds a Production-shaped
baseline **from repository artifacts only** — `prod_baseline_reproduction.sql`
plus the completed release `T1`…`T4` — so the shape under test carries the
historical `vam069_trusted_context_probe()`, no M069 object, the canonical 52
vocabulary and the canonical S12 chain. It is opt-in (`M069_LIVE_PG_URL`,
local hosts only, because it creates and drops throwaway databases) and it
refuses any non-local host. Executed on PostgreSQL 15.18:

| scenario | result |
|---|---|
| baseline with no `vam069` function at all | preflight **PASS** |
| baseline with **only** `vam069_trusted_context_probe()` | preflight **PASS**, no `FUNCTION_PRESENT` |
| same baseline, `apply.sql` | Section 0 passes, transaction **COMMIT**, both rows `closed` |
| intended binding function pre-exists | preflight and Section 0 both refuse `[FUNCTION_PRESENT] public.vam069_assert_control_binding()` |
| conflicting overload `vam069_assert_control_binding(int)` | both refuse, identity reported as `(integer)` |
| intended toggle RPC pre-exists | both refuse, naming the five named parameters |
| conflicting overload `vam069_set_application_form_state(text)` | both refuse |
| `application_form_controls` pre-exists | both refuse `[ALREADY_APPLIED]` |
| leftover owned index / trigger / constraint name | both refuse `[PARTIAL_M069]`, naming the object |
| apply → verifier | **24/24 PASS** |
| rollback | completes; owned functions gone, control table gone |

The probe's identity seal —
`sha256(prosrc) = 521b583078a568b4b1d1c4fad4ed563aac4a9ba900e12eb97802b7d954f55ca6`,
owner `postgres`, `search_path=public`, `postgres=X/postgres service_role=X/postgres` —
is **byte-identical before apply, after apply and after rollback**, and
`select probe_version from public.vam069_trusted_context_probe()` still returns
`VAM_PROD_S12_PROBE_C_v1` at the end. After rollback the only `vam069_`
function left in the database is that probe.

The ninth scenario proves the verifier is not fooled the other way: with M069
applied and then **only** the two owned functions dropped, the probe still
carries the prefix, and V09/V13/V14/V19/V20/V21/V22/V23 all report `FAIL` with
detail `<none>` — the verifier never matched the probe.

### apply.sql is self-contained

Section 0 re-asserts, inside the apply transaction and before the first
mutation:

| | re-asserted |
|---|---|
| **A** | environment identity — no `vam062_*` functions, i.e. not Staging |
| **B** | `admin_users` exists; `id`/`email`/`role`/`status` all present, `id` is `uuid`, `role`/`status` are text-comparable, `id` carries a primary/unique key — the exact prerequisites of the SECURITY DEFINER authorization path and of the `updated_by` FK |
| **C** | M069 is completely unapplied — no control table, no function carrying a **migration-owned identity**, no leftover `application_form_controls*` relation, trigger or constraint (see [§4.1](#41-what-this-migration-owns-r4)) |
| **D** | exactly one `UEHM`; exactly one `UEHM-S12` whose `program_id` is that `UEHM`; exactly one `UEHM-S12-B1` whose `season_id` is that exact `UEHM-S12`; no S11 resolution; the code-join the seed performs resolves to exactly one chain |
| **E** | `admin_audit_log` exists with the 13 post-release columns; the four legacy columns are nullable-or-defaulted; **the complete audit INSERT contract holds for all 13 columns** (below); exactly one `action_type` CHECK, found by definition, named as expected, VALIDATED, parseable, duplicate-free, **set-equal to the canonical 52**, and not already admitting `set_application_form_state` |
| **F** | no conflicting control rows |

Any mismatch raises before the first mutation and the transaction aborts.
Running `preflight.sql` first is still recommended — it reports the same
refusals read-only, without taking a lock — but **skipping it, or a baseline
that drifted after it passed, cannot make the apply unsafe.**

#### The complete `admin_audit_log` INSERT contract

Thirteen column names existing was never evidence that the audit INSERT can
succeed. Remove the default from NOT NULL `id`, `created_at` or `updated_at`
and the name list is unchanged: the old Section 0 passed, M069 committed, the
owner was told it was verified — and the **first** toggle then failed with
`23502`, taking the state change down with it, because the state change and the
audit row share one transaction. Change `details` from `jsonb` to `text` and it
fails with `42804` instead. Both must abort **before** the first mutation.

Section 0 and the preflight therefore check every column, in the class the
INSERT actually puts it in. The contract below is derived from the accepted
Production baseline — the 13-column shape in
`VAM_OS_PROD_S12_RELEASE_20260809/validation/prod_baseline_reproduction.sql`,
with the release T1 Section 1 legacy `NOT NULL` drops applied — combined with
what migration 069's own audit INSERT writes into each column.

| column | type | INSERT | what must hold |
|---|---|---|---|
| `action` | `text` | value `'set_application_form_state'` | type accepts the literal |
| `action_type` | `text` | value `'set_application_form_state'` | type accepts the literal |
| `actor_admin_user_id` | `uuid` | value `v_actor.id` (`admin_users.id`) | type is `uuid` |
| `actor_email` | `text` | value `v_actor.email` (`admin_users.email`) | type is `text` |
| `before_data` | `jsonb` | value `jsonb_build_object(...)` | type is `jsonb` |
| `after_data` | `jsonb` | value `jsonb_build_object(...)` | type is `jsonb` |
| `details` | `jsonb` | value `jsonb_build_object(...)` | type is `jsonb` |
| `target_admin_user_id` | `uuid` | **literal NULL** | must be **nullable** |
| `id` | `uuid` | omitted | NOT NULL ⇒ default of the `gen_random_uuid()` / `uuid_generate_v4()` family, or an identity/generated mechanism |
| `created_at` | `timestamptz` | omitted | NOT NULL ⇒ default of the `now()` / `CURRENT_TIMESTAMP` family |
| `updated_at` | `timestamptz` | omitted | NOT NULL ⇒ default of the `now()` / `CURRENT_TIMESTAMP` family |
| `metadata` | `jsonb` | omitted | must be nullable (or defaulted) |
| `target_email` | `text` | omitted | must be nullable (or defaulted) |

Plus two catalog facts the INSERT also depends on: `admin_audit_log` must be an
ordinary table, and it must not carry `FORCE ROW LEVEL SECURITY` — RLS merely
being *enabled* is the accepted baseline and is fine, but FORCE would filter the
SECURITY DEFINER INSERT even running as the table owner.

The default-family check matters on its own: a default of `NULL::uuid`
satisfies "has a default" and still violates NOT NULL at INSERT time. A column
that is GENERATED or IDENTITY ALWAYS is refused wherever the INSERT supplies a
value, because an explicit value into one is `428C9`.

Every refusal names the offending column and the property it violates, under
`[AUDIT_CONTRACT]` (or `[AUDIT_INSERT_BLOCKED]` for the two catalog facts). The
contract array appears three times — the preflight guard, the preflight token
CTE and apply Section 0 — and a test proves all three are identical to the one
derived in `__tests__/support/m069-canonical-definitions.ts`, exactly the
anti-drift arrangement the 52-value vocabulary already uses.

Expected preflight token on the reviewed R4.2 baseline:

```
M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:AUDITCONTRACT13:S12OK
```

`VOCAB52EXACT` is emitted only when the admitted set is **set-equal** to the
canonical 52. A different 52-value list emits `VOCABDRIFT`, and the
`audit_vocab_missing` / `audit_vocab_unexpected` columns name the values. (The
first version of the token spelled this field `52`, which any 52-value list
satisfied.)

`AUDITCONTRACT13` is emitted only when all 13 columns satisfy the contract
above, evaluated by the same rules Section 0 applies. Anything else emits
`AUDITCONTRACTDRIFT`, and `audit_contract_violations` names the columns.
`NULLABLE4` is retained, but it was never this proof: it reported four legacy
columns and said nothing about the three omitted NOT NULL columns whose
defaults the INSERT depends on.

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

The verifier reads definitions, not names, because a name is not evidence — and
compares them **whole**, because a fragment of a definition is not evidence
either:

| check | proves |
|---|---|
| V07 / V08 | the **complete** normalised `pg_get_constraintdef(oid, true)` of each CHECK equals a hard-coded canonical definition, and the constraint is on that table, attached to that one column, under the expected name, VALIDATED |
| V09 | the trigger's table, `BEFORE`, `INSERT OR UPDATE`, `FOR EACH ROW`, enabled state, and the **function it points at** — a same-named trigger on another function FAILs |
| V19 | the trigger function's schema, name, argument signature, `trigger` result type, `plpgsql` language, `SECURITY DEFINER`, exactly one pinned setting, owner — **and** that its body is byte-identical to the canonical one, by SHA-256 seal |
| V13 / V20 | exact schema, name, **named** argument signature `(p_actor_admin_user_id uuid, p_intake_batch_code text, p_applicant_role text, p_expected_state text, p_new_state text)` **and** the bare type vector `(uuid, text, text, text, text)`, and the exact `TABLE(...)` result contract. The parameter names are part of the contract because `app/actions/application-form-controls.ts` calls the RPC through PostgREST with named arguments — a rename breaks the Admin screen while the type vector is unchanged |
| V14 | `SECURITY DEFINER` and exactly one pinned setting, `search_path=public, pg_temp` |
| V21 | the function **owner** — a SECURITY DEFINER function runs as its owner, so the owner must not be a web role and must be the same principal that owns the control table |
| V15 | no `anon` / `authenticated` / `PUBLIC` EXECUTE, read from the ACL including `acldefault()`, so a function whose default PUBLIC grant was never revoked also FAILs |
| V22 | `service_role` **does** hold EXECUTE — without it the Admin screen is dead |
| V23 | the RPC body is byte-identical to the canonical one, by SHA-256 seal, and the function is `plpgsql`. Body identity is **additional to** V13/V14/V15/V20/V21/V22, not a substitute: a seal over the body says nothing about the signature, the search_path, the owner or the ACL |
| V17 | the audit vocabulary is **set-equal** to the canonical 52 + `set_application_form_state` — no original lost, nothing extra, nothing substituted |
| V24 | exactly one `UEHM` → one `UEHM-S12` → one `UEHM-S12-B1`, and both control rows hang off **that** intake row and are the only control rows — a same-code batch under another program/season FAILs |

#### What is sealed, exactly

**CHECK constraints.** The complete `pg_get_constraintdef(oid, true)` text, with
runs of whitespace collapsed to one space and the ends trimmed. Nothing else is
discarded: parentheses, `::text` casts, operators, value order and a trailing
`NOT VALID` must all match. `pretty = true` is the rendering existing accepted
artifacts in this repository already compare against by literal
(`supabase_migrations/062`, the S12 release preflight).

Extracting the quoted literals — what the previous revision did — was not
enough. Every one of these exposes exactly `{mentee, mentor}`:

```
CHECK ((applicant_role = ANY (ARRAY['mentor'::text,'mentee'::text])) OR (length(applicant_role) > 0))
CHECK (applicant_role <> ALL (ARRAY['mentor'::text, 'mentee'::text]))
CHECK (state = ANY (ARRAY['mentor'::text, 'mentee'::text]))
```

The first admits every non-empty string, the second admits exactly the wrong
set, the third governs the wrong column. All three now FAIL.

**Function bodies.** `pg_proc.prosrc` — the exact bytes between the `$$`
delimiters in the canonical migration — hashed with SHA-256:

```
vam069_assert_control_binding      f110bd1ba651eb9a71ce8ec4f4d889d838eba6d4497dcf2b1b55248d7b8b67c2
vam069_set_application_form_state  4615a7e06fbc11f0a5f277639b92a89bb934d604f5b1214a3c36858bf0cb7089
```

The seal covers the body and **only** the body. Searching that body for marker
phrases — what the previous revision did — accepts a replacement that keeps
every phrase in a comment, or moves the enforcement behind `if false then`, or
changes one comparison, or deletes the atomic audit INSERT. The repository's
tests drive each of those mutations, built from the migration's own source,
through the seal and prove it rejects them while the marker search accepted
them.

The marker `like` tests are retained in V19/V23 so a FAIL is readable, but the
PASS is conditional on the seal. One R2 marker was removed rather than
retained: `prosrc not like '%core_team%'`. The canonical body *fails* it — the
body explains in a comment that core_team, reviewer, support_team and viewer
are not allowed, and a substring test cannot tell that sentence from a grant.
It was wrong in both directions, and the seal proves the same fact exactly.

**Where the expected values come from.** The constants in `verifier.sql` are
derived from `supabase_migrations/069_application_form_controls.sql` by
`__tests__/support/m069-canonical-definitions.ts`, and
`__tests__/migration-069-application-intake-control.test.ts` fails if the two
ever disagree. Editing the canonical CHECK or a function body without updating
the verifier breaks the build, not Production.

The verifier's summary row reports both live body seals so two environments can
be diffed directly.

#### Executed, not only reasoned about

This package was run end to end on PostgreSQL 15.18 against a **disposable
local** reproduction of the accepted Production baseline —
`VAM_OS_PROD_S12_RELEASE_20260809/validation/prod_baseline_reproduction.sql`
plus the release T1, which is what that file exists for. Nothing was run
against Production.

* preflight emitted exactly the documented token, with
  `audit_contract_violations = <none>`;
* apply committed; verifier reported **24/24 PASS**;
* the expected constants above are confirmed against the real catalog: the
  server renders the CHECKs exactly as `verifier.sql` requires, and both
  `prosrc` seals matched byte for byte;
* eleven mutated baselines (`id` / `created_at` / `updated_at` default removed,
  `id` defaulted to `NULL::uuid`, `metadata` / `target_email` /
  `target_admin_user_id` made NOT NULL, `details` → `text`,
  `actor_admin_user_id` → `text`, `action_type` → `varchar(20)`, FORCE RLS)
  each aborted Section 0 **before** the control table was created;
* eleven mutated catalogs (weakened CHECKs, NOT VALID, and eight function
  bodies that keep every marker phrase) each produced a verifier FAIL on
  exactly the check that owns them;
* and the failure MEDIUM 2 describes was reproduced directly: with
  `created_at`'s default removed after a successful apply, the first toggle
  fails with `23502` and the state change rolls back with it. That is the
  outcome Section 0 now refuses to allow anyone to reach.

Three defects were found by running it, all fixed here:
`text || "char"` in V09's detail expression aborted the **entire** verifier
file on PG15; V13 compared against a type-only signature where PostgreSQL
renders parameter names; and V23's `prosrc not like '%core_team%'` failed the
canonical body. The first two meant R2's verifier reported FAIL on a correct
Production for V13 and V23 — and could not run at all.

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

Every `DROP` in `rollback.sql` names an exact identity — the table, its trigger,
`public.vam069_assert_control_binding()` and
`public.vam069_set_application_form_state(uuid, text, text, text, text)`. None
of them is a prefix match, so the file cannot reach
`public.vam069_trusted_context_probe()` or any other object this migration does
not own; it names them in a `NOTICE` before it starts, and its post-condition
asserts the two owned identities are gone rather than asserting the prefix is
unused. See [§4.1](#41-what-this-migration-owns-r4).

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
