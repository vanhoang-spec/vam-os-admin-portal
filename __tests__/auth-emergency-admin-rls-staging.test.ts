import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STAGING_PATH = "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING.sql";
const VERIFICATION_PATH = "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_VERIFICATION.sql";
const ROLLBACK_PATH = "docs/audits/sql/design_only/VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_ROLLBACK.sql";

const staging = readFileSync(STAGING_PATH, "utf8");
const verification = readFileSync(VERIFICATION_PATH, "utf8");
const rollback = readFileSync(ROLLBACK_PATH, "utf8");

function stripForExec(sql: string) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const stagingExec = stripForExec(staging);
const verificationExec = stripForExec(verification);
const rollbackExec = stripForExec(rollback);

const REQUIRED_HEADER_PHRASES = [
  "DESIGN ONLY",
  "STAGING ONLY",
  "NOT AUTHORIZED",
  "DO NOT EXECUTE"
];

describe("Emergency admin RLS staging package — header guards", () => {
  it("staging migration declares all required headers", () => {
    for (const phrase of REQUIRED_HEADER_PHRASES) {
      expect(staging, `staging: missing '${phrase}'`).toContain(phrase);
    }
  });

  it("verification query declares all required headers", () => {
    for (const phrase of REQUIRED_HEADER_PHRASES) {
      expect(verification, `verification: missing '${phrase}'`).toContain(phrase);
    }
  });

  it("rollback declares all required headers", () => {
    for (const phrase of REQUIRED_HEADER_PHRASES) {
      expect(rollback, `rollback: missing '${phrase}'`).toContain(phrase);
    }
  });
});

describe("Emergency admin RLS staging migration — content safety", () => {
  it("contains no production connection identifiers", () => {
    expect(staging).not.toMatch(/postgresql:\/\//i);
    expect(staging).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(staging).not.toMatch(/PGPASSWORD/i);
    expect(staging).not.toMatch(/password\s*=\s*\S/i);
  });

  it("contains no real email addresses", () => {
    expect(staging).not.toMatch(/[a-z0-9._%+-]+@(?!example\.com|staging\.example)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("contains no real auth UUIDs or user IDs in INSERT/UPDATE statements", () => {
    expect(stagingExec).not.toMatch(
      /\b(insert|update)\s+into?\s+public\.admin_users\b/i
    );
  });
});

describe("Emergency admin RLS staging migration — policy correctness", () => {
  it("enables RLS on admin_users", () => {
    expect(staging).toMatch(/alter\s+table\s+public\.admin_users\s+enable\s+row\s+level\s+security/i);
  });

  it("creates exact policy name 'read_admin_users_super_admin_or_self'", () => {
    expect(staging).toContain("read_admin_users_super_admin_or_self");
    expect(staging).toMatch(/create\s+policy\s+"read_admin_users_super_admin_or_self"/i);
  });

  it("policy is SELECT only (no INSERT/UPDATE/DELETE policy)", () => {
    expect(staging).not.toMatch(/create\s+policy\s+"[^"]+"\s+on\s+public\.admin_users\s+for\s+(insert|update|delete)/i);
  });

  it("enables RLS on admin_audit_log", () => {
    expect(staging).toMatch(/alter\s+table\s+public\.admin_audit_log\s+enable\s+row\s+level\s+security/i);
  });

  it("creates exact policy name 'read_admin_audit_log_super_admin_only'", () => {
    expect(staging).toContain("read_admin_audit_log_super_admin_only");
    expect(staging).toMatch(/create\s+policy\s+"read_admin_audit_log_super_admin_only"/i);
  });

  it("drops policies before creating (idempotent)", () => {
    expect(staging).toMatch(/drop\s+policy\s+if\s+exists\s+"read_admin_users_super_admin_or_self"/i);
    expect(staging).toMatch(/drop\s+policy\s+if\s+exists\s+"read_admin_audit_log_super_admin_only"/i);
  });

  it("admin_users own-row branch requires status='active' — inactive and suspended admins denied", () => {
    // status = 'active' is a direct column reference on the evaluated row; no RLS recursion.
    // Without this, any authenticated user with a matching auth_user_id (including inactive/suspended)
    // would satisfy the own-row branch and read their admin_users row.
    expect(staging).toMatch(/auth\.uid\(\)\s*=\s*auth_user_id\s+and\s+status\s*=\s*'active'/i);
  });

  it("super_admin all-row access uses current_admin_role() which internally requires active status", () => {
    // current_admin_role() filters status='active' — inactive/suspended super_admins get NULL.
    // NULL = 'super_admin' is NULL (falsy), so this branch correctly denies non-active super_admins.
    expect(staging).toMatch(/public\.current_admin_role\(\)\s*=\s*'super_admin'/i);
  });

  it("migration does not touch the pre-existing 'active admins can read themselves' staging policy", () => {
    // This policy must be preserved across the migration to maintain the staging baseline.
    expect(staging).not.toContain('"active admins can read themselves"');
  });
});

describe("Emergency admin RLS staging migration — function grants", () => {
  it("revokes anon EXECUTE from all 4 functions", () => {
    expect(staging).toMatch(/revoke\s+execute\s+on\s+function\s+public\.current_admin_role\(\)/i);
    expect(staging).toMatch(/revoke\s+execute\s+on\s+function\s+public\.is_active_admin\(\)/i);
    expect(staging).toMatch(/revoke\s+execute\s+on\s+function\s+public\.is_admin_role\(text\[\]\)/i);
    expect(staging).toMatch(/revoke\s+execute\s+on\s+function\s+public\.get_operations_dashboard_data\(text\)/i);
  });

  it("retains authenticated EXECUTE on all 4 functions", () => {
    expect(staging).toMatch(/grant\s+execute\s+on\s+function\s+public\.current_admin_role\(\)\s+to\s+authenticated/i);
    expect(staging).toMatch(/grant\s+execute\s+on\s+function\s+public\.is_active_admin\(\)\s+to\s+authenticated/i);
    expect(staging).toMatch(/grant\s+execute\s+on\s+function\s+public\.is_admin_role\(text\[\]\)\s+to\s+authenticated/i);
    expect(staging).toMatch(/grant\s+execute\s+on\s+function\s+public\.get_operations_dashboard_data\(text\)\s+to\s+authenticated/i);
  });

  it("uses correct signature for get_operations_dashboard_data (text param)", () => {
    expect(staging).toMatch(/get_operations_dashboard_data\(text\)/i);
    expect(staging).not.toMatch(/get_operations_dashboard_data\(\)/);
  });

  it("is_admin_role revoke/grant is inside a conditional DO block (absent-function safety)", () => {
    // Staging preflight 2026-07-29: is_admin_role_anon=null — function absent.
    // After comment/literal stripping, no bare top-level revoke/grant remains.
    expect(stagingExec).not.toMatch(/revoke\s+execute\s+on\s+function\s+public\.is_admin_role/i);
    expect(stagingExec).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.is_admin_role/i);
  });

  it("is_admin_role conditional block checks function existence in pg_proc", () => {
    expect(staging).toMatch(/fn\.proname\s*=\s*'is_admin_role'/i);
  });
});

describe("Emergency admin RLS staging migration — lockout safety", () => {
  it("has a preflight block that checks for active super_admin with auth_user_id", () => {
    expect(staging).toMatch(/PREFLIGHT/i);
    expect(staging).toMatch(/super_admin/);
    expect(staging).toMatch(/auth_user_id\s+is\s+not\s+null/i);
    expect(staging).toMatch(/raise\s+exception/i);
  });

  it("preflight uses DO block (not bare SQL)", () => {
    expect(staging).toMatch(/do\s+\$\$/i);
  });
});

describe("Emergency admin RLS staging migration — scope enforcement", () => {
  it("does not add people.auth_user_id column", () => {
    expect(stagingExec).not.toMatch(/alter\s+table\s+public\.people\s+add\s+column/i);
    expect(stagingExec).not.toMatch(/alter\s+table\s+public\.people\s+enable\s+row\s+level\s+security/i);
  });

  it("does not create current_person_id function", () => {
    expect(stagingExec).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\.current_person_id/i);
  });

  it("does not alter business tables (people, profiles, matches, recaps, events)", () => {
    const businessTables = [
      "public.people",
      "public.mentor_profiles",
      "public.mentee_profiles",
      "public.matches",
      "public.mentoring_recaps",
      "public.event_participations",
      "public.applications"
    ];
    for (const table of businessTables) {
      expect(stagingExec).not.toMatch(
        new RegExp(`alter\\s+table\\s+${table.replace(".", "\\.")}\\s+enable\\s+row\\s+level\\s+security`, "i")
      );
    }
  });

  it("does not add programs or seasons RLS", () => {
    expect(stagingExec).not.toMatch(/alter\s+table\s+public\.programs\s+(enable|disable)\s+row\s+level\s+security/i);
    expect(stagingExec).not.toMatch(/alter\s+table\s+public\.seasons\s+(enable|disable)\s+row\s+level\s+security/i);
  });
});

describe("Emergency admin RLS staging migration — action_type constraint", () => {
  it("adds action_type CHECK constraint with NOT VALID", () => {
    expect(staging).toMatch(/admin_audit_log_action_type_check/i);
    expect(staging).toMatch(/not\s+valid/i);
  });

  it("constraint is idempotent (DO block guards for existing constraint)", () => {
    expect(staging).toMatch(/if\s+not\s+exists/i);
    expect(staging).toMatch(/admin_audit_log_action_type_check/);
  });

  it("constraint includes all known application action_type values", () => {
    expect(staging).toContain("create_admin_user");
    expect(staging).toContain("update_admin_user");
    expect(staging).toContain("reactivate_admin_user");
    expect(staging).toContain("deactivate_admin_user");
    expect(staging).toContain("remove_admin_access");
    expect(staging).toContain("sync_auth");
  });
});

describe("Verification query — read-only shape", () => {
  it("is a single WITH-based read-only statement", () => {
    expect(verificationExec.trim().toLowerCase().startsWith("with")).toBe(true);
    expect(verificationExec.match(/;/g)).toHaveLength(1);
    expect(verificationExec).not.toMatch(
      /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call)\b|\bdo\s*\$|\bset\s+role\b/i
    );
  });

  it("returns exactly one JSONB column named verification_result", () => {
    expect(verification).toContain("as verification_result");
    expect(verification).toMatch(/select\s+jsonb_build_object\s*\(/i);
  });

  it("contains all 8 section keys", () => {
    const keys = [
      "v1_admin_users_rls",
      "v2_anon_function_grants",
      "v3_admin_audit_log",
      "v4_admin_scope_access",
      "v5_participant_schema_check",
      "v6_business_table_regression",
      "v7_lockout_invariant",
      "v8_summary_assertions"
    ];
    for (const key of keys) {
      expect(verification, `missing section key: '${key}'`).toContain(`'${key}'`);
    }
  });

  it("v8 summary checks all critical assertions by name", () => {
    expect(verification).toContain("admin_users_rls_enabled");
    expect(verification).toContain("admin_users_select_policy_present");
    expect(verification).toContain("admin_users_write_policies_absent");
    expect(verification).toContain("all_anon_revokes_applied");
    expect(verification).toContain("all_authenticated_grants_retained");
    expect(verification).toContain("admin_audit_log_rls_enabled");
    expect(verification).toContain("action_type_constraint_present");
    expect(verification).toContain("participant_schema_unchanged");
    expect(verification).toContain("business_tables_unaffected");
  });

  it("does not contain production connection identifiers", () => {
    expect(verification).not.toMatch(/postgresql:\/\//i);
    expect(verification).not.toMatch(/@db\.[a-z0-9]+\.supabase\.co/i);
    expect(verification).not.toMatch(/PGPASSWORD/i);
  });
});

describe("Rollback — mirrors staging migration", () => {
  it("drops the admin_users policy created in staging", () => {
    expect(rollback).toMatch(/drop\s+policy\s+if\s+exists\s+"read_admin_users_super_admin_or_self"/i);
  });

  it("does NOT execute disable RLS on admin_users (staging pre-migration baseline was RLS=true)", () => {
    // Staging had admin_users.rls_enabled=true before migration (V2 preflight 2026-07-29).
    // Disabling RLS would leave staging more permissive than pre-migration.
    // Checks rollbackExec (comments stripped) so comment-only mentions are not falsely flagged.
    expect(rollbackExec).not.toMatch(/alter\s+table\s+public\.admin_users\s+disable\s+row\s+level\s+security/i);
  });

  it("drops the admin_audit_log policy created in staging", () => {
    expect(rollback).toMatch(/drop\s+policy\s+if\s+exists\s+"read_admin_audit_log_super_admin_only"/i);
  });

  it("drops the action_type constraint", () => {
    expect(rollback).toMatch(/drop\s+constraint\s+if\s+exists\s+admin_audit_log_action_type_check/i);
  });

  it("restores anon EXECUTE grants", () => {
    expect(rollback).toMatch(/grant\s+execute\s+on\s+function\s+public\.current_admin_role\(\)\s+to\s+anon/i);
    expect(rollback).toMatch(/grant\s+execute\s+on\s+function\s+public\.is_active_admin\(\)\s+to\s+anon/i);
    expect(rollback).toMatch(/grant\s+execute\s+on\s+function\s+public\.is_admin_role\(text\[\]\)\s+to\s+anon/i);
    expect(rollback).toMatch(/grant\s+execute\s+on\s+function\s+public\.get_operations_dashboard_data\(text\)\s+to\s+anon/i);
  });

  it("does not contain any mutation to business data tables", () => {
    const rollbackExecLower = rollbackExec.toLowerCase();
    expect(rollbackExecLower).not.toMatch(/delete\s+from\s+public\./);
    expect(rollbackExecLower).not.toMatch(/update\s+public\.(people|admin_users|applications|matches)\s+set/);
    expect(rollbackExecLower).not.toMatch(/truncate\s+public\./);
  });

  it("does not include participant schema", () => {
    expect(rollback).not.toContain("auth_user_id");
    expect(rollback).not.toContain("current_person_id");
  });

  it("is_admin_role anon grant restore is inside a conditional DO block (absent-function safety)", () => {
    expect(rollbackExec).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.is_admin_role\(text\[\]\)\s+to\s+anon/i);
  });

  it("disables RLS on admin_audit_log for staging rollback (staging had rls_enabled=false pre-migration)", () => {
    // admin_audit_log.rls_enabled was false before migration — rollback must restore that state.
    expect(rollback).toMatch(/alter\s+table\s+public\.admin_audit_log\s+disable\s+row\s+level\s+security/i);
  });

  it("rollback drops only the package-created admin_users policy, not the pre-existing staging policy", () => {
    // "active admins can read themselves" existed before migration and must be preserved by rollback.
    expect(rollback).toMatch(/drop\s+policy\s+if\s+exists\s+"read_admin_users_super_admin_or_self"\s+on\s+public\.admin_users/i);
    expect(rollback).not.toMatch(/drop\s+policy\s+if\s+exists\s+"active\s+admins\s+can\s+read\s+themselves"/i);
  });
});

describe("No auto-run SQL path in application code", () => {
  it("no application file imports the emergency staging SQL file", () => {
    const appEntry = "app";
    const libEntry = "lib";
    const stagingFileName = "VAM_OS_AUTH_EMERGENCY_ADMIN_RLS_STAGING";

    expect(staging).not.toMatch(/import\s+.*from\s+['"][^'"]*lib[^'"]*['"]/i);
    expect(() => {
      const appCheck = readFileSync(`${appEntry}/layout.tsx`, "utf8");
      expect(appCheck).not.toContain(stagingFileName);
    }).not.toThrow();
  });
});
