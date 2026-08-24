import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("M3 View Type Safety - PostgreSQL Live Schema Cast Fixes", () => {
  const migrations = [
    "supabase_migrations/078_application_list_v1.sql",
    "supabase_migrations/079_application_review_states.sql",
    "supabase_migrations/082_r3_final_gate_remediation.sql"
  ];

  it.each(migrations)("prevents text/enum COALESCE mismatch in %s", (path) => {
    const sql = read(path);
    
    // We expect NO instance of `coalesce(status, final_status)` without `::text`
    // Match coalesce(status, final_status) optionally prefixed by aliases
    expect(sql).not.toMatch(/coalesce\s*\(\s*([a-z]\.)?status\s*,\s*([a-z]\.)?final_status\s*\)/i);

    // We do expect `final_status::text`
    expect(sql).toMatch(/coalesce\s*\(\s*([a-z]\.)?status\s*,\s*([a-z]\.)?final_status::text\s*\)/i);
  });

  it.each(migrations)("prevents UUID/empty-string COALESCE mismatch in %s", (path) => {
    const sql = read(path);
    // person_id is a UUID. Coalescing with '' requires ::text
    expect(sql).not.toMatch(/coalesce\s*\(\s*([a-z]\.)?person_id\s*,\s*''\s*\)/i);
    // Expect the safe version
    expect(sql).toMatch(/coalesce\s*\(\s*([a-z]\.)?person_id::text\s*,\s*''\s*\)/i);
  });

  it.each(migrations)("prevents UUID concatenation mismatch in %s", (path) => {
    const sql = read(path);
    // a.id is a UUID. In a string concatenation it needs ::text
    // It should not be `a.id ||` without cast
    expect(sql).not.toMatch(/[^a-z_]id\s*\|\|/i);
    expect(sql).toMatch(/id::text\s*\|\|/i);
  });
});
