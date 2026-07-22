# VAM OS Production Baseline-Gaps Input Safety Review Template — 2026-07-22

Raw input: `docs/audits/inputs/VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json`

Reviewer: __________  Date/time: __________  File size: __________

| Check | PASS / FAIL / REVIEW | Evidence without raw values |
|---|---|---|
| Valid JSON | | |
| Expected probe version | | |
| Expected sections present | | |
| No truncation indicator or parse failure | | |
| One metadata object; no business rows | | |
| No emails or phone numbers | | |
| No tokens, secrets, API keys, or passwords | | |
| No connection strings or credential-bearing URLs | | |
| No Auth users or identity records | | |
| No storage objects or object paths | | |
| Catalog metadata only | | |
| Safe to analyze offline | | |

Expected sections: `enums`, `public_types`, `views`, `view_dependencies`, `sequences`, `sequence_ownership`, `functions`, `triggers`, and `comments`, plus `probe_version`.

Offline parser result: __________  Missing sections: __________  Suspicious-pattern hit counts: __________

Raw file commit decision: **DO NOT COMMIT / APPROVE AFTER SEPARATE REVIEW** (circle one). Default is **DO NOT COMMIT**. A PASS permits offline analysis, not publication or a database write.
