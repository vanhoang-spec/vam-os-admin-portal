# HAM-S6 Strict Recap Pilot Import Result

## Environment

- Environment: staging only
- Project ref: `ljfneyuvpxrmejpxsmpz`

## Execution Result

- Script executed: `data_imports/ham/scripts/ham_s6_04_import_strict_recap_pilot_DRAFT.sql`
- Transaction committed successfully.

## Imported

| Metric | Count |
| --- | ---: |
| Strict pilot recap rows | 29 |

## Excluded

| Reason | Count |
| --- | ---: |
| `source_not_import_ready_or_issue_flagged` | 48 |
| `unresolved_or_manual_review_identity` | 35 |
| `duplicate_risk_row` | 6 |
| `not_linked_to_imported_ham_s6_match` | 3 |
| Total excluded | 92 |

## Safety Verification

| Check | Result |
| --- | --- |
| `non_ham_or_missing_match_rows` | 0 |
| Imported rows linked only to active HAM-S6 matches | Passed |
| Events/group activities imported | 0 |
| Production touched | No |
| RLS changes | No |

## Decision

HAM-S6 strict recap pilot import passed on staging.

Do not broaden the recap import until excluded rows are reviewed.

Do not import events/group activities until activity semantics are approved.

## PII Check

This report contains no names, emails, phones, URLs, raw notes, or participant PII.
