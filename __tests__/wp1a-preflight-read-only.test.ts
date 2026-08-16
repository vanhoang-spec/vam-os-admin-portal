/**
 * The WP1-A2 preflight is the one artifact the owner runs against Production
 * before anything is converted. Its entire value rests on being incapable of
 * writing. This test is the guard on that property: it fails if a future edit
 * introduces a mutating statement, drops a read-only transaction guard, or
 * quietly adds the apply/rollback SQL that this package must not carry yet.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = "VAM_OS_WP1A_CANONICAL_SCOPE_20260816";
const PREFLIGHT = `${PACKAGE_DIR}/preflight.sql`;

const sql = readFileSync(PREFLIGHT, "utf8");

/**
 * Reduce the file to SQL CODE before asserting anything against it.
 *
 * Two things must be removed, and for the same reason: both can contain the
 * words this test hunts for without those words being statements.
 *
 *   1. `--` comments. The header documents exactly what the file refuses to do,
 *      so it necessarily contains "INSERT", "UPDATE", "DDL" and so on.
 *   2. Single-quoted string literals. Every check emits prose — "1 active
 *      grant", "the UEHM-S12 grant WP1-A2 creates" — and a naive /\bgrant\b/
 *      matches that text, which would fail this test for a reason that has
 *      nothing to do with the file's ability to write.
 *
 * Literals are replaced with an empty literal rather than deleted so the
 * surrounding SQL stays syntactically recognisable. Doubled '' escapes are
 * handled by the alternation.
 */
const withoutComments = sql
  .split("\n")
  .map((line) => {
    const idx = line.indexOf("--");
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join("\n");

const executable = withoutComments.replace(/'(?:[^']|'')*'/g, "''");

describe("WP1-A2 preflight is read-only", () => {
  it("exists", () => {
    expect(existsSync(PREFLIGHT)).toBe(true);
  });

  it.each([
    ["insert", /\binsert\s+into\b/i],
    ["update", /\bupdate\s+\w/i],
    ["delete", /\bdelete\s+from\b/i],
    ["merge", /\bmerge\s+into\b/i],
    ["truncate", /\btruncate\b/i],
    ["copy", /\bcopy\b/i],
    ["create", /\bcreate\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["alter", /\balter\s+(table|index|function|view|type|schema)\b/i],
    ["drop", /\bdrop\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["grant", /\bgrant\b/i],
    ["revoke", /\brevoke\b/i],
    ["do block", /\bdo\s+\$/i],
    ["commit", /\bcommit\b/i]
  ])("contains no %s statement", (_label, pattern) => {
    expect(executable).not.toMatch(pattern);
  });

  it("guards every transaction with SET TRANSACTION READ ONLY and ends it in ROLLBACK", () => {
    const begins = executable.match(/\bbegin\b/gi) ?? [];
    const readOnly = executable.match(/set\s+transaction\s+read\s+only/gi) ?? [];
    const rollbacks = executable.match(/\brollback\b/gi) ?? [];
    expect(begins.length).toBeGreaterThan(0);
    expect(readOnly.length).toBe(begins.length);
    expect(rollbacks.length).toBe(begins.length);
  });

  // Asserted against the literal-preserving view: the verdict IS a literal.
  it("emits a SAFE_TO_APPLY verdict that is false whenever any check FAILs", () => {
    expect(withoutComments).toMatch(/'SAFE_TO_APPLY'/);
    // The verdict must be derived from the checks, never asserted as a constant.
    expect(withoutComments).toMatch(/exists\s*\(\s*select\s+1\s+from\s+checks\s+where\s+result\s*=\s*'FAIL'\s*\)/i);
  });

  it("does not introduce a program-wide grant — that is WP1-A3", () => {
    // A2 converts to explicit S11 and S12 season grants. Any SQL here that
    // assigned a NULL season would be WP1-A3 work leaking in.
    expect(executable).not.toMatch(/season_id\s*=\s*null/i);
  });

  it("carries no apply, rollback or verifier SQL yet", () => {
    const files = readdirSync(PACKAGE_DIR).sort();
    expect(files).toEqual(["README.md", "preflight.sql"]);
  });
});
