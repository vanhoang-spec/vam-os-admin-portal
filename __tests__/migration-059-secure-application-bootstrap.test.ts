import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const M059 = "supabase_migrations/059_staging_application_workflow_bootstrap.sql";
const PREFLIGHT = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_PREFLIGHT.sql";
const VERIFIER = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_POST_APPLY_VERIFY.sql";
const PROBE_MANIFEST = "docs/audits/sql/design_only/VAM_OS_MIGRATION_059_POSTGREST_SECURITY_PROBE.sql";
const PROBE_SCRIPT = "scripts/application-bootstrap-postgrest-probe.mjs";

const IMMUTABLE = [
  "supabase_migrations/038_s12_intake_foundation.sql",
  "supabase_migrations/060_align_application_interview_in_progress_status.sql",
  "supabase_migrations/061_design_only_recruitment_campaigns.sql",
  "supabase_migrations/062_review_only_account_admin_rls_foundation.sql",
  "supabase_migrations/063_review_only_membership_lifecycle_operations.sql",
];
const BASELINE_HEAD = "b61c904ef4a789d8387f63b822c14797cc24d96c";

const PII_TABLES = ["applications", "application_answers"];
const WORKFLOW_TABLES = [
  "application_reviews",
  "application_decisions",
  "review_assignment_batches",
];
const ALL_TABLES = [...PII_TABLES, ...WORKFLOW_TABLES];
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const ALL_PRIVS = [...DML, "TRUNCATE", "REFERENCES", "TRIGGER"];

const read = (p: string) => readFileSync(p, "utf8");
const gitShow = (ref: string, p: string) => {
  const r = spawnSync("git", ["show", `${ref}:${p}`], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return r.stdout;
};
/**
 * git show emits blob bytes (LF); core.autocrlf=true checks some of these
 * files out with CRLF. Content comparisons therefore normalise line endings,
 * and the authoritative "unchanged in the committed tree" proof is
 * gitUnchanged() below, which asks git itself.
 */
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const gitUnchanged = (ref: string, p: string) =>
  spawnSync("git", ["diff", "--quiet", ref, "--", p]).status === 0;

/** Strip -- comments AND '...' literals. For statement/DDL scans. */
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

/** Strip -- comments but KEEP literals. For assertion-text checks. */
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

/**
 * Split into top-level statements, honouring -- comments, '...' literals and
 * $tag$...$tag$ dollar quoting (migration 059 wraps every guard in a DO $$).
 */
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

/**
 * Replay every top-level GRANT/REVOKE in file order into an explicit
 * privilege model. This is a real evaluation of the statements, not a
 * substring scan: order matters, REVOKE ALL clears, later GRANTs re-add.
 */
type PrivModel = {
  granted: Map<string, Map<string, Set<string>>>;
  revokedAll: Map<string, Set<string>>;
};

function privilegeModel(sql: string): PrivModel {
  const granted = new Map<string, Map<string, Set<string>>>();
  const revokedAll = new Map<string, Set<string>>();
  const forTable = (t: string) => {
    if (!granted.has(t)) granted.set(t, new Map());
    return granted.get(t)!;
  };

  for (const raw of statements(sql)) {
    const s = flat(raw);
    const m = /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(?:TABLE\s+)?(.+?)\s+(?:TO|FROM)\s+(.+)$/i.exec(s);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const privs = m[2]
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .flatMap((p) => (p === "ALL" || p === "ALL PRIVILEGES" ? ALL_PRIVS : [p]));
    const tables = m[3].split(",").map((t) => t.trim().replace(/^public\./i, ""));
    const roles = m[4].split(",").map((r) => r.trim().toLowerCase());

    for (const t of tables) {
      const byRole = forTable(t);
      for (const r of roles) {
        if (!byRole.has(r)) byRole.set(r, new Set());
        const set = byRole.get(r)!;
        if (kind === "GRANT") {
          for (const p of privs) set.add(p);
        } else {
          for (const p of privs) set.delete(p);
          if (m[2].trim().toUpperCase().startsWith("ALL")) {
            if (!revokedAll.has(t)) revokedAll.set(t, new Set());
            revokedAll.get(t)!.add(r);
          }
        }
      }
    }
  }
  return { granted, revokedAll };
}

const privsOf = (model: PrivModel, table: string, role: string) =>
  Array.from(model.granted.get(table)?.get(role) ?? new Set<string>()).sort();

/** Replay ALTER TABLE ... ROW LEVEL SECURITY into an RLS model. */
function rlsModel(sql: string) {
  const state = new Map<string, { enabled: boolean; forced: boolean; disabled: boolean }>();
  for (const raw of statements(sql)) {
    const m = /^ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY$/i
      .exec(flat(raw));
    if (!m) continue;
    const t = m[1];
    if (!state.has(t)) state.set(t, { enabled: false, forced: false, disabled: false });
    const s = state.get(t)!;
    const verb = m[2].toUpperCase().replace(/\s+/g, " ");
    if (verb === "ENABLE") s.enabled = true;
    if (verb === "DISABLE") { s.enabled = false; s.disabled = true; }
    if (verb === "FORCE") s.forced = true;
    if (verb === "NO FORCE") s.forced = false;
  }
  return state;
}

/** Every CREATE POLICY in the file, as [policyName, tableName]. */
function policies(sql: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const raw of statements(sql)) {
    const m = /^CREATE\s+POLICY\s+"?([A-Za-z0-9_]+)"?\s+ON\s+(?:public\.)?(\w+)/i.exec(flat(raw));
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

const migration = () => read(M059);

// ---------------------------------------------------------------------------

describe("migration 059 — RLS is no longer disabled on the PII tables", () => {
  const rls = rlsModel(migration());

  it.each(PII_TABLES)("enables row level security on %s", (t) => {
    expect(rls.get(t)?.enabled).toBe(true);
  });

  it.each(PII_TABLES)("forces row level security on %s", (t) => {
    expect(rls.get(t)?.forced).toBe(true);
  });

  it.each(PII_TABLES)("never disables row level security on %s", (t) => {
    expect(rls.get(t)?.disabled).toBe(false);
  });

  it("contains no DISABLE ROW LEVEL SECURITY statement at all", () => {
    expect(stripped(migration())).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(stripped(migration())).not.toMatch(/no\s+force\s+row\s+level\s+security/i);
  });

  it("no longer documents the PII tables as RLS-disabled", () => {
    // the pre-amendment file asserted RLS was intentionally kept off
    expect(migration()).not.toMatch(/kept disabled/i);
    expect(migration()).not.toMatch(/RLS:\s*disabled/i);
    expect(migration()).not.toMatch(/RLS is disabled on applications/i);
  });

  it("keeps the three review workflow tables RLS-enabled and not forced", () => {
    for (const t of WORKFLOW_TABLES) {
      expect(rls.get(t)?.enabled).toBe(true);
      expect(rls.get(t)?.forced).toBe(false);
      expect(rls.get(t)?.disabled).toBe(false);
    }
  });
});

describe("migration 059 — explicit privilege contract on the PII tables", () => {
  const model = privilegeModel(migration());

  it.each(PII_TABLES)("explicitly revokes ALL from PUBLIC on %s", (t) => {
    expect(model.revokedAll.get(t)?.has("public")).toBe(true);
    expect(privsOf(model, t, "public")).toEqual([]);
  });

  it.each(PII_TABLES)("explicitly revokes ALL from anon on %s", (t) => {
    expect(model.revokedAll.get(t)?.has("anon")).toBe(true);
    expect(privsOf(model, t, "anon")).toEqual([]);
  });

  it.each(PII_TABLES)("explicitly revokes ALL from authenticated on %s", (t) => {
    expect(model.revokedAll.get(t)?.has("authenticated")).toBe(true);
    expect(privsOf(model, t, "authenticated")).toEqual([]);
  });

  it.each(PII_TABLES)("grants service_role exactly SELECT/INSERT/UPDATE/DELETE on %s", (t) => {
    expect(privsOf(model, t, "service_role")).toEqual([...DML].sort());
  });

  it.each(PII_TABLES)("never grants TRUNCATE on %s to anyone", (t) => {
    for (const set of Array.from(model.granted.get(t)!.values())) {
      expect(set.has("TRUNCATE")).toBe(false);
    }
  });

  it("grants no privilege to any role other than service_role on the PII tables", () => {
    for (const t of PII_TABLES) {
      const holders = Array.from(model.granted.get(t)!.entries())
        .filter(([, set]) => set.size > 0)
        .map(([role]) => role);
      expect(holders).toEqual(["service_role"]);
    }
  });

  it("grants no ownership or schema-management privilege", () => {
    const code = stripped(migration());
    expect(code).not.toMatch(/\balter\s+table\s+\S+\s+owner\s+to\b/i);
    expect(code).not.toMatch(/\bgrant\b[^;]*\b(all\s+privileges\s+on\s+schema|create)\b[^;]*\bon\s+schema\b/i);
    expect(code).not.toMatch(/\bgrant\b[^;]*\bwith\s+grant\s+option\b/i);
  });
});

describe("migration 059 — review workflow tables are not broadened", () => {
  const model = privilegeModel(migration());

  it.each(WORKFLOW_TABLES)("revokes ALL from anon on %s", (t) => {
    expect(model.revokedAll.get(t)?.has("anon")).toBe(true);
    expect(privsOf(model, t, "anon")).toEqual([]);
  });

  it.each(WORKFLOW_TABLES)("leaves authenticated with SELECT only on %s", (t) => {
    expect(privsOf(model, t, "authenticated")).toEqual(["SELECT"]);
  });

  it.each(WORKFLOW_TABLES)("gives service_role exactly the four DML privileges on %s", (t) => {
    expect(privsOf(model, t, "service_role")).toEqual([...DML].sort());
  });

  it("revokes ALL from PUBLIC on every one of the five tables", () => {
    for (const t of ALL_TABLES) expect(model.revokedAll.get(t)?.has("public")).toBe(true);
  });
});

describe("migration 059 — no permissive application PII policy remains", () => {
  const created = policies(migration());

  it("creates no policy on applications or application_answers", () => {
    expect(created.filter(([, t]) => PII_TABLES.includes(t))).toEqual([]);
  });

  it("no longer creates read_applications_review_roles", () => {
    expect(created.map(([n]) => n)).not.toContain("read_applications_review_roles");
    expect(stripped(migration())).not.toMatch(/create\s+policy\s+"?read_applications_review_roles/i);
  });

  it("creates exactly the three intended review workflow read policies", () => {
    expect(created.sort()).toEqual([
      ["application_decisions_read", "application_decisions"],
      ["application_reviews_read", "application_reviews"],
      ["review_assignment_batches_read", "review_assignment_batches"],
    ].sort());
  });

  it("guards at COMMIT time that no policy exists on either PII table", () => {
    const w = withoutComments(migration());
    expect(w).toMatch(/POLICY_CONFLICT/);
    expect(w).toMatch(/tablename\s+IN\s+\('applications',\s*'application_answers'\)/i);
  });
});

describe("migration 059 — fail-closed preconditions and self-verification", () => {
  const w = withoutComments(migration());

  it("aborts when anon, authenticated or service_role is missing", () => {
    expect(w).toMatch(/ROLE_MISSING/);
    for (const r of ["anon", "authenticated", "service_role"]) {
      expect(w).toMatch(new RegExp(`\\('${r}'\\)`));
    }
  });

  it("aborts unless the owner and service_role bypass RLS, preserving owner behaviour", () => {
    expect(w).toMatch(/RLS_FORCE_UNSAFE/);
    expect(w).toMatch(/rolbypassrls[\s\S]{0,120}current_user/);
    expect(w).toMatch(/rolbypassrls[\s\S]{0,120}'service_role'/);
  });

  it("aborts when is_admin_role(text[]) is absent", () => {
    expect(w).toMatch(/DEPENDENCY_MISSING[\s\S]{0,400}is_admin_role/);
    expect(w).toMatch(/pg_get_function_arguments\(p\.oid\)\s*=\s*'roles text\[\]'/);
  });

  it("re-verifies the RLS and grant contract before COMMIT", () => {
    expect(w).toMatch(/RLS_CONTRACT_VIOLATION/);
    expect(w).toMatch(/GRANT_CONTRACT_VIOLATION/);
    expect(w).toMatch(/aclexplode/);
    // grantee 0 is PUBLIC; the guard must resolve it rather than skip it
    expect(w).toMatch(/NULLIF\(a\.grantee,\s*0\)/i);
  });

  it("is a single transaction that ends in COMMIT", () => {
    const s = statements(migration()).map((x) => flat(x).toUpperCase());
    expect(s.filter((x) => x === "BEGIN")).toHaveLength(1);
    expect(s.filter((x) => x === "COMMIT")).toHaveLength(1);
    expect(s[0]).toBe("BEGIN");
    expect(s[s.length - 1]).toBe("COMMIT");
    expect(s).not.toContain("ROLLBACK");
  });

  it("still writes no data", () => {
    const code = stripped(migration());
    expect(code).not.toMatch(/\binsert\s+into\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+table\b/i);
  });
});

describe("migration 059 — schema contract preserved", () => {
  const base = gitShow(BASELINE_HEAD, M059);
  const now = migration();

  it("keeps all five CREATE TABLE statements unchanged", () => {
    const creates = (sql: string) =>
      statements(sql)
        .filter((s) => /^CREATE\s+TABLE\s/i.test(flat(s)))
        .map(flat);
    expect(creates(now)).toEqual(creates(base));
  });

  it("keeps every CREATE INDEX statement unchanged", () => {
    const idx = (sql: string) =>
      statements(sql)
        .filter((s) => /^CREATE\s+(UNIQUE\s+)?INDEX\s/i.test(flat(s)))
        .map(flat)
        .sort();
    expect(idx(now)).toEqual(idx(base));
  });

  it("keeps the two enum definitions and the 20-value status list unchanged", () => {
    for (const frag of [
      "'mentor', 'mentee', 'supporter', 'speaker',",
      "'partner_contact', 'donor', 'admin'",
      "'accepted', 'rejected_or_pending', 'rejected', 'pending', 'withdrawn'",
    ]) {
      expect(now).toContain(frag);
    }
    const statusList = /CONSTRAINT applications_status_check CHECK \(([\s\S]*?)\n  \)/.exec(now);
    expect(statusList).not.toBeNull();
    expect((statusList![1].match(/'/g) ?? []).length / 2).toBe(20);
    expect(statusList![1]).toContain("'interview_in_progress'");
  });

  it("keeps the deferrable foreign keys unchanged", () => {
    for (const frag of [
      "REFERENCES public.people(id)\n    ON DELETE SET NULL\n    DEFERRABLE INITIALLY DEFERRED",
      "REFERENCES public.seasons(id)\n    ON DELETE SET NULL\n    DEFERRABLE INITIALLY DEFERRED",
      "REFERENCES public.applications(id)\n    ON DELETE CASCADE\n    DEFERRABLE INITIALLY DEFERRED",
    ]) {
      expect(lf(now)).toContain(frag);
    }
  });

  it("keeps the assignment_batch_id follow-up FK unchanged", () => {
    expect(flat(now)).toContain(
      "ALTER TABLE public.application_reviews ADD CONSTRAINT application_reviews_assignment_batch_id_fkey FOREIGN KEY (assignment_batch_id) REFERENCES public.review_assignment_batches(id)"
    );
  });
});

describe("migration 059 — nothing else is bundled or chained", () => {
  const now = migration();
  const code = stripped(now);

  it("does not reference migration 038 as a follow-on", () => {
    // no executable dependency on 038 or on the column that permanently
    // excludes it
    expect(code).not.toMatch(/\b038\b/);
    expect(code).not.toMatch(/seasons\.status/);
    // and every textual mention names it as excluded, never as required
    const mentions = lf(now).split("\n").filter((l) => /\b038\b/.test(l));
    expect(mentions.length).toBeGreaterThan(0);
    for (const l of mentions) expect(l).toMatch(/excluded|not bundled|not required/i);
    expect(lf(now)).toMatch(/migration 038, which is permanently excluded/);
  });

  it("does not bundle migration 060 content", () => {
    // 060 exists only to ALTER an existing applications_status_check
    expect(code).not.toMatch(/alter\s+table\s+(public\.)?applications\s+(drop|add)\s+constraint/i);
    expect(now).not.toMatch(/migration\s+060\s+aligns/i);
    expect(now).not.toMatch(/See migration 060/i);
  });

  it("does not bundle migration 061 content", () => {
    for (const marker of [
      "recruitment_campaigns",
      "recruitment_campaign_id",
      "validate_recruitment_campaign_scope",
      "validate_application_campaign_scope",
      "applications_campaign_scope_guard",
    ]) {
      expect(now).not.toContain(marker);
    }
  });

  it("declares 060/061/038 as out of scope rather than required", () => {
    expect(now).toMatch(/migration 060 is unnecessary/i);
    expect(now).toMatch(/NOT bundled, referenced, or required as a follow-on/i);
  });

  it("touches none of the other migration files", () => {
    for (const p of IMMUTABLE) expect(gitUnchanged(BASELINE_HEAD, p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("migration 059 preflight — read-only shape and safety", () => {
  const pre = () => read(PREFLIGHT);

  it("opens a read-only transaction with bounded statement and lock timeouts", () => {
    const s = statements(pre()).map(flat);
    expect(s[0]).toBe("BEGIN");
    expect(s[1].toUpperCase()).toBe("SET TRANSACTION READ ONLY");
    expect(s.some((x) => /^SET\s+LOCAL\s+statement_timeout\s*=\s*'\d+s'$/i.test(x))).toBe(true);
    expect(s.some((x) => /^SET\s+LOCAL\s+lock_timeout\s*=\s*'\d+s'$/i.test(x))).toBe(true);
    expect(s[s.length - 1].toUpperCase()).toBe("ROLLBACK");
  });

  it("is always terminated by ROLLBACK and never commits", () => {
    const s = statements(pre()).map((x) => flat(x).toUpperCase());
    expect(s.filter((x) => x === "ROLLBACK")).toHaveLength(1);
    expect(s).not.toContain("COMMIT");
  });

  it("contains no DDL and no DML", () => {
    const code = stripped(pre());
    expect(code).not.toMatch(/\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|savepoint|vacuum|copy)\b/i);
  });

  it("asserts transaction_read_only is on", () => {
    expect(withoutComments(pre())).toContain("current_setting('transaction_read_only') = 'on'");
  });

  it("emits every required output field and fails closed", () => {
    const w = withoutComments(pre());
    for (const f of ["'overall_status'", "'eligible'", "'failureCount'", "'failed_assertions'", "'read_only'"]) {
      expect(w).toContain(f);
    }
    expect(w).toContain("'eligible', bool_and(status = 'PASS')");
    expect(w).toContain("'overall_status', case when bool_and(status = 'PASS') then 'PASS' else 'FAIL' end");
    expect(w).toContain("'failureCount', count(*) filter (where status <> 'PASS')");
    expect(w).toContain("'failed_assertions', coalesce(jsonb_agg(assertion order by assertion) filter (where status <> 'PASS'), '[]'::jsonb)");
  });

  it("carries no credential or connection string", () => {
    const s = pre();
    expect(s).not.toMatch(/postgres(ql)?:\/\//i);
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/password\s*[:=]/i);
    expect(s).not.toMatch(/(api[_-]?key|SERVICE_ROLE_KEY|ANON_KEY)/i);
  });
});

describe("migration 059 preflight — environment identification", () => {
  const w = () => withoutComments(read(PREFLIGHT));

  it("names the expected staging ref and the forbidden production ref", () => {
    expect(w()).toContain("('ljfneyuvpxrmejpxsmpz', 'qkkroesfiazsejkzflcd')");
    expect(w()).toContain("'expected_staging_ref'");
    expect(w()).toContain("'forbidden_production_ref'");
  });

  it("fails when an exposed ref is not the expected staging ref", () => {
    expect(w()).toContain("'env:project_ref_is_expected_staging'");
    expect(w()).toContain("'env:project_ref_is_not_forbidden_production'");
  });

  it("keeps a structural production discriminator that does not rely on the ref", () => {
    expect(w()).toContain("'env:not_production_topology'");
  });

  it("still requires independent owner verification of the dashboard ref", () => {
    expect(w()).toContain("'owner_must_verify_project_ref', true");
  });
});

describe("migration 059 preflight — prerequisites, conflicts, enums, evidence", () => {
  const w = () => withoutComments(read(PREFLIGHT));

  it("asserts every target table is absent", () => {
    expect(w()).toContain("'conflict:table_absent:' || t");
    for (const t of ALL_TABLES) expect(w()).toContain(`('${t}')`);
  });

  it("asserts every conflicting object class is free", () => {
    for (const a of [
      "'conflict:relation_name_free'",
      "'conflict:index_name_free'",
      "'conflict:constraint_name_free'",
      "'conflict:policy_name_free'",
      "'conflict:trigger_name_free'",
      "'conflict:function_name_free'",
    ]) {
      expect(w()).toContain(a);
    }
  });

  it("enumerates the real index, constraint, policy, trigger and function names 059 would claim", () => {
    const s = w();
    for (const n of [
      "applications_dedup_idx",
      "idx_applications_legacy_application_temp_id",
      "application_reviews_assignment_batch_idx",
      "idx_application_reviews_claim_source",
      "applications_status_check",
      "application_reviews_recommendation_check",
      "read_applications_review_roles",
      "application_reviews_read",
      "applications_campaign_scope_guard",
      "validate_application_campaign_scope",
    ]) {
      expect(s).toContain(n);
    }
  });

  it("asserts every prerequisite object and its structural compatibility", () => {
    const s = w();
    expect(s).toContain("'prerequisite:table:' || t");
    for (const t of ["people", "programs", "seasons", "intake_batches", "admin_users"]) {
      expect(s).toContain(`('${t}')`);
    }
    expect(s).toContain("'prerequisite:is_admin_role_text_array'");
    expect(s).toContain("'prerequisite:fk_targets_unique'");
    for (const t of ["people", "seasons", "intake_batches", "admin_users"]) {
      expect(s).toContain(`'prerequisite:${t}_id_uuid'`);
    }
  });

  it("asserts the required catalog data", () => {
    const s = w();
    for (const a of [
      "'catalog:uehm_program_exists'",
      "'catalog:uehm_program_active'",
      "'catalog:uehm_s12_belongs_to_uehm'",
      "'catalog:uehm_s12_b1_belongs_to_uehm_s12'",
      "'catalog:uehm_s12_b1_active'",
    ]) {
      expect(s).toContain(a);
    }
    expect(s).toContain("s.code = 'UEHM-S12'");
    expect(s).toContain("b.code = 'UEHM-S12-B1'");
    expect(s).toContain("p.code = 'UEHM'");
  });

  it("accepts each enum only when absent or exactly equal in value and order", () => {
    const s = w();
    expect(s).toContain("'enum:role_type_absent_or_exact'");
    expect(s).toContain("'enum:application_status_absent_or_exact'");
    expect(s).toContain("array['mentor','mentee','supporter','speaker','partner_contact','donor','admin']");
    expect(s).toContain("array['accepted','rejected_or_pending','rejected','pending','withdrawn']");
    // ordered comparison: enumsortorder, not a sorted set
    expect(s).toContain("order by e.enumsortorder");
  });

  it("reports default-privilege evidence without scoring it", () => {
    const s = w();
    expect(s).toContain("'public_schema_privileges'");
    expect(s).toContain("'default_acls_for_new_public_tables'");
    expect(s).toContain("'inherited_privileges_for_new_public_tables'");
    expect(s).toContain("pg_default_acl");
    // evidence must sit outside the scored assertion set
    expect(/assertions as \(([\s\S]*?)\n\),\nnormalized as/.exec(s)?.[1] ?? "").not.toContain("pg_default_acl");
  });

  it("makes eligibility depend on the amended migration's own preconditions", () => {
    const s = w();
    for (const a of [
      "'safety:grant_roles_present'",
      "'safety:owner_bypassrls'",
      "'safety:service_role_bypassrls'",
      "'safety:owner_can_create_in_public'",
    ]) {
      expect(s).toContain(a);
    }
  });

  it("reasserts the migration 062 and 063 release guarantees", () => {
    const s = w();
    for (const a of [
      "'release:m062_functions_present'",
      "'release:m062_policies_present'",
      "'release:m062_membership_rls_enabled'",
      "'release:m062_scope_arbiter_intact'",
      "'release:m063_functions_present'",
      "'release:m063_lifecycle_entrypoints_intact'",
    ]) {
      expect(s).toContain(a);
    }
  });
});

// ---------------------------------------------------------------------------

describe("migration 059 verifier — read-only shape", () => {
  const v = () => read(VERIFIER);

  it("opens a read-only transaction with bounded timeouts and ends in ROLLBACK", () => {
    const s = statements(v()).map(flat);
    expect(s[0]).toBe("BEGIN");
    expect(s[1].toUpperCase()).toBe("SET TRANSACTION READ ONLY");
    expect(s.some((x) => /^SET\s+LOCAL\s+statement_timeout\s*=\s*'\d+s'$/i.test(x))).toBe(true);
    expect(s.some((x) => /^SET\s+LOCAL\s+lock_timeout\s*=\s*'\d+s'$/i.test(x))).toBe(true);
    expect(s[s.length - 1].toUpperCase()).toBe("ROLLBACK");
    expect(s.map((x) => x.toUpperCase())).not.toContain("COMMIT");
  });

  it("contains no DDL and no DML", () => {
    expect(stripped(v())).not.toMatch(/\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|savepoint|vacuum|copy)\b/i);
  });

  it("emits the required output fields", () => {
    const w = withoutComments(v());
    for (const f of ["'overall_status'", "'verified'", "'failureCount'", "'failed_assertions'",
                     "'schema_verified'", "'security_verified'",
                     "'migration_062_verified'", "'migration_063_verified'"]) {
      expect(w).toContain(f);
    }
    expect(w).toContain("'verified', bool_and(status = 'PASS')");
  });

  it("carries no credential or connection string", () => {
    const s = v();
    expect(s).not.toMatch(/postgres(ql)?:\/\//i);
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/(api[_-]?key|SERVICE_ROLE_KEY|ANON_KEY)/i);
  });
});

describe("migration 059 verifier — exact schema contract", () => {
  const w = () => withoutComments(read(VERIFIER));

  it("pins exact ordered columns, types, nullability and defaults for all five tables", () => {
    const s = w();
    expect(s).toContain("'columns:' || t");
    expect(s).toContain("a_cols = cols and a_types = types and a_nulls = nulls and a_defs = defs");
    expect(s).toContain("order by x.ordinal_position");
    // a missing default is compared as a sentinel, never as NULL
    expect(s).toContain("coalesce(x.column_default::text, '<none>')");
    expect(s).toContain("'<none>'");
  });

  it("declares the exact column list of every table", () => {
    const s = w();
    for (const c of ["legacy_application_temp_id", "consent_pdpa_at", "score_breakdown",
                     "internal_notes", "claim_source", "assignment_batch_id",
                     "decided_by_name", "application_count", "reviewer_count"]) {
      expect(s).toContain(`'${c}'`);
    }
    // enum-typed columns must be pinned to their enum udt_name, not to text
    expect(s).toContain("'role_type'");
    expect(s).toContain("'application_status'");
  });

  it("pins primary keys, unique constraints and their inventories", () => {
    const s = w();
    expect(s).toContain("'pk:' || e.t");
    expect(s).toContain("'unique:' || e.n");
    expect(s).toContain("'unique_inventory'");
    expect(s).toContain("applications_legacy_application_temp_id_key");
  });

  it("pins every foreign key including ON DELETE, ON UPDATE and deferrability", () => {
    const s = w();
    expect(s).toContain("'fk:' || e.n");
    expect(s).toContain("'fk_inventory'");
    expect(s).toContain("c.confdeltype = e.del and c.confupdtype = e.upd");
    expect(s).toContain("c.condeferrable = e.deferrable and c.condeferred = e.deferred");
    // SET NULL + deferred on the two legacy application FKs, CASCADE on answers
    expect(s).toContain("'applications_person_id_fkey','person_id','people','id','n','a',true,true");
    expect(s).toContain("'applications_season_id_fkey','season_id','seasons','id','n','a',true,true");
    expect(s).toContain("'application_answers_application_id_fkey','application_id','applications','id','c','a',true,true");
    expect(s).toContain("'applications_intake_batch_id_fkey','intake_batch_id','intake_batches','id','a','a',false,false");
  });

  it("pins check constraints by exact literal set and by inventory", () => {
    const s = w();
    expect(s).toContain("'check_vocab:' || e.n");
    expect(s).toContain("'check_range:' || e.n");
    expect(s).toContain("'check_inventory:' || e.t");
    expect(s).toContain("l.convalidated");
    expect(s).toContain("'interview_in_progress'");
    expect(s).toContain("'returned_for_clarification'");
    expect(s).toContain("'approve_recommended'");
  });

  it("pins partial and ordinary indexes by exact definition and inventory", () => {
    const s = w();
    expect(s).toContain("'index:' || e.n");
    expect(s).toContain("'index_inventory:' || e.t");
    expect(s).toContain("i.indisunique = e.uniq and i.indisprimary = e.prim");
    expect(s).toContain("WHERE (email_primary IS NOT NULL)");
    expect(s).toContain("lower(email_primary)");
    expect(s).toContain("USING btree (created_at DESC)");
  });

  it("pins both enums to their exact ordered values", () => {
    const s = w();
    expect(s).toContain("'enum:' || e.n");
    expect(s).toContain("order by en.enumsortorder");
    expect(s).toContain("array['mentor','mentee','supporter','speaker','partner_contact','donor','admin']");
    expect(s).toContain("array['accepted','rejected_or_pending','rejected','pending','withdrawn']");
  });
});

describe("migration 059 verifier — exact security contract", () => {
  const w = () => withoutComments(read(VERIFIER));

  it("pins the exact RLS and FORCE RLS state of all five tables", () => {
    const s = w();
    expect(s).toContain("'security:rls_state:' || t");
    expect(s).toContain("relrowsecurity = rls and relforcerowsecurity = forced");
    // applications / application_answers: enabled AND forced
    expect(s).toContain("array['gen_random_uuid()','<none>','<none>','<none>','<none>','now()'],\n  true, true)");
  });

  it("requires zero policies on the two PII tables", () => {
    expect(w()).toContain("'security:zero_policies_on_pii_tables'");
  });

  it("requires no privilege at all for anon or authenticated on the PII tables", () => {
    const s = w();
    expect(s).toContain("'security:no_effective_privilege:'");
    expect(s).toContain("('anon'),('authenticated')");
    for (const p of ALL_PRIVS) expect(s).toContain(`('${p}')`);
  });

  it("requires exactly SELECT/INSERT/UPDATE/DELETE and no TRUNCATE for service_role", () => {
    const s = w();
    expect(s).toContain("'security:service_role_exact_dml:' || t");
    expect(s).toContain("not has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')");
    expect(s).toContain("not has_table_privilege('service_role', 'public.' || t, 'REFERENCES')");
    expect(s).toContain("not has_table_privilege('service_role', 'public.' || t, 'TRIGGER')");
  });

  it("pins the exact non-owner ACL of every table, PUBLIC included", () => {
    const s = w();
    expect(s).toContain("'security:acl:' || e.t");
    expect(s).toContain(`('applications', '{"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb)`);
    expect(s).toContain(`('application_reviews', '{"authenticated":["SELECT"],"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb)`);
    // grantee 0 is PUBLIC and must be resolved, not skipped
    expect(s).toContain("coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC')");
  });

  it("pins policy names, roles, commands, USING and WITH CHECK for the other three tables", () => {
    const s = w();
    expect(s).toContain("'security:policy:' || e.n");
    expect(s).toContain("'security:policy_inventory'");
    expect(s).toContain("p.permissive = 'PERMISSIVE' and p.cmd = e.cmd");
    expect(s).toContain("p.roles = e.roles");
    expect(s).toContain("p.with_check is null");
    expect(s).toContain("p.qual like '%is_admin_role%'");
    expect(s).toContain("p.vals = (select array_agg(v order by v) from unnest(e.vals) v)");
    expect(s).toContain("array['active','admin','core_team','reviewer','super_admin']");
  });

  it("emits the raw quals, check definitions and ACLs as unscored evidence", () => {
    const s = w();
    expect(s).toContain("'policy_quals'");
    expect(s).toContain("'check_definitions'");
    expect(s).toContain("'non_owner_acls'");
    expect(/assertions as \(([\s\S]*?)\n\),\nnormalized as/.exec(s)?.[1] ?? "").not.toContain("'policy_quals'");
  });
});

describe("migration 059 verifier — inventory, initial state and compatibility", () => {
  const w = () => withoutComments(read(VERIFIER));

  it("requires exactly the five intended tables and no unexpected related object", () => {
    const s = w();
    expect(s).toContain("'inventory:no_unexpected_relation'");
    expect(s).toContain("'inventory:no_unexpected_function'");
    expect(s).toContain("'inventory:no_trigger_on_target_tables'");
    expect(s).toContain("c.relkind in ('r','v','m','f','p','S')");
  });

  it("requires all five new tables to be empty immediately after apply", () => {
    const s = w();
    expect(s).toContain("'initial:empty:' || t");
    for (const t of ALL_TABLES) expect(s).toContain(`select count(*) from public.${t}`);
  });

  it("requires the UEHM-S12 / UEHM-S12-B1 linkage to remain intact", () => {
    const s = w();
    expect(s).toContain("'initial:uehm_s12_b1_linkage_intact'");
    expect(s).toContain("batch_season_id = season_id");
    expect(s).toContain("season_program_id = program_id");
  });

  it("requires no unrelated table to reference the new objects", () => {
    expect(w()).toContain("'initial:no_unrelated_table_references_new_objects'");
  });

  it("reasserts the migration 062 and 063 guarantees", () => {
    const s = w();
    for (const a of [
      "'compat:m062_functions_present'",
      "'compat:m062_policies_present'",
      "'compat:m062_membership_rls_enabled'",
      "'compat:m062_scope_arbiter_intact'",
      "'compat:m062_affected_tables_hardened'",
      "'compat:m063_functions_present'",
      "'compat:m063_entrypoint_grants_intact'",
    ]) {
      expect(s).toContain(a);
    }
  });
});

// ---------------------------------------------------------------------------

describe("migration 059 PostgREST probe package", () => {
  const script = () => read(PROBE_SCRIPT);
  const manifest = () => read(PROBE_MANIFEST);

  it("declares all seven required checks in the manifest", () => {
    const m = manifest();
    for (const c of [
      "service_role_select",
      "anon_select_denied",
      "anon_insert_denied",
      "unauthorized_authenticated_select_denied",
      "unauthorized_authenticated_insert_denied",
      "service_role_insert_select_delete",
      "no_secret_in_output",
    ]) {
      expect(m).toContain(c);
    }
  });

  it("declares itself non-executed and credential-free", () => {
    const m = manifest();
    expect(m).toContain("'executed_by_this_package', false");
    expect(m).toContain("'remote_execution_authorized', false");
    expect(m).toContain("'credentials_embedded', false");
  });

  it("implements every check in the script", () => {
    const s = script();
    for (const c of [
      "service_role_select_",
      "anon_select_denied_",
      "anon_insert_denied_",
      "unauthorized_authenticated_select_denied_",
      "unauthorized_authenticated_insert_denied_",
      "service_role_insert",
      "service_role_select_own_row",
      "service_role_delete_cleanup",
      "probe_row_removed",
    ]) {
      expect(s).toContain(c);
    }
  });

  it("refuses to run without explicit authorization", () => {
    const s = script();
    expect(s).toContain("--authorize-staging-probe");
    expect(s).toContain("not_authorized");
  });

  it("refuses any endpoint that is not the expected staging project", () => {
    const s = script();
    expect(s).toContain('const STAGING_REF = "ljfneyuvpxrmejpxsmpz"');
    expect(s).toContain('const PRODUCTION_REF = "qkkroesfiazsejkzflcd"');
    expect(s).toContain("u.hostname.includes(STAGING_REF)");
    expect(s).toContain("!u.hostname.includes(PRODUCTION_REF)");
    expect(s).toContain("endpoint_not_expected_staging_project");
  });

  it("redacts tokens, keys, uuids, emails and auth headers from all output", () => {
    const s = script();
    expect(s).toContain("[redacted-token]");
    expect(s).toContain("[redacted-key]");
    expect(s).toContain("[redacted-uuid]");
    expect(s).toContain("[redacted-email]");
    expect(s).toMatch(/authorization\|apikey\|cookie\|set-cookie/i);
    // only these fields may leave the process — checked on code, not comments
    const emitBody = (/const emit = \(pass, reason\) => \{([\s\S]*?)\n\};/.exec(s)?.[1] ?? "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(emitBody).not.toBe("");
    expect(emitBody).not.toContain("body");
    expect(emitBody).not.toContain("headers");
    expect(emitBody).toContain("redact(");
  });

  it("embeds no credential of its own", () => {
    const s = script();
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/sb[ps]_[A-Za-z0-9]{20,}/);
    expect(s).not.toMatch(/process\.env\./);
  });

  it("confines its only write to the tables migration 059 creates and cleans up", () => {
    const s = script();
    expect(s).toContain("method: \"DELETE\"");
    expect(s).toContain("probe_row_removed");
    expect(s).not.toMatch(/rest\/v1\/(people|admin_users|person_season_memberships|seasons|programs)\b/);
  });
});

// ---------------------------------------------------------------------------

describe("migration immutability", () => {
  it.each(IMMUTABLE)("leaves %s byte-identical to the baseline", (p) => {
    expect(lf(read(p))).toBe(lf(gitShow(BASELINE_HEAD, p)));
    expect(gitUnchanged(BASELINE_HEAD, p)).toBe(true);
  });

  it("changes migration 059 and nothing else under supabase_migrations/", () => {
    const r = spawnSync("git", ["diff", "--name-only", BASELINE_HEAD, "--", "supabase_migrations/"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual([M059]);
  });
});
