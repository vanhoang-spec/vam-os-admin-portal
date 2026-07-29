import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const V3_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_POLICY_EVIDENCE_PREFLIGHT_V3.sql";
const STAGING_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql";
const VERIFICATION_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql";
const ROLLBACK_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_ROLLBACK.sql";

const v3           = readFileSync(V3_PATH,           "utf8");
const staging      = readFileSync(STAGING_PATH,      "utf8");
const verification = readFileSync(VERIFICATION_PATH, "utf8");
const rollback     = readFileSync(ROLLBACK_PATH,     "utf8");

// Strip single-line SQL comments then string literals — mimics what the DB
// parser sees, so mutation checks are not fooled by header text or labels.
function stripForExec(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const v3Exec       = stripForExec(v3);
const rollbackExec = stripForExec(rollback);

// ---------------------------------------------------------------------------
// Identity and headers
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — identity and header guards", () => {
  it("V3 probe identifier is present", () => {
    expect(v3).toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_POLICY_EVIDENCE_PREFLIGHT_V3");
  });

  it("probe_version value matches probe identifier (not an older probe version)", () => {
    // After stripping comments, the string literal used for probe_version must be V3.
    // This catches accidental copy-paste of a prior probe's version identifier.
    const v3NoComments = v3.replace(/--[^\n]*/g, "");
    expect(v3NoComments).not.toContain("PREFLIGHT_V1");
    expect(v3NoComments).not.toContain("PREFLIGHT_V2");
    expect(v3NoComments).toContain("PREFLIGHT_V3");
  });

  it("V3 probe declares all required safety headers", () => {
    for (const phrase of ["DESIGN ONLY", "STAGING ONLY", "NOT AUTHORIZED", "DO NOT EXECUTE"]) {
      expect(v3, `missing header: '${phrase}'`).toContain(phrase);
    }
  });

  it("output column is named policy_evidence_result (not preflight_result)", () => {
    expect(v3).toContain("as policy_evidence_result");
    expect(v3).not.toContain("as preflight_result");
  });
});

// ---------------------------------------------------------------------------
// Read-only guard — no mutation keywords after comment/literal stripping
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — read-only constraint", () => {
  const MUTATION_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE",
    "CREATE", "ALTER", "DROP", "GRANT", "REVOKE", "COPY", "CALL",
  ];

  it("V3 probe exec contains no mutation keywords", () => {
    for (const kw of MUTATION_KEYWORDS) {
      expect(v3Exec, `found mutation keyword in exec: ${kw}`).not.toMatch(
        new RegExp(`\\b${kw}\\b`, "i")
      );
    }
  });

  it("V3 probe contains no DO block (no anonymous code execution)", () => {
    // DO blocks can execute arbitrary SQL; exclude them entirely from read-only probes.
    expect(v3Exec).not.toMatch(/\bdo\b\s*\$\$/i);
    expect(v3Exec).not.toMatch(/\bdo\b\s*\$/i);
  });

  it("V3 probe mutation check documents its read-only nature in header", () => {
    expect(v3).toMatch(/MUTATION CHECK/i);
    expect(v3).toMatch(/Contains NO/i);
  });
});

// ---------------------------------------------------------------------------
// Single-statement structure — exactly one WITH…SELECT
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — statement structure", () => {
  it("V3 probe is a single WITH-based statement (starts with WITH after stripping)", () => {
    expect(v3Exec.replace(/\s+/g, " ").trim().toLowerCase().startsWith("with")).toBe(true);
  });

  it("V3 probe has exactly one statement terminator (one semicolon in exec)", () => {
    const semicolons = v3Exec.match(/;/g);
    expect(semicolons).not.toBeNull();
    expect(semicolons!.length).toBe(1);
  });

  it("V3 probe ends with a single SELECT as the top-level statement", () => {
    // The final SELECT builds the JSONB result — not a subquery SELECT.
    expect(v3).toMatch(/select\s+jsonb_build_object\s*\(/i);
    expect(v3).toContain("as policy_evidence_result;");
  });

  it("V3 probe returns exactly one JSONB column", () => {
    // One column alias at statement end implies one output column.
    const matches = v3.match(/\bas\s+policy_evidence_result\b/gi);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Catalog targeting — correct table filter
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — catalog filter correctness", () => {
  it("probe queries pg_policy (not only the pg_policies view) for authoritative expression access", () => {
    expect(v3).toMatch(/from\s+pg_policy\b/i);
  });

  it("probe filters to public schema via pg_namespace join", () => {
    expect(v3Exec).toMatch(/ns\.nspname\s*=\s*''/i);  // 'public' stripped to ''
    expect(v3).toContain("pg_namespace");
  });

  it("probe filters to admin_users table via pg_class join", () => {
    expect(v3Exec).toMatch(/cls\.relname\s*=\s*''/i);  // 'admin_users' stripped to ''
    expect(v3).toContain("pg_class");
  });

  it("probe filters to SELECT and ALL policies (polcmd codes r and *)", () => {
    // After stripping, 'r' and '*' become '' — filter structure still verifiable
    expect(v3Exec).toMatch(/pol\.polcmd::text\s+in\s*\(\s*''\s*,\s*''\s*\)/i);
  });

  it("probe filters to polcmd codes r and * in raw SQL (pre-strip)", () => {
    // Checks that the right codes are in the raw source before stripping
    expect(v3).toContain("'r'");
    expect(v3).toContain("'*'");
  });
});

// ---------------------------------------------------------------------------
// USING expression retrieval — the primary evidence payload
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — USING expression retrieval", () => {
  it("probe uses pg_get_expr to retrieve the USING expression from polqual", () => {
    expect(v3).toMatch(/pg_get_expr\s*\(\s*pol\.polqual\s*,\s*pol\.polrelid\s*\)/i);
  });

  it("probe names the retrieved column using_expression", () => {
    expect(v3).toMatch(/pg_get_expr\s*\(\s*pol\.polqual\s*,\s*pol\.polrelid\s*\)\s+as\s+using_expression/i);
  });

  it("using_expression is included in each policy's JSONB output object", () => {
    expect(v3).toContain("'using_expression'");
  });

  it("probe also retrieves with_check_expression via pg_get_expr(polwithcheck)", () => {
    expect(v3).toMatch(/pg_get_expr\s*\(\s*pol\.polwithcheck\s*,\s*pol\.polrelid\s*\)/i);
  });

  it("probe derives references_auth_uid flag from the USING expression", () => {
    expect(v3).toContain("references_auth_uid");
    // Raw file contains the LIKE pattern against auth.uid()
    expect(v3).toMatch(/using_expression\s+like\s+'%auth\.uid/i);
  });

  it("probe derives has_active_status_restriction flag from the USING expression", () => {
    expect(v3).toContain("has_active_status_restriction");
    expect(v3).toContain("using_references_status");
    expect(v3).toContain("using_references_active");
  });
});

// ---------------------------------------------------------------------------
// Mode reporting — permissive vs restrictive
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — policy mode reporting", () => {
  it("probe reports policy mode as PERMISSIVE or RESTRICTIVE", () => {
    expect(v3).toContain("PERMISSIVE");
    expect(v3).toContain("RESTRICTIVE");
  });

  it("mode field is derived from pol.polpermissive", () => {
    expect(v3).toMatch(/pol\.polpermissive/i);
    expect(v3).toContain("'mode'");
  });

  it("mode derivation handles both true (PERMISSIVE) and false (RESTRICTIVE) branches", () => {
    // After stripping, 'PERMISSIVE' → '' — verify the CASE structure in exec
    expect(v3Exec).toMatch(/when\s+true\s+then\s*''/i);
    expect(v3).toContain("else");
  });
});

// ---------------------------------------------------------------------------
// Known-policy detection
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — known policy detection", () => {
  it("probe reports whether the package policy is present", () => {
    expect(v3).toContain("expected_package_policy_present");
    expect(v3).toContain("read_admin_users_super_admin_or_self");
  });

  it("probe reports whether the pre-existing staging policy is present", () => {
    expect(v3).toContain("pre_existing_policy_present");
    expect(v3).toContain("active admins can read themselves");
  });

  it("probe reports whether the pre-existing policy has an active-status restriction", () => {
    expect(v3).toContain("pre_existing_policy_has_active_status_restriction");
  });

  it("probe detects and lists unexpected additional SELECT policies", () => {
    expect(v3).toContain("unexpected_additional_select_policies");
  });

  it("probe reports all_select_policies_have_active_status_restriction", () => {
    expect(v3).toContain("all_select_policies_have_active_status_restriction");
  });
});

// ---------------------------------------------------------------------------
// PII exclusion — no raw row data, credentials, or connection strings
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — PII and credential exclusion", () => {
  it("probe does not select from admin_users row data (no table data access)", () => {
    // The probe only reads pg_policy / pg_class / pg_namespace — never admin_users rows.
    expect(v3Exec).not.toMatch(/from\s+public\.admin_users\b/i);
    expect(v3Exec).not.toMatch(/from\s+admin_users\b(?!\s*\)|\s*cls|\s*ns)/i);
  });

  it("probe does not return email column values", () => {
    expect(v3Exec).not.toMatch(/\bau\.email\b/i);
    expect(v3Exec).not.toMatch(/select\s+.*\bemail\b/i);
  });

  it("probe does not return auth_user_id column values", () => {
    expect(v3Exec).not.toMatch(/\bau\.auth_user_id\b/i);
    expect(v3Exec).not.toMatch(/\bauth_user_id\b/i);
  });

  it("probe contains no production connection identifiers", () => {
    expect(v3).not.toMatch(/postgresql:\/\//i);
    expect(v3).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(v3).not.toMatch(/PGPASSWORD/i);
    expect(v3).not.toMatch(/password\s*=\s*\S/i);
    expect(v3).not.toMatch(/DATABASE_URL/i);
  });

  it("probe does not contain real email addresses", () => {
    expect(v3).not.toMatch(
      /[a-z0-9._%+-]+@(?!example\.com|staging\.example)[a-z0-9.-]+\.[a-z]{2,}/i
    );
  });

  it("probe does not reference production Supabase project ref", () => {
    expect(v3).not.toContain("qkkroesfiazsejkzflcd");
  });

  it("probe does not reference staging Supabase project ref", () => {
    expect(v3).not.toContain("ljfneyuvpxrmejpxsmpz");
  });
});

// ---------------------------------------------------------------------------
// No automatic execution pathway
// ---------------------------------------------------------------------------
describe("V3 policy evidence probe — no auto-execution pathway", () => {
  it("V3 probe is a .sql file, not a script with an executor embedded", () => {
    // No import from lib or app modules (would indicate embedded runner)
    expect(v3).not.toMatch(/import\s+.*from\s+['"]/i);
    expect(v3).not.toMatch(/require\s*\(/i);
  });

  it("probe does not embed a Supabase client call", () => {
    expect(v3).not.toMatch(/createClient\s*\(/i);
    expect(v3).not.toMatch(/supabase\.from\(/i);
    expect(v3).not.toMatch(/supabase\.rpc\(/i);
  });

  it("probe documentation states it is design only and not authorized", () => {
    expect(v3).toContain("DESIGN ONLY");
    expect(v3).toContain("NOT AUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// Emergency package files unchanged — regression guard
// The V3 probe is additive; it must not alter the emergency migration package.
// ---------------------------------------------------------------------------
describe("V3 probe creation — emergency package regression guard", () => {
  it("staging migration still has corrected status='active' on own-row branch (Part 8 fix)", () => {
    expect(staging).toMatch(
      /auth\.uid\(\)\s*=\s*auth_user_id\s+and\s+status\s*=\s*'active'/i
    );
  });

  it("staging migration still has is_admin_role inside a conditional DO block (Part 7 fix)", () => {
    expect(staging).toMatch(
      /if\s+exists\s*\(\s*select\s+1\s+from\s+pg_proc\s+fn/i
    );
  });

  it("rollback still does NOT execute disable RLS on admin_users (Part 8 fix)", () => {
    expect(rollbackExec).not.toMatch(
      /alter\s+table\s+public\.admin_users\s+disable\s+row\s+level\s+security/i
    );
  });

  it("rollback still activates disable RLS on admin_audit_log (staging pre-migration state)", () => {
    expect(rollbackExec).toMatch(
      /alter\s+table\s+public\.admin_audit_log\s+disable\s+row\s+level\s+security/i
    );
  });

  it("rollback still drops only the package policy, not the pre-existing staging policy", () => {
    // Rollback uses a double-quoted identifier (PostgreSQL quoted-name syntax);
    // stripForExec only strips single-quoted literals — double quotes are preserved.
    expect(rollbackExec).toMatch(
      /drop\s+policy\s+if\s+exists\s+"[^"]+"\s+on\s+public\.admin_users/i
    );
    // Only one DROP POLICY statement targets admin_users
    const dropMatches = rollbackExec.match(/drop\s+policy[^;]*/gi) ?? [];
    const adminUsersDrops = dropMatches.filter((d) => /\badmin_users\b/i.test(d));
    expect(adminUsersDrops.length).toBe(1);
  });

  it("verification file still exists and is readable", () => {
    expect(verification.length).toBeGreaterThan(0);
  });

  it("verification file still identifies as the correct probe", () => {
    expect(verification).toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION");
  });

  it("V3 probe does not alter the staging migration file", () => {
    // staging must NOT contain V3 probe identifier
    expect(staging).not.toContain("POLICY_EVIDENCE_PREFLIGHT_V3");
  });

  it("V3 probe does not alter the verification file", () => {
    expect(verification).not.toContain("POLICY_EVIDENCE_PREFLIGHT_V3");
  });

  it("V3 probe does not alter the rollback file", () => {
    expect(rollback).not.toContain("POLICY_EVIDENCE_PREFLIGHT_V3");
  });
});
