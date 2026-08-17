# VAM OS — M071 S12 Returning-Mentor Renewal Trusted Runtime Foundation

**Package status: AUTHORED, NOT EXECUTED. Nothing in this package has been run against Production, against Staging, or against any database. No SQL here has ever executed anywhere.**

| | |
|---|---|
| Date | 17 Aug 2026 |
| Workspace | `C:\vam-renewal-runtime-p0` |
| Branch | `feat/s12-renewal-runtime-p0` |
| Base | `b9171a174a650240d94b8e4aba1dead616ffa0c9` |
| Revision | Remediated 17 Aug 2026 after independent security review — H-1 (§7.3), M-2 (L1), M-1 (P0-RT-10), M-3 (P0-RT-11). The review's verdict was `M071_STATIC_SECURITY = PASS` with remediation required; no gate was weakened by any change below |
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
| **P0-RT-8** | Orchestration, §7 | membership lifecycle → `approveApplication` → done, in that order, membership logic never inside `approveApplication`, retry always safe. One refinement, **ruled on and accepted by the independent review**: `vam071_confirm_renewal_profile` (which P0-RT-8 does not name) runs **first**, so a drift refusal costs nothing and the confirm audit is atomic with the mutation it attests. See §7.2. |

Three further requirement ids are **normative on the runtime/UI package and closed by nothing in this one**. They are stated in full in §8.1, and the tests pin their specifications so the wording cannot quietly soften:

| | Owner | What it requires |
|---|---|---|
| **P0-RT-9** | runtime | `p_expected_profile` carries every candidate field, not only the changed ones (§6.2) |
| **P0-RT-10** | runtime | the full membership status→action mapping at step 6, restoring `opted_out` through `vam063_reactivate_membership` and failing closed on every state that has no legitimate existing transition |
| **P0-RT-11** | runtime | a **server-side** refusal in `approveApplication` for any renewal-source or invite-bound application with no `confirm_renewal` audit evidence |

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
6. the membership lifecycle action selected by P0-RT-10 (§8.1)                  exactly one, chosen by current status
7. approveApplication(…)                                                        unchanged; writes no profile column,
                                                                                and refuses without step 5's evidence (P0-RT-11)
```

Step 6 was `vam063_add_membership_role` alone in the first cut of this package. That is correct only for the two cases it was written for — no membership, or an already-active one — and **wrong for the reachable case where the mentor previously declined**, because `vam063_add_membership_role` finds the existing row and returns `noop` while the membership stays `opted_out`. P0-RT-10 replaces it with the full status→action mapping and is normative on the runtime package.

### 7.2 One refinement of P0-RT-8's ordering, stated openly

P0-RT-8 fixes the order `vam063_add_membership_role` → `approveApplication` → `confirm_renewal` audit. Steps 6 and 7 above preserve that exactly. What moves is the **audit row**, which is now written inside step 5 rather than after step 7, and with it the profile write.

Two reasons, both concrete:

- **The audit becomes atomic with the mutation it attests.** Written after step 7, a crash between the profile write and the audit INSERT leaves a canonical column changed with no record of who authorised it or what they were shown. Inside step 5, an unaudited canonical renewal write is not representable — the audit INSERT failing rolls the UPDATE back with it. P0-RT-6 asks for durable evidence of the confirmation; this is the strongest available form of it.
- **A drift refusal costs nothing.** Drift is the only condition that can refuse at this stage, and it is a legitimate, expected outcome (a colleague edited the profile). Running the profile confirmation first means a drift refusal happens before a membership row is created, rather than after.

Both remaining failure modes stay retry-safe. If step 5 commits and step 6 or 7 fails, retry: step 5 returns `noop` (§6.1), step 6 is idempotent in every branch P0-RT-10 allows (`add_membership_role` returns `noop` behind its advisory lock plus the live `UNIQUE(person_id, season_id, role)`; `reactivate_membership` returns `noop` once the membership is already `active`), step 7 is attempted again. There is no compensating delete and no membership row is ever removed to undo a failed approval.

**The independent review accepted this ordering.** `vam071_confirm_renewal_profile` → membership lifecycle operation → `approveApplication` is the normative runtime contract, and it is not reverted to match P0-RT-8's earlier prose. INFO-1 below records the deviation; it is now a ruled-on decision rather than an open question.

### 7.3 Who can actually do this today, and how that is established

`vam063_authorized_for_scope` admits an active `super_admin` by role, or an active `admin_scope_access` row matching the **UUID** of the program and of the season. Whether a given admin passes it therefore depends entirely on what `admin_scope_access` currently holds.

**The project release record says WP1-A2 — the canonical staff scope convergence that rewrites those columns from names and codes to UUIDs — was applied to Production, verified PASS, and closed.** This package asserts nothing further about that. A release record is a statement about the past, and the authorization state that governs a renewal is the one the database is in at apply time.

So the preflight **measures it** instead of narrating it. BLOCK 2 reports five fields — `active_super_admins`, `admins_scoped_for_s12`, `scope_rows_uuid_program`, `scope_rows_nonuuid_program`, `uehm_s12_season_rows` — and the owner reads them before apply. On a Production where WP1-A2 is in place, expect:

| Evidence | Expected reading | What it means |
|---|---|---|
| `admins_scoped_for_s12` > `active_super_admins` | scoped Admins pass on their own grants | authorization is no longer role-only |
| `scope_rows_nonuuid_program` = `0` | no active grant still holds a name or a code | the conversion covered the live set |
| `uehm_s12_season_rows` = `1` | the S12 scope resolves exactly once | the count above is answering the right question |

These are **evidence outputs, not repository facts and not gates.** Nothing in BLOCK 2 can refuse the apply: the renewal runtime is correct whoever can reach it, and a narrow authorization surface is a reason not to announce the feature rather than a reason to refuse the install. A reading that contradicts the table means the release record and the database disagree, which is resolved before renewal invites are generated — never by editing the preflight to match.

A zero in `admins_scoped_for_s12` would mean nobody can create, revoke or confirm a renewal at all. Still not a refusal; still very much a reason not to announce the feature.

---

## 8. What the runtime/UI package must do

Out of scope for this package; binding on the next one. These are stated here because the DB cannot enforce them and because the foundation is what a reviewer reads first.

### 8.1 Requirements

- **P0-RT-9 (new).** `p_expected_profile` must carry an entry for **every field in the candidate**, not only the changed ones. Sending only the diff's fields leaves a silent gap — §6.2.

#### P0-RT-10 (new, **blocking**) — membership restoration on an accepted renewal

**The defect this closes is reachable, not theoretical.** A mentor declines; `vam071_submit_renewal_declined` opts the S12 membership out through `vam063_opt_out_membership`. An admin then legitimately revokes-and-reissues, or issues a fresh invite for a corrected address; the mentor accepts. Step 6 of §7.1, as first written, called `vam063_add_membership_role`, which finds the existing `(person, season, role)` row behind its advisory lock and returns `'noop'`. **The mentor is renewed, the application is approved, and the membership is still `opted_out`.**

The fix invents nothing. No new lifecycle status, no second membership row, no new RPC: the existing `vam063` surface already carries every transition this needs, which is why this is a runtime requirement and not more SQL in this package. `apply.sql` Section 0 and `preflight.sql` prove `vam063_reactivate_membership(uuid,uuid,text)` exists, is a hardened definer and is executable by `service_role`; `verifier.sql` V28 re-proves it after apply.

Step 6 resolves the membership for **exactly** `(person_id, season_id, role = 'mentor')` taken from the invite — never from the client — and then performs **exactly one** of:

| Current membership | Required action | Result |
|---|---|---|
| none | `vam063_add_membership_role(actor, person_id, program_id, season_id, 'mentor', reason)` | `created` → proceed to step 7 |
| `active` | `vam063_add_membership_role(…)` → `noop`, or no call at all | proceed to step 7 |
| `opted_out` | `vam063_reactivate_membership(actor, membership_id, reason)` | `transitioned` → `active`, proceed to step 7 |
| `paused` | **none — refuse** | stop before step 7 |
| `invited` | **none — refuse** | stop before step 7 |
| `withdrawn`, `cancelled` | **none — refuse** | stop before step 7 |
| `completed`, `graduated`, anything else | **none — refuse** | stop before step 7 |

`actor` is the **current confirming Admin** in every branch — the same admin `vam071_confirm_renewal_profile` already resolved and scope-checked in step 5, never the invite's `created_by`. Both `vam063` entry points re-check that admin's scope themselves.

Three points about the refusals, because the mapping is deliberately narrower than what `vam063` would accept:

- `vam063_reactivate_membership`'s allowed-from set is `paused, withdrawn, opted_out, cancelled`. It **would** accept `paused`, `withdrawn` and `cancelled`. The renewal orchestration must not use it for them. A pause is an operational hold and a withdrawal or cancellation is a deliberate administrative decision, each taken for a reason the renewal knows nothing about; silently reversing one because a mentor clicked YES is precisely the "forcing activation" this fails closed against. Reversing them stays what it already is — an explicit, reasoned admin action in the membership console.
- `invited` has **no** legitimate transition to `active` anywhere in the `vam063` surface (`reactivate`'s allowed-from does not include it). There is therefore no existing lifecycle action to take, and P0 does not add one.
- **Refusal is fail-closed, not a rollback.** Step 5 has already committed; it is not undone, and nothing compensating is written. The orchestration stops before `approveApplication`, the application stays `submitted`, and the admin is shown the membership's actual status and told to resolve it through the membership console. The whole confirmation is then simply re-run: step 5 returns `noop` (§6.1), step 6 now takes the `active` branch, step 7 proceeds. Every branch above is idempotent, so retry is always safe.

#### P0-RT-11 (new, **blocking**) — the renewal direct-approval guard

**A renewal application is an ordinary `applications` row** — `source = 's12_mentor_renewal'`, `status = 'submitted'` — which means the pre-existing admin approval path can approve it directly, without `vam071_confirm_renewal_profile` ever running. That is unacceptable for live P0 on three counts: the admin's field-level diff is bypassed, no `confirm_renewal` audit row is written for a canonical renewal, and the mentor's profile stays stale while the application reads `approved_as_mentor`.

**This must be a server-side refusal, not a UI hiding rule.** Hiding the legacy approve button leaves the server action, the old route and any future caller open. The guard belongs in `approveApplication` in `lib/application-approvals.ts` — the single function every approval path already funnels through — and it must fire **before any write**, above the person resolution.

*Trigger.* The guard applies when **either** holds, evaluated as a union rather than a single key:

1. `applications.source = 's12_mentor_renewal'`; **or**
2. a `public.person_season_invites` row has `application_id = applications.id`.

`source` alone would be a guard on a column that a future admin edit surface could make writable; the invite binding alone would miss a renewal row whose invite was somehow unbound. Either one triggering is the safe direction.

*Evidence.* The smallest durable proof of confirmation that the current schema already makes unambiguous is the `confirm_renewal` audit row `vam071_confirm_renewal_profile` writes in the same transaction as the profile mutation (§6, step 8):

```sql
select 1
  from public.admin_audit_log
 where action_type = 'confirm_renewal'
   and details ->> 'application_id' = <the application id being approved>
 limit 1;
```

Four properties make that exact rather than approximate:

- **One writer.** `vam071_confirm_renewal_profile` is the only thing in the database that writes `action_type = 'confirm_renewal'`, and verifier V01/V02 pin the `vam071_*` surface to exactly seven functions with exactly those signatures.
- **Always written.** The audit INSERT in step 8 is unconditional — it runs even when the fresh write set is empty and the function returns `noop`. A confirmation that legitimately applied no field still leaves evidence, so a correct renewal is never blocked by its own emptiness.
- **Transitively carries the rest.** The row cannot exist unless the confirm RPC had already proved the application is bound to exactly one **accepted** invite, that the person/season/source binding matches exactly, and that the acting admin was scope-authorized for that program-season.
- **Monotonic.** No path deletes `admin_audit_log` rows, so the evidence only ever appears. A stale read can only be a false negative, which refuses — the safe direction — so there is no exploitable window between the check and the approval.

*Query semantics.* Run it through the **service-role** client in the same request that performs the approval; `admin_audit_log` is not reachable by `anon` or `authenticated`, and a client-side check would be worthless anyway. No caching, no memoisation across requests.

*Refusal.* Zero rows → return the ordinary failure result and **write nothing**: no person, no profile, no status change. A query **error** must also refuse — fail closed, never approve because the evidence lookup broke.

**This is a blocker before real renewal invites are generated.** Until it exists, every issued renewal link is one direct approval away from a stale canonical profile with no audit trail.
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
        ↓
P0-RT-9, P0-RT-10 and P0-RT-11 all closed
        ↓
(only then)  the first real renewal invite is generated
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

**M2 — Who can create, revoke and confirm is a measured fact, not a narrated one.** `vam063_authorized_for_scope` admits an active `super_admin` by role or a UUID-matching active `admin_scope_access` grant. The project release record says WP1-A2 converted those grants and is closed; this package asserts nothing beyond that and instead **measures the live authorization state** in preflight BLOCK 2, with the expected reading stated in §7.3. Reported, never gated. *(Remediation of independent-review finding H-1: the earlier text asserted as current fact that Production still stored codes, that create/revoke/confirm were necessarily `super_admin`-only, and that WP1-A2 was unexecuted. All three are removed; none is replaced by an unsupported live claim.)*

**M3 — A renewal application can be approved without ever being confirmed.** `source = 's12_mentor_renewal'`, `status = 'submitted'` is an ordinary approvable row, so the pre-existing approval path bypasses the admin diff, writes no `confirm_renewal` audit row, and leaves the profile stale under an approved application. Closed by **P0-RT-11** (§8.1) as a normative **server-side** guard in `approveApplication`, keyed on the invite binding or the renewal source and gated on the exact `confirm_renewal` audit evidence. Not implemented in this SQL-only package — the guard belongs in a code path this package does not own and does not modify — and **blocking before any real renewal invite is generated**. *(Independent-review finding M-3.)*

**M4 — `vam063_add_membership_role` alone cannot restore a declined-then-reinvited mentor.** Decline → `opted_out` → legitimate re-invite → accept → `add_membership_role` sees the existing row and returns `noop`, leaving the membership `opted_out` while the application is approved. Closed by **P0-RT-10** (§8.1): the full status→action mapping over the existing `vam063` surface, restoring `opted_out` through `vam063_reactivate_membership` and failing closed on `paused`, `invited` and every terminal status rather than forcing activation. No new lifecycle status, no duplicate membership, and no new SQL — this package adds only the prerequisite and verifier checks that keep the required `vam063` function present and executable. *(Independent-review finding M-1.)*

### LOW

**L1 — `applications.submitted_at` had two live shapes across the repository and the accept path wrote `current_date`.** Migration 038 documents it as a legacy `date` column and the 059 bootstrap declares `submitted_at date`; the S12 release baseline reproduction declares `timestamptz not null default now()`. `current_date` is assignable into either, but on a `timestamptz` column it silently discards the time of day of a submission the invite row records to the microsecond. **Remediated:** both shapes are now the *only* supported ones and are gated explicitly — preflight `[APPLICATION_SUBMITTED_AT_TYPE]`, `apply.sql` Section 1 byte-identically, verifier V27 — and the accept path writes `v_now`, the same transaction timestamp that claims the invite two statements later, so the two records of one submission agree by construction. On a `date` column PostgreSQL applies the ordinary assignment cast and stores exactly what `current_date` stored; on `timestamptz` the real instant now survives. No dynamic SQL was needed or used. The date rendering of a `timestamptz` depends on the session `TimeZone`, as it already did for `current_date`, which is why every runbook step sets UTC. *(Independent-review finding M-2.)*

**L2 — The 60-day maximum invite lifetime is a ceiling this package chose,** not a policy the brief specified. It refuses only unbounded expiries; the caller still chooses. Changing it is a one-line change to `vam071_create_renewal_invite` and a re-verify.

**L3 — `applications.intake_batch_id` is left NULL for renewals,** because a renewal is not part of an intake batch and creating one would be schema/seed work outside this package. `applications` has no `program_id` column at all; the program binding lives on the invite and on the membership, which is where every downstream consumer already reads it.

### INFO

**INFO-1 — The `confirm_renewal` audit row is written inside the profile-write transaction rather than after `approveApplication`,** a refinement of P0-RT-8's literal ordering. Reasoned in §7.2. **The independent review ruled on this and accepted it**: `vam071_confirm_renewal_profile` → membership lifecycle operation → `approveApplication` is the normative runtime contract and is not reverted to match the earlier prose. This entry is now a record of a closed decision, not an open question — and P0-RT-11 depends on it, since the audit row it uses as evidence is exactly the one this ordering makes atomic with the mutation.

**INFO-2 — The verifier pins body properties by anchored regex and emits body seals as *evidence*, not as assertions against a literal.** No database was contacted while authoring this package, so a hard-coded expected hash would be a guess whose first FAIL would be indistinguishable from a real defect. The verifier's own header says so rather than implying more proof than it has.

### Deferred (recorded, not fixed here)

| | |
|---|---|
| **D1** | A column-immutability trigger on `person_season_invites.submitted_at` / `outcome` / `application_id` would make replay-cannot-overwrite structural rather than predicate-dependent. It is a change to M070's closed table. M070 recorded the same deferral. |
| **D2** | `mentor_profiles.person_id` has no unique constraint. Adding one is the right fix for H2 but is a schema change to a table this package does not own, and it would fail on any pre-existing duplicate. Belongs in its own ticket with its own data audit. |
| **D3** | `public.set_updated_at()` has no pinned `search_path`. Unchanged from M070's D5: pre-existing shared infrastructure with 17 Production triggers, and a blast radius far wider than this package. |
| **D4** | `rollback.sql` carries no `[ENV_NOT_PRODUCTION]` guard, matching M070's D7 and for the same reason: a rollback that refuses to run on the environment it is needed on is worse than one that runs. Its protection is state-based — `DROP … IF EXISTS` over an exact seven-name inventory. |
| **D5** | **Blank-integer guard NULL semantics.** The confirm RPC's integer-field guard is `nullif(btrim(coalesce(…, '')), '') !~ '^[0-9]+$'`, which refuses a blank or absent value rather than treating it as "clear this field". Deliberately not changed under a narrow remediation: it fails closed, and deciding whether a renewal may *blank* an integer column is a product question, not a defect fix. |
| **D6** | **Normalisation/audit divergence.** The drift comparison and the write-set recomputation both normalise (trim, empty-as-absent), while `before_data` in the `confirm_renewal` audit row carries the raw `jsonb` value from the locked profile and `after_data` carries the normalised text. The audit is therefore truthful about both sides but not symmetric in rendering. Recorded, not changed. |
| **D7** | **BLOCK 2 `AUDITCOLS` presentation.** The field reads `AUDITCONTRACT13` or `AUDITCOLS=<n>`, which mixes a verdict token and a count in one column. BLOCK 1 section 6 is what actually proves the contract and refuses; this is a display nit. |
| **D8** | **Uncast `array[]` style inconsistency.** Some array literals in these files carry an explicit `::text[]` and some do not, in positions where PostgreSQL resolves the type unambiguously. Every position that could be ambiguous is cast — the tests enforce that — so the remainder is stylistic. |
| **D9** | **Isolation-level uniform-error nuance.** Under a non-default isolation level a serialization failure on the submit paths surfaces as a `40001` rather than as the uniform `42501` refusal, which is a distinguishable outcome for a probing bearer-token holder. The information it leaks is "there was contention", not which invite exists. |

Each of D5–D9 is an independent-review LOW finding, deliberately **not** fixed in this remediation: none of them is touched by the H-1, M-1, M-2 or M-3 changes, and widening a narrow security remediation to sweep them in is how a reviewed diff stops being reviewable.

---

## 11. What has and has not been validated

**Validated:** every property in `__tests__/m071-renewal-trusted-runtime.test.ts`, which includes the two executable cross-checks against the real TypeScript allowlists (§5.3), the byte-identity of `apply.sql` and the canonical migration, and the absence of every defect class M070's failures taught.

**Not validated:** anything that requires a database. No SQL in this package has been executed anywhere. The column contracts — `applications.submitted_at`'s **type** now included — the audit INSERT contract, the `role_applied` type, the `vam063` lifecycle surface `P0-RT-10` depends on, and the live `admin_scope_access` representation are all **read from the live catalog by the preflight** rather than assumed. The first four are refusals; the fifth is evidence the owner reads (§7.3). That is why the preflight is the next execution gate and why it refuses rather than adapts, and its first-ever execution against any database will still be that Production read-only run.

**Not closed by this package, and blocking:** P0-RT-10 and P0-RT-11 are specifications, not code. Until the runtime package implements both, a declined-then-reinvited mentor can end up renewed with an `opted_out` membership, and any renewal application can be approved through the legacy path with no confirmation and no audit.

That is the honest state of this package, and the reason `SAFE_TO_BEGIN_CODEX_UI_IMPLEMENTATION` is **NO**.
