# VAM OS Production Baseline-Gaps Owner Runbook — 2026-07-22

Decision: **BASELINE-GAPS PROBE READY FOR OWNER EXECUTION**.

Approved probe: `docs/audits/sql/VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql`. It is one catalog-only `WITH ... SELECT`, returns one row with one JSONB column named `baseline_gap_metadata`, reads no application/business rows, and performs no mutation.

## Owner execution steps

1. Open the production Supabase project **vam-os-mvp**.
2. Confirm the project ref is exactly **qkkroesfiazsejkzflcd**. Stop on any mismatch.
3. Open **SQL Editor** and create one new query.
4. Paste only the complete approved probe file. Do not add transaction commands, diagnostics, or another statement.
5. Verify the first executable line is `WITH` and the last line is `SELECT baseline_gap_metadata FROM payload;`.
6. Run once.
7. Confirm there is exactly one row and one column, then export/copy only the single JSON result.
8. Save it locally as `docs/audits/inputs/VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json`.
9. Do not commit the raw JSON. It is ignored by Git until a separate safety review decides otherwise.
10. Do not run any other SQL. Stop on errors, multiple rows/columns, invalid JSON, apparent truncation, business data, PII, or secrets.

## PowerShell validation (offline only)

Run from the repository root after saving the file. These commands do not connect to Supabase and do not print data values.

```powershell
$probeInput = '.\docs\audits\inputs\VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json'
Test-Path -LiteralPath $probeInput
(Get-Item -LiteralPath $probeInput).Length
$probeJson = Get-Content -Raw -LiteralPath $probeInput | ConvertFrom-Json
$probeJson.PSObject.Properties.Name | Sort-Object
$expected = 'comments','enums','functions','probe_version','public_types','sequence_ownership','sequences','triggers','view_dependencies','views'
Compare-Object $expected ($probeJson.PSObject.Properties.Name | Sort-Object)
$probeJson.probe_version -eq 'vam-os-baseline-gaps-single-result-v1'
$sections = 'enums','public_types','views','view_dependencies','sequences','sequence_ownership','functions','triggers','comments'
$sections | ForEach-Object { [pscustomobject]@{ Section = $_; Present = $null -ne $probeJson.$_; Count = @($probeJson.$_).Count } }
try { Get-Content -Raw -LiteralPath $probeInput | ConvertFrom-Json -ErrorAction Stop | Out-Null; 'JSON_PARSE=PASS' } catch { 'JSON_PARSE=FAIL_OR_TRUNCATED' }
```

Do not paste raw output into chat or tickets. After these structural checks, run the offline parser only when the owner has supplied the file:

```powershell
node .\scripts\parse_baseline_gaps_offline.mjs
```

The parser reports counts and pattern-hit totals only; it never prints matching values and never connects to a database.
