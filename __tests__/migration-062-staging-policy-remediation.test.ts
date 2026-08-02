import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const MIGRATION = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const PREFLIGHT_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql";
const PREFLIGHT_063 = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql";
const POST_APPLY = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const ROLLBACK = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql";

const EMERGENCY_POLICY = "active admins can read themselves";
const HARDENED_SELF_READ_QUAL =
  "(((auth.uid() = auth_user_id) AND (status = 'active'::text)) OR (current_admin_role() = 'super_admin'::text))".replace(
    /'/g,
    "''",
  );

describe("staging preflight policy-blocker remediation (2026-08-02)", () => {
  it("1. migration 062's pre-execution guard accepts the exact emergency policy, roles=authenticated, with its live USING clause", () => {
    const sql = read(MIGRATION);
    const guard = sql.slice(sql.indexOf("v_unexpected"), sql.indexOf("if v_unexpected is not null"));
    expect(guard).toContain(`policyname='${EMERGENCY_POLICY}'`);
    expect(guard).toContain("roles=array['authenticated']");
    expect(guard).toContain("qual='((auth_user_id = auth.uid()) AND (status = ''active''::text))'");
  });

  it("2. migration 062's pre-execution guard accepts the current, hardened (status='active') definition of read_admin_users_super_admin_or_self, not the stale one", () => {
    const sql = read(MIGRATION);
    const guard = sql.slice(sql.indexOf("v_unexpected"), sql.indexOf("if v_unexpected is not null"));
    expect(guard).toContain(`qual='${HARDENED_SELF_READ_QUAL}'`);
    expect(guard).not.toContain("qual='((auth.uid() = auth_user_id) OR (current_admin_role() = ''super_admin''::text))'");
  });

  it("3. the guard fails closed on any unknown/unsafe/materially different policy: exactly 4 tolerated tuples, no count-only shortcut, no wildcard bypass", () => {
    const sql = read(MIGRATION);
    const guard = sql.slice(sql.indexOf("select string_agg(tablename"), sql.indexOf("if v_unexpected is not null then raise exception"));
    const tolerated = guard.match(/tablename='[^']+' and policyname='[^']+'/g) ?? [];
    expect(tolerated.length).toBe(4);
    expect(guard).not.toMatch(/\btrue\b/);
    expect(guard).not.toMatch(/1\s*=\s*1/);
    // structural per-policy fields must all be present for every tolerated tuple, not a bare name/count match
    for (const field of ["permissive='PERMISSIVE'", "cmd='SELECT'", "with_check is null", "qual="]) {
      expect(guard.split(field).length - 1).toBeGreaterThanOrEqual(4);
    }
    expect(sql).toContain("raise exception 'VAM062V3 unexpected existing policies: %',v_unexpected;");
  });

  it("4. migration 062 never drops or alters the emergency policy or the hardened predecessor policy; rollback does the same", () => {
    const migrationSql = read(MIGRATION);
    const rollbackSql = read(ROLLBACK);
    for (const sql of [migrationSql, rollbackSql]) {
      expect(sql).not.toMatch(new RegExp(`drop policy .*${EMERGENCY_POLICY}`, "i"));
      expect(sql).not.toMatch(/drop policy.*read_admin_users_super_admin_or_self/i);
      expect(sql).not.toMatch(/alter policy.*(active admins can read themselves|read_admin_users_super_admin_or_self)/i);
    }
    // rollback only ever drops the 7 vam062_-owned policies
    const dropped = Array.from(rollbackSql.matchAll(/drop policy (\S+) on/g)).map((m) => m[1]);
    expect(dropped.length).toBe(7);
    for (const name of dropped) expect(name.startsWith("vam062_")).toBe(true);
  });

  it("5. source preflight uses corrected nullability for all five columns previously over-strict relative to what 062 needs", () => {
    const sql = read(PREFLIGHT_062);
    expect(sql).toContain("('admin_scope_access','program_id','text',false,'NO','NEVER')");
    expect(sql).toContain("('admin_scope_access','season_id','text',false,'NO','NEVER')");
    expect(sql).toContain("('admin_users','id','uuid',true,'NO','NEVER')");
    expect(sql).toContain("('people','full_name','text',true,'NO','NEVER')");
    expect(sql).toContain("('seasons','program_id','uuid',true,'NO','NEVER')");
  });

  it("6 & 7. source preflight no longer requires admin_users PRIMARY KEY(id); it verifies email-PK and id-uniqueness as two separate, explicit assertions", () => {
    const sql = read(PREFLIGHT_062);
    const primaryKeysAssertion = sql.slice(sql.indexOf("union all select 'primary_keys',"), sql.indexOf("union all select 'primary_keys:admin_users_email_pk'"));
    expect(primaryKeysAssertion).toContain("r.name<>'admin_users'");
    expect(sql).toContain("'primary_keys:admin_users_email_pk'");
    expect(sql).toContain("PRIMARY KEY (email)");
    expect(sql).toContain("'primary_keys:admin_users_id_unique'");
    expect(sql).toContain("(select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[0])='id'");
  });

  it("8. action_type vocabulary is compared as a set of bare values, with NOT VALID checked as a separate assertion, in both the preflight and post-apply verification", () => {
    for (const path of [PREFLIGHT_062, POST_APPLY]) {
      const sql = read(path);
      expect(sql).toContain("action_type_vocabulary:values");
      expect(sql).toContain("action_type_vocabulary:not_valid");
      expect(sql).toContain("a.convalidated=false");
      expect(sql).not.toMatch(/'action_type_vocabulary',case when exists\(select 1 from pg_constraint where conrelid='public\.admin_audit_log'/);
    }
  });

  it("9. membership role/status vocabularies are compared as sets, keyed to the exact live constraint names, not raw substring matching", () => {
    const sql = read(PREFLIGHT_063);
    expect(sql).toContain("prerequisite:membership_role_vocabulary_full_exact");
    expect(sql).toContain("prerequisite:membership_status_vocabulary_full_exact");
    expect(sql).toContain("person_season_memberships_role_check");
    expect(sql).toContain("person_season_memberships_status_check");
    for (const role of ["mentee", "mentor", "supporter", "reviewer", "interviewer", "coreteam", "advisor", "alumni_mentee", "guest"]) {
      expect(sql).toContain(`('${role}')`);
    }
    for (const status of ["invited", "active", "paused", "withdrawn", "completed", "graduated", "opted_out", "cancelled"]) {
      expect(sql).toContain(`('${status}')`);
    }
    expect(sql).not.toContain("prerequisite:membership_status_vocabulary'");
  });

  it("10. post-apply verification proves both the emergency policy and the hardened predecessor policy still exist, plus every package-owned policy, from one shared expected_baseline source of truth", () => {
    const sql = read(POST_APPLY);
    expect(sql).toContain(`'admin_users','${EMERGENCY_POLICY}',array['authenticated']`);
    expect(sql).toContain(`array['public'],'${HARDENED_SELF_READ_QUAL}'`);
    expect(sql).toContain("expected_baseline(t,n,roles,q)");
    expect(sql).toContain("p.policyname not in(select n from expected_baseline)");
    expect(sql).toContain("union all select 'baseline_policy:'||e.n");
    expect(sql).toContain("union all select 'policy:'||e.n"); // package-owned vam062_* policies
  });

  it("11. no RLS or grant weakening was introduced: every enable-RLS and revoke/grant statement from before this remediation is unchanged", () => {
    const sql = read(MIGRATION);
    for (const t of [
      "admin_users",
      "admin_scope_access",
      "admin_audit_log",
      "people",
      "person_season_memberships",
      "intake_batches",
      "person_season_membership_log",
    ]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
    }
    expect(sql).toContain(
      "revoke all on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log from anon;",
    );
    expect(sql).toContain(
      "grant select on public.admin_users,public.admin_scope_access,public.admin_audit_log,public.people,public.person_season_memberships,public.intake_batches,public.person_season_membership_log to authenticated;",
    );
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)\s+on public\.admin_users.*to\s+(anon|authenticated)/i);
  });

  it("12. migration 063 source is byte-for-byte unchanged from the required baseline HEAD", () => {
    const baselineHead = "6644e993a40efda720396714cd12b62c611ab358";
    const result = spawnSync("git", ["show", `${baselineHead}:${MIGRATION_063}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(read(MIGRATION_063)).toBe(result.stdout);
  });
});
