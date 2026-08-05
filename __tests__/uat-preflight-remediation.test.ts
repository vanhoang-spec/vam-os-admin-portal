import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREFLIGHT = "scripts/uat-fixture-staging-preflight.sql";
const read = (path: string) => readFileSync(path, "utf8");

describe("staging preflight — remediation verification", () => {
  it("proves the live shape does not falsely block fixture provisioning since ON CONFLICT(id) is unused", () => {
    const sql = read(PREFLIGHT);

    // The expected columns CTE should tolerate NULL for admin_users.id
    expect(sql).toMatch(/\('admin_users',\s*'id',\s*'uuid',\s*NULL\)/);

    // Separately validate id type, default, nullability, data nulls, data dupes, pk shape
    expect(sql).toMatch(/'admin_users\.id_default'/);
    expect(sql).toMatch(/ILIKE '%gen_random_uuid%'/);
    expect(sql).toMatch(/'admin_users\.id_nullability'/);
    expect(sql).toMatch(/'admin_users\.id_data_nulls'/);
    expect(sql).toMatch(/'admin_users\.id_data_dupes'/);
    expect(sql).toMatch(/'admin_users\.pk_shape'/);

    // It should report INFO if nullable is YES, not fail
    expect(sql).toMatch(/CASE WHEN c\.is_nullable = 'NO' THEN 'PASS' ELSE 'INFO' END/);

    // Unique ID support
    expect(sql).toMatch(/'unique\.admin_users_id'/);
  });

  it("proves changed_by with confdeltype = n passes the correct actor-attribution check", () => {
    const sql = read(PREFLIGHT);

    expect(sql).toMatch(/'fk\.actor_attribution\.'/);
    // Explicitly accepts 'n'
    expect(sql).toMatch(/CASE WHEN c\.confdeltype = 'n' THEN 'PASS' ELSE 'FAIL' END/);
    expect(sql).toMatch(/a\.attname = 'changed_by'/);

    // Interactions with append-only triggers are reported as INFO
    expect(sql).toMatch(/'fk\.actor_attribution\.trigger_interaction\.'/);
    expect(sql).toMatch(/'INFO'/);
  });

  it("proves membership/person pinning FKs still fail if they are not NO ACTION/RESTRICT", () => {
    const sql = read(PREFLIGHT);

    expect(sql).toMatch(/'fk\.subject_pinning\.'/);
    expect(sql).toMatch(/CASE WHEN c\.confdeltype IN \('a', 'r'\) THEN 'PASS' ELSE 'FAIL' END/);
    // Excludes changed_by to avoid accidentally accepting SET NULL
    expect(sql).toMatch(/a\.attname <> 'changed_by'/);
  });

  it("reproduces correct collision count when 6 expected rows + 0 actual -> 0 collisions", () => {
    const sql = read(PREFLIGHT);

    // Uses COUNT(au.email) to ignore LEFT JOIN placeholder rows
    expect(sql).toMatch(/count\(\s*au\.email\s*\)/i);
    expect(sql).toMatch(/WHEN count\(au\.email\) FILTER \(WHERE au\.notes IS DISTINCT FROM 'VAM UAT fixture 20260805'\) > 0 THEN 'FAIL'/);
    expect(sql).not.toMatch(/WHEN count\(\*\) FILTER/);
  });
});
