import { readFileSync,readdirSync } from "node:fs";
import { describe,expect,it } from "vitest";

const dir="staging_bootstrap/design_only";
const sqlFiles=readdirSync(dir).filter(f=>f.endsWith(".sql"));
const contents=sqlFiles.map(f=>readFileSync(`${dir}/${f}`,"utf8"));
const combined=readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql","utf8");
const executable=combined.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''");

describe("manual staging baseline remediation",()=>{
  it("keeps every design module outside automatic migrations and non-executable",()=>{
    expect(sqlFiles).toHaveLength(12);
    contents.forEach((body)=>{
      for(const mark of ["STAGING ONLY","DESIGN ONLY","NOT AUTHORIZED","NOT EXECUTED","MUST NEVER RUN ON PRODUCTION"]) expect(body).toContain(mark);
      expect(body.replace(/--[^\n]*/g,"").trim()).toBe("");
    });
    expect(dir.startsWith("supabase_migrations/")).toBe(false);
  });
  it("retains explicit blockers without guessed metadata",()=>{
    const all=contents.join("\n");
    expect(all).toContain("BLOCKED: enum labels/order");
    expect(all).toContain("BLOCKED: exact definitions/dependencies");
    expect(all).toContain("BLOCKED: public sequence parameters");
    expect(all).not.toMatch(/^\s*(insert|copy)\b/im);
  });
  it("excludes managed internals, data values, and migration 061",()=>{
    const all=contents.join("\n");
    expect(all).toContain("Exclude citext-owned functions");
    expect(all).toContain("Migration 061 remains separate");
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    expect(all).not.toMatch(/\b(auth|storage|vault)\s*\./i);
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
