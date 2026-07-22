import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const probe = readFileSync("docs/audits/sql/VAM_OS_PRODUCTION_BASELINE_GAPS_SINGLE_RESULT_READONLY_PROBE.sql", "utf8");
const parser = readFileSync("scripts/parse_baseline_gaps_offline.mjs", "utf8");
const code = probe.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");

describe("baseline-gaps owner execution readiness", () => {
  it("keeps the probe to one read-only WITH/SELECT and one JSONB result", () => {
    expect(code.trim().toLowerCase().startsWith("with")).toBe(true);
    expect(code.match(/;/g)).toHaveLength(1);
    expect(code.trim()).toMatch(/SELECT\s+baseline_gap_metadata\s+FROM\s+payload;$/i);
    expect(code).not.toMatch(/\b(insert|update|delete|merge|copy|create|alter|drop|grant|revoke|truncate|do|call|execute)\b/i);
    expect(probe).toContain("jsonb_build_object");
  });

  it("uses catalog metadata and includes required function and trigger provenance", () => {
    for (const catalog of ["pg_type", "pg_enum", "pg_class", "pg_rewrite", "pg_depend", "pg_sequence", "pg_proc", "pg_trigger"]) expect(probe).toContain(catalog);
    expect(probe).toContain("pg_get_functiondef");
    expect(probe).toContain("pg_get_triggerdef");
    expect(probe).toContain("NOT tg.tgisinternal");
    expect(probe).toContain("'triggers'");
  });

  it("keeps the parser offline, redacted, and schema-aware", () => {
    expect(parser).toContain('from "node:fs/promises"');
    expect(parser).not.toMatch(/from\s+["'](?:@supabase|pg|postgres)|fetch\s*\(|https?:\/\//i);
    expect(parser).toContain('"triggers"');
    expect(parser).toContain("suspicious_pattern_counts");
    expect(parser).toContain("raw_file_commit_allowed: false");
    expect(parser).not.toContain("console.log(value");
  });
});
