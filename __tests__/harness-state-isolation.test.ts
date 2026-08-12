/**
 * Regression suite for the test harness itself.
 *
 * The active-admin middleware suite failed intermittently, not because the
 * middleware was wrong but because the harness leaked process state between
 * tests. Three channels were open at once:
 *
 *   1. `process.env = { ...originalEnv }` in an `afterEach` replaced Node's
 *      exotic env object with an ordinary one for the remaining life of the
 *      worker, changing env semantics for every test that ran afterwards.
 *   2. `globalThis.fetch` was restored from a value captured once per describe,
 *      so an ordering where something else had already replaced fetch captured
 *      the contaminated binding as "original".
 *   3. `vi.spyOn(console, "error")` was undone by a `mockRestore()` at the end
 *      of the test body, which a failing expectation skips — leaving console
 *      mocked for every later test in the file.
 *
 * All three are order-dependent, which is exactly why they presented as flake.
 * These tests fail if any of the three is reintroduced.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import {
  restoreProcessState,
  snapshotProcessState,
  type ProcessStateSnapshot
} from "./support/process-state";

const repoRoot = join(__dirname, "..");

/**
 * Every test file except this one. This file is excluded because it carries the
 * forbidden patterns as regex literals in order to search for them; including
 * it would make the guards match themselves.
 */
function testFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name) && full !== __filename) out.push(full);
    }
  };
  walk(join(repoRoot, "__tests__"));
  return out;
}

// ---------------------------------------------------------------------------
// 1. Contamination by a previous test
// ---------------------------------------------------------------------------

const SENTINEL_ADDED = "VAM_OS_HARNESS_SENTINEL_ADDED";
const SENTINEL_PREEXISTING = "VAM_OS_HARNESS_SENTINEL_PREEXISTING";

describe("state set by a previous test does not reach the next one", () => {
  let processState: ProcessStateSnapshot;
  let pristineFetch: typeof globalThis.fetch;
  let pristineEnvObject: NodeJS.ProcessEnv;

  beforeAll(() => {
    // A value that exists BEFORE any test runs, so a test can delete it and the
    // next test can prove deletions are undone as well as additions.
    process.env[SENTINEL_PREEXISTING] = "baseline";
    pristineFetch = globalThis.fetch;
    pristineEnvObject = process.env;
  });

  beforeEach(() => {
    processState = snapshotProcessState();
  });

  afterEach(() => {
    // Deliberately the ONLY cleanup. Nothing is restored inside a test body,
    // so if this hook stops working the next test observes it.
    restoreProcessState(processState);
    vi.restoreAllMocks();
  });

  it("1 of 2 — contaminates env, global fetch and console, and never cleans up", () => {
    process.env[SENTINEL_ADDED] = "leaked";
    delete process.env[SENTINEL_PREEXISTING];
    globalThis.fetch = (async () =>
      new Response("contaminated", { status: 418 })) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Sanity: the contamination really is in place when this test ends.
    expect(process.env[SENTINEL_ADDED]).toBe("leaked");
    expect(process.env[SENTINEL_PREEXISTING]).toBeUndefined();
    expect(globalThis.fetch).not.toBe(pristineFetch);
    expect(vi.isMockFunction(console.error)).toBe(true);
  });

  it("2 of 2 — observes none of it", () => {
    // Added keys are gone.
    expect(process.env[SENTINEL_ADDED]).toBeUndefined();
    // Deleted keys are back.
    expect(process.env[SENTINEL_PREEXISTING]).toBe("baseline");
    // The fetch double is gone, and `fetch` is the binding the worker started
    // with rather than some later test's idea of "original".
    expect(globalThis.fetch).toBe(pristineFetch);
    // The console spy did not survive its own test.
    expect(vi.isMockFunction(console.error)).toBe(false);
    // And `process.env` is still Node's own object, not a plain replacement.
    expect(process.env).toBe(pristineEnvObject);
  });
});

// ---------------------------------------------------------------------------
// 2. The three channels cannot be reopened
// ---------------------------------------------------------------------------

describe("process.env is never reassigned by a test", () => {
  it("no test file assigns a new object to process.env", () => {
    const offenders = testFiles().filter((file) =>
      /(^|[^.\w])process\.env\s*=[^=]/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("restoreProcessState refuses to pretend a reassignment can be undone", () => {
    const snapshot = snapshotProcessState();
    const fake = { ...process.env } as NodeJS.ProcessEnv;
    const impostor = { ...snapshot, envObject: fake } as ProcessStateSnapshot;
    expect(() => restoreProcessState(impostor)).toThrow(/process\.env was reassigned/);
  });
});

describe("a fetch double is always restored centrally", () => {
  it("every test file that replaces global fetch restores it via the shared helper", () => {
    const offenders = testFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      const replacesFetch = /\b(globalThis|global)\.fetch\s*=[^=]/.test(source);
      return replacesFetch && !source.includes("support/process-state");
    });
    expect(offenders).toEqual([]);
  });
});

describe("mock cleanup is enforced by configuration, not by test bodies", () => {
  const config = readFileSync(join(repoRoot, "vitest.config.ts"), "utf8");

  it.each(["restoreMocks: true", "unstubEnvs: true", "unstubGlobals: true", "isolate: true"])(
    "vitest.config.ts keeps %s",
    (setting) => {
      expect(config).toContain(setting);
    }
  );
});
