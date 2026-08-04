import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const CANONICAL_PREFLIGHT = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_PREFLIGHT.sql";
const CANONICAL_VERIFIER = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_POST_APPLY_VERIFY.sql";
const PACKET_PREFLIGHT = "docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_PREFLIGHT_EXEC.sql";
const PACKET_VERIFIER = "docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_POST_APPLY_VERIFY_EXEC.sql";

const STAGING = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION = "qkkroesfiazsejkzflcd";

const ATTESTATION = `SET LOCAL vam059.attested_project_ref = '${STAGING}';`;
const LOCK_LINE = "SET LOCAL lock_timeout = '3s';";

/**
 * The exact text inserted into the canonical executable region. Stated here in
 * full because it is the security-critical difference between the reviewed
 * artifact and the packet the owner actually runs.
 */
const ATTEST_BLOCK = [
  "",
  "-- Owner attestation of the connected project. Transaction-local, and rolled",
  "-- back with everything else. It is present as committed bytes so this packet",
  "-- runs exactly as reviewed; the canonical artifact deliberately carries no",
  "-- attestation, so running that file can never silently claim an identity.",
  "-- This attestation is only meaningful because the owner performed the visual",
  "-- dashboard check described at the top of this packet immediately before",
  "-- running it. The forbidden production ref qkkroesfiazsejkzflcd is still",
  "-- rejected outright by the identity truth table below.",
  ATTESTATION,
].join("\n");

/** SHA-256 over the committed LF bytes. Reproduce with: git show HEAD:<path> | sha256sum */
const EXPECTED_SHA: Record<string, string> = {
  [PACKET_PREFLIGHT]: "eb6e90dde26d86e6ac9bd7ffaf7a6af6cc7eb918f37c951aab3e0f882451731d",
  [PACKET_VERIFIER]: "1dbec09eedd5d31e3d674ed72787462a943f09e90cd01622c368ca43707c0878",
};

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const read = (p: string) => lf(readFileSync(p, "utf8"));
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Everything from the single BEGIN; to end of file. */
const execRegion = (sql: string) => {
  const at = sql.indexOf("\nBEGIN;\n");
  expect(at).toBeGreaterThan(-1);
  return sql.slice(at + 1);
};

/** Everything before the single BEGIN; — the packet's prose header. */
const headerRegion = (sql: string) => {
  const at = sql.indexOf("\nBEGIN;\n");
  expect(at).toBeGreaterThan(-1);
  return sql.slice(0, at + 1);
};

/**
 * Header prose with the -- markers and comment line wrapping removed, so
 * phrase assertions are not defeated by where a sentence happens to wrap.
 */
const headerProse = (sql: string) =>
  headerRegion(sql)
    .split("\n")
    .map((l) => l.replace(/^--\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Comment- and literal-free code, for counting executable occurrences. */
function strippedCode(sql: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { out += ch; if (ch === "'") { if (sql[i + 1] === "'") { out += sql[++i]; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}

/**
 * The canonical body plus exactly two mechanical changes:
 *   1. the attestation block, immediately after the lock_timeout setting;
 *   2. attestation_set_by_this_file flipped false -> true, so the emitted JSON
 *      truthfully records that identity came from this packet's own bytes.
 */
function buildExpectedBody(canonical: string): string {
  const exec = execRegion(canonical);
  return exec
    .replace(LOCK_LINE, LOCK_LINE + ATTEST_BLOCK)
    .replace("'attestation_set_by_this_file', false", "'attestation_set_by_this_file', true");
}

/** Split into top-level statements, honouring -- comments, literals and $tags$. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      cur += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { cur += "''"; i += 2; continue; }
          cur += "'"; i++; break;
        }
        cur += sql[i]; i++;
      }
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") { out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => s.length > 0);
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const PACKETS: Array<[string, string, string, string]> = [
  ["preflight", PACKET_PREFLIGHT, CANONICAL_PREFLIGHT, "eligible"],
  ["verifier", PACKET_VERIFIER, CANONICAL_VERIFIER, "verified"],
];

// ---------------------------------------------------------------------------

describe.each(PACKETS)("%s execution packet — transaction structure", (_k, packet) => {
  const stmts = () => statements(read(packet)).map(flat);

  it("contains exactly one BEGIN, and it is the first statement", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "BEGIN")).toHaveLength(1);
    expect(s[0].toUpperCase()).toBe("BEGIN");
  });

  it("contains exactly one SET TRANSACTION READ ONLY, immediately after BEGIN", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "SET TRANSACTION READ ONLY")).toHaveLength(1);
    expect(s[1].toUpperCase()).toBe("SET TRANSACTION READ ONLY");
  });

  it("retains the safe statement_timeout and lock_timeout", () => {
    const s = stmts();
    expect(s).toContain("SET LOCAL statement_timeout = '45s'");
    expect(s).toContain(LOCK_LINE.replace(/;$/, ""));
  });

  it("contains exactly one attestation statement", () => {
    const s = stmts();
    const attest = s.filter((x) => /^SET LOCAL vam059\.attested_project_ref/i.test(x));
    expect(attest).toHaveLength(1);
    expect(attest[0]).toBe(ATTESTATION.replace(/;$/, ""));
    // exactly one occurrence in executable code; documentation comments that
    // quote the statement do not count
    expect(strippedCode(read(packet)).split("vam059.attested_project_ref =").length - 1).toBe(1);
  });

  it("places the attestation after BEGIN and before the verification query", () => {
    const s = stmts();
    const iBegin = s.findIndex((x) => x.toUpperCase() === "BEGIN");
    const iAttest = s.findIndex((x) => /^SET LOCAL vam059\.attested_project_ref/i.test(x));
    const iQuery = s.findIndex((x) => /^with\b/i.test(x));
    const iRollback = s.findIndex((x) => x.toUpperCase() === "ROLLBACK");
    expect(iBegin).toBe(0);
    expect(iAttest).toBeGreaterThan(iBegin);
    expect(iQuery).toBeGreaterThan(iAttest);
    expect(iRollback).toBeGreaterThan(iQuery);
  });

  it("contains exactly one ROLLBACK, and it is the last statement", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "ROLLBACK")).toHaveLength(1);
    expect(s[s.length - 1].toUpperCase()).toBe("ROLLBACK");
  });

  it("contains zero COMMIT", () => {
    expect(stmts().filter((x) => x.toUpperCase() === "COMMIT")).toHaveLength(0);
  });

  it("opens no nested transaction and no savepoint", () => {
    const s = stmts();
    expect(s.filter((x) => /^BEGIN\b/i.test(x))).toHaveLength(1);
    expect(s.filter((x) => /^(START TRANSACTION|SAVEPOINT|RELEASE|ROLLBACK TO)\b/i.test(x))).toHaveLength(0);
  });

  it("runs exactly one verification query and emits one JSONB column", () => {
    const s = stmts();
    expect(s.filter((x) => /^with\b/i.test(x))).toHaveLength(1);
    // BEGIN, SET TRANSACTION, statement_timeout, lock_timeout, attestation,
    // the verification query, ROLLBACK — and nothing else
    expect(s).toHaveLength(7);
  });

  it("performs no DDL and no DML", () => {
    // strip comments and literals, then scan
    let code = "";
    let inStr = false;
    let inCmt = false;
    const sql = read(packet);
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (inCmt) { if (ch === "\n") { inCmt = false; code += ch; } continue; }
      if (inStr) { if (ch === "'") { if (sql[i + 1] === "'") i++; else inStr = false; } continue; }
      if (ch === "'") { inStr = true; continue; }
      if (ch === "-" && sql[i + 1] === "-") { inCmt = true; i++; continue; }
      code += ch;
    }
    expect(code).not.toMatch(/\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|savepoint|vacuum|copy)\b/i);
  });
});

describe.each(PACKETS)("%s execution packet — body is bound to the canonical artifact", (_k, packet, canonical) => {
  it("reproduces the canonical executable region byte for byte, plus the two declared changes", () => {
    expect(execRegion(read(packet))).toBe(buildExpectedBody(read(canonical)));
  });

  it("differs from the canonical body only by the attestation and the honesty flag", () => {
    const canonicalExec = execRegion(read(canonical));
    const packetExec = execRegion(read(packet));
    const undone = packetExec
      .replace(ATTEST_BLOCK, "")
      .replace("'attestation_set_by_this_file', true", "'attestation_set_by_this_file', false");
    expect(undone).toBe(canonicalExec);
  });

  it("keeps the canonical artifact free of any executable attestation", () => {
    const canonicalExec = execRegion(read(canonical));
    // the canonical body READS the GUC via current_setting, but never SETs it;
    // any quoted example lives in comments only
    expect(statements(canonicalExec).map(flat).filter((x) => /^SET\b[^;]*vam059\.attested_project_ref/i.test(x)))
      .toHaveLength(0);
    expect(strippedCode(canonicalExec)).not.toMatch(/vam059\.attested_project_ref\s*=/);
    expect(strippedCode(canonicalExec)).toContain("current_setting('vam059.attested_project_ref', true)");
  });

  it("reports attestation_set_by_this_file as true, unlike the canonical artifact", () => {
    expect(read(packet)).toContain("'attestation_set_by_this_file', true");
    expect(read(packet)).not.toContain("'attestation_set_by_this_file', false");
    expect(read(canonical)).toContain("'attestation_set_by_this_file', false");
  });
});

describe.each(PACKETS)("%s execution packet — identity still fails closed", (_k, packet, _canonical, outcome) => {
  const p = () => read(packet);

  it("carries the complete sixteen-row identity truth table", () => {
    const s = p();
    const start = s.indexOf("identity_class(platform, attested, verdict) as (values");
    expect(start).toBeGreaterThan(-1);
    const region = s.slice(start, s.indexOf(")),", start) + 1);
    const rows = Array.from(region.matchAll(/\('([a-z_]+)','([a-z_]+)','(PASS|FAIL)'\)/g));
    expect(rows).toHaveLength(16);
    expect(rows.filter((r) => r[3] === "PASS")).toHaveLength(3);
  });

  it("still rejects the forbidden production ref outright", () => {
    const s = p();
    expect(s).toContain(`('${STAGING}', '${PRODUCTION}')`);
    expect(s).toContain("'env:project_ref_is_not_forbidden_production'");
    // every truth-table row mentioning production is a FAIL
    const start = s.indexOf("identity_class(platform, attested, verdict) as (values");
    const region = s.slice(start, s.indexOf(")),", start) + 1);
    for (const m of Array.from(region.matchAll(/\('([a-z_]+)','([a-z_]+)','(PASS|FAIL)'\)/g))) {
      if (m[1] === "forbidden_production" || m[2] === "forbidden_production") expect(m[3]).toBe("FAIL");
    }
  });

  it("never attests the production ref", () => {
    expect(p()).not.toContain(`vam059.attested_project_ref = '${PRODUCTION}'`);
  });

  it("keeps the fail-closed verdict default and the overall conjunction", () => {
    const s = p();
    expect(s).toContain("coalesce((select verdict from identity_verdict), 'FAIL')");
    expect(s).toContain(`'${outcome}', bool_and(status = 'PASS')`);
    expect(s).toContain("'failureCount', count(*) filter (where status <> 'PASS')");
    expect(s).toContain("'failed_assertions', coalesce(jsonb_agg(assertion order by assertion) filter (where status <> 'PASS'), '[]'::jsonb)");
  });

  it("keeps structural topology a secondary guard only", () => {
    // preflight carries the topology assertion; both derive the outcome from a
    // conjunction over every assertion, so topology can never stand alone
    expect(p()).toContain(`'${outcome}', bool_and(status = 'PASS')`);
  });
});

describe.each(PACKETS)("%s execution packet — self-contained, no owner editing", (_k, packet) => {
  const prose = () => headerProse(read(packet));

  it("gives no instruction to edit, insert into or otherwise alter the packet", () => {
    const h = prose();
    for (const forbidden of [
      /insert\s+(the|this|exactly|one|an?\b)/i,
      /\bedit\b/i,
      /hand-edit/i,
      /\bmodify\b/i,
      /\bmanually\b/i,
      /by hand/i,
      /replace\s+(the|this)/i,
      /uncomment/i,
      /fill in/i,
      /type\s+(the|this|in)\b/i,
      /add\s+(the|this|one)\b/i,
      /append\s+(the|this)/i,
    ]) {
      expect(h).not.toMatch(forbidden);
    }
  });

  it("states that it runs exactly as committed", () => {
    expect(prose()).toMatch(/run it exactly as committed/i);
    expect(prose()).toMatch(/COMPLETE AND SELF-CONTAINED/);
    expect(prose()).toMatch(/no manual step/i);
    expect(prose()).toMatch(/no additional statement/i);
  });

  it("requires no psql include, external file or reused session", () => {
    const h = prose();
    expect(h).toMatch(/no psql \\i include/i);
    expect(h).toMatch(/no external file/i);
    expect(h).toMatch(/no previously prepared session/i);
    // and no include directive anywhere in the packet
    expect(read(packet)).not.toMatch(/^\s*\\i\b/m);
    expect(read(packet)).not.toMatch(/^\s*\\ir\b/m);
    expect(read(packet)).not.toMatch(/\bpg_read_file\b/);
  });

  it("requires the visual dashboard confirmation before execution", () => {
    const h = prose();
    expect(h).toMatch(/ONE HUMAN CONTROL, IMMEDIATELY BEFORE YOU RUN THIS/);
    expect(h).toContain(STAGING);
    expect(h).toContain(PRODUCTION);
    expect(h).toMatch(/stop and close this file/i);
    expect(h).toMatch(/confirm the project ref reads exactly/i);
  });

  it("documents the four conditions that make the committed attestation acceptable", () => {
    const h = prose();
    expect(h).toMatch(/visual dashboard check above immediately before execution/i);
    expect(h).toMatch(/SHA-256 are reviewed independently/i);
    expect(h).toMatch(/rejected outright by the identity truth table/i);
    expect(h).toMatch(/topology remains a secondary guard/i);
  });

  it("names the canonical artifact it derives from", () => {
    expect(prose()).toMatch(/docs\/audits\/sql\/design_only\/VAM_OS_MIGRATION_059_[A-Z_]+\.sql/);
  });

  it("carries no credential or connection string", () => {
    const s = read(packet);
    expect(s).not.toMatch(/postgres(ql)?:\/\//i);
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/password\s*[:=]/i);
    expect(s).not.toMatch(/(api[_-]?key|SERVICE_ROLE_KEY|ANON_KEY)/i);
  });
});

describe("execution packets — reported SHA-256 binding", () => {
  it.each(Object.keys(EXPECTED_SHA))("%s matches its reported SHA-256 over the committed bytes", (p) => {
    expect(sha256(read(p))).toBe(EXPECTED_SHA[p]);
  });

  it("gives the two packets distinct hashes", () => {
    expect(EXPECTED_SHA[PACKET_PREFLIGHT]).not.toBe(EXPECTED_SHA[PACKET_VERIFIER]);
  });

  it("hashes the complete file, header included", () => {
    for (const p of Object.keys(EXPECTED_SHA)) {
      const full = read(p);
      expect(sha256(full)).toBe(EXPECTED_SHA[p]);
      expect(sha256(execRegion(full))).not.toBe(EXPECTED_SHA[p]);
      expect(full.length).toBeGreaterThan(execRegion(full).length);
    }
  });
});

describe("execution packets — stay read-only", () => {
  it("adds no SQL that could write to the database", () => {
    for (const p of Object.keys(EXPECTED_SHA)) {
      expect(read(p)).toContain("SET TRANSACTION READ ONLY;");
      expect(read(p)).toMatch(/\nROLLBACK;\n?$/);
    }
  });
});
