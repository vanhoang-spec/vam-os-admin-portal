import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * PostgreSQL 17 catalog-cast regression guard for the UAT staging preflight.
 *
 * The staging run of scripts/uat-fixture-staging-preflight.sql reached BEGIN and
 * SET TRANSACTION READ ONLY and then aborted on:
 *
 *   ERROR: operator is not unique: unknown || "char"
 *   LINE 224: 'confdeltype=' || c.confdeltype ||
 *
 * pg_constraint.confdeltype is the internal `"char"` type. `"char"` has no
 * implicit cast to text, so an unadorned string literal (type `unknown`) beside
 * it leaves both `text || anynonarray` and `anynonarray || text` viable and the
 * operator cannot be resolved. The same trap exists for every other internal
 * catalog type — `name`, `oid`, the `reg*` types, `int2`, the catalog vectors —
 * whenever the value is concatenated rather than compared.
 *
 * These tests are static: no database connection is used or required. They scan
 * the SQL text for catalog-typed values that reach the `||` operator without an
 * explicit `::text`, and they prove the scanner would have caught the live
 * failure by running it against the pre-remediation commit.
 */

const PREFLIGHT = "scripts/uat-fixture-staging-preflight.sql";

/** The exact file state that produced the live PostgreSQL 17 parse failure. */
const PRE_REMEDIATION_HEAD = "00635223e3584ff9058c6745d0e3ae68efa46101";

const read = (path: string) => readFileSync(path, "utf8");
const gitShow = (ref: string, path: string) => {
  const result = spawnSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  expect(result.status, `git show ${ref}:${path}`).toBe(0);
  return result.stdout;
};

// ---------------------------------------------------------------------------
// Catalog type inventory
//
// Keyed on the bare column name. That is sound for this file because it is
// checked by `keys on column names that no non-catalog relation in the file
// uses`, which fails if a data column ever collides with one of these names.
// ---------------------------------------------------------------------------

/** Internal `"char"` columns: no implicit cast to text, so `||` is ambiguous. */
const CHAR_COLUMNS = [
  "contype", "confdeltype", "confupdtype", "confmatchtype",
  "relkind", "relpersistence", "relreplident",
  "attidentity", "attgenerated", "attstorage", "attalign",
  "provolatile", "proparallel", "prokind",
  "typtype", "typcategory", "typalign", "typstorage",
  "tgenabled", "polcmd", "castcontext", "castmethod", "collprovider",
  "amtype", "defaclobjtype", "evtenabled", "deptype", "oprkind", "datlocprovider",
] as const;

/** `name` columns and the name-returning SQL keywords that need no parentheses. */
const NAME_COLUMNS = [
  "relname", "attname", "conname", "nspname", "proname", "typname", "tgname",
  "amname", "rolname", "datname", "spcname", "collname", "opcname", "opfname",
  "lanname", "enumlabel", "srvname", "usename", "evtname", "indexrelname",
  "schemaname", "tablename", "policyname", "indexname", "viewname",
  "matviewname", "sequencename",
  "current_user", "session_user", "current_role", "current_schema", "current_catalog",
] as const;

/** `oid` columns — render as a bare number and are not implicitly text. */
const OID_COLUMNS = [
  "oid", "relnamespace", "reltype", "relowner", "reltoastrelid", "relam",
  "conrelid", "confrelid", "connamespace", "contypid", "conindid",
  "indrelid", "indexrelid", "attrelid", "atttypid", "attcollation",
  "tgrelid", "tgfoid", "tgconstraint", "pronamespace", "prorettype", "proowner",
  "prolang", "typrelid", "typelem", "typnamespace", "typbasetype",
] as const;

/** Small integers: also no implicit cast to text. */
const INT2_COLUMNS = [
  "attnum", "tgtype", "tgnargs", "relnatts", "indnatts", "indnkeyatts", "pronargs",
] as const;

/** Catalog vectors, catalog arrays and node trees. */
const VECTOR_COLUMNS = [
  "indkey", "indclass", "indcollation", "indoption", "proargtypes",
  "conkey", "confkey", "proargmodes", "proallargtypes",
  "relacl", "proacl", "typacl", "nspacl", "defaclacl",
  "adbin", "indpred", "indexprs", "conbin", "proargdefaults", "partexprs",
  "xmin", "xmax", "relfrozenxid", "relminmxid",
] as const;

const CATALOG_COLUMN_TYPES: Record<string, string> = {
  ...Object.fromEntries(CHAR_COLUMNS.map((c) => [c, '"char"'])),
  ...Object.fromEntries(NAME_COLUMNS.map((c) => [c, "name"])),
  ...Object.fromEntries(OID_COLUMNS.map((c) => [c, "oid"])),
  ...Object.fromEntries(INT2_COLUMNS.map((c) => [c, "int2"])),
  ...Object.fromEntries(VECTOR_COLUMNS.map((c) => [c, "catalog vector/array"])),
};

/** Catalog functions that do NOT return text. */
const NON_TEXT_CATALOG_FUNCTIONS: Record<string, string> = {
  current_database: "name",
  current_schema: "name",
  pg_get_userbyid: "name",
  to_regclass: "regclass",
  to_regproc: "regproc",
  to_regprocedure: "regprocedure",
  to_regtype: "regtype",
  to_regoper: "regoper",
  to_regoperator: "regoperator",
  to_regnamespace: "regnamespace",
  to_regrole: "regrole",
  to_regcollation: "regcollation",
  pg_typeof: "regtype",
  pg_my_temp_schema: "oid",
  pg_backend_pid: "int4",
  pg_relation_size: "int8",
  pg_total_relation_size: "int8",
};

/**
 * Catalog functions that genuinely return `text` and may therefore sit beside a
 * bare literal. Anything catalog-shaped and absent from this list is treated as
 * unreviewed, so a new `pg_*` helper cannot slip in uncast.
 */
const TEXT_CATALOG_FUNCTIONS = new Set([
  "pg_get_constraintdef", "pg_get_indexdef", "pg_get_expr", "pg_get_triggerdef",
  "pg_get_functiondef", "pg_get_function_identity_arguments", "pg_get_viewdef",
  "pg_get_ruledef", "pg_get_partkeydef", "pg_get_statisticsobjdef",
  "pg_size_pretty", "obj_description", "col_description", "shobj_description",
  "format_type", "quote_ident", "quote_literal", "quote_nullable",
  "current_setting", "version",
]);

const CATALOG_SHAPED = /^(pg_|to_reg|current_|obj_description|col_description|shobj_description|format_type|quote_|version$|has_)/;

// ---------------------------------------------------------------------------
// A small, string-aware SQL scanner
// ---------------------------------------------------------------------------

/** Drops `--` comments without being fooled by a `--` inside a string literal. */
function stripComments(sql: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") out += sql[++i];
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Blanks out string-literal bodies so prose in a detail column cannot look like DML. */
function stripStrings(sql: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") { i += 1; continue; }
        inString = false;
        out += ch;
      }
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

type Ref = { name: string; call: boolean; cast: string | null; index: number };
type Token =
  | { t: "concat"; index: number }
  | { t: "literal"; index: number }
  | { t: "punct"; index: number; text: string }
  | { t: "ref"; index: number; ref: Ref; inner: { text: string; offset: number } | null };

/** Index just past the `)` matching the `(` at `open`. */
function matchParen(sql: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") { if (sql[i + 1] === "'") i += 1; else inString = false; }
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") { depth -= 1; if (depth === 0) return i + 1; }
  }
  return sql.length;
}

/** Reads a trailing `::type` at `from`, returning [castOrNull, nextIndex]. */
function readCast(sql: string, from: number): [string | null, number] {
  let i = from;
  while (i < sql.length && /\s/.test(sql[i])) i += 1;
  const m = /^::\s*([a-z_][a-z0-9_]*)(\s*\[\s*\])?/i.exec(sql.slice(i));
  if (!m) return [null, from];
  return [(m[1] + (m[2] ? "[]" : "")).toLowerCase(), i + m[0].length];
}

/**
 * Tokenises one expression scope. Function calls and parenthesised groups are
 * consumed whole — so a trailing `::text` binds to the group rather than to the
 * identifier inside it — and their bodies are handed back for recursion.
 */
function tokenize(sql: string, base = 0): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      tokens.push({ t: "literal", index: base + start });
      continue;
    }
    if (ch === "|" && sql[i + 1] === "|") {
      tokens.push({ t: "concat", index: base + i });
      i += 2;
      continue;
    }
    if (ch === "(") {
      const end = matchParen(sql, i);
      const [cast, after] = readCast(sql, end);
      tokens.push({
        t: "ref",
        index: base + i,
        ref: { name: "(group)", call: false, cast, index: base + i },
        inner: { text: sql.slice(i + 1, end - 1), offset: base + i + 1 },
      });
      i = after;
      continue;
    }
    const ident = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*/i.exec(sql.slice(i));
    if (ident) {
      const start = i;
      let j = i + ident[0].length;
      let call = false;
      let inner: { text: string; offset: number } | null = null;
      let k = j;
      while (k < sql.length && /\s/.test(sql[k])) k += 1;
      if (sql[k] === "(") {
        call = true;
        const end = matchParen(sql, k);
        inner = { text: sql.slice(k + 1, end - 1), offset: base + k + 1 };
        j = end;
      }
      const [cast, after] = readCast(sql, j);
      tokens.push({
        t: "ref",
        index: base + start,
        ref: { name: ident[0].toLowerCase(), call, cast, index: base + start },
        inner,
      });
      i = after;
      continue;
    }
    tokens.push({ t: "punct", index: base + i, text: ch });
    i += 1;
  }
  return tokens;
}

/** The catalog type of a reference, or null if it is text-safe / not catalog. */
function catalogTypeOf(ref: Ref): string | null {
  const bare = ref.name.split(".").pop() as string;
  if (ref.call) {
    if (NON_TEXT_CATALOG_FUNCTIONS[bare]) return NON_TEXT_CATALOG_FUNCTIONS[bare];
    if (CATALOG_SHAPED.test(bare) && !TEXT_CATALOG_FUNCTIONS.has(bare)) return "unreviewed catalog function";
    return null;
  }
  if (ref.name === "(group)") return null;
  return CATALOG_COLUMN_TYPES[bare] ?? null;
}

type Violation = { name: string; type: string; line: number; cast: string | null };

/** Every catalog-typed value that reaches `||` without an explicit `::text`. */
function uncastConcatOperands(rawSql: string): Violation[] {
  const sql = stripComments(rawSql);
  const lineOf = (index: number) => sql.slice(0, index).split("\n").length;
  const found: Violation[] = [];

  const walk = (text: string, offset: number) => {
    const tokens = tokenize(text, offset);
    tokens.forEach((token, idx) => {
      if (token.t !== "ref") return;
      const concatenated = tokens[idx - 1]?.t === "concat" || tokens[idx + 1]?.t === "concat";
      const type = catalogTypeOf(token.ref);
      if (concatenated && type && token.ref.cast !== "text") {
        found.push({ name: token.ref.name, type, line: lineOf(token.ref.index), cast: token.ref.cast });
      }
      // `||` also appears inside function arguments and parenthesised groups.
      if (token.inner) walk(token.inner.text, token.inner.offset);
    });
  };

  walk(sql, 0);
  return found;
}

/** Every catalog-typed reference in the file, concatenated or not. */
function catalogReferences(rawSql: string): { name: string; cast: string | null; concatenated: boolean }[] {
  const sql = stripComments(rawSql);
  const out: { name: string; cast: string | null; concatenated: boolean }[] = [];
  const walk = (text: string, offset: number) => {
    const tokens = tokenize(text, offset);
    tokens.forEach((token, idx) => {
      if (token.t !== "ref") return;
      if (catalogTypeOf(token.ref)) {
        out.push({
          name: token.ref.name,
          cast: token.ref.cast,
          concatenated: tokens[idx - 1]?.t === "concat" || tokens[idx + 1]?.t === "concat",
        });
      }
      if (token.inner) walk(token.inner.text, token.inner.offset);
    });
  };
  walk(sql, 0);
  return out;
}

const preflight = () => read(PREFLIGHT);

// ---------------------------------------------------------------------------

describe("staging preflight — PostgreSQL 17 catalog cast regression", () => {
  it("reproduces the live failure against the pre-remediation commit", () => {
    const before = uncastConcatOperands(gitShow(PRE_REMEDIATION_HEAD, PREFLIGHT));
    expect(before.map((v) => `${v.name}:${v.type}`)).toEqual([
      "current_database:name",
      "c.conname:name",
      "c.confdeltype:\"char\"",
    ]);
    // The one that actually aborted the staging session.
    const confdeltype = before.find((v) => v.name === "c.confdeltype");
    expect(confdeltype?.type).toBe('"char"');
    expect(confdeltype?.cast).toBeNull();
  });

  it("finds no uncast catalog operand in the current preflight", () => {
    expect(uncastConcatOperands(preflight())).toEqual([]);
  });

  it("casts every concatenated catalog reference to text and nothing else", () => {
    const refs = catalogReferences(preflight());
    const concatenated = refs.filter((r) => r.concatenated);
    expect(concatenated).toEqual([
      { name: "current_database", cast: "text", concatenated: true },
      { name: "c.conname", cast: "text", concatenated: true },
      { name: "c.confdeltype", cast: "text", concatenated: true },
      { name: "c.conname", cast: "text", concatenated: true },
      { name: "c.confdeltype", cast: "text", concatenated: true },
      { name: "c.conname", cast: "text", concatenated: true },
      { name: "c.conname", cast: "text", concatenated: true },
      { name: "c.confdeltype", cast: "text", concatenated: true },
    ]);
    // Catalog references that are only compared or passed as arguments stay
    // uncast on purpose: `c.contype = 'c'` and `c.oid` as a function argument
    // resolve unambiguously and casting them would only cost index usage.
    expect(refs.length).toBeGreaterThan(concatenated.length);
  });

  it("spells the three fixed expressions exactly", () => {
    const sql = preflight();
    expect(sql).toContain("'current_database=' || current_database()::text ||");
    expect(sql).toMatch(/'fk\.(subject_pinning\.|actor_attribution\.|actor_attribution\.trigger_interaction\.)?' \|\| c\.conname::text,/);
    expect(sql).toContain("'confdeltype=' || c.confdeltype::text ||");
    expect(sql).not.toMatch(/\|\|\s*c\.confdeltype\s*\|\|/);
    expect(sql).not.toMatch(/\|\|\s*c\.conname\s*,/);
  });

  it("keys on column names that no non-catalog relation in the file uses", () => {
    // Guards the scanner against false positives: if a data column ever shares
    // a name with a catalog column, the inventory must gain alias awareness.
    const sql = stripComments(preflight());
    for (const dataColumn of [
      "table_name", "column_name", "data_type", "is_nullable", "expected_type",
      "expected_nullable", "email", "email_primary", "full_name", "notes", "status",
      "role", "code", "is_active", "program_id", "season_id", "person_id",
      "data_quality_flags", "check_name", "sort_key", "detail", "address", "value",
    ]) {
      expect(sql, `${dataColumn} is referenced by the file`).toContain(dataColumn);
      expect(
        CATALOG_COLUMN_TYPES[dataColumn],
        `${dataColumn} collides with the catalog inventory`,
      ).toBeUndefined();
    }
  });
});

describe("staging preflight — catalog cast mutations still fail", () => {
  const mutate = (from: string, to: string) => {
    const sql = preflight();
    expect(sql).toContain(from);
    return sql.replace(from, to);
  };

  it("fails when the confdeltype cast is removed", () => {
    const found = uncastConcatOperands(mutate("c.confdeltype::text", "c.confdeltype"));
    expect(found).toEqual([{ name: "c.confdeltype", type: '"char"', line: expect.any(Number), cast: null }]);
  });

  it("fails when the conname cast is removed", () => {
    expect(uncastConcatOperands(mutate("c.conname::text", "c.conname"))).toHaveLength(1);
  });

  it("fails when the current_database cast is removed", () => {
    expect(uncastConcatOperands(mutate("current_database()::text", "current_database()"))).toHaveLength(1);
  });

  it("fails when a cast is present but is not to text", () => {
    expect(uncastConcatOperands(mutate("c.confdeltype::text", "c.confdeltype::varchar"))).toEqual([
      { name: "c.confdeltype", type: '"char"', line: expect.any(Number), cast: "varchar" },
    ]);
  });

  it.each([
    ['"char"', "c.confupdtype", '"char"'],
    ['"char"', "t.relkind", '"char"'],
    ['"char"', "a.attidentity", '"char"'],
    ['"char"', "a.attgenerated", '"char"'],
    ['"char"', "p.provolatile", '"char"'],
    ['"char"', "c.contype", '"char"'],
    ['"char"', "tg.tgenabled", '"char"'],
    ["int2", "tg.tgtype", "int2"],
    ["name", "t.relname", "name"],
    ["oid", "c.conrelid", "oid"],
    ["catalog vector/array", "i.indkey", "catalog vector/array"],
  ])("flags an uncast %s field (%s) added to a detail string", (_label, expr, type) => {
    const sql = mutate("'confdeltype=' || c.confdeltype::text", `'confdeltype=' || ${expr}`);
    expect(uncastConcatOperands(sql)).toEqual([
      { name: expr, type, line: expect.any(Number), cast: null },
    ]);
  });

  it("accepts the same fields once they carry ::text", () => {
    for (const expr of ["c.confupdtype", "t.relkind", "a.attidentity", "p.provolatile", "i.indkey"]) {
      const sql = mutate("'confdeltype=' || c.confdeltype::text", `'confdeltype=' || ${expr}::text`);
      expect(uncastConcatOperands(sql), expr).toEqual([]);
    }
  });

  it("flags an uncast reg* lookup and a name-returning helper", () => {
    for (const [expr, type] of [
      ["to_regclass('public.admin_users')", "regclass"],
      ["pg_get_userbyid(c.conrelid)", "name"],
      ["pg_typeof(c.conrelid)", "regtype"],
    ] as const) {
      const sql = mutate("'confdeltype=' || c.confdeltype::text", `'confdeltype=' || ${expr}`);
      expect(uncastConcatOperands(sql).map((v) => v.type), expr).toContain(type);
    }
  });

  it("flags an unreviewed catalog function concatenated without a cast", () => {
    const sql = mutate("'confdeltype=' || c.confdeltype::text", "'confdeltype=' || pg_get_serial_sequence('t', 'c')");
    expect(uncastConcatOperands(sql).map((v) => v.name)).toEqual(["pg_get_serial_sequence"]);
  });

  it("leaves the reviewed text-returning catalog functions alone", () => {
    const sql = mutate("'confdeltype=' || c.confdeltype::text", "'confdeltype=' || pg_get_constraintdef(c.oid)");
    expect(uncastConcatOperands(sql)).toEqual([]);
  });

  it("still sees a violation inside a function argument", () => {
    const sql = mutate(
      "'confdeltype=' || c.confdeltype::text",
      "coalesce('confdeltype=' || c.confdeltype, '<none>')",
    );
    expect(uncastConcatOperands(sql).map((v) => v.name)).toEqual(["c.confdeltype"]);
  });

  it("is not fooled by a catalog column name inside a string literal or a comment", () => {
    const sql = mutate(
      "'confdeltype=' || c.confdeltype::text",
      "'x || c.relkind y' -- 'z' || t.relname\n         || c.confdeltype::text",
    );
    expect(uncastConcatOperands(sql)).toEqual([]);
  });
});



describe("staging preflight — read-only guarantees and PASS/FAIL semantics", () => {
  it("still opens read-only, stays SELECT-only and ends with ROLLBACK", () => {
    const sql = stripStrings(stripComments(preflight()));
    expect(sql).toMatch(/^\s*BEGIN;/);
    expect(sql).toMatch(/SET TRANSACTION READ ONLY;/);
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|COPY|VACUUM|REINDEX|REFRESH)\b/i);
    // no dynamic SQL and no volatile side-effect helpers
    expect(sql).not.toMatch(/\bEXECUTE\b|\bdblink\b|\bpg_read_file\b|\bpg_sleep\b|\bsetval\b|\bnextval\b|\bpg_terminate_backend\b/i);
  });
});
