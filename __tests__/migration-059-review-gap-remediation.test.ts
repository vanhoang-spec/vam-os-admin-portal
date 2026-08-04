import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateEndpoint,
  redact,
  EXPECTED_HOST,
  FORBIDDEN_HOST,
  ACCEPTED_ENDPOINTS,
} from "../scripts/application-bootstrap-postgrest-probe.mjs";

const PREFLIGHT = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_PREFLIGHT.sql";
const VERIFIER = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_POST_APPLY_VERIFY.sql";
const PROBE_SCRIPT = "scripts/application-bootstrap-postgrest-probe.mjs";

const STAGING = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION = "qkkroesfiazsejkzflcd";

const read = (p: string) => readFileSync(p, "utf8");

/** Strip -- comments but KEEP literals. */
function withoutComments(sql: string): string {
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

// ===========================================================================
// CRITICAL — project identity must fail closed
// ===========================================================================

type Cls = "absent" | "expected_staging" | "forbidden_production" | "other";
const CLASSES: Cls[] = ["absent", "expected_staging", "forbidden_production", "other"];

/**
 * Read the exhaustive identity verdict table out of the committed SQL. The
 * decision is data, so the tests below exercise the real committed decision
 * rather than a restatement of it.
 */
function identityTable(sql: string): Map<string, "PASS" | "FAIL"> {
  const w = withoutComments(sql);
  const start = w.indexOf("identity_class(platform, attested, verdict) as (values");
  expect(start).toBeGreaterThan(-1);
  // +1 so the region keeps the final tuple's own closing parenthesis
  const end = w.indexOf(")),", start) + 1;
  expect(end).toBeGreaterThan(start);
  const region = w.slice(start, end);
  const out = new Map<string, "PASS" | "FAIL">();
  for (const m of Array.from(region.matchAll(/\('([a-z_]+)','([a-z_]+)','(PASS|FAIL)'\)/g))) {
    out.set(`${m[1]}|${m[2]}`, m[3] as "PASS" | "FAIL");
  }
  return out;
}

/**
 * Mirrors the SQL classifier. A drift guard below asserts the committed SQL
 * still implements exactly these four branches for both sources.
 */
const classify = (v: string | null | undefined): Cls => {
  if (v === null || v === undefined) return "absent";
  const t = v.trim();
  if (t === "") return "absent";
  if (t === STAGING) return "expected_staging";
  if (t === PRODUCTION) return "forbidden_production";
  return "other";
};

const verdictFor = (
  table: Map<string, "PASS" | "FAIL">,
  platform: string | null | undefined,
  attested: string | null | undefined
) => table.get(`${classify(platform)}|${classify(attested)}`) ?? "FAIL";

describe.each([
  ["preflight", PREFLIGHT],
  ["verifier", VERIFIER],
])("%s — project identity verdict table", (_label, file) => {
  const table = identityTable(read(file));

  it("is exhaustive over all sixteen source-class combinations", () => {
    expect(table.size).toBe(16);
    for (const p of CLASSES) for (const a of CLASSES) expect(table.has(`${p}|${a}`)).toBe(true);
  });

  it("returns PASS for exactly three combinations, all requiring the expected ref", () => {
    const passing = Array.from(table.entries())
      .filter(([, v]) => v === "PASS")
      .map(([k]) => k)
      .sort();
    expect(passing).toEqual([
      "absent|expected_staging",
      "expected_staging|absent",
      "expected_staging|expected_staging",
    ]);
  });

  it("classifies both sources with the same four branches the tests mirror", () => {
    const w = withoutComments(read(file));
    for (const src of ["p.v", "a.v"]) {
      expect(w).toContain(`when ${src} is null then 'absent'`);
      expect(w).toContain(`when ${src} = r.staging then 'expected_staging'`);
      expect(w).toContain(`when ${src} = r.production then 'forbidden_production'`);
    }
    expect(w).toContain("else 'other' end");
    // empty / whitespace-only collapses to NULL, so it classifies as absent
    expect(w).toContain("nullif(btrim(coalesce(current_setting('app.settings.project_ref', true), '')), '')");
    expect(w).toContain("nullif(btrim(coalesce(current_setting('vam059.attested_project_ref', true), '')), '')");
  });
});

describe.each([
  ["preflight", PREFLIGHT],
  ["verifier", VERIFIER],
])("%s — identity behaviour, fail closed", (_label, file) => {
  const table = identityTable(read(file));
  const v = (p: string | null | undefined, a: string | null | undefined) => verdictFor(table, p, a);

  it("FAILs when neither source is present (NULL ref)", () => {
    expect(v(null, null)).toBe("FAIL");
    expect(v(undefined, undefined)).toBe("FAIL");
  });

  it("FAILs when a source is present but empty or whitespace-only", () => {
    expect(v("", "")).toBe("FAIL");
    expect(v("   ", null)).toBe("FAIL");
    expect(v(null, "  \t ")).toBe("FAIL");
  });

  it("FAILs on the forbidden production ref from either source", () => {
    expect(v(PRODUCTION, null)).toBe("FAIL");
    expect(v(null, PRODUCTION)).toBe("FAIL");
    expect(v(PRODUCTION, PRODUCTION)).toBe("FAIL");
    expect(v(STAGING, PRODUCTION)).toBe("FAIL");
    expect(v(PRODUCTION, STAGING)).toBe("FAIL");
  });

  it("FAILs on any unrelated ref", () => {
    for (const other of ["abcdefghijklmnopqrst", "ljfneyuvpxrmejpxsmp", "ljfneyuvpxrmejpxsmpzz", "staging"]) {
      expect(v(other, null)).toBe("FAIL");
      expect(v(null, other)).toBe("FAIL");
      expect(v(STAGING, other)).toBe("FAIL");
    }
  });

  it("PASSes only for the exact expected ref", () => {
    expect(v(STAGING, null)).toBe("PASS");
    expect(v(null, STAGING)).toBe("PASS");
    expect(v(STAGING, STAGING)).toBe("PASS");
  });

  it("FAILs when the attestation route is used but the attestation is missing", () => {
    // platform setting unavailable (Supabase SQL editor) and no SET LOCAL
    expect(v(null, null)).toBe("FAIL");
    expect(v(null, "")).toBe("FAIL");
  });

  it("never lets a hard-coded expected constant stand in for a supplied value", () => {
    // absent|absent is the state of a file run with no owner input at all
    expect(table.get("absent|absent")).toBe("FAIL");
  });
});

describe.each([
  ["preflight", PREFLIGHT, "eligible"],
  ["verifier", VERIFIER, "verified"],
])("%s — identity gates the overall outcome", (_label, file, outcomeField) => {
  const w = () => withoutComments(read(file));

  it("looks the verdict up with a fail-closed default", () => {
    expect(w()).toContain("coalesce((select verdict from identity_verdict), 'FAIL')");
  });

  it("scores identity inside the same conjunction as every other assertion", () => {
    const s = w();
    expect(s).toContain("'env:project_ref_is_expected_staging'");
    expect(s).toContain(`'${outcomeField}', bool_and(status = 'PASS')`);
    expect(s).toContain("'overall_status', case when bool_and(status = 'PASS') then 'PASS' else 'FAIL' end");
  });

  it("asserts presence, forbidden-ref rejection and source agreement separately", () => {
    const s = w();
    expect(s).toContain("'env:project_identity_present'");
    expect(s).toContain("'env:project_ref_is_not_forbidden_production'");
    expect(s).toContain("'env:project_identity_sources_agree'");
  });

  it("reports project identity explicitly in the structured output", () => {
    const s = w();
    expect(s).toContain("'project_identity', jsonb_build_object");
    expect(s).toContain("'platform_class'");
    expect(s).toContain("'attested_class'");
    expect(s).toContain("'attestation_setting', 'vam059.attested_project_ref'");
    expect(s).toContain("'attestation_set_by_this_file', false");
    expect(s).toContain("'owner_must_verify_project_ref', true");
  });

  it("never sets or fabricates the attestation itself", () => {
    // the instruction appears only in comments; no executable SET exists
    expect(w()).not.toMatch(/\bset\s+(local\s+)?vam059\.attested_project_ref/i);
    expect(read(file)).toMatch(/SET LOCAL vam059\.attested_project_ref = 'ljfneyuvpxrmejpxsmpz';/);
  });

  it("never echoes a supplied ref value back into the output", () => {
    // only classes are emitted, never platform_ref.v / attested_ref.v
    const s = w();
    const outStart = s.lastIndexOf("select jsonb_build_object(");
    const out = s.slice(outStart);
    expect(out).not.toContain("from platform_ref");
    expect(out).not.toContain("from attested_ref");
  });
});

describe("preflight — structural topology stays a secondary guard", () => {
  const w = () => withoutComments(read(PREFLIGHT));

  it("keeps topology as one more ANDed assertion, never a substitute for identity", () => {
    const s = w();
    expect(s).toContain("'env:not_production_topology'");
    // eligibility is a conjunction, so a passing topology cannot rescue a
    // failed identity assertion
    expect(s).toContain("'eligible', bool_and(status = 'PASS')");
  });

  it("does not treat object absence, database name or current_user as identity", () => {
    const s = w();
    const idRegion = s.slice(s.indexOf("identity as ("), s.indexOf("identity_verdict as ("));
    expect(idRegion).not.toMatch(/current_database\(\)/);
    expect(idRegion).not.toMatch(/current_user/);
    expect(idRegion).not.toMatch(/to_regclass/);
  });

  it("documents the owner's visual confirmation of the project URL as step 1", () => {
    const raw = read(PREFLIGHT);
    expect(raw).toMatch(/VISUALLY CONFIRM the project ref in/);
    expect(raw).toMatch(/EXECUTION INSTRUCTIONS/);
  });
});

// ===========================================================================
// HIGH — complete USING-expression verification
// ===========================================================================
// SUPERSEDED. The three is_admin_role-based read policies this section used
// to compare are no longer created: the application workflow is server-only,
// so all five tables carry ZERO policies. The remediation the section proved
// is now enforced by a strictly stronger rule — no policy may exist at all —
// asserted in __tests__/migration-059-final-prerequisites.test.ts. What
// remains here is the proof that the old apparatus and its subject are gone.

describe("verifier — the policy-expression apparatus is retired, not weakened", () => {
  const v = () => read(VERIFIER);

  it("no longer stores expected policy expressions", () => {
    const w = withoutComments(v());
    expect(w).not.toContain("expected_policy_qual");
    expect(w).not.toContain("norm_actual");
    expect(w).not.toContain("norm_expected");
    expect(w).not.toContain("security:policy_qual_exact");
  });

  it("no longer expects is_admin_role or the three retired policies", () => {
    const w = withoutComments(v());
    // no expected policy expression survives
    expect(w).not.toContain("is_admin_role(ARRAY[");
    for (const p of ["application_reviews_read", "application_decisions_read",
                     "review_assignment_batches_read"]) {
      expect(w).not.toContain(p);
    }
    // the only remaining mention is the negative guard that forbids it
    const mentions = w.split("\n").filter((l) => l.includes("is_admin_role"));
    expect(mentions.length).toBeGreaterThan(0);
    for (const l of mentions) {
      expect(l).toMatch(/no_is_admin_role_dependency|not exists|like '%is_admin_role%'/);
    }
  });

  it("replaces expression comparison with an absolute zero-policy rule", () => {
    const w = withoutComments(v());
    expect(w).toContain("'security:zero_policies'");
    expect(w).toContain("'security:zero_policies:' || t");
    expect(w).toContain("'security:no_is_admin_role_dependency'");
  });

  it("keeps every migration 062 / 063 compatibility assertion", () => {
    const w = withoutComments(v());
    for (const a of [
      "'compat:m062_functions_present'",
      "'compat:m062_policies_present'",
      "'compat:m062_membership_rls_enabled'",
      "'compat:m062_scope_arbiter_intact'",
      "'compat:m062_affected_tables_hardened'",
      "'compat:m063_functions_present'",
      "'compat:m063_entrypoint_grants_intact'",
    ]) {
      expect(w).toContain(a);
    }
  });
});

// ===========================================================================
// HIGH — strict PostgREST endpoint validation
// ===========================================================================

describe("probe — endpoint allowlist", () => {
  it("exposes the exact expected and forbidden hosts", () => {
    expect(EXPECTED_HOST).toBe("ljfneyuvpxrmejpxsmpz.supabase.co");
    expect(FORBIDDEN_HOST).toBe("qkkroesfiazsejkzflcd.supabase.co");
    expect(Array.from(ACCEPTED_ENDPOINTS)).toEqual([
      "https://ljfneyuvpxrmejpxsmpz.supabase.co",
      "https://ljfneyuvpxrmejpxsmpz.supabase.co/",
    ]);
  });

  it.each(ACCEPTED_ENDPOINTS.map((e) => [e] as [string]))("accepts %s", (endpoint) => {
    expect(validateEndpoint(endpoint)).toBeNull();
  });

  const rejected: Array<[string, unknown, string?]> = [
    ["staging-ref suffix host", "https://ljfneyuvpxrmejpxsmpzz.supabase.co"],
    ["staging-ref prefix host", "https://xljfneyuvpxrmejpxsmpz.supabase.co"],
    ["attacker parent domain", "https://ljfneyuvpxrmejpxsmpz.supabase.co.attacker.example"],
    ["attacker domain carrying the ref", "https://ljfneyuvpxrmejpxsmpz.attacker.example"],
    ["attacker subdomain of the real host", "https://evil.ljfneyuvpxrmejpxsmpz.supabase.co"],
    ["production host", "https://qkkroesfiazsejkzflcd.supabase.co", "endpoint_is_forbidden_production_host"],
    ["production host with slash", "https://qkkroesfiazsejkzflcd.supabase.co/", "endpoint_is_forbidden_production_host"],
    ["uppercase host spelling", "https://LJFNEYUVPXRMEJPXSMPZ.SUPABASE.CO", "endpoint_not_canonical_literal"],
    ["mixed-case host spelling", "https://LjfNeyuvpxrmejpxsmpz.Supabase.Co/", "endpoint_not_canonical_literal"],
    ["explicit default port", "https://ljfneyuvpxrmejpxsmpz.supabase.co:443", "endpoint_not_canonical_literal"],
    ["trailing-dot hostname", "https://ljfneyuvpxrmejpxsmpz.supabase.co.", "endpoint_host_not_expected_staging"],
    ["unicode homograph host", "https://ljfneyuvpxrmejpxsmpz.supabase.cо", "endpoint_host_not_expected_staging"],
    ["punycode homograph host", "https://ljfneyuvpxrmejpxsmpz.supabase.xn--co-8cd", "endpoint_host_not_expected_staging"],
    ["username@host", "https://ljfneyuvpxrmejpxsmpz.supabase.co@attacker.example", "endpoint_contains_credentials"],
    ["password-bearing URL", "https://user:secret@ljfneyuvpxrmejpxsmpz.supabase.co", "endpoint_contains_credentials"],
    ["alternate port", "https://ljfneyuvpxrmejpxsmpz.supabase.co:8443", "endpoint_non_default_port"],
    ["http protocol", "http://ljfneyuvpxrmejpxsmpz.supabase.co", "endpoint_protocol_not_https"],
    ["path-bearing base URL", "https://ljfneyuvpxrmejpxsmpz.supabase.co/rest/v1", "endpoint_has_path"],
    ["query-bearing base URL", "https://ljfneyuvpxrmejpxsmpz.supabase.co/?apikey=x", "endpoint_has_query"],
    ["fragment-bearing base URL", "https://ljfneyuvpxrmejpxsmpz.supabase.co/#f", "endpoint_has_fragment"],
    ["malformed URL", "not-a-url", "endpoint_unparseable"],
    ["empty string", "", "endpoint_missing"],
    ["null", null, "endpoint_missing"],
    ["undefined", undefined, "endpoint_missing"],
    ["non-string", 42, "endpoint_missing"],
  ];

  it.each(rejected)("rejects %s", (_name, endpoint, code) => {
    const result = validateEndpoint(endpoint);
    expect(result).not.toBeNull();
    if (code) expect(result).toBe(code);
  });

  it("accepts nothing outside the two canonical forms", () => {
    for (const [, endpoint] of rejected) expect(ACCEPTED_ENDPOINTS).not.toContain(endpoint);
  });

  it("validates the parsed hostname rather than the raw string", () => {
    // the raw string starts with the expected host yet resolves elsewhere
    const deceptive = "https://ljfneyuvpxrmejpxsmpz.supabase.co@attacker.example";
    expect(deceptive.startsWith(`https://${EXPECTED_HOST}`)).toBe(true);
    expect(new URL(deceptive).hostname).toBe("attacker.example");
    expect(validateEndpoint(deceptive)).toBe("endpoint_contains_credentials");
  });

  it("never interpolates the supplied value into a validation error", () => {
    const secret = "https://ljfneyuvpxrmejpxsmpz.supabase.co:8443/?apikey=SUPERSECRETVALUE";
    const result = validateEndpoint(secret)!;
    expect(result).not.toContain("SUPERSECRETVALUE");
    expect(result).not.toContain("apikey");
    expect(result).not.toContain("supabase.co");
    expect(result).toMatch(/^endpoint_[a-z_]+$/);
  });
});

describe("probe — redaction still holds", () => {
  it("redacts tokens, keys, uuids, emails and auth headers", () => {
    expect(redact("eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM")).toBe("[redacted-token]");
    expect(redact("sb_secret_abcdefghijkl")).toBe("[redacted-key]");
    expect(redact("id 123e4567-e89b-12d3-a456-426614174000")).toBe("id [redacted-uuid]");
    expect(redact("mail person@example.com")).toBe("mail [redacted-email]");
    expect(redact("Authorization: Bearer abc")).toContain("[redacted]");
  });

  it("passes non-strings through untouched", () => {
    expect(redact(42 as unknown as string)).toBe(42);
    expect(redact(null as unknown as string)).toBeNull();
  });
});

// ===========================================================================
// Cleanup guarantees
// ===========================================================================

describe("probe — cleanup cannot silently leave a synthetic row", () => {
  const script = () => readFileSync(PROBE_SCRIPT, "utf8");

  it("attempts cleanup in a finally path whenever an insert was attempted", () => {
    const s = script();
    expect(s).toContain("} finally {");
    expect(s).toContain("if (insertAttempted) {");
    expect(s.indexOf("insertAttempted = true")).toBeLessThan(s.indexOf("} finally {"));
  });

  it("reports the delete result and an independent confirming read", () => {
    const s = script();
    expect(s).toContain('check(\n        "service_role_delete_cleanup"');
    expect(s).toContain('check("probe_row_removed", cleanupConfirmed');
    expect(s).toContain("cleanupConfirmed = gone.status === 200 && gone.rows === 0");
  });

  it("fails the whole probe when cleanup cannot be confirmed", () => {
    const s = script();
    expect(s).toContain("if (!cleanupConfirmed) {");
    expect(s).toContain("cleanup_unconfirmed");
  });

  it("has no retry loop that could create a duplicate synthetic row", () => {
    const s = script();
    const region = s.slice(s.indexOf("const probeId"), s.indexOf("const allPass"));
    expect(region).not.toMatch(/\b(for|while)\s*\(/);
    expect(region).not.toMatch(/\bretry\b/i);
    // exactly one POST, and exactly one DELETE, in the whole round trip
    expect(region.split('method: "POST"').length - 1).toBe(1);
    expect(region.split('method: "DELETE"').length - 1).toBe(1);
  });

  it("keeps response bodies suppressed", () => {
    const s = script();
    expect(s).toContain("rows = Array.isArray(payload) ? payload.length : null");
    expect(s).not.toMatch(/JSON\.stringify\(\s*payload/);
  });

  it("is side-effect free on import, so these tests never run the probe", () => {
    const s = script();
    expect(s).toContain("import.meta.url === pathToFileURL(invoked).href");
    expect(s).toContain("export async function main(");
  });
});
