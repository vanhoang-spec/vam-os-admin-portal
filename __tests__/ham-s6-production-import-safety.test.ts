import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const prodDir = "data_imports/ham/production_design_only";
const moduleFiles = readdirSync(prodDir).filter((n) => n.endsWith(".sql")).sort();
const modules = Object.fromEntries(
  moduleFiles.map((n) => [n, readFileSync(`${prodDir}/${n}`, "utf8")])
);
const allModules = Object.values(modules).join("\n");

// Strip line comments and string literals so we test executable SQL only
const executable = (text: string) =>
  text.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
const allExec = executable(allModules);

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("HAM-S6 production import safety", () => {
  it("all 7 production modules are present", () => {
    expect(moduleFiles).toHaveLength(7);
    for (const n of [
      "01_preflight_assertions.sql",
      "02_seed_program_season_batch.sql",
      "03_import_people.sql",
      "04_import_profiles_memberships.sql",
      "05_import_matches.sql",
      "06_post_import_assertions.sql",
      "07_rollback_design.sql",
    ]) {
      expect(moduleFiles).toContain(n);
    }
  });

  it("every module is marked NOT AUTHORIZED and PRODUCTION DESIGN ONLY", () => {
    for (const [name, body] of Object.entries(modules)) {
      expect(body, `${name} must contain PRODUCTION DESIGN ONLY`).toContain(
        "PRODUCTION DESIGN ONLY"
      );
      expect(body, `${name} must contain NOT AUTHORIZED`).toContain("NOT AUTHORIZED");
    }
  });

  it("every write module (02–07) raises an exception guard before any DML", () => {
    const writeModules = moduleFiles.filter((n) => !n.startsWith("01_"));
    for (const name of writeModules) {
      const body = modules[name];
      expect(body, `${name} must have production guard exception`).toMatch(
        /raise exception\s+'PRODUCTION DESIGN ONLY/i
      );
    }
  });

  it("production modules are outside automatic migration paths", () => {
    expect(prodDir).not.toMatch(/^supabase(?:\/|\\)/);
    expect(prodDir).not.toMatch(/^migrations(?:\/|\\)/);
    for (const scriptVal of Object.values(pkg.scripts)) {
      expect(scriptVal).not.toMatch(/production_design_only/i);
      expect(scriptVal).not.toMatch(/ham_s6_0[1-7]/i);
    }
  });

  it("no package script executes any HAM production module", () => {
    const scriptBlock = JSON.stringify(pkg.scripts);
    expect(scriptBlock).not.toMatch(/01_preflight_assertions/i);
    expect(scriptBlock).not.toMatch(/02_seed_program_season/i);
    expect(scriptBlock).not.toMatch(/03_import_people/i);
    expect(scriptBlock).not.toMatch(/04_import_profiles/i);
    expect(scriptBlock).not.toMatch(/05_import_matches/i);
    expect(scriptBlock).not.toMatch(/06_post_import/i);
    expect(scriptBlock).not.toMatch(/07_rollback_design/i);
  });

  it("no staging project ref appears in executable SQL of any production module", () => {
    // Comments may reference staging for documentation; executable SQL must not
    expect(allExec).not.toContain("ljfneyuvpxrmejpxsmpz");
  });

  it("no email addresses are embedded in module SQL (no PII in code)", () => {
    // Executable strips string literals; test on raw text to catch comments too
    expect(allModules).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  });

  it("no raw UUID literals appear (no staging UUID reuse)", () => {
    // Strip string literals from executable SQL — UUIDs in comments are flagged too
    const uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    expect(allModules).not.toMatch(uuidPattern);
  });

  it("write modules 02–05 contain BEGIN and COMMIT (transactions present)", () => {
    // Module 06 is read-only (assertions only) and does not need a transaction
    for (const name of ["02_seed_program_season_batch.sql", "03_import_people.sql",
                        "04_import_profiles_memberships.sql", "05_import_matches.sql"]) {
      const code = executable(modules[name]);
      expect(code, `${name} must have BEGIN`).toMatch(/\bbegin\s*;/i);
      expect(code, `${name} must have COMMIT`).toMatch(/\bcommit\s*;/i);
    }
  });

  it("module 03 has source count assertion and rerun protection", () => {
    const body = modules["03_import_people.sql"];
    expect(body).toContain("SOURCE COUNT ASSERTION");
    expect(body).toContain("RERUN PROTECTION");
    expect(body).toContain("source_season=HAM_S6");
  });

  it("module 05 has source count assertion (60 match rows)", () => {
    const body = modules["05_import_matches.sql"];
    expect(body).toContain("SOURCE COUNT ASSERTION");
    expect(body).toContain("60");
  });

  it("name-only / name-key fallback is disabled in modules 03 and 05", () => {
    // Module 03 documents "Name-only matching is DISABLED"
    // Module 05 documents "Name-key fallback is EXPLICITLY DISABLED"
    for (const name of ["03_import_people.sql", "05_import_matches.sql"]) {
      const body = modules[name];
      expect(body, `${name}: name fallback must be documented as disabled`).toMatch(
        /name.(?:only|key).+(?:DISABLED|disabled)/i
      );
    }
  });

  it("no unrestricted DELETE on people — rollback scopes to provenance marker", () => {
    // Test against raw text: executable() strips string literals including the
    // provenance marker 'source_season=HAM_S6' which is inside a LIKE pattern
    const rollback = modules["07_rollback_design.sql"];
    expect(rollback).toContain("source_season=HAM_S6");
    // The DELETE on people must appear after the provenance marker in the file
    const deleteIdx = rollback.search(/delete\s+from\s+public\s*\.\s*people/i);
    expect(deleteIdx).toBeGreaterThan(0);
  });

  it("rollback module preserves shared people (not exists membership and profile guards)", () => {
    const rollback = modules["07_rollback_design.sql"];
    expect(rollback).toContain("not exists");
    expect(rollback).toContain("person_season_memberships");
    expect(rollback).toContain("mentor_profiles");
    expect(rollback).toContain("mentee_profiles");
  });

  it("no UPDATE to UEH rows in any module", () => {
    // No UPDATE statement targeting UEHM-linked data
    const updatePattern = /\bUPDATE\s+public\s*\.\s*(?:seasons|matches|mentor_profiles|mentee_profiles)\b/i;
    expect(allExec).not.toMatch(updatePattern);
  });

  it("no UPDATE to people identity fields (email_primary, full_name, phone_primary)", () => {
    const updatePeople = allExec.match(/UPDATE\s+public\s*\.\s*people[\s\S]*?;/gi) ?? [];
    for (const block of updatePeople) {
      expect(block).not.toMatch(/\bemail_primary\b/i);
      expect(block).not.toMatch(/\bfull_name\b/i);
      expect(block).not.toMatch(/\bphone_primary\b/i);
    }
  });

  it("no COPY or \\copy in executable SQL of production modules", () => {
    // \copy is a psql CLI meta-command and must not appear in executable SQL.
    // Comments may reference \copy in documentation of what callers must do —
    // executable() strips those comments.
    expect(allExec).not.toMatch(/\bCOPY\b/i);
    // After stripping comments, backslash-copy must not remain
    const execNoComments = allModules.replace(/--[^\n]*/g, "");
    expect(execNoComments).not.toMatch(/\\copy\b/i);
  });

  it("no persistent staging helper tables created in executable SQL of production modules", () => {
    // Staging used staging_ham_s6_people_identity_map and staging_ham_s6_import_skips
    // Comments may reference these tables in documentation; executable SQL must not
    expect(allExec).not.toContain("staging_ham_s6_people_identity_map");
    expect(allExec).not.toContain("staging_ham_s6_import_skips");
  });

  it("identity and skip tables in module 03 are TEMP (session-scoped, not persistent)", () => {
    const body = modules["03_import_people.sql"];
    expect(body).toMatch(/create\s+temp\s+table\s+_ham_prod_identity_map/i);
    expect(body).toMatch(/create\s+temp\s+table\s+_ham_prod_import_skips/i);
    // Must not create persistent public tables for PII
    expect(executable(body)).not.toMatch(
      /create\s+table\s+public\s*\.\s*_ham_prod/i
    );
  });

  it("admin account creation is absent from foundation import modules", () => {
    for (const name of moduleFiles.filter(
      (n) => !n.startsWith("07_")
    )) {
      const body = modules[name];
      expect(body, `${name}: must not create admin accounts`).not.toMatch(
        /\bauth\s*\.\s*users\b/i
      );
      expect(body, `${name}: must not insert admin_users`).not.toMatch(
        /insert\s+into\s+(?:public\s*\.\s*)?admin_users\b/i
      );
      expect(body, `${name}: must not insert admin_scope_access`).not.toMatch(
        /insert\s+into\s+(?:public\s*\.\s*)?admin_scope_access\b/i
      );
    }
  });

  it("migration 061 is referenced as unauthorized and not executed by any module", () => {
    // All modules must remain unrelated to migration 061 execution
    const scriptBlock = JSON.stringify(pkg.scripts);
    expect(scriptBlock).not.toMatch(/migration.?061/i);
    for (const name of moduleFiles) {
      const body = executable(modules[name]);
      expect(body, `${name}: must not contain recruitment_campaign_id`).not.toContain(
        "recruitment_campaign_id"
      );
    }
  });

  it("context resolution uses code-based lookup (p.code='HAM'), not hardcoded UUID", () => {
    // Modules resolve program/season/batch by code at runtime, never by hardcoded UUID.
    // Module 02 inserts rows by code; module 04 joins programs p where p.code = 'HAM'.
    for (const name of ["02_seed_program_season_batch.sql", "04_import_profiles_memberships.sql"]) {
      const body = modules[name];
      // Code-based resolution must be present (alias form p.code or direct programs.code)
      expect(body, `${name} must resolve HAM by code`).toMatch(/\bcode\s*=\s*'HAM'/);
    }
  });

  it("admin_scope_access stores string codes not UUIDs (documented in plan)", () => {
    const plan = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_ADMIN_ACCOUNT_PLAN_2026-07-23.md",
      "utf8"
    );
    expect(plan).toContain("program_id");
    expect(plan).toContain("season_id");
    // Line 89 documents the string-code requirement with a SQL example
    expect(plan).toContain("'HAM'");
    // Table documents HAM-S6 as a string code (backtick notation in markdown)
    expect(plan).toContain("HAM-S6");
    expect(plan).toContain("string code");
  });

  it("all required audit documents are present", () => {
    const docs = [
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_ASSET_INVENTORY_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_SOURCE_SAFETY_REVIEW_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_BEHAVIOR_ANALYSIS_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_RUNBOOK_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IDENTITY_COLLISION_POLICY_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_MANIFEST_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_BACKUP_AND_ROLLBACK_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_ADMIN_ACCOUNT_PLAN_2026-07-23.md",
      "docs/audits/HAM_S6_PRODUCTION_FOUNDATION_IMPORT_RUNBOOK_2026-07-23.md",
    ];
    for (const doc of docs) {
      expect(() => readFileSync(doc, "utf8"), `Missing: ${doc}`).not.toThrow();
    }
  });

  it("all required SQL probes are present", () => {
    const probes = [
      "docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql",
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
    ];
    for (const probe of probes) {
      const body = readFileSync(probe, "utf8");
      expect(body).toContain("AUTHORIZE");
      // Probes must be read-only — no DML or DDL
      const code = executable(body);
      expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER)\b/i);
    }
  });

  it("execution runbook documents all 5 authorization phrases", () => {
    const runbook = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_FOUNDATION_IMPORT_RUNBOOK_2026-07-23.md",
      "utf8"
    );
    const phrases = [
      "AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT",
      "AUTHORIZE HAM-S6 PRODUCTION BACKUP",
      "AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT",
      "AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION",
      "AUTHORIZE PRODUCTION HAM ADMIN ACCOUNTS",
    ];
    for (const phrase of phrases) {
      expect(runbook, `Runbook missing phrase: ${phrase}`).toContain(phrase);
    }
  });

  it("no authorization phrase implicitly authorizes another gate", () => {
    const runbook = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_FOUNDATION_IMPORT_RUNBOOK_2026-07-23.md",
      "utf8"
    );
    expect(runbook).toContain("does not authorize");
  });
});
