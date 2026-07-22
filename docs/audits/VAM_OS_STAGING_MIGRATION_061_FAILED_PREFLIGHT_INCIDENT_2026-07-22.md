# Staging Migration 061 Failed-Preflight Incident

Date: 2026-07-22

- Target: confirmed staging `vam-os-staging`, ref `ljfneyuvpxrmejpxsmpz`.
- Observed error: `DEPENDENCY_MISSING: public.applications`.
- Migration 061 remains unauthorized.

## Exact statement order

1. Line 7 starts an explicit transaction with `BEGIN`.
2. Lines 10-52 execute the initial inline preflight block.
3. Lines 15-20 select the first missing required dependency using `to_regclass`.
4. Lines 21-23 raise the observed exception.
5. The first campaign DDL is `CREATE TABLE public.recruitment_campaigns` at line 54.

There is no DDL, DML, grant, revoke or function invocation before the preflight block other than transaction start and catalog reads. The observed exception occurred before line 54. PostgreSQL errors abort the current transaction; because no mutation preceded the exception, the reviewed statement order provides no migration-061 object change to retain. SQL Editor may display a failed transaction until rollback/session cleanup.

## Required read-only verification

Run the owner-reviewed staging baseline probe and confirm: `applications` absent; `recruitment_campaigns` absent; no 061 functions/triggers/indexes; migration ledger has no applied 061 entry. Also inventory all core tables and extensions.

## Impact conclusion

Likely database impact from this attempt: **no persistent migration-061 change**, based on the exact order and transactional failure. This is not an unconditional no-impact claim: catalog verification is required because the UI transcript alone cannot prove what other statements, sessions or prior attempts may have done.
