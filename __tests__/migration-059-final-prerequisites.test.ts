import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase_migrations/059_staging_application_workflow_bootstrap.sql";
const CANONICAL_PREFLIGHT = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_PREFLIGHT.sql";
const CANONICAL_VERIFIER = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_POST_APPLY_VERIFY.sql";
const OWNER_PREFLIGHT = "docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_PREFLIGHT_EXEC.sql";
const OWNER_VERIFIER = "docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_POST_APPLY_VERIFY_EXEC.sql";

const ALL_SQL = [MIGRATION, CANONICAL_PREFLIGHT, CANONICAL_VERIFIER, OWNER_PREFLIGHT, OWNER_VERIFIER];
const ARTIFACTS = [CANONICAL_PREFLIGHT, CANONICAL_VERIFIER, OWNER_PREFLIGHT, OWNER_VERIFIER];

const TABLES = [
  "applications",
  "application_answers",
  "application_reviews",
  "application_decisions",
  "review_assignment_batches",
];
const FK_TARGETS = ["people", "seasons", "intake_batches", "admin_users"];

const IMMUTABLE = [
  "supabase_migrations/038_s12_intake_foundation.sql",
  "supabase_migrations/060_align_application_interview_in_progress_status.sql",
  "supabase_migrations/061_design_only_recruitment_campaigns.sql",
  "supabase_migrations/062_review_only_account_admin_rls_foundation.sql",
  "supabase_migrations/063_review_only_membership_lifecycle_operations.sql",
];
const BASELINE = "b61c904ef4a789d8387f63b822c14797cc24d96c";

/** SHA-256 values the previous review cycle published. All now superseded. */
const OBSOLETE_SHA = [
  "a9d94db89ea85ff30cbd7e02ba25fa3286742c118cf4abe325fec897383f9eea",
  "7d32573702cc81db5ac92cb241b807f63ee3be7b12c642b5fdffa62a73555b3a",
  "31ac29756213345744e0913b3f5eef258a26988afca99f79862b5db93081faca",
  "130f97422bf248c8061314a4ee0e33eb8962335bab2b60ff5955eb0c8c70730d",
  "03cc77edcaed2f3e7d118d8d7329d2e813a7953d944e1ad74a44e6068a69d634",
  "c544541182ce947d8e292b661409d40baab289cb3de3bbb6097f9a1f2afb903c",
  "daa408f88cc6dc51fa825eec87dd77b060e695d46171574861f44273bc592192",
];

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const read = (p: string) => lf(readFileSync(p, "utf8"));
const gitUnchanged = (ref: string, p: string) =>
  spawnSync("git", ["diff", "--quiet", ref, "--", p]).status === 0;

/** Strip -- comments AND '...' literals. */
function stripped(sql: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { if (ch === "'") { if (sql[i + 1] === "'") i++; else inStr = false; } continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "-" && sql[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}

/** Strip -- comments, keep literals. */
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

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// ===========================================================================
// is_admin_role dependency is gone
// ===========================================================================

describe("migration 059 — no is_admin_role dependency remains", () => {
  it("never mentions is_admin_role in executable SQL or in prose", () => {
    const raw = read(MIGRATION);
    // the only permitted mentions are the two that say it is NOT depended on
    const mentions = raw.split("\n").filter((l) => l.includes("is_admin_role"));
    for (const l of mentions) expect(l.trimStart().startsWith("--")).toBe(true);
    expect(stripped(raw)).not.toMatch(/is_admin_role/);
  });

  it("has no DEPENDENCY_MISSING guard for the helper", () => {
    const w = withoutComments(read(MIGRATION));
    expect(w).not.toMatch(/pg_get_function_arguments/);
    expect(w).not.toMatch(/DEPENDENCY_MISSING[^;]*is_admin_role/);
  });

  it("neither creates nor replaces the helper, and adds no security-definer function", () => {
    const code = stripped(read(MIGRATION));
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(code).not.toMatch(/security\s+definer/i);
  });

  it("is absent from the preflight and the owner preflight packet as a prerequisite", () => {
    for (const f of [CANONICAL_PREFLIGHT, OWNER_PREFLIGHT]) {
      const w = withoutComments(read(f));
      expect(w).not.toContain("prerequisite:is_admin_role_text_array");
      expect(w).not.toContain("pg_get_function_arguments");
    }
  });
});

// ===========================================================================
// uniform five-table security contract
// ===========================================================================

describe("migration 059 — uniform five-table security contract", () => {
  const raw = () => read(MIGRATION);

  it("creates zero policies on any of the five tables", () => {
    const code = stripped(raw());
    expect(code).not.toMatch(/\bcreate\s+policy\b/i);
    expect(code).not.toMatch(/\bdrop\s+policy\b/i);
  });

  it("enables and forces RLS on each of the five", () => {
    const code = stripped(raw());
    for (const t of TABLES) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`, "i"));
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+FORCE\\s+ROW LEVEL SECURITY`, "i"));
    }
    expect(code).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(code).not.toMatch(/no\s+force\s+row\s+level\s+security/i);
  });

  it("revokes ALL from PUBLIC, anon and authenticated across all five", () => {
    const code = flat(stripped(raw()));
    const list = TABLES.map((t) => `public.${t}`).join(", ");
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(code).toContain(`REVOKE ALL ON TABLE ${list} FROM ${role};`);
    }
  });

  it("grants exactly the four DML privileges to service_role and nothing else", () => {
    const code = flat(stripped(raw()));
    const list = TABLES.map((t) => `public.${t}`).join(", ");
    expect(code).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${list} TO service_role;`);
    const grants = flat(stripped(raw())).match(/GRANT [^;]+;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).not.toMatch(/TRUNCATE|REFERENCES|TRIGGER|ALL/i);
    expect(grants[0]).not.toMatch(/\bto\s+(authenticated|anon|public)\b/i);
  });

  it("requires BYPASSRLS for the owner and for service_role", () => {
    const w = withoutComments(raw());
    expect(w).toMatch(/RLS_FORCE_UNSAFE/);
    expect(w).toMatch(/rolbypassrls[\s\S]{0,140}current_user/);
    expect(w).toMatch(/rolbypassrls[\s\S]{0,140}'service_role'/);
  });

  it("verifies the contract in-transaction for all five tables and fails closed", () => {
    const w = withoutComments(raw());
    for (const marker of ["POLICY_CONFLICT", "RLS_CONTRACT_VIOLATION", "GRANT_CONTRACT_VIOLATION"]) {
      expect(w).toContain(marker);
    }
    // the effective-privilege sweep must cover every privilege for both client roles
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(w).toContain(`('${p}')`);
    }
    expect(w).toContain("client role retains privilege");
    expect(w).toContain("service_role holds excluded privilege");
  });

  it("is still one transaction ending in COMMIT, writing no data", () => {
    const code = stripped(raw());
    // top-level only: plpgsql DO blocks also contain BEGIN/END
    expect((raw().match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((raw().match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect((raw().match(/^ROLLBACK;$/gm) ?? []).length).toBe(0);
    expect(code).not.toMatch(/\binsert\s+into\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
  });
});

describe("verifier — asserts the uniform contract for all five tables", () => {
  const w = () => withoutComments(read(CANONICAL_VERIFIER));

  it("expects RLS enabled and forced on every table", () => {
    const s = w();
    expect(s).toContain("relrowsecurity = rls and relforcerowsecurity = forced");
    // five expected_table rows, each ending "true, true)" (the last also closes
    // the VALUES list)
    expect((s.match(/^  true, true\)+,?$/gm) ?? []).length).toBe(5);
    expect(s).not.toMatch(/^  true, false\)/m);
  });

  it("expects zero policies, per table and overall", () => {
    const s = w();
    expect(s).toContain("'security:zero_policies'");
    expect(s).toContain("'security:zero_policies:' || t");
  });

  it("expects no privilege for anon or authenticated on any table", () => {
    const s = w();
    expect(s).toContain("'security:no_effective_privilege:'");
    expect(s).toContain("client_role(r) as (values ('anon'),('authenticated'))");
    expect(s).toContain("from secured_table s cross join client_role r");
  });

  it("expects exactly four DML privileges for service_role, and not the other three", () => {
    const s = w();
    expect(s).toContain("'security:service_role_exact_dml:' || t");
    for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(s).toContain(`not has_table_privilege('service_role', 'public.' || t, '${p}')`);
    }
    for (const t of TABLES) {
      expect(s).toContain(`('${t}', '{"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb)`);
    }
  });

  it("keeps every schema, inventory, empty-state, UEHM and compatibility assertion", () => {
    const s = w();
    for (const a of [
      "'columns:' || t", "'pk:' || e.t", "'fk:' || e.n", "'check_vocab:' || e.n",
      "'index:' || e.n", "'enum:' || e.n", "'inventory:no_unexpected_relation'",
      "'initial:empty:' || t", "'initial:uehm_s12_b1_linkage_intact'",
      "'compat:m062_functions_present'", "'compat:m063_functions_present'",
    ]) {
      expect(s).toContain(a);
    }
  });
});

// ===========================================================================
// corrected FK-target eligibility
// ===========================================================================

/**
 * The corrected predicate, mirrored from the committed SQL. A drift guard
 * below asserts each clause is present in every artifact that uses it, so this
 * mirror cannot silently diverge from what actually ships.
 */
type Index = {
  indisunique: boolean;
  indisvalid: boolean;
  indisready: boolean;
  indimmediate: boolean;
  indpred: string | null;
  indexprs: string | null;
  indnkeyatts: number;
  indkey: number[];
};

const ID_ATTNUM = 1;

const fkEligible = (i: Index) =>
  i.indisunique &&
  i.indisvalid &&
  i.indisready &&
  i.indimmediate &&
  i.indpred === null &&
  i.indexprs === null &&
  i.indnkeyatts === 1 &&
  i.indkey[0] === ID_ATTNUM;

const baseIndex = (): Index => ({
  indisunique: true,
  indisvalid: true,
  indisready: true,
  indimmediate: true,
  indpred: null,
  indexprs: null,
  indnkeyatts: 1,
  indkey: [ID_ATTNUM],
});

describe("FK eligibility — the confirmed staging catalog qualifies", () => {
  it("accepts a primary-key index on id", () => {
    expect(fkEligible({ ...baseIndex() })).toBe(true);
  });

  it("accepts admin_users_id_unique_idx: a bare single-column unique index", () => {
    // the diagnostic confirmed admin_users.id is backed by a unique index with
    // no pg_constraint row; the old constraint-only predicate rejected it
    expect(fkEligible({ ...baseIndex() })).toBe(true);
  });

  it("accepts a unique index carrying INCLUDE columns beyond the key", () => {
    expect(fkEligible({ ...baseIndex(), indnkeyatts: 1, indkey: [ID_ATTNUM, 5] })).toBe(true);
  });

  it("would classify all four confirmed targets as eligible", () => {
    for (const _ of FK_TARGETS) expect(fkEligible({ ...baseIndex() })).toBe(true);
  });
});

describe("FK eligibility — ineligible indexes are rejected", () => {
  const cases: Array<[string, Index]> = [
    ["non-unique index", { ...baseIndex(), indisunique: false }],
    ["invalid index", { ...baseIndex(), indisvalid: false }],
    ["not-ready index", { ...baseIndex(), indisready: false }],
    ["non-immediate (deferrable) index", { ...baseIndex(), indimmediate: false }],
    ["partial index", { ...baseIndex(), indpred: "(status = 'active'::text)" }],
    ["expression index", { ...baseIndex(), indexprs: "lower(id)", indkey: [0] }],
    ["composite index leading with id", { ...baseIndex(), indnkeyatts: 2, indkey: [ID_ATTNUM, 4] }],
    ["composite index containing id", { ...baseIndex(), indnkeyatts: 2, indkey: [4, ID_ATTNUM] }],
    ["unique index on a different column", { ...baseIndex(), indkey: [7] }],
  ];

  it.each(cases)("rejects a %s", (_name, idx) => {
    expect(fkEligible(idx)).toBe(false);
  });

  it("rejects an index that fails only one clause at a time", () => {
    // each clause is load-bearing on its own
    for (const [, idx] of cases) expect(fkEligible(idx)).toBe(false);
    expect(fkEligible(baseIndex())).toBe(true);
  });
});

describe("FK eligibility — the same predicate ships everywhere", () => {
  const CLAUSES = [
    "i.indisunique",
    "i.indisvalid",
    "i.indisready",
    "i.indimmediate",
    "i.indpred is null",
    "i.indexprs is null",
    "i.indnkeyatts = 1",
    "(string_to_array(i.indkey::text, ' ')::smallint[])[1] = a.attnum",
  ];

  it.each([MIGRATION, CANONICAL_PREFLIGHT, OWNER_PREFLIGHT])("%s carries every clause", (f) => {
    const s = withoutComments(read(f)).toLowerCase();
    for (const c of CLAUSES) expect(s).toContain(c.toLowerCase());
  });

  it("names all four required targets in each", () => {
    for (const f of [MIGRATION, CANONICAL_PREFLIGHT, OWNER_PREFLIGHT]) {
      const s = withoutComments(read(f));
      for (const t of FK_TARGETS) expect(s).toContain(`('${t}')`);
    }
  });

  it("no longer uses the constraint-only predicate anywhere", () => {
    for (const f of ALL_SQL) {
      const s = flat(withoutComments(read(f)));
      expect(s).not.toContain("c.contype in ('p','u') and c.conkey = array[(");
    }
  });

  it("the migration aborts with FK_TARGET_NOT_UNIQUE rather than failing mid-apply", () => {
    expect(withoutComments(read(MIGRATION))).toContain("FK_TARGET_NOT_UNIQUE");
  });
});

// ===========================================================================
// owner packets stay standalone and immutable
// ===========================================================================

describe("owner packets — regenerated, still standalone", () => {
  const ATTESTATION = "SET LOCAL vam059.attested_project_ref = 'ljfneyuvpxrmejpxsmpz';";

  it.each([OWNER_PREFLIGHT, OWNER_VERIFIER])("%s keeps its one-transaction shape", (p) => {
    const s = read(p);
    expect((s.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((s.match(/^ROLLBACK;$/gm) ?? []).length).toBe(1);
    expect((s.match(/^COMMIT;$/gm) ?? []).length).toBe(0);
    expect((s.match(/^SET TRANSACTION READ ONLY;$/gm) ?? []).length).toBe(1);
    // exactly one EXECUTABLE attestation; documentation comments may quote it.
    // stripped() also removes literals, so match on the setting name.
    expect(stripped(s).split("vam059.attested_project_ref =").length - 1).toBe(1);
    expect(s).toContain(ATTESTATION);
  });

  it.each([OWNER_PREFLIGHT, OWNER_VERIFIER])("%s reflects the new contract", (p) => {
    const w = withoutComments(read(p));
    expect(w).not.toContain("prerequisite:is_admin_role_text_array");
    expect(w).not.toContain("is_admin_role(ARRAY[");
    expect(w).not.toContain("pg_get_function_arguments");
    // the three retired policy names may still appear ONLY as conflict-check
    // targets: their names must stay free, which is the opposite of expecting
    // them to exist
    for (const n of ["application_reviews_read", "application_decisions_read",
                     "review_assignment_batches_read"]) {
      for (const line of w.split("\n").filter((l) => l.includes(n))) {
        expect(line).toMatch(/^\s*\('[a-z_]+'\),?\('?|target_policy|^\s*\('[a-z_]+'\)/);
      }
    }
  });

  it("publishes hashes distinct from every superseded value", () => {
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    for (const p of ARTIFACTS) {
      const h = createHash("sha256").update(read(p), "utf8").digest("hex");
      expect(OBSOLETE_SHA).not.toContain(h);
    }
  });
});

// ===========================================================================
// server-only application access
// ===========================================================================

describe("application workflow access is server-only", () => {
  it("declares exactly the five migration-059 tables as server-only", () => {
    // read from source rather than imported: lib/data.ts pulls in `server-only`,
    // which has no resolution under the test runner
    const src = read("lib/data.ts");
    const block = /export const SERVER_ONLY_APPLICATION_TABLES = \[([\s\S]*?)\] as const;/.exec(src)?.[1];
    expect(block).toBeDefined();
    const declared = Array.from(block!.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    expect(declared).toEqual(TABLES);
    expect(src).toContain("const SERVER_ONLY_TABLE_SET: ReadonlySet<string> = new Set(SERVER_ONLY_APPLICATION_TABLES);");
    expect(src).toContain("export function isServerOnlyApplicationTable(table: string) {");
    expect(src).toContain("return SERVER_ONLY_TABLE_SET.has(table);");
    // tables that legitimately keep the permissive client chain
    for (const t of ["people", "seasons", "admin_users", "programs"]) {
      expect(declared).not.toContain(t);
    }
  });

  it("never falls back to the cookie or anon client for a server-only table", () => {
    const src = read("lib/data.ts");
    const fn = /function dataClient\(table\?: string\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toContain("if (table && isServerOnlyApplicationTable(table)) return serviceRole ?? null;");
    // the permissive chain remains only for non-server-only tables
    expect(fn).toContain("return serviceRole ?? (await getSupabaseServerClient()) ?? supabase;");
  });

  it("routes every five-table read through the table-aware client", () => {
    const src = read("lib/data.ts");
    for (const t of TABLES) {
      const re = new RegExp(`const client = dataClient\\(\\);[\\s\\S]{0,400}?\\.from\\("${t}"`, "g");
      expect(src).not.toMatch(re);
    }
  });

  it("fails closed with an explicit service-role error rather than empty data", () => {
    const src = read("lib/data.ts");
    expect(src).toContain("export function serviceRoleRequiredError");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect((src.match(/serviceRoleRequiredError[<(]/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("keeps the dedicated workflow modules on the service-role client", () => {
    for (const f of [
      "lib/applications-create.ts",
      "lib/application-approvals.ts",
      "lib/application-decisions.ts",
      "lib/application-reviews.ts",
      "lib/bulk-assignment.ts",
      "lib/interview-claim.ts",
      "lib/portfolio.ts",
    ]) {
      const src = read(f);
      expect(src).toContain("getSupabaseServiceRoleClient");
      expect(src).not.toMatch(/getSupabaseServerClient\s*\(\)\s*\?\?/);
    }
  });
});

// ===========================================================================
// immutability
// ===========================================================================

describe("migration immutability", () => {
  it.each(IMMUTABLE)("leaves %s byte-identical to the baseline", (p) => {
    expect(gitUnchanged(BASELINE, p)).toBe(true);
  });

  it("changes only migration 059 under supabase_migrations/", () => {
    const r = spawnSync("git", ["diff", "--name-only", BASELINE, "--", "supabase_migrations/"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual([MIGRATION]);
  });
});
