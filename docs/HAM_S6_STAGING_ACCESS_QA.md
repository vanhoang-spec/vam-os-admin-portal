# HAM-S6 Staging Access QA

## QA Date

2026-05-08

## Environment

- Environment: staging only
- Project ref: `ljfneyuvpxrmejpxsmpz`

## Scope Tested

- `superadmin.staging@vam.test`
- `admin.staging@vam.test`
- `viewer.staging@vam.test`

## Pages Checked

- `/people`
- `/mentors`
- `/mentees`
- `/matches`

## Browser QA Result

| Account scope | Result |
| --- | --- |
| Superadmin | Can see `HAM-S6-B1` and 52 active HAM-S6 matches. |
| Admin multi-scope | Can see UEHM-S11 and HAM-S6 data. |
| Viewer UEHM-only | Sees UEHM data only and does not see `HAM-S6-B1`, HAM matches, or HAM people. |

## Known Caveat

UEHM-S11 is currently attached to the legacy program row `VAM` in staging, while HAM-S6 is attached to `HAM`.

This does not block current isolation because access is gated by `season_id`.

Metadata cleanup should be handled later.

## Go/No-Go Decision

HAM-S6 foundation access isolation passed.

Do not proceed to HAM recaps/events until skipped matches and manual identities are reconciled or explicitly excluded.

## PII Check

This QA note contains no participant PII.
