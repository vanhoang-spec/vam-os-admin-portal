# VAM OS — M071 S12 Returning-Mentor Renewal Trusted Runtime Foundation

**Package status: AUTHORED, NOT EXECUTED. Nothing in this package has been run against Production, against Staging, or against any database. No SQL here has ever executed anywhere.**

| | |
|---|---|
| Date | 17 Aug 2026 |
| Workspace | `C:\vam-renewal-runtime-p0` |
| Branch | `feat/s12-renewal-runtime-p0` |
| Base | `b9171a174a650240d94b8e4aba1dead616ffa0c9` |
| Target | Production `vam-os-mvp` / `qkkroesfiazsejkzflcd`, after the S12 release T1–T4 and after M070 |
| Migration number | **071** — proven unclaimed, see §9 |

| File | Purpose | Writes? |
|---|---|---|
| `preflight.sql` | Read-only proof that the baseline this package was derived against is the baseline that is live | No |
| `apply.sql` | The seven functions, one transaction. Byte-identical to `supabase_migrations/071_renewal_trusted_runtime.sql` from the Section 1 marker onward | **Yes — once** |
| `verifier.sql` | Read-only proof of the post-apply state, and the `M071_VERIFIED` gate | No |
| `rollback.sql` | Drops the seven functions and nothing else | **Yes — emergency only** |
| `SHA256SUMS.txt` | Checksums for all five artifacts | No |

`__tests__/m071-renewal-trusted-runtime.test.ts` asserts the properties below that can be asserted without a database, including two that are genuinely executable rather than textual (§5.3).

---

## 1. The one thing to read first

`approveApplication` maps `applications.raw_payload` onto canonical `mentor_profiles` columns through `buildMentorProfileRefresh`, and that allowlist **emits `first_vam_season`**. P0-RT-8 requires the renewal confirmation to call `approveApplication`. Put those two facts together and the renewal path, as specified, would have written canonical profile columns straight from an unauthenticated bearer-token submission — including the one lineage field P0-RT-5 says must never be writable through a renewal — **without the admin's field-level diff being involved at all**.

That is a P0 defect in the specified design, not in any code that exists yet, and it is fixed structurally rather than by a rule someone has to remember: the accept RPC stores the mentor's submission **nested under `raw_payload -> 'renewal'`**. `buildMentorProfileRefresh` reads top-level keys, finds none it knows, and returns `{}`. `approveApplication` is therefore unchanged, is still called in the P0-RT-8 order, and contributes exactly nothing to the profile. The only canonical profile write in the whole renewal path is the one the admin confirmed field by field.

§5 has the full account. It is a **CRITICAL** finding and it carries a consequence for the UI package (§8.2).

---

## 2. The minimal trusted boundary

Task 1 asked whether each of the four candidate operations needs to be a trusted DB function, and told us not to create RPCs for symmetry. Here is the answer per operation, with the reason each one earned or failed to earn its place.

| Operation | Verdict | Why |
|---|---|---|
| **Create invite** | **RPC** | Not for symmetry. The accepted-renewal refusal (P0-RT-1), the one-live-invite refusal, the `token_hash` INSERT and the `create_renewal_invite` audit row are one decision. Split into sequential writes from Node, a partial failure leaves **a live bearer token with no audit record of who minted it for whom** — a credential nobody can account for, which is precisely the state an audit trail exists to make impossible. Task 4 names this case explicitly. |
| **Revoke invite** | **RPC** | Same audit-atomicity argument, plus targeting: the scope an admin must be authorized *for* is read out of the invite row, so the row has to be locked before the authorization question can even be asked. An app-level revoke would either trust a client-supplied scope or read it unlocked. |
| **Accept submission** | **RPC — mandatory** | P0-RT-3. No existing primitive comes close: `evaluateRenewalInviteGate` is pure by design and documented as not a claim. Two writes (applications INSERT, invite claim) must be one transaction with an exact single-row claim. |
| **Decline** | **RPC — mandatory** | P0-RT-2 requires the accepted-renewal refusal to hold *against a concurrent accept*, which means it must be evaluated under the same lock as the write it guards. A decline is also a submit: same slot, same single-winner claim. |
| **Admin confirm** | **RPC for the profile write; orchestration stays in the server** | Split deliberately. The profile write, its drift refusal and its `confirm_renewal` audit row are one transaction (P0-RT-4, P0-RT-6). `vam063_add_membership_role` and `approveApplication` stay where they are, called by a server-side orchestrator, because P0-RT-8 already establishes that sequence as retry-safe and because pulling `approveApplication` into SQL would mean redesigning it — which the brief forbids and which nothing here requires. |

### 2.1 What was considered and rejected

- **A `submit_renewal` / `decline_renewal` audit action_type.** Refused, and M070 already refused it for the same reason: the actor is an unauthenticated token holder, and an `admin_audit_log` row with a NULL admin actor both pollutes the admin trail and opens an anonymous write path into it. The durable record is stronger without it — the invite's own `submitted_at` / `outcome` / `application_id`, plus the applications row.
- **A `regenerate_renewal_invite` RPC or action_type.** Refused. Regeneration *is* revoke-then-create. It emits two audit rows that truthfully describe two things that happened, rather than one synonym that makes the same event queryable two incompatible ways. `vam071_create_renewal_invite` therefore has no `p_allow_regenerate` parameter; it refuses while a live invite exists and names the fix.
- **A column-immutability trigger on `person_season_invites`.** Would make replay-cannot-overwrite structural rather than predicate-dependent — but it is a change to M070's table, which is closed. Recorded as a deferred LOW (§10), exactly as M070 recorded it.
- **Recomputing the diff in SQL** (P0-RT-4 option a in its pure form). Rejected: it would require the renewal allowlist to exist a second time, in SQL, and M070 §6.2 already rejected a second allowlist because two allowlists drift and the copy nobody updates is the one that silently widens. §6 explains what was built instead.

---

## 3. The seven functions

Five entry points, granted to `service_role` and nothing else. Two internal helpers, granted to **nobody** — they are reached only from inside the definer functions above them, and a `SECURITY DEFINER` function needs no `EXECUTE` privilege on what it calls internally.

```
vam071_renewal_identity_lock(person, season, role)              helper, no grant
vam071_accepted_renewal_exists(person, season, role) → boolean  helper, no grant

vam071_create_renewal_invite(actor, person, program, season, role, token_hash, expires_at)
    → (outcome_status, invite_id, expires_at)

vam071_revoke_renewal_invite(actor, invite_id, reason)
    → (outcome_status, invite_id, revoked_at)

vam071_submit_renewal_accepted(token_hash, raw_payload, consent_data_storage)
    → (outcome_status, invite_id, application_id, person_id, season_id)

vam071_submit_renewal_declined(token_hash)
    → (outcome_status, invite_id, membership_outcome, membership_id)

vam071_confirm_renewal_profile(actor, application_id, expected_profile, profile_update, diff)
    → (outcome_status, invite_id, person_id, mentor_profile_id, applied_fields, skipped_fields)
```

### 3.1 The identity lock, and why it is the load-bearing piece

Three paths — create, accept, decline — each ask "has this person already renewed for this season and role?" and then act on the answer. A `FOR UPDATE` lock on an invite row serialises two callers holding the **same** token. It does nothing about an accept on invite A committing while a decline on invite B *for the same mentor* is still deciding. That is exactly the P0-RT-2 scenario: a stale post-acceptance invite whose NO click must never undo a confirmed Season 12 renewal.

`vam071_renewal_identity_lock` is a transaction-scoped advisory lock keyed on `person_id | season_id | role` — the exact tuple the question is asked about. All three paths take it **before** evaluating `vam071_accepted_renewal_exists`, which is what turns that predicate from advisory into authoritative. The test asserts the ordering, not merely the presence of both.

The key prefix is `VAM071_RENEWAL|`, deliberately different from `vam063_add_membership_role`'s `VAM063_ROLE|`. They are different questions and must not block each other.

### 3.2 Where the token is hashed, and why there

**In application code, in Node, by `lib/renewal-invite-token.ts`.** No function in this package accepts a raw token; the parameter is `p_token_hash` and it is pinned to `^[0-9a-f]{64}$` before it is used.

The alternative — passing the raw 43-character token and hashing it with `sha256()` inside PostgreSQL — was rejected. A raw token crossing the SQL boundary can land in `pg_stat_statements`, in a `log_min_duration_statement` line, and in a PostgREST request body that a proxy retains. M070 already asserts by test that the raw token never reaches the query layer, and this package keeps that true. The digest is not a credential outside this database anyway: holding it lets nobody call these functions, because every one of them is `service_role`-only.

No audit row records the digest either. The invite table already holds it; an audit row is a far more widely readable object, and copying a live lookup key into one buys nothing.

---

## 4. P0-RT closure

| ID | Where it is closed | How |
|---|---|---|
| **P0-RT-1** | `vam071_create_renewal_invite` | Refuses **before token issuance** — the refusal is evaluated after the identity lock and before the INSERT, so no token exists when it fires. Named error (`23505`, "an accepted renewal already exists…"), not a generic failure, as the requirement demands. |
| **P0-RT-2** | `vam071_submit_renewal_declined` | The accepted-renewal check runs under the identity lock, **before** the invite claim and **before** any membership call — asserted by test on source position, not just presence. Both halves refuse together because the function refuses before either is attempted. |
| **P0-RT-3** | `vam071_submit_renewal_accepted` | All seven required steps: resolve by `token_hash`, `FOR UPDATE`, re-apply the complete gate predicate in-transaction, require `submitted_at IS NULL`, derive every identity column from the locked invite, INSERT with `person_id` known at INSERT, claim with `and submitted_at is null`, `GET DIAGNOSTICS … <> 1` → `raise`. The loser's INSERT rolls back with its raise. Replay cannot overwrite because no later UPDATE can match. |
| **P0-RT-4** | `vam071_confirm_renewal_profile` | Option **(b)**, in its strong form: the expected before-value is carried **per field**, the profile is re-read `FOR UPDATE`, and any field that matches neither the shown before nor the confirmed after raises `40001` naming the field that moved. The write set is then recomputed from the fresh read, so an empty fresh diff writes no column. The audit row records the **fresh** before-state actually overwritten. |
| **P0-RT-5** | Two independent mechanisms | (a) the `raw_payload` nesting makes `buildMentorProfileRefresh` emit nothing over a renewal application — §5; (b) `first_vam_season` and `prior_vam_involvement` are refused **by name** in the confirm RPC, so widening the column ceiling later cannot open them. `buildMentorProfileRefresh` is unmodified. |
| **P0-RT-6** | `vam071_confirm_renewal_profile` | No canonical column is writable except through this function, and it writes only fields whose before-value the caller carried and whose after-value it confirmed. The `confirm_renewal` audit row carries the diff the admin was shown **and** the fields actually applied. |
| **P0-RT-7** | `vam071_confirm_renewal_profile` + orchestration | The RPC resolves the actor from `admin_users` and applies `vam063_authorized_for_scope` to **that** admin; a test asserts the confirm body never references `v_inv.created_by`. The orchestrator passes the same current admin to `vam063_add_membership_role`. |
| **P0-RT-8** | Orchestration, §7 | `vam063_add_membership_role` → `approveApplication` → done, in that order, membership logic never inside `approveApplication`, retry always safe. One refinement, stated openly: `vam071_confirm_renewal_profile` (which P0-RT-8 does not name) runs **first**, so a drift refusal costs nothing. See §7.2. |

---

## 5. The `approveApplication` collision, in full

### 5.1 What would have happened

`approveApplication` does this, unconditionally, for every application it approves:

```ts
const mentorProfileRefresh = buildMentorProfileRefresh(applicationSource.raw_payload);
// … existing profile → .update(mentorProfileRefresh)
```

`buildMentorProfileRefresh` reads top-level keys of `raw_payload` and emits `company_current`, `title_current`, `function_area`, `industry`, `years_experience_text`, `years_experience_min`, `capacity_target` **and `first_vam_season`**.

Had the accept RPC stored the mentor's answers at the top level of `raw_payload` — the obvious shape, and the shape `submitPilotApplication` uses for ordinary intake — then the P0-RT-8-mandated `approveApplication` call would have:

- written every one of those columns from an unauthenticated bearer-token submission;
- written them **regardless of the admin's field-level diff**, including fields the admin was shown as unchanged and fields they were never shown at all;
- written `first_vam_season`, erasing the very fact that makes a returning mentor a returning mentor — the exact defect P0-RT-5 and `lib/renewal-profile-safety.ts` exist to prevent.

The renewal path would have satisfied every requirement in the brief and still bypassed its own human gate, because the bypass lives in a function the brief correctly says not to modify.

### 5.2 The fix

`vam071_submit_renewal_accepted` writes:

```json
{
  "source": "s12_mentor_renewal",
  "renewal_invite_id": "…",
  "renewal_submitted_at": "…",
  "renewal": { … the mentor's answers, verbatim … }
}
```

Four top-level keys, none of which the approval allowlist knows. `buildMentorProfileRefresh` over this envelope returns `{}`, so `approveApplication` — unmodified, still called, still in the P0-RT-8 order — updates no profile column. The submission is preserved verbatim and in full under `renewal`; nothing is dropped to achieve this.

### 5.3 How the fix is held in place

Two of the tests in `__tests__/m071-renewal-trusted-runtime.test.ts` are executable rather than textual:

- one builds the exact envelope the RPC writes, runs the **real** `buildMentorProfileRefresh` over it, and asserts the result is `{}` — then runs the same allowlist over the *un-nested* payload and asserts it emits `first_vam_season`, so the reason the nesting exists cannot be forgotten;
- one runs the real `buildRenewalProfileRefresh` over a payload exercising every field the approval allowlist knows, and asserts its key set is **exactly** the seven-column ceiling declared in the confirm RPC — so a field added to the TypeScript allowlist without being added to the SQL ceiling is a failing test rather than a silent runtime refusal.

The SQL ceiling is a **ceiling, not a second allowlist**. `lib/renewal-profile-safety.ts` remains the source of truth. A field the TypeScript layer narrows away is simply never sent; a field it grows to emit that is not in the ceiling is refused loudly. The only direction the two can disagree in silence is the safe one.

---

## 6. The confirm RPC in detail

```
p_expected_profile   { field → the value the admin was SHOWN as current }   for EVERY candidate field
p_profile_update     { field → the confirmed after-value }                  = renewalProfileUpdateFromDiff(diff)
p_diff               the diff array the admin was shown                     recorded, not acted on
```

1. Trusted context, active admin, `vam063_authorized_for_scope` for the invite's program+season.
2. The invite is resolved **from the application** and locked; exactly one must exist; it must be `accepted`, submitted and mentor.
3. The application is locked and its `person_id` / `season_id` / `source` must match the invite **exactly**.
4. Shape checks: `p_profile_update`'s keys ⊆ `p_expected_profile`'s keys; every key inside the ceiling; neither lineage field present in either; the two integer fields must be non-negative integers (a named refusal, not a mid-UPDATE `22P02`).
5. `mentor_profiles` is locked. There must be **exactly one** row for this person — `mentor_profiles.person_id` carries no unique constraint in the Production baseline, so "the profile for this person" is a claim that has to be proven, not assumed. Zero or two is a named refusal.
6. **Drift refusal**, per field: current must equal the shown before, *or* equal the confirmed after (already applied by this same confirmation — see below). Anything else raises `40001` naming the fields that moved.
7. The write set is recomputed from the fresh read. Fields already carrying the confirmed value are reported as `skipped` and not rewritten, so `updated_at` never claims a change that did not happen. An empty write set skips the UPDATE entirely.
8. The `confirm_renewal` audit row is written **in the same transaction**, with `before_data` = the fresh state actually overwritten and `details.confirmed_diff` = what the admin was shown.

### 6.1 Why the drift check accepts two values

The orchestration is retry-safe by design (P0-RT-8), so this function must be re-callable after a downstream step failed. If it accepted only the shown before-value, the *second* call would see its own first call's writes and refuse as drift — a retry-safe design whose retry is structurally impossible. A field already carrying the confirmed after-value is therefore treated as already applied by this same confirmation. A field matching neither has genuinely moved, and the confirmation is refused.

### 6.2 The gap this design does not close, stated rather than hidden

The RPC can only enforce the subset relation it can see. It cannot know the full candidate field set, because that is derived in TypeScript. If the UI sends `p_expected_profile` containing **only** the changed fields rather than every candidate field, then a field that was equal at display time and drifted afterwards would not be checked — the renewal's value for it simply would not land, silently.

That is the safe direction (nothing unshown is written), but it is silent, so it is a **requirement on the UI package** and it is stated as one in §8.1. The RPC refuses anything it *can* refuse; this is the part it cannot see.

---

## 7. The confirm orchestration

### 7.1 The sequence

```
1. resolve the authenticated current Admin server-side
2. load the renewal application + its invite + a FRESH mentor_profiles read
3. candidate = buildRenewalProfileRefresh(application.raw_payload.renewal)      ← note the nesting
   diff      = buildRenewalProfileDiff(freshProfile, candidate)
4. the admin is shown the field-level diff and confirms THAT diff
5. vam071_confirm_renewal_profile(actor, applicationId, expected, update, diff)
6. vam063_add_membership_role(actor = the CURRENT confirming admin, …)          Case A → noop, Case B → created
7. approveApplication(…)                                                        unchanged; writes no profile column
```

### 7.2 One refinement of P0-RT-8's ordering, stated openly

P0-RT-8 fixes the order `vam063_add_membership_role` → `approveApplication` → `confirm_renewal` audit. Steps 6 and 7 above preserve that exactly. What moves is the **audit row**, which is now written inside step 5 rather than after step 7, and with it the profile write.

Two reasons, both concrete:

- **The audit becomes atomic with the mutation it attests.** Written after step 7, a crash between the profile write and the audit INSERT leaves a canonical column changed with no record of who authorised it or what they were shown. Inside step 5, an unaudited canonical renewal write is not representable — the audit INSERT failing rolls the UPDATE back with it. P0-RT-6 asks for durable evidence of the confirmation; this is the strongest available form of it.
- **A drift refusal costs nothing.** Drift is the only condition that can refuse at this stage, and it is a legitimate, expected outcome (a colleague edited the profile). Running the profile confirmation first means a drift refusal happens before a membership row is created, rather than after.

Both remaining failure modes stay retry-safe. If step 5 commits and step 6 or 7 fails, retry: step 5 returns `noop` (§6.1), step 6 returns `noop` (its advisory lock plus the live `UNIQUE(person_id, season_id, role)`), step 7 is attempted again. There is no compensating delete and no membership row is ever removed to undo a failed approval.

**This is a deviation from the literal text of P0-RT-8 and is flagged for the independent reviewer to rule on** — §10, INFO-1. If the reviewer prefers the literal ordering, moving step 5 to sit between steps 6 and 7 requires no change to any function.

### 7.3 Who can actually do this today

`vam063_authorized_for_scope` matches `admin_scope_access.program_id` / `season_id` against **UUIDs**. Live Production stores **codes** in those columns, so on today's data that branch matches nothing and **the only route through is an active `super_admin`**. That is the accepted state recorded by the S12 release (Decision A) and the thing WP1-A2 converts — and WP1-A2 is authored, not executed.

Consequence, and it is operational rather than a defect: **create, revoke and confirm are super_admin-only until WP1-A2 lands.** The preflight's BLOCK 2 emits the count of admins who would pass, so this is read rather than discovered. A zero there is not a reason to refuse the apply, but it is very much a reason not to announce the feature.

---

## 8. What the runtime/UI package must do

Out of scope for this package; binding on the next one. These are stated here because the DB cannot enforce them and because the foundation is what a reviewer reads first.

### 8.1 Requirements

- **P0-RT-9 (new).** `p_expected_profile` must carry an entry for **every field in the candidate**, not only the changed ones. Sending only the diff's fields leaves a silent gap — §6.2.
- **The candidate reads `raw_payload.renewal`**, not `raw_payload`. `buildRenewalProfileRefresh(application.raw_payload.renewal)`. Reading the top level would produce an empty candidate and an empty diff, and the renewal would confirm nothing while appearing to succeed.
- **Every RPC failure renders `RENEWAL_GATE_FAILURE_MESSAGE`.** The submit RPCs already return one uniform message and one SQLSTATE, but the runtime must not widen that by surfacing PostgREST's `code`, `hint` or `details` on the `/renew` route.
- **`membership_outcome` from the decline RPC must be surfaced.** `deferred_actor_unauthorized` means the decline is recorded and the S12 membership is still active. The admin console needs a list of declined renewals whose membership was not opted out, or that state is invisible.
- **The applications detail page renders `raw_payload` entries.** For a renewal row the interesting content is one level down, under `renewal`. Without a change there it will render as a single opaque object.
- **Rate limiting on `/renew`** for denial of service. 256 bits of entropy makes brute force irrelevant; that is not the reason the limit belongs there.

### 8.2 Out of scope here, and deliberately not built

`/renew/[token]`, the renewal form UI, `/admin/renewals`, the browser workflow, email delivery, batch invites, mentee renewal, new-mentor-application integration, Season-first UX. None of it exists in this package. Every entry point refuses a role other than `mentor`, so **mentee renewal** cannot be reached even by a caller that wants it.

---

## 9. Migration number, and execution

**071 is unclaimed.** `supabase_migrations/` runs `…069_application_form_controls.sql`, `070_person_season_invites.sql`, and nothing else. A repository-wide scan for `071` returns only Season 11 seed-batch row identifiers in `docs/data_audit/`, none of which is a migration. This was verified before the number was taken, as Task 7 requires.

### The execution sequence — none of which has been performed

```
independent security review of this package
        ↓
Production READ-ONLY preflight.sql        ← the next execution gate
        ↓
(only if every check passes)  apply.sql
        ↓
verifier.sql — every check PASS and M071_VERIFIED = PASS
        ↓
(only then)  Codex begins the runtime/UI package
```

Run each file as its own Supabase SQL Editor run. `preflight.sql` is two separate runs (BLOCK 1, then BLOCK 2) — the editor surfaces only the last row-returning statement, and `set transaction read only` must be the first thing in its transaction.

### Supabase SQL Editor compatibility, and the four M070 defects

Every owner-executable file is plain PostgreSQL with **zero psql meta-commands**; a test fails the build if a backslash-leading line ever appears. The four defects M070's three failed executions taught are each avoided by construction, and each has a test:

| M070 defect | How this package avoids it |
|---|---|
| `array \|\| untyped literal` was ambiguous | Every array concatenation is `array_append()` or carries an explicit `::text[]` cast on the literal operand |
| catalog `"char"` values concatenated into text | `relname`, `proname`, `conname`, `attidentity`, `attgenerated`, `relkind`, `confdeltype` are cast `::text` at every use |
| owner SQL that was not ordinary SQL | No meta-command, no client-side construct, anywhere |
| verifier diagnostics not type-stable on PG15 | Every branch of every `CASE` returns `text`; every diagnostic is wrapped in `coalesce(…, '<absent>')` |

A fifth defect class, specific to this package, is avoided the same way: `vam071_revoke_renewal_invite`'s OUT parameter is named `revoked_at`, so its `UPDATE … WHERE` aliases the table and qualifies every column reference. An unqualified `revoked_at is null` there resolves to the PL/pgSQL variable and raises `42702` at runtime rather than at install time — a defect that would only surface on the first real revocation.

---

## 10. Findings

### CRITICAL

**C1 — `approveApplication` would have written canonical profile columns, including `first_vam_season`, from an unauthenticated renewal submission, bypassing the admin diff entirely.** A defect in the specified design, discovered while resolving Task 5. Resolved structurally by the `raw_payload` nesting (§5), with two executable tests holding it in place. Requires no change to `approveApplication` and no change to `buildMentorProfileRefresh`.

### HIGH

**H1 — Gate-then-write for the accepted-renewal refusal is insufficient even inside one transaction, if the transaction only locks the invite row.** P0-RT-2's scenario involves *two different invite rows* for the same mentor. Resolved by `vam071_renewal_identity_lock`, taken before the predicate is evaluated, in all three deciding paths (§3.1).

**H2 — `mentor_profiles.person_id` carries no unique constraint in the Production baseline.** `select … where person_id = $ for update` is therefore not provably a single row, and a two-row anomaly would have had the confirm RPC lock and rewrite an arbitrary one. Resolved by requiring exactly one row and refusing by name otherwise (§6, step 5). Adding the missing unique constraint is a schema change to a table this package does not own; recorded as D2 below.

### MEDIUM

**M1 — A self-service decline has no admin actor, but `vam063_opt_out_membership` requires one.** Resolved by attributing to the invite's `created_by` — the only admin who has actually made a decision about this specific renewal — with the mentor-initiated origin stated in the membership log reason. If that admin is no longer active or scope-authorized, the opt-out is **deferred**, not forced: the decline is recorded, the membership is left untouched, and `membership_outcome = 'deferred_actor_unauthorized'` is returned. Leaving a membership active is the safe direction; refusing the whole decline would leave the invite live and tell the mentor their link is broken. **The UI must surface this** (§8.1) or the state is invisible.

**M2 — Create, revoke and confirm are `super_admin`-only on today's Production data.** Not a defect in this package; a consequence of `admin_scope_access` storing codes where `vam063_authorized_for_scope` compares UUIDs. Reported by the preflight rather than assumed (§7.3). WP1-A2 is the fix and it is authored, not executed.

### LOW

**L1 — `applications.submitted_at` has two live shapes across the repository** (`date` in the staging bootstrap, `timestamptz not null default now()` in the Production baseline reproduction). The accept RPC writes `current_date`, which is a valid assignment cast into either. The preflight pins the column's presence but deliberately not its type, because both are writable.

**L2 — The 60-day maximum invite lifetime is a ceiling this package chose,** not a policy the brief specified. It refuses only unbounded expiries; the caller still chooses. Changing it is a one-line change to `vam071_create_renewal_invite` and a re-verify.

**L3 — `applications.intake_batch_id` is left NULL for renewals,** because a renewal is not part of an intake batch and creating one would be schema/seed work outside this package. `applications` has no `program_id` column at all; the program binding lives on the invite and on the membership, which is where every downstream consumer already reads it.

### INFO

**INFO-1 — The `confirm_renewal` audit row is written inside the profile-write transaction rather than after `approveApplication`,** a refinement of P0-RT-8's literal ordering. Reasoned in §7.2, flagged here for the reviewer to rule on. Reverting to the literal order requires no change to any function.

**INFO-2 — The verifier pins body properties by anchored regex and emits body seals as *evidence*, not as assertions against a literal.** No database was contacted while authoring this package, so a hard-coded expected hash would be a guess whose first FAIL would be indistinguishable from a real defect. The verifier's own header says so rather than implying more proof than it has.

### Deferred (recorded, not fixed here)

| | |
|---|---|
| **D1** | A column-immutability trigger on `person_season_invites.submitted_at` / `outcome` / `application_id` would make replay-cannot-overwrite structural rather than predicate-dependent. It is a change to M070's closed table. M070 recorded the same deferral. |
| **D2** | `mentor_profiles.person_id` has no unique constraint. Adding one is the right fix for H2 but is a schema change to a table this package does not own, and it would fail on any pre-existing duplicate. Belongs in its own ticket with its own data audit. |
| **D3** | `public.set_updated_at()` has no pinned `search_path`. Unchanged from M070's D5: pre-existing shared infrastructure with 17 Production triggers, and a blast radius far wider than this package. |
| **D4** | `rollback.sql` carries no `[ENV_NOT_PRODUCTION]` guard, matching M070's D7 and for the same reason: a rollback that refuses to run on the environment it is needed on is worse than one that runs. Its protection is state-based — `DROP … IF EXISTS` over an exact seven-name inventory. |

---

## 11. What has and has not been validated

**Validated:** every property in `__tests__/m071-renewal-trusted-runtime.test.ts`, which includes the two executable cross-checks against the real TypeScript allowlists (§5.3), the byte-identity of `apply.sql` and the canonical migration, and the absence of every defect class M070's failures taught.

**Not validated:** anything that requires a database. No SQL in this package has been executed anywhere. The column contracts, the audit INSERT contract, the `role_applied` type, the lifecycle surface and the `admin_scope_access` representation are all **asserted by the preflight against the live catalog** rather than assumed — which is why the preflight is the next execution gate and why it refuses rather than adapts. Its first-ever execution against any database will be that Production read-only run.

That is the honest state of this package, and the reason `SAFE_TO_BEGIN_CODEX_UI_IMPLEMENTATION` is **NO**.
