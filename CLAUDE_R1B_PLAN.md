# CLAUDE_R1B_PLAN_FINAL

## Goal
Implement Canonical Applicant Identity duplicate protection (R1B) backed by the database.

## Problem
The current deduplication in `applications-create.ts` relies on an application-level `SELECT` query, which is vulnerable to race conditions (e.g. double-click submissions bypassing the check). It also checks duplicates at the `intake_batch_id` level rather than `season_id`, and it does not check the `mssv` field for mentees.
The business requirement mandates that an applicant can only apply once per season per role, identified by either their `email` or their `mssv` (for mentees).

## User Review Required
> [!IMPORTANT]
> The deduplication scope will be expanded from `intake_batch_id` to `season_id`. If multiple intake batches exist for a single season, an applicant will NOT be able to apply to the second batch if they already applied to the first batch. This aligns with the requirement "season + mentee role".
> We are using Postgres partial unique indexes on `raw_payload->>'mssv'` to enforce the MSSV constraint.

## Proposed Changes

### Database Migration

#### [NEW] `supabase_migrations/076_canonical_applicant_identity.sql`
Creates two DB-backed unique constraints using `UNIQUE INDEX`.
```sql
-- 1. Unique constraint for Email (across all roles, scoped by season)
CREATE UNIQUE INDEX canonical_identity_email_idx 
ON public.applications (season_id, role_applied, lower(email_primary));

-- 2. Unique constraint for MSSV (Mentee role only, scoped by season)
-- Using a partial index so that it only evaluates when mssv is present.
CREATE UNIQUE INDEX canonical_identity_mssv_idx 
ON public.applications (season_id, role_applied, lower(raw_payload->>'mssv'))
WHERE role_applied = 'mentee' AND (raw_payload->>'mssv') IS NOT NULL AND (raw_payload->>'mssv') != '';
```

### Application Logic

#### [MODIFY] `lib/applications-create.ts`
1. Update the manual `SELECT` duplicate check to query by `season_id` instead of `intake_batch_id` and include the `mssv` OR condition. This allows us to return a friendly frontend validation error before attempting the `INSERT`.
```typescript
  let mssv = input.role === "mentee" ? input.rawPayload["mssv"] : null;
  mssv = typeof mssv === "string" && mssv.trim() !== "" ? mssv.trim().toLowerCase() : null;

  // Manual pre-check for friendly error (fallback is still DB constraints)
  let dupQuery = client
    .from("applications")
    .select("id")
    .eq("season_id", seasonRow.id)
    .eq("role_applied", input.role);

  if (mssv) {
    dupQuery = dupQuery.or(`email_primary.ilike.${emailPrimary},raw_payload->>mssv.ilike.${mssv}`);
  } else {
    dupQuery = dupQuery.ilike("email_primary", emailPrimary);
  }

  const { data: dupRow, error: dupErr } = await dupQuery.limit(1).maybeSingle();
```
2. Handle the PostgreSQL Unique Violation error (`23505`) on the `INSERT` operation. If the DB enforces the constraint (e.g. in a race condition), we should catch it and return the same `duplicate` error state.

### Tests

#### [MODIFY] `__tests__/applications-create.test.ts` (or create new test)
Add tests to verify:
1. Re-submission with the same email returns a `duplicate` error.
2. Re-submission with a different email but the same `mssv` (for mentees) returns a `duplicate` error.
3. Database `INSERT` race conditions (mocked DB throwing `23505`) map correctly to a generic `duplicate` response instead of a crash.

## Verification Plan
### Automated Tests
- Run `vitest run` on the create applications suite.
- Ensure the DB-backed unique constraint translates to the expected `ApplyActionState`.

### Manual Verification
- Deploy migration and use the Mentee form to submit two applications with different emails but the same MSSV. Ensure the second submission is rejected with a generic duplicate error.
