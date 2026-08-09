# Recovery decision tree — Production S12 release

Each apply transaction is self-contained and commits independently. A failure
inside any of them rolls that transaction back whole; there is no half-applied
state to clean up. What follows is for problems discovered **after** a commit.

**The default answer is roll FORWARD.** Only two of the four transactions have
a rollback you would ever want to reach for, and one of them re-opens the P0.

```
                       Something is wrong after applying
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
  Lifecycle misbehaves      Admin portal broken          Audit write rejected
  (branch 3)                (branch 2)                   (branch 1)
```

---

## Branch 0 — first, decide what actually failed

Run `verifier.sql`. It names the transaction:

| Failing check | Owner |
|---|---|
| V01–V05 | T1 — audit |
| V06–V11 | T2 — security |
| V12–V18 | T3 — lifecycle objects |
| V19–V20 | T4 — execution gate |
| V21–V24 | standing assertions; a failure here means something outside this release changed Production |

If **V21, V22, V23 or V24** fails, stop and re-run Probe A and Probe B. Those
checks assert facts this release did not create and must not have disturbed.
Something else is writing to Production.

---

## Branch 1 — audit writes are being rejected (23514)

**Symptom.** An approval or lifecycle action succeeds but the server log shows
`admin_audit_log insert failed` with SQLSTATE 23514, or a lifecycle RPC aborts.

**Diagnose first.** 23514 means the app wrote an `action_type` outside the
canonical 52. That is a code defect, not a constraint defect: the vocabulary
was reconstructed from the runtime writers themselves. Get the rejected value
out of the server log.

* **The value is a legitimate verb that was missed** → roll FORWARD. Add that
  one value in a new, separate, single-statement transaction. Do not drop the
  constraint to make room; do not widen it speculatively.
* **The value is a typo or a stale code path** → fix the app, redeploy. The
  constraint did its job.
* **Only if the vocabulary itself is judged wrong** → `rollback/R1_drop_audit_vocabulary.sql`.
  R1 refuses once audit rows exist; that refusal is deliberate. To override it,
  `select set_config('vam.r1_override_audit_rows','true',false);` first, and
  record why.

**23502 (not-null violation) on `action`, `actor_email`, `target_email` or
`metadata`** means T1 section 1 did not run or was reverted. Re-run T1 section 1
in isolation; it is idempotent.

---

## Branch 2 — the admin portal cannot read Production after T2

**Do not start with R2.** R2 re-opens 902 applications, 1,106 profiles and the
people table to the anon role.

Work through this in order — it is ordered by likelihood:

1. **Is `SUPABASE_SERVICE_ROLE_KEY` reaching the server?** Every Day-1 read and
   write goes through the service-role client. `lib/admin-auth.ts` throws
   outright without it, and `lib/data.ts` `dataClient()` returns `null` for
   application tables. Check `/admin/debug-auth` on the deployment. A missing
   key looks exactly like a permissions failure and is fixed in Vercel, not in
   the database.
2. **Is the failing read a Day-1 path at all?** T2's contract is that nothing
   Day-1 uses the anon or authenticated role. If a page broke, identify the
   module. If it genuinely needs an authenticated read, the fix is a reviewed
   policy **and** a grant for that specific table and that specific need —
   roll forward, one table at a time. Not a blanket restore.
3. **Is it PostgREST cache?** All four transactions issue
   `NOTIFY pgrst, 'reload schema'`. If a 42501 persists past a minute, it is
   not the cache.
4. **Only if Day-1 is down and the cause is proven to be T2** →
   `rollback/R2_restore_security_baseline.sql`. It restores the exact captured
   flags and grants, refuses without the capture, and proves the restore
   matched. Treat the window it opens as an active incident and close it again.

---

## Branch 3 — lifecycle misbehaves

**Stop first, decide second.** `rollback/R4_revoke_lifecycle_execution.sql`
disables every lifecycle write in one statement and leaves applications,
review, approval, person and profile creation, decisions and audit fully
operational. Day-1 can open without lifecycle; memberships can be added later.

Then classify:

| Observation | Meaning | Action |
|---|---|---|
| `VAM063 trusted server context required` | the deployed key does not resolve to `service_role` | R4. Re-run Probe C. Do **not** rotate the key or reset the JWT secret. |
| `VAM063 actor not authorized for this program-season scope` | the operator is not an active `super_admin`, and the scope-row branch cannot match code-form `admin_scope_access` rows | Expected under Phase 5 Decision A. Use the controlled super_admin operator. |
| `VAM063 unauthorized actor` | `admin_users.id` passed is not active | data issue, not a release issue |
| 23514 on `person_season_membership_log` | a transition_type outside the 13 | roll forward with one added value; T3's vocabulary came from the six wrappers themselves |
| 42501 calling a `vam063_*` RPC | T4 not applied, or R4 was run | expected; re-run Probe C then T4 |

**`rollback/R3_drop_lifecycle_objects.sql` refuses once any lifecycle
transition has been recorded, and once any `source='manual'` membership
exists.** That is correct and not a bug to work around: restoring the 7-value
vocabulary over real history would require deleting audit rows. Past that
point, R4 plus a forward fix is the only supported route.

---

## Branch 4 — full reversal to the Probe A/B baseline

Only if the release is abandoned outright, and only with the caveats above:

```
R4  →  R3  →  R2  →  R1
```

Each refuses if the next-outer transaction is still applied, so the order
cannot be got wrong by accident. After all four, re-run `preflight.sql`: it
must PASS again, which is what proves the reversal was complete. R1 leaves the
legacy columns nullable and R2 restores the P0 exposure — both are called out
in the files themselves.

---

## What is never a recovery action

* Rotating `SUPABASE_SERVICE_ROLE_KEY`, or resetting the project JWT secret.
  Either takes the whole Production deployment down and neither is in scope.
* Deleting rows to make a constraint or a rollback fit.
* Editing `preflight.sql` so it stops refusing. If Production drifted, re-run
  Probe A and Probe B and re-derive the package.
* Applying any staging package (M065 / M066 R2 / M067 / M068 / M068 R2) to
  Production. Every one of them is headed "STAGING ONLY", and M068 R2's
  preflight actively refuses Production's 13-column shape.
