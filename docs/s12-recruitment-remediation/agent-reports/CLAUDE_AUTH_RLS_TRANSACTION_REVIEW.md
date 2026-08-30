# Claude narrow authorization/RLS/transaction review

Date: 2026-08-30. Read-only review; restricted to M090 migration and authorization/decision paths.

## Findings and disposition

- P0: legacy `request.jwt.claim.role` GUC would fail closed on modern PostgREST. **Fixed:** RPC trust checks now use the effective database role (`current_user = 'service_role'`).
- P0: manual `interview_completed` decision was unreachable after atomic submission moved the application to `ready_for_final_decision`. **Fixed:** removed the dead manual decision; interview submission remains the canonical transition.
- P1: an in-scope operator could submit a review assigned to another participant at the SQL layer. **Fixed:** the RPC now requires actor equals assigned reviewer and exact season/stage participation for all platform roles.
- P1: scores/recommendations lacked database validation. **Fixed:** score range and supported recommendation validation added before write.
- P1: optimistic concurrency was optional for RPC callers. **Fixed:** every requested ID must have an expected-status entry.
- P2: partial unique index admitted NULL status. **Fixed:** predicate changed to `status is distinct from 'cancelled'`.
- P1 retained release check: the server action binds `p_auth_user_id` to the email returned by Supabase Auth Admin before calling the grant RPC. This requires integration verification on staging; the database function itself does not query `auth.users`.
- P2 retained operational concern: overlapping bulk transactions may deadlock and should be retried if PostgreSQL returns `40P01`.

Claude acceptance before disposition: reviewer A/B isolation PASS; exact season/stage PASS; cancel/reassign atomic audit PASS; function grants/RLS lockdown PASS; service-role and manual interview-completion checks FAIL. The two failures were corrected in the same review cycle and must be verified by tests/staging before release.
