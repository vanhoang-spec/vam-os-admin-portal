# VAM OS Production Baseline-Gaps Input Safety Review — 2026-07-22

Raw input: `docs/audits/inputs/VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json`

Exact size: 180,915 bytes
Raw file commit decision: **DO NOT COMMIT**

| Check | Result | Sanitized evidence |
|---|---|---|
| Valid JSON | PASS | Offline parse succeeded |
| Expected probe version | PASS | `vam-os-baseline-gaps-single-result-v1` |
| Expected sections | PASS | No missing or unexpected top-level keys |
| No truncation | PASS | Full JSON parse; all sections typed/present |
| No business rows | PASS | Catalog metadata structure only |
| No emails/phones | PASS | Scanner hit counts: 0 / 0 |
| No tokens/secrets/passwords | PASS | JWT, secret/password, bearer hit counts: 0 |
| No connection strings | PASS | Hit count: 0 |
| No Auth users | PASS | No identity/business row section |
| No storage objects | PASS | No storage-object row section; dependency schema names only |
| Metadata-only | PASS | Catalog definitions/provenance only |
| Safe for offline analysis | PASS | Parser decision YES |

Section counts: enums 51; public types 62; views 3; view dependencies 3; sequences 0; broadly collected dependency rows 441; functions 58; triggers 20; comments 22.

The 441 dependency rows contain platform/internal schema names but no business or secret values. They are excluded from sequence DDL and do not authorize platform-schema cloning.
