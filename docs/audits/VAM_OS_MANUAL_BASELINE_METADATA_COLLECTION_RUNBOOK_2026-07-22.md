# VAM OS Manual Baseline Metadata Collection Runbook — 2026-07-22

No execution is authorized by this document.

## Minimum owner workflow

1. Confirm the Supabase project UI shows production project `vam-os-mvp` and ref `qkkroesfiazsejkzflcd`.
2. Open the single-result probe file and independently verify it contains one `WITH ... SELECT`, catalog reads only, and output column `baseline_gap_metadata`.
3. Only after explicit owner read-only authorization, paste it once into the production SQL editor. Do not combine it with any other SQL.
4. Export the single JSON result locally. Do not commit it before a value-level PII/secret review.
5. Record project/ref, execution timestamp, probe SHA-256, JSON byte size, parse status, section counts, truncation status, and safety review.
6. Reconcile enums, views, sequences, types, comments, function definitions, extension ownership, and dependencies against repository sources. Keep every mismatch blocked.
7. Obtain a separate owner decision on the proposed staging RLS/grants target.

The combined probe replaces the three focused probes for the normal workflow. Focused probes remain review aids/fallbacks. It reads catalog metadata only, references no optional application relation, calls `pg_get_functiondef` only for `prokind IN ('f','p','w')`, and returns one JSONB cell. It must never be used to collect table rows, auth users, storage objects, vault contents, or secrets.

Collection does not authorize bootstrap, migration 061, seed, backfill, staging mutation, or production mutation.
