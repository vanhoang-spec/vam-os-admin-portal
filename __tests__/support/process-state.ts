/**
 * Process-state isolation for the VAM OS test harness.
 *
 * Two rules this module exists to make mechanical, because both were violated
 * by hand-rolled `beforeEach`/`afterEach` pairs and produced order-dependent
 * failures that only reproduced in some worker orderings:
 *
 *  1. NEVER reassign `process.env`.
 *     `process.env` is an exotic object backed by the real environment block.
 *     It coerces every assigned value to a string, and on Windows it is
 *     case-insensitive. `process.env = { ...snapshot }` swaps it for an
 *     ordinary object for the remaining life of that worker, so every test
 *     that runs afterwards — in this file or any file sharing the worker —
 *     gets different env semantics than the first test got. Restore by
 *     mutating the same object instead, which is what `restoreProcessState`
 *     does.
 *
 *  2. NEVER leave `globalThis.fetch` replaced.
 *     A suite that installs a fetch double and throws before restoring it
 *     hands its double to whatever runs next. Snapshot/restore has to happen
 *     in `afterEach`, not at the end of a test body, so a failing expectation
 *     cannot skip it.
 *
 * Usage:
 *
 *   let state: ProcessStateSnapshot;
 *   beforeEach(() => { state = snapshotProcessState(); });
 *   afterEach(() => { restoreProcessState(state); });
 */

export interface ProcessStateSnapshot {
  /** Every defined env var at snapshot time, by canonical key. */
  readonly env: ReadonlyMap<string, string>;
  /** The `globalThis.fetch` binding at snapshot time. */
  readonly fetch: typeof globalThis.fetch;
  /**
   * Identity of the `process.env` object itself. Restoring asserts this is
   * unchanged, which is what catches a wholesale `process.env = {...}`.
   */
  readonly envObject: NodeJS.ProcessEnv;
}

export function snapshotProcessState(): ProcessStateSnapshot {
  const env = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env.set(key, value);
  }
  return { env, fetch: globalThis.fetch, envObject: process.env };
}

/**
 * Returns `process.env` to the snapshot exactly, in place.
 *
 * Throws if `process.env` was reassigned in the meantime. That is deliberate:
 * a swapped-out env object cannot be restored — the real one is already gone —
 * so the only useful behaviour is to fail the test that did it rather than let
 * it silently degrade every test that follows.
 */
export function restoreProcessState(snapshot: ProcessStateSnapshot): void {
  if (process.env !== snapshot.envObject) {
    throw new Error(
      "process.env was reassigned during this test. Mutate keys in place " +
        "(process.env.FOO = ... / delete process.env.FOO) instead of assigning " +
        "a new object to process.env; see __tests__/support/process-state.ts."
    );
  }

  for (const key of Object.keys(process.env)) {
    if (!snapshot.env.has(key)) delete process.env[key];
  }
  snapshot.env.forEach((value, key) => {
    if (process.env[key] !== value) process.env[key] = value;
  });

  globalThis.fetch = snapshot.fetch;
}
