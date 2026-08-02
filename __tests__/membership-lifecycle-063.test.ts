import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const PREFLIGHT = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql";
const ROLLBACK = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_ROLLBACK.sql";
const POST_APPLY = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_POST_APPLY_VERIFY.sql";

describe("migration 063 — membership lifecycle package (review-only, not applied)", () => {
  it("declares its dependency on migration 062 V3 before creating anything", () => {
    const sql = read(MIGRATION);
    const guardIdx = sql.indexOf("vam062_current_admin_id");
    const firstFunctionIdx = sql.indexOf("create function public.vam063_");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstFunctionIdx);
    expect(sql).toContain("requires migration 062 V3 to already be applied");
  });

  it("never issues DELETE against membership, log, or people tables (DEC-08, no hard delete)", () => {
    const sql = read(MIGRATION);
    expect(sql).not.toMatch(/delete\s+from\s+public\.(person_season_memberships|person_season_membership_log|people)\b/i);
  });

  it("every status-transition entry point routes through the single shared core function", () => {
    const sql = read(MIGRATION);
    for (const fn of ["vam063_pause_membership", "vam063_withdraw_membership", "vam063_opt_out_membership", "vam063_cancel_membership", "vam063_reactivate_membership", "vam063_remove_membership_role"]) {
      const start = sql.indexOf(`create function public.${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const end = sql.indexOf("$$;", start);
      expect(sql.slice(start, end)).toContain("vam063_transition_membership_atomic(");
    }
  });

  it("the shared core writes a person_season_membership_log row and an admin_audit_log row for every real transition", () => {
    const sql = read(MIGRATION);
    const core = sql.slice(sql.indexOf("create function public.vam063_transition_membership_atomic"), sql.indexOf("create function public.vam063_pause_membership"));
    expect(core).toContain("insert into public.person_season_membership_log");
    expect(core).toContain("insert into public.admin_audit_log");
    expect(core).toContain("membership_id,person_id,program_id,season_id,role,old_status,new_status,transition_type,reason,changed_by");
  });

  it("the shared core is idempotent: already-in-target-state returns a no-op before any write", () => {
    const sql = read(MIGRATION);
    const core = sql.slice(sql.indexOf("create function public.vam063_transition_membership_atomic"), sql.indexOf("create function public.vam063_pause_membership"));
    const noopIdx = core.indexOf("'noop'");
    const updateIdx = core.indexOf("update public.person_season_memberships set status=p_to_status");
    expect(noopIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(noopIdx).toBeLessThan(updateIdx);
  });

  it("remove-role transitions to cancelled and requires a reason; add-role never touches other roles", () => {
    const sql = read(MIGRATION);
    const removeRole = sql.slice(sql.indexOf("create function public.vam063_remove_membership_role"), sql.indexOf("revoke all on function"));
    expect(removeRole).toContain("'cancelled'");
    expect(removeRole).toContain(",true)"); // p_reason_required=true
    const addRole = sql.slice(sql.indexOf("create function public.vam063_add_membership_role"), sql.indexOf("create function public.vam063_remove_membership_role"));
    expect(addRole).not.toMatch(/update\s+public\.person_season_memberships\s+set\s+status/i);
    expect(addRole).toContain("insert into public.person_season_memberships");
    expect(addRole).toContain("'active'");
  });

  it("add-role validates active program-season relationship and cross-program reassignment before any write", () => {
    const sql = read(MIGRATION);
    const addRole = sql.slice(sql.indexOf("create function public.vam063_add_membership_role"), sql.indexOf("create function public.vam063_remove_membership_role"));
    const validIdx = addRole.indexOf("invalid active program-season relationship");
    const crossIdx = addRole.indexOf("cross-program reassignment denied");
    const insertIdx = addRole.indexOf("insert into public.person_season_memberships");
    expect(validIdx).toBeGreaterThan(-1);
    expect(crossIdx).toBeGreaterThan(-1);
    expect(validIdx).toBeLessThan(insertIdx);
    expect(crossIdx).toBeLessThan(insertIdx);
  });

  it("every entry point enforces scope authorization (super_admin or matching active admin_scope_access) before mutating", () => {
    const sql = read(MIGRATION);
    const core = sql.slice(sql.indexOf("create function public.vam063_transition_membership_atomic"), sql.indexOf("create function public.vam063_pause_membership"));
    expect(core).toContain("vam063_authorized_for_scope(p_actor_admin_user_id,v_program_id,v_season_id)");
    const authFn = sql.slice(sql.indexOf("create function public.vam063_authorized_for_scope"), sql.indexOf("create function public.vam063_transition_membership_atomic"));
    expect(authFn).toContain("super_admin");
    expect(authFn).toContain("s.program_id=p_program_id::text and s.season_id=p_season_id::text");
  });

  it("no vam063_ function grants execute to anon or authenticated; only the seven entry points reach service_role", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("revoke all on function public.vam063_authorized_for_scope");
    expect(sql).not.toMatch(/grant execute[^;]*vam063_authorized_for_scope[^;]*to (anon|authenticated)/i);
    expect(sql).not.toMatch(/grant execute[^;]*vam063_transition_membership_atomic[^;]*to (anon|authenticated)/i);
    const grantLine = sql.slice(sql.indexOf("grant execute on function public.vam063_pause_membership"));
    expect(grantLine).toContain("to service_role");
  });

  it("preflight checks migration 062 V3's corrected arbiter and hardened RLS as hard prerequisites, not just table existence", () => {
    const sql = read(PREFLIGHT);
    expect(sql).toContain("prerequisite:migration_062_v3_applied");
    expect(sql).toContain("prerequisite:admin_scope_access_corrected_arbiter");
    expect(sql).toContain("prerequisite:membership_rls_enabled");
    expect(sql).toContain("prerequisite:action_type_vocabulary");
  });

  it("rollback refuses to drop a partial or drifted function set and never touches business tables or rows", () => {
    const sql = read(ROLLBACK);
    expect(sql).toContain("refusing to drop a partial/unknown package state");
    expect(sql).toContain("refusing to drop");
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.(person_season_memberships|person_season_membership_log|admin_audit_log)/i);
    for (const fn of ["vam063_pause_membership", "vam063_withdraw_membership", "vam063_opt_out_membership", "vam063_cancel_membership", "vam063_reactivate_membership", "vam063_add_membership_role", "vam063_remove_membership_role", "vam063_transition_membership_atomic", "vam063_authorized_for_scope"]) {
      expect(sql).toContain(`drop function public.${fn}`);
    }
  });

  it("post-apply verification proves no DELETE exists in any deployed function body and that every transition path logs", () => {
    const sql = read(POST_APPLY);
    expect(sql).toContain("no_delete_in_any_function");
    expect(sql).toContain("transitions_always_log");
    expect(sql).toContain("prerequisite:migration_062_v3_still_applied");
  });
});
