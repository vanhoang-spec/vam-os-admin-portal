# Claude R2 Plan (CLAUDE_R2_PLAN_FINAL)

## Architectural Intent
The current detail bottleneck isn't just the four scope-wide loaders: `getApplication` authorizes one row by re-scanning the season (`lib/data.ts:784-787`), and `getApplicationReviewsForApplication` + `getApplicationDecisions` each call it again — **three full-season scans per detail render**, plus `getScopedPersonIds`' 5-table fan-out running three times. The list coalesces identity across `applications` and `people`. Server-side `ilike` on `applications` alone would make every S11 applicant unsearchable by name.

## Design

### R2A (List)
- **Migration 078**: adds read-only `application_list_v1` (COALESCE identity/status/consent + `search_blob` + `batch_season_id` so the scope predicate costs zero extra requests) and a facet view.
- **Data Access**: new `lib/applications-list.ts` issues one `.range()` + `count: 'exact'`.
- **UI**: new server-driven filter bar/pager; `components/filterable-table.tsx` untouched.

### R2B (Detail)
- **Authorization**: `getApplication` authorization becomes a row predicate (equivalence proven term-by-term against the `or()` filter).
- **Data Access**: new `lib/application-detail.ts` runs ~10 targeted `.eq()` reads in three waves.
- **Redundancy**: scope-wide loaders removed under a documented authorization-by-association proof.

### Security
- `sanitizeIlikePattern` (user input reaches a PostgREST filter string unquoted).
- `pageSize` clamping (an unclamped value hits the silent 1000-row cap).
- `security_invoker`/grants on the views.
- Guard preserved: the view is **not** added to `SERVER_ONLY_APPLICATION_TABLES` (freeze checked in `__tests__/migration-059-final-prerequisites.test.ts:409-434`).

### Harness
- Fake needs `ilike`, `or()` ilike/quoted terms, `nullsFirst`, count/head recording, `assertNoSilentCap`. 
- The fixture has a real bug — applications/matches use `batch_id` where the schema says `intake_batch_id`. The plan mandates regenerating `m3-r0-before.json` on harness v2 in a commit containing no `lib/`/`app/` diff, before any refactoring.
