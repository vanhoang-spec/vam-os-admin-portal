import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const MIGRATION_062 = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const PREFLIGHT_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql";
const POST_APPLY_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const ROLLBACK_062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql";
const MEMBERSHIP_PREFLIGHT_063 = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql";
const ALL_REVIEWED_SQL = [MIGRATION_062, PREFLIGHT_062, POST_APPLY_062, ROLLBACK_062, MEMBERSHIP_PREFLIGHT_063, MIGRATION_063];

// Strips '--' line comments so assertions below are proven against the
// executable SQL body only, never satisfied by a match inside a comment.
const stripLineComments = (sql: string) =>
  sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

describe("migration 062 pg_index remediation: indisnullsnotdistinct -> indnullsnotdistinct", () => {
  it("1. no executable SQL in any reviewed file contains the misspelled column indisnullsnotdistinct", () => {
    for (const path of ALL_REVIEWED_SQL) {
      const exec = stripLineComments(read(path));
      expect(exec).not.toMatch(/\bindisnullsnotdistinct\b/i);
    }
  });

  it("2. no executable SQL in any reviewed file contains the alternate misspelling indsnullsnotdistinct", () => {
    for (const path of ALL_REVIEWED_SQL) {
      const exec = stripLineComments(read(path));
      expect(exec).not.toMatch(/\bindsnullsnotdistinct\b/i);
    }
  });

  it("3. every pg_index guard that previously used the misspelled column now uses indnullsnotdistinct", () => {
    const migrationGuardOccurrences = (stripLineComments(read(MIGRATION_062)).match(/not\s+i\.indnullsnotdistinct/g) ?? []).length;
    expect(migrationGuardOccurrences).toBe(3); // admin_users email arbiter, admin_scope_access arbiter, membership unique-index guard

    const preflightOccurrences = (stripLineComments(read(PREFLIGHT_062)).match(/indnullsnotdistinct/g) ?? []).length;
    expect(preflightOccurrences).toBe(4); // index_shape projection, arbiter_assert usage, scope_arbiter_assert, primary_keys:admin_users_id_unique

    expect(stripLineComments(read(MEMBERSHIP_PREFLIGHT_063))).toContain("not i.indnullsnotdistinct");
    expect(stripLineComments(read(MIGRATION_063))).toContain("not i.indnullsnotdistinct");
  });

  it("4. assertions above are proven against executable SQL, not merely a mention in a comment", () => {
    const raw = read(MIGRATION_062);
    const exec = stripLineComments(raw);
    expect(exec).toContain("not i.indnullsnotdistinct");
    // sanity check that stripLineComments actually removes comment-only content
    expect(stripLineComments("-- i.indisnullsnotdistinct mentioned only in a comment\nselect 1;")).not.toContain("indisnullsnotdistinct");
    expect(raw).toContain("-- admin_users(email) arbiter"); // comments still present in the raw file, proving the strip step is meaningful
  });

  it("5. the admin_users(email) arbiter guard remains fully strict: unique, valid, ready, single-key, no predicate/expression, distinct-nulls required", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const startIdx = exec.indexOf("c.relname='admin_users'");
    const guard = exec.slice(startIdx, exec.indexOf("conflict target missing, altered, or ambiguous'; end if;", startIdx) + 1);
    expect(guard).toContain("i.indisunique");
    expect(guard).toContain("i.indisvalid");
    expect(guard).toContain("i.indisready");
    expect(guard).toContain("not i.indnullsnotdistinct");
    expect(guard).toContain("i.indnkeyatts=1");
    expect(guard).toContain("i.indpred is null");
    expect(guard).toContain("i.indexprs is null");
    expect(guard).toContain("='email'");
  });

  it("6. the person_season_memberships (person_id, season_id, role) unique-index guard remains fully strict", () => {
    const exec = stripLineComments(read(MIGRATION_062));
    const idx = exec.indexOf("UNIQUE (person_id, season_id, role)");
    const guard = exec.slice(idx, exec.indexOf("membership conflict target missing, altered, or ambiguous'; end if;") + 1);
    expect(guard).toContain("i.indisunique");
    expect(guard).toContain("i.indisvalid");
    expect(guard).toContain("i.indisready");
    expect(guard).toContain("i.indnkeyatts=3");
    expect(guard).toContain("i.indpred is null");
    expect(guard).toContain("i.indexprs is null");
    expect(guard).toContain("not i.indnullsnotdistinct");
  });

  it("7. the admin_scope_access active-scope arbiter guard remains fully strict in the migration, both design-only preflights, and migration 063", () => {
    for (const path of [MIGRATION_062, PREFLIGHT_062, MEMBERSHIP_PREFLIGHT_063, MIGRATION_063]) {
      const exec = stripLineComments(read(path));
      const idx = exec.indexOf("c.relname='admin_scope_access'");
      expect(idx).toBeGreaterThan(-1);
      const guard = exec.slice(idx, idx + 700);
      expect(guard).toContain("i.indisunique");
      expect(guard).toContain("i.indisvalid");
      expect(guard).toContain("i.indisready");
      expect(guard).toContain("not i.indnullsnotdistinct");
      expect(guard).toContain("i.indnkeyatts=4");
      expect(guard).toContain("i.indpred is not null");
      expect(guard).toContain("i.indexprs is not null");
    }
  });

  it("8. migration 063 changed by exactly the one confirmed equivalent defect (the same misspelled column), nothing else", () => {
    const baselineHead = "1569ba8483c7e6f7fb5125f629dd671babc3b51b";
    const result = spawnSync("git", ["show", `${baselineHead}:${MIGRATION_063}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const before = result.stdout;
    const after = read(MIGRATION_063);
    expect(before).toContain("not i.indisnullsnotdistinct");
    expect(after).toContain("not i.indnullsnotdistinct");
    expect(after).not.toContain("indisnullsnotdistinct");
    // every other line is byte-for-byte identical
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    const diffLines = beforeLines.filter((line, i) => line !== afterLines[i]);
    expect(diffLines.length).toBe(1);
    expect(diffLines[0]).toContain("indisnullsnotdistinct");
  });

  it("9. rollback and migration-063 membership-lifecycle rollback sources never referenced the misspelled or corrected column (no equivalent defect existed there)", () => {
    const baselineHead = "1569ba8483c7e6f7fb5125f629dd671babc3b51b";
    const result = spawnSync("git", ["show", `${baselineHead}:${ROLLBACK_062}`], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(read(ROLLBACK_062)).toBe(result.stdout);
    expect(read(ROLLBACK_062)).not.toMatch(/indisnullsnotdistinct|indnullsnotdistinct/);
  });
});
