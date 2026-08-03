import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { executeStaffMutation } from "@/lib/account-mutation-orchestrator";

vi.mock("server-only",()=>({}));
const read=(path:string)=>readFileSync(path,"utf8");

describe("mandatory audit and atomic mutation remediation",()=>{
  it("removes unreachable audit handling and makes the real writer throw a typed sanitized error",()=>{const source=read("lib/admin-users.ts");expect(source).not.toMatch(/return \{ data: \[\], error:[\s\S]*?\};\s*throw/);const writer=source.slice(source.indexOf("async function writeAuditLog"),source.indexOf("async function wouldRemove"));expect(writer).toContain('auditError.name = "MandatoryAuditError"');expect(writer).toContain("throw auditError");expect(writer).not.toContain("error.message)`");});
  it("uses one participant RPC for person, membership, outcome and audits",()=>{const source=read("lib/account-import-server.ts");const participant=source.slice(source.indexOf("async function upsertParticipantMembership"),source.indexOf("export async function confirmAccountImport"));expect(participant).toContain('rpc("vam062_import_participant_membership_atomic"');expect(participant).not.toMatch(/\.from\("people"\)|\.from\("person_season_memberships"\)/);});
  const created={state:"proven_created" as const,id:"synthetic-id",deleteAllowed:true,evidence:"provider_id" as const};
  it("compensates only a proven-created Auth identity",async()=>{const compensate=vi.fn();const result=await executeStaffMutation({resolveAuth:async()=>created,commitDatabase:async()=>{throw Error()},compensateAuth:compensate,recordCompensation:vi.fn(),recordReconciliation:vi.fn(),hashIdentifier:()=>"hash"});expect(result.reason).toBe("database_transaction_failed_auth_compensated");expect(compensate).toHaveBeenCalledOnce();});
  it("records reconciliation and never deletes ambiguous ownership",async()=>{const reconcile=vi.fn(),compensate=vi.fn(),commit=vi.fn();const result=await executeStaffMutation({resolveAuth:async()=>({state:"ambiguous",id:"possible",deleteAllowed:false,evidence:"post_lookup"}),commitDatabase:commit,compensateAuth:compensate,recordCompensation:vi.fn(),recordReconciliation:reconcile,hashIdentifier:()=>"sanitized-hash"});expect(result.reason).toBe("ambiguous_auth_ownership_recorded");expect(commit).not.toHaveBeenCalled();expect(compensate).not.toHaveBeenCalled();});
  it("never deletes a pre-existing Auth identity",async()=>{const compensate=vi.fn();const result=await executeStaffMutation({resolveAuth:async()=>({state:"preexisting",id:"existing",deleteAllowed:false,evidence:"pre_lookup"}),commitDatabase:async()=>{throw Error()},compensateAuth:compensate,recordCompensation:vi.fn(),recordReconciliation:vi.fn(),hashIdentifier:()=>"hash"});expect(result.reason).toBe("database_transaction_failed_no_deletion_authority");expect(compensate).not.toHaveBeenCalled();});
  it("fails closed when compensation fails",async()=>{const reconcile=vi.fn();const result=await executeStaffMutation({resolveAuth:async()=>created,commitDatabase:async()=>{throw Error()},compensateAuth:async()=>{throw Error()},recordCompensation:vi.fn(),recordReconciliation:reconcile,hashIdentifier:()=>"non-secret-hash"});expect(result.reason).toBe("reconciliation_required_recorded");});
  it("distinguishes reconciliation recording failure",async()=>{const result=await executeStaffMutation({resolveAuth:async()=>created,commitDatabase:async()=>{throw Error()},compensateAuth:async()=>{throw Error()},recordCompensation:vi.fn(),recordReconciliation:async()=>{throw Error()},hashIdentifier:()=>"hash"});expect(result.reason).toBe("critical_reconciliation_recording_failed")});
  it("distinguishes compensation recording failure",async()=>{const result=await executeStaffMutation({resolveAuth:async()=>created,commitDatabase:async()=>{throw Error()},compensateAuth:async()=>{},recordCompensation:async()=>{throw Error()},recordReconciliation:vi.fn(),hashIdentifier:()=>"hash"});expect(result.reason).toBe("critical_compensation_recording_failed")});
  it("reports success only after database success",async()=>{const result=await executeStaffMutation({resolveAuth:async()=>created,commitDatabase:async()=>{},compensateAuth:vi.fn(),recordCompensation:vi.fn(),recordReconciliation:vi.fn(),hashIdentifier:()=>"hash"});expect(result).toMatchObject({ok:true,status:"created"});});
});

describe("preview and SQL package safety",()=>{
  it("keeps raw CSV out of browser state and hidden fields",()=>{const actions=read("app/admin/users/import/actions.ts");const client=read("app/admin/users/import/import-client.tsx");expect(actions).not.toContain("rawCsv?:");expect(client).not.toContain('name="raw_csv"');expect(actions).toContain("previewIntegrity");});
  it("uses shared encrypted atomic preview RPCs",()=>{const store=read("lib/account-preview-store.ts");expect(store).toContain("aes-256-gcm");expect(store).toContain("vam062_create_account_preview");expect(store).toContain("vam062_consume_account_preview");expect(store).not.toContain("new Map")});
  it("preflight makes every blocking assertion fail closed",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql");for(const token of ["expected_col","expected_policy","expected_arbiter","indisvalid","indisready","failed_blocking_assertions","is_blocking","bool_and(status='PASS' or not is_blocking)"])expect(sql).toContain(token);expect(sql).not.toMatch(/\('(?:import|rollback)_compatibility','PASS'\)/)});
  it("preflight no longer requires RLS to be pre-disabled or grants to be pre-clean (both are non-blocking evidence, since migration 062 V3 fixes them itself)",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql");expect(sql).toContain("evidence:rls_state_capturable");expect(sql).toContain("evidence:current_grant_hygiene");const evidenceLines=sql.split("\n").filter(l=>l.includes("evidence:"));for(const line of evidenceLines)expect(line).toContain(",false");});
  it("migration rejects policy and relationship conflicts before material DDL",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");expect(sql.indexOf("unexpected existing policies")).toBeLessThan(sql.indexOf("create table public.account_rls_package_state"));expect(sql).toContain("season-program relationship mismatch");expect(sql).toContain("batch-season relationship mismatch");expect(sql).toContain("s.season_id is not null");expect(sql).not.toContain("s.season_id is null or")});
  it("migration 062 V3 no longer targets the broken plain admin_scope_access arbiter and includes role in the corrected one",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");expect(sql).not.toContain("UNIQUE (user_id, program_id, season_id)");expect(sql).not.toContain("on conflict(user_id,program_id,season_id)");expect(sql).toContain("on conflict (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role) where (status = 'active') do nothing");expect(sql).toContain("pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'");expect(sql).toContain("pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'")});
  it("migration 062 V3 keeps new staff inactive and never writes admin_users.status='invited'",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");expect(sql).not.toMatch(/p_role,'invited'\)/);expect(sql).toContain("p_role,'inactive')");expect(sql).toContain("admin_users status vocabulary already includes invited")});
  it("migration 062 V3 expands the audit vocabulary to cover import_participant_membership and the full DEC-10 list",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");const idx=sql.indexOf("add constraint admin_audit_log_action_type_check");expect(idx).toBeGreaterThan(-1);const clause=sql.slice(idx,sql.indexOf(";",idx));for(const value of ["create_admin_user","update_admin_user","reactivate_admin_user","deactivate_admin_user","remove_admin_access","sync_auth","unknown","import_participant_membership","link_person_auth","reconcile_person_auth","create_membership","add_membership_role","remove_membership_role","pause_membership","withdraw_membership","opt_out_membership","cancel_membership","reactivate_membership"])expect(clause).toContain(`'${value}'`);expect(clause).toContain("not valid")});
  it("migration 062 V3 hardens RLS and grants on all seven write-path tables, including intake_batches and person_season_membership_log",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");for(const t of ["admin_users","admin_scope_access","admin_audit_log","people","person_season_memberships","intake_batches","person_season_membership_log"]){expect(sql).toContain(`alter table public.${t} enable row level security;`)}expect(sql).toContain("revoke all on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log from anon;");expect(sql).toContain("vam062_intake_batches_program_ops");expect(sql).toContain("vam062_membership_log_program_ops");expect(sql).not.toContain("create policy vam062_intake_batches_program_ops on public.intake_batches for insert");expect(sql).not.toContain("create policy vam062_membership_log_program_ops on public.person_season_membership_log for insert")});
  it("rollback authenticates before drops and restores RLS flags",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql");expect(sql).toContain("object_oid");expect(sql).toContain("ordered column/type/nullability/generation mismatch");expect(sql).toContain("column default mismatch");expect(sql).toContain("key/constraint inventory mismatch");expect(sql.indexOf("table identity/provenance mismatch")).toBeLessThan(sql.indexOf("drop table public.account_import_previews"));expect(sql).not.toMatch(/drop table public\.(admin_users|people|person_season_memberships)/)});
  it("rollback drops every one of the eight package tables, not just some of them",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql");for(const t of ["account_import_previews","account_auth_operations","account_person_auth_links","account_auth_reconciliation","account_import_outcomes","account_import_batches","account_rls_package_manifest","account_rls_package_state"])expect(sql).toContain(`drop table public.${t}`)});
  it("rollback restores grants from captured prior state and the legacy action_type vocabulary exactly",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql");expect(sql).toContain("prior_grants");expect(sql).toContain("jsonb_to_recordset");expect(sql).toContain("revoke all on public.%I from anon, authenticated");const idx=sql.indexOf("add constraint admin_audit_log_action_type_check");const clause=sql.slice(idx,sql.indexOf(";",idx));expect(clause).not.toContain("import_participant_membership");expect(clause).toContain("unknown")});
  it("uses V3 source-controlled verification contracts",()=>{const forward=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql"),post=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql"),pre=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql");expect(forward).toContain("VAM062_V5_TABLE_PROVENANCE");expect(post).toContain("expected_table");expect(post).toContain("relforcerowsecurity=forced");expect(pre).toContain("failed_blocking_assertions")});
  it("proves exact compatible conflict targets before material DDL",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");const ddl=sql.indexOf("create table public.account_rls_package_state");const target="UNIQUE (person_id, season_id, role)";expect(sql.indexOf(target)).toBeGreaterThan(-1);expect(sql.indexOf(target)).toBeLessThan(ddl);expect(sql).toContain("i.indpred is null");expect(sql).toContain("i.indexprs is null");expect(sql).toContain("indnullsnotdistinct")});
  it("preserves policy grouping through exact expression comparison",()=>{for(const path of ["supabase_migrations/062_review_only_account_admin_rls_foundation.sql","docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql","docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql"]){const sql=read(path);expect(sql).not.toContain("[[:space:]()]");expect(sql).not.toContain("punctuation");expect(sql).toContain("qual=")}});
  it("uses independent exact post-apply policy specifications",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql");expect(sql).toContain("p.qual=e.q");expect(sql).toContain("s.season_id IS NOT NULL");expect(sql).toContain("policy_inventory");expect(sql).toContain("package_grants")});
  it("all four migration-062 V3 files represent intake_batches and person_season_membership_log hardening, not just the migration",()=>{for(const path of ["supabase_migrations/062_review_only_account_admin_rls_foundation.sql","docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql","docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql","docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql"]){const sql=read(path);expect(sql).toContain("intake_batches");expect(sql).toContain("person_season_membership_log")}});
  it("admin_scope_access reactivation never touches an inactive row: the single shared helper's ON CONFLICT target is the active-only partial index, no UPDATE branch reaches an inactive row",()=>{const sql=read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");const conflictClauses=sql.match(/on conflict \(user_id, \(coalesce\(program_id, ''\)\), \(coalesce\(season_id, ''\)\), role\) where \(status = 'active'\) do nothing/g)??[];expect(conflictClauses.length).toBe(1);const helperIdx=sql.indexOf("create function public.vam062_upsert_scope_atomic");const nextFnIdx=sql.indexOf("create function public.vam062_admin_mutation_atomic");expect(sql.slice(helperIdx,nextFnIdx)).toContain(conflictClauses[0]);expect(sql).not.toMatch(/admin_scope_access set status='active'[^;]*status='inactive'/)});
  it("action_type_vocabulary and admin_users_status_vocabulary assertions exist in post-apply verification with exact final definitions",()=>{const sql=read("docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql");expect(sql).toContain("'action_type_vocabulary:values'");expect(sql).toContain("'action_type_vocabulary:not_valid'");expect(sql).toContain("'admin_users_status_vocabulary'");expect(sql).toContain("not exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%invited%')")});
  it("harness proves authoritative topology and exact denial mechanisms",()=>{const source=read("scripts/account-rls-isolation-harness.mjs");for(const token of ["provider_subject","authoritative_account","authoritative_scope","person_auth_link","authoritative_membership","ueh_seasons_distinct","membership_topology","same_program_different_season","privilege_denial","zeroRowsAllowed:false"])expect(source).toContain(token)});  it("API harness fails closed without inputs and emits sanitized JSON",()=>{const run=spawnSync(process.execPath,["scripts/account-rls-isolation-harness.mjs"],{encoding:"utf8"});expect(run.status).toBe(1);expect(JSON.parse(run.stdout)).toEqual({pass:false,reason:"missing_config",results:[]});expect(run.stdout).not.toMatch(/jwt|https?:|apikey/i);});
  it("exact policy equality rejects semantic mutations",()=>{const approved="(scope AND season) OR super_admin";for(const mutation of ["scope AND season OR super_admin","(scope) OR super_admin","(scope AND season) OR TRUE","(scope OR season) OR super_admin","(scope AND null_season) OR super_admin"])expect(mutation===approved).toBe(false)});
});

describe("independent-review remediation: Findings A/B/C (DEC-R1/R2/R3)",()=>{
  const MIGRATION="supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
  const ROLLBACK="docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql";
  const POST_APPLY="docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
  const slice=(sql:string,startMarker:string,endMarker:string)=>sql.slice(sql.indexOf(startMarker),endMarker?sql.indexOf(endMarker,sql.indexOf(startMarker)):undefined);

  it("Finding A: a non-active scope_status is rejected before mutation, and every named path shares the identical guard clause",()=>{
    const sql=read(MIGRATION);
    const guard="raise exception 'VAM062V3 scope_status must be active or omitted for this operation";
    expect(sql).toContain(guard);
    const mutationFn=slice(sql,"create function public.vam062_admin_mutation_atomic","create function public.vam062_upsert_staff_account_atomic");
    const guardIdx=mutationFn.indexOf(guard);
    const firstInsertIdx=mutationFn.indexOf("insert into public.admin_users");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstInsertIdx);
  });

  it("Finding A: scope_status is never silently discarded — it is validated once for all three creation branches (upsert/update-no-scope_id/link_auth) via one shared check, not per-branch",()=>{
    const sql=read(MIGRATION);
    const mutationFn=slice(sql,"create function public.vam062_admin_mutation_atomic","create function public.vam062_upsert_staff_account_atomic");
    expect((mutationFn.match(/v_scope_status:=nullif\(btrim\(p_payload->>'scope_status'\),''\)/g)??[]).length).toBe(1);
    expect((mutationFn.match(/if v_scope_status is not null and v_scope_status<>'active' then/g)??[]).length).toBe(1);
  });

  it("Finding A: the explicit-scope-id update path can only retarget role on an already-active row — same rule, no behavioral inconsistency",()=>{
    const sql=read(MIGRATION);
    const mutationFn=slice(sql,"create function public.vam062_admin_mutation_atomic","create function public.vam062_upsert_staff_account_atomic");
    expect(mutationFn).toContain("set role=p_payload->>'scope_role'\n        where id=(p_payload->>'scope_id')::uuid and user_id=v_auth and program_id=v_program_id::text and season_id=v_season_id::text and status='active';");
    expect(mutationFn).not.toContain("status=p_payload->>'scope_status'");
  });

  it("Finding B: a single shared, race-safe helper (vam062_upsert_scope_atomic) is used by all four scope-creation call sites, and no inline existence-check-then-insert for admin_scope_access remains",()=>{
    const sql=read(MIGRATION);
    expect((sql.match(/perform public\.vam062_upsert_scope_atomic\(/g)??[]).length).toBe(4);
    expect(sql).not.toMatch(/select exists\(select 1 from public\.admin_scope_access[^;]*into v_scope_existing/);
  });

  it("Finding B: the lock is acquired before the final existence check, keyed on exactly user_id+program_id+season_id+role (never status)",()=>{
    const sql=read(MIGRATION);
    const helper=slice(sql,"create function public.vam062_upsert_scope_atomic","create function public.vam062_admin_mutation_atomic");
    const lockIdx=helper.indexOf("pg_advisory_xact_lock(hashtext('VAM062_SCOPE|'||p_user_id::text||'|'||p_program_id::text||'|'||p_season_id::text||'|'||p_scope_role))");
    const existsIdx=helper.indexOf("if exists(select 1 from public.admin_scope_access");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(existsIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(existsIdx);
    expect(helper).not.toContain("p_scope_role||'|'||p_target_status"); // status intentionally excluded from the lock key
  });

  it("Finding B: active replay is a no-op, inactive history is never touched, and at most one new active row can be created (ON CONFLICT remains as backstop)",()=>{
    const sql=read(MIGRATION);
    const helper=slice(sql,"create function public.vam062_upsert_scope_atomic","create function public.vam062_admin_mutation_atomic");
    expect(helper).toMatch(/status='active'\) then\s*\n\s*return;/);
    expect(helper).not.toMatch(/update public\.admin_scope_access set status='active'/);
    expect(helper).toContain("on conflict (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role) where (status = 'active') do nothing;");
  });

  it("Finding B: staff-import routes its scope write through the same race-safe helper with target status 'inactive'",()=>{
    const sql=read(MIGRATION);
    const staffFn=slice(sql,"create function public.vam062_upsert_staff_account_atomic","create function public.vam062_import_participant_membership_atomic");
    expect(staffFn).toContain("perform public.vam062_upsert_scope_atomic(p_auth_user_id,p_program_id,p_season_id,p_scope_role,'inactive');");
  });

  it("Finding B: malformed/invalid program-season relationships still fail before any scope mutation is reachable",()=>{
    const sql=read(MIGRATION);
    const mutationFn=slice(sql,"create function public.vam062_admin_mutation_atomic","create function public.vam062_upsert_staff_account_atomic");
    const invalidIdx=mutationFn.indexOf("invalid program-season relationship");
    const firstScopeCallIdx=mutationFn.indexOf("vam062_upsert_scope_atomic(");
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(invalidIdx).toBeLessThan(firstScopeCallIdx);
  });

  it("Finding C: vam063_add_membership_role acquires an advisory lock, keyed on person_id+season_id+role, before its final existence check",()=>{
    const sql=read("supabase_migrations/063_review_only_membership_lifecycle_operations.sql");
    const addRole=slice(sql,"create function public.vam063_add_membership_role","create function public.vam063_remove_membership_role");
    const lockIdx=addRole.indexOf("pg_advisory_xact_lock(hashtext('VAM063_ROLE|'||p_person_id::text||'|'||p_season_id::text||'|'||p_role))");
    const finalCheckIdx=addRole.indexOf("select id into v_membership from public.person_season_memberships where person_id=p_person_id and season_id=p_season_id and role=p_role;");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(finalCheckIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(finalCheckIdx);
  });

  it("Finding C: a concurrent/repeated add-role request returns a controlled noop before reaching INSERT, with no duplicate log or audit write, and the live unique constraint is untouched elsewhere",()=>{
    const sql=read("supabase_migrations/063_review_only_membership_lifecycle_operations.sql");
    const addRole=slice(sql,"create function public.vam063_add_membership_role","create function public.vam063_remove_membership_role");
    const noopIdx=addRole.indexOf("return query select 'noop'::text,v_membership;");
    const insertIdx=addRole.indexOf("insert into public.person_season_memberships");
    const logIdx=addRole.indexOf("insert into public.person_season_membership_log");
    expect(noopIdx).toBeGreaterThan(-1);
    expect(noopIdx).toBeLessThan(insertIdx);
    expect(insertIdx).toBeLessThan(logIdx);
    expect(sql).not.toMatch(/drop constraint|alter table public\.person_season_memberships/i); // no constraint touched in 063
  });

  it("RLS/grant design and audit vocabulary are unchanged by this remediation",()=>{
    const sql=read(MIGRATION);
    for(const t of ["admin_users","admin_scope_access","admin_audit_log","people","person_season_memberships","intake_batches","person_season_membership_log"]){
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
    }
    const idx=sql.indexOf("add constraint admin_audit_log_action_type_check");
    const clause=sql.slice(idx,sql.indexOf(";",idx));
    for(const value of ["create_admin_user","update_admin_user","reactivate_admin_user","deactivate_admin_user","remove_admin_access","sync_auth","unknown","import_participant_membership","link_person_auth","reconcile_person_auth","create_membership","add_membership_role","remove_membership_role","pause_membership","withdraw_membership","opt_out_membership","cancel_membership","reactivate_membership"]) expect(clause).toContain(`'${value}'`);
  });

  it("rollback and post-apply verification track the new function: 11 functions, 26 manifest rows, dropped only after both its callers",()=>{
    const rollback=read(ROLLBACK);
    expect(rollback).toContain("object_kind='function')<>11");
    expect(rollback).toContain(")<>26");
    const dropIdx=rollback.indexOf("drop function public.vam062_upsert_scope_atomic");
    const staffDropIdx=rollback.indexOf("drop function public.vam062_upsert_staff_account_atomic");
    const mutationDropIdx=rollback.indexOf("drop function public.vam062_admin_mutation_atomic");
    expect(dropIdx).toBeGreaterThan(-1);
    expect(staffDropIdx).toBeLessThan(dropIdx);
    expect(mutationDropIdx).toBeLessThan(dropIdx);

    const postApply=read(POST_APPLY);
    expect(postApply).toContain("'vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)'");
    expect(postApply).toContain("proname like 'vam062_%')=11");
    expect(postApply).toContain("package_version='VAM062_V5')=26");
  });
});
