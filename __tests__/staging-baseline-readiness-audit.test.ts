import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const staging=readFileSync("docs/audits/sql/VAM_OS_STAGING_BASELINE_READONLY_PROBE.sql","utf8");
const production=readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_READONLY_PROBE.sql","utf8");
const plan=readFileSync("docs/audits/VAM_OS_STAGING_BASELINE_BOOTSTRAP_PLAN_2026-07-22.md","utf8");
const incident=readFileSync("docs/audits/VAM_OS_STAGING_MIGRATION_061_FAILED_PREFLIGHT_INCIDENT_2026-07-22.md","utf8");
function code(s:string){return s.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''")}
describe("staging baseline readiness package",()=>{
 it("keeps both probes SELECT/WITH only",()=>{for(const p of [staging,production])expect(code(p)).not.toMatch(/\b(create|alter|drop|insert|update|delete|truncate|grant|revoke|call|execute|do)\b|\bset\s+role\b/i)});
 it("does not select raw PII",()=>{for(const p of [staging,production]){expect(code(p)).not.toMatch(/select\s+(?:[a-z]+\.)?(email|email_primary|name|full_name|phone|token)\b/i);expect(code(p)).not.toMatch(/select\s+\*\s+from\s+(public\.)?(people|applications|mentor_profiles|mentee_profiles)/i)}});
 it("covers every core table",()=>{for(const t of ["programs","seasons","intake_batches","people","mentor_profiles","mentee_profiles","applications","matches","events","event_registrations","admin_users","admin_scope_access"])expect(staging).toContain(t)});
 it("forbids execution and requires separate production authorization",()=>{expect(plan).toContain("Execution Commands - NOT AUTHORIZED");expect(plan).toContain("AUTHORIZE READ-ONLY PRODUCTION SCHEMA INVENTORY");expect(production).toContain("DO NOT RUN without the exact phrase")});
 it("keeps migration 061 unauthorized",()=>{expect(plan).toContain("None is granted here");expect(incident).toContain("Migration 061 remains unauthorized")});
 it("contains no secret or connection pattern",()=>{const all=[staging,production,plan,incident].join("\n");expect(all).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL|SERVICE_ROLE_KEY|ANON_KEY|eyJ[A-Za-z0-9_-]{20,}/)});
});
