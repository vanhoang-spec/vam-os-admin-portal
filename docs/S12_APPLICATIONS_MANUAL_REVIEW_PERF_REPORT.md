# S12 Applications Manual Review Performance Hotfix Report

## ROOT CAUSE
The `/applications` and `/applications/[id]` pages currently suffer from severe performance degradation due to over-fetching (global scoped reads).
1. **Applications List (`/applications`)**: Fetches ALL scoped applications, ALL scoped people, ALL scoped seasons, and ALL intake batches globally into memory before doing client-side mapping and filtering. This scales linearly with the total number of applications and people in the database.
2. **Application Detail (`/applications/[id]`)**: Similarly fetches the entire scoped populations for `people`, `mentee_profiles`, `mentor_profiles`, and `matches` just to render a single application's details. Additionally, the `getApplication(id, scope)` function internally re-fetches ALL scoped applications simply to verify that the requested ID is within the authorized scope list, resulting in an `O(N)` authorization check where `N` is the total number of applications.

## BEFORE PROFILE

### LIST (`/applications`)
- **DB calls / logical reads**: 4+ concurrent chunked table reads (`applications`, `people`, `seasons`, `intake_batches`), plus internal scope resolution queries.
- **Populations loaded**: Global scoped sets. All Applications (1000s), All People (1000s).
- **Rows/payload**: High. All applications and people returned by DB to Node.js server. Memory intensive.

### DETAIL (`/applications/[id]`)
- **DB calls / logical reads**: 10 concurrent requests (`application`, `people`, `seasons`, `mentees`, `mentors`, `matches`, `answers`, `reviews`, `reviewers`, `decisions`), plus internal scope reads.
- **Populations loaded**: Global scoped sets for `applications` (inside auth check), `people`, `mentor_profiles`, `mentee_profiles`, `matches`.
- **Rows/payload**: High. Entire populations fetched to extract a single `person_id`.

## IMPLEMENTATION
- Created a new bounded server-side page at `/applications/mentor-review` specifically for the operational queue (Mentor S12, submitted status).
- Implemented `getMentorReviewQueue` in `lib/data.ts` using `query.range()` for database-level pagination, bounded to 25 items.
- Extracted IDs from the 25 items and only fetched the related `Person`, `Season`, and `IntakeBatch` profiles for those 25 items.
- Added Next/Previous navigation buttons within the application detail page (`/applications/[id]`) that hook into the active queue state.
- Refactored `getApplication` and `ApplicationDetailPage` to avoid over-fetching by targeting queries specifically with the applicant's `personId` rather than fetching all populations in scope.
- Kept authorization constraints intact by re-using the existing scoped filter verification locally on the application row.

## AFTER PROFILE

### LIST (`/applications/mentor-review`)
- **DB calls / logical reads**: 1 call for 25 applications, plus 1 targeted fetch for `people` (IN clause with up to 25 IDs).
- **Populations loaded**: Bounded (25 items max per page).
- **Rows/payload**: Extremely small. Performance scales linearly with the constant page size (25) rather than the global dataset.

### DETAIL (`/applications/[id]`)
- **DB calls / logical reads**: Fetches application, then conditionally fetches exactly 1 row from `people`, `mentees`, `mentors`, and `matches` based on the targeted `personId`.
- **Populations loaded**: 1 record per population.
- **Rows/payload**: Reduced by ~99% compared to the BEFORE state. Memory footprint is minimal.
- **Added UX**: Next/Prev navigation operates securely without expanding memory footprint.

## QA AND SECURITY
- Checked for cross-season/cross-program leak: All DB fetches still respect `getAdminScopeContext()` boundaries.
- No new DB views or indexes were needed; the `applications` read filtering and pagination is fast enough natively.
- No schema migrations used. Production untouched.
- `Approve & Next` was omitted as simple `Next/Prev` buttons fulfilled the operational hotfix without inventing a new approval state machine.
