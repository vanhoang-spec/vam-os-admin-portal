# Separate plan — the fourteen synthetic Production applications

**Status: DESIGN ONLY. NOTHING IS DELETED. No deletion SQL exists yet, and
none can be written until Probe D has been run and its output confirmed.**

This plan is deliberately **not** part of the release package's apply path.
Deleting business rows and securing a database are different kinds of risk, and
mixing them into one transaction means a cleanup mistake can force a rollback
of the security remediation. They stay separate.

---

## 1. What the owner identified

Fourteen applications at the top of the current `/applications` list are
synthetic testing records. They have no SBD.

## 2. Why that description cannot become a predicate

**"SBD IS NULL" is not the identifier and must never be used as one.**
Probe D section 2 measures exactly how unselective it is. On a table of 902
applications there is every reason to expect far more than fourteen rows with a
null SBD — S11 legacy records predate the SBD field entirely. A delete built on
that predicate would destroy real candidate data, irreversibly, on a database
with no migration ledger.

**"The first fourteen" is not reproducible either.** `getApplications()` in
`lib/data.ts` issues **no ORDER BY**; the rows arrive in whatever order
PostgREST returns them, and `FilterableTable` sorts only once a sort is chosen.
Position in that list is an artifact of the page render, not a property of the
data. Probe D reports the first fourteen under two independent orderings
(`submitted_at`, then `id`) and states plainly whether they agree — in the
local reproduction they did **not**, which is the whole point.

**The only acceptable identifier is an exact list of fourteen UUIDs, each one
confirmed individually.**

---

## 3. Sequence

### Step 1 — Probe D (read-only, owner-run)

`docs/audits/sql/VAM_OS_PROD_S12_CLEANUP_FORENSIC_D_TEST_RECORDS_READONLY_PROBE.sql`

Returns one JSON row: SBD selectivity, the candidate window under both
orderings with the same 8-character short id the UI shows in "Mã đơn", the
authoritative list of every table with a foreign key to `applications`
(discovered from the catalog, not from memory), per-candidate dependency
counts, blast-radius warnings, and a **generated Probe D2 statement** covering
every dependent table it found.

No PII leaves the database: no names, no email local parts, no phone numbers,
no free text.

### Step 2 — Owner confirmation, one record at a time

For each of the fourteen, the owner confirms in the `/applications` UI, using
the short id, that this exact record is synthetic. The output of this step is a
list of **fourteen full UUIDs**. Not thirteen, not fifteen.

If the two orderings in Probe D disagree, every candidate in the union has to
be examined, not just the first fourteen of either.

### Step 3 — Probe D2 (read-only, owner-run)

Run the generated statement from Probe D with the confirmed UUIDs substituted.
It counts dependent rows per child table. **Every count must be understood
before a deletion is authored** — a non-zero count somewhere unexpected means
the record is not purely synthetic.

### Step 4 — Decide per record, on the evidence

Probe D's `risk` section flags candidates that carry a decision, a `person_id`
link, or a profile built from them. Any such record **was approved**, and
deleting it is no longer a test-record cleanup:

| Finding | What it means | Default |
|---|---|---|
| no decision, no person link, no profile | pure synthetic submission | safe to delete |
| has `application_decisions` rows | someone made a decision on it | delete the decision rows in the same transaction, or keep the record |
| has `person_id` set | a `people` row was created | decide explicitly whether that person is also synthetic |
| has a profile via `source_application_id` | a mentor/mentee profile exists | that profile is in the 450/656 Probe B counted; deleting it changes the profile totals |
| person also has memberships | it is in the S12 cohort | **do not delete** without a separate decision |
| person shared with another application | deleting the person breaks a real record | **do not delete the person** |

### Step 5 — Author the cleanup transaction (a separate package)

Only after steps 1–4. Its non-negotiable properties:

* **Exact UUIDs only.** A literal fourteen-element list. No `WHERE sbd IS NULL`,
  no `ORDER BY ... LIMIT 14`, no date range, no pattern match on email.
* **Its own transaction, its own file, its own review.** Never combined with
  T1–T4 or with any schema change.
* **A count assertion first**: the transaction aborts unless exactly fourteen
  target rows are found, and aborts if any dependency count differs from what
  Probe D2 reported.
* **Child rows before parent rows**, in the FK order Probe D discovered.
* **A pre-image capture** of every row it will delete, written to a package
  table in the same transaction, so the deletion is reconstructible. Production
  has no migration ledger and no point-in-time restore is being assumed.
* **A verifier** proving exactly fourteen applications are gone, that
  `applications` fell from its Probe B total to that total minus fourteen, and
  that the mentor/mentee profile counts and membership counts are unchanged
  unless the step-4 decision said otherwise.

### Step 6 — Timing

Cleanup may execute **before the public Production forms are opened**, after
explicit owner confirmation. Running it afterwards means competing with live
submissions and an application list that is changing underneath the operator.

---

## 4. Explicitly out of scope

* Deleting anything as part of the S12 release apply. The release package does
  not delete a single row.
* Deleting `people`, `mentor_profiles` or `mentee_profiles` rows on the
  strength of an application-level judgement. Each needs its own evidence.
* Any "cleanup" of unrelated legacy drift discovered along the way.
