-- VAM062_V3 — account-admin / auth-operation / CSV-import foundation.
-- Supersedes the VAM062_V5-labeled review-only draft reviewed against live
-- staging evidence captured 2026-08-02. Fixes CONFLICT-01/02/03/06/07/08 and
-- implements DEC-01..DEC-05, DEC-09, DEC-10. Internal object/state markers
-- keep the VAM062_V5 package_version literal so rollback state captured
-- under the prior draft (if ever partially applied — it is not, per staging
-- evidence) remains addressable; this migration itself was never applied.
begin;

do $$
declare v_missing text; v_unexpected text;
begin
  select string_agg(x,', ') into v_missing from unnest(array[
    'public.admin_users','public.admin_scope_access','public.admin_audit_log','public.people','public.programs','public.seasons','public.intake_batches','public.person_season_memberships','public.person_season_membership_log'
  ]) x where to_regclass(x) is null;
  if v_missing is not null then raise exception 'VAM062V3 prerequisite tables missing: %',v_missing; end if;

  if to_regnamespace('auth') is null or to_regprocedure('gen_random_uuid()') is null then raise exception 'VAM062V3 required schema/function missing'; end if;
  if to_regprocedure('public.current_admin_role()') is null or to_regprocedure('public.is_active_admin()') is null then raise exception 'VAM062V3 admin helpers missing'; end if;

  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth')
      and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','programs','seasons','intake_batches','person_season_memberships','person_season_membership_log')
      and pg_get_userbyid(c.relowner)<>current_user
  ) then raise exception 'VAM062V3 ownership mismatch'; end if;

  if exists(
    select 1 from information_schema.columns c
    where c.table_schema='public'
      and ((c.table_name='admin_users' and c.column_name in ('id','auth_user_id') and c.udt_name<>'uuid')
        or (c.table_name='person_season_memberships' and c.column_name in ('id','person_id','program_id','season_id','intake_batch_id') and c.udt_name<>'uuid')
        or c.is_identity='YES' or c.is_generated<>'NEVER')
  ) then raise exception 'VAM062V3 column type or generation mismatch'; end if;

  -- FK guards: seasons->programs guard is unchanged from the reviewed draft
  -- (it already matches live staging: NO ACTION, no ON DELETE clause). The
  -- intake_batches->seasons guard is corrected (CONFLICT-02): live staging
  -- and migration 036 both carry ON DELETE RESTRICT; the prior draft's guard
  -- required no clause at all and could never pass. Neither FK is altered.
  if not exists(select 1 from pg_constraint where conrelid='public.seasons'::regclass and contype='f' and pg_get_constraintdef(oid)='FOREIGN KEY (program_id) REFERENCES programs(id)') then
    raise exception 'VAM062V3 season-program relationship mismatch';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.intake_batches'::regclass and contype='f' and pg_get_constraintdef(oid)='FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT') then
    raise exception 'VAM062V3 batch-season relationship mismatch';
  end if;

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('current_admin_role','is_active_admin')
      and (p.prosecdef is false or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>current_user)
  ) then raise exception 'VAM062V3 helper definition or ownership mismatch'; end if;

  if has_function_privilege('anon','public.current_admin_role()','execute') or not has_function_privilege('authenticated','public.current_admin_role()','execute') then
    raise exception 'VAM062V3 helper privilege mismatch';
  end if;

  if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='admin_users' and c.column_name in ('id','auth_user_id','email','full_name','role','status') having count(*)<>6) then
    raise exception 'VAM062V3 admin_users columns incompatible';
  end if;
  if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='person_season_memberships' and c.column_name in ('id','person_id','program_id','season_id','intake_batch_id','role','status','source','created_by') having count(*)<>9) then
    raise exception 'VAM062V3 membership columns incompatible';
  end if;

  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('account_rls_package_state','account_rls_package_manifest','account_import_batches','account_import_outcomes','account_auth_reconciliation','account_auth_operations','account_person_auth_links','account_import_previews')
  ) then raise exception 'VAM062V3 package table name collision'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%') then
    raise exception 'VAM062V3 package function name collision';
  end if;

  -- No unexpected pre-existing policy on any table this package will alter,
  -- including the two newly-hardened tables (intake_batches,
  -- person_season_membership_log) which previously had none at all. The
  -- four tuples below are the exact, structurally-validated pre-existing
  -- policy shapes live staging carries as of the 2026-08-02 05:30Z schema
  -- evidence capture: three long-standing admin-RLS policies, plus the
  -- out-of-band emergency hardening policy "active admins can read
  -- themselves" applied directly to staging on 2026-06-17 (see
  -- docs/VAM_OS_PROD_STAGING_SCHEMA_DIFF_2026-06-17.md) — safe and
  -- redundant with read_admin_users_super_admin_or_self's self-read branch,
  -- never widening access. read_admin_users_super_admin_or_self's qual
  -- below reflects a subsequent hardening (status='active' added to its
  -- self-read branch) this guard previously did not account for. Both
  -- admin_users policies are accepted and preserved as-is: this migration
  -- only ever ADDs vam062_-prefixed policies alongside them (below), never
  -- drops or rewrites a pre-existing one. Every tuple is matched
  -- structurally on name+table+permissive+roles+cmd+qual+with_check — this
  -- is not a policy-count check — so any policy not matching one of these
  -- four exactly, known-safe or not, still falls into v_unexpected and
  -- fails the migration closed below.
  select string_agg(tablename||'.'||policyname,', ') into v_unexpected
  from pg_policies
  where schemaname='public'
    and tablename in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','intake_batches','person_season_membership_log')
    and not (
      tablename='admin_users' and policyname='read_admin_users_super_admin_or_self' and permissive='PERMISSIVE' and roles::text[]=array['public']::text[] and cmd='SELECT' and with_check is null and qual='(((auth.uid() = auth_user_id) AND (status = ''active''::text)) OR (current_admin_role() = ''super_admin''::text))' or
      tablename='admin_users' and policyname='active admins can read themselves' and permissive='PERMISSIVE' and roles::text[]=array['authenticated']::text[] and cmd='SELECT' and with_check is null and qual='((auth_user_id = auth.uid()) AND (status = ''active''::text))' or
      tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin' and permissive='PERMISSIVE' and roles::text[]=array['public']::text[] and cmd='SELECT' and with_check is null and qual='((current_admin_role() = ''super_admin''::text) OR (is_active_admin() AND (user_id = auth.uid()) AND (status = ''active''::text)))' or
      tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only' and permissive='PERMISSIVE' and roles::text[]=array['public']::text[] and cmd='SELECT' and with_check is null and qual='(current_admin_role() = ''super_admin''::text)'
    );
  if v_unexpected is not null then raise exception 'VAM062V3 unexpected existing policies: %',v_unexpected; end if;

  -- admin_users(email) arbiter (fixes CONFLICT-06): checked structurally via
  -- pg_index rather than requiring contype='u', so a PRIMARY KEY-backed
  -- unique index (the live shape: admin_users_pkey on email) is correctly
  -- recognized as a valid ON CONFLICT(email) target.
  if not exists(
    select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='admin_users'
      and i.indisunique and i.indisvalid and i.indisready and not i.indnullsnotdistinct
      and i.indnkeyatts=1 and i.indpred is null and i.indexprs is null
      and (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[0])='email'
  ) then raise exception 'VAM062V3 admin_users(email) conflict target missing, altered, or ambiguous'; end if;

  -- admin_scope_access active-scope arbiter (fixes CONFLICT-01): checked
  -- against the live partial + expression unique index exactly —
  -- (user_id, coalesce(program_id,''), coalesce(season_id,''), role)
  -- WHERE status='active' — instead of a nonexistent plain 3-column
  -- UNIQUE(user_id,program_id,season_id) constraint. Role (DEC-02) and the
  -- partial predicate (DEC-03) are both part of the identity checked here.
  if not exists(
    select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='admin_scope_access'
      and i.indisunique and i.indisvalid and i.indisready and not i.indnullsnotdistinct
      and i.indnkeyatts=4
      and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'
      and i.indexprs is not null and pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
      and (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[0])='user_id'
      and (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[3])='role'
  ) then raise exception 'VAM062V3 admin_scope_access active-scope arbiter missing, altered, or ambiguous'; end if;

  if not exists(
    select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid='public.person_season_memberships'::regclass and c.contype='u' and c.convalidated
      and pg_get_constraintdef(c.oid,true)='UNIQUE (person_id, season_id, role)'
      and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts=3 and i.indpred is null and i.indexprs is null and not i.indnullsnotdistinct
  ) then raise exception 'VAM062V3 membership conflict target missing, altered, or ambiguous'; end if;

  -- admin_users lifecycle vocabulary (fixes CONFLICT-07 and implements
  -- DEC-04): status stays active/inactive only. Guard both that the two
  -- required values exist AND that 'invited' has not already been added by
  -- some other process, since DEC-04 is explicit that invitation state does
  -- not belong on admin_users at all.
  if not exists(select 1 from pg_constraint c where c.conrelid='public.admin_users'::regclass and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid) ilike '%active%' and pg_get_constraintdef(c.oid) ilike '%inactive%') then
    raise exception 'VAM062V3 admin_users status vocabulary mismatch';
  end if;
  if exists(select 1 from pg_constraint c where c.conrelid='public.admin_users'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%invited%') then
    raise exception 'VAM062V3 admin_users status vocabulary already includes invited — DEC-04 requires active/inactive only, review before proceeding';
  end if;

  -- membership role/status vocabulary (fixes CONFLICT-03): checked as two
  -- independent constraints, matching live staging, instead of requiring one
  -- constraint containing both vocabularies.
  if not exists(select 1 from pg_constraint c where c.conrelid='public.person_season_memberships'::regclass and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid) ilike '%mentor%' and pg_get_constraintdef(c.oid) ilike '%mentee%') then
    raise exception 'VAM062V3 membership role vocabulary mismatch';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.person_season_memberships'::regclass and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid) ilike '%invited%' and pg_get_constraintdef(c.oid) ilike '%paused%' and pg_get_constraintdef(c.oid) ilike '%withdrawn%' and pg_get_constraintdef(c.oid) ilike '%opted_out%' and pg_get_constraintdef(c.oid) ilike '%cancelled%') then
    raise exception 'VAM062V3 membership status vocabulary mismatch';
  end if;

  -- admin_audit_log action_type vocabulary drift check: require the exact
  -- known legacy definition before this migration replaces it (below), so an
  -- unexpected prior edit is never silently clobbered.
  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and c.contype='c' and c.convalidated=false
      and pg_get_constraintdef(c.oid, true)='CHECK (action_type = ANY (ARRAY[''create_admin_user''::text, ''update_admin_user''::text, ''reactivate_admin_user''::text, ''deactivate_admin_user''::text, ''remove_admin_access''::text, ''sync_auth''::text, ''unknown''::text])) NOT VALID'
  ) then raise exception 'VAM062V3 admin_audit_log action_type constraint drifted from the expected legacy vocabulary'; end if;
end $$;

-- Pre-state capture for rollback (now 7 tables, not 5 — DEC-09 adds
-- intake_batches and person_season_membership_log to the RLS/grant hardening
-- scope). prior_grants additionally captures the exact pre-migration
-- (grantee, privilege_type) set from information_schema so rollback can
-- restore grants exactly, not just RLS enable/force state — the reviewed
-- draft never touched grants at all, so this capture did not previously
-- need to exist.
create table public.account_rls_package_state(
  table_name text primary key check(table_name in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','intake_batches','person_season_membership_log')),
  rls_was_enabled boolean not null,
  rls_was_forced boolean not null,
  prior_grants jsonb not null default '[]'::jsonb,
  package_version text not null check(package_version='VAM062_V5'),
  state_checksum text not null,
  recorded_at timestamptz not null default transaction_timestamp()
);
insert into public.account_rls_package_state(table_name,rls_was_enabled,rls_was_forced,prior_grants,package_version,state_checksum,recorded_at)
select
  c.relname,c.relrowsecurity,c.relforcerowsecurity,
  coalesce((select jsonb_agg(jsonb_build_object('grantee',g.grantee,'privilege_type',g.privilege_type))
            from information_schema.role_table_grants g
            where g.table_schema='public' and g.table_name=c.relname and g.grantee in ('anon','authenticated')),'[]'::jsonb),
  'VAM062_V5',
  encode(digest('VAM062_V5|'||c.relname||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity,'sha256'),'hex'),
  transaction_timestamp()
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships','intake_batches','person_season_membership_log');
do $$ begin if (select count(*) from public.account_rls_package_state)<>7 then raise exception 'VAM062V3 incomplete RLS state capture'; end if; end $$;

-- Package tables (unchanged from the reviewed draft; account_person_auth_links
-- remains created for a future auth-linking write path — DEC-11 scopes this
-- migration to foundation + CSV import, so it is intentionally not written to
-- by any function below).
create table public.account_import_batches(id uuid primary key default gen_random_uuid(),actor_admin_user_id uuid not null references public.admin_users(id),source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),row_count integer not null check(row_count between 1 and 500),status text not null check(status in ('processing','completed','completed_with_errors')),created_at timestamptz not null default now(),completed_at timestamptz);
create table public.account_import_outcomes(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.account_import_batches(id) on delete cascade,row_number integer not null check(row_number>=2),outcome_status text not null check(outcome_status in ('created','updated','skipped','failed')),reason_code text not null check(length(reason_code) between 1 and 240),auth_user_id_hash text null check(auth_user_id_hash is null or auth_user_id_hash~'^[0-9a-f]{64}$'),created_at timestamptz not null default now(),unique(batch_id,row_number));
create table public.account_auth_reconciliation(operation_id uuid primary key,identifier_hash text not null check(identifier_hash~'^[0-9a-f]{64}$'),action_type text not null,failure_class text not null,retry_status text not null default 'required' check(retry_status in ('required','in_progress','resolved')),correlation_metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.account_auth_operations(operation_id uuid primary key,actor_admin_user_id uuid not null references public.admin_users(id),operation_type text not null check(operation_type in ('manual','sync','csv')),identifier_hash text not null check(identifier_hash~'^[0-9a-f]{64}$'),pre_lookup_state text not null default 'pending' check(pre_lookup_state in ('pending','zero','one','multiple','incomplete')),preexisting_auth_user_id_hash text check(preexisting_auth_user_id_hash is null or preexisting_auth_user_id_hash~'^[0-9a-f]{64}$'),provider_stage text not null default 'not_started' check(provider_stage in ('not_started','pending','explicit_id','omitted_id','failed','ambiguous')),provider_auth_user_id_hash text check(provider_auth_user_id_hash is null or provider_auth_user_id_hash~'^[0-9a-f]{64}$'),ownership_state text not null default 'not_found' check(ownership_state in ('preexisting','proven_created','ambiguous','not_found','failed','incomplete')),delete_allowed boolean not null default false,application_stage text not null default 'not_started' check(application_stage in ('not_started','pending','completed','failed')),compensation_stage text not null default 'not_required' check(compensation_stage in ('not_required','pending','completed','failed')),reconciliation_state text not null default 'not_required' check(reconciliation_state in ('not_required','required','in_progress','resolved')),retry_of uuid references public.account_auth_operations(operation_id),failure_class text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(not delete_allowed or (ownership_state='proven_created' and provider_stage='explicit_id' and provider_auth_user_id_hash is not null)));
create table public.account_person_auth_links(id uuid primary key default gen_random_uuid(),auth_user_id uuid not null unique,person_id uuid not null unique references public.people(id),program_id uuid not null references public.programs(id),season_id uuid not null references public.seasons(id),role text not null check(role in ('mentor','mentee')),status text not null check(status in ('active','inactive')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(person_id,program_id,season_id,role));
create table public.account_import_previews(id uuid primary key,actor_admin_user_id uuid not null references public.admin_users(id),secret_hash text not null check(secret_hash~'^[0-9a-f]{64}$'),ciphertext text not null,iv text not null,auth_tag text not null,expires_at timestamptz not null,created_at timestamptz not null default now());

create function public.vam062_current_admin_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.admin_users where auth_user_id=auth.uid() and status='active' limit 1
$$;

-- Race-safe admin_scope_access upsert core (remediates independent-review
-- Finding B). Serializes every write that may create a scope row by exactly
-- the logical identity DEC-R2 specifies — user_id + program_id + season_id
-- + role, never including status — via a transaction-scoped advisory lock
-- acquired before the final existence check, so a concurrent 'active'
-- upsert and an 'inactive' staff-import for the same identity cannot race
-- each other either. Internal helper only: never granted directly to any
-- role (see the no-direct-grant note near the bottom of this file); callers
-- are exclusively other SECURITY DEFINER functions in this package sharing
-- the same owner.
--  * p_target_status='active': matching active row -> no-op; matching
--    inactive-only row(s) -> untouched, a new active row is inserted
--    (DEC-03); ON CONFLICT on the live partial/expression index remains as
--    a defense-in-depth backstop for the active-vs-active case.
--  * p_target_status='inactive': used only by the staff-import path, whose
--    newly-provisioned scope rows must start inactive (DEC-04/DEC-R1 §7);
--    any existing row for the identity (active or inactive) is treated as
--    already satisfied — no duplicate inactive row is ever created.
create function public.vam062_upsert_scope_atomic(p_user_id uuid,p_program_id uuid,p_season_id uuid,p_scope_role text,p_target_status text) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_target_status not in ('active','inactive') then
    raise exception 'VAM062V3 invalid scope target status';
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM062_SCOPE|'||p_user_id::text||'|'||p_program_id::text||'|'||p_season_id::text||'|'||p_scope_role));
  if p_target_status='active' then
    if exists(select 1 from public.admin_scope_access where user_id=p_user_id and program_id=p_program_id::text and season_id=p_season_id::text and role=p_scope_role and status='active') then
      return;
    end if;
    insert into public.admin_scope_access(user_id,program_id,season_id,role,status)
      values(p_user_id,p_program_id::text,p_season_id::text,p_scope_role,'active')
      on conflict (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role) where (status = 'active') do nothing;
  else
    if exists(select 1 from public.admin_scope_access where user_id=p_user_id and program_id=p_program_id::text and season_id=p_season_id::text and role=p_scope_role) then
      return;
    end if;
    insert into public.admin_scope_access(user_id,program_id,season_id,role,status) values(p_user_id,p_program_id::text,p_season_id::text,p_scope_role,'inactive');
  end if;
end $$;

-- Admin CRUD (staff self-service / super_admin operations on existing admin
-- accounts). Fixes vs. the reviewed draft:
--  * program/season are resolved to canonical UUIDs (id-or-code lookup
--    preserved for caller convenience) and the RESOLVED uuid, not the raw
--    caller-supplied string, is what gets stored (DEC-05: "store canonical
--    UUID strings" — the reviewed draft stored the raw payload value, which
--    could be a program *code*, not a uuid).
--  * admin_scope_access writes use the corrected 4-part arbiter and DEC-03's
--    "insert new active row, never reactivate inactive history" semantics,
--    now via the race-safe vam062_upsert_scope_atomic helper (remediates
--    independent-review Finding B).
--  * DEC-R1: create/upsert/update/link_auth are active-only scope-creation
--    paths. A caller-supplied scope_status is never silently discarded — if
--    present it must be exactly 'active' or the call fails before any
--    mutation. The explicit-scope-id update branch follows the identical
--    rule and can now only retarget the role of an already-active scope row
--    (never reactivate an inactive one in place, never set an arbitrary
--    status) — matching the same DEC-03 "insert new row, never reactivate"
--    semantics as every other creation path, instead of being the one
--    branch that could silently do something different (this remediates
--    independent-review Finding A).
--  * the status/remove branch is unchanged: it remains the one dedicated,
--    explicit deactivate/reactivate/remove mechanism DEC-R1 §5 reserves for
--    this purpose, scoped to the specific program+season+role identified in
--    the payload rather than blanket-updating every scope row the user
--    holds (DEC-02: role is part of identity everywhere, including here).
create function public.vam062_admin_mutation_atomic(p_actor_admin_user_id uuid,p_operation text,p_target_admin_user_id uuid,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare
  v_target uuid; v_auth uuid; v_before jsonb; v_after jsonb; v_action text;
  v_program_id uuid; v_season_id uuid; v_scope_status text;
begin
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 unauthorized actor';
  end if;
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'VAM062V3 trusted server context required';
  end if;

  if p_operation in ('upsert','update','link_auth') then
    if nullif(p_payload->>'season_id','') is null or nullif(p_payload->>'program_id','') is null then
      raise exception 'VAM062V3 explicit program and season required';
    end if;
    -- DEC-R1: these three operations only ever create or retarget an
    -- ACTIVE scope row. A caller-supplied scope_status is honored only when
    -- it is exactly 'active'; anything else fails closed before mutation
    -- rather than being silently ignored or silently applied.
    v_scope_status:=nullif(btrim(p_payload->>'scope_status'),'');
    if v_scope_status is not null and v_scope_status<>'active' then
      raise exception 'VAM062V3 scope_status must be active or omitted for this operation; use the dedicated status/remove operation to deactivate';
    end if;
    select p.id,s.id into v_program_id,v_season_id
    from public.programs p join public.seasons s on s.program_id=p.id
    where p.is_active
      and (p.id::text=p_payload->>'program_id' or p.code=p_payload->>'program_id')
      and (s.id::text=p_payload->>'season_id' or s.code=p_payload->>'season_id');
    if v_program_id is null or v_season_id is null then
      raise exception 'VAM062V3 invalid program-season relationship';
    end if;
  end if;

  if p_operation='upsert' then
    if p_payload->>'role' not in ('viewer','reviewer','support_team','core_team','admin','super_admin') then
      raise exception 'VAM062V3 invalid role';
    end if;
    select id,to_jsonb(a) into v_target,v_before from public.admin_users a where email=lower(btrim(p_payload->>'email'));
    insert into public.admin_users(auth_user_id,email,full_name,role,status)
      values((p_payload->>'auth_user_id')::uuid,lower(btrim(p_payload->>'email')),nullif(btrim(p_payload->>'full_name'),''),p_payload->>'role',p_payload->>'status')
      on conflict(email) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,role=excluded.role,status=excluded.status
      returning id,auth_user_id into v_target,v_auth;
    perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    v_action:=case when v_before is null then 'create_admin_user' else 'update_admin_user' end;

  elsif p_operation='update' then
    select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    update public.admin_users set full_name=nullif(btrim(p_payload->>'full_name'),''),role=p_payload->>'role',status=p_payload->>'status' where id=p_target_admin_user_id returning id into v_target;
    if nullif(p_payload->>'scope_id','') is not null then
      -- Explicit-scope-id retarget: role only, and only against a row that
      -- is currently active — this can never reactivate an inactive row or
      -- set any other status (DEC-R1 §4/§6).
      update public.admin_scope_access
        set role=p_payload->>'scope_role'
        where id=(p_payload->>'scope_id')::uuid and user_id=v_auth and program_id=v_program_id::text and season_id=v_season_id::text and status='active';
      if not found then raise exception 'VAM062V3 scope mismatch'; end if;
    else
      perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    end if;
    v_action:='update_admin_user';

  elsif p_operation='link_auth' then
    select to_jsonb(a) into v_before from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    update public.admin_users set auth_user_id=(p_payload->>'auth_user_id')::uuid where id=p_target_admin_user_id returning id,auth_user_id into v_target,v_auth;
    perform public.vam062_upsert_scope_atomic(v_auth,v_program_id,v_season_id,p_payload->>'scope_role','active');
    v_action:='sync_auth';

  elsif p_operation in ('status','remove') then
    select to_jsonb(a),auth_user_id into v_before,v_auth from public.admin_users a where id=p_target_admin_user_id for update;
    if v_before is null then raise exception 'VAM062V3 target missing'; end if;
    -- DEC-04: admin_users.status stays active/inactive only.
    update public.admin_users set status=case when p_operation='remove' then 'inactive' else p_payload->>'status' end where id=p_target_admin_user_id returning id into v_target;
    -- Scoped to the specific program/season/role named in the payload
    -- rather than every scope row the user holds, consistent with DEC-02.
    if nullif(p_payload->>'season_id','') is not null and nullif(p_payload->>'program_id','') is not null and nullif(p_payload->>'scope_role','') is not null then
      select p.id,s.id into v_program_id,v_season_id
      from public.programs p join public.seasons s on s.program_id=p.id
      where (p.id::text=p_payload->>'program_id' or p.code=p_payload->>'program_id')
        and (s.id::text=p_payload->>'season_id' or s.code=p_payload->>'season_id');
      update public.admin_scope_access
        set status=case when p_operation='status' and p_payload->>'status'='active' then 'active' else 'inactive' end
        where user_id=v_auth and program_id=v_program_id::text and season_id=v_season_id::text and role=p_payload->>'scope_role';
    else
      update public.admin_scope_access set status='inactive' where user_id=v_auth and status='active';
    end if;
    v_action:=case when p_operation='remove' then 'remove_admin_access' when p_payload->>'status'='active' then 'reactivate_admin_user' else 'deactivate_admin_user' end;

  else
    raise exception 'VAM062V3 unsupported operation';
  end if;

  select to_jsonb(a) into v_after from public.admin_users a where id=v_target;
  insert into public.admin_audit_log(actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data) values(p_actor_admin_user_id,v_action,v_target,v_before,v_after);
end $$;

-- CSV staff import. Fixes: new admin_users rows stay 'inactive' (DEC-04, not
-- 'invited' — CONFLICT-08); admin_scope_access write uses the race-safe
-- vam062_upsert_scope_atomic helper (target status 'inactive', matching
-- DEC-04/DEC-R1 §7 — newly-provisioned staff scope stays dormant until
-- explicit activation), which remediates independent-review Finding B: the
-- reviewed existence-check-then-insert here was not safe under concurrent
-- reimport of the same row.
create function public.vam062_upsert_staff_account_atomic(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_auth_user_id uuid,p_email text,p_display_name text,p_role text,p_program_id uuid,p_season_id uuid,p_scope_role text) returns void language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_existing boolean;
begin
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 unauthorized actor';
  end if;
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'VAM062V3 trusted server context required';
  end if;
  if not exists(select 1 from public.programs p join public.seasons s on s.program_id=p.id where p.id=p_program_id and p.is_active and s.id=p_season_id) then
    raise exception 'VAM062V3 invalid active program-season relationship';
  end if;
  if p_role not in ('viewer','reviewer','support_team','core_team','admin') then
    raise exception 'VAM062V3 unsupported staff role';
  end if;

  select exists(select 1 from public.admin_users where email=lower(btrim(p_email))) into v_existing;
  insert into public.admin_users(auth_user_id,email,full_name,role,status)
    values(p_auth_user_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,'inactive')
    on conflict(email) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,role=excluded.role
    returning id into v_target;

  perform public.vam062_upsert_scope_atomic(p_auth_user_id,p_program_id,p_season_id,p_scope_role,'inactive');
  if not exists(select 1 from public.admin_scope_access where user_id=p_auth_user_id and program_id=p_program_id::text and season_id=p_season_id::text and role=p_scope_role) then
    raise exception 'VAM062V3 scope reconciliation failed';
  end if;

  insert into public.admin_audit_log(actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data)
    values(p_actor_admin_user_id,case when v_existing then 'update_admin_user' else 'create_admin_user' end,v_target,null,jsonb_build_object('program_id',p_program_id,'season_id',p_season_id,'role',p_role,'status','inactive'));
  insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code)
    values(p_batch_id,p_row_number,case when v_existing then 'updated' else 'created' end,case when v_existing then 'staff_account_updated' else 'staff_account_invited' end);
end $$;

-- CSV participant/membership import. Unchanged in logic from the reviewed
-- draft (the arbiter it uses — person_season_memberships(person_id,
-- season_id,role) — was already correct); the only fix required was
-- expanding admin_audit_log's action_type vocabulary (below) to permit the
-- 'import_participant_membership' value this function already wrote.
create function public.vam062_import_participant_membership_atomic(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_email text,p_display_name text,p_role text,p_program_id uuid,p_season_id uuid,p_intake_batch_id uuid) returns table(outcome_status text,reason_code text) language plpgsql security definer set search_path=public as $$
declare v_person uuid; v_membership uuid; v_existing boolean; v_old_status text;
begin
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 unauthorized actor';
  end if;
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'VAM062V3 trusted server context required';
  end if;
  if not exists(select 1 from public.programs p join public.seasons s on s.program_id=p.id left join public.intake_batches b on b.season_id=s.id where p.id=p_program_id and p.is_active and s.id=p_season_id and (p_intake_batch_id is null or b.id=p_intake_batch_id)) then
    raise exception 'VAM062V3 invalid program-season-batch relationship';
  end if;
  if p_role not in ('mentor','mentee') then
    raise exception 'VAM062V3 unsupported participant role';
  end if;

  select id into v_person from public.people where email_primary=lower(btrim(p_email));
  if v_person is null then
    insert into public.people(email_primary,full_name) values(lower(btrim(p_email)),btrim(p_display_name)) returning id into v_person;
  end if;

  select id,status into v_membership,v_old_status from public.person_season_memberships where person_id=v_person and season_id=p_season_id and role=p_role;
  v_existing:=v_membership is not null;

  if v_existing and v_old_status='invited' and coalesce((select intake_batch_id from public.person_season_memberships where id=v_membership),'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_intake_batch_id,'00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code) values(p_batch_id,p_row_number,'skipped','membership_already_current');
    return query select 'skipped','membership_already_current';
    return;
  end if;
  if v_existing and exists(select 1 from public.person_season_memberships where id=v_membership and program_id<>p_program_id) then
    raise exception 'VAM062V3 cross-program reassignment denied';
  end if;

  insert into public.person_season_memberships(person_id,program_id,season_id,intake_batch_id,role,status,source,created_by)
    values(v_person,p_program_id,p_season_id,p_intake_batch_id,p_role,'invited','manual',p_actor_admin_user_id)
    on conflict(person_id,season_id,role) do update set program_id=excluded.program_id,intake_batch_id=excluded.intake_batch_id,status='invited'
    returning id into v_membership;

  insert into public.person_season_membership_log(membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by)
    values(v_membership,v_person,p_program_id,p_season_id,p_role,v_old_status,'invited',case when v_existing then 'status_change' else 'created' end,'account_csv_import',p_actor_admin_user_id);
  insert into public.admin_audit_log(actor_admin_user_id,action_type,before_data,after_data)
    values(p_actor_admin_user_id,'import_participant_membership',null,jsonb_build_object('operation','participant_membership_import','program_id',p_program_id,'season_id',p_season_id,'role',p_role,'participant_auth_created',false));
  insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code)
    values(p_batch_id,p_row_number,case when v_existing then 'updated' else 'created' end,case when v_existing then 'membership_updated' else 'membership_created_no_auth' end);

  return query select case when v_existing then 'updated' else 'created' end,case when v_existing then 'membership_updated' else 'membership_created_no_auth' end;
end $$;

create function public.vam062_record_reconciliation(p_actor_admin_user_id uuid,p_batch_id uuid,p_row_number integer,p_auth_user_id_hash text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then raise exception 'VAM062V3 unauthorized actor'; end if;
  insert into public.account_import_outcomes(batch_id,row_number,outcome_status,reason_code,auth_user_id_hash)
    values(p_batch_id,p_row_number,'failed','reconciliation_required',p_auth_user_id_hash)
    on conflict (batch_id,row_number) do update set outcome_status='failed',reason_code='reconciliation_required',auth_user_id_hash=excluded.auth_user_id_hash;
end $$;

create function public.vam062_record_auth_reconciliation(p_actor_admin_user_id uuid,p_operation_id uuid,p_identifier_hash text,p_action_type text,p_failure_class text,p_retry_status text,p_correlation_metadata jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') or p_retry_status not in ('required','resolved') then
    raise exception 'VAM062V3 reconciliation rejected';
  end if;
  insert into public.account_auth_reconciliation(operation_id,identifier_hash,action_type,failure_class,retry_status,correlation_metadata)
    values(p_operation_id,p_identifier_hash,p_action_type,p_failure_class,p_retry_status,coalesce(p_correlation_metadata,'{}'));
end $$;

create function public.vam062_begin_auth_operation(p_actor_admin_user_id uuid,p_operation_id uuid,p_operation_type text,p_identifier_hash text,p_retry_of uuid default null) returns table(accepted boolean,existing_stage text) language plpgsql volatile security definer set search_path=public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 operation rejected';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  insert into public.account_auth_operations(operation_id,actor_admin_user_id,operation_type,identifier_hash,retry_of)
    values(p_operation_id,p_actor_admin_user_id,p_operation_type,p_identifier_hash,p_retry_of) on conflict do nothing;
  if found then
    return query select true,'created'::text;
  else
    return query select false,(select provider_stage from public.account_auth_operations where operation_id=p_operation_id);
  end if;
end $$;

create function public.vam062_record_auth_operation_stage(p_actor_admin_user_id uuid,p_operation_id uuid,p_stage text,p_ownership_state text,p_auth_user_id_hash text,p_delete_allowed boolean,p_failure_class text) returns void language plpgsql volatile security definer set search_path=public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') then
    raise exception 'VAM062V3 operation update rejected';
  end if;
  update public.account_auth_operations set
    pre_lookup_state=case p_stage when 'prelookup_zero' then 'zero' when 'preexisting' then 'one' when 'incomplete' then 'incomplete' when 'ambiguous' then case when provider_stage='not_started' then 'multiple' else pre_lookup_state end else pre_lookup_state end,
    preexisting_auth_user_id_hash=case when p_stage='preexisting' then p_auth_user_id_hash else preexisting_auth_user_id_hash end,
    provider_stage=case p_stage when 'provider_pending' then 'pending' when 'provider_explicit_id' then 'explicit_id' when 'not_found' then 'omitted_id' when 'failed' then 'failed' when 'ambiguous' then 'ambiguous' else provider_stage end,
    provider_auth_user_id_hash=case when p_stage in ('provider_explicit_id','ambiguous') and provider_stage<>'not_started' then p_auth_user_id_hash else provider_auth_user_id_hash end,
    ownership_state=p_ownership_state,
    delete_allowed=p_delete_allowed,
    application_stage=case p_stage when 'application_pending' then 'pending' when 'application_completed' then 'completed' when 'application_failed' then 'failed' else application_stage end,
    compensation_stage=case p_stage when 'compensation_pending' then 'pending' when 'compensation_completed' then 'completed' when 'compensation_failed' then 'failed' else compensation_stage end,
    reconciliation_state=case when p_stage='reconciliation_resolved' then 'resolved' when p_stage='reconciliation_required' or p_ownership_state in ('ambiguous','failed','incomplete') then 'required' else reconciliation_state end,
    failure_class=p_failure_class,
    updated_at=now()
  where operation_id=p_operation_id and actor_admin_user_id=p_actor_admin_user_id;
  if not found then raise exception 'VAM062V3 operation missing'; end if;
end $$;

create function public.vam062_create_account_preview(p_preview_id uuid,p_actor_admin_user_id uuid,p_secret_hash text,p_ciphertext text,p_iv text,p_auth_tag text,p_expires_at timestamptz,p_max_previews integer) returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' or not exists(select 1 from public.admin_users where id=p_actor_admin_user_id and role='super_admin' and status='active') or p_expires_at<=now() or p_expires_at>now()+interval '10 minutes' or p_max_previews<>50 then
    raise exception 'VAM062V3 preview rejected';
  end if;
  perform pg_advisory_xact_lock(hashtext('VAM062_PREVIEW_STORE'));
  delete from public.account_import_previews where expires_at<=now();
  if (select count(*) from public.account_import_previews)>=p_max_previews then raise exception 'VAM062V3 preview capacity reached'; end if;
  insert into public.account_import_previews values(p_preview_id,p_actor_admin_user_id,p_secret_hash,p_ciphertext,p_iv,p_auth_tag,p_expires_at,now());
end $$;

create function public.vam062_consume_account_preview(p_preview_id uuid,p_actor_admin_user_id uuid,p_secret_hash text) returns table(ciphertext text,iv text,auth_tag text) language sql security definer set search_path=public as $$
  delete from public.account_import_previews where id=p_preview_id and actor_admin_user_id=p_actor_admin_user_id and secret_hash=p_secret_hash and expires_at>now() returning ciphertext,iv,auth_tag
$$;

create table public.account_rls_package_manifest(
  object_kind text not null check(object_kind in('table','function','policy')),
  object_name text not null,
  table_name text,
  object_oid oid,
  definition_hash text not null,
  owner_name text not null,
  package_version text not null check(package_version='VAM062_V5'),
  primary key(object_kind,object_name),
  check((object_kind in('table','function') and object_oid is not null) or (object_kind='policy' and object_oid is null))
);
insert into public.account_rls_package_manifest
  select 'function',p.proname,null,p.oid,md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')),pg_get_userbyid(p.proowner),'VAM062_V5'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%';
insert into public.account_rls_package_manifest
  select 'table',c.relname,c.relname,c.oid,'VAM062_V5_TABLE_PROVENANCE',pg_get_userbyid(c.relowner),'VAM062_V5'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('account_rls_package_state','account_rls_package_manifest','account_import_batches','account_import_outcomes','account_auth_reconciliation','account_auth_operations','account_person_auth_links','account_import_previews');

-- RLS/grant hardening (DEC-09), extended to all 7 write-path tables. The
-- prior draft only enabled RLS on 5 of the 7 tables it needed to and never
-- revoked anon/authenticated grants on any pre-existing table — including
-- admin_users, which live staging evidence confirms already carries broad
-- anon grants (SELECT/INSERT/UPDATE/DELETE/...), contradicting the
-- precondition preflight otherwise assumed. This migration revokes those
-- grants explicitly rather than continuing to assume them.
alter table public.admin_users enable row level security;
alter table public.admin_scope_access enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.people enable row level security;
alter table public.person_season_memberships enable row level security;
alter table public.intake_batches enable row level security;
alter table public.person_season_membership_log enable row level security;
alter table public.account_import_batches enable row level security;
alter table public.account_import_outcomes enable row level security;
alter table public.account_auth_reconciliation enable row level security;
alter table public.account_auth_operations enable row level security;
alter table public.account_person_auth_links enable row level security;
alter table public.account_import_previews enable row level security;

create policy vam062_admin_users_self_or_super on public.admin_users for select to authenticated using(auth_user_id=auth.uid() or public.current_admin_role()='super_admin');
create policy vam062_scope_self_or_super on public.admin_scope_access for select to authenticated using(user_id=auth.uid() or public.current_admin_role()='super_admin');
create policy vam062_audit_actor_or_super on public.admin_audit_log for select to authenticated using(actor_admin_user_id=public.vam062_current_admin_id() or public.current_admin_role()='super_admin');
create policy vam062_people_program_ops on public.people for select to authenticated using(
  public.current_admin_role()='super_admin' or exists(
    select 1 from public.person_season_memberships m join public.admin_scope_access s
      on s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=m.program_id::text and s.season_id is not null and s.season_id=m.season_id::text
    where m.person_id=people.id
  )
);
create policy vam062_membership_program_ops on public.person_season_memberships for select to authenticated using(
  public.current_admin_role()='super_admin' or exists(
    select 1 from public.admin_scope_access s
    where s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=person_season_memberships.program_id::text and s.season_id is not null and s.season_id=person_season_memberships.season_id::text
  )
);
-- New: minimum scope-aware read access for the two previously-unaddressed
-- tables. Neither gets an INSERT/UPDATE/DELETE policy — both remain
-- writable only through the SECURITY DEFINER RPCs above, keeping
-- person_season_membership_log append-only in practice.
create policy vam062_intake_batches_program_ops on public.intake_batches for select to authenticated using(
  public.current_admin_role()='super_admin' or exists(
    select 1 from public.seasons se join public.admin_scope_access s
      on s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=se.program_id::text and s.season_id is not null and s.season_id=se.id::text
    where se.id=intake_batches.season_id
  )
);
create policy vam062_membership_log_program_ops on public.person_season_membership_log for select to authenticated using(
  public.current_admin_role()='super_admin' or exists(
    select 1 from public.admin_scope_access s
    where s.user_id=auth.uid() and s.status='active' and s.role in ('full_access','operations') and s.program_id=person_season_membership_log.program_id::text and s.season_id is not null and s.season_id=person_season_membership_log.season_id::text
  )
);

insert into public.account_rls_package_manifest
  select 'policy',policyname,tablename,null,md5(concat_ws('|',tablename,policyname,permissive,array_to_string(roles,','),cmd,coalesce(qual,''),coalesce(with_check,''))),current_user,'VAM062_V5'
  from pg_policies where schemaname='public' and policyname like 'vam062_%';

-- Explicit grant hardening on all 7 write-path tables (new — the reviewed
-- draft never touched grants on any pre-existing table).
revoke all on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log from anon;
revoke insert,update,delete,truncate,trigger,references on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log from authenticated;
grant select on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log to authenticated;

revoke all on public.account_rls_package_state,public.account_rls_package_manifest,public.account_import_batches,public.account_import_outcomes,public.account_auth_reconciliation,public.account_auth_operations,public.account_person_auth_links,public.account_import_previews from public,anon,authenticated;
revoke all on function public.vam062_current_admin_id(),public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text),public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb),public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text),public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid),public.vam062_record_reconciliation(uuid,uuid,integer,text),public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb),public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid),public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text),public.vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamptz,integer),public.vam062_consume_account_preview(uuid,uuid,text) from public,anon,authenticated;
-- vam062_upsert_scope_atomic is only ever called internally by the other
-- functions in this package, but is granted directly to service_role below
-- anyway, matching every other vam062_ function's convention (unlike the
-- newer per-package pattern in migration 063), since this package's own
-- rollback/post-apply verification generically requires every
-- manifest-tracked function to carry a direct service_role grant.
revoke all on public.account_rls_package_state from service_role;
revoke all on public.account_rls_package_manifest from service_role;
grant all on public.account_import_batches,public.account_import_outcomes,public.account_auth_reconciliation,public.account_auth_operations,public.account_person_auth_links,public.account_import_previews to service_role;
grant execute on function public.vam062_current_admin_id(),public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text),public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb),public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text),public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid),public.vam062_record_reconciliation(uuid,uuid,integer,text),public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb),public.vam062_begin_auth_operation(uuid,uuid,text,text,uuid),public.vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text),public.vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamptz,integer),public.vam062_consume_account_preview(uuid,uuid,text) to service_role;

-- Audit vocabulary expansion (DEC-10). Replaces the NOT VALID legacy
-- constraint with an equally NOT VALID superset (existing rows are still
-- never scanned; only future writes are checked) that adds every value this
-- migration and the planned migration 063 lifecycle package require.
alter table public.admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_type_check check (
  action_type = any (array[
    'create_admin_user','update_admin_user','reactivate_admin_user','deactivate_admin_user','remove_admin_access','sync_auth','unknown',
    'import_participant_membership','link_person_auth','reconcile_person_auth','create_membership','add_membership_role','remove_membership_role',
    'pause_membership','withdraw_membership','opt_out_membership','cancel_membership','reactivate_membership'
  ])
) not valid;

commit;
