/**
 * The disposable PostgreSQL harness must not leave its cluster behind.
 *
 * Running the harness itself here would add a minute to every Vitest run and
 * needs local PostgreSQL binaries, so these assertions pin the cleanup CONTRACT
 * in the harness source. The behaviour is proven by running
 * `node scripts/pg-harness/run.mjs` twice, which reports TEMP_DIR_CREATED,
 * POSTGRES_STOPPED and TEMP_DIR_REMOVED for each run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CARRIAGE_RETURN = String.fromCharCode(13);
const SOURCE = readFileSync(join(process.cwd(), "scripts/pg-harness/run.mjs"), "utf8")
  .split(CARRIAGE_RETURN)
  .join("");

function cleanupBody(): string {
  const start = SOURCE.indexOf("async function cleanup()");
  // Ends where main() resumes. `cleanup` contains try blocks of its own, so the
  // next `try {` is not the boundary.
  const end = SOURCE.indexOf("Creating disposable cluster", start);
  if (start < 0 || end < 0) throw new Error("cleanup function not found");
  return SOURCE.slice(start, end);
}

describe("harness cleanup lifecycle", () => {
  const body = cleanupBody();

  it("stops the server rather than only killing the handle", () => {
    expect(body).toContain('"-m", "fast", "stop"');
    expect(body).toContain('server.kill("SIGKILL")');
  });

  it("awaits actual process termination before removing anything", () => {
    expect(body).toContain("await Promise.race([");
    expect(body).toContain("serverExited");
    const wait = body.indexOf("serverExited");
    const remove = body.indexOf("rmSync(dataDir");
    expect(wait).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(wait);
  });

  it("releases the child-process handles it holds", () => {
    expect(body).toContain("removeAllListeners");
    expect(body).toContain("unref");
  });

  it("retries removal while Windows releases file handles", () => {
    expect(body).toMatch(/for \(let attempt = 0; attempt < \d+; attempt \+= 1\)/);
    expect(body).toContain("setTimeout(resolve, 250)");
  });

  it("verifies the directory is gone and reports the three facts", () => {
    expect(body).toContain("removed = !existsSync(dataDir)");
    expect(body).toContain("TEMP_DIR_CREATED=");
    expect(body).toContain("POSTGRES_STOPPED=");
    expect(body).toContain("TEMP_DIR_REMOVED=");
  });

  it("removes ONLY this run's directory, never a glob over the parent", () => {
    // `dataDir` comes from mkdtempSync, so it is unique to this run.
    expect(body).toContain("rmSync(dataDir, { recursive: true, force: true })");
    expect(SOURCE).not.toContain("vam-pg-*");
    expect(SOURCE).not.toContain("readdirSync(dataRoot");
    // Nothing enumerates or deletes siblings.
    expect(SOURCE).not.toMatch(/rmSync\(\s*dataRoot/);
  });

  it("runs in a finally block, so it also happens after a thrown exception", () => {
    expect(SOURCE).toContain("} finally {");
    const finallyIndex = SOURCE.indexOf("} finally {");
    expect(SOURCE.slice(finallyIndex, finallyIndex + 200)).toContain("await cleanup()");
  });

  it("fails the run when cleanup could not finish", () => {
    expect(SOURCE).toContain("if (!removed) {");
    expect(SOURCE).toContain("cleanup failed:");
    const failIndex = SOURCE.indexOf("if (!removed) {");
    expect(SOURCE.slice(failIndex, failIndex + 300)).toContain("process.exit(1)");
  });

  it("never names a persistent database", () => {
    // The connection is constructed from the harness's own port; no env var
    // pointing at Production or Staging is read.
    expect(SOURCE).not.toContain("SUPABASE");
    expect(SOURCE).not.toContain("DATABASE_URL");
    expect(SOURCE).toContain('host: "127.0.0.1"');
  });
});
