import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const probe = readFileSync("docs/audits/sql/VAM_OS_MIGRATION_061_READONLY_SCHEMA_PROBE.sql", "utf8");
const runbook = readFileSync("docs/audits/VAM_OS_MIGRATION_061_SCHEMA_VERIFICATION_RUNBOOK_2026-07-22.md", "utf8");
const contract = readFileSync("docs/audits/VAM_OS_MIGRATION_061_EXPECTED_SCHEMA_CONTRACT_2026-07-22.md", "utf8");
const discrepancy = readFileSync("docs/audits/VAM_OS_MIGRATION_061_SCHEMA_DISCREPANCY_TEMPLATE_2026-07-22.md", "utf8");

function executableSql(sql: string) {
  return sql.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
}

describe("migration 061 read-only verification package", () => {
  it("contains no mutation, role switch, block, dynamic execute or temporary object SQL", () => {
    const code = executableSql(probe);
    expect(code).not.toMatch(/\b(create|alter|drop|insert|update|delete|truncate|grant|revoke|call|execute|do)\b/i);
    expect(code).not.toMatch(/\bset\s+role\b|\btemporary\b|\btemp\s+table\b|pg_advisory_/i);
    expect(code).toMatch(/^\s*(select|with)\b/im);
  });

  it("covers required tables and metadata/count sections", () => {
    for (const table of ["recruitment_campaigns","applications","programs","seasons","intake_batches","admin_scope_access","admin_users"]) expect(probe).toContain(table);
    for (const section of ["COLUMN","CONSTRAINTS","INDEXES","FUNCTIONS","TRIGGERS","RLS","GRANTS","MIGRATION","DATA-SHAPE"]) expect(probe.toUpperCase()).toContain(section);
  });

  it("does not select raw PII columns", () => {
    const code = executableSql(probe);
    expect(code).not.toMatch(/select\s+(?:[a-z]+\.)?(email_primary|full_name|phone|phone_number)\b/i);
    expect(code).not.toMatch(/select\s+\*\s+from\s+public\.(applications|people)/i);
    expect(probe).toContain("never returns raw email/name/phone");
  });

  it("requires confirmed staging and carries production warning", () => {
    expect(runbook).toContain("Confirm in writing that this project is **STAGING**");
    expect(runbook).toContain("**DO NOT RUN IN PRODUCTION UNTIL THE PROJECT IDENTITY IS CONFIRMED.**");
    expect(runbook).toContain("backup/snapshot");
  });

  it("covers the migration contract and five discrepancy states", () => {
    for (const term of ["recruitment_campaigns","Slug canonicalization","Duplicate unique index","Campaign scope function","Application governance function","RLS","Consent/reference","Scope immutability"]) expect(contract).toContain(term);
    for (const state of ["MATCH","EQUIVALENT","MISSING","CONFLICT","UNKNOWN"]) expect(discrepancy).toContain(state);
  });

  it("contains no secret values or database connection code", () => {
    const all = [probe,runbook,contract,discrepancy].join("\n");
    expect(all).not.toMatch(/(?:service_role|anon)_key\s*=|postgres(?:ql)?:\/\/|eyJ[a-zA-Z0-9_-]{20,}/);
    expect(all).not.toMatch(/createClient\s*\(|DATABASE_URL|new\s+Client\s*\(/);
  });

  it("is never imported or executed by application/test/build code", () => {
    expect(probe).not.toContain("\\copy");
    expect(probe).not.toContain("psql");
    expect(runbook).toContain("Run the complete query once");
  });
});
