import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isServerActionModule, scanServerActionExports } from "./use-server-scanner";

function checkSource(code: string) {
  const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
  return {
    isServerAction: isServerActionModule(sourceFile),
    invalidExports: scanServerActionExports(sourceFile),
  };
}

describe("Server Action Export Scanner", () => {
  it("1. Async function accepted", () => {
    const res = checkSource(`"use server"; export async function name() {}`);
    expect(res.isServerAction).toBe(true);
    expect(res.invalidExports).toEqual([]);
  });

  it("2. Async arrow accepted", () => {
    const res = checkSource(`"use server"; export const name = async () => {};`);
    expect(res.isServerAction).toBe(true);
    expect(res.invalidExports).toEqual([]);
  });

  it("3. Async function expression accepted", () => {
    const res = checkSource(`"use server"; export const name = async function() {};`);
    expect(res.isServerAction).toBe(true);
    expect(res.invalidExports).toEqual([]);
  });

  it("4. Default async function accepted", () => {
    const res = checkSource(`"use server"; export default async function name() {}`);
    expect(res.isServerAction).toBe(true);
    expect(res.invalidExports).toEqual([]);
  });

  it("5. Type export accepted", () => {
    const res = checkSource(`"use server"; export type MyType = {};`);
    expect(res.invalidExports).toEqual([]);
  });

  it("6. Interface export accepted", () => {
    const res = checkSource(`"use server"; export interface MyInterface {}`);
    expect(res.invalidExports).toEqual([]);
  });

  it("7. Object export rejected", () => {
    const res = checkSource(`"use server"; export const myObj = {};`);
    expect(res.invalidExports).toContainEqual({ name: "myObj", kind: "ObjectLiteralExpression", line: 1 });
  });

  it("8. Synchronous function rejected", () => {
    const res = checkSource(`"use server"; export function name() {}`);
    expect(res.invalidExports).toContainEqual({ name: "name", kind: "synchronous function", line: 1 });
  });

  it("9. Non-async arrow rejected", () => {
    const res = checkSource(`"use server"; export const name = () => {};`);
    expect(res.invalidExports).toContainEqual({ name: "name", kind: "non-async arrow function", line: 1 });
  });

  it("10. Class rejected", () => {
    const res = checkSource(`"use server"; export class MyClass {}`);
    expect(res.invalidExports).toContainEqual({ name: "MyClass", kind: "class", line: 1 });
  });

  it("11. Enum rejected", () => {
    const res = checkSource(`"use server"; export enum MyEnum { A }`);
    expect(res.invalidExports).toContainEqual({ name: "MyEnum", kind: "enum", line: 1 });
  });

  it("12. Mixed valid and invalid exports rejected", () => {
    const res = checkSource(`"use server"; export async function valid() {}; export const invalid = 42;`);
    expect(res.invalidExports).toEqual([{ name: "invalid", kind: "FirstLiteralToken", line: 1 }]);
  });

  it("13. Top-level 'use server' detected", () => {
    const res = checkSource(`"use server";\nexport async function a() {}`);
    expect(res.isServerAction).toBe(true);
  });

  it("14. Function-level inline 'use server' does not classify the module", () => {
    const res = checkSource(`export async function a() { "use server"; }`);
    expect(res.isServerAction).toBe(false);
  });

  it("15. Ambiguous named re-export rejected", () => {
    const res = checkSource(`"use server"; export { someFunc } from "./other";`);
    expect(res.invalidExports).toContainEqual({ name: "someFunc", kind: "ambiguous named re-export", line: 1 });
  });

  it("16. Wildcard re-export rejected", () => {
    const res = checkSource(`"use server"; export * from "./other";`);
    expect(res.invalidExports).toContainEqual({ name: "*", kind: "wildcard re-export", line: 1 });
  });

  it("17. Membership action module passes", () => {
    const filePath = "app/actions/membership-lifecycle.ts";
    const sourceCode = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
    expect(isServerActionModule(sourceFile)).toBe(true);
    expect(scanServerActionExports(sourceFile)).toEqual([]);
  });

  it("18. Admin-user import action module passes", () => {
    const filePath = "app/admin/users/import/actions.ts";
    const sourceCode = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
    expect(isServerActionModule(sourceFile)).toBe(true);
    expect(scanServerActionExports(sourceFile)).toEqual([]);
  });
});

describe("Repository-wide Audit", () => {
  function walkDir(dir: string, fileList: string[] = []) {
    const files = readdirSync(dir);
    for (const file of files) {
      if (file === "node_modules" || file === ".git" || file === ".next" || file.startsWith(".tmp_") || file === "coverage") continue;
      const filePath = join(dir, file);
      if (statSync(filePath).isDirectory()) {
        walkDir(filePath, fileList);
      } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
        fileList.push(filePath);
      }
    }
    return fileList;
  }

  it("19. Entire current repository passes", () => {
    const allFiles = walkDir(".");
    const violations: { file: string; exports: any[] }[] = [];
    let serverActionCount = 0;

    for (const file of allFiles) {
      const code = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
      if (isServerActionModule(sourceFile)) {
        serverActionCount++;
        const invalidExports = scanServerActionExports(sourceFile);
        if (invalidExports.length > 0) {
          violations.push({ file, exports: invalidExports });
        }
      }
    }

    expect(serverActionCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
