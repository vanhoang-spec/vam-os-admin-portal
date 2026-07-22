import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const seed=readFileSync("scripts/seed_demo_s12_data.mjs","utf8");
const probe=readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql","utf8");
const probeCode=probe.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''");

describe("support UAT and demo readiness",()=>{
  it("keeps demo writes staging-only and fail-closed",()=>{
    expect(seed).toContain('STAGING_PROJECT_REF = "ljfneyuvpxrmejpxsmpz"');
    expect(seed).toContain('PRODUCTION_PROJECT_REF = "qkkroesfiazsejkzflcd"');
    expect(seed).toContain("Production project is permanently forbidden");
    expect(seed).toContain("--confirm-staging-authorization");
    expect(seed).toContain("hostRef !== STAGING_PROJECT_REF || targetProjectRef !== STAGING_PROJECT_REF");
  });
  it("limits cleanup to rows explicitly tagged by the demo seed",()=>{
    expect(seed).toContain('.eq("source_sheets", "DEMO_SEED")');
    expect(seed).not.toContain('.like("email_primary", "%@example.com")');
  });
  it("preserves dry-run as the default",()=>{
    expect(seed).toContain("const isDryRun = args.length === 0");
    expect(seed).toContain("if (isDryRun)");
  });
  it("keeps the baseline-gap probe one-result and read-only",()=>{
    expect(probeCode.trim().toLowerCase().startsWith("with")).toBe(true);
    expect(probeCode.match(/;/g)).toHaveLength(1);
    expect(probe).toContain("baseline_gap_metadata");
    expect(probeCode).not.toMatch(/\b(create|alter|drop|insert|update|delete|truncate|copy|call|execute|do)\b/i);
  });
});
