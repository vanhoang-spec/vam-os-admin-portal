import { readFileSync,existsSync } from "node:fs";
import { describe,expect,it } from "vitest";
// @ts-expect-error Offline analyzer is intentionally plain ESM with no runtime dependency.
import { analyzeInventoryText,EXPECTED_SECTIONS } from "../scripts/analyze-production-schema-inventory.mjs";

const baselinePath="staging_bootstrap/VAM_OS_STAGING_SCHEMA_ONLY_BASELINE_DESIGN.sql";
const baseline=readFileSync(baselinePath,"utf8");
const runbook=readFileSync("docs/audits/VAM_OS_STAGING_SCHEMA_BOOTSTRAP_RUNBOOK_2026-07-22.md","utf8");
const scope=readFileSync("docs/audits/VAM_OS_STAGING_BASELINE_SCOPE_2026-07-22.md","utf8");
const comparison=readFileSync("docs/audits/VAM_OS_MIGRATION_061_PRODUCTION_COMPARISON_2026-07-22.md","utf8");
const manifest=JSON.parse(readFileSync("docs/audits/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_SANITIZED_MANIFEST_2026-07-22.json","utf8"));
const gitignore=readFileSync(".gitignore","utf8");

describe("production inventory and staging baseline design",()=>{
 it("parser consumes a complete top-level payload",()=>{const fixture=Object.fromEntries(EXPECTED_SECTIONS.map((k:string)=>[k,[]]));fixture.probe_version="test";const result=analyzeInventoryText(JSON.stringify(fixture));expect(result.json_valid).toBe(true);expect(result.truncated).toBe(false);expect(result.missing_sections).toEqual([])});
 it("records full local input integrity without committing raw JSON",()=>{expect(manifest.file_bytes).toBe(1527203);expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);expect(manifest.missing_sections).toEqual([]);expect(manifest.truncated).toBe(false);expect(gitignore).toContain("docs/audits/inputs/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_2026-07-22.json");if(existsSync("docs/audits/inputs/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_2026-07-22.json")){const raw=readFileSync("docs/audits/inputs/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_2026-07-22.json","utf8");expect(analyzeInventoryText(raw).sha256).toBe(manifest.sha256)}});
 it("contains no secret values in committed reports",()=>{const files=["docs/audits/VAM_OS_PRODUCTION_INVENTORY_INPUT_SAFETY_REVIEW_2026-07-22.md","docs/audits/VAM_OS_PRODUCTION_SCHEMA_INVENTORY_2026-07-22.md","docs/audits/VAM_OS_PRODUCTION_TO_REPOSITORY_SCHEMA_GAP_2026-07-22.md","docs/audits/VAM_OS_MIGRATION_061_PRODUCTION_COMPARISON_2026-07-22.md","docs/audits/VAM_OS_STAGING_BASELINE_SCOPE_2026-07-22.md",baselinePath,"docs/audits/VAM_OS_STAGING_SCHEMA_BOOTSTRAP_RUNBOOK_2026-07-22.md"];const all=files.map(f=>readFileSync(f,"utf8")).join("\n");expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.|postgres(?:ql)?:\/\/|(?:service_role|anon)_key\s*[:=]/i)});
 it("marks baseline staging-only and outside automatic migrations",()=>{for(const mark of ["STAGING ONLY","DESIGN ONLY","NOT APPLIED","MUST NEVER RUN ON PRODUCTION"])expect(baseline).toContain(mark);expect(baselinePath.startsWith("supabase_migrations/")).toBe(false)});
 it("contains no data load or executable target",()=>{const executable=baseline.replace(/--[^\n]*/g,"").trim();expect(executable).toBe("");expect(baseline).not.toMatch(/^\s*(insert|copy)\b/im);expect(baseline).not.toContain("qkkroesfiazsejkzflcd")});
 it("excludes managed internals and production content",()=>{expect(baseline).toContain("MANAGED-SCHEMA EXCLUSIONS");expect(baseline).toContain("Do not manually clone internal objects belonging to auth, storage, vault");expect(baseline).toContain("NO AUTH USERS");expect(baseline).toContain("NO STORAGE OBJECTS")});
 it("keeps migration 061 separate and unauthorized",()=>{expect(baseline).toContain("APPROACH A: pre-061 baseline");expect(baseline).toContain("Migration 061 remains unauthorized");expect(comparison).toContain("Staging still lacks its baseline")});
 it("documents authorization phrases without issuing them",()=>{expect(runbook).toContain("AUTHORIZE STAGING SCHEMA-ONLY BASELINE BOOTSTRAP");expect(runbook).toContain("AUTHORIZE STAGING BATCH 5B1 RECRUITMENT CAMPAIGN MIGRATION 061");expect(runbook).toContain("Neither phrase is issued")});
 it("covers core tables and classifies imports",()=>{for(const table of ["programs","seasons","intake_batches","people","mentor_profiles","mentee_profiles","applications","matches","events","event_registrations","admin_users","admin_scope_access"])expect(baseline).toContain("public."+table);expect(scope).toContain("Historical import/staging helper");expect(scope).toContain("Supabase-managed")});
 it("does not guess unresolved objects",()=>{for(const item of ["enum labels","view definitions","sequence definitions"])expect(baseline.toLowerCase()).toContain(item);expect(baseline).toContain("BLOCKED — MANUAL BASELINE REMEDIATION REQUIRED")});
});
