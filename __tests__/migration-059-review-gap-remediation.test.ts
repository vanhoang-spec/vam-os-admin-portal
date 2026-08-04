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

type Variant = { t: string; n: string; variant: string; q: string };

function expectedQuals(sql: string): Variant[] {
  const w = withoutComments(sql);
  const start = w.indexOf("expected_policy_qual(t, n, variant, q) as (values");
  expect(start).toBeGreaterThan(-1);
  // +1 so the region keeps the final tuple's own closing parenthesis
  const end = w.indexOf(")),", start) + 1;
  expect(end).toBeGreaterThan(start);
  const region = w.slice(start, end);
  const out: Variant[] = [];
  const re = /\('([a-z_]+)','([a-z_]+)','([a-z_]+)',\s*'((?:[^']|'')*)'\)/g;
  for (const m of Array.from(region.matchAll(re))) {
    out.push({ t: m[1], n: m[2], variant: m[3], q: m[4].replace(/''/g, "'") });
  }
  return out;
}

/**
 * Mirrors the SQL normalisation exactly: unwrap parentheses that sit directly
 * around a bare column reference immediately followed by a cast, then collapse
 * whitespace and trim. Nothing else.
 */
const norm = (s: string) =>
  s
    .replace(/\(([a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?)\)::/g, "$1::")
    .replace(/\s+/g, " ")
    .trim();

const variants = expectedQuals(read(VERIFIER));
const matchesSome = (actual: string, policy: string) =>
  variants.filter((v) => v.n === policy).some((v) => norm(v.q) === norm(actual));

const REVIEWS = "application_reviews_read";
const base = () => variants.find((v) => v.variant === "bare_status_text")!.q;

describe("verifier — complete USING expressions are stored, not fragments", () => {
  it("stores every variant for all three workflow policies", () => {
    expect(variants).toHaveLength(8);
    const byPolicy = new Map<string, number>();
    for (const v of variants) byPolicy.set(v.n, (byPolicy.get(v.n) ?? 0) + 1);
    expect(byPolicy.get(REVIEWS)).toBe(4);
    expect(byPolicy.get("application_decisions_read")).toBe(2);
    expect(byPolicy.get("review_assignment_batches_read")).toBe(2);
  });

  it("stores complete expressions with no wildcard or pattern placeholder", () => {
    for (const v of variants) {
      expect(v.q).toContain("is_admin_role(ARRAY[");
      expect(v.q).not.toContain("%");
      expect(v.q).not.toContain("...");
      expect(v.q).not.toContain("_%");
    }
    // the reviews policy must carry its full ownership predicate and subquery
    expect(base()).toContain("reviewer_admin_user_id = ( SELECT admin_users.id FROM admin_users");
    expect(base()).toContain("admin_users.auth_user_id = auth.uid()");
    expect(base()).toContain("LIMIT 1");
  });

  it("compares with equality after identical normalisation of both sides", () => {
    const w = withoutComments(read(VERIFIER));
    const region = w.slice(w.indexOf("norm_actual as ("), w.indexOf("ueh as ("));
    const castPattern = "'\\(([a-zA-Z_][a-zA-Z0-9_]*(\\.[a-zA-Z_][a-zA-Z0-9_]*)?)\\)::', '\\1::', 'g'";
    // exactly once for the actual side and once for the expected side
    expect(region.split(castPattern).length - 1).toBe(2);
    expect(region.split("'[[:space:]]+', ' ', 'g'").length - 1).toBe(2);
    expect(w).toContain("join norm_expected x on x.t = a.t and x.n = a.n and x.q = a.q");
    expect(w).toContain("'security:policy_qual_exact:' || e.n");
    // never a substring or pattern comparison
    expect(w).not.toMatch(/x\.q\s+like\s+/i);
    expect(w).not.toMatch(/a\.q\s+like\s+/i);
  });

  it("retains the exact structural policy contract alongside the expression check", () => {
    const w = withoutComments(read(VERIFIER));
    expect(w).toContain("p.permissive = 'PERMISSIVE' and p.cmd = e.cmd");
    expect(w).toContain("p.roles = e.roles");
    expect(w).toContain("p.with_check is null");
    expect(w).toContain("'security:policy_inventory'");
    expect(w).toContain("'security:policy:' || e.n");
  });

  it("emits both normalised expressions as evidence", () => {
    const w = withoutComments(read(VERIFIER));
    expect(w).toContain("'policy_qual_actual_normalized'");
    expect(w).toContain("'policy_qual_expected_normalized'");
  });

  it("does not weaken the migration 062 / 063 compatibility assertions", () => {
    const w = withoutComments(read(VERIFIER));
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

describe("verifier — positive fixtures still match", () => {
  it("accepts arbitrary whitespace changes", () => {
    expect(matchesSome(base().replace(/ /g, "    "), REVIEWS)).toBe(true);
    expect(matchesSome(`   ${base()}   `, REVIEWS)).toBe(true);
  });

  it("accepts line breaks, as pg_get_expr renders sub-SELECTs multi-line", () => {
    const broken = base()
      .replace(/ OR /g, "\n  OR\n  ")
      .replace(/ FROM /g, "\n   FROM ")
      .replace(/ WHERE /g, "\n  WHERE ")
      .replace(/ LIMIT /g, "\n LIMIT ");
    expect(matchesSome(broken, REVIEWS)).toBe(true);
  });

  it("accepts a harmless redundant outer parenthesis pair", () => {
    expect(matchesSome(`(${base()})`, REVIEWS)).toBe(true);
    const decisions = variants.find((v) => v.n === "application_decisions_read" && v.variant === "bare")!.q;
    expect(matchesSome(`(${decisions})`, "application_decisions_read")).toBe(true);
    const batches = variants.find((v) => v.n === "review_assignment_batches_read" && v.variant === "bare")!.q;
    expect(matchesSome(`(${batches})`, "review_assignment_batches_read")).toBe(true);
  });

  it("accepts the known equivalent PostgreSQL cast rendering", () => {
    // varchar columns deparse as (col)::text; text columns as col
    const parenCast = base().replace(
      "admin_users.status = 'active'::text",
      "(admin_users.status)::text = 'active'::text"
    );
    expect(parenCast).not.toBe(base());
    expect(matchesSome(parenCast, REVIEWS)).toBe(true);
  });

  it("accepts every stored variant verbatim", () => {
    for (const v of variants) expect(matchesSome(v.q, v.n)).toBe(true);
  });
});

describe("verifier — negative fixtures are rejected", () => {
  const cases: Array<[string, string]> = [
    ["expected expression OR true", `${base()} OR true`],
    ["true OR expected expression", `true OR ${base()}`],
    [
      "expected expression OR another role branch",
      `${base()} OR is_admin_role(ARRAY['interviewer'::text])`,
    ],
    ["expected expression AND false", `${base()} AND false`],
    [
      "removed ownership condition",
      "is_admin_role(ARRAY['admin'::text, 'super_admin'::text, 'core_team'::text]) OR is_admin_role(ARRAY['reviewer'::text])",
    ],
    [
      "changed user/owner column",
      base().replace("reviewer_admin_user_id =", "reviewer_person_id ="),
    ],
    [
      "changed is_admin_role role set",
      base().replace("'core_team'::text]", "'core_team'::text, 'interviewer'::text]"),
    ],
    [
      "additional function call",
      base().replace("= 'active'::text", "= lower('active'::text)"),
    ],
    [
      "unexpected alternate condition",
      `${base()} OR (auth.uid() IS NOT NULL)`,
    ],
    [
      "dropped status predicate inside the subquery",
      base().replace(" AND (admin_users.status = 'active'::text)", ""),
    ],
    [
      "relaxed comparison operator",
      base().replace("reviewer_admin_user_id =", "reviewer_admin_user_id <>"),
    ],
  ];

  it.each(cases)("rejects: %s", (_name, mutated) => {
    expect(matchesSome(mutated, REVIEWS)).toBe(false);
  });

  it("rejects each mutation for every stored variant, not just one", () => {
    for (const [, mutated] of cases) {
      for (const v of variants) expect(norm(v.q)).not.toBe(norm(mutated));
    }
  });

  it("normalisation removes nothing semantically meaningful", () => {
    for (const token of ["OR", "AND", "true", "false", "is_admin_role", "auth.uid()", "LIMIT 1"]) {
      const withToken = `${base()} OR ${token === "OR" || token === "AND" ? "true" : token}`;
      expect(norm(withToken)).toContain(token === "OR" || token === "AND" ? "true" : token);
    }
    // the only cast transformation is the paren unwrap, and it preserves the cast
    expect(norm("(admin_users.status)::text")).toBe("admin_users.status::text");
    expect(norm("(a.b)::text = 'x'::text")).toBe("a.b::text = 'x'::text");
    // it cannot touch a function call or a parenthesised sub-expression
    expect(norm("(f(x))::text")).toBe("(f(x))::text");
    expect(norm("(a OR b)::text")).toBe("(a OR b)::text");
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
