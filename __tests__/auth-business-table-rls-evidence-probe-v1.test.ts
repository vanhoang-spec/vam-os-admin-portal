import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROBE_PATH =
  "docs/audits/sql/design_only/VAM_OS_BUSINESS_TABLE_RLS_EVIDENCE_PROBE_V1.sql";
const STAGING_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql";
const ROLLBACK_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_ROLLBACK.sql";
const VERIFICATION_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql";

const probe        = readFileSync(PROBE_PATH,        "utf8");
const staging      = readFileSync(STAGING_PATH,      "utf8");
const rollback     = readFileSync(ROLLBACK_PATH,     "utf8");
const verification = readFileSync(VERIFICATION_PATH, "utf8");

function stripForExec(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const probeExec   = stripForExec(probe);
const rollbackExec = stripForExec(rollback);

// ---------------------------------------------------------------------------
// Identity and header guards
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — identity and headers", () => {
  it("probe identifier is present", () => {
    expect(probe).toContain("VAM_OS_BUSINESS_TABLE_RLS_EVIDENCE_PROBE_V1");
  });

  it("probe_version value matches V1 identifier (not an older probe version)", () => {
    const probeNoComments = probe.replace(/--[^\n]*/g, "");
    expect(probeNoComments).toContain("EVIDENCE_PROBE_V1");
    expect(probeNoComments).not.toContain("EVIDENCE_PROBE_V2");
    expect(probeNoComments).not.toContain("PREFLIGHT_V3");
  });

  it("probe declares all four required safety headers", () => {
    for (const phrase of ["DESIGN ONLY", "STAGING ONLY", "NOT AUTHORIZED", "DO NOT EXECUTE"]) {
      expect(probe, `missing header: '${phrase}'`).toContain(phrase);
    }
  });

  it("output column is named business_table_rls_evidence_result", () => {
    expect(probe).toContain("as business_table_rls_evidence_result");
  });

  it("MUTATION CHECK section documents read-only nature", () => {
    expect(probe).toMatch(/MUTATION CHECK/i);
    expect(probe).toMatch(/Contains NO/i);
  });
});

// ---------------------------------------------------------------------------
// Read-only constraint — no mutation keywords after comment/literal stripping
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — read-only constraint", () => {
  const MUTATION_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE",
    "CREATE", "ALTER", "DROP", "GRANT", "REVOKE", "COPY", "CALL",
  ];

  it("probe exec contains no mutation keywords", () => {
    for (const kw of MUTATION_KEYWORDS) {
      expect(probeExec, `found mutation keyword: ${kw}`).not.toMatch(
        new RegExp(`\\b${kw}\\b`, "i")
      );
    }
  });

  it("probe contains no DO block (no anonymous code execution)", () => {
    expect(probeExec).not.toMatch(/\bdo\b\s*\$\$/i);
    expect(probeExec).not.toMatch(/\bdo\b\s*\$/i);
  });

  it("probe contains no ANALYZE statement", () => {
    expect(probeExec).not.toMatch(/\banalyze\b/i);
  });

  it("probe contains no transaction-changing commands", () => {
    // BEGIN, COMMIT, ROLLBACK, SAVEPOINT must not appear in exec
    for (const kw of ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT"]) {
      expect(probeExec, `found transaction keyword: ${kw}`).not.toMatch(
        new RegExp(`\\b${kw}\\b`, "i")
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Single-statement structure — exactly one WITH…SELECT
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — statement structure", () => {
  it("probe is a single WITH-based statement (starts with WITH after stripping)", () => {
    expect(probeExec.replace(/\s+/g, " ").trim().toLowerCase().startsWith("with")).toBe(true);
  });

  it("probe has exactly one statement terminator (one semicolon in exec)", () => {
    const semicolons = probeExec.match(/;/g);
    expect(semicolons).not.toBeNull();
    expect(semicolons!.length).toBe(1);
  });

  it("probe ends with jsonb output column alias (business_table_rls_evidence_result)", () => {
    expect(probe).toContain("as business_table_rls_evidence_result;");
  });

  it("probe returns exactly one JSONB column (one output alias)", () => {
    const matches = probe.match(/\bas\s+business_table_rls_evidence_result\b/gi);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("top-level SELECT builds a jsonb_build_object result", () => {
    expect(probe).toMatch(/select\s+jsonb_build_object\s*\(/i);
  });
});

// ---------------------------------------------------------------------------
// Target table coverage — all six tables must be present
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — target table coverage", () => {
  const EXPECTED_TABLES = [
    "people",
    "mentor_profiles",
    "mentee_profiles",
    "matches",
    "mentoring_recaps",
    "event_participations",
  ];

  it("probe targets exactly 6 tables in the values list", () => {
    // Count the values entries in the target_tables CTE
    const valueLines = probe.match(/\(\s*'[a-z_]+'\s*\)/g) ?? [];
    expect(valueLines.length).toBe(6);
  });

  for (const table of EXPECTED_TABLES) {
    it(`probe targets public.${table}`, () => {
      expect(probe).toContain(`'${table}'`);
    });
  }

  it("probe summary section declares target_table_count of 6", () => {
    expect(probe).toContain("'target_table_count'");
    expect(probe).toMatch(/'target_table_count'\s*,\s*6\b/i);
  });
});

// ---------------------------------------------------------------------------
// Policy expression retrieval — the primary evidence payload
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — USING and WITH CHECK expressions", () => {
  it("probe uses pg_get_expr to retrieve the USING expression from polqual", () => {
    expect(probe).toMatch(/pg_get_expr\s*\(\s*pol\.polqual\s*,\s*pol\.polrelid\s*\)/i);
  });

  it("probe names the retrieved column using_expression", () => {
    expect(probe).toMatch(
      /pg_get_expr\s*\(\s*pol\.polqual\s*,\s*pol\.polrelid\s*\)\s+as\s+using_expression/i
    );
  });

  it("probe uses pg_get_expr to retrieve the WITH CHECK expression from polwithcheck", () => {
    expect(probe).toMatch(/pg_get_expr\s*\(\s*pol\.polwithcheck\s*,\s*pol\.polrelid\s*\)/i);
  });

  it("probe names the retrieved column with_check_expression", () => {
    expect(probe).toMatch(
      /pg_get_expr\s*\(\s*pol\.polwithcheck\s*,\s*pol\.polrelid\s*\)\s+as\s+with_check_expression/i
    );
  });

  it("using_expression is included in each policy JSONB output object", () => {
    expect(probe).toContain("'using_expression'");
  });

  it("with_check_expression is included in each policy JSONB output object", () => {
    expect(probe).toContain("'with_check_expression'");
  });

  it("probe reads from pg_policies view (handles PUBLIC role mapping correctly)", () => {
    expect(probe).toMatch(/from\s+pg_policies\b/i);
  });

  it("probe joins pg_policy for expression retrieval (authoritative catalog)", () => {
    expect(probe).toMatch(/join\s+pg_policy\b/i);
    expect(probe).toContain("pg_policy");
  });

  it("policies are included in per-table output", () => {
    expect(probe).toContain("'policies'");
  });
});

// ---------------------------------------------------------------------------
// Per-table RLS flags — rls_enabled_no_policy, policy_count, privilege flags
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — per-table RLS flags", () => {
  it("probe reports rls_enabled per table", () => {
    expect(probe).toContain("'rls_enabled'");
    expect(probe).toMatch(/cls\.relrowsecurity/i);
  });

  it("probe reports rls_forced per table", () => {
    expect(probe).toContain("'rls_forced'");
    expect(probe).toMatch(/cls\.relforcerowsecurity/i);
  });

  it("probe reports policy_count per table", () => {
    expect(probe).toContain("'policy_count'");
    expect(probe).toMatch(/count\(\*\)::int\s+from\s+t2/i);
  });

  it("probe reports rls_enabled_no_policy flag per table", () => {
    expect(probe).toContain("'rls_enabled_no_policy'");
    expect(probe).toContain("rls_enabled_no_policy");
  });

  it("rls_enabled_no_policy is derived from RLS enabled state and policy existence", () => {
    // The flag checks rls_enabled AND not exists(select 1 from t2 ...)
    expect(probe).toMatch(/t1\.rls_enabled[\s\S]{0,100}not\s+exists\s*\(\s*select\s+1\s+from\s+t2/i);
  });

  it("probe reports authenticated_can_select per table via has_table_privilege", () => {
    expect(probe).toContain("'authenticated_can_select'");
    expect(probe).toMatch(/has_table_privilege\s*\(\s*'authenticated'/i);
  });

  it("probe reports anon_can_select per table via has_table_privilege", () => {
    expect(probe).toContain("'anon_can_select'");
    expect(probe).toMatch(/has_table_privilege\s*\(\s*'anon'/i);
  });

  it("probe reports authenticated_privilege_denied flag per table", () => {
    expect(probe).toContain("'authenticated_privilege_denied'");
    expect(probe).toContain("authenticated_privilege_denied");
  });

  it("probe reports table_owner via pg_get_userbyid", () => {
    expect(probe).toContain("'table_owner'");
    expect(probe).toMatch(/pg_get_userbyid\s*\(\s*cls\.relowner\s*\)/i);
  });

  it("probe reports table_exists flag per table", () => {
    expect(probe).toContain("'table_exists'");
  });
});

// ---------------------------------------------------------------------------
// Exact super_admin count — must use count(*), not pg_class.reltuples
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — exact super_admin count", () => {
  it("probe returns active_super_admin_count_exact field in result", () => {
    expect(probe).toContain("'active_super_admin_count_exact'");
  });

  it("probe uses count(*)::int from public.admin_users for the exact count", () => {
    expect(probeExec).toMatch(/count\(\*\)::int/i);
    expect(probeExec).toMatch(/from\s+public\.admin_users\b/i);
  });

  it("super_admin count filters by role, status, and auth_user_id not null", () => {
    // After stripping, string literals become '' but keywords and column names remain
    expect(probeExec).toMatch(/from\s+public\.admin_users[\s\S]{0,200}where\s+role\s*=\s*''[\s\S]{0,200}and\s+status\s*=\s*''[\s\S]{0,200}and\s+auth_user_id\s+is\s+not\s+null/i);
  });

  it("probe does NOT use pg_class.reltuples for the super_admin count", () => {
    // reltuples must be absent entirely — probe uses count(*) only
    expect(probeExec).not.toMatch(/reltuples/i);
  });
});

// ---------------------------------------------------------------------------
// Schema catalog filter — correct namespace and table resolution
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — catalog filter correctness", () => {
  it("probe filters to public schema via pg_namespace", () => {
    expect(probe).toContain("pg_namespace");
    expect(probeExec).toMatch(/nspname\s*=\s*''/i);
  });

  it("probe resolves table OIDs via pg_class join", () => {
    expect(probe).toContain("pg_class");
    expect(probe).toMatch(/cls\.relname\b/i);
  });

  it("probe filters pg_policies to public schemaname", () => {
    expect(probeExec).toMatch(/pv\.schemaname\s*=\s*''/i);
  });
});

// ---------------------------------------------------------------------------
// PII and credential exclusion
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — PII and credential exclusion", () => {
  it("probe does not select row-level email data", () => {
    expect(probeExec).not.toMatch(/\bau\.email\b/i);
    expect(probeExec).not.toMatch(/select\s+.*\bemail\b/i);
  });

  it("probe does not return raw auth_user_id column values", () => {
    // count(*) on admin_users is allowed; selecting the auth_user_id column is not
    expect(probeExec).not.toMatch(/select\b[\s\S]{0,50}auth_user_id\b/i);
    expect(probeExec).not.toMatch(/,\s*auth_user_id\b/i);
  });

  it("probe contains no database connection strings", () => {
    expect(probe).not.toMatch(/postgresql:\/\//i);
    expect(probe).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(probe).not.toMatch(/PGPASSWORD/i);
    expect(probe).not.toMatch(/DATABASE_URL/i);
    expect(probe).not.toMatch(/password\s*=\s*\S/i);
  });

  it("probe does not contain real email addresses", () => {
    expect(probe).not.toMatch(
      /[a-z0-9._%+-]+@(?!example\.com|staging\.example)[a-z0-9.-]+\.[a-z]{2,}/i
    );
  });

  it("probe does not reference production Supabase project ref", () => {
    expect(probe).not.toContain("qkkroesfiazsejkzflcd");
  });

  it("probe does not reference staging Supabase project ref", () => {
    expect(probe).not.toContain("ljfneyuvpxrmejpxsmpz");
  });
});

// ---------------------------------------------------------------------------
// Probe metadata — declares read_only and no_mutation
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — probe metadata", () => {
  it("probe metadata declares read_only: true", () => {
    expect(probe).toContain("'read_only'");
    expect(probe).toMatch(/'read_only'\s*,\s*true/i);
  });

  it("probe metadata declares no_mutation: true", () => {
    expect(probe).toContain("'no_mutation'");
    expect(probe).toMatch(/'no_mutation'\s*,\s*true/i);
  });

  it("probe metadata declares no_analyze: true", () => {
    expect(probe).toContain("'no_analyze'");
    expect(probe).toMatch(/'no_analyze'\s*,\s*true/i);
  });

  it("probe metadata declares pii_excluded: true", () => {
    expect(probe).toContain("'pii_excluded'");
    expect(probe).toMatch(/'pii_excluded'\s*,\s*true/i);
  });
});

// ---------------------------------------------------------------------------
// No auto-execution pathway
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — no auto-execution pathway", () => {
  it("probe is a .sql file with no embedded executor (no import/require)", () => {
    expect(probe).not.toMatch(/import\s+.*from\s+['"]/i);
    expect(probe).not.toMatch(/require\s*\(/i);
  });

  it("probe does not embed a Supabase client call", () => {
    expect(probe).not.toMatch(/createClient\s*\(/i);
    expect(probe).not.toMatch(/supabase\.from\(/i);
    expect(probe).not.toMatch(/supabase\.rpc\(/i);
  });
});

// ---------------------------------------------------------------------------
// Emergency admin RLS package regression guard
// The V1 probe is additive; it must not alter the emergency migration package.
// ---------------------------------------------------------------------------
describe("Business table RLS evidence probe V1 — emergency package regression guard", () => {
  it("staging migration still has status='active' on own-row branch (Part 8 fix)", () => {
    expect(staging).toMatch(
      /auth\.uid\(\)\s*=\s*auth_user_id\s+and\s+status\s*=\s*'active'/i
    );
  });

  it("staging migration still has is_admin_role inside a conditional DO block (Part 7 fix)", () => {
    expect(staging).toMatch(
      /if\s+exists\s*\(\s*select\s+1\s+from\s+pg_proc\s+fn/i
    );
  });

  it("staging migration still has explicit BEGIN; before STEP 0 (Part 10 fix)", () => {
    expect(staging).toMatch(/\bbegin\s*;/i);
  });

  it("staging migration still has explicit commit; after NOTIFY (Part 10 fix)", () => {
    expect(staging).toMatch(/notify\s+pgrst[\s\S]{0,50}commit\s*;/i);
  });

  it("rollback still does NOT disable RLS on admin_users (Part 8 fix)", () => {
    expect(rollbackExec).not.toMatch(
      /alter\s+table\s+public\.admin_users\s+disable\s+row\s+level\s+security/i
    );
  });

  it("rollback still disables RLS on admin_audit_log (staging pre-migration state)", () => {
    expect(rollbackExec).toMatch(
      /alter\s+table\s+public\.admin_audit_log\s+disable\s+row\s+level\s+security/i
    );
  });

  it("verification file still exists and is readable", () => {
    expect(verification.length).toBeGreaterThan(0);
  });

  it("verification file still identifies as the correct verification probe", () => {
    expect(verification).toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION");
  });

  it("V1 probe does not alter the staging migration file", () => {
    expect(staging).not.toContain("BUSINESS_TABLE_RLS_EVIDENCE_PROBE");
  });

  it("V1 probe does not alter the verification file", () => {
    expect(verification).not.toContain("BUSINESS_TABLE_RLS_EVIDENCE_PROBE");
  });

  it("V1 probe does not alter the rollback file", () => {
    expect(rollback).not.toContain("BUSINESS_TABLE_RLS_EVIDENCE_PROBE");
  });
});
