# VAM OS Security Test Environment Plan

**Environment Name**: `vam-os-security-test`

## Objective
Provide a disposable, exact replica of the Production schema for safely testing RLS migrations (such as 057) without risking Production stability or destructively overwriting Staging.

## Build Plan (Non-Destructive)

1. **Create Project**: Provision a new Supabase project named `vam-os-security-test`.
   - **MUST** use new test-only API keys.
   - **MUST** use a new database password.
   - **MUST NOT** reuse production or staging secrets.
   - **MUST NOT** be connected to the production Vercel project.
2. **Replicate Schema**: 

   - Extract the production schema dump (`vam_prod_schema_only_20260617_134951.sql`).
   - Run this dump against the new project to exactly replicate all tables, columns, indexes, functions, policies, and roles.
3. **Data Population (No PII)**:
   - **MUST NOT** contain any production PII (emails, names, passwords).
   - Use **synthetic test data ONLY** to verify admin auth, registration, and check-in dependencies.
4. **Preserve Managed Schemas**:
   - Do not overwrite `auth`, `storage`, or `realtime` schemas. Use the default schemas provided by the new project, only importing custom roles or tables into `public`.
5. **Validation**:
   - Verify that an admin user can log in.
   - Verify the registration flow (when opened) behaves exactly as in production.
   - Verify check-in dependencies.

## Lifecycle
This environment is temporary and should be paused or destroyed once Phase 4 (RLS Remediation) is successfully tested and rolled out to Production.
