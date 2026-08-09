# Validation — what was executed, and what it proved

Every SQL file in this package was **executed**, not just written, against a
disposable `postgres:17-alpine` container reproducing the live Production
baseline that owner-run Probe A / Probe B captured on 2026-08-09.

Nothing in this package has been run against Production or Staging.

**Reproduction:** `validation/prod_baseline_reproduction.sql` — 13-column
`admin_audit_log` including the four legacy columns with `action` NOT NULL and
no default; no `action_type` CHECK; zero audit rows; zero membership rows; RLS
enabled on exactly the five tables Probe A reports and disabled on the other
eight; broad anon/authenticated grants; the untouched 7-value migration-052
transition vocabulary; canonical profile `person_id` FKs; `admin_scope_access`
holding season/program **codes**; no `supabase_migrations.schema_migrations`.

---

## 1. Sequences executed

| Run | Result |
|---|---|
| baseline → `preflight.sql` | PASS, with both expected NOTICEs (`AUDIT_LEGACY_NOT_NULL`, `SCOPE_CODE_FORM`) |
| T1 → T2 → T3 | all committed; T1 reported dropping NOT NULL on `action` |
| `verifier.sql` **before** T4 | V01–V18, V21–V24 PASS; V19 and V20 FAIL exactly as the header predicts |
| T4 with no gate set | REFUSED `[PROBE_C_NOT_RECORDED]` |
| T4 with `vam.probe_c_claim_source='nonsense'` | REFUSED `[PROBE_C_INVALID]` |
| T4 with `claims_json` | committed |
| `verifier.sql` **after** T4 | **24 / 24 PASS** |
| `tests.sql` | **23 / 23 assertions passed**, transaction rolled back |
| R3 before R4 | REFUSED `[T4_STILL_ACTIVE]` |
| R4 → R3 → R2 → R1 | all committed |
| `preflight.sql` after full reversal | **PASS again, identical baseline token** |

The baseline token was `PRODS12:13:0:0:0:0:0:0:0:NOCHECK:RLS5-8` both before the
release and after the complete reversal.

---

## 2. The trusted-context resolver, proven on all three sources

This is the claim the whole Phase 3 gate rests on, so it was measured rather
than reasoned about:

| Simulated deployment | `claim_source` returned | `is_trusted` |
|---|---|---|
| `set_config('request.jwt.claim.role','service_role')` — PostgREST ≤ v9 | `legacy_guc` | true |
| `set_config('request.jwt.claims','{"role":"service_role"}')` — PostgREST v10+ | `claims_json` | true |
| `SET ROLE service_role` with no claims at all — secret-key style mapping | `set_role` | true |
| owner session in the SQL editor | `none` | false |
| `{"role":"authenticated"}` | `authenticated` | false |

The third row was the one genuinely at risk: `vam069_trusted_context_probe()`
is `SECURITY DEFINER`, so it executes as `postgres`, and the question was
whether `current_setting('role')` still reports the role installed by
`SET ROLE` after that switch. **It does** — the probe returned
`api_role=service_role, claim_source=set_role, db_current_user=postgres`. That
is what makes the package survivable if Production's deployment presents a
newer-format secret key rather than a JWT.

Negative controls, both denied:

* `anon` executing `vam069_trusted_context_probe()` → `permission denied for function`
* `anon` selecting from `public.people` → `permission denied for table people`

---

## 3. Three defects found only by executing

1. **`verifier.sql` V04 compared against `'52|t'`.** `boolean::text` yields
   `true`, not `t`, so the check reported FAIL on a correctly applied release —
   a false alarm in the one artifact whose job is to be trusted. Fixed to
   `'52|true'`.

2. **`R2` aborted at its final verification with "column reference g is
   ambiguous".** The PL/pgSQL variable `g jsonb` collided with the lateral
   alias `g` in the grant-comparison query. It failed at the *last* step of the
   rollback, which is the worst place for a rollback to fail. The alias is now
   `gr`, and the reason is commented in the file so it is not re-introduced.

3. **`R1` ran happily while T2 was still applied.** The documented order is
   R4 → R3 → R2 → R1, but only R3 and R2 enforced their predecessors. Running
   R1 early left a half-reversed release whose preflight could not pass again.
   R1 now refuses while `vam_prod_s12_release_state` exists or any `vam063_*`
   function remains.

None of these were visible by reading. All three were found in the first
execution pass.

---

## 4. What the seals do and do not prove

After the full R4→R3→R2→R1 reversal the baseline token and the
`constraint_seal` returned to their exact pre-release values. Two seals did
**not**, and both are expected:

* **`security_seal` changed** (`f2776509…` → `0d0b1896…`). R2 restores every
  captured `(grantee, privilege)` triple and verifies each one individually,
  and the RLS flags return exactly — but re-granting rewrites `relacl`, whose
  text form depends on grant order. **Use `security_seal` to detect drift
  before applying, never to prove rollback fidelity.** R2's own per-grant
  verification is what proves that.
* **`audit_column_seal` changed** (`e136e5d6…` → `29a25429…`) because `action`
  is now nullable. R1 deliberately does not restore NOT NULL on the legacy
  columns — doing so would re-break every future audit INSERT — and says so in
  its header, with the statements available commented out.

---

## 5. What this validation does NOT prove

Stated plainly, because a green local run is easy to over-read:

* **It is not Production.** The reproduction is built from Probe A/B evidence.
  Any Production fact those probes did not report is asserted by
  `preflight.sql` at apply time and will REFUSE rather than surprise. That is
  the whole reason the preflight is as long as it is.
* **It does not prove which credential Vercel Production sends.** Only Probe C
  can, and only from the deployment itself. That is why T4 exists as a separate
  transaction.
* **It does not exercise PostgREST.** The reproduction is bare Postgres. The
  `NOTIFY pgrst, 'reload schema'` statements are present in all four
  transactions but cannot be observed here.
* **It does not exercise the Next.js app.** The RC's Day-1 paths were verified
  by reading every module at HEAD `24556ad`, and end-to-end by the staging UAT.
