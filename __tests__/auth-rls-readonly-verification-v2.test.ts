import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_RLS_READONLY_VERIFICATION_V2.sql";
const probe = readFileSync(SQL_PATH, "utf8");

// Strip single-line comments and string literals to inspect executable content
const executable = probe
  .replace(/--[^\n]*/g, "")
  .replace(/'(?:''|[^'])*'/g, "''");

const REQUIRED_SECTION_KEYS = [
  "rv1_core_rls",
  "rv2_policies",
  "rv3_function_security",
  "rv4_function_privileges",
  "rv5_people_auth_column",
  "rv6_admin_users_rls",
  "rv7_disabled_tables",
  "rv8_unprotected_tables",
  "rv9_audit_constraints",
  "rv10_people_indexes",
  "rv11_approx_row_counts",
  "rv12_audit_action_types",
  "rv13_sprint1b_rls",
];

describe("Auth RLS readonly verification V2", () => {
  it("is a single WITH-based read-only statement", () => {
    // Must start with a CTE
    expect(executable.trim().toLowerCase().startsWith("with")).toBe(true);
    // Exactly one semicolon: the terminal one
    expect(executable.match(/;/g)).toHaveLength(1);
    // No mutation keywords in executable SQL
    expect(executable).not.toMatch(
      /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call)\b|\bdo\s*\$|\bset\s+role\b/i
    );
  });

  it("returns exactly one JSONB column named verification_result", () => {
    expect(probe).toContain("as verification_result");
    expect(probe).toMatch(/select\s+jsonb_build_object\s*\(/i);
  });

  it("contains probe version V2 sentinel", () => {
    expect(probe).toContain("VAM_OS_AUTH_RLS_READONLY_VERIFICATION_V2");
  });

  it("contains all 13 required section keys", () => {
    for (const key of REQUIRED_SECTION_KEYS) {
      expect(probe, `missing section key: '${key}'`).toContain(`'${key}'`);
    }
  });

  it("summary declares sections_present 13 and read_only true", () => {
    const summaryBlock = probe.split("'summary'")[1] ?? "";
    expect(summaryBlock).toContain("'sections_present'");
    expect(summaryBlock).toContain("13");
    expect(summaryBlock).toContain("'read_only'");
    expect(summaryBlock).toContain("true");
  });

  it("uses structural boolean flags for policy expressions (no raw qual/with_check values returned)", () => {
    // Required structural keys must be present
    expect(probe).toContain("'using_present'");
    expect(probe).toContain("'with_check_present'");
    expect(probe).toContain("'broad_true_condition'");
    expect(probe).toContain("'references_admin_helper'");
    // V1 returned raw expressions under these aliases — V2 must not
    expect(probe).not.toMatch(/'using_expression'\s*,\s*(?:p\.|)qual/i);
    expect(probe).not.toMatch(/'with_check'\s*,\s*(?:p\.|)with_check\b(?!\s*is)/i);
  });

  it("uses catalog-only sources for row counts — no direct public table scan in rv11", () => {
    // Must use pg_class.reltuples, not COUNT(*) from public tables
    expect(probe).toContain("reltuples");
    const rv11Section = probe.split("-- rv11")[1]?.split("-- rv12")[0] ?? "";
    expect(rv11Section).not.toMatch(/count\s*\(\s*\*\s*\)\s+from\s+public\./i);
  });

  it("does not select raw PII columns from data tables", () => {
    // No direct SELECT of personal identifiers
    expect(executable).not.toMatch(
      /select\s+(?:[a-z_]+\.)?(email|full_name|phone|password|token)\b/i
    );
    // No SELECT * from data tables
    expect(executable).not.toMatch(
      /select\s+\*\s+from\s+public\.(people|admin_users|applications|mentoring_recaps|event_participations)/i
    );
  });

  it("does not embed credentials or connection identifiers", () => {
    // No Supabase database connection string
    expect(probe).not.toMatch(/postgresql:\/\//i);
    expect(probe).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(probe).not.toMatch(/PGPASSWORD/i);
    // No password-style assignment
    expect(probe).not.toMatch(/password\s*=\s*\S/i);
  });

  it("header declares DESIGN ONLY and NO DATABASE MUTATION", () => {
    expect(probe).toContain("DESIGN ONLY");
    expect(probe).toContain("NO DATABASE MUTATION");
    expect(probe).toContain("OWNER-RUN READ-ONLY VERIFICATION");
    expect(probe).toContain("SAFE FOR SUPABASE SQL EDITOR");
  });
});
