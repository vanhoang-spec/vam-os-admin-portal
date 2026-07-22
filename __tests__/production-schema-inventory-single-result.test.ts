import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const probe=readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_SINGLE_RESULT_READONLY_PROBE.sql","utf8");
const evidence=readFileSync("docs/audits/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_PARTIAL_2026-07-22.md","utf8");
const executable=probe.replace(/--[^\n]*/g,"").replace(/'(?:''|[^'])*'/g,"''");
describe("single-result production schema inventory",()=>{
 it("is one SELECT/WITH read-only statement",()=>{expect(executable.trim().toLowerCase().startsWith("with")).toBe(true);expect(executable.match(/;/g)).toHaveLength(1);expect(executable).not.toMatch(/\b(create|alter|drop|insert|update|delete|truncate|grant|revoke|call|execute|do)\b|\bset\s+role\b|pg_advisory_/i)});
 it("returns all required JSON sections",()=>{for(const k of ["probe_version","target_identity","schemas","extensions","tables","columns","constraints","indexes","functions","aggregates","triggers","policies","table_grants","sequence_grants","function_grants","migration_provenance","table_estimates","safety_counts"])expect(probe).toContain("'"+k+"'")});
 it("guards aggregate definitions",()=>{const f=probe.split("functions_j as")[1].split("aggregates_j as")[0];expect(f).toContain("p.prokind in ('f','p','w')");const a=probe.split("aggregates_j as")[1].split("triggers_j as")[0];expect(a).toContain("p.prokind='a'");expect(a).not.toContain("pg_get_functiondef")});
 it("uses catalog-only provenance when ledger relations are absent",()=>{expect(probe).not.toContain("supabase_migrations.schema_migrations");expect(probe).not.toContain("migration_rows_j");expect(probe).toContain("'rows','[]'::jsonb");expect(probe).toContain("'status'");expect(probe).toContain("'not_evaluated_reason'");expect(probe).toContain("ledger_not_found_in_catalog")}); it("returns no raw PII",()=>{expect(executable).not.toMatch(/select\s+(?:[a-z]+\.)?(email|email_primary|full_name|phone|token)\b/i);expect(executable).not.toMatch(/select\s+\*\s+from\s+public\.(applications|people|application_answers)/i)});
 it("records only partial evidence and minus-one semantics",()=>{expect(evidence).toContain("not available yet");expect(evidence).toContain("not confirmed zero");expect(evidence).not.toContain("complete production inventory is available")});
});
