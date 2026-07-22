# VAM OS Production Inventory Input Safety Review

Date: 2026-07-22

## Input integrity

- Local input: `docs/audits/inputs/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_2026-07-22.json`
- Size: 1,527,203 bytes.
- SHA-256 is recorded in the sanitized manifest, not duplicated here.
- JSON parse: valid.
- Root: one production inventory object.
- Probe version: `vam-os-production-schema-inventory-single-result-v1`.
- All 18 expected sections are present.
- Truncation: not detected; the complete file parsed and section arrays are internally accessible.

## Section counts

| Section | Count |
|---|---:|
| tables | 90 |
| columns | 1,101 |
| indexes | 414 |
| schemas | 68 |
| policies | 17 |
| triggers | 25 |
| functions | 156 |
| aggregates | 2 |
| extensions | 6 |
| constraints | 307 |
| table_grants | 1,780 |
| function_grants | 450 |
| sequence_grants | 5 |
| table_estimates | 84 |
| migration_provenance | 1 |
| safety_counts | 1 |
| target_identity | 1 |

## Value-level PII and secret review

Recursive string-value scanning found:

- Actual email addresses: 0
- JWTs: 0
- API/service-role keys: 0
- Password assignments: 0
- OAuth client secrets: 0
- Access/refresh token values: 0
- Storage object paths: 0
- One phone-like pattern in `extensions.grant_pg_net_access` function-definition metadata.

Manual review of that finding identified an extension-managed SQL definition, not a phone value, person record or business row. The inventory includes sensitive **column names** and function text, but no actual PII/secret value was detected.

## Conclusion

Classification: **metadata only**. No raw auth identities, application answers, storage filenames, production business rows, PII values or secrets were found. The raw 1.5 MB inventory remains local and is intentionally excluded from Git. Only sanitized summaries are committed.
