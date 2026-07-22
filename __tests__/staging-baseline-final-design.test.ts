import { readFileSync,readdirSync } from "node:fs";
import { describe,expect,it } from "vitest";

const moduleDir="staging_bootstrap/design_only";
const moduleFiles=readdirSync(moduleDir).filter((name)=>name.endsWith(".sql")).sort();
const modules=Object.fromEntries(moduleFiles.map((name)=>[name,readFileSync(`${moduleDir}/${name}`,"utf8")]));
const allModules=Object.values(modules).join("\n");
const executable=(text:string)=>text.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''");
const security=readFileSync("docs/audits/VAM_OS_SECURITY_DEFINER_OWNER_DECISION_2026-07-22.md","utf8");

describe("staging baseline final design safeguards",()=>{
  it("keeps all twelve modules visibly unauthorized and outside migration paths",()=>{
    expect(moduleFiles).toHaveLength(12);
    for(const body of Object.values(modules)) for(const marker of ["STAGING ONLY","DESIGN ONLY","NOT AUTHORIZED","NOT EXECUTED","MUST NEVER RUN ON PRODUCTION"]) expect(body).toContain(marker);
    expect(moduleDir).not.toMatch(/^supabase_migrations(?:\/|$)/);
  });

  it("renders only supported table DDL and defers all foreign keys",()=>{
    const tables=modules["04_tables.sql"];
    expect(executable(tables).match(/CREATE TABLE/gi)?.length).toBe(22);
    expect(tables).not.toMatch(/CREATE TABLE\s+"public"\."matches"/i);
    expect(executable(tables)).not.toMatch(/FOREIGN KEY/i);
    expect(executable(modules["05_constraints.sql"])).toMatch(/ALTER TABLE[\s\S]*FOREIGN KEY/i);
    expect(allModules).not.toMatch(/CREATE TABLE\s+"public"\."staging_/i);
  });

  it("contains no platform DDL, copied identities, emails, or data inserts",()=>{
    const code=executable(allModules);
    expect(code).not.toMatch(/\b(?:auth|storage|realtime|vault|pg_toast)\s*\./i);
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(code).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    expect(code).not.toMatch(/\b(?:INSERT|COPY)\b/i);
    expect(executable(modules["03_sequences.sql"])).not.toMatch(/CREATE\s+SEQUENCE/i);
  });

  it("keeps security implementation behind explicit owner decisions",()=>{
    for(const name of ["admin_can_access_season","current_admin_context","current_admin_role","get_founder_intelligence_dashboard","get_operations_dashboard_data","is_active_admin","is_admin_role"]) expect(security).toContain(name);
    expect(security).toContain("OWNER APPROVAL REQUIRED");
    expect(security).toContain("search_path");
    expect(executable(modules["11_grants.sql"])).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(executable(modules["10_rls_policies.sql"])).not.toMatch(/\bCREATE\s+POLICY\b/i);
  });

  it("excludes migration 061 and adds no execution tooling",()=>{
    expect(allModules).toContain("Migration 061");
    expect(allModules).not.toContain("recruitment_campaign_id");
    const pkg=JSON.parse(readFileSync("package.json","utf8")) as {scripts:Record<string,string>};
    expect(Object.keys(pkg.scripts).some((name)=>/(bootstrap|baseline|sql|seed|migrat)/i.test(name))).toBe(false);
  });
});
