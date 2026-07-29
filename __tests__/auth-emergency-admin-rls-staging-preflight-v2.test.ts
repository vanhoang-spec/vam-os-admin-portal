import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const V1_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT.sql";
const V2_PATH =
  "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V2.sql";

const v1 = readFileSync(V1_PATH, "utf8");
const v2 = readFileSync(V2_PATH, "utf8");

// Strip single-line SQL comments then string literals — mimics what the DB
// parser sees, so mutation checks are not fooled by header comments or labels.
function stripForExec(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const v2Exec = stripForExec(v2);

// ---------------------------------------------------------------------------
// V1 integrity — byte-for-byte preservation required by the task spec
// ---------------------------------------------------------------------------
describe("V1 preflight — unchanged invariant", () => {
  it("V1 file is still readable at its original path", () => {
    expect(v1.length).toBeGreaterThan(0);
  });

  it("V1 still identifies as V1 (probe identifier unchanged)", () => {
    expect(v1).toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V1");
  });

  it("V1 does NOT contain the V2 probe identifier (not accidentally overwritten)", () => {
    expect(v1).not.toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V2");
  });

  it("V1 does NOT reference fn.oid (alias used only in V2)", () => {
    expect(v1).not.toMatch(/fn\.oid/i);
  });
});

// ---------------------------------------------------------------------------
// V2 identity and header guards
// ---------------------------------------------------------------------------
describe("V2 preflight — identity and headers", () => {
  it("V2 probe identifier is present", () => {
    expect(v2).toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V2");
  });

  it("V2 does NOT identify itself as V1 (probe_version value, ignoring documentation comments)", () => {
    // Comments in the V2 header legitimately reference V1 for documentation.
    // After stripping comments, no V1 identifier should remain — the probe_version
    // string literal and all executable SQL must use V2.
    const v2NoComments = v2.replace(/--[^\n]*/g, "");
    expect(v2NoComments).not.toContain("VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING_PREFLIGHT_V1");
  });

  it("V2 declares all required safety headers", () => {
    for (const phrase of ["DESIGN ONLY", "STAGING ONLY", "NOT AUTHORIZED", "DO NOT EXECUTE"]) {
      expect(v2, `missing header: '${phrase}'`).toContain(phrase);
    }
  });

  it("V2 documents the V1 root cause (42702 / ambiguous oid)", () => {
    expect(v2).toMatch(/42702|ambiguous/i);
  });
});

// ---------------------------------------------------------------------------
// V2 root-cause fix — pg_proc OID must use qualified alias
// ---------------------------------------------------------------------------
describe("V2 preflight — catalog column qualification fix", () => {
  it("all pg_proc OID SELECT clauses use fn.oid (not bare oid)", () => {
    // After stripping comments there must be no `select oid from pg_proc`
    expect(v2Exec).not.toMatch(/select\s+oid\s+from\s+pg_proc/i);
  });

  it("V2 uses fn.oid in pg_proc subqueries", () => {
    expect(v2).toMatch(/select\s+fn\.oid\s+from\s+pg_proc/i);
  });

  it("pg_namespace join condition uses ns.oid (fully qualified)", () => {
    // All join conditions on pg_namespace OID must be qualified
    expect(v2).toMatch(/ns\.oid\s*=\s*fn\.pronamespace/i);
  });

  it("no bare unqualified `select oid` remains in catalog lookups after comment strip", () => {
    // Guard against any future regression — bare `oid` in any SELECT is disallowed
    expect(v2Exec).not.toMatch(/\bselect\s+oid\b/i);
  });
});

// ---------------------------------------------------------------------------
// V2 additions — items that were absent from V1
// ---------------------------------------------------------------------------
describe("V2 preflight — additions correcting V1 gaps", () => {
  it("adds get_operations_dashboard_data_authenticated (was missing from V1)", () => {
    expect(v2).toContain("get_operations_dashboard_data_authenticated");
  });

  it("V1 was missing get_operations_dashboard_data_authenticated (baseline assertion)", () => {
    expect(v1).not.toContain("get_operations_dashboard_data_authenticated");
  });

  it("adds dedicated admin_scope_access section (was absent from V1 output)", () => {
    expect(v2).toMatch(/'admin_scope_access'/);
  });

  it("V1 did not have a top-level admin_scope_access section", () => {
    // V1 only had admin_scope_access_rls_enabled buried in package_compatibility
    expect(v1).not.toMatch(/'admin_scope_access',\s*\(select/);
  });

  it("sections_present is 6 in V2 (was 5 in V1)", () => {
    expect(v2).toMatch(/'sections_present',\s*6/);
    expect(v1).toMatch(/'sections_present',\s*5/);
  });
});

// ---------------------------------------------------------------------------
// V2 required JSON sections
// ---------------------------------------------------------------------------
describe("V2 preflight — required JSON section keys", () => {
  const REQUIRED_SECTIONS = [
    "probe_version",
    "target_database",
    "admin_users",
    "admin_audit_log",
    "admin_scope_access",
    "continuity",
    "function_privileges",
    "package_compatibility",
    "summary",
  ] as const;

  for (const section of REQUIRED_SECTIONS) {
    it(`contains required section key '${section}'`, () => {
      expect(v2).toContain(`'${section}'`);
    });
  }
});

// ---------------------------------------------------------------------------
// V2 function_privileges coverage — all 4 functions × 2 roles
// ---------------------------------------------------------------------------
describe("V2 preflight — function_privileges completeness", () => {
  const PRIV_KEYS = [
    "current_admin_role_anon",
    "is_active_admin_anon",
    "is_admin_role_anon",
    "get_operations_dashboard_data_anon",
    "current_admin_role_authenticated",
    "is_active_admin_authenticated",
    "is_admin_role_authenticated",
    "get_operations_dashboard_data_authenticated",
  ] as const;

  for (const key of PRIV_KEYS) {
    it(`function_privileges includes '${key}'`, () => {
      expect(v2).toContain(`'${key}'`);
    });
  }
});

// ---------------------------------------------------------------------------
// V2 read-only shape — single WITH...SELECT, one row, one JSONB column
// ---------------------------------------------------------------------------
describe("V2 preflight — read-only query shape", () => {
  it("is a single WITH-based statement (starts with 'with')", () => {
    expect(v2Exec.trim().toLowerCase().startsWith("with")).toBe(true);
  });

  it("has exactly one semicolon (one statement)", () => {
    expect(v2Exec.match(/;/g)).toHaveLength(1);
  });

  it("returns exactly one JSONB column named preflight_result", () => {
    expect(v2).toContain("as preflight_result");
    expect(v2).toMatch(/select\s+jsonb_build_object\s*\(/i);
  });

  it("uses current_database() for target_database (not a hardcoded ref)", () => {
    expect(v2).toMatch(/current_database\(\)/i);
    expect(v2).not.toMatch(/ljfneyuvpxrmejpxsmpz/);
    expect(v2).not.toMatch(/qkkroesfiazsejkzflcd/);
  });
});

// ---------------------------------------------------------------------------
// V2 mutation check — no executable SQL after comment/literal stripping
// ---------------------------------------------------------------------------
describe("V2 preflight — mutation check", () => {
  const MUTATION_KEYWORDS = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "TRUNCATE",
    "CREATE",
    "ALTER",
    "DROP",
    "GRANT",
    "REVOKE",
    "COPY",
    "CALL",
  ] as const;

  for (const kw of MUTATION_KEYWORDS) {
    it(`no executable ${kw} after comment and literal stripping`, () => {
      expect(v2Exec).not.toMatch(new RegExp(`\\b${kw}\\b`, "i"));
    });
  }

  it("no DO block (no anonymous code execution)", () => {
    expect(v2Exec).not.toMatch(/\bdo\s*\$\$/i);
    expect(v2Exec).not.toMatch(/\bdo\s*\$\$?/i);
  });

  it("declared read_only true in summary section", () => {
    expect(v2).toMatch(/'read_only',\s*true/);
  });
});

// ---------------------------------------------------------------------------
// V2 PII and credential safety
// ---------------------------------------------------------------------------
describe("V2 preflight — PII and credential exclusion", () => {
  it("does not SELECT email column values", () => {
    // No raw email in output: no `au.email` or `u.email` in select position
    expect(v2Exec).not.toMatch(/,\s*au\.email\b/i);
    expect(v2Exec).not.toMatch(/,\s*u\.email\b/i);
  });

  it("does not SELECT raw auth_user_id values", () => {
    // auth_user_id used only in WHERE/JOIN conditions; never in SELECT output
    expect(v2).not.toMatch(/'auth_user_id',\s*au\.auth_user_id/i);
  });

  it("does not SELECT full_name or display name values", () => {
    expect(v2Exec).not.toMatch(/au\.full_name\b/i);
  });

  it("declares pii_excluded true in summary section", () => {
    expect(v2).toMatch(/'pii_excluded',\s*true/);
  });

  it("contains no connection strings or passwords", () => {
    expect(v2).not.toMatch(/postgresql:\/\//i);
    expect(v2).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(v2).not.toMatch(/PGPASSWORD/i);
    expect(v2).not.toMatch(/password\s*=\s*\S/i);
    expect(v2).not.toMatch(/DATABASE_URL/i);
  });

  it("contains no real email addresses", () => {
    expect(v2).not.toMatch(
      /[a-z0-9._%+-]+@(?!example\.com|staging\.example)[a-z0-9.-]+\.[a-z]{2,}/i
    );
  });

  it("contains no production Supabase project reference", () => {
    expect(v2).not.toContain("qkkroesfiazsejkzflcd");
  });

  it("contains no staging project reference (preflight is copyable SQL, not a connection string)", () => {
    expect(v2).not.toContain("ljfneyuvpxrmejpxsmpz");
  });
});

// ---------------------------------------------------------------------------
// No auto-execution pathway
// ---------------------------------------------------------------------------
describe("V2 preflight — no auto-run pathway", () => {
  it("no executor script exists at scripts/run_preflight_temp.mjs", () => {
    expect(() => readFileSync("scripts/run_preflight_temp.mjs", "utf8")).toThrow();
  });

  it("V2 SQL contains no import or require statements (not a Node module)", () => {
    expect(v2Exec).not.toMatch(/\b(import|require)\s*\(/i);
  });

  it("application layout does not import V2 preflight SQL", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).not.toContain("STAGING_PREFLIGHT");
  });
});
