import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const DIAGNOSTIC = "docs/audits/sql/VAM_OS_MIGRATION_059_PREREQUISITE_DIAGNOSTIC_EXEC.sql";
const OWNER_PREFLIGHT = "docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_PREFLIGHT_EXEC.sql";
const MIGRATION_059 = "supabase_migrations/059_staging_application_workflow_bootstrap.sql";

const STAGING = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION = "qkkroesfiazsejkzflcd";
const ATTESTATION = `SET LOCAL vam059.attested_project_ref = '${STAGING}';`;

const FK_TARGETS = ["people", "seasons", "intake_batches", "admin_users"];

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const read = (p: string) => lf(readFileSync(p, "utf8"));
const sql = () => read(DIAGNOSTIC);

/** Comment- and literal-free code, for DDL/DML and table-access scans. */
function strippedCode(s: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { if (ch === "'") { if (s[i + 1] === "'") i++; else inStr = false; } continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "-" && s[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}

/** Comments removed, literals kept. */
function withoutComments(s: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { out += ch; if (ch === "'") { if (s[i + 1] === "'") { out += s[++i]; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === "-" && s[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}

/** Split into top-level statements, honouring comments, literals and $tags$. */
function statements(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "-" && s[i + 1] === "-") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (ch === "'") {
      cur += ch; i++;
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { cur += "''"; i += 2; continue; }
          cur += "'"; i++; break;
        }
        cur += s[i]; i++;
      }
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        const end = s.indexOf(tag, i + tag.length);
        const stop = end === -1 ? s.length : end + tag.length;
        cur += s.slice(i, stop); i = stop; continue;
      }
    }
    if (ch === ";") { out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => x.length > 0);
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const stmts = () => statements(sql()).map(flat);

// ---------------------------------------------------------------------------

describe("prerequisite diagnostic — transaction shape", () => {
  it("has exactly one BEGIN, and it is the first statement", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "BEGIN")).toHaveLength(1);
    expect(s[0].toUpperCase()).toBe("BEGIN");
  });

  it("has exactly one ROLLBACK, and it is the last statement", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "ROLLBACK")).toHaveLength(1);
    expect(s[s.length - 1].toUpperCase()).toBe("ROLLBACK");
  });

  it("has zero COMMIT and opens no nested transaction", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "COMMIT")).toHaveLength(0);
    expect(s.filter((x) => /^(START TRANSACTION|SAVEPOINT|RELEASE|ROLLBACK TO)\b/i.test(x))).toHaveLength(0);
  });

  it("sets the transaction read only and keeps safe timeouts", () => {
    const s = stmts();
    expect(s.filter((x) => x.toUpperCase() === "SET TRANSACTION READ ONLY")).toHaveLength(1);
    expect(s[1].toUpperCase()).toBe("SET TRANSACTION READ ONLY");
    expect(s).toContain("SET LOCAL statement_timeout = '45s'");
    expect(s).toContain("SET LOCAL lock_timeout = '3s'");
  });

  it("runs exactly one diagnostic SELECT and nothing else", () => {
    const s = stmts();
    expect(s.filter((x) => /^with\b/i.test(x))).toHaveLength(1);
    // BEGIN, SET TX, 2 timeouts, attestation, the SELECT, ROLLBACK
    expect(s).toHaveLength(7);
  });

  it("returns a single named JSONB column", () => {
    expect(withoutComments(sql())).toContain("migration_059_prerequisite_diagnostic_v1");
  });
});

describe("prerequisite diagnostic — read-only, no DDL or DML", () => {
  it("contains no DDL, DML or privilege statement", () => {
    expect(strippedCode(sql())).not.toMatch(
      /\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|savepoint|vacuum|copy|refresh|reindex|cluster|lock)\b/i
    );
  });

  it("declares itself read only and authorising nothing", () => {
    const w = withoutComments(sql());
    expect(w).toContain("'read_only', true");
    expect(w).toContain("'authorises_nothing', true");
  });

  it("mutates nothing: the only SET statements are transaction-local", () => {
    for (const s of stmts().filter((x) => /^SET\b/i.test(x))) {
      expect(s).toMatch(/^SET (TRANSACTION READ ONLY|LOCAL )/i);
    }
  });
});

describe("prerequisite diagnostic — identity", () => {
  it("embeds exactly one staging attestation, after BEGIN and before the query", () => {
    const s = stmts();
    const attest = s.filter((x) => /^SET LOCAL vam059\.attested_project_ref/i.test(x));
    expect(attest).toHaveLength(1);
    expect(attest[0]).toBe(ATTESTATION.replace(/;$/, ""));
    const iAttest = s.findIndex((x) => /^SET LOCAL vam059\.attested_project_ref/i.test(x));
    const iQuery = s.findIndex((x) => /^with\b/i.test(x));
    expect(iAttest).toBeGreaterThan(0);
    expect(iQuery).toBeGreaterThan(iAttest);
    expect(strippedCode(sql()).split("vam059.attested_project_ref =").length - 1).toBe(1);
  });

  it("rejects the forbidden production ref explicitly", () => {
    const w = withoutComments(sql());
    expect(w).toContain(`('${STAGING}', '${PRODUCTION}')`);
    expect(w).toContain("<> 'forbidden_production'");
    expect(w).not.toContain(`vam059.attested_project_ref = '${PRODUCTION}'`);
  });

  it("withholds all evidence unless identity resolves to the expected staging project", () => {
    const w = withoutComments(sql());
    expect(w).toContain("identity_ok as (");
    expect(w).toContain("= 'expected_staging'");
    expect(w).toContain("select case when (select v from identity_ok) then jsonb_build_object");
    expect(w).toContain("'refused', true");
    expect(w).toContain("'evidence_withheld', true");
  });

  it("requires the owner's visual dashboard check before execution", () => {
    const prose = sql()
      .split("\n")
      .filter((l) => l.startsWith("--"))
      .map((l) => l.replace(/^--\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(prose).toMatch(/ONE HUMAN CONTROL, IMMEDIATELY BEFORE YOU RUN THIS/);
    expect(prose).toMatch(/confirm the project ref reads exactly/i);
    expect(prose).toMatch(/run it exactly as committed/i);
    expect(prose).toContain(STAGING);
    expect(prose).toContain(PRODUCTION);
  });

  it("gives no instruction to edit or insert anything", () => {
    const prose = sql()
      .split("\n")
      .filter((l) => l.startsWith("--"))
      .map((l) => l.replace(/^--\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const forbidden of [/insert\s+(the|this|exactly|one|an?\b)/i, /\bedit\b/i, /hand-edit/i,
                             /\bmodify\b/i, /\bmanually\b/i, /by hand/i, /uncomment/i, /fill in/i]) {
      expect(prose).not.toMatch(forbidden);
    }
    expect(prose).toMatch(/no manual step/i);
  });
});

describe("prerequisite diagnostic — preserves the failing predicates as evidence", () => {
  const fkPredicate = flat(
    `select 1 from (values ('people'),('seasons'),('intake_batches'),('admin_users')) x(t)
     where not exists (
       select 1 from pg_constraint c
       where c.conrelid = to_regclass('public.' || x.t)
         and c.contype in ('p','u')
         and c.conkey = array[(
           select a.attnum from pg_attribute a
           where a.attrelid = c.conrelid and a.attname = 'id'
         )]
     )`
  );
  const fnPredicate = flat(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_admin_role'
       and pg_get_function_arguments(p.oid) = 'roles text[]'`
  );

  it("still carries both original predicates, so the diagnosis stays reproducible", () => {
    const diag = flat(withoutComments(sql()));
    expect(diag).toContain(fkPredicate);
    expect(diag).toContain(fnPredicate);
  });

  it("the owner preflight no longer contains either failing predicate", () => {
    // both were remediated: the FK check now scans pg_index, and the
    // is_admin_role dependency was removed with the three policies
    const pre = flat(withoutComments(read(OWNER_PREFLIGHT)));
    expect(pre).not.toContain(fkPredicate);
    expect(pre).not.toContain(fnPredicate);
    expect(pre).not.toContain("pg_get_function_arguments");
    expect(pre).not.toContain("prerequisite:is_admin_role_text_array");
  });

  it("reports both replicated results under their preflight assertion names", () => {
    const w = withoutComments(sql());
    expect(w).toContain("'replicated_assertions', jsonb_build_object");
    expect(w).toContain("'prerequisite:fk_targets_unique', (select fk_targets_unique from replicated)");
    expect(w).toContain("'prerequisite:is_admin_role_text_array', (select is_admin_role_text_array from replicated)");
  });
});

describe("prerequisite diagnostic — FK target evidence", () => {
  const w = () => withoutComments(sql());

  it("diagnoses all four FK targets independently", () => {
    const s = w();
    expect(s).toContain("fk_target(t) as (values ('people'),('seasons'),('intake_batches'),('admin_users'))");
    // per-target aggregation, not a single collapsed boolean
    expect(s).toContain("jsonb_object_agg(s.t, jsonb_build_object");
    expect(s).toContain("from fk_summary s");
  });

  it("reports the column facts required to judge a foreign-key target", () => {
    const s = w();
    for (const field of ["'table'", "'column'", "'data_type'", "'attnum'", "'not_null'",
                         "'table_present'", "'id_column_present'"]) {
      expect(s).toContain(field);
    }
    expect(s).toContain("format_type(a.atttypid, a.atttypmod)");
    expect(s).toContain("not a.attisdropped");
  });

  it("keeps the constraint path and the index path separate", () => {
    const s = w();
    expect(s).toContain("target_con as (");
    expect(s).toContain("target_idx as (");
    expect(s).toContain("'has_exact_single_column_unique_constraint'");
    expect(s).toContain("'has_fk_eligible_unique_index'");
    // the two verdicts are computed from different catalogs
    expect(s).toContain("join pg_constraint c on c.conrelid = tc.rel and c.contype in ('p','u')");
    expect(s).toContain("join pg_index i on i.indrelid = tc.rel");
  });

  it("distinguishes primary keys from unique constraints", () => {
    const s = w();
    expect(s).toContain("c.contype::text contype");
    expect(s).toContain("'is_primary', x.indisprimary");
    expect(s).toContain("'contype', c.contype");
  });

  it("emits every constraint field the diagnosis needs", () => {
    const s = w();
    for (const f of ["'name', c.conname", "'conkey', to_jsonb(c.conkey)", "'validated', c.convalidated",
                     "'deferrable', c.condeferrable", "'deferred', c.condeferred",
                     "'exact_single_column_on_id', c.exact_single_column_on_id"]) {
      expect(s).toContain(f);
    }
  });

  it("emits every index field the diagnosis needs", () => {
    const s = w();
    for (const f of ["'is_unique'", "'is_valid'", "'is_ready'", "'is_immediate'",
                     "'nkeyatts'", "'natts'", "'nulls_not_distinct'",
                     "'key_attnums'", "'key_columns'",
                     "'partial_predicate'", "'index_expression'", "'fk_eligible'"]) {
      expect(s).toContain(f);
    }
  });

  it("prevents partial, expression and composite indexes masquerading as single-column uniqueness", () => {
    const s = w();
    // every exclusion must be part of the fk_eligible predicate
    const start = s.indexOf("fk_eligible\n  from target_col tc");
    const region = s.slice(s.indexOf("(i.indisunique"), start > -1 ? start : undefined);
    expect(region).toContain("i.indisunique");
    expect(region).toContain("i.indisvalid");
    expect(region).toContain("i.indisready");
    expect(region).toContain("i.indimmediate");
    expect(region).toContain("i.indpred is null");
    expect(region).toContain("i.indexprs is null");
    expect(region).toContain("i.indnkeyatts = 1");
    expect(region).toContain("(string_to_array(i.indkey::text, ' ')::smallint[])[1] = tc.attnum");
  });

  it("surfaces expression keys rather than hiding them", () => {
    expect(w()).toContain("'<expression>'");
    expect(w()).toContain("pg_get_expr(i.indexprs, i.indrelid)");
    expect(w()).toContain("pg_get_expr(i.indpred, i.indrelid)");
  });

  it("requires an exact single-column constraint match, not merely containment", () => {
    expect(w()).toContain("c.conkey = array[tc.attnum]");
    expect(w()).not.toMatch(/conkey\s*@>/);
  });
});

describe("prerequisite diagnostic — is_admin_role evidence", () => {
  const w = () => withoutComments(sql());

  it("surfaces every overload in the public schema", () => {
    const s = w();
    expect(s).toContain("where n.nspname = 'public' and p.proname = 'is_admin_role'");
    expect(s).toContain("'overload_count', (select overload_count from fn_facts)");
    expect(s).toContain("select jsonb_agg(jsonb_build_object");
    expect(s).toContain("from fn f");
    // no argument filter that could hide an overload
    const start = s.indexOf("fn as (");
    const region = s.slice(start, s.indexOf("fn_facts as ("));
    expect(region).not.toMatch(/pg_get_function_arguments\(p\.oid\)\s*=/);
    expect(region).not.toMatch(/proargtypes\s*=/);
  });

  it("emits the full catalog signature of each overload", () => {
    const s = w();
    for (const f of ["'schema'", "'name'", "'oid'", "'prokind'",
                     "'identity_arguments'", "'declared_arguments'", "'arg_type_vector'",
                     "'arg_type_oids'", "'arg_type_names'", "'arg_names'", "'arg_modes'",
                     "'nargs'", "'ndefaults'", "'is_variadic'",
                     "'result_type'", "'return_type'", "'security_definer'", "'owner'"]) {
      expect(s).toContain(f);
    }
    expect(s).toContain("pg_get_function_identity_arguments(p.oid)");
    expect(s).toContain("pg_get_function_arguments(p.oid)");
    expect(s).toContain("oidvectortypes(p.proargtypes)");
  });

  it("evaluates the text[] identity robustly, not by parameter name", () => {
    const s = w();
    // callable identity, independent of what the parameter happens to be called
    expect(s).toContain("to_regprocedure('public.is_admin_role(text[])') is not null");
    expect(s).toContain("identity_arguments = 'text[]'");
    // and separately records the name-sensitive comparison the preflight used
    expect(s).toContain("declared_arguments = 'roles text[]'");
    expect(s).toContain("'exact_identity_exists'");
    expect(s).toContain("'identity_arguments_match_text_array'");
    expect(s).toContain("'declared_arguments_match_roles_text_array'");
  });

  it("does not dump function bodies", () => {
    const s = w();
    expect(s).not.toMatch(/pg_get_functiondef/);
    expect(s).not.toMatch(/\bp\.prosrc\b/);
  });
});

describe("prerequisite diagnostic — deterministic classification", () => {
  const w = () => withoutComments(sql());

  it("emits one of the three verdicts for each failure", () => {
    const s = w();
    for (const v of ["'ASSERTION_FALSE_NEGATIVE'", "'REAL_PREREQUISITE_MISMATCH'", "'AMBIGUOUS'"]) {
      expect(s).toContain(v);
    }
    expect(s).toContain("'classification', jsonb_build_object");
    expect(s).toContain("'prerequisite:fk_targets_unique', (select fk_targets_unique from classification)");
    expect(s).toContain("'prerequisite:is_admin_role_text_array', (select is_admin_role_text_array from classification)");
  });

  it("ranks a genuine mismatch ahead of a false negative for the FK check", () => {
    const s = w();
    const start = s.indexOf("classification as (");
    expect(start).toBeGreaterThan(-1);
    // the FK arm ends at its "end fk_targets_unique," label
    const region = s.slice(start, s.indexOf("end fk_targets_unique,", start));
    const realAt = region.indexOf("'REAL_PREREQUISITE_MISMATCH'");
    const falseAt = region.indexOf("'ASSERTION_FALSE_NEGATIVE'");
    expect(realAt).toBeGreaterThan(-1);
    expect(falseAt).toBeGreaterThan(realAt);
    // absence of a table or its id column outranks everything
    expect(region.indexOf("not table_present or not id_column_present")).toBeLessThan(falseAt);
  });

  it("calls the function failure a real mismatch only when the identity is not callable", () => {
    const s = w();
    expect(s).toContain("when not (select exact_identity_exists from fn_facts)");
    expect(s).toContain("when not (select declared_arguments_match from fn_facts)");
  });

  it("has no default branch that can pass by omission", () => {
    const s = w();
    const region = s.slice(s.indexOf("classification as ("), s.indexOf(")\n\nselect case"));
    expect((region.match(/else 'AMBIGUOUS'/g) ?? []).length).toBe(2);
  });
});

describe("prerequisite diagnostic — cannot expose data or credentials", () => {
  it("reads pg_catalog and information_schema only, never a business table", () => {
    const code = strippedCode(sql());
    expect(code).not.toMatch(/\bfrom\s+public\./i);
    expect(code).not.toMatch(/\bjoin\s+public\./i);
    for (const t of ["people", "seasons", "intake_batches", "admin_users", "programs",
                     "person_season_memberships", "applications", "application_answers"]) {
      expect(code).not.toMatch(new RegExp(`\\bfrom\\s+(public\\.)?${t}\\b`, "i"));
    }
  });

  it("counts no business rows", () => {
    const code = strippedCode(sql());
    expect(code).not.toMatch(/count\(\*\)\s*from\s+public/i);
    expect(withoutComments(sql())).toContain("'business_rows_read', 0");
  });

  it("emits only catalog identifiers, never a row value", () => {
    const w = withoutComments(sql());
    // nothing that could select arbitrary user columns
    expect(w).not.toMatch(/select\s+\*/i);
    expect(w).not.toMatch(/\bto_jsonb\(\s*[a-z_]+\.\*\s*\)/i);
    expect(w).not.toMatch(/\brow_to_json\b/i);
  });

  it("carries no credential, connection string or project key", () => {
    const s = sql();
    expect(s).not.toMatch(/postgres(ql)?:\/\//i);
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/password\s*[:=]/i);
    expect(s).not.toMatch(/(api[_-]?key|SERVICE_ROLE_KEY|ANON_KEY)/i);
  });

  it("never echoes a supplied identity value, only its class", () => {
    const w = withoutComments(sql());
    const out = w.slice(w.indexOf("select case when (select v from identity_ok)"));
    expect(out).not.toContain("from platform_ref");
    expect(out).not.toContain("from attested_ref");
    expect(out).toContain("'platform_class'");
    expect(out).toContain("'attested_class'");
  });
});

describe("prerequisite diagnostic — is itself immutable", () => {
  it("is unchanged since the commit that introduced it", () => {
    const r = spawnSync("git", [
      "diff", "--quiet", "0d239372d1cce5b0970b452cbe75f9c7bc39c86d", "--", DIAGNOSTIC,
    ]);
    expect(r.status).toBe(0);
  });

  it("still targets migration 059's dependencies", () => {
    expect(readFileSync(MIGRATION_059, "utf8")).toContain("public.people");
  });

  it("matches its reported SHA-256 over the committed bytes", () => {
    expect(createHash("sha256").update(sql(), "utf8").digest("hex")).toBe(
      "e4e60962a241bdee63b3167f3f90fdcaa137e3e70d2f7e206bb758d50f05f431"
    );
  });
});
