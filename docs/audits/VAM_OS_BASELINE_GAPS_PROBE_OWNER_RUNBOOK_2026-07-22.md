# Baseline-Gaps Probe Owner Runbook — 2026-07-22

The merged probe is one `WITH ... SELECT`, produces one JSONB column `baseline_gap_metadata`, reads PostgreSQL catalogs only, calls `pg_get_functiondef` only for supported `prokind` values, and directly references no optional application relation. It collects enum labels/order, public types, exact views and dependencies, sequences/ownership, comments, and VAM/extension function provenance. It does not collect trigger rows separately; trigger provenance already exists in the complete inventory. No static defect requiring SQL change was found.

No execution is authorized here. After the owner separately issues `AUTHORIZE READ-ONLY PRODUCTION BASELINE-GAPS INVENTORY`, copy the reviewed file in PowerShell:

```powershell
Get-Content -Raw -LiteralPath '.\docs\audits\sql\VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql' | Set-Clipboard
```

In Supabase: verify project `vam-os-mvp` / `qkkroesfiazsejkzflcd`; open SQL Editor; create a new query; paste once; confirm it begins `WITH` and ends with one `SELECT baseline_gap_metadata FROM payload;`; run once; download/copy the single JSON cell locally; do not commit it before PII/secret/truncation review. Stop on any project mismatch, multiple statements, non-JSON result, error, or truncation.

Next owner action: **OWNER SHOULD RUN BASELINE-GAPS READ-ONLY PROBE**, but only after issuing the separate authorization phrase above.
