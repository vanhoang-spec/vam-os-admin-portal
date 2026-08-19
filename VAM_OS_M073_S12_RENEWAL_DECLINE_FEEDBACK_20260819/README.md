# VAM OS — M073 · S12 Renewal Decline Feedback

**Target:** STAGING (`ljfneyuvpxrmejpxsmpz`) **only**
**Date:** 2026-08-19
**Depends on:** M070 (`person_season_invites`), M071 (trusted renewal runtime), M072 (`vam063_trusted_api_role()` — one object only, see §10)
**Status:** BUILT — **NOT APPLIED**. Awaiting owner authorization.

Authorization phrase: `AUTHORIZE STAGING RENEWAL DECLINE FEEDBACK`

---

## 1. Scope

Closes findings F1–F5 of the independent narrow review of commit `2eae810`.

| Finding | Closed by |
|---|---|
| **F1** decline feedback written as an `applications` row with an invalid status | Column on the invite; the `applications` INSERT is deleted from the runtime |
| **F2** the row is unlinkable and orphaned by M070's binding constraint | No application row is created by a decline at all |
| **F3** mentor commitments not enforced server-side | `validateRenewalAcceptance` fails closed before the RPC |
| **F4** the 8 commitment keys hardcoded in three places | All three derive from `requiredCheckboxAcknowledgements("mentor")` |
| **F5** admin searched `applications` by person/season/status | Admin reads `person_season_invites.decline_feedback` |

Only F1/F2/F5 need the database. **F3 and F4 are pure application changes** and are
already in the working tree; they do not depend on this migration and are safe
independently of it.

## 2. What this package changes on the database

Exactly three objects:

```sql
alter table public.person_season_invites add column decline_feedback text;

alter table public.person_season_invites
  add constraint person_season_invites_decline_feedback_binding_check
  check (decline_feedback is null or outcome is not distinct from 'declined');

-- one signature replaced, not overloaded
drop   function public.vam071_submit_renewal_declined(text);
create function public.vam071_submit_renewal_declined(text, text default null) ...;
```

It does **not** create a table, an index, a policy, a trigger, a seed row, an
invite, or an audit-vocabulary value; it does not touch `applications`,
`mentor_profiles`, `person_season_memberships`, or any row of user data.

### Why a column and not a JSON payload

M070 gave `person_season_invites` a deliberately narrow, fully-constrained
shape. A `jsonb` column would be a place for the next three unreviewed fields to
land without a migration, which is exactly the erosion M070 was built to
prevent. One nullable `text` column with a binding constraint says what it holds
and refuses everything else.

### Why the old signature is dropped

Adding `p_decline_feedback text default null` as a *second* function leaves both
`(text)` and `(text, text)` resolvable. A one-argument call then fails as
ambiguous rather than choosing, and — worse — `(text)` stays a live trusted entry
point that silently discards feedback. `apply.sql` DROPs it, and both the apply
post-condition and the verifier assert that exactly one decline signature exists
and that it is `(text, text)`.

### Why the write is inside the claim UPDATE

M071 claims a declined invite with a single-winner UPDATE predicated on
`submitted_at is null`. M073 adds `decline_feedback = v_feedback` to **that
statement and no other**. The claim predicate therefore doubles as the
feedback's concurrency control:

* a replay matches zero rows, raises `[CLAIM_LOST]`, and writes nothing;
* feedback cannot be appended to an already-claimed invite;
* feedback cannot survive a decline that lost the race;
* there is no second statement to fail independently of the first.

### Normalisation

`nullif(btrim(coalesce(p_decline_feedback, '')), '')`, applied **inside the
function** as well as in the runtime, because the runtime is not the only thing
that can reach a trusted entry point. `''` and whitespace mean "nothing was
said" and are stored as `NULL`, so the column never holds both representations
of empty. Content is otherwise preserved exactly, including internal newlines.

**No length ceiling is imposed.** The repository sets no free-text limit
anywhere else, and inventing one here would silently truncate a mentor's parting
explanation. The column is `text`.

## 3. Files

| File | Purpose | Mutates? |
|---|---|---|
| `preflight.sql` | Proves the baseline before a lock is taken | **No** — opens a transaction and `ROLLBACK`s |
| `apply.sql` | The change, in ONE transaction | Yes |
| `verifier.sql` | Proves the outcome | **No** — `ROLLBACK`s; the one constraint-enforcement probe is undone in-transaction |
| `rollback.sql` | Restores the M071 baseline exactly | Yes |
| `state_evidence.sql` | Reports current state with **no assertions**, so it cannot abort early | **No** — `ROLLBACK`s |

Run order: `preflight` → *(owner authorization)* → `apply` → `verifier`.

## 4. What preflight proves

* environment is Staging (`vam062_*` lineage present — the marker M070/M071 use, inverted)
* M070 table + all six binding/format constraints present
* M071 present: 7 functions, every one a pinned-`search_path` `SECURITY DEFINER`
* **M072:** exactly one `vam063_trusted_api_role()`, zero arguments, result exposing `api_role` (§10)
* exactly **one** decline signature, and it is `(text)` by **catalog identity** (§8)
* its body is the reviewed predecessor (structural markers) and does **not** already mention `decline_feedback`
* it is not already reachable by `PUBLIC` / `anon` / `authenticated`
* `decline_feedback` column and constraint are **absent**
* zero `applications` rows with `status = 'declined_renewal'`
* every existing invite satisfies both M070 bindings

It then reports the BEFORE state, including the predecessor body's `md5` and the
full grant list, for the record.

> **On signature checking:** every gate identifies the function through
> `pg_proc` — `pronargs`, `proargtypes`, `pronargdefaults`, `proargnames` — never
> through a rendered string. See §8 for why.

> **On body pinning:** the predecessor is pinned on structural markers rather
> than a whole-body hash. A hash refuses on a line ending or a comment reflow and
> teaches the operator to bypass the check; the markers pin the behaviour that
> matters. The `md5` is *reported* so the owner has the exact value on file.

## 5. What the verifier proves

Column type/nullability/default · constraint exists **and actually rejects**
(probed under a savepoint, undone in-transaction) · exactly one decline
signature and it is `(text, text)` by **catalog identity** (§8) · the obsolete
`(text)` form is **gone, not shadowed** · the body sets `decline_feedback` in the claim UPDATE, normalises
input, contains exactly **one** UPDATE of the table, retains the single-winner
predicate, and writes nothing to `applications` · `SECURITY DEFINER` +
`search_path=public, pg_temp` + `VOLATILE` + **not `STRICT`** · no web role can
execute any `vam071_*` function · helpers unreachable by the principals M071
forbids (§9) ·
`service_role` can still execute the entry point · 7 `vam071_*` functions · all
seven invite constraints present · zero invariant violations · zero ghost rows ·
the M072 resolver is still present and the recreated body still routes through
it (§10).

`STRICT` is asserted because it would be a silent correctness bug, not a style
issue: a `NULL` `p_decline_feedback` would return `NULL` without declining
anything.

## 6. Rollback

Prepared and complete **before** apply. Restores the one-argument function
byte-for-byte from `supabase_migrations/071_renewal_trusted_runtime.sql`, its
grants, and drops the constraint and column.

It **refuses by default** if any `decline_feedback` has been collected, since
dropping the column destroys it and there is nowhere else it may live. The
header carries the capture query; the operator sets one guard variable to
consent.

Carries no environment guard, deliberately, matching M070/M071: a rollback must
stay runnable on whatever database is currently wrong.

**Rolling back the database requires rolling back the application deployment
too.** A runtime calling `(text, text)` against the restored `(text)` function
fails loudly at the RPC boundary — the right direction for the failure, but an
outage until the deploy is reverted.

## 7. Application changes shipped alongside

| File | Change |
|---|---|
| `lib/application-commitments.ts` | Adds `requiredCheckboxAcknowledgements`, `ACTIVE_READING_KEYS`, `CONFIRMATION_PHRASES`; the two existing validators now use them (behaviour-identical) |
| `lib/renewal-types.ts` | Adds `RENEWAL_MENTEE_CAPACITY_CHOICES` / `_DEFAULT` / `isRenewalMenteeCapacity` — client-safe, so form and server share one list |
| `lib/renewal-runtime.ts` | Adds `validateRenewalAcceptance` (fails closed before the RPC) and `normalizeOptionalFeedback`; derives commitments from canonical; **deletes** the `applications` INSERT; passes `p_decline_feedback` to the RPC; `formData` is now optional on the decline path |
| `lib/renewal-console.ts` | Selects `decline_feedback`; reads it from the invite; **deletes** the `applications` search |
| `app/renew/[token]/renewal-form.tsx` | Renders commitments and capacity from the canonical sources |
| `app/admin/renewals/page.tsx` | Unchanged — already matches the required display contract |

## 8. Signature checks use catalog identity, not rendered strings

The first Staging preflight refused a **correct** database:

```
M073 PREFLIGHT REFUSED [PREDECESSOR_SIGNATURE]: expected (text), found (p_token_hash text).
```

**Root cause.** `pg_get_function_identity_arguments()` renders parameter **names**
alongside types — `p_token_hash text`, not `text`. It is the argument list you
would paste into `DROP FUNCTION`, not a canonical type list. Comparing it to
`'text'` was a bug in M073's gate, not a baseline problem: nothing on Staging was
wrong.

**Fix.** Every gate now reads the catalog directly:

| Property | Source |
|---|---|
| argument count | `pg_proc.pronargs` |
| argument types | `pg_proc.proargtypes[n] = 'pg_catalog.text'::regtype::oid` |
| default count | `pg_proc.pronargdefaults` |
| parameter names | `pg_proc.proargnames[n]`, asserted **separately** |

No gate compares a rendered signature string anywhere in the package. Type
identity is compared by **OID**, so it is immune to formatting, spacing,
`character varying` vs `varchar` style differences, and search-path rendering.

Parameter names are asserted **separately from types** because they are a real
part of the contract — PostgREST resolves this RPC by *named* argument, so a
rename breaks the runtime while leaving type identity untouched — and because
splitting them makes a failure say which of the two moved.

`pg_get_function_identity_arguments()` still appears in the preflight and
verifier **evidence** output, explicitly labelled display-only, beside the
canonical identity and the parameter-name list.

DDL keeps using type identity, which is the correct form there and was never
fragile: `drop function public.vam071_submit_renewal_declined(text);`

## 9. The helper ACL contract — forbidden principals, not "anyone"

The first post-apply verifier run failed **read-only** with:

```
M073 VERIFY FAILED [ACL_HELPERS]: helpers are executable by
  vam071_accepted_renewal_exists -> postgres, vam071_renewal_identity_lock -> postgres.
```

**This was a verifier bug, not an ACL regression.** M073 did not touch either
helper's ACL — `apply.sql`'s only `REVOKE`/`GRANT` statements name
`public.vam071_submit_renewal_declined(text, text)` and nothing else.

**Why the assertion was wrong.** It flagged *any* principal holding EXECUTE. No
PostgreSQL database can satisfy that: `REVOKE ALL ... FROM public, anon,
authenticated, service_role` leaves `proacl` non-null with the **owner's own**
entry (`postgres=X/postgres`) intact, and `acldefault('f', proowner)` supplies
that same owner grant when `proacl` is NULL. Owner EXECUTE is a property of
**ownership**, not a grant M071 made or M073 could remove. The assertion
conflated privileged owner access with web reachability, and would have failed
identically on a pristine post-M071 database.

**M071 is the contract, and it is explicit:**

```sql
-- The helpers stay unreachable from every named role, service_role included.
from unnest(v_helper) f, unnest(array['anon','authenticated','service_role']::text[]) r
where has_function_privilege(r, f, 'execute');
```

Three forbidden named roles, plus PUBLIC checked separately via
`acl.grantee = 0`. `postgres`/owner is **not** among them.

| Principal | Helpers | Entry points |
|---|---|---|
| `PUBLIC` | must NOT execute | must NOT execute |
| `anon` | must NOT execute | must NOT execute |
| `authenticated` | must NOT execute | must NOT execute |
| `service_role` | must NOT execute | **must** execute |
| owner (`postgres`) | not constrained — implicit in ownership | not constrained |

The verifier now mirrors M071 exactly and detection is **not** weakened:
`anon`, `authenticated` and `service_role` are tested with
`has_function_privilege` (which also catches privileges inherited through role
membership, unlike a raw ACL listing), and PUBLIC is tested through
`aclexplode`. A new `[ACL_HELPERS_PUBLIC]` refusal covers the PUBLIC case
explicitly.

`preflight.sql` and `apply.sql` were audited for the same defect and **do not
have it** — every other ACL assertion in the package already filters to
`('PUBLIC', 'anon', 'authenticated')` or asserts a positive `service_role`
grant.

## 10. Relationship to M072

M072 lives in a separate worktree
(`C:am-renewal-staging-compat-r1VAM_OS_M072_S12_VAM063_TRUSTED_CONTEXT_STAGING_20260818`,
final candidate `85c0169341fc39df3677e18b7c20f650d79f2945`) and was applied once
and verified PASS on Staging. It is not modified, re-run, or referenced as an
executable by this package.

**M073 materially depends on exactly one M072 object: `public.vam063_trusted_api_role()`.**

M072 CREATED that resolver on Staging — before M072 it did not exist, and M071
refused with `[LIFECYCLE_MISSING]`. It is the **first statement** of the decline
function:

```sql
select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
if coalesce(v_api_role, '') <> 'service_role' then
  raise exception 'VAM071 trusted server context required' using errcode = '42501';
end if;
```

M073 **recreates** that function, which re-binds the call. PL/pgSQL validates a
body syntactically and does not resolve what it calls, so a missing or reshaped
resolver would let `apply.sql` succeed and leave every decline failing
afterwards, at runtime, for real mentors. That is why the assertion is worth
making rather than assuming.

### What is asserted — and what deliberately is not

| Asserted (preflight §1.4, apply §0, verifier §3b) | Why |
|---|---|
| exactly one `public.vam063_trusted_api_role` | an overload would make the call ambiguous |
| it takes zero arguments | the body calls it with none |
| its result exposes `api_role` | the body reads `r.api_role` |
| the recreated body still routes through it (verifier) | the indirection is the point of M072 |

**Not asserted, deliberately:**

* **Its security properties.** The resolver is `SECURITY INVOKER`, `STABLE`,
  `search_path = public` by M072's design. A definer-hardening assertion — the
  shape used for every `vam071_*` function — would **falsely refuse a correct
  database**. Those properties are M072's contract to keep, and M072's own
  verifier covers them.
* **The two bodies M072 replaced** (`vam063_transition_membership_atomic`,
  `vam063_add_membership_role`). The decline path calls **neither**. Pinning them
  here would be unrelated coupling that makes M073 refuse on changes that cannot
  affect it.
* **M072's seals, gates, or version.** M073 asserts the object it needs, not the
  migration that produced it.

`M073` is unoccupied: no `M073`, `vam073`, or `073_` reference exists in this
repository.
