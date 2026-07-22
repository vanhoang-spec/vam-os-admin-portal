import { readFileSync,readdirSync } from "node:fs";
import { describe,expect,it } from "vitest";

const dir="staging_bootstrap/design_only";
const sqlFiles=readdirSync(dir).filter(f=>f.endsWith(".sql"));
const contents=sqlFiles.map(f=>readFileSync(`${dir}/${f}`,"utf8"));
const combined=readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql","utf8");
const executable=combined.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''");

describe("manual staging baseline remediation",()=>{
  it("keeps every design module outside automatic migrations and unauthorized",()=>{
    expect(sqlFiles).toHaveLength(12);
    contents.forEach((body)=>{
      for(const mark of ["STAGING ONLY","DESIGN ONLY","NOT AUTHORIZED","NOT EXECUTED","MUST NEVER RUN ON PRODUCTION"]) expect(body).toContain(mark);
    });
    expect(dir.startsWith("supabase_migrations/")).toBe(false);
  });
  it("retains the unresolved table blocker without guessed metadata",()=>{
    const all=contents.join("\n");
    expect(all).toContain("numeric typmod for match_confidence");
    expect(all).toContain("Exact catalog metadata lacks numeric typmod");
    expect(all).not.toMatch(/CREATE TABLE\s+"public"\."matches"/i);
    expect(readFileSync(`${dir}/03_sequences.sql`,"utf8").replace(/--[^\n]*/g,"")).not.toMatch(/CREATE\s+SEQUENCE/i);
    expect(all).not.toMatch(/^\s*(insert|copy)\b/im);
  });
  it("excludes managed internals, data values, and migration 061",()=>{
    const all=contents.join("\n");
    expect(all).toContain("extension-managed routines are excluded");
    expect(all).toContain("Migration 061 security remains outside");
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    expect(all.replace(/--[^\n]*/g,"")).not.toMatch(/\b(auth|storage|vault)\s*\./i);
  });
  it("uses one catalog-only WITH SELECT and one JSON result",()=>{
    expect(executable.trim().toLowerCase().startsWith("with")).toBe(true);
    expect(executable.match(/;/g)).toHaveLength(1);
    expect(combined).toContain("baseline_gap_metadata");
    expect(executable).not.toMatch(/\b(create|alter|drop|insert|update|delete|truncate|grant|revoke|call|execute|do|copy)\b|\bset\s+role\b/i);
    expect(executable).not.toMatch(/\bpublic\s*\.\s*[a-z_]+/i);
  });
  it("does not call pg_get_functiondef for aggregates",()=>{
    expect(combined).toContain("p.prokind IN ('f','p','w')");
    expect(combined).not.toMatch(/prokind\s*=\s*'a'[\s\S]{0,300}pg_get_functiondef/i);
  });
});
