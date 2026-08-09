-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — APPLY TRANSACTION 2 of 4
-- T2: Day-1 security minimum — RLS enable + grant revocation (Phase 2)
--
-- Target : PRODUCTION only. T1 must have committed.
--
-- THE FINDING THIS REMEDIATES (P0)
--   Probe A shows RLS DISABLED on admin_users, applications, people,
--   mentor_profiles, mentee_profiles, intake_batches, person_season_memberships
--   and person_season_membership_log, together with broad anon/authenticated
--   table grants. With 902 applications, 656 mentee profiles, 450 mentor
--   profiles and the full people table, that is direct anonymous read access to
--   Day-1 PII with nothing but an unguessable-URL assumption in front of it.
--   The anon key is public by construction — it ships in the browser bundle.
--
-- WHY REVOKING IS SAFE — DERIVED, NOT ASSUMED
--   Every Day-1 path in the RC reaches Postgres through the SERVICE-ROLE
--   client, which is BYPASSRLS. Verified module by module at HEAD 24556ad:
--     * public Mentor/Mentee submission  — app/actions/apply.ts calls
--       lib/applications-create.ts, which uses getSupabaseServiceRoleClient()
--       and fails closed when it is absent. The public forms are server
--       actions; the browser never talks to PostgREST.
--     * review / approval / person / profile / decision / audit
--       — lib/application-{approvals,decisions,reviews}.ts, lib/people-create.ts:
--       service role throughout.
--     * membership lifecycle — app/actions/membership-lifecycle.ts: service role.
--     * admin identity resolution — lib/admin-auth.ts:
--       findAdminUserForAuthUser() explicitly requires the service-role client
--       and THROWS without it; the anon client is used only for auth.getUser(),
--       which touches the auth schema, not these tables.
--     * lib/data.ts dataClient() prefers the service-role client and returns
--       null outright for server-only application tables.
--   The only browser-side Supabase client in the app (app/reset-password) is
--   auth-only. No client component queries a public table.
--
-- WHY NO POLICIES ARE CREATED — FAIL CLOSED
--   Phase 2 says do not blindly enable RLS without proving required policies.
--   The inverse also holds: do not create policies no Day-1 path requires. No
--   Day-1 read or write uses the anon or authenticated role against these
--   tables, so the narrowest safe remediation is RLS enabled with NO policies
--   and NO grants. Anything reaching these tables as anon or authenticated
--   after T2 is by definition not a Day-1 path, and it will fail loudly.
--   Any future authenticated read path must ship its own policy AND its own
--   grant, reviewed on its own merits.
--
-- SCOPE DISCIPLINE
--   Ten tables. Exactly the Day-1 set. Unrelated legacy drift elsewhere in the
--   database is deliberately left alone.
-- =============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── Section 0. Guards ───────────────────────────────────────────────────────
do $t2_guard$
declare
  v_txt text;
  v_rls_off constant text[] := array[
    'admin_users','applications','people','mentor_profiles','mentee_profiles',
    'intake_batches','person_season_memberships','person_season_membership_log'
  ];
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'T2 ABORTED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  -- T1 must be in place; the transactions are ordered for a reason.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.admin_audit_log'::regclass
                    and conname = 'admin_audit_log_action_type_check') then
    raise exception 'T2 ABORTED [T1_NOT_APPLIED]: run T1 first.';
  end if;

  -- The baseline T2's rollback is written against.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_rls_off) x join pg_class c on c.oid = to_regclass('public.' || x)
  where c.relrowsecurity;
  if v_txt is not null then
    raise exception 'T2 ABORTED [RLS_BASELINE]: RLS already enabled on %. Rollback would restore the wrong state.', v_txt;
  end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname) into v_txt
  from pg_policies p where p.schemaname = 'public' and p.tablename = any (v_rls_off);
  if v_txt is not null then
    raise exception 'T2 ABORTED [UNEXPECTED_POLICY]: % already carry policies; T2 enables RLS with none by design.', v_txt;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'T2 ABORTED [SERVICE_ROLE_BYPASSRLS]: service_role lacks BYPASSRLS; enabling RLS would break every Day-1 write path.';
  end if;
end
$t2_guard$;

-- ── Section 1. Pre-state capture (this is what makes T2 reversible) ─────────
-- Captures RLS flags, the raw ACL, and the exact (grantee, privilege, grantable)
-- triples for anon / authenticated / PUBLIC, so rollback restores what was
-- actually there rather than a guess at what "normal" looks like.
create table public.vam_prod_s12_release_state (
  table_name       text primary key,
  rls_was_enabled  boolean not null,
  rls_was_forced   boolean not null,
  prior_relacl     text,
  prior_grants     jsonb   not null default '[]'::jsonb,
  package_version  text    not null check (package_version = 'VAM_PROD_S12_R1'),
  recorded_at      timestamptz not null default transaction_timestamp()
);

insert into public.vam_prod_s12_release_state
  (table_name, rls_was_enabled, rls_was_forced, prior_relacl, prior_grants, package_version)
select
  c.relname,
  c.relrowsecurity,
  c.relforcerowsecurity,
  c.relacl::text,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'grantee', g.grantee,
             'privilege_type', g.privilege_type,
             'is_grantable', g.is_grantable)
           order by g.grantee, g.privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee in ('anon','authenticated','PUBLIC')
  ), '[]'::jsonb),
  'VAM_PROD_S12_R1'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'applications','people','mentor_profiles','mentee_profiles',
    'admin_users','intake_batches','person_season_memberships',
    'person_season_membership_log','admin_audit_log','application_decisions'
  );

do $t2_capture$
declare v_n integer;
begin
  select count(*) into v_n from public.vam_prod_s12_release_state;
  if v_n <> 10 then
    raise exception 'T2 ABORTED [CAPTURE_INCOMPLETE]: captured % of 10 tables', v_n;
  end if;
end
$t2_capture$;

-- The state table itself must never be readable by an API role.
revoke all on public.vam_prod_s12_release_state from public, anon, authenticated;

-- ── Section 2. Enable RLS on the eight unprotected Day-1 tables ─────────────
-- admin_audit_log and application_decisions already have RLS enabled
-- (Probe A) and are deliberately not touched here — they appear only in the
-- grant section below. FORCE ROW LEVEL SECURITY is NOT set: the owner and
-- service_role must keep working, which is the entire Day-1 write path.
alter table public.admin_users                   enable row level security;
alter table public.applications                  enable row level security;
alter table public.people                        enable row level security;
alter table public.mentor_profiles               enable row level security;
alter table public.mentee_profiles               enable row level security;
alter table public.intake_batches                enable row level security;
alter table public.person_season_memberships     enable row level security;
alter table public.person_season_membership_log  enable row level security;

-- ── Section 3. Grant revocation on all ten Day-1 tables ─────────────────────
-- Revoked from anon, authenticated AND PUBLIC. PUBLIC is included because a
-- privilege held via PUBLIC survives a revoke aimed only at the two named API
-- roles, which would leave the table readable by exactly the role this
-- remediation exists to shut out.
revoke all on
  public.applications,
  public.people,
  public.mentor_profiles,
  public.mentee_profiles,
  public.admin_users,
  public.intake_batches,
  public.person_season_memberships,
  public.person_season_membership_log,
  public.admin_audit_log,
  public.application_decisions
from public, anon, authenticated;

-- ── Section 4. Post-conditions ──────────────────────────────────────────────
do $t2_post$
declare
  v_txt text;
  v_t   text;
  v_p   text;
  v_targets constant text[] := array[
    'applications','people','mentor_profiles','mentee_profiles','admin_users',
    'intake_batches','person_season_memberships','person_season_membership_log',
    'admin_audit_log','application_decisions'
  ];
begin
  -- 4a. No privilege of any kind may remain for anon, authenticated or PUBLIC.
  select string_agg(g.table_name || '/' || g.grantee || '/' || g.privilege_type, ', '
                    order by g.table_name, g.grantee, g.privilege_type)
    into v_txt
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name = any (v_targets)
    and g.grantee in ('anon','authenticated','PUBLIC');
  if v_txt is not null then
    raise exception 'T2 ABORTED [GRANTS_REMAIN]: %', v_txt;
  end if;

  -- 4b. RLS must now be on for all ten.
  select string_agg(c.relname, ', ' order by c.relname) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (v_targets) and not c.relrowsecurity;
  if v_txt is not null then
    raise exception 'T2 ABORTED [RLS_NOT_ENABLED]: %', v_txt;
  end if;

  -- 4c. FORCE RLS must remain off, or the owner locks itself out.
  select string_agg(c.relname, ', ' order by c.relname) into v_txt
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (v_targets) and c.relforcerowsecurity;
  if v_txt is not null then
    raise exception 'T2 ABORTED [RLS_FORCED]: %', v_txt;
  end if;

  -- 4d. service_role must retain full table access. If any of its access came
  -- via PUBLIC, section 3 just removed it and Day-1 would break at launch —
  -- so this aborts the whole transaction rather than discovering it live.
  foreach v_t in array v_targets loop
    foreach v_p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', 'public.' || v_t, v_p) then
        raise exception 'T2 ABORTED [SERVICE_ROLE_LOST_%]: service_role can no longer % on public.%. The revoke removed a privilege it held through PUBLIC.', v_p, v_p, v_t;
      end if;
    end loop;
  end loop;

  -- 4e. Still no policies. RLS with no policy is the fail-closed state T2 wants.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_txt
  from pg_policies p where p.schemaname = 'public' and p.tablename = any (v_targets)
    and p.tablename in ('applications','people','mentor_profiles','mentee_profiles',
                        'admin_users','intake_batches','person_season_memberships',
                        'person_season_membership_log');
  if v_txt is not null then
    raise exception 'T2 ABORTED [POLICY_APPEARED]: %', v_txt;
  end if;
end
$t2_post$;

notify pgrst, 'reload schema';

commit;
