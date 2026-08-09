import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const VERIFIER = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const MIGRATION_062 = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
/**
 * The four staging RLS policies as pg_policies rendered them, captured
 * read-only at PRE_REMEDIATION_HEAD. This is a committed extract of that
 * capture — the same six fields these assertions read, byte-identical quals —
 * so the suite runs from a clean checkout. The rest of the original capture
 * (its metadata, table inventory and package counts) stays out of the tree.
 *
 * The value here is the RAW multi-line rendering. Regenerating it from the
 * verifier's expected quals would make `normalises the four captured staging
 * quals onto the committed expected quals` compare the verifier with itself.
 */
const CATALOG_EVIDENCE = "__tests__/fixtures/migration-062-staging-policy-catalog.json";

/** Verifier state immediately before this remediation. */
const PRE_REMEDIATION_HEAD = "675bb380123860ac11a11b603c8ecdcac4e76a0f";

const read = (path: string) => readFileSync(path, "utf8");
const gitShow = (ref: string, path: string) => {
  const result = spawnSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout;
};
const executableSql = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/**
 * JS mirror of the verifier's SQL normalisation:
 *   btrim(regexp_replace(x,'[[:space:]]+',' ','g'))
 * Kept honest by `applies the exact documented normalisation expression`, which
 * asserts the SQL still spells the expression this mirrors.
 */
const normalize = (s: string) => s.replace(/[\s]+/g, " ").trim();

const PACKAGE_TABLES = [
  "account_rls_package_state",
  "account_rls_package_manifest",
  "account_import_batches",
  "account_import_outcomes",
  "account_auth_reconciliation",
  "account_auth_operations",
  "account_person_auth_links",
  "account_import_previews",
] as const;

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/** Every top-level single-quoted SQL literal, with '' un-doubled. */
function sqlLiterals(sql: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== "'") continue;
    let cur = "";
    i++;
    for (; i < sql.length; i++) {
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") { cur += "'"; i++; continue; }
        break;
      }
      cur += sql[i];
    }
    out.push(cur);
  }
  return out;
}

/** The 11 expected policy USING expressions (7 package + 4 baseline). */
const policyQuals = (sql: string) =>
  sqlLiterals(executableSql(sql)).filter((l) => l.startsWith("(") && l.endsWith(")"));

const assertionLine = (sql: string, marker: string) => {
  const idx = executableSql(sql).indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  const rest = executableSql(sql).slice(idx);
  return rest.slice(0, rest.indexOf("\n"));
};

// ---------------------------------------------------------------------------
// Migration-062 parsers — the migration is the authority for both the default
// allow-list and the typed constraint counts.
// ---------------------------------------------------------------------------

function tableBody(sql: string, name: string): string {
  const marker = `create table public.${name}(`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  let i = start + marker.length;
  let depth = 1;
  let inStr = false;
  for (; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'") { if (sql[i + 1] === "'") i++; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) break; }
  }
  return sql.slice(start + marker.length, i);
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") { if (body[i + 1] === "'") cur += body[++i]; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function readDefaultExpr(part: string, from: number): string {
  let depth = 0;
  let inStr = false;
  let out = "";
  for (let i = from; i < part.length; i++) {
    const ch = part[i];
    if (inStr) {
      out += ch;
      if (ch === "'") { if (part[i + 1] === "'") out += part[++i]; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch) && /^(check|references|not\s+null|unique|primary\s+key)\b/i.test(part.slice(i + 1))) break;
    out += ch;
  }
  return out.trim();
}

const TABLE_LEVEL = /^(primary\s+key|unique|check|foreign\s+key|constraint)\b/i;

type ParsedTable = {
  defaults: { table: string; column: string; rendered: string }[];
  counts: { p: number; f: number; u: number; c: number };
};

function parseTable(migration: string, table: string): ParsedTable {
  const parts = splitTopLevel(tableBody(migration, table));
  const defaults: ParsedTable["defaults"] = [];
  let p = 0, f = 0, u = 0, c = 0;
  for (const part of parts) {
    if (TABLE_LEVEL.test(part)) {
      if (/^primary\s+key/i.test(part)) p++;
      else if (/^unique/i.test(part)) u++;
      else if (/^check/i.test(part)) c++;
      else if (/^foreign\s+key/i.test(part)) f++;
      continue;
    }
    const m = part.match(
      /^([a-z_][a-z0-9_]*)\s+([a-z][a-z0-9_ ]*?)(?=\s+(?:not\s+null|null|primary|unique|references|check|default)\b|$)/i,
    );
    if (/\bprimary\s+key\b/i.test(part)) p++;
    if (/\breferences\b/i.test(part)) f++;
    if (/\bunique\b/i.test(part)) u++;
    c += (part.match(/\bcheck\s*\(/gi) ?? []).length;
    const dm = part.match(/\bdefault\s+/i);
    if (dm && m) {
      const source = readDefaultExpr(part, (dm.index as number) + dm[0].length);
      const type = m[2].trim();
      // information_schema renders a bare literal with an explicit cast to the
      // column type; anything already cast, or a function call, renders as-is.
      const rendered = /^'.*'$/.test(source) && !source.includes("::") ? `${source}::${type}` : source;
      defaults.push({ table, column: m[1], rendered });
    }
  }
  return { defaults, counts: { p, f, u, c } };
}

function migrationDefaults(migration: string) {
  return PACKAGE_TABLES.flatMap((t) => parseTable(migration, t).defaults);
}
function migrationCounts(migration: string) {
  return Object.fromEntries(PACKAGE_TABLES.map((t) => [t, parseTable(migration, t).counts]));
}

/** expected_default(t,col,d) rows as written in the verifier. */
function verifierDefaults(sql: string) {
  const body = executableSql(sql);
  const start = body.indexOf("expected_default(t,col,d)as(values");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("expected_function(sig)", start);
  const region = body.slice(start, end);
  const rows: { table: string; column: string; rendered: string }[] = [];
  const re = /\('([a-z_]+)','([a-z_]+)','((?:[^']|'')*)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) {
    rows.push({ table: m[1], column: m[2], rendered: m[3].replace(/''/g, "'") });
  }
  return rows;
}

/** Trailing con_p,con_f,con_u,con_c per table as written in expected_table. */
function verifierCounts(sql: string) {
  const body = executableSql(sql);
  const start = body.indexOf("expected_table(t,cols,types,nulls,rls,forced,con_p,con_f,con_u,con_c)as(values");
  expect(start).toBeGreaterThan(-1);
  const region = body.slice(start, body.indexOf("expected_default(t,col,d)as(values", start));
  const out: Record<string, { p: number; f: number; u: number; c: number }> = {};
  for (const t of PACKAGE_TABLES) {
    const row = region.slice(region.indexOf(`('${t}',`));
    const m = row.match(/(?:true|false),(?:true|false),(\d+),(\d+),(\d+),(\d+)\)/);
    expect(m, `typed counts for ${t}`).not.toBeNull();
    out[t] = { p: +m![1], f: +m![2], u: +m![3], c: +m![4] };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Models of the SQL predicates, so mutation tests exercise real comparison
// semantics rather than only asserting on source text.
// ---------------------------------------------------------------------------

type PolicyRow = {
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

/** Mirrors the policy: assertion (roles fixed to authenticated). */
function policyAssertionPasses(rows: PolicyRow[], expectedQual: string): boolean {
  if (rows.length !== 1) return false;
  return rows.every(
    (p) =>
      p.permissive === "PERMISSIVE" &&
      JSON.stringify(p.roles) === JSON.stringify(["authenticated"]) &&
      p.cmd === "SELECT" &&
      p.qual !== null &&
      normalize(p.qual) === normalize(expectedQual) &&
      p.with_check === null,
  );
}

/** Mirrors the column_defaults assertion. */
function columnDefaultsPasses(
  actual: { table: string; column: string; def: string | null }[],
  expected: { table: string; column: string; rendered: string }[],
): boolean {
  const map = new Map(expected.map((e) => [`${e.table}.${e.column}`, e.rendered]));
  const present = new Set(actual.map((a) => `${a.table}.${a.column}`));
  for (const a of actual) {
    if ((map.get(`${a.table}.${a.column}`) ?? null) !== a.def) return false;
  }
  // every listed default must correspond to a real column (orphan guard)
  for (const e of expected) if (!present.has(`${e.table}.${e.column}`)) return false;
  return true;
}

/** Mirrors the typed constraint comparison, including the total==sum guard. */
function constraintAssertionPasses(
  actual: { p: number; f: number; u: number; c: number; total: number },
  expected: { p: number; f: number; u: number; c: number },
): boolean {
  return (
    actual.p === expected.p &&
    actual.f === expected.f &&
    actual.u === expected.u &&
    actual.c === expected.c &&
    actual.total === expected.p + expected.f + expected.u + expected.c
  );
}

// ---------------------------------------------------------------------------

const verifier = () => read(VERIFIER);
const migration062 = () => read(MIGRATION_062);
const capturedPolicies = () =>
  (JSON.parse(read(CATALOG_EVIDENCE)) as {
    policies: { tablename: string; policyname: string; roles: string[]; cmd: string; qual: string; with_check: string | null }[];
  }).policies;

describe("C1 — policy comparison uses symmetric whitespace normalisation", () => {
  it("applies the exact documented normalisation expression to both sides, twice", () => {
    const sql = executableSql(verifier());
    expect(sql.match(/btrim\(regexp_replace\(p\.qual,'\[\[:space:\]\]\+',' ','g'\)\)/g)).toHaveLength(2);
    expect(sql.match(/btrim\(regexp_replace\(e\.q,'\[\[:space:\]\]\+',' ','g'\)\)/g)).toHaveLength(2);
    // no raw equality left, and no reliance on a backslash escape
    expect(sql).not.toMatch(/p\.qual\s*=\s*e\.q/);
    expect(sql).not.toMatch(/regexp_replace\([^)]*'\\s/);
  });

  it("normalises in both the package and baseline policy assertions", () => {
    for (const marker of ["union all select 'policy:'||e.n", "union all select 'baseline_policy:'||e.n"]) {
      const line = assertionLine(verifier(), marker);
      expect(line).toContain("btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))=btrim(regexp_replace(e.q,'[[:space:]]+',' ','g'))");
    }
  });

  it("collapses newline, tab, leading, trailing and repeated whitespace", () => {
    const flat = "((a = b) OR (EXISTS ( SELECT 1 FROM t s WHERE (s.x = 1))))";
    const rendered = "  ((a = b) OR (EXISTS ( SELECT 1\n   FROM t s\n\t  WHERE (s.x = 1))))  ";
    expect(normalize(rendered)).toBe(normalize(flat));
    expect(normalize(rendered)).toBe(flat);
  });

  it("changes only the comparator, not the surrounding policy predicates", () => {
    const before = gitShow(PRE_REMEDIATION_HEAD, VERIFIER);
    for (const marker of ["union all select 'policy:'||e.n", "union all select 'baseline_policy:'||e.n"]) {
      const now = assertionLine(verifier(), marker);
      const reverted = now.replace(
        "btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))=btrim(regexp_replace(e.q,'[[:space:]]+',' ','g'))",
        "p.qual=e.q",
      );
      expect(reverted).toBe(assertionLine(before, marker));
    }
  });

  it("keeps every non-qual policy check exact", () => {
    const line = assertionLine(verifier(), "union all select 'policy:'||e.n");
    expect(line).toContain("count(p.*)=1");
    expect(line).toContain("p.permissive='PERMISSIVE'");
    expect(line).toContain("p.roles::text[]=array['authenticated']::text[]");
    expect(line).toContain("p.cmd='SELECT'");
    expect(line).toContain("p.with_check is null");
    for (const banned of [" like ", " ilike ", "position(", "strpos(", "substring("]) {
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });

  it("leaves the expected policy expressions byte-identical to the pre-remediation baseline", () => {
    const before = policyQuals(gitShow(PRE_REMEDIATION_HEAD, VERIFIER));
    const after = policyQuals(verifier());
    expect(after).toHaveLength(11);
    expect(after).toEqual(before);
  });

  it("normalises the four captured staging quals onto the committed expected quals", () => {
    const expected = new Map(
      policyQuals(verifier()).map((q) => [normalize(q), q] as const),
    );
    const captured = capturedPolicies();
    expect(captured).toHaveLength(4);
    for (const p of captured) {
      expect(p.qual, `${p.policyname} raw qual must differ (it is multi-line)`).not.toBe(
        expected.get(normalize(p.qual)),
      );
      expect(expected.has(normalize(p.qual)), `${p.policyname} normalises onto an expected qual`).toBe(true);
    }
  });

  it("contains no quoted literal with internal whitespace that normalisation would alter", () => {
    const offenders: string[] = [];
    for (const qual of policyQuals(verifier())) {
      const re = /'((?:[^']|'')*)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(qual))) {
        if (/\s/.test(m[1])) offenders.push(`${m[1]} (in ${qual.slice(0, 60)}…)`);
      }
    }
    // A hit here means whitespace normalisation is no longer semantics-preserving
    // and the comparator must be redesigned (literal-aware), not widened.
    expect(offenders).toEqual([]);
  });
});

describe("C1 — policy mutations still fail", () => {
  const base = () => {
    const captured = capturedPolicies().find((p) => p.policyname === "vam062_people_program_ops")!;
    const expected = policyQuals(verifier()).find((q) => normalize(q) === normalize(captured.qual))!;
    return { captured, expected };
  };

  const row = (over: Partial<PolicyRow> = {}, qual?: string): PolicyRow => ({
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    cmd: "SELECT",
    qual: qual ?? base().captured.qual,
    with_check: null,
    ...over,
  });

  it("passes on the real captured policy", () => {
    expect(policyAssertionPasses([row()], base().expected)).toBe(true);
  });

  it.each([
    ["null-season denial clause removed", (q: string) => q.replace(" AND (s.season_id IS NOT NULL)", "")],
    ["active becomes inactive", (q: string) => q.replace("'active'::text", "'inactive'::text")],
    ["an extra role is allowed", (q: string) => q.replace("'operations'::text]", "'operations'::text, 'reviewer'::text]")],
    ["a required cast is removed", (q: string) => q.replace("(m.program_id)::text", "m.program_id")],
    ["the predicate becomes a tautology", (q: string) => q.replace("(m.person_id = people.id)", "(1 = 1)")],
  ])("fails when %s", (_label, mutate) => {
    const { captured, expected } = base();
    expect(policyAssertionPasses([row({}, mutate(captured.qual))], expected)).toBe(false);
  });

  it("fails when roles change from authenticated to public", () => {
    expect(policyAssertionPasses([row({ roles: ["public"] })], base().expected)).toBe(false);
  });

  it("fails when the command widens from SELECT to ALL", () => {
    expect(policyAssertionPasses([row({ cmd: "ALL" })], base().expected)).toBe(false);
  });

  it("fails when WITH CHECK becomes non-null", () => {
    expect(policyAssertionPasses([row({ with_check: "(true)" })], base().expected)).toBe(false);
  });

  it("fails when the policy becomes non-permissive", () => {
    expect(policyAssertionPasses([row({ permissive: "RESTRICTIVE" })], base().expected)).toBe(false);
  });

  it("fails when a duplicate policy of the same name appears", () => {
    expect(policyAssertionPasses([row(), row()], base().expected)).toBe(false);
  });

  it("fails when the policy is missing entirely", () => {
    expect(policyAssertionPasses([], base().expected)).toBe(false);
  });
});

describe("C2 — expected_default is complete and fail-closed", () => {
  it("matches the defaults declared by migration 062 exactly", () => {
    const key = (d: { table: string; column: string; rendered: string }) => `${d.table}.${d.column}=${d.rendered}`;
    const fromMigration = migrationDefaults(migration062()).map(key).sort();
    const fromVerifier = verifierDefaults(verifier()).map(key).sort();
    expect(fromVerifier).toEqual(fromMigration);
    expect(fromVerifier).toHaveLength(23);
  });

  it("carries the three defect classes the staging run exposed", () => {
    const rows = verifierDefaults(verifier());
    const get = (t: string, c: string) => rows.find((r) => r.table === t && r.column === c)?.rendered;
    for (const [col, val] of [
      ["pre_lookup_state", "'pending'::text"],
      ["provider_stage", "'not_started'::text"],
      ["ownership_state", "'not_found'::text"],
      ["delete_allowed", "false"],
      ["application_stage", "'not_started'::text"],
      ["compensation_stage", "'not_required'::text"],
      ["reconciliation_state", "'not_required'::text"],
    ] as const) {
      expect(get("account_auth_operations", col)).toBe(val);
    }
    expect(get("account_person_auth_links", "id")).toBe("gen_random_uuid()");
    // migration 062 declares "id uuid primary key" with no default here
    expect(get("account_import_previews", "id")).toBeUndefined();
  });

  it("leaves every unlisted package column genuinely default-free in migration 062", () => {
    const listed = verifierDefaults(verifier()).map((r) => `${r.table}.${r.column}`);
    const declared = migrationDefaults(migration062()).map((d) => `${d.table}.${d.column}`);
    for (const k of declared) expect(listed.includes(k), `${k} is declared with a default but unlisted`).toBe(true);
    for (const k of listed) expect(declared.includes(k), `${k} is listed but has no default in migration 062`).toBe(true);
  });

  it("compares against a scalar lookup with no permissive else-branch", () => {
    const line = assertionLine(verifier(), "union all select 'column_defaults'");
    expect(line).toContain("is distinct from(select x.d from expected_default x");
    expect(line).not.toMatch(/else\s+null\s+end/);
    // orphan guard: an expected_default row naming a non-existent column fails
    expect(line).toContain("not exists(select 1 from expected_default x where not exists(");
  });

  it.each([
    ["a required default changes", (rows: { table: string; column: string; def: string | null }[]) =>
      rows.map((r) => (r.column === "pre_lookup_state" ? { ...r, def: "'zero'::text" } : r))],
    ["an unexpected default is added", (rows: { table: string; column: string; def: string | null }[]) =>
      rows.map((r) => (r.column === "failure_class" ? { ...r, def: "'x'::text" } : r))],
    ["a required default is removed", (rows: { table: string; column: string; def: string | null }[]) =>
      rows.map((r) => (r.column === "delete_allowed" ? { ...r, def: null } : r))],
  ])("fails when %s", (_label, mutate) => {
    const expected = verifierDefaults(verifier());
    const actual = [
      ...expected.map((e) => ({ table: e.table, column: e.column, def: e.rendered })),
      { table: "account_auth_operations", column: "failure_class", def: null },
    ];
    expect(columnDefaultsPasses(actual, expected)).toBe(true);
    expect(columnDefaultsPasses(mutate(actual), expected)).toBe(false);
  });
});

describe("C3 — typed constraint breakdown", () => {
  it("matches the typed counts implied by migration 062", () => {
    expect(verifierCounts(verifier())).toEqual(migrationCounts(migration062()));
  });

  it("pins the corrected totals for the two tables that failed on staging", () => {
    const counts = verifierCounts(verifier());
    expect(counts.account_auth_operations).toEqual({ p: 1, f: 2, u: 0, c: 11 });
    expect(counts.account_person_auth_links).toEqual({ p: 1, f: 3, u: 3, c: 2 });
    const sum = (x: { p: number; f: number; u: number; c: number }) => x.p + x.f + x.u + x.c;
    expect(sum(counts.account_auth_operations)).toBe(14); // was wrongly 15
    expect(sum(counts.account_person_auth_links)).toBe(9); // was wrongly 11
  });

  it("compares each contype and proves the total equals their sum", () => {
    const line = assertionLine(verifier(), "select 'table:'||t assertion");
    for (const frag of ["actual_p=con_p", "actual_f=con_f", "actual_u=con_u", "actual_c=con_c"]) {
      expect(line).toContain(frag);
    }
    expect(line).toContain("actual_constraints=con_p+con_f+con_u+con_c");
    const tableActual = executableSql(verifier()).slice(
      executableSql(verifier()).indexOf("table_actual as("),
      executableSql(verifier()).indexOf("assertions as("),
    );
    for (const t of ["'p'", "'f'", "'u'", "'c'"]) {
      expect(tableActual).toContain(`x.contype=${t}`);
    }
  });

  it.each([
    ["a check constraint is dropped", { p: 1, f: 2, u: 0, c: 10, total: 13 }],
    ["a foreign key is dropped", { p: 1, f: 1, u: 0, c: 11, total: 13 }],
    ["the primary key is dropped", { p: 0, f: 2, u: 0, c: 11, total: 13 }],
    ["an unverified contype appears", { p: 1, f: 2, u: 0, c: 11, total: 15 }],
  ])("fails when %s on account_auth_operations", (_label, actual) => {
    expect(constraintAssertionPasses(actual, { p: 1, f: 2, u: 0, c: 11 })).toBe(false);
  });

  it("fails when a unique constraint is dropped on account_person_auth_links", () => {
    expect(constraintAssertionPasses({ p: 1, f: 3, u: 2, c: 2, total: 8 }, { p: 1, f: 3, u: 3, c: 2 })).toBe(false);
  });

  it("fails when a foreign key is swapped for a check and the total is unchanged", () => {
    const expected = { p: 1, f: 2, u: 0, c: 11 };
    const swapped = { p: 1, f: 1, u: 0, c: 12, total: 14 };
    // the retired scalar-total check would have accepted this
    expect(swapped.total).toBe(expected.p + expected.f + expected.u + expected.c);
    expect(constraintAssertionPasses(swapped, expected)).toBe(false);
  });

  it("passes only on the exact typed breakdown", () => {
    expect(constraintAssertionPasses({ p: 1, f: 2, u: 0, c: 11, total: 14 }, { p: 1, f: 2, u: 0, c: 11 })).toBe(true);
  });
});

describe("C4 — verifier contract and migration immutability", () => {
  it("keeps migration 062 and 063 byte-identical to the pre-remediation baseline", () => {
    expect(read(MIGRATION_062)).toBe(gitShow(PRE_REMEDIATION_HEAD, MIGRATION_062));
    expect(read(MIGRATION_063)).toBe(gitShow(PRE_REMEDIATION_HEAD, MIGRATION_063));
  });

  it("preserves the one-row, one-column output contract", () => {
    const sql = verifier();
    expect(sql.match(/\) account_rls_post_apply_v3 from summary;/g)).toHaveLength(1);
    expect(executableSql(sql).match(/;/g)).toHaveLength(1);
  });

  it("preserves overall_status, mismatches and null_season_denial semantics byte-for-byte", () => {
    const before = gitShow(PRE_REMEDIATION_HEAD, VERIFIER);
    const after = verifier();
    const tail = (s: string) => s.slice(s.indexOf("summary as(select *,status<>'PASS' failed from assertions)"));
    expect(tail(after)).toBe(tail(before));
  });

  it("still emits every assertion name the staging run reported", () => {
    const sql = executableSql(verifier());
    for (const a of [
      "'table:'||t",
      "'policy:'||e.n",
      "'baseline_policy:'||e.n",
      "'policy_inventory'",
      "'column_defaults'",
      "'affected_table_state_and_grants'",
      "'function_inventory'",
      "'package_grants'",
      "'package_provenance'",
      "'action_type_vocabulary:values'",
      "'action_type_vocabulary:not_valid'",
      "'admin_users_status_vocabulary'",
    ]) {
      expect(sql).toContain(a);
    }
  });

  it("remains a single read-only SELECT with no apply or rollback SQL", () => {
    const sql = executableSql(verifier()).trim();
    expect(sql).toMatch(/^with\b/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|copy|vacuum|reindex|refresh)\s/i);
    expect(sql).not.toMatch(/\bcommit\b|\brollback\b|\bbegin\b/i);
    expect(sql).not.toMatch(/\bauth\.users\b/i);
    expect(sql).not.toMatch(/\bmigration[_ -]?063\b/i);
  });
});
