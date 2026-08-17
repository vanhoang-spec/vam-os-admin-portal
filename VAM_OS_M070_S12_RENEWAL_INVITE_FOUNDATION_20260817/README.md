# VAM OS — M070 Season 12 Returning-Mentor Renewal Invite Foundation

**Package status: AUTHORED, NOT EXECUTED. Nothing in this package has been run
against Production, Staging, or any database.** No SQL here has been executed
anywhere, including locally — see §11 for exactly what that costs and where the
residual risk sits.

| | |
|---|---|
| Workspace | `C:\vam-renewal-p0` |
| Branch | `feat/s12-returning-mentor-renewal-p0` |
| Base | `5c7852e9974d7cf1cf450f90c75f10fb4dcb24fb` |
| Date | 17 Aug 2026 |
| Target | Production `vam-os-mvp` / `qkkroesfiazsejkzflcd` |
| Prerequisite | S12 release R4.2 applied and verified (specifically T1 and T2) |
| Migration number | 070 — the first unclaimed number after 069 |
| Scope | **Security / DB foundation only.** No `/renew` page, no renewal form, no `/admin/renewals`, no email, no batch invitation |
| Revision | R2 — post independent review (`M070_STATIC_SECURITY = PASS`, `REMEDIATION_REQUIRED = YES`). One SQL token changed ([§10.1](#101-why-the-drop-is-if-exists-independent-review-remediation)); the normative [§7](#7-p0-runtime-blockers--the-runtime-package-must-not-ship-without-these) and [§8](#8-environment-and-the-next-execution-gate) added. No redesign |
| | R3 — Supabase SQL Editor compatibility. Three `\echo` meta-commands removed from `preflight.sql` and `verifier.sql`; the runbook rewritten for the SQL Editor. No security semantics changed — see [§9.0](#90-the-execution-path-is-the-supabase-sql-editor) |
| Next execution gate | **Production READ-ONLY preflight** — not a Staging apply. See [§8](#8-environment-and-the-next-execution-gate) |

| File | Role | Writes? |
|---|---|---|
| `preflight.sql` | READ-ONLY. 16 refusal conditions, plus an evidence row and a pass token | No |
| `apply.sql` | One transaction. Section 0 re-asserts the whole baseline; **does not depend on preflight having been run** | **Yes — once** |
| `verifier.sql` | READ-ONLY. 23 checks, all must PASS | No |
| `rollback.sql` | Refuses while any invite row exists. Never deletes an audit row. Never drops shared infrastructure | **Yes — emergency only** |

`supabase_migrations/070_person_season_invites.sql` is the canonical migration.
`apply.sql` is that file plus a header and a Section 0 re-assertion block;
everything from `-- ── 1. Prerequisites and unapplied proof` onward is
**byte-identical** between the two, asserted by
`__tests__/m070-renewal-invite-foundation.test.ts`.

---

## 1. What this package creates, and what it deliberately does not

**Creates:** one table, `public.person_season_invites`, its six CHECK
constraints, three unique arbiters, two operational indexes, one `updated_at`
trigger attached to the existing shared function, RLS-on-with-zero-policies, and
**three** new `admin_audit_log.action_type` values.

**Does not create:** any RPC, any policy, any grant, any row, any route, any
form, any email. A migration in this repository never mints a bearer token, and
`apply.sql`'s post-conditions abort if the table is non-empty when it commits.

Two TypeScript modules ship alongside it and are pure security contracts with no
UI and no database client:

| Module | What it is |
|---|---|
| `lib/renewal-invite-token.ts` | Minting, hashing, constant-time comparison, and **the** canonical gate — one function that the page render and the submit action both resolve |
| `lib/renewal-profile-safety.ts` | The renewal allowlist (derived from the approval allowlist, then stripped), the delta semantics, and the field-level BEFORE/AFTER diff |

---

## 2. The table

```
id             uuid  PK default gen_random_uuid()
token_hash     text  NOT NULL          sha256(token), 64 lowercase hex
person_id      uuid  NOT NULL  → people(id)          ON DELETE CASCADE
program_id     uuid  NOT NULL  → programs(id)        ON DELETE RESTRICT
season_id      uuid  NOT NULL  → seasons(id)         ON DELETE RESTRICT
role           text  NOT NULL          'mentor' | 'mentee'
created_by     uuid  NOT NULL  → admin_users(id)     ON DELETE RESTRICT
created_at     timestamptz NOT NULL default now()
updated_at     timestamptz NOT NULL default now()
expires_at     timestamptz NOT NULL
revoked_at     timestamptz NULL
submitted_at   timestamptz NULL
outcome        text NULL              'accepted' | 'declined'
application_id uuid NULL  → applications(id)         ON DELETE RESTRICT
```

### 2.1 Foreign-key behaviour, derived rather than chosen

| Column | Action | Repository precedent |
|---|---|---|
| `person_id` | **CASCADE** | `crm_notes.person_id` (052), `mentor_profiles.person_id`, `mentee_profiles.person_id`. An invite is meaningless without the human it binds, and an orphan row would leave a live token hash bound to nothing |
| `program_id` | **RESTRICT** | 052, 061 |
| `season_id` | **RESTRICT** | 052, 061 |
| `created_by` | **RESTRICT** | The repository writes `SET NULL` for `admin_users` provenance columns (052, 061) — but **every one of those columns is nullable**. This one is NOT NULL by contract, so `SET NULL` is not representable: it would raise `23502` at delete time instead of doing anything useful. RESTRICT states the same intent honestly |
| `application_id` | **RESTRICT** — *a deliberate divergence from the expected `SET NULL`* | see below |

**Why `application_id` is RESTRICT and not `SET NULL`.** `SET NULL` is the
repository convention for optional linkage (045a, 051), and it would be right if
`application_id` were free-floating. It is not: it is one half of
`person_season_invites_application_binding_check`, which makes *accepted ⇔
exactly one applications row* and *declined ⇒ none* structural. Under `SET
NULL`, deleting an application fires an UPDATE that nulls `application_id` while
`outcome` stays `'accepted'` — the CHECK rejects it, **so the delete fails
anyway**, with a constraint violation that names neither table. RESTRICT
produces the same outcome for the same reason and says so. The alternative —
weakening the binding check to one direction so `SET NULL` can fire — trades a
load-bearing invariant for a delete path nothing in this system uses: no code
anywhere deletes an `applications` row, and `application_reviews` /
`application_decisions` already CASCADE from it.

### 2.2 CHECK constraints

| Constraint | Enforces |
|---|---|
| `..._role_check` | `role IN ('mentor','mentee')` |
| `..._outcome_check` | `outcome IS NULL OR outcome IN ('accepted','declined')` |
| `..._token_hash_format_check` | `token_hash ~ '^[0-9a-f]{64}$'` |
| `..._outcome_binding_check` | `(submitted_at IS NULL) = (outcome IS NULL)` |
| `..._application_binding_check` | `(outcome IS NOT DISTINCT FROM 'accepted') = (application_id IS NOT NULL)` |
| `..._expiry_check` | `expires_at > created_at` |

`token_hash_format_check` is the one worth pausing on. A runtime token is 43
base64url characters; a SHA-256 digest in lowercase hex is exactly 64 characters
from `[0-9a-f]`. **A raw token is therefore structurally unrepresentable in that
column.** "No raw token is stored" stops being a property of the code that
writes to the table and becomes a property of the table.

### 2.3 Indexes

| Index | Kind | Purpose |
|---|---|---|
| `..._token_hash_key` | UNIQUE `(token_hash)` | The only lookup path, and the global token arbiter |
| `..._live_key` | UNIQUE `(person_id, season_id, role) WHERE revoked_at IS NULL AND submitted_at IS NULL` | The live-invite arbiter — §3 |
| `..._accepted_key` | UNIQUE `(person_id, season_id, role) WHERE outcome = 'accepted'` | At most one acceptance, ever — §3 |
| `..._season_role_idx` | `(season_id, role)` | Admin listing of a season's renewal cohort |
| `..._application_id_idx` | `(application_id) WHERE application_id IS NOT NULL` | The confirmation orchestrator resolves the invite **from** the application |

---

## 3. The live-invite arbiter — the one decision here that had a real alternative

The question posed was whether the arbiter should be

```sql
UNIQUE(person_id, season_id, role) WHERE revoked_at IS NULL
```

or

```sql
UNIQUE(person_id, season_id, role) WHERE revoked_at IS NULL AND submitted_at IS NULL
```

**The second was chosen, and a second arbiter was added to cover what it gives
up.**

### 3.1 Why `WHERE revoked_at IS NULL` alone is wrong

A submitted invite stays non-revoked forever. Revocation is an *administrative
kill before use*; a mentor who has already renewed was never killed. So under
the narrow predicate the completed row occupies the `(person, season, role)`
slot permanently, and re-inviting the same person for the same season and role
becomes possible **only by writing `revoked_at` onto a completed invite**. That:

- overloads "revoked" with "used", destroying the distinction between *cancelled
  before use* and *answered*;
- forces an audited administrative action (`revoke_renewal_invite`) to be emitted
  as a side effect of an ordinary re-invitation, so the audit trail records
  something that did not happen;
- bites hardest exactly where re-invitation is most legitimate — **after a
  decline**.

### 3.2 What the arbiter actually has to guarantee

At most one **usable** token per person + season + role at a time. A submitted
invite is not usable — the gate refuses re-submission — so the live set is
precisely `revoked_at IS NULL AND submitted_at IS NULL`. The chosen index states
that and nothing else.

### 3.3 Behaviour, per the four cases

| Case | Behaviour |
|---|---|
| **Successful renewal** | `submitted_at` is written; the row leaves the live set. Nothing is revoked, nothing is rewritten, nothing is deleted |
| **Decline** | Identical. `outcome='declined'`, no applications row, and the person is immediately re-invitable by a plain INSERT with the decline preserved beside it |
| **Regeneration / re-invitation** | A lost or mis-sent link is fixed by revoking the live invite (`revoked_at`, audited as `revoke_renewal_invite`) and inserting a new one. Exactly one live invite at any instant; both rows survive |
| **History** | Nothing is ever deleted or overwritten to make room. Every invite ever issued stays readable, with who issued it, when it expired, whether it was killed, and how it was answered |

### 3.4 The invariant the narrow arbiter would otherwise give up

Relaxing the live arbiter means an admin *could* issue a second invite after a
successful renewal, and two acceptances would produce two applications rows and
two canonical-profile refreshes for one human in one season. That is the real
cost, and it is paid for by the second arbiter:

```sql
UNIQUE(person_id, season_id, role) WHERE outcome = 'accepted'
```

A person may decline and be re-invited any number of times; they may **accept
once**, per season and role, permanently. A second acceptance fails at the
database and the submit gate surfaces the uniform public failure.

**The index alone is not the whole contract, and the independent review was
right to press on this.** It blocks the second *acceptance*; it does not block
the second *invitation*, and it does not stop a stale post-acceptance link from
being used to **decline**. Both gaps are now normative P0 blockers on the
runtime package rather than advisory prose:

- **[P0-RT-1](#p0-rt-1--create-invite-must-refuse-after-an-accepted-renewal)** —
  `create_renewal_invite` must refuse at issue time when an accepted invite
  already exists for the key;
- **[P0-RT-2](#p0-rt-2--decline-must-refuse-after-an-accepted-renewal)** — the
  decline path must refuse when an accepted renewal already exists, so a
  mistakenly issued post-acceptance invite can never be used to undo a confirmed
  Season-12 renewal.

Neither is **a substitute for the index**, which is what still holds if a
runtime check is skipped; and the index is not a substitute for them, because it
fires too late and reports as a generic failure. See §7.

**No campaign model is introduced.** There is no batch, no cohort table, no
recruitment-campaign linkage. One row per invitation.

---

## 4. Security posture

| | |
|---|---|
| RLS | **ENABLED** |
| FORCE RLS | **NOT SET** — deliberately; see below |
| Policies | **ZERO** |
| Grants to `anon` / `authenticated` / `PUBLIC` | **NONE.** `REVOKE ALL` from all three |
| `service_role` | Retains SELECT/INSERT/UPDATE/DELETE; a post-condition aborts the apply if any of it was held via `PUBLIC` and got revoked |

### Why FORCE ROW LEVEL SECURITY is not set

The brief asked for FORCE *if consistent with the current hardened Production
conventions and if service-role access remains correct.* **It is not
consistent**, and the reason is structural rather than stylistic:

- The accepted S12 release `T2_security_rls_grant_minimum.sql` enables RLS on ten
  Day-1 tables and its own post-condition **4c aborts the transaction if FORCE is
  set on any of them**, with the note "or the owner locks itself out".
- `VAM_OS_PROD_S12_RELEASE_20260809/preflight.sql` refuses a database where FORCE
  is set (`[RLS_FORCED]`).
- M069 refuses to apply if FORCE is set on `admin_audit_log`, because FORCE
  subjects the table **owner** to policies too — so a `SECURITY DEFINER` function
  owned by `postgres` is filtered by a policy set that is deliberately empty.

The renewal runtime's gate and its admin confirmation orchestrator will be
exactly such functions, or will run as `service_role`. FORCE would make this the
only table in the database with that posture and would break the trusted path the
table exists to serve, for no gain: with zero policies and zero web-role grants,
`anon` and `authenticated` already see nothing and can write nothing. FORCE only
changes what the **owner** can do.

`preflight.sql` and `apply.sql` Section 0 additionally refuse if FORCE is set on
`admin_audit_log`, and `verifier.sql` V17 fails if FORCE ever appears on
`person_season_invites`.

---

## 5. Audit vocabulary

### 5.1 The three values added

| Value | The row it writes, that nothing else carries |
|---|---|
| `create_renewal_invite` | An admin minted a person-bound bearer token. There is no other record of who issued it to whom |
| `revoke_renewal_invite` | An admin killed a live token. Same |
| `confirm_renewal` | The admin confirmation step — **the only durable record of the field-level BEFORE/AFTER diff the admin approved** before canonical profile mutation |

`confirm_renewal` is the one that needs defending, because the two mutations it
drives are already audited: `vam063_add_membership_role` writes
`add_membership_role`, and `approveApplication` writes
`approve_application_as_mentor`. **Neither of those rows carries the profile
diff.** Without `confirm_renewal`, the P0 before/after requirement has evidence
on a screen and none in the database.

### 5.2 The four candidates reviewed and refused

| Refused | Why the runtime does not write it |
|---|---|
| `submit_renewal` | The actor is an **unauthenticated token holder**, not an admin. Writing an `admin_audit_log` row with a NULL admin actor for a public action pollutes the admin audit trail and creates an anonymous write path into it. The record of a submission already exists and is stronger: the invite row's `submitted_at`/`outcome`, plus the `applications` row itself |
| `decline_renewal` | Same reasoning. Recorded by `submitted_at` + `outcome='declined'`; and where a decline reaches an existing S12 membership, `vam063_opt_out_membership` writes its own audited row under `opt_out_membership`, which the vocabulary already admits |
| `regenerate_renewal_invite` | Regeneration **is** revoke-then-create. It emits the two rows above, which is a truthful account of what happened. A third value would be a synonym that makes one event queryable two incompatible ways |

The rule applied: *add a value only where the runtime genuinely writes a row that
no existing value can carry.* A test asserts none of the three refused values
appears in any SQL file in this package.

### 5.3 How every existing value is preserved — structurally, not by assertion

M069 replaces the constraint with a **hard-coded** list and proves by set
equality that the list it replaced was the one it expected. That is safe, and it
is an assertion: if the expectation is wrong in a way the check does not model,
a legitimate Production value disappears.

M070 hard-codes nothing. It:

1. finds the `action_type` CHECK **by definition, not by name**, then asserts the
   name (because the DROP is by name), that there is exactly one, and that it is
   `VALIDATED`;
2. parses `pg_get_constraintdef()` into the set it actually admits, and **proves
   the parse is complete** — every quote character in the definition must belong
   to a captured `'value'::text` element, and no duplicates — so a value the
   regex could not read cannot be silently dropped;
3. builds the replacement as **(live admitted set) ∪ (the three new values)** and
   installs it with `format()` + `quote_literal()`;
4. re-reads the installed definition and proves it is the pre-drop set plus
   exactly three, and that it came back `VALIDATED`.

There is no list anywhere in `apply.sql` that could omit a Production value. A
test asserts that no file in this package contains a literal
`add constraint admin_audit_log_action_type_check check (action_type = any
(array['…`, i.e. that the M069 shape has not crept back in.

### 5.4 Two accepted baselines, because M069's status is genuinely open

M069 is recorded as **PREPARED, NOT APPLIED**. Either state is possible on
Production today, so this package accepts exactly two and refuses everything
else by name:

| Baseline | Set |
|---|---|
| `BASE52` | The canonical 52 installed by the S12 release T1 |
| `BASE53` | Those 52 + `set_application_form_state` (M069 applied) |

The preflight token and the evidence row both report which one was found. The
canonical 52 live once, in
[`__tests__/support/m069-audit-vocabulary.ts`](../__tests__/support/m069-audit-vocabulary.ts);
a test proves every copy in this package is set-equal to it, exactly the
anti-drift arrangement M069 established.

`verifier.sql` V20 is therefore a **superset** test, not a set-equality test: the
canonical 52 must all still be admitted, the three M070 values must be admitted,
and the constraint must be `VALIDATED`. Requiring exact equality would fail on
the BASE53 database for no reason.

---

## 6. Renewal safety contract (for the runtime package that comes next)

### 6.1 Identity binding

`person_id`, `program_id`, `season_id` and `role` come from the invite row and
from nowhere else. The renewal flow never asks the visitor who they are — the
token *is* the identity claim and the row is the answer. `lib/renewal-invite-token.ts`
exposes `renewalBindingFromInvite(invite)` so that this is something code
**calls**, not something a reviewer has to notice the absence of; there is no
overload taking an email, a person id, or a season. A test asserts the module's
source contains no reference to `email` at all.

### 6.2 Historical fields stripped

`first_vam_season` **must not** be emitted into the renewal canonical-refresh
payload, and `prior_vam_involvement` stays historical too.

`buildMentorProfileRefresh` is **not modified** — and it does emit
`first_vam_season`, which is correct for approval, where a new mentor's first
season is established. `lib/renewal-profile-safety.ts` therefore *derives* from
it and strips:

```
buildRenewalProfileRefresh(payload) = buildMentorProfileRefresh(payload) − {first_vam_season, prior_vam_involvement}
```

A second, independent allowlist was rejected: two allowlists drift, and the
renewal copy is the one nobody updates when a field is added to the S12 payload.
Deriving-and-stripping makes the renewal allowlist **structurally incapable of
being wider** than the reviewed approval allowlist — the only direction it can
move is narrower. A test asserts exactly that, and asserts the approval allowlist
still emits `first_vam_season`, so the reason this module exists cannot be
forgotten.

The renewal form **may display** both fields as read-only context. Displaying is
not editing.

### 6.3 Delta semantics

| Input | Result |
|---|---|
| omitted | key absent from the patch → column preserved |
| blank (`""`, whitespace, non-numeric for a numeric field) | key absent → column preserved |
| valid, changed | key present → **candidate** update |
| explicit clear | **unsupported in P0** |

The last row is a property of the shape, not a rule to remember: every value in
the patch is non-blank, so "set this column back to NULL" has no representation.
A mentor who wants a field emptied asks an admin. Supporting explicit clears
through an unauthenticated token-bearing form would mean one mis-sent link could
blank a canonical profile.

### 6.4 Admin BEFORE / AFTER diff — P0, not P1

A renewal is submitted by a bearer-token holder with **no reviewer screening**,
and it lands on a `mentor_profiles` row that is already canonical and already
referenced by matching, search and export. "Approve" without a diff is an admin
agreeing to a change they were never shown.

`buildRenewalProfileDiff(current, candidate)` returns `{field, before, after}`
for **genuinely changed fields only**, compared after normalisation, in
deterministic field order. An empty array is the honest answer to "this renewal
changes nothing" and the UI should say so rather than render an empty table.
`renewalProfileUpdateFromDiff(diff)` is the write set: exactly the changed
columns, so `updated_at` never claims a change the admin was not shown.

The returned array is also the payload the `confirm_renewal` audit row carries.

**The `current` argument must be a FRESH read.** `buildRenewalProfileDiff` is a
pure function over whatever it is handed, so it cannot tell a profile read taken
seconds ago from one taken at submit time weeks ago. Handing it a stale snapshot
produces a diff whose "before" column is a claim about the past presented as the
present, and the admin would be approving a revert of whatever changed in
between. Freshness is therefore a requirement on the CALLER, and it is normative:
**[P0-RT-4](#p0-rt-4--the-admin-confirm-diff-must-be-computed-from-a-fresh-profile-read)**.

### 6.5 Confirmation ordering, and partial failure

```
1. resolve the authenticated current Admin server-side
2. resolve the renewal application + its invite
3. verify person / program / season / role binding matches EXACTLY
4. verify the invite is submitted with outcome='accepted'
5. show the field-level BEFORE/AFTER diff; the admin confirms it
6. vam063_add_membership_role(actor = the CURRENT confirming admin, …)
7. approveApplication(…)
8. write the confirm_renewal audit row carrying the diff
```

Case A (membership already exists) → the RPC returns `noop`.
Case B (no membership) → the RPC returns `created`.

**Partial failure.** If step 6 succeeds and step 7 fails, the membership exists
and the application is still unapproved. That state is safe and retryable
precisely because the RPC is idempotent: on retry, step 6 re-runs and returns
`noop` (its advisory lock keyed on `person_id + season_id + role`, plus the live
`UNIQUE(person_id, season_id, role)`, make that a controlled no-op rather than a
`23505`), and step 7 is attempted again. **Retry is therefore always safe and is
the correct response** — there is no compensating delete, and no membership row
is ever removed to "undo" a failed approval.

**Membership logic stays out of `approveApplication`.** The orchestrator calls
both; `approveApplication` is unchanged and knows nothing about memberships.

Steps 5-8 are governed by
**[P0-RT-4](#p0-rt-4--the-admin-confirm-diff-must-be-computed-from-a-fresh-profile-read)**
(the diff must come from a fresh profile read inside the confirm transaction, or
be revalidated with optimistic concurrency and refused on drift),
**[P0-RT-6](#p0-rt-6--admin-confirm-requires-the-field-level-beforeafter-diff)**,
**[P0-RT-7](#p0-rt-7--the-current-confirming-admin-is-the-membership-actor)** and
**[P0-RT-8](#p0-rt-8--membership-rpc-precedes-approval-and-retry-is-safe)**.

### 6.6 Decline

Mentor selects NO → no `applications` row is created. The invite records
`submitted_at` and `outcome='declined'` and `application_id` stays NULL — a
CHECK constraint makes any other combination unrepresentable.

**The decline write is subject to
[P0-RT-2](#p0-rt-2--decline-must-refuse-after-an-accepted-renewal) and
[P0-RT-3](#p0-rt-3--same-invite-double-submit-must-be-transactionally-single-winner):**
it must refuse outright if an accepted renewal already exists for the same
person + season + role, and it must claim the invite through the same atomic
single-winner transaction the accept path uses. A decline is a submit; it takes
the same slot and needs the same protection against a concurrent second click.

If the person has **no** S12 membership, nothing is written to memberships. If an
S12 membership exists in an allowed state, the trusted runtime calls
`vam063_opt_out_membership`, which is audited under the existing
`opt_out_membership` value. **Season 11 is never addressed** — no artifact in
this package references S11, asserted by test — and no new lifecycle vocabulary
is introduced.

### 6.7 The token gate

| | |
|---|---|
| Mint | `randomBytes(32).toString("base64url")` → exactly **43** characters, asserted on every mint |
| Persist | `sha256(token)` as 64 lowercase hex, and nothing else |
| Look up | Equality on the unique `token_hash` index; the raw token never reaches the query layer (asserted) |
| Compare | `timingSafeEqual` on the digests, after a canonical-format check on both operands |
| Canonical gate | **One** function, `evaluateRenewalInviteGate`, resolved by both the page render and the submit action; they differ only by an `intent` argument, and that difference is expressed inside the gate |
| Uniform failure | Malformed, not found, hash mismatch, revoked, expired, already submitted (on submit), and any DB/service-role error all return the **identical** public message. A test collects the message from all seven paths and asserts the set has exactly one member |
| Fail closed | A loader that returns `{ok:false}` **or throws** is denied. An unparseable `expires_at` is denied — it is not "no expiry" |
| No GET mutation | The gate is pure. The module contains no `.from(`, `.insert(`, `.rpc(`, no Supabase client, and no write path of any kind — asserted |
| Submitted token | Cannot submit again (`intent:"submit"` → denied). **May** render a read-only completion state (`intent:"render"` → `completed`) — unless it was since revoked or has expired, in which case the uniform failure wins, because a dead link should not tell a story |
| **Not a claim** | The gate decides; it does not reserve. Gate-then-write is TOCTOU, so the actual submit must re-apply the whole predicate inside a locked transaction — **[P0-RT-3](#p0-rt-3--same-invite-double-submit-must-be-transactionally-single-winner)** |
| Headers | `RENEWAL_ROUTE_HEADERS` exports `Referrer-Policy: no-referrer` (the token is **in the URL**) and `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` |
| Route config | `RENEWAL_ROUTE_SEGMENT_CONFIG` exports `dynamic: "force-dynamic"`, `revalidate: 0`, `fetchCache: "force-no-store"` |

Both header and route constants are exported **as data** so the route cannot
quietly omit one and so a test can assert them without rendering anything.

Rate limiting is **not** a brute-force control here — 256 bits of entropy makes
guessing irrelevant — but the `/renew` route package should still carry one, for
denial of service.

---

## 7. P0 RUNTIME BLOCKERS — the runtime package must not ship without these

**This section is normative.** Every requirement below is a P0 blocker on the
package that builds `/renew/[token]`, the renewal form and the admin
confirmation screen. They are recorded here, in the foundation package, because
the foundation is what a reviewer reads first and because several of them are
things the database deliberately does **not** enforce — the reasoning for each
non-enforcement is given, so "the schema didn't stop it" can never be the
explanation for one being missed.

Each blocker carries a stable ID. `__tests__/m070-renewal-invite-foundation.test.ts`
asserts every ID is present in this README with its requirement text, so a
future edit cannot quietly delete one.

---

### P0-RT-1 · create-invite MUST refuse after an accepted renewal

`create_renewal_invite` **must refuse** to mint a new invite when an invite with
`outcome = 'accepted'` already exists for the same `person_id + season_id +
role`. The refusal happens **at issue time**, before a token is generated, and
is surfaced to the admin as a named error — not as a generic failure.

**Why the index is not enough.** `person_season_invites_accepted_key` blocks the
*second acceptance*, not the *second invitation*. Without P0-RT-1, an admin can
mint and email a perfectly valid-looking renewal link to a mentor who has
already renewed; the mentor fills the form in and only then hits a `23505` that
the gate reports as the uniform public failure. The mentor is told their link
does not work, the admin believes they sent a working one, and the only record
of the mismatch is a constraint violation in a log. The index is the last line;
this is the first.

**Why not a DDL constraint.** Refusing at INSERT would need a cross-row
predicate — "no other row for this key has `outcome='accepted'`" — which is not
expressible as a CHECK and would need a trigger. This remediation deliberately
changes no table DDL. It is a runtime precondition, and P0-RT-1 is what makes it
binding.

---

### P0-RT-2 · decline MUST refuse after an accepted renewal

The decline path **must refuse to call `vam063_opt_out_membership`** — and must
refuse to record the decline at all — when an accepted renewal already exists
for the same `person_id + season_id + role`.

**Why this is the sharpest requirement in this section.** Suppose P0-RT-1 is
bypassed, or an invite was issued before the acceptance landed, and a second
live invite for an already-renewed mentor reaches someone's inbox. Without
P0-RT-2, clicking **NO** on that stale link would opt the mentor out of a Season
12 membership an admin had already confirmed. **A mistakenly issued
post-acceptance invite must never allow a later decline to undo an
already-confirmed Season-12 renewal.** The renewal flow is unauthenticated and
token-bearing; an undo path that destroys confirmed canonical state is not
acceptable at any probability.

The check is a read of `person_season_invites` for the same key with
`outcome = 'accepted'`, performed **inside the same trusted transaction as the
decline write** (see P0-RT-3), not before it. Season 11 is never consulted and
never affected.

---

### P0-RT-3 · same-invite double-submit must be transactionally single-winner

Two concurrent submits of the **same** invite must never produce two
`applications` rows.

`evaluateRenewalInviteGate` **is not sufficient on its own**, and relying on it
would be a defect: it reads, decides, and returns, and the write happens
afterwards. Between the read and the write, a second request can pass the same
gate against the same not-yet-submitted row. That is a textbook TOCTOU race, and
the gate is documented as pure precisely so nobody mistakes it for a claim.

**The required boundary.** The submit path must be **one trusted database
transaction** — a `SECURITY DEFINER` RPC executed by `service_role`, in the
shape `vam063_*` already establishes for membership lifecycle — that performs
all of this or none of it:

1. `select … from public.person_season_invites where token_hash = $1 **for update**`
   — the row lock is what serialises the two callers;
2. **re-apply the complete gate predicate inside the transaction**: not revoked,
   not expired, `submitted_at is null`. The pre-transaction gate decision is
   advisory; this one is authoritative;
3. re-check P0-RT-2's accepted-invite condition here, under the same lock;
4. `insert into public.applications (…) values (…)` with `person_id` **known at
   INSERT**, every identity column taken from the locked invite row and nothing
   from the client;
5. `update public.person_season_invites set submitted_at = now(), outcome = $,
   application_id = $ where id = $ **and submitted_at is null**`;
6. `get diagnostics … = row_count` — **must be exactly 1**. Anything else
   (`0` because the loser lost, or `>1`, which cannot happen but is checked
   anyway) must `raise exception`, which rolls the INSERT back with it;
7. commit both, or neither.

**The loser fails closed** — it either blocks on the `for update` and then finds
`submitted_at` non-null, yielding `row_count = 0`, or its conditional UPDATE
matches nothing. Either way it raises, its application INSERT is rolled back,
and the caller receives the single uniform public failure. It must not retry
automatically and must not fall through to a "success" render.

**Replay cannot overwrite.** `submitted_at`, `outcome` and `application_id` are
protected by the `and submitted_at is null` predicate in step 5: once written,
no later submit can rewrite them, because no later UPDATE can match. A
column-level immutability trigger would make this structural rather than
predicate-dependent; it is recorded as a deferred LOW in §13 and is **not** a
substitute for step 5.

---

### P0-RT-4 · the admin confirm diff must be computed from a FRESH profile read

The field-level BEFORE/AFTER diff the admin approves must be derived from a
**fresh canonical `mentor_profiles` read taken at confirmation time**, inside
the confirm transaction. A snapshot captured at renewal submit — which may be
hours or weeks old — is **insufficient**.

**Why.** Between submit and confirm, an admin can edit the mentor profile
directly through `/mentors/[id]/edit`. If the diff still shows the stale
"before", the confirming admin approves a change *away from a value that is no
longer there*, silently reverting a colleague's edit. **The admin must never
approve a "before" state that is no longer true.**

The runtime package must do **one** of:

- **(a) recompute inside the transaction.** `select … from public.mentor_profiles
  where person_id = $ **for update**` inside the confirm transaction, recompute
  `buildRenewalProfileDiff(freshProfile, candidate)` from that read, and write
  `renewalProfileUpdateFromDiff(freshDiff)`; **or**
- **(b) optimistic concurrency.** Carry the displayed snapshot's identity
  (`mentor_profiles.updated_at`, or the exact displayed before-values per field)
  into the confirm call and **refuse** — `40001`-style, with a "the profile
  changed since this diff was shown; re-review" message — if the current row
  disagrees. Refusing is mandatory; silently applying is not an option.

Under (a), if the fresh diff is **empty**, the confirmation must say so and
write no profile columns rather than proceeding on the stale list. Under either
option, the `confirm_renewal` audit row records the **fresh** before-state that
was actually written, not the one that was first displayed.

---

### P0-RT-5 · `first_vam_season` and `prior_vam_involvement` stay stripped

The renewal canonical-refresh payload must continue to be produced by
`buildRenewalProfileRefresh` (§6.2) and must never carry either field, whatever
the submitted payload contains. The renewal form may **display** both as
read-only history. `buildMentorProfileRefresh` stays unmodified.

---

### P0-RT-6 · admin confirm requires the field-level before/after diff

No canonical `mentor_profiles` column may be written by the renewal path without
the confirming admin having been shown the field-level BEFORE/AFTER diff and
having confirmed it. There is **no reviewer screening** in front of a renewal —
this diff is the only human gate between a bearer-token submission and a
canonical profile. P1 is not an acceptable home for it.

---

### P0-RT-7 · the CURRENT confirming Admin is the membership actor

`vam063_add_membership_role` must be called with `p_actor_admin_user_id` = the
**authenticated admin performing the confirmation**, resolved server-side at
confirm time. Not the invite's `created_by`, not a service account, not a value
from the request. The RPC's own scope check (`vam063_authorized_for_scope`,
exact program + season) then applies to that admin, and `admin_audit_log`
attributes the membership to the person who actually decided.

---

### P0-RT-8 · membership RPC precedes approval, and retry is safe

The order is fixed: `vam063_add_membership_role` **then** `approveApplication`
**then** the `confirm_renewal` audit row. Membership logic stays out of
`approveApplication`, which is unchanged.

If the RPC succeeds and `approveApplication` fails, the membership exists and
the application is unapproved. That state is **safe and retryable**: on retry
the RPC's advisory lock on `person_id + season_id + role` plus the live
`UNIQUE(person_id, season_id, role)` make it a controlled `noop` rather than a
`23505`, and approval is attempted again. **Retry is the correct response.**
There is no compensating delete, and no membership row is ever removed to undo a
failed approval.

---

## 8. Environment, and the next execution gate

### The Production-only guard is unchanged

`preflight.sql` and `apply.sql` Section 0 both refuse with
`[ENV_NOT_PRODUCTION]` when any `vam062_*` function is present, which is the
established marker for Staging. **This remediation does not weaken, relax,
parameterise or bypass that guard, and no artifact in this package acquired a
Staging mode.**

### The owner decision, recorded accurately

**We are not attempting to make this package run on Staging.** Staging carries
the `vam062_*` lineage and a different audit-vocabulary history; adapting the
package to run there would mean either weakening the environment guard or
maintaining a second baseline, and neither buys evidence about the database this
package is actually for.

### The next gate

```
independent delta review of this remediation
        ↓
Production READ-ONLY preflight          ← the next execution gate
        ↓
(only if it passes, and only then)  apply
```

The next execution is therefore the **Production `preflight.sql`**, not a
Staging apply. That is a read-only step by construction: both of its blocks run
inside `begin; set transaction read only; … rollback;`, so the session rejects a
write with SQLSTATE `25006` even if the file were later edited carelessly, and a
test asserts the file contains no write statement of any kind. It takes no lock
and changes nothing.

This does mean the package's first-ever execution against any database will be
that preflight — see §11, which states plainly that no SQL here has been run
anywhere.

## 9. Owner execution sequence

**Do not run any of this until independent security review has passed.**

### 9.0 The execution path is the Supabase SQL Editor

Every owner-executable file in this package is **plain PostgreSQL SQL with zero
psql meta-commands**. There is no `\echo`, no `\i`, no `\set`, no `\gexec`,
nothing beginning with a backslash — asserted by
`__tests__/m070-renewal-invite-foundation.test.ts`, which fails the build if one
reappears in `preflight.sql`, `apply.sql`, `verifier.sql`, `rollback.sql` or the
canonical migration.

**This was a defect, and it is worth stating plainly.** The R2 revision opened
`preflight.sql` and `verifier.sql` with `\echo` banners. The owner pasted
`preflight.sql` into the Supabase Production SQL Editor and it failed on the
first line of the file:

```
ERROR: 42601: syntax error at or near "\"
LINE 65: \echo '=== M070 PREFLIGHT — READ ONLY — BLOCK 1: refusals ==='
```

The SQL Editor is not psql; it hands the text to the server, and the server has
never understood backslash commands. **Nothing was executed** — the parse
failed before any statement ran, so no read, no lock, and certainly no write
reached Production. The banners were cosmetic and are now
`select '…' as phase;` statements, which say the same thing in a way the server
understands.

**How to run a file:** open the Supabase SQL Editor against the Production
project, paste the file's contents, and run it. Nothing needs to be uploaded and
no path is referenced.

### 9.1 Step 1 — preflight (READ ONLY, safe to run any time)

`preflight.sql` is in **two blocks**, and they must be run as **two separate
editor runs** — paste and run BLOCK 1 (everything up to and including its
`rollback;`), then paste and run BLOCK 2. Two independent reasons:

- the editor displays the result of the **last** row-returning statement, so a
  single combined run would hide BLOCK 1's verdict behind BLOCK 2's evidence
  row;
- `set transaction read only` must be the first statement in its transaction,
  which a fresh run guarantees.

Prefix each run with `set timezone = 'UTC';` or the emitted values are not
comparable across environments.

**BLOCK 1** returns one row when it passes:

| phase | result | detail |
|---|---|---|
| `M070 PREFLIGHT — BLOCK 1` | `PASSED` | `every refusal condition was evaluated and none fired` |

If it refuses instead, the editor shows the raised error, e.g.
`M070 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: …`. **Stop.** Every refusal
names its condition in brackets; none is safe to skip.

> The PASS row exists because the Supabase SQL Editor does not surface
> `raise notice`. Without it, a passing BLOCK 1 produced no visible output —
> indistinguishable from a file that did nothing. The row is **evidence, not a
> gate**: it is only reached when the guard did not raise, because PostgreSQL
> aborts the whole batch at the raising statement. The `NOTICE` is kept as well,
> for anyone running under psql.

**BLOCK 2** returns the evidence row and the token:

```
M070:ABSENT:BASE52:VALIDATED:FKTARGETS5:UPDATEDAT
```

(`BASE53` instead of `BASE52` if M069 has been applied.) Record both blocks in
full, with the run timestamp.

Both blocks run inside `begin; set transaction read only; … rollback;`, so the
session rejects a write with SQLSTATE `25006`, and neither block contains an
`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `GRANT`, `REVOKE` or any DDL — also
asserted by test.

### 9.2 Step 2 — apply (one transaction)

```sql
set timezone = 'UTC';
```

then paste and run `apply.sql`.

Expect `M070 Section 0 passed…`, `M070: audit vocabulary extended to N values…`
and a clean `COMMIT`. The two `NOTICE` lines are visible under psql; in the SQL
Editor the meaningful signal is that the run **succeeds** rather than raising —
every refusal raises, and a raise aborts the transaction with nothing written.

`apply.sql` is one transaction that begins with `begin;` and ends with
`commit;`. Its atomicity does not depend on how the editor manages its own
session: a `COMMIT` issued inside an already-aborted transaction is executed by
PostgreSQL as a `ROLLBACK`, so a failure at any guard leaves nothing behind.

If you run it under psql instead, use `ON_ERROR_STOP`.

### 9.3 Step 3 — verify (READ ONLY)

```sql
set timezone = 'UTC';
```

then paste and run `verifier.sql`. It returns one table.

**All 23 checks must read PASS and `M070_VERIFIED` must be PASS.** If any check
fails, do not build anything on top of the table until it is resolved. Each row
carries the **live** definition in `detail`, so a failure can be read directly
rather than inferred.

### 9.4 Step 4 — deploy nothing

There is no runtime for this table yet. That is intentional: the foundation is
reviewed and applied first, and the `/renew` route, the renewal form, the admin
confirmation screen and the invitation tooling are separate packages built on
top of a verified base.

---

## 10. Rollback

`rollback.sql` **refuses while the table holds any row at all** — stricter than
M069's "refuses while a form is open", and deliberately so. A form's state is
re-creatable; an invitation history is not, and dropping the table also
invalidates every renewal link already sitting in a mentor's inbox.

To roll back deliberately:

1. revoke every live invite through the admin path, so the revocation is audited
   under `revoke_renewal_invite` and the mentors are told;
2. export `public.person_season_invites` in full and keep the export with the
   release evidence;
3. delete the rows deliberately, as a separate recorded act;
4. then run `rollback.sql`.

Steps 2 and 3 are **not** performed by this package. `rollback.sql` contains no
`DELETE` and no `TRUNCATE` anywhere, asserted by test.

It narrows the audit vocabulary by **subtracting** exactly the three M070 values
from whatever the live set is — symmetric with the apply, so anything the
vocabulary gained in between is preserved — and it **leaves the vocabulary
untouched** if any `admin_audit_log` row already uses an M070 value, printing why.
No audit row is ever deleted to satisfy a constraint. An audit trail that can be
rewound is not an audit trail.

`public.set_updated_at()` is **never dropped** — 17 triggers on other tables call
it in Production — and a post-condition asserts positively that it survived.
The single `DROP` in the file is
`drop table if exists public.person_season_invites`, by exact identity, asserted
by test.

### 10.1 Why the DROP is `IF EXISTS` (independent review remediation)

The previous revision used an unconditional `DROP TABLE`. That contradicted the
guard directly above it: the guard has a deliberate **table-absent branch** that
emits `already absent; only the audit vocabulary will be considered` and lets
the run continue — the correct behaviour after a partially-completed rollback or
a hand-repaired database. On exactly that path the unconditional `DROP` raised
`42P01`, so the file aborted **before reaching the vocabulary block it had just
promised to run**. The promise in the NOTICE was unreachable in practice.

This is not a relaxation of the exact-identity rule. The statement still names
one table by its full identity: it is not a prefix match, not a `CASCADE`, and
not a loop over a catalog scan — a test asserts all three. What `IF EXISTS`
tolerates is precisely the one state the guard has already inspected and
explicitly decided to proceed from. Every state this file refuses to reason
about is still refused **above**, by the guard, before that line is reached.

Nothing else in the rollback changed: still no `DELETE`, still no `TRUNCATE`,
still refuses while any invite row exists, still narrows the vocabulary only
when no audit row uses an M070 value, still leaves `public.set_updated_at()`
alone.

---

## 11. What has and has not been validated

**Tests:** `npm test` — `__tests__/m070-renewal-invite-foundation.test.ts`,
`__tests__/renewal-invite-token-gate.test.ts`,
`__tests__/renewal-profile-safety.test.ts`.

**Executed:** the TypeScript contracts, against the real `node:crypto`. Minting,
the 43-character invariant, the digest identity, the constant-time comparison,
every gate branch including the seven-way uniform-failure proof, the strip, the
delta semantics and the diff are all exercised, not merely described.

**Not executed:** every line of SQL in this package. No PostgreSQL instance was
contacted — not Production, not Staging, not a local container. The SQL is
therefore validated by static analysis and by review, and two consequences
follow honestly:

1. **`verifier.sql` pins definitions with anchored regexes, not with hard-coded
   rendered literals.** M069's verifier compares the complete
   `pg_get_constraintdef(oid, true)` text against a constant — the strongest
   possible test — but its constants were **reconciled against a live PostgreSQL
   15.18 catalog before they were trusted**, because the server's rendering of
   parentheses and casts cannot be derived with certainty from the source. A
   hard-coded literal here would be a guess wearing the costume of a proof, and
   its first FAIL would be indistinguishable from a real defect. The anchored
   regexes still reject every mutation M069 documents (an extra `OR` disjunct, an
   inverted operator, the wrong column — none matches a pattern anchored at both
   ends); what they do not do is prove the rendering byte-for-byte. Every check
   emits the **live** definition in `detail` whether it passes or fails, so a
   reviewer reads what is installed rather than a verdict about it.
2. **The first real run is part of the review, not a formality.** A syntax or
   catalog-shape error in the SQL would surface there. `apply.sql` is one
   transaction with a guard block that raises before the first mutation, and a
   `COMMIT` issued inside an already-aborted transaction is executed by
   PostgreSQL as a `ROLLBACK`, so a failure leaves nothing behind — but the
   review should treat "this has never been executed" as a stated fact about the
   package rather than an omission to discover.

**Still true after the R2 remediation of 17 Aug 2026.** That round changed one
SQL token (`DROP TABLE` → `DROP TABLE IF EXISTS` in `rollback.sql`), added the
normative §7 and §8, and added test assertions. **No SQL was executed, and no
database was contacted, in that round either.** `apply.sql`, `preflight.sql`,
`verifier.sql` and the canonical migration are byte-unchanged by it — only
`rollback.sql`, this README and the tests moved, and the checksums were
regenerated accordingly.

**R3, and the one thing that did reach Production.** The owner pasted
`preflight.sql` into the Supabase Production SQL Editor and it failed at
`LINE 65` with `42601: syntax error at or near "\"` — the `\echo` banner. That
is a **parse** failure: PostgreSQL rejected the statement text before executing
any statement in it, so no read ran, no lock was taken, and no write of any kind
occurred. Production was not mutated and no `apply.sql` or migration SQL was
ever authorized or run. The banners were cosmetic; they are now
`select … as phase;` statements (§9.0), and a test fails the build if a
backslash-leading line reappears in any owner-executable M070 file.

R3 changed `preflight.sql`, `verifier.sql` and this README. `apply.sql`,
`rollback.sql` and the canonical migration are byte-unchanged by it, which is
the strongest available statement that no security semantics moved. **R3
executed no SQL and contacted no database.** The package as a whole has still
never been run anywhere; the failed paste is the only time any of it has been
sent to a server, and it did not get past the parser.

---

## 12. Out of scope

Not implemented, not designed here, and not blocked by this package:
`/renew/[token]` page · renewal form UI · `/admin/renewals` · batch invitation ·
automated email · participant portal · mentee renewal (the table supports the
role; nothing else does) · new-mentor membership integration · Season-first UX ·
rate limiting on the `/renew` route · a campaign model.

---

## 13. Deferred findings

Recorded from the independent review, **deliberately not remediated in this
round**, and not blockers on the Production read-only preflight. Each is a real
observation; none of them changes what the preflight would report or what the
apply would install.

| # | Finding | Why it is deferred |
|---|---|---|
| D1 | **`token_hash` / `person_id` column immutability triggers.** Nothing in the DDL prevents an UPDATE from rewriting an issued invite's token hash or rebinding it to another person | Would be new table DDL, which this remediation is explicitly scoped out of. The trusted write path is the only writer (RLS on, zero policies, no web-role grant), and P0-RT-3 step 5's `and submitted_at is null` predicate already blocks the replay case. A column-immutability trigger is the structural form and belongs in its own reviewed change |
| D2 | **`revoked_at` / `submitted_at` timestamp ordering.** No constraint requires `revoked_at >= created_at` or orders the two against each other | Cosmetic-to-forensic, not a security boundary: neither column is read as a comparison against the other by any decision in the gate. New DDL, deferred |
| D3 | **`role_table_grants` catalog hardening in the verifier.** V18 reads `information_schema.role_table_grants`, which reports privileges for roles the current user can see; a more paranoid form reads `relacl` including `acldefault()` directly, as M069 V15 does for function ACLs | The current check is the one the accepted S12 release T2 post-condition 4a already uses on ten Production tables, so it is consistent with the reviewed baseline. Tightening it is a verifier-only improvement with no effect on what gets installed |
| D4 | **Numeric-versus-string cosmetic diff.** `buildRenewalProfileDiff` normalises `2` and `"2"` to different types (`number` vs `string`), so a payload that submits a capacity as a string against a numeric column renders as a change in the diff even when the value is equal | Display-layer only. It can produce one extra row on the admin's confirmation screen; it cannot produce a wrong write, because `renewalProfileUpdateFromDiff` writes the normalised `after` value either way. Fixing it means changing comparison semantics, which deserves its own test pass |
| D5 | **`public.set_updated_at()` has no pinned `search_path`.** M070 now attaches to it | Pre-existing shared infrastructure with 17 Production triggers, invoker-rights (not `SECURITY DEFINER`). Changing it is a blast radius far wider than this package and belongs in its own ticket |
| D6 | **Verifier V23 identifies Season 11 by `code like '%S11%'`.** A season named to include that substring for another reason would be misread | The check exists as a defence-in-depth assertion about data this table does not yet hold, and this package references no season at all. Naming-based season identification is a repo-wide pattern; changing it here alone would create a second convention |
| D7 | **`rollback.sql` carries no `[ENV_NOT_PRODUCTION]` guard**, unlike `preflight.sql` and `apply.sql` Section 0 | Deliberate asymmetry, and the safe direction: a rollback that refuses to run on the environment it is needed on is worse than one that runs. Its actual protection is state-based rather than environment-based — it refuses unless the table exists and is empty, which on Staging (where M070 was never applied) means it drops nothing and narrows nothing |

None of D1-D7 is a reason to hold the Production read-only preflight. They are
listed here so the next package's author inherits them rather than rediscovers
them.
