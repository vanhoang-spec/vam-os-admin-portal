import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const VERIFIER = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const MIGRATION_062 = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const BASELINE_HEAD = "ac93c75adbe8802811c4663b84107bf2bfe517c2";
const read = (path: string) => readFileSync(path, "utf8");
const gitShow = (path: string) => {
  const result = spawnSync("git", ["show", `${BASELINE_HEAD}:${path}`], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout;
};
const executableSql = (sql: string) => sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

describe("migration 062 post-apply verifier information_schema identifier types", () => {
  it("casts every information_schema.columns identifier aggregate to text at extraction", () => {
    const sql = executableSql(read(VERIFIER));
    for (const identifier of ["column_name", "udt_name", "is_nullable"]) {
      expect(sql).toContain(`array_agg(x.${identifier}::text order by x.ordinal_position)`);
      expect(sql).not.toMatch(new RegExp(`array_agg\\(x\\.${identifier}\\s+order by`, "i"));
    }
  });

  it("leaves no sql_identifier[] to text[] equality in the table metadata assertion", () => {
    const sql = executableSql(read(VERIFIER));
    const tableActual = sql.slice(sql.indexOf("table_actual as("), sql.indexOf("assertions as("));
    expect(tableActual.match(/from information_schema\.columns/g)).toHaveLength(3);
    expect(tableActual.match(/array_agg\([^)]*::text order by/g)).toHaveLength(3);
    expect(tableActual).not.toMatch(/array_agg\(x\.(column_name|udt_name|is_nullable) order by/i);
  });

  it("changes only the three metadata-boundary casts from the reviewed verifier", () => {
    const before = gitShow(VERIFIER);
    const expected = before
      .replace("array_agg(x.column_name order by", "array_agg(x.column_name::text order by")
      .replace("array_agg(x.udt_name order by", "array_agg(x.udt_name::text order by")
      .replace("array_agg(x.is_nullable order by", "array_agg(x.is_nullable::text order by");
    expect(read(VERIFIER)).toBe(expected);
  });

  it("preserves the assertion body and one-row, one-column output contract", () => {
    const before = gitShow(VERIFIER);
    const after = read(VERIFIER);
    expect(after.slice(after.indexOf("assertions as("))).toBe(before.slice(before.indexOf("assertions as(")));
    expect(after.match(/\) account_rls_post_apply_v3 from summary;/g)).toHaveLength(1);
    expect(after).toContain("'overall_status',case when bool_and(not failed) then 'PASS' else 'FAIL' end");
    expect(after).toContain("'mismatches',coalesce(jsonb_agg(assertion order by assertion)filter(where failed),'[]'::jsonb)");
  });

  it("remains one read-only SELECT statement", () => {
    const sql = executableSql(read(VERIFIER)).trim();
    expect(sql).toMatch(/^with\b/i);
    expect(sql).toMatch(/\bselect\s+jsonb_build_object\(/i);
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).not.toMatch(/;\s*(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|copy)\b/i);
    expect(sql).not.toMatch(/\bauth\.users\b/i);
    expect(sql).not.toMatch(/\bmigration[_ -]?063\b/i);
  });
  it("does not change migration 062 or migration 063", () => {
    expect(read(MIGRATION_062)).toBe(gitShow(MIGRATION_062));
    expect(read(MIGRATION_063)).toBe(gitShow(MIGRATION_063));
  });
});
