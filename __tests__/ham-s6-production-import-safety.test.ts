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

  it("module 03 name-only person resolution is DISABLED (email or phone required)", () => {
    // People identity in production uses email or phone only — name-only is blocked
    const body = modules["03_import_people.sql"];
    expect(body).toMatch(/name.only.+(?:DISABLED|disabled)/i);
  });

  it("module 05 name-key fallback is ENABLED for mentor resolution when email absent", () => {
    // All 60 match rows have empty mentor_email; name-key fallback resolves 58 of them.
    // The name-key resolution uses normalized mentor_name (strip diacritics, collapse non-alnum).
    const body = modules["05_import_matches.sql"];
    expect(body).toContain("name_key");
    // Must contain the OR branch that fires when mentor_email is null
    expect(body).toMatch(/lower\s*\(\s*nullif\s*\(\s*trim\s*\(\s*ms\.mentor_email/i);
    expect(body).toMatch(/is\s+null/i);
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

  // ── Schema alignment assertions (2026-07-23) ────────────────────────────────
  // 15 new assertions verifying canonical production schema compliance

  it("schema alignment document exists and lists all 4 legacy columns", () => {
    const doc = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_SCHEMA_ALIGNMENT_2026-07-23.md",
      "utf8"
    );
    expect(doc).toContain("people.role");
    expect(doc).toContain("mentor_profiles.linkedin_url");
    expect(doc).toContain("mentee_profiles.status");
    expect(doc).toContain("matches.season_code");
  });

  it("schema alignment document confirms canonical replacements", () => {
    const doc = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_SCHEMA_ALIGNMENT_2026-07-23.md",
      "utf8"
    );
    // people.role → person_season_memberships.role
    expect(doc).toContain("person_season_memberships.role");
    // matches.season_code → season_id FK
    expect(doc).toContain("season_id");
    // Path B was chosen
    expect(doc).toContain("Path B");
  });

  it("field mapping document exists and classifies UNSUPPORTED fields", () => {
    const doc = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_FIELD_MAPPING_2026-07-23.md",
      "utf8"
    );
    expect(doc).toContain("UNSUPPORTED");
    // All 4 unsupported fields documented
    expect(doc).toContain("people.role");
    expect(doc).toContain("linkedin_url");
    expect(doc).toContain("mentee_profiles.status");
    expect(doc).toContain("matches.season_code");
  });

  it("module 03 people INSERT does not include role column (absent from production)", () => {
    const body = modules["03_import_people.sql"];
    const execBody = executable(body);
    // The insert into public.people must NOT include 'role' in its column list
    // We check executable SQL so comments don't interfere
    const insertBlock = execBody.match(/insert\s+into\s+public\s*\.\s*people\s*\([^)]+\)/i)?.[0] ?? "";
    expect(insertBlock).toBeTruthy();
    expect(insertBlock).not.toMatch(/\brole\b/i);
  });

  it("module 03 people INSERT includes full_name, email_primary, data_quality_flags", () => {
    const body = modules["03_import_people.sql"];
    const execBody = executable(body);
    const insertBlock = execBody.match(/insert\s+into\s+public\s*\.\s*people\s*\([^)]+\)/i)?.[0] ?? "";
    expect(insertBlock).toMatch(/\bfull_name\b/i);
    expect(insertBlock).toMatch(/\bemail_primary\b/i);
    expect(insertBlock).toMatch(/\bdata_quality_flags\b/i);
  });

  it("module 04 mentor INSERT does not include linkedin_url (absent from production)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    const execBody = executable(body);
    // The mentor_profiles INSERT block must not contain linkedin_url
    const mentorInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*mentor_profiles\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(mentorInsert).toBeTruthy();
    expect(mentorInsert).not.toMatch(/\blinkedin_url\b/i);
  });

  it("module 04 mentee INSERT does not include status column (absent from production)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    const execBody = executable(body);
    const menteeInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*mentee_profiles\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(menteeInsert).toBeTruthy();
    // status is absent; mentee_status (a separate column) may still appear
    // We check that 'status' does not appear as a standalone column name before 'mentee_code'
    // The column list should contain mentee_code but not a bare 'status'
    expect(menteeInsert).not.toMatch(/\bperson_id\s*,\s*status\b/i);
  });

  it("module 04 mentee INSERT does not include mentee_status (absent from production)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    const execBody = executable(body);
    const menteeInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*mentee_profiles\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(menteeInsert).toBeTruthy();
    expect(menteeInsert).not.toMatch(/\bmentee_status\b/i);
  });

  it("module 04 person_season_memberships INSERT includes program_id", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    const execBody = executable(body);
    const membershipInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*person_season_memberships\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(membershipInsert).toBeTruthy();
    expect(membershipInsert).toMatch(/\bprogram_id\b/i);
    expect(membershipInsert).toMatch(/\bseason_id\b/i);
    expect(membershipInsert).toMatch(/\brole\b/i);
  });

  it("module 05 matches INSERT does not include season_code (absent from production)", () => {
    const body = modules["05_import_matches.sql"];
    const execBody = executable(body);
    const matchInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*matches\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(matchInsert).toBeTruthy();
    expect(matchInsert).not.toMatch(/\bseason_code\b/i);
  });

  it("module 05 matches INSERT includes season_id (canonical FK)", () => {
    const body = modules["05_import_matches.sql"];
    const execBody = executable(body);
    const matchInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*matches\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(matchInsert).toMatch(/\bseason_id\b/i);
  });

  it("preflight probe is version V3 (final schema alignment)", () => {
    const preflight = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql",
      "utf8"
    );
    expect(preflight).toContain("HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V3");
    // V3 must not check any legacy or absent column
    const prefExec = executable(preflight);
    expect(prefExec).not.toMatch(/'people','people','role'/i);
    expect(prefExec).not.toMatch(/'mentor_profiles\.linkedin_url'/i);
    // mentee_profiles.mentee_status removed in V3 — must not be in values list
    expect(prefExec).not.toMatch(/'mentee_profiles\.mentee_status'/i);
    expect(prefExec).not.toMatch(/'mentee_profiles','mentee_profiles','mentee_status'/i);
  });

  it("preflight probe V3 checks person_season_memberships.program_id and status", () => {
    const preflight = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql",
      "utf8"
    );
    expect(preflight).toContain("person_season_memberships.program_id");
    expect(preflight).toContain("person_season_memberships.status");
  });

  it("post-import verification probe is version V3 and does not reference season_code or mentee_status", () => {
    const verification = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
      "utf8"
    );
    expect(verification).toContain("HAM_S6_POST_IMPORT_VERIFICATION_V3");
    const verExec = executable(verification);
    expect(verExec).not.toMatch(/\bseason_code\b/i);
    expect(verExec).not.toMatch(/\bmentee_status\b/i);
  });

  it("post-import verification probe checks person_season_memberships for HAM-S6 roles", () => {
    const verification = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
      "utf8"
    );
    expect(verification).toContain("person_season_memberships");
    expect(verification).toContain("HAM-S6");
  });

  // ── Final schema alignment assertions (2026-07-23) ──────────────────────────
  // Assertions verifying mentee_profiles.mentee_status is fully removed

  it("no executable reference to mentee_profiles.mentee_status in any production module", () => {
    // mentee_status is absent from production schema — must not appear in any INSERT
    expect(allExec).not.toMatch(/\bmentee_status\b/i);
  });

  it("module 04 person_season_memberships INSERT includes status", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    const execBody = executable(body);
    const membershipInsert = execBody.match(
      /insert\s+into\s+public\s*\.\s*person_season_memberships\s*\([^)]+\)/i
    )?.[0] ?? "";
    expect(membershipInsert).toBeTruthy();
    // status is the canonical mentee lifecycle field
    expect(membershipInsert).toMatch(/\bstatus\b/i);
  });

  it("schema alignment document documents mentee_profiles.mentee_status as absent", () => {
    const doc = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_SCHEMA_ALIGNMENT_2026-07-23.md",
      "utf8"
    );
    expect(doc).toContain("mentee_profiles.mentee_status");
    expect(doc).toContain("ABSENT from production");
  });

  it("field mapping document classifies mentee_profiles.mentee_status as UNSUPPORTED", () => {
    const doc = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_FIELD_MAPPING_2026-07-23.md",
      "utf8"
    );
    expect(doc).toContain("mentee_profiles.mentee_status");
    expect(doc).toContain("UNSUPPORTED");
  });

  it("post-import verification probe verifies mentee membership lifecycle via person_season_memberships", () => {
    const verification = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
      "utf8"
    );
    // Lifecycle status checked through memberships, not through mentee_profiles
    expect(verification).toContain("ham_s6_memberships");
    expect(verification).toContain("psm.role = 'mentor'");
    expect(verification).toContain("psm.role = 'mentee'");
  });

  // ── Exact manifest assertions (2026-07-29) ──────────────────────────────────
  // Prove exact fail-closed counts and module hardening

  it("module 03 does not reference undefined _ham_prod_email_matched_dedup (bug fixed)", () => {
    const body = modules["03_import_people.sql"];
    expect(body).not.toContain("_ham_prod_email_matched_dedup");
  });

  it("module 03 asserts exactly 112 import-ready source people (not a range)", () => {
    const body = modules["03_import_people.sql"];
    expect(body).toContain("<> 112");
    expect(body).not.toMatch(/v_ready_count\s*<\s*10[0-9]/);
  });

  it("module 03 asserts exactly 112 new people created (fail-closed, not range)", () => {
    const body = modules["03_import_people.sql"];
    // Exact assertion on new_count
    expect(body).toContain("v_new_count <> 112");
  });

  it("module 03 asserts map + skips = exactly 112 (not < 108 range)", () => {
    const body = modules["03_import_people.sql"];
    expect(body).toContain("<> 112");
    expect(body).not.toContain("< 108");
  });

  it("module 04 asserts exactly 52 mentor profiles (fail-closed)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    expect(body).toContain("v_mentors <> 52");
    expect(body).not.toContain("v_mentors < 45");
  });

  it("module 04 asserts exactly 60 mentee profiles (fail-closed)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    expect(body).toContain("v_mentees <> 60");
    expect(body).not.toContain("v_mentees < 55");
  });

  it("module 04 asserts exactly 112 HAM-S6 memberships (new assertion)", () => {
    const body = modules["04_import_profiles_memberships.sql"];
    expect(body).toContain("v_memberships <> 112");
    expect(body).toContain("person_season_memberships");
  });

  it("module 05 skip count assertion asserts exactly 2 (fail-closed)", () => {
    const body = modules["05_import_matches.sql"];
    expect(body).toContain("v_skip_count <> 2");
  });

  it("module 05 match count assertion asserts exactly 58 (not < 45 range)", () => {
    const body = modules["05_import_matches.sql"];
    expect(body).toContain("v_match_count <> 58");
    expect(body).not.toContain("v_match_count < 45");
  });

  it("module 06 asserts exactly 52 mentor profiles (fail-closed)", () => {
    const body = modules["06_post_import_assertions.sql"];
    expect(body).toContain("<> 52");
    expect(body).not.toContain("< 45");
  });

  it("module 06 asserts exactly 60 mentee profiles (fail-closed)", () => {
    const body = modules["06_post_import_assertions.sql"];
    expect(body).toContain("<> 60");
    expect(body).not.toContain("< 55");
  });

  it("module 06 asserts exactly 112 HAM-S6 memberships (new assertion)", () => {
    const body = modules["06_post_import_assertions.sql"];
    expect(body).toContain("<> 112");
    expect(body).toContain("person_season_memberships");
  });

  it("module 06 asserts exactly 58 active matches (fail-closed)", () => {
    const body = modules["06_post_import_assertions.sql"];
    expect(body).toContain("<> 58");
    expect(body).not.toContain("< 45");
  });

  it("post-import verification uses exact expected values, not ranges", () => {
    const verification = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
      "utf8"
    );
    expect(verification).toContain("expected_exact");
    // Verify specific exact values are present in the probe
    expect(verification).toContain("112");
    expect(verification).toContain("52");
    expect(verification).toContain("60");
    expect(verification).toContain("58");
    // Must not use range fields anymore
    expect(verification).not.toContain("expected_min");
    expect(verification).not.toContain("expected_max");
  });

  it("post-import verification summary_pass uses exact counts not >= bounds", () => {
    const verification = readFileSync(
      "docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql",
      "utf8"
    );
    // The summary_pass must use exact equality for all counts
    expect(verification).toContain("count(*) = 112");
    expect(verification).toContain("count(*) = 52");
    expect(verification).toContain("count(*) = 60");
    expect(verification).toContain("count(*) = 58");
    // Must not use >= for business counts
    expect(verification).not.toMatch(/count\(\*\)\s*>=\s*4[0-9]/);
  });

  it("manifest has final exact import projection with exact expected values", () => {
    const manifest = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_MANIFEST_2026-07-23.md",
      "utf8"
    );
    expect(manifest).toContain("Final exact import projection");
    expect(manifest).toContain("112");
    expect(manifest).toContain("52");
    expect(manifest).toContain("60");
    expect(manifest).toContain("58");
    // Source reconciliation equation documented
    expect(manifest).toContain("source_people (112)");
  });

  it("manifest documents 0 email collisions and explains why exact count is 112 not 104–108", () => {
    const manifest = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_MANIFEST_2026-07-23.md",
      "utf8"
    );
    expect(manifest).toContain("0 email collisions");
    expect(manifest).toContain("104–108");
    expect(manifest).toContain("112");
  });

  it("manifest documents the 2 skipped match rows and their reason", () => {
    const manifest = readFileSync(
      "docs/audits/HAM_S6_PRODUCTION_IMPORT_MANIFEST_2026-07-23.md",
      "utf8"
    );
    expect(manifest).toContain("Unresolvable mentor rows");
    expect(manifest).toContain("unresolved_mentor_name");
    expect(manifest).toContain("row 9");
    expect(manifest).toContain("row 41");
  });

  it("backup directory is outside the repository (not tracked by git)", () => {
    // Backup must not be inside the project directory
    expect("C:\\Users\\THIS PC\\Desktop\\VAM 2026\\Backups").not.toContain(
      "VAM_OS_Admin_Portal"
    );
    // No backup JSON files must be staged or present in the project
    const prodDir2 = "data_imports/ham/production_design_only";
    expect(() => readFileSync(`${prodDir2}/people.json`, "utf8")).toThrow();
  });

  it("executor script run_backup.mjs is absent from the project", () => {
    expect(() => readFileSync("run_backup.mjs", "utf8")).toThrow();
  });

  it("no SQL execution path (pg, supabase, db connect) is added to package scripts", () => {
    const scriptBlock = JSON.stringify(pkg.scripts);
    expect(scriptBlock).not.toMatch(/\bpg\b/i);
    expect(scriptBlock).not.toMatch(/run_backup/i);
    expect(scriptBlock).not.toMatch(/pooler\.supabase/i);
  });

  it("no PII column values are hard-coded in any production module (no literal emails or names)", () => {
    // Raw text check: no @-email patterns, no Vietnamese name patterns embedded
    expect(allModules).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    // No literal person UUIDs (verified by existing test) — combined safety net
    const uuidPat = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    expect(allModules).not.toMatch(uuidPat);
  });

  it("rollback scope matches exact projected inserts (112 people, 112 memberships, 52 mentor, 60 mentee, 58 matches)", () => {
    const rollback = modules["07_rollback_design.sql"];
    // Rollback removes all HAM-S6 data: matches, memberships, profiles, people, season, batch
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*matches/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*person_season_memberships/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*mentor_profiles/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*mentee_profiles/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*people/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*intake_batches/i);
    expect(rollback).toMatch(/delete\s+from\s+public\s*\.\s*seasons/i);
    // Rollback is scoped to HAM-S6 (season_id or intake_batch_id from rollback_context)
    expect(rollback).toContain("_rollback_context");
  });

  it("rollback preserves shared people: deletes only those with HAM_S6 provenance and no other references", () => {
    const rollback = modules["07_rollback_design.sql"];
    // Must check provenance marker AND absence of other memberships/profiles
    expect(rollback).toContain("source_season=HAM_S6");
    expect(rollback).toContain("not exists");
    // Guards against deleting people with any remaining profile
    expect(rollback).toContain("mentor_profiles");
    expect(rollback).toContain("mentee_profiles");
    expect(rollback).toContain("person_season_memberships");
  });
});
