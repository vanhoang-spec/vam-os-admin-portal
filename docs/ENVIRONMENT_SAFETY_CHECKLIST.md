# PHASE F: Environment Safety System Checklist

This deployment checklist is mandatory for all infrastructure and code changes to ensure the protection and integrity of the production environment.

## 1. Environment Variable Verification
- [ ] **Production Supabase URL check**: Confirm the application is pointing to the correct production database instance, not staging.
- [ ] **Production anon key check**: Verify the public anonymous key is valid for production and restricted by RLS.
- [ ] **Production service role key check**: Ensure the powerful service role key is correct, properly encrypted in Vercel, and NEVER exposed to the client-side code.

## 2. Deployment Safeguards
- [ ] **Staging vs production guard**: Enforce a strict branching strategy. Only code merged into the `main` branch, after passing staging validation, may be deployed to production.
- [ ] **No db push to production**: Explicitly prohibit the use of destructive ORM commands (e.g., Prisma `db push` or raw DDL syncs) against the production database.
- [ ] **Controlled SQL rollout only**: All schema changes must be applied via version-controlled, reversible SQL migration scripts (e.g., `supabase migration up`).

## 3. Data Protection
- [ ] **No PII commit check**: Perform automated and manual reviews to ensure no Personally Identifiable Information (PII) or production database dumps are ever committed to the Git repository.

## 4. Post-Deployment Verification
- [ ] **Post-deploy QA checklist**: After a production rollout, conduct a controlled smoke test to verify authentication, core dashboard rendering, and standard read/write operations before announcing the release to the broader admin team.
