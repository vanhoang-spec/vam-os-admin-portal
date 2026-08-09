# VAM OS — Production Season 12 release package

**Status: PREPARED — NOT APPLIED.** Nothing in this package has been run
against Production or Staging. No SQL applied, no deploy, no credential
rotation, no record deleted.

| | |
|---|---|
| Target | PRODUCTION Supabase `vam-os-mvp` (`qkkroesfiazsejkzflcd`) |
| Target deployment | `vam-os-admin-portal.vercel.app` |
| Evidence baseline | owner-run Probe A / A2 / B, 2026-08-09 |
| RC branch | `migration-062-v3-membership-lifecycle` |
| Pre-freeze app HEAD | `24556ad3519b64bc12e17eb33faa1128124be795` |
| Package version | `VAM_PROD_S12_R1` |
| Migration ledger | **absent on Production, and not repaired by this release** |
| Validation | executed end-to-end on a disposable `postgres:17-alpine` reproduction — see `VALIDATION.md` |

This package is **Production-specific**. It is not M065, M066, M067 or M068 R2
re-badged. Every one of those targets Staging, is headed "STAGING ONLY", and
M068 R2's preflight actively refuses Production's 13-column `admin_audit_log`.

---

## 1. Final Production delta matrix

Classified from **live Production object evidence**, never from a ledger.

| Functionality | Classification | Why |
|---|---|---|
| **M062** — account-admin RLS foundation | **PARTIAL — MINIMAL PROD VARIANT** | Only two halves of it are Day-1: the RLS/grant hardening (delivered by **T2**, narrower than 062's version) and the `admin_audit_log` vocabulary (delivered by **T1**, the canonical 52 rather than 062's 18). The 8 `account_*` tables and 11 `vam062_*` functions are **not installed** — no Day-1 path calls one. See the P1 consequence in section 4. |
| **M063** — membership lifecycle RPCs | **REQUIRED — Production-specific variant** | Probe A shows no VAM063 family. The RC calls seven of these functions by name (`app/actions/membership-lifecycle.ts`); without them, Pause / Reactivate / Add role / Remove role all fail. Installed by **T3** without 063's two inherited 062 preconditions, which are used only by objects Production does not have. |
| **M064** — trusted-context claim compatibility | **NOT REQUIRED as a migration — folded into T3** | M064 rewrites nine existing functions whose guard reads a GUC PostgREST removed in v10.0. Production has none of those functions, so there is nothing to retrofit: `vam063_trusted_api_role()` carries the corrected resolution from the first line it runs. Replaying M064 would be a no-op hunting for absent functions. |
| **M065** — transition_type vocabulary | **REQUIRED — Production-specific packaging** | Probe A shows the untouched 7-value migration-052 CHECK. The six wrappers write `pause / withdraw / opt_out / cancel / reactivate / role_removed`; without the superset every transition fails 23514 *after* passing authorization. The DDL is identical to M065; only the packaging is Production-specific. Delivered by **T3 section 1**. |
| **M066** — profile source_application / intake_batch | **NOT REQUIRED** | Probe A: both columns and both partial index families already present on both profile tables. Re-asserted by `preflight.sql` section 3 and by verifier **V21**, so the classification is enforced rather than assumed. |
| **M067** — profile person_id FK canonical | **NOT REQUIRED** | Probe A: both FKs already `ON DELETE CASCADE / ON UPDATE NO ACTION / DEFERRABLE INITIALLY DEFERRED / VALID`; Probe B: zero orphans on 450 mentor and 656 mentee profiles. Re-asserted by `preflight.sql` and verifier **V22**. |
| **M068** — audit compatibility | **PARTIAL — MINIMAL PROD VARIANT** | Production already has `details` and `updated_at`, has **no** `action_type` CHECK at all, carries four legacy columns M068 R2 refuses, and holds zero rows. It needs exactly one thing from that package — the canonical 52-value vocabulary — plus one Production-only repair no staging package contains. Delivered by **T1**. |
| **Day-1 security (RLS + grants)** | **REQUIRED — new, Production-specific** | Not an M06x item. Probe A shows RLS disabled on eight Day-1 tables with broad anon grants over 902 applications, 1,106 profiles, the full `people` table and the admin roster. Delivered by **T2**. |
| **UEHM-S12 admin scope seed** | **NOT REQUIRED — Decision A** | See section 6. No scope row is seeded. |
| **Migration ledger** | **NOT REQUIRED** | Probe A2 confirms it is absent. Repairing it is explicitly out of scope for launch. |
| **Historical audit backfill** | **NOT REQUIRED** | Probe B: `audit_rows_total = 0`, `out_of_canonical_rows = 0`. Nothing to reconcile — which is also what makes the new CHECK safely VALIDATED. |

---

## 2. P0 / P1 / P2

### P0 — must be resolved before public Production forms open

| # | Item | Resolved by |
|---|---|---|
| P0-1 | **Day-1 PII directly reachable by `anon`.** RLS disabled on `applications`, `people`, `mentor_profiles`, `mentee_profiles`, `admin_users`, `intake_batches` and both membership tables, with broad anon/authenticated grants. The anon key ships in the browser bundle. | **T2** |
| P0-2 | **Membership lifecycle cannot run at all.** No VAM063 family, and the transition vocabulary rejects every lifecycle value. | **T3** + **T4** |
| P0-3 | **Production server auth compatibility is unproven.** Vercel holds the legacy-named `SUPABASE_SERVICE_ROLE_KEY` while the project also carries newer secret-key objects; which one the deployment presents is not knowable from the database. | **Probe C**, gating **T4** |

P0-1 is a standing exposure that exists right now, independent of this release.
P0-2 and P0-3 block lifecycle only — Day-1 can open without lifecycle if
either is unresolved.

### P1 — accepted for launch, with a known workaround

| # | Item | Position |
|---|---|---|
| P1-1 | **Stale client pending-lock after Pause** requires one page refresh before Reactivate. | Accepted as owner-directed. Not a release blocker. The fix is not trivial or isolated — the lock lives in `useFormState` identity comparison across two sibling forms — so it is **not** attempted before freeze. |
| P1-2 | **Admin-console user management will not work on Production.** `lib/admin-users.ts` and the CSV import path call `vam062_*` RPCs this release does not install. | Deliberate: not a Day-1 path, and installing all of VAM062 V3 to reach it would multiply the release surface. Workaround: manage `admin_users` and `admin_scope_access` directly in the Supabase SQL editor. Calls will fail with PGRST202. |
| P1-3 | **`admin_scope_access` stores season/program CODES, not UUIDs**, so only `super_admin` can operate lifecycle. | Decision A, section 6. The representation question is deferred to its own change, after launch. |

### P2 — noted, no change before freeze

| # | Item | Position |
|---|---|---|
| P2-1 | **`CURRENT_OPERATING_SEASON_CODE` is `UEHM-S11`.** | **No change.** It drives operations dashboards, KPI cards and event-creation defaults only. The Day-1 intake path already uses `CURRENT_APPLICATION_SEASON_CODE = "UEHM-S12"` and `CURRENT_APPLICATION_BATCH_CODE = "UEHM-S12-B1"` — which is exactly the binding the staging UAT confirmed. Production S12 has zero memberships and zero operational data, so switching would empty every dashboard for no Day-1 gain. `__tests__/season-config.test.ts` pins it to S11 by design; the file's own comment requires an explicit owner decision to move it. |
| P2-2 | Four legacy `admin_audit_log` columns are dead weight. | Preserved untouched. Dropping them is not Day-1 work. |
| P2-3 | No migration ledger on Production. | Out of scope for launch, as directed. |

### Fixed before freeze

**Membership Add-Role UI defaulted to the wrong Program / Season / Role.** A
`<select>` with no `defaultValue` pre-selects option 0, so the form arrived
already showing a program, a season and "Mentor" that nobody chose — wrong for
an approved mentee, and wrong for any program or season that does not sort
first. All three selects now open on a disabled empty placeholder and are
`required`, so an unchosen field cannot be submitted; the server action's
existing uuid/role validation is the second line of defence. Small,
deterministic, no navigation or context refactor.
Covered by `__tests__/membership-add-role-no-default-selection.test.tsx`.

---

## 3. Exact objects that WILL change

Eleven table-level changes, thirteen new objects. Nothing else.

**T1 — `public.admin_audit_log`**
1. `DROP NOT NULL` on whichever of `action`, `actor_email`, `target_email`,
   `metadata` is NOT NULL without a default. Conditional and idempotent; no
   column, type or datum is touched. Without it every Day-1 audit INSERT fails
   23502, and six of the eight audit writers swallow that silently.
2. `ADD CONSTRAINT admin_audit_log_action_type_check` — closed 52-value
   vocabulary, **VALIDATED** (free to validate at zero rows).

**T2 — eight tables get RLS; ten get grant revocation**
3. `ENABLE ROW LEVEL SECURITY` on `admin_users`, `applications`, `people`,
   `mentor_profiles`, `mentee_profiles`, `intake_batches`,
   `person_season_memberships`, `person_season_membership_log`.
4. `REVOKE ALL ... FROM public, anon, authenticated` on those eight plus
   `admin_audit_log` and `application_decisions`.
5. **new table** `public.vam_prod_s12_release_state` — the pre-state capture
   that makes T2 reversible.

**T3 — lifecycle**
6. `person_season_membership_log_transition_type_check` replaced by the
   13-value superset (7 baseline + 6 lifecycle).
7. **eleven new functions**: `vam063_trusted_api_role`,
   `vam069_trusted_context_probe`, `vam063_authorized_for_scope`,
   `vam063_transition_membership_atomic`, and the seven entry points
   `vam063_{pause,withdraw,opt_out,cancel,reactivate}_membership`,
   `vam063_remove_membership_role`, `vam063_add_membership_role`.
8. EXECUTE granted to `service_role` on the probe **only**.

**T4 — execution gate**
9. **new table** `public.vam_prod_s12_release_gate` — records the Probe C result.
10. EXECUTE granted to `service_role` on the seven entry points.

**Application code**
11. `app/people/[id]/membership-lifecycle-controls.tsx` — three selects gain a
    disabled empty placeholder and `defaultValue=""`.

## 4. Explicit objects that will NOT change

* **No column is added, dropped, renamed or retyped anywhere.** All 13
  `admin_audit_log` columns survive, including the four legacy Production-only
  ones (`action`, `actor_email`, `target_email`, `metadata`).
* **No `updated_at` trigger is created** on `admin_audit_log`. Every Day-1
  writer INSERTs and none UPDATEs, so it is not exercised by any Day-1 path. If
  Production already has the migration-026 trigger, it is left exactly as is.
* **No default and no NOT NULL is added** to any column.
* **No row is inserted, updated or deleted** by any apply transaction. Zero.
* **No RLS policy is created.** T2 enables RLS with none — fail closed. No
  Day-1 path uses the anon or authenticated role against these tables.
* **`programs`, `seasons`, `application_decisions`, `admin_scope_access`,
  `admin_audit_log`** keep their existing RLS state; only grants change on the
  latter two.
* **No `admin_scope_access` row is seeded**, for UEHM-S12 or anything else.
* **No `admin_users` row is created, modified or promoted.**
* **No M066 or M067 change.** Both are asserted and left alone.
* **No VAM062 V3 objects.** No `account_*` table, no `vam062_*` function.
* **No migration ledger** is created or repaired.
* **No unrelated legacy drift is normalized.**
* **No credential is read, rotated or reset.** The project JWT secret is not
  touched.
* **No test record is deleted.** See `CLEANUP_14_TEST_APPLICATIONS_PLAN.md`.
* **`lib/season-config.ts` is unchanged** — see P2-1.

## 5. Production apply order

Each transaction is self-contained, commits independently, and re-asserts its
own preconditions. A failure inside one rolls that one back whole.

```
0.  preflight.sql                      READ-ONLY. Must PASS. Record token + 3 seals.
1.  apply/T1_audit_action_type_compat.sql
2.  apply/T2_security_rls_grant_minimum.sql
3.  apply/T3_membership_lifecycle_objects.sql
      -> verifier.sql : V01–V18, V21–V24 PASS; V19, V20 FAIL (expected)
4.  PROBE C  (PROBE_C_TRUSTED_CONTEXT_RUNBOOK.md)  — owner-run, over HTTP
      -> must return is_trusted = true. If not: STOP. Do not run T4.
5.  select set_config('vam.probe_c_claim_source','<claim_source>',false);
    apply/T4_enable_lifecycle_execution.sql          (same session)
6.  verifier.sql                       ALL 24 must PASS.
7.  tests.sql                          optional on Production; always rolls back.
```

Why the order is what it is: T2 cannot run before T1 (it asserts T1's
constraint); T3 needs both T1's vocabulary and T2's RLS; T4 must not run until
Probe C has proved the deployed key resolves to `service_role`, because a grant
is the point at which a lifecycle write becomes reachable.

## 6. Season 12 admin scope — Decision A, no seed

**Chosen: A — the existing controlled `super_admin` operates S12. No
`admin_scope_access` row is added.**

Not a preference — the scope-row branch **cannot work** on today's Production
data. `vam063_authorized_for_scope` compares
`admin_scope_access.program_id / season_id` against program and season **UUIDs**
(`s.program_id = p_program_id::text`). Probe B reports Production stores
**codes** there: `scope_codes_present = ['UEHM-S11']`,
`scope_program_codes_present = ['UEHM', 'UEH Mentoring', 'VAM']`.

So a UEHM-S12 scope row in the existing code form would authorize nothing, and
a UUID-form row would be the only row in the table shaped unlike every other —
quietly forking the representation on launch day. The app layer tolerates both
(`resolveCanonicalScope` in `lib/program-scope.ts` matches on code *or* id);
the SQL layer does not. That divergence is real and is now written down.

`tests.sql` group B proves it both ways: a non-super_admin is denied, and is
**still** denied after a code-form UEHM-S12 scope row is inserted.

`preflight.sql` requires at least one active `super_admin` and NOTICEs if there
is more than one, because Decision A asks for **one controlled launch
operator** out of the 18 decide-capable admins Probe B counted.

The scope-row branch is kept in the function, unmodified, so that whenever the
representation is settled it is a **data** change, not a function rewrite.

## 7. Verifier contract

`verifier.sql` — read-only, 24 checks, one row each: `id`, `status`,
`expected`, `actual`, `proves`.

| Range | Covers |
|---|---|
| V01–V05 | T1: 13 columns intact, four legacy columns preserved, none NOT-NULL-without-default, the CHECK is 52 values and VALIDATED, every stored value canonical |
| V06–V11 | T2: RLS on all ten, zero anon/authenticated/PUBLIC grants, `service_role` retains all 40 table privileges, no policies, FORCE RLS off, capture table present and not API-readable |
| V12–V18 | T3: 13-value transition vocabulary, all six lifecycle values admitted, exactly 11 functions and zero `vam062_*`, all ten SECURITY DEFINER functions pin `search_path`, the seven RC signatures exist, no API role can execute anything, internals ungranted even to `service_role` |
| V19–V20 | T4: Probe C recorded, seven entry points executable by `service_role` |
| V21–V24 | Standing: M066 still NOT REQUIRED, M067 still NOT REQUIRED, S11/S12 intact, no duplicate memberships and no orphan profiles |

**Release contract: all 24 PASS after T4.** Any FAIL → `RECOVERY.md`, matched
by check id. V19/V20 FAIL before T4 is expected and documented.

## 8. Files

```
preflight.sql                              immutable baseline gate
apply/T1_audit_action_type_compat.sql      audit vocabulary + legacy write compat
apply/T2_security_rls_grant_minimum.sql    RLS + grant revocation + pre-state capture
apply/T3_membership_lifecycle_objects.sql  transition vocabulary + 11 functions (ungranted)
apply/T4_enable_lifecycle_execution.sql    Probe-C-gated EXECUTE grant
PROBE_C_TRUSTED_CONTEXT_RUNBOOK.md         owner-run runtime proof
verifier.sql                               24-check release contract
tests.sql                                  23 behavioural assertions, always rolls back
rollback/R1..R4                            reverse order R4 -> R3 -> R2 -> R1
RECOVERY.md                                decision tree
VALIDATION.md                              what was executed and what it proved
CLEANUP_14_TEST_APPLICATIONS_PLAN.md       separate, design-only
validation/prod_baseline_reproduction.sql  local reproduction (never run on Supabase)
manifest.json, SHA256SUMS.txt
```

Related, outside the package:
`docs/audits/sql/VAM_OS_PROD_S12_CLEANUP_FORENSIC_D_TEST_RECORDS_READONLY_PROBE.sql`

## 9. Before Production execution

Independent static review is required. Nothing here has been applied.
