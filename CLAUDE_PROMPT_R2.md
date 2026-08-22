# R2 SERVER-SIDE QUERY REFACTORING - PLANNING PROMPT

You are Claude, the Senior Technical Architect for VAM OS.

Your task is to design R2 (Application List & Detail Query Refactoring) and output the full implementation plan to `CLAUDE_R2_PLAN.md`.

## CONTEXT
We are in Milestone 3 (S12 Core Operations Readiness).
R1 (Draft Recovery & Canonical Identity) is completely finished.
We now move to R2 to fix the data fetching bottlenecks identified during the R0 Benchmark.

## REQUIREMENTS
1. **R2A: Application List Bounded Query**
   - Refactor the list view (presumably `app/applications/page.tsx` and `lib/data.ts`) to stop over-fetching the entire season.
   - Implement server-side pagination (e.g., using `.range()`), search, and filtering so that the page only loads what it displays.
   - You must support fetching a total count so pagination works properly.

2. **R2B: Application Detail Targeted Queries**
   - Refactor `app/applications/[id]/page.tsx` and related data loaders.
   - Remove scope-wide scans (like `getPeople`, `getMenteeProfiles`, `getMentorProfiles`, `getMatches`) and the full-season authorization scan hidden in `getApplication`.
   - Replace them with targeted `.eq()`/`.in()` lookups.

3. **Constraints**
   - R0 harness guarantees must be maintained. Make sure `__tests__/support/fake-postgrest.ts` correctly handles `.range()`, `.ilike()` or text search, and `count: 'exact'` if your design requires them.
   - Ensure the updated queries are properly tested by the `m3-application-scale.bench.test.ts` baseline (which should show a significant reduction in bytes and round-trips compared to `m3-r0-before.json`).

## EXPECTED OUTPUT
Analyze the existing `app/applications/page.tsx`, `app/applications/[id]/page.tsx`, and `lib/data.ts`.
Output your complete plan to `CLAUDE_R2_PLAN.md` with:
- The specific files to modify and how to modify them.
- Any extensions needed for the `fake-postgrest.ts` mock.
- A clear strategy for the transition that won't break the existing S11 production context while fulfilling S12 ops readiness.

When you are done generating the plan, confirm your completion. Do NOT implement the code; Codex will implement it. Your output must strictly be the design plan `CLAUDE_R2_PLAN.md`.
