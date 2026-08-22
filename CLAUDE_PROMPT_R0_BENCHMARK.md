# M3 R0 BENCHMARK STRATEGY - DEEP REVIEW REQUIRED

The previous approach to R0 involved rebuilding the database locally using `npx supabase start` and attempting to apply `supabase_migrations`. This approach failed because the VAM OS repository does not contain a full, authoritative schema dump. Core tables such as `matches` and `people` are missing from the SQL definitions, making it impossible to deterministically reconstruct the full database locally without error-prone mock tables.

We must define a NEW, minimalist strategy to achieve the R0 benchmark without reconstructing the unrelated VAM schema.

## REQUIREMENTS

1. **Benchmark Goal**: Measure the CURRENT data-access cost of the real application query paths (both List and Detail) before any optimization.
2. **Dataset**: Approximately 1,500 deterministic synthetic applications.
3. **No Production Mutation**: You CANNOT mutate Production under any circumstances.
4. **Before/After Contract**: We must be able to run the exact SAME benchmark before and after implementing R2A (server-side pagination for List) and R2B (targeted exact reads for Detail), to prove the performance improvement.
5. **No Migration Chain Dependency**: Do not make R0 depend on successfully applying historical migrations like `012` to `073`.

## DATA PATHS TO BENCHMARK
**Current List Page Data Path (`lib/data.ts`):**
- Function: `getApplicationsAdmin`
- Fetches all applications for a season without server-side pagination.
- Fetches all people for a season without server-side pagination.
- Performs client-side/memory join and mapping.
- Cost: Fetches the entire dataset into memory.

**Current Application Detail Data Path (`lib/data.ts`):**
- Function: `getApplicationDetailAdmin`
- Uses `Promise.all` to fetch the specific application...
- ...BUT currently over-fetches related data (e.g., all people, all profiles, all matches) to satisfy the join.
- Cost: Fetches massive unrelated datasets just to render a single application.

## YOUR TASK
Design the SMALLEST reliable benchmark strategy that fulfills these requirements.

Evaluate these options (or propose a better one):
1. Instrumented/mock Supabase client exercising the current `lib/data` query shape.
2. Deterministic synthetic repository fixtures.
3. Minimal isolated schema containing ONLY tables required for the application list/detail benchmark, running in an ephemeral local Postgres instance (bypassing `supabase_migrations` completely).
4. An existing safe non-Production environment (only if no mutation or real participant data risk is introduced).

Explicitly state why the chosen benchmark is sufficient to prove the R2 performance improvement.

## OUTPUT FORMAT

Produce exactly this output format:

CLAUDE_R0_BENCHMARK_REVIEW_FINAL

R0_STRATEGY=[Describe strategy]
WHY_AUTHORITATIVE_ENOUGH=[Explain why this proves R2 optimizations]
DATASET=[How to mock/generate the 1,500 apps]
LIST_METRICS=[What to measure for the list]
DETAIL_METRICS=[What to measure for the detail]
NO_PRODUCTION_MUTATION=[Confirm]
FILES_REQUIRED=[List of files to create/modify]
TEST_COMMAND=[Command to execute the benchmark]
BEFORE_AFTER_CONTRACT=[How it ensures comparability]
LIMITATIONS=[Any known limits]
