-- REVIEW-ONLY test specification. Execute through separate anon/authenticated JWT clients, never service_role.
-- Expected: anon SELECT denied on all five target tables and both import tables.
-- Expected: mentor/mentee Auth JWT denied on admin_users/admin_scope_access/admin_audit_log.
-- Expected: reviewer/interviewer JWT denied direct people/membership reads unless a later assignment-scoped policy is explicitly approved.
-- Expected: Program Admin/operations JWT reads people/memberships only where active admin_scope_access matches program and optional season.
-- Expected: Super Admin JWT reads across UEH and HAM.
-- Negative mutations: authenticated clients cannot INSERT/UPDATE/DELETE any target table; writes remain guarded server/service-role paths.
-- IMPORTANT: service_role bypasses RLS and is excluded from isolation assertions.
select 'Use distinct synthetic anon, super_admin, UEH operator, HAM operator, reviewer, interviewer, mentor and mentee JWT fixtures.' as test_instruction;
