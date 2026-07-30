-- =============================================================================
-- DESIGN ONLY
-- STAGING ONLY
-- NOT AUTHORIZED
-- DO NOT EXECUTE
-- =============================================================================
-- VAM OS Admin Users Policy Expression Evidence Probe
-- Probe: VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_POLICY_EVIDENCE_PREFLIGHT_V3
-- Package: auth-emergency-admin-rls-staging-package
-- Prepared: 2026-07-29
--
-- Purpose:
--   The V2 staging preflight (run 2026-07-29) proved that the pre-existing
--   staging policy "active admins can read themselves" exists but did NOT
--   return its USING expression. Without the expression, it is unknown whether
--   that policy independently denies inactive, suspended, and invited admins.
--   Because PostgreSQL permissive SELECT policies combine with OR, a permissive
--   pre-existing policy whose USING clause lacks a status='active' restriction
--   would defeat the corrected "read_admin_users_super_admin_or_self" policy.
--
--   This probe retrieves the full USING expression of every SELECT policy on
--   public.admin_users via pg_get_expr(polqual, polrelid) on pg_policy, the
--   authoritative catalog table that stores expression trees. The result
--   provides evidence required before the emergency migration can be authorized.
--
-- Repository forensics result (2026-07-29):
--   "active admins can read themselves" does NOT appear in any migration file
--   (017, 018, 020, or any other). The policy was created directly on staging
--   outside the migration workflow. Its USING clause is unavailable from the
--   repository; this probe is the only way to obtain it.
--
-- MUTATION CHECK
-- Contains NO: INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP
--              GRANT REVOKE COPY CALL DO-block mutating-function-invocation
-- Catalog sources: pg_policy pg_class pg_namespace pg_get_expr()
-- Output: Exactly ONE row, ONE JSONB column named policy_evidence_result
-- PII exclusions: no email, no auth_user_id values, no raw row data, no tokens —
--                 policy USING expressions (schema definitions, not row data)
--                 are returned because proving their content is the probe's purpose
-- No production project reference — probe is environment-agnostic
-- =============================================================================

with

-- ---------------------------------------------------------------------------
-- P1: All SELECT and ALL policies on public.admin_users with full USING
--     expressions via pg_get_expr(polqual, polrelid).
--
--     pg_get_expr(expr_tree, relid) decompiles the stored internal expression
--     tree to readable SQL text. This is more authoritative than the derived
--     pg_policies.qual column for the purpose of proving exact expressions.
--
--     pg_policy.polcmd codes:
--       'r' = SELECT, 'a' = INSERT, 'w' = UPDATE, 'd' = DELETE, '*' = ALL
--     pg_policy.polpermissive:
--       true = PERMISSIVE, false = RESTRICTIVE
-- ---------------------------------------------------------------------------
p1 as (
  select
    pol.polname                                         as policyname,
    case pol.polcmd::text
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
      else pol.polcmd::text
    end                                                 as command,
    case pol.polpermissive
      when true then 'PERMISSIVE'
      else           'RESTRICTIVE'
    end                                                 as mode,
    pg_get_expr(pol.polqual,      pol.polrelid)         as using_expression,
    pg_get_expr(pol.polwithcheck, pol.polrelid)         as with_check_expression
  from pg_policy pol
  join pg_class     cls on cls.oid = pol.polrelid
  join pg_namespace ns  on ns.oid  = cls.relnamespace
  where ns.nspname  = 'public'
    and cls.relname = 'admin_users'
    and pol.polcmd::text in ('r', '*')
),

-- ---------------------------------------------------------------------------
-- P2: Derived status-restriction flags from the USING expression text.
--
--     has_active_status_restriction requires BOTH 'status' AND 'active' to
--     appear in the expression, matching patterns like:
--       status = 'active'              (direct column reference)
--       (status)::text = 'active'      (cast form, common in decompiled output)
--       status = 'active'::text        (text-cast literal)
--     A policy using is_active_admin() would NOT be caught here since
--     'status' is internal to that function — the flag would be false,
--     which is intentionally conservative (requires explicit evidence).
-- ---------------------------------------------------------------------------
p2 as (
  select
    policyname,
    command,
    mode,
    using_expression,
    with_check_expression,
    coalesce(using_expression like '%auth.uid()%', false) as references_auth_uid,
    coalesce(using_expression like '%status%',     false) as using_references_status,
    coalesce(using_expression like '%active%',     false) as using_references_active,
    (
      coalesce(using_expression like '%status%', false) and
      coalesce(using_expression like '%active%', false)
    )                                                     as has_active_status_restriction
  from p1
)

select jsonb_build_object(
  'probe_version',   'VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_POLICY_EVIDENCE_PREFLIGHT_V3',
  'executed_at',     now()::text,
  'target_database', current_database(),

  -- Full policy list with expressions — the primary evidence payload
  'admin_users_select_policies', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'policyname',                    policyname,
        'command',                       command,
        'mode',                          mode,
        'using_expression',              using_expression,
        'with_check_expression',         with_check_expression,
        'references_auth_uid',           references_auth_uid,
        'using_references_status',       using_references_status,
        'using_references_active',       using_references_active,
        'has_active_status_restriction', has_active_status_restriction
      ) order by policyname
    ), '[]'::jsonb)
    from p2
  ),

  -- Total SELECT/ALL policy count on admin_users
  'policy_count',
    (select count(*)::int from p2),

  -- Presence flags for the two known policies
  'expected_package_policy_present',
    (select exists(
      select 1 from p2
      where policyname = 'read_admin_users_super_admin_or_self'
    )),

  'pre_existing_policy_present',
    (select exists(
      select 1 from p2
      where policyname = 'active admins can read themselves'
    )),

  -- Key scalar: does the pre-existing policy have an active-status restriction?
  -- null = policy not present (pre_existing_policy_present = false)
  -- true  = both 'status' and 'active' appear in the USING expression
  -- false = USING expression lacks 'status' or 'active' — requires owner review
  'pre_existing_policy_has_active_status_restriction',
    (select
      (select has_active_status_restriction from p2
       where policyname = 'active admins can read themselves'
       limit 1)
    ),

  -- Names of any SELECT policies other than the two known policies.
  -- Populated list = unexpected policy requires owner review before migration.
  'unexpected_additional_select_policies',
    (select coalesce(
      (select jsonb_agg(policyname order by policyname)
       from p2
       where policyname not in (
         'read_admin_users_super_admin_or_self',
         'active admins can read themselves'
       )),
      '[]'::jsonb
    )),

  -- True only if every SELECT policy references both 'status' and 'active'.
  -- Expected: false until the migration adds the package policy.
  -- After migration: depends on whether pre-existing policy also includes status.
  'all_select_policies_have_active_status_restriction',
    (select not exists(
      select 1 from p2 where not has_active_status_restriction
    )),

  'summary', jsonb_build_object(
    'sections_present',            1,
    'read_only',                   true,
    'pii_excluded',                true,
    'policy_expressions_included', true
  )
) as policy_evidence_result;
