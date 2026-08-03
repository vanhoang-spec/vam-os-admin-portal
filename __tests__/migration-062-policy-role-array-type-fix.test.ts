import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const MIGRATION_062 = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const PREFLIGHT_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql";
const POST_APPLY_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const ROLLBACK_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql";
const MEMBERSHIP_PREFLIGHT_063 = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql";

// Strips '--' line comments so assertions below are proven against the
// executable SQL body only, never satisfied by a match inside a comment.
const stripLineComments = (sql: string) =>
  sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

// A raw, uncast comparison of a pg_policies.roles-shaped identifier array
// against a bare ARRAY[...] literal or an unqualified CTE column reference —
// the exact shape that raised 42883: operator does not exist: name[] = text[].
const UNCAST_ROLES_COMPARISON = /\broles\s*=\s*(array\[|e\.roles\b)/i;
const UNCAST_ATTNAME_ARRAY = /array\(select a\.attname from unnest/i;

describe("migration 062 array-type remediation: pg_policies.roles name[] vs text[]", () => {
  it("1. migration 062's executable guard casts pg_policies.roles to text[] before every comparison to a text[] literal", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const guard = exec.slice(exec.indexOf("select string_agg(tablename"), exec.indexOf("if v_unexpected is not null"));
    const casts = guard.match(/roles::text\[\]\s*=\s*array\[[^\]]*\]::text\[\]/g) ?? [];
    expect(casts.length).toBe(4);
  });

  it("2. no executable name[]=text[] comparison remains in any reviewed SQL source file", () => {
    for (const path of [MIGRATION_062, PREFLIGHT_062, POST_APPLY_062, ROLLBACK_062, MEMBERSHIP_PREFLIGHT_063, MIGRATION_063]) {
      const exec = stripLineComments(read(path));
      expect(exec).not.toMatch(UNCAST_ROLES_COMPARISON);
      expect(exec).not.toMatch(UNCAST_ATTNAME_ARRAY);
    }
    // the corrected forms must actually be present where the bug used to live
    expect(stripLineComments(read(MIGRATION_062))).toMatch(/roles::text\[\]\s*=\s*array\[/);
    expect(stripLineComments(read(PREFLIGHT_062))).toContain("p.roles::text[]=e.roles");
    expect(stripLineComments(read(PREFLIGHT_062))).toContain("array(select a.attname::text from unnest");
    expect(stripLineComments(read(POST_APPLY_062))).toContain("p.roles::text[]=array['authenticated']::text[]");
    expect(stripLineComments(read(POST_APPLY_062))).toContain("p.roles::text[]=e.roles");
  });

  it("3. both public and authenticated role arrays are checked exactly, on both sides of the cast, for every one of the four tolerated policies", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const guard = exec.slice(exec.indexOf("select string_agg(tablename"), exec.indexOf("if v_unexpected is not null"));
    expect((guard.match(/roles::text\[\]=array\['public'\]::text\[\]/g) ?? []).length).toBe(3);
    expect((guard.match(/roles::text\[\]=array\['authenticated'\]::text\[\]/g) ?? []).length).toBe(1);
  });

  it("4. the four-tuple pre-existing-policy allow-list is unchanged in every other respect: name, table, permissive, cmd, qual, with_check", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const guard = exec.slice(exec.indexOf("select string_agg(tablename"), exec.indexOf("if v_unexpected is not null"));
    const tolerated = guard.match(/tablename='[^']+' and policyname='[^']+'/g) ?? [];
    expect(tolerated).toEqual([
      "tablename='admin_users' and policyname='read_admin_users_super_admin_or_self'",
      "tablename='admin_users' and policyname='active admins can read themselves'",
      "tablename='admin_scope_access' and policyname='read_admin_scope_access_self_or_super_admin'",
      "tablename='admin_audit_log' and policyname='read_admin_audit_log_super_admin_only'",
    ]);
    for (const field of ["permissive='PERMISSIVE'", "cmd='SELECT'", "with_check is null", "qual="]) {
      expect(guard.split(field).length - 1).toBe(4);
    }
    expect(guard).toContain("qual='(((auth.uid() = auth_user_id) AND (status = ''active''::text)) OR (current_admin_role() = ''super_admin''::text))'");
    expect(guard).toContain("qual='((auth_user_id = auth.uid()) AND (status = ''active''::text))'");
    expect(guard).toContain("qual='((current_admin_role() = ''super_admin''::text) OR (is_active_admin() AND (user_id = auth.uid()) AND (status = ''active''::text)))'");
    expect(guard).toContain("qual='(current_admin_role() = ''super_admin''::text)'");
  });

  it("5. unknown/unsafe/materially-different policies still fail closed: no count-only shortcut, no wildcard bypass, cast did not loosen the guard", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const guard = exec.slice(exec.indexOf("select string_agg(tablename"), exec.indexOf("if v_unexpected is not null then raise exception"));
    expect(guard).not.toMatch(/\btrue\b/);
    expect(guard).not.toMatch(/1\s*=\s*1/);
    expect(guard).not.toMatch(/roles\s+is\s+not\s+null/i);
    expect(exec).toContain("raise exception 'VAM062V3 unexpected existing policies: %',v_unexpected;");
  });

  it("6. assertions above are proven against executable SQL, not merely a mention in a comment", () => {
    const raw = read(MIGRATION_062);
    const exec = stripLineComments(raw);
    // the corrected cast must survive comment-stripping (i.e. it is code, not documentation)
    expect(exec).toContain("roles::text[]=array['public']::text[]");
    // sanity check that stripLineComments actually removes comment-only content
    expect(stripLineComments("-- roles=array['public'] mentioned only in a comment\nselect 1;")).not.toContain("roles=array");
    expect(raw).toContain("-- Explicit grant hardening"); // comments still present in the raw file, proving the strip step is meaningful
  });

  it("7. migration 063 source has no pg_policies.roles reference at all (no confirmed equivalent array-type defect was found there); its only change since this array-type remediation's baseline is the unrelated, separately-confirmed pg_index column-name fix", () => {
    const sql = read(MIGRATION_063);
    expect(sql).not.toMatch(/pg_policies/i);
    expect(sql).not.toMatch(/\.roles\b/);
    const baselineHead = "6644e993a40efda720396714cd12b62c611ab358";
    const result = spawnSync("git", ["show", `${baselineHead}:${MIGRATION_063}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const beforeLines = result.stdout.split("\n");
    const afterLines = sql.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    const diffLines = beforeLines.filter((line, i) => line !== afterLines[i]);
    expect(diffLines.length).toBe(1);
    expect(diffLines[0]).toContain("indisnullsnotdistinct");
  });

  it("rollback has no name[]/text[] mismatch and differs from its baseline only by the reviewed constraint-guard normalization", () => {
    const baselineHead = "5d80c53a5f00c096987f29f70f762350876b4633";
    const result = spawnSync("git", ["show", `${baselineHead}:${ROLLBACK_062}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const before = result.stdout;
    const after = read(ROLLBACK_062);
    const oldCatalogLine = "    select 1 from pg_constraint c where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and c.contype='c'";
    const newCatalogLine = `${oldCatalogLine} and c.convalidated=false`;
    const actionTypes = ["create_admin_user", "update_admin_user", "reactivate_admin_user", "deactivate_admin_user", "remove_admin_access", "sync_auth", "unknown", "import_participant_membership", "link_person_auth", "reconcile_person_auth", "create_membership", "add_membership_role", "remove_membership_role", "pause_membership", "withdraw_membership", "opt_out_membership", "cancel_membership", "reactivate_membership"];
    const definition = `CHECK (action_type = ANY (ARRAY[${actionTypes.map((value) => `''${value}''::text`).join(", ")}])) NOT VALID`;
    const oldDefinitionLine = `      and pg_get_constraintdef(c.oid)='${definition}'`;
    const newDefinitionLine = `      and pg_get_constraintdef(c.oid, true)='${definition}'`;
    expect(before.split(oldCatalogLine).length - 1).toBe(1);
    expect(before.split(oldDefinitionLine).length - 1).toBe(1);
    expect(after).toBe(before.replace(oldCatalogLine, newCatalogLine).replace(oldDefinitionLine, newDefinitionLine));
    const exec = stripLineComments(after);
    const guardStart = exec.indexOf("select 1 from pg_constraint c where c.conrelid='public.admin_audit_log'::regclass");
    const guard = exec.slice(guardStart, exec.indexOf("then raise exception 'VAM062V3 action_type constraint", guardStart));
    expect(guard).toContain("c.conname='admin_audit_log_action_type_check'");
    expect(guard).toContain("c.contype='c'");
    expect(guard).toContain("c.convalidated=false");
    expect(guard).toContain(`pg_get_constraintdef(c.oid, true)='${definition}'`);
    expect(guard).not.toMatch(/pg_get_constraintdef\(c\.oid\)(?!\s*,)/);
    expect(Array.from(definition.matchAll(/''([^']+)''::text/g), (match) => match[1])).toEqual(actionTypes);
    expect(definition).toContain("NOT VALID");
    expect(exec).not.toMatch(UNCAST_ROLES_COMPARISON);
    expect(exec).not.toMatch(UNCAST_ATTNAME_ARRAY);
  });

  it("membership-lifecycle-063 preflight source was audited and confirmed to have no name[]/text[] mismatch; its only later change is the unrelated, separately-confirmed pg_index column-name fix", () => {
    const baselineHead = "5d80c53a5f00c096987f29f70f762350876b4633";
    const result = spawnSync("git", ["show", `${baselineHead}:${MEMBERSHIP_PREFLIGHT_063}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const beforeLines = result.stdout.split("\n");
    const afterLines = read(MEMBERSHIP_PREFLIGHT_063).split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    const diffLines = beforeLines.filter((line, i) => line !== afterLines[i]);
    expect(diffLines.length).toBe(1);
    expect(diffLines[0]).toContain("indisnullsnotdistinct");
  });
});
