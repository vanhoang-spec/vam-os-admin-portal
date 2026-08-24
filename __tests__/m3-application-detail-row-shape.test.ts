import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3 regression — application detail consumes the application ROW, not a
 * QueryResult wrapper.
 *
 * Before M3 the detail page loaded `getApplication()`, which returns
 * `{ data, error }`, so every field read went through `application.data.X`.
 * M3 (1f8d21b) replaced that loader with `getApplicationDetailContext()`, which
 * returns the row itself — and every `application.data.X` was rewritten to
 * `application.X` except one: `application.data.profile_url`.
 *
 * `applications` has no `data` column, so `application.data` was `undefined` at
 * runtime and the property read threw, 500-ing EVERY /applications/[id] render.
 *
 * Nothing caught it:
 *   - `Application = JsonRecord & {...}` where `JsonRecord = Record<string, any>`,
 *     so `application.data` type-checks as `any` and `.profile_url` on it is
 *     legal to tsc. `npm run typecheck` passed on the broken code.
 *   - no unit test renders this route against a row-shaped application.
 *
 * These assertions are therefore made against the SOURCE TEXT on purpose: the
 * type system provably cannot express this constraint here, so a structural
 * guard is the only thing that can hold the line. Same approach as
 * m3-view-type-safety.test.ts.
 */

const DETAIL_PAGE = "app/applications/[id]/page.tsx";
const read = (path: string) => readFileSync(path, "utf8");

/** Recursively collect .ts/.tsx sources under the given roots. */
function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const root of roots) walk(root);
  return out;
}

describe("M3 application detail — row shape, not QueryResult shape", () => {
  it("never reaches through a `.data` hop on the singular application row", () => {
    const source = read(DETAIL_PAGE);

    // The exact defect, and any sibling of it: `application.data.<anything>`.
    // `applications.data` (plural, a real QueryResult) is deliberately NOT
    // matched — the negative lookbehind keeps this guard from firing on the
    // legitimate list-shaped reads elsewhere in the app.
    expect(source).not.toMatch(/(?<!applications)\bapplication\.data\b/);
  });

  it("consumes profile_url from the top-level application row", () => {
    const source = read(DETAIL_PAGE);

    expect(source).toMatch(/href=\{application\.profile_url\}/);
    expect(source).not.toMatch(/application\.data\.profile_url/);
  });

  it("binds the detail page to the row-returning loader", () => {
    const source = read(DETAIL_PAGE);

    // If this import is ever swapped back to a QueryResult-returning loader,
    // the two assertions above stop describing reality and must be revisited.
    expect(source).toMatch(/getApplicationDetailContext/);
    // `application` is destructured out of the context object, i.e. it is the row.
    expect(source).toMatch(/const\s*\{[\s\S]*?\bapplication\b[\s\S]*?\}\s*=\s*detailContext/);
  });

  it("declares profile_url as a top-level column on the Application type", () => {
    // Anchors the fix: reading `application.profile_url` is correct because the
    // column is on the row. `Record<string, any>` means tsc cannot enforce this.
    expect(read("lib/types.ts")).toMatch(/^\s*profile_url:\s*string \| null;/m);
  });

  it("leaves no `application.data.` reference anywhere in app/, lib/ or components/", () => {
    const offenders = sourceFiles(["app", "lib", "components"])
      .filter((file) => /(?<!applications)\bapplication\.data\./.test(read(file)))
      .map((file) => file.split(sep).join("/"));

    expect(offenders).toEqual([]);
  });
});
