# VAM OS Demo Readiness Safe Code Fixes — 2026-07-22

| Problem | Evidence | Change | Risk | Test | Rollback |
|---|---|---|---|---|---|
| Demo seed could write to any matching supplied project ref | Script compared CLI ref only with URL host | Permanent production-ref deny, exact staging-ref allowlist, separate authorization flag | Existing write command now needs one additional flag; intentionally fail-closed | static guard test; dry-run only | revert the single seed-hardening commit after owner review |
| Cleanup selected every person with an `@example.com` address | prior `.like("email_primary", "%@example.com")` query | scope cleanup to `source_sheets = DEMO_SEED` | old demo rows without tag will require manual review rather than deletion | static regression test | restore only after proving a safer ownership marker |

No UI, route set, authorization policy, environment variable, schema or migration changed. No seed/write mode was executed.
