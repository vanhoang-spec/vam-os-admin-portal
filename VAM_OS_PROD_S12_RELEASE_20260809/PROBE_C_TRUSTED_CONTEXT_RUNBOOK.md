# Probe C — Production trusted-server-context proof

**Owner-run. Between T3 and T4. Read-only. No secret value is ever pasted into
SQL, into this repository, or into any agent transcript.**

---

## 1. Why this exists

Phase 3 requires that current Production server authentication is **proven
compatible before lifecycle writes are enabled**.

Two things are true at once and neither can be resolved from inside the
database:

* Production Vercel authenticates with the **legacy-named**
  `SUPABASE_SERVICE_ROLE_KEY`.
* The Supabase Production project **also** carries newer-format backend /
  secret-key objects.

Which credential the deployed runtime actually presents — and therefore how
PostgREST describes the request to Postgres — is only observable by making a
request with that exact key. Every lifecycle function installed by T3 gates on
that description:

| Source | What sets it | Still populated? |
|---|---|---|
| `request.jwt.claim.role` | PostgREST ≤ v9 per-claim GUC | **No.** Removed in PostgREST v10.0. |
| `request.jwt.claims ->> 'role'` | PostgREST v10+ | Yes, for a JWT-style key. |
| `current_setting('role')` | `SET LOCAL ROLE` issued by PostgREST | Yes, including for a secret-key mapping. |

`public.vam063_trusted_api_role()` tries all three in that order and reports
which one answered. Probe C is how you read that answer.

This is the same defect class M064 was built for on Staging — a guard reading a
GUC the platform no longer sets. The difference is that Production has no such
functions yet, so the corrected resolver is built in from the start and the
only open question is which source is live. Probe C answers it **before** any
row can be written, not after.

---

## 2. Preconditions

* T1, T2 and T3 have committed.
* `verifier.sql` sections V1–V3 pass.
* You have the value of Production Vercel's `SUPABASE_SERVICE_ROLE_KEY`
  available in your own shell. **Do not paste it into a file, a commit, a
  ticket, or a chat.** Do not rotate it. Do not reset the project JWT secret.

---

## 3. Run it

Set the key as a shell variable so it never appears in a command you might
later copy out of scrollback:

```bash
read -rs SUPABASE_SERVICE_ROLE_KEY      # paste, press Enter; nothing echoes
export SUPABASE_SERVICE_ROLE_KEY

curl -sS -X POST \
  "https://qkkroesfiazsejkzflcd.supabase.co/rest/v1/rpc/vam069_trusted_context_probe" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

PowerShell equivalent:

```powershell
$key = Read-Host -AsSecureString "SUPABASE_SERVICE_ROLE_KEY"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key))
Invoke-RestMethod -Method Post `
  -Uri "https://qkkroesfiazsejkzflcd.supabase.co/rest/v1/rpc/vam069_trusted_context_probe" `
  -Headers @{ apikey = $plain; Authorization = "Bearer $plain" } `
  -ContentType "application/json" -Body "{}"
```

When you are done: `unset SUPABASE_SERVICE_ROLE_KEY` (or close the shell).

**Use the value Vercel Production holds.** Probing with a key you happen to
have locally, or with a different key object from the Supabase dashboard,
proves something about that key and nothing about the deployment.

---

## 4. Read the result

The probe returns one row:

```json
[{ "api_role": "service_role",
   "claim_source": "claims_json",
   "is_trusted": true,
   "db_current_user": "postgres",
   "probe_version": "VAM_PROD_S12_PROBE_C_v1" }]
```

### PASS — `is_trusted: true`

Record `claim_source`. Proceed to T4, setting that exact value:

```sql
select set_config('vam.probe_c_claim_source', 'claims_json', false);
-- then run apply/T4_enable_lifecycle_execution.sql in the SAME session
```

`db_current_user` is expected to be the function owner (`postgres`) — the probe
is `SECURITY DEFINER`, so this confirms the elevation works, and is not the
role being authorized.

### FAIL — `is_trusted: false`, `api_role` is something else or null

**Do not run T4.** Lifecycle stays disabled; everything T1–T3 delivered
(secured tables, audit vocabulary, applications, review, approval, person and
profile creation, decision and audit) is unaffected and Day-1 can still open
without membership lifecycle.

Diagnose in this order:

1. `api_role` is `anon` or `authenticated` — you used the wrong key. Retry with
   the value Vercel Production actually holds.
2. `claim_source` is `none` and `api_role` is null — the request reached the
   function with no role description at all. Capture the raw response and stop;
   this needs its own forensic before anything is granted.
3. HTTP 404 / `PGRST202` — PostgREST has not reloaded. T3 issues
   `NOTIFY pgrst, 'reload schema'`; wait, then retry once.
4. HTTP 401/403 or `42501` — the key is not being accepted as `service_role` at
   all. That is an environment finding, not a database finding. **Do not
   rotate the key and do not reset the JWT secret to chase it** — both are
   explicitly out of scope for this release and either would take the whole
   Production deployment down.

### Optional negative control

Repeat the same call with the **publishable / anon** key. It must fail with
`42501` (no EXECUTE for `anon`). If it succeeds, stop: T3's privilege section
did not take effect and nothing further should be granted.

---

## 5. What to hand to the independent reviewer

* the probe's JSON response with `api_role`, `claim_source`, `is_trusted`
* the negative-control response
* the `claim_source` value you passed to T4

Never the key.
