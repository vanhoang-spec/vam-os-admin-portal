/**
 * WP1-A2 — the apply / verifier / rollback package.
 *
 * These three files are the only artifacts in this repository that will ever
 * write to live staff authority in Production. The properties locked here are
 * the ones whose erosion would silently grant or destroy authority:
 *
 *   1. Every write is addressed by an EXACT id or an EXACT email. There is no
 *      pattern, no legacy-string rule, and in particular no "VAM -> UEHM"
 *      mapping — three rows store "VAM" and the package sends them in three
 *      different directions, because the owner named their scope_ids.
 *   2. apply.sql is ONE transaction that either converges completely or leaves
 *      nothing behind, and refuses a second run rather than re-converging.
 *   3. verifier.sql cannot write, and never asserts its own verdict.
 *   4. rollback.sql deletes only rows it can prove A2 created, drops only the
 *      objects A2 added, and never removes an audit row.
 *   5. The constraint contract is exactly the owner's: NOT NULL and vocabulary
 *      on role/status, canonical UUID identifiers, and an active-scope unique
 *      key that EXCLUDES the scope level.
 *   6. Nothing in the package replaces a function, changes RLS, or replays a
 *      migration.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = "VAM_OS_WP1A_CANONICAL_SCOPE_20260816";
const APPLY = readFileSync(`${PACKAGE_DIR}/apply.sql`, "utf8");
const VERIFIER = readFileSync(`${PACKAGE_DIR}/verifier.sql`, "utf8");
const ROLLBACK = readFileSync(`${PACKAGE_DIR}/rollback.sql`, "utf8");
const README = readFileSync(`${PACKAGE_DIR}/README.md`, "utf8");
const manifest = JSON.parse(readFileSync(`${PACKAGE_DIR}/staff_scope_manifest_v2.json`, "utf8"));

const UEHM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
const S11 = "710f4ec9-1cf7-461e-98d4-f33799047add";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const UEH_AUTH_USER_ID = "0cbe980a-6027-4645-828d-d994a1a38869";

/** The six inventoried rows the package converts in place. */
const SOURCE_ID = {
  ueh: "68fe466c-b37d-4812-baeb-eb5fe4ea24ec",
  lieu: "17a86485-c241-4cff-9bd5-60efe75b802a",
  hoang: "60ef3d0b-8f41-4c76-aad7-dc91f26a470a",
  toan: "1e58beb9-b7ce-4392-ac81-429743f61534",
  demo: "487a7562-bb40-4c5c-9dc1-0fe363f1158a",
  historical: "eaa60d5c-66eb-4ef8-a8c0-0db0bc701028"
} as const;

/**
 * The six rows A2 CREATES, at ids authored into the package rather than
 * generated. Deterministic ids are what let rollback.sql target exactly the
 * rows A2 created instead of "any row that looks like this".
 */
const CREATED_ID = {
  uehS12: "a2000001-0000-4a20-8a20-000000000001",
  lieuS11: "a2000002-0000-4a20-8a20-000000000002",
  lieuS12: "a2000003-0000-4a20-8a20-000000000003",
  hoangS12: "a2000004-0000-4a20-8a20-000000000004",
  toanS12: "a2000005-0000-4a20-8a20-000000000005",
  demoS12: "a2000006-0000-4a20-8a20-000000000006"
} as const;

const EMAILS = [
  "uehmentoring@gmail.com",
  "lieu.nguyen@hoatay.com.vn",
  "hoang.nguyen@embassy.edu.vn",
  "lyductoan@gmail.com",
  "viewer.vam.test@redsquarevietnam.com",
  "admin.vam.test@redsquarevietnam.com"
] as const;

const DEMO_EMAIL = "viewer.vam.test@redsquarevietnam.com";

/** The six database objects A2 adds — the six names preflight_v2 proved free. */
const PLANNED_OBJECTS = [
  "admin_scope_access_program_id_not_null",
  "admin_scope_access_program_id_canonical_check",
  "admin_scope_access_season_id_canonical_check",
  "admin_scope_access_role_check",
  "admin_scope_access_status_check",
  "admin_scope_access_active_scope_key"
] as const;

const stripComments = (sql: string) =>
  sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

/** Statements with string literals blanked, for keyword-absence assertions. */
const executable = (sql: string) => stripComments(sql).replace(/'(?:[^']|'')*'/g, "''");

/** Every `update <table>` statement in a file, from the keyword to its terminating `;`. */
const updateStatements = (sql: string) => {
  const body = stripComments(sql);
  const out: string[] = [];
  const re = /\bupdate\s+public\.\w+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const end = body.indexOf(";", m.index);
    out.push(body.slice(m.index, end === -1 ? body.length : end));
  }
  return out;
};

const deleteStatements = (sql: string) => {
  const body = stripComments(sql);
  const out: string[] = [];
  const re = /\bdelete\s+from\s+public\.\w+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const end = body.indexOf(";", m.index);
    out.push(body.slice(m.index, end === -1 ? body.length : end));
  }
  return out;
};

const FILES = [
  ["apply.sql", APPLY],
  ["verifier.sql", VERIFIER],
  ["rollback.sql", ROLLBACK]
] as const;

// ───────────────────────────────────────────────────────────────────────────
// A. The package exists, and names exactly the approved identities
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the package is complete", () => {
  it("carries the manifest, both preflights, and the three migration files", () => {
    expect(readdirSync(PACKAGE_DIR).sort()).toEqual([
      "README.md",
      "apply.sql",
      "preflight.sql",
      "preflight_v2.sql",
      "rollback.sql",
      "staff_scope_manifest_v2.json",
      "verifier.sql"
    ]);
  });

  it.each(FILES)("%s names every exact source scope_id", (_label, sql) => {
    for (const id of Object.values(SOURCE_ID)) expect(sql).toContain(id);
  });

  it.each(FILES)("%s names every exact A2-created row id", (_label, sql) => {
    for (const id of Object.values(CREATED_ID)) expect(sql).toContain(id);
  });

  it("names no UUID outside the approved closed set", () => {
    // A transposed UUID copied consistently into every file is invisible to a
    // cross-file comparison; enumerating what MAY appear is what catches it.
    const approved = new Set<string>([
      ...Object.values(SOURCE_ID),
      ...Object.values(CREATED_ID),
      UEHM,
      S11,
      S12,
      UEH_AUTH_USER_ID
    ]);
    for (const [label, sql] of FILES) {
      const found = new Set(
        (sql.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? []).map((u) =>
          u.toLowerCase()
        )
      );
      expect(Array.from(found).filter((u) => !approved.has(u)), `${label} names unapproved UUID(s)`).toEqual([]);
    }
  });

  it("keeps the created ids distinct from every inventoried id", () => {
    const all = [...Object.values(SOURCE_ID), ...Object.values(CREATED_ID)];
    expect(new Set(all).size).toBe(12);
    for (const id of Object.values(CREATED_ID)) {
      expect(id, id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("records every created id in the README so the owner can audit them", () => {
    for (const id of Object.values(CREATED_ID)) expect(README).toContain(id);
  });

  it("creates one row per manifest INSERT target and no more", () => {
    const inserts = manifest.targets.filter((t: any) => t.action === "INSERT");
    expect(inserts).toHaveLength(Object.keys(CREATED_ID).length);
    // 9 active grants after the plan = 4 Admins x 2 + the demo viewer's one.
    expect(manifest.post_state_expectation.active_grants).toBe(9);
    expect(manifest.post_state_expectation.rows_deleted).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. apply.sql is one transaction, and every write is exact
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · apply.sql is a single, exact transaction", () => {
  it("opens exactly one transaction and closes it exactly once", () => {
    // `begin`/`end` inside the plpgsql DO blocks are not transaction control,
    // so only statement-initial keywords count.
    expect(APPLY.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(APPLY.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(APPLY.match(/^rollback;$/gm) ?? []).toHaveLength(0);
    expect(executable(APPLY)).not.toMatch(/\bsavepoint\b/i);
  });

  it("locks its rows FOR UPDATE before it proves anything about them", () => {
    const body = stripComments(APPLY);
    expect(body).toMatch(/for update/i);
    // The lock is taken before the first write statement.
    expect(body.indexOf("for update")).toBeLessThan(body.search(/\binsert\s+into\s+public\./i));
  });

  it("contains no broad UPDATE — every one is keyed on an exact id or email", () => {
    const statements = updateStatements(APPLY);
    expect(statements.length).toBeGreaterThanOrEqual(7);
    for (const stmt of statements) {
      expect(stmt, stmt.slice(0, 80)).toMatch(/\swhere\s/i);
      const exact =
        /where\s+id\s*=\s*'[0-9a-f-]{36}'::uuid/i.test(stmt) ||
        /where\s+lower\(btrim\(email\)\)\s*=\s*'[^']+'/i.test(stmt);
      expect(exact, `not exactly addressed: ${stmt.slice(0, 120)}`).toBe(true);
    }
  });

  it("issues no DELETE, in any branch", () => {
    expect(deleteStatements(APPLY)).toEqual([]);
    expect(executable(APPLY)).not.toMatch(/\bdelete\s+from\b/i);
    expect(executable(APPLY)).not.toMatch(/\btruncate\b/i);
  });

  it("updates exactly one row per inventoried scope_id, plus one platform role", () => {
    const statements = updateStatements(APPLY);
    for (const id of Object.values(SOURCE_ID)) {
      const forId = statements.filter((s) => s.includes(id));
      expect(forId, `expected exactly one UPDATE for ${id}`).toHaveLength(1);
    }
    const platform = statements.filter((s) => /update\s+public\.admin_users/i.test(s));
    expect(platform).toHaveLength(1);
    expect(platform[0]).toContain(DEMO_EMAIL);
    expect(platform[0]).toMatch(/set\s+role\s*=\s*'viewer'/i);
    // The account stays active: status must not appear in the SET list.
    expect(platform[0].slice(0, platform[0].search(/\swhere\s/i))).not.toMatch(/\bstatus\s*=/i);
  });

  it("inserts the six new grants without a broad UPSERT", () => {
    expect(executable(APPLY)).not.toMatch(/on\s+conflict/i);
    expect(executable(APPLY)).not.toMatch(/\bmerge\s+into\b/i);
    // The insert into admin_scope_access is guarded on the canonical active key.
    const insert = stripComments(APPLY).slice(stripComments(APPLY).indexOf("insert into public.admin_scope_access"));
    expect(insert).toMatch(/where\s+not\s+exists/i);
    expect(insert).toMatch(/u\.status\s*=\s*'active'/);
    expect(insert).toMatch(/u\.auth_user_id\s+is\s+not\s+null/);
  });

  it("refuses a second run instead of re-converging", () => {
    expect(APPLY).toContain("ALREADY_APPLIED");
    const guard = APPLY.slice(APPLY.indexOf("[ALREADY_APPLIED]"));
    expect(guard).toMatch(/raise\s+exception/i);
  });

  it("aborts on drift rather than adapting to it", () => {
    for (const token of ["SOURCE_DRIFT", "UNKNOWN_ROW", "TARGET_COLLISION", "STAFF_IDENTITY", "HISTORICAL_INACTIVE"]) {
      expect(APPLY, token).toContain(token);
    }
    // Every guard is a raise, never a branch that repairs what it found.
    expect((APPLY.match(/raise\s+exception/gi) ?? []).length).toBeGreaterThanOrEqual(20);
  });

  it("proves its postconditions before COMMIT", () => {
    const post = APPLY.indexOf("$wp1a2_postconditions$");
    const commit = APPLY.lastIndexOf("commit;");
    expect(post).toBeGreaterThan(0);
    expect(post).toBeLessThan(commit);
    for (const token of ["POST_ROWCOUNT", "POST_ADMIN_GRANTS", "POST_DEMO_SCOPE", "POST_HISTORICAL", "POST_AUDIT"]) {
      expect(APPLY, token).toContain(token);
    }
  });

  it("writes the audit pre-image before it modifies any row", () => {
    const body = stripComments(APPLY);
    expect(body.indexOf("insert into public.admin_audit_log")).toBeLessThan(
      body.search(/\bupdate\s+public\.admin_scope_access/i)
    );
  });

  it("uses only an audit action_type the application already writes", () => {
    // Both the legacy vocabulary and the VAM062 superset contain this value, so
    // it is safe whichever the live constraint carries. Nothing new is invented.
    const adminUsers = readFileSync("lib/admin-users.ts", "utf8");
    expect(adminUsers).toContain('actionType: "update_admin_user"');
    const migration062 = readFileSync("supabase_migrations/062_review_only_account_admin_rls_foundation.sql", "utf8");
    expect(migration062).toContain("'update_admin_user'");
    for (const [label, sql] of FILES) {
      const used = new Set((sql.match(/'(?:action_type|update_admin_user|[a-z_]+_admin_user)'/g) ?? []).map((s) => s));
      for (const literal of Array.from(used)) {
        if (literal === "'action_type'") continue;
        expect(literal, `${label} uses an audit action_type outside the existing vocabulary`).toBe("'update_admin_user'");
      }
    }
    // And it must never weaken the audit contract to make its write fit.
    for (const [label, sql] of FILES) {
      expect(executable(sql), label).not.toMatch(/alter\s+table\s+public\.admin_audit_log/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C. No legacy string drives a conversion
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · no stored string decides anything", () => {
  it.each(FILES)("%s carries no generic VAM -> UEHM rewrite", (_label, sql) => {
    const body = executable(sql);
    expect(body).not.toMatch(/when\s+.*'VAM'\s+then/i);
    expect(body).not.toMatch(/'VAM'\s*(?:=>|->)/i);
    expect(body).not.toMatch(/set\s+program_id\s*=\s*[^']*\bcase\b/i);
  });

  it("never selects a row to convert by a program_id pattern", () => {
    const body = stripComments(APPLY);
    expect(body).not.toMatch(/where[\s\S]{0,200}program_id\s+(?:i?like|~)/i);
    for (const stmt of updateStatements(APPLY)) {
      expect(stmt, stmt.slice(0, 80)).not.toMatch(/where\s+program_id\s*=/i);
    }
  });

  it("sends the three rows that store 'VAM' in three different directions", () => {
    // Hoàng and Toàn rise to full_access and stay active; the demo account's
    // byte-identical row is retired; the historical one is canonicalized while
    // staying inactive. A value-keyed rule cannot express this.
    const byId = (id: string) => updateStatements(APPLY).find((s) => s.includes(id))!;
    expect(byId(SOURCE_ID.hoang)).toMatch(/role\s*=\s*'full_access'[\s\S]*status\s*=\s*'active'/);
    expect(byId(SOURCE_ID.toan)).toMatch(/role\s*=\s*'full_access'[\s\S]*status\s*=\s*'active'/);
    expect(byId(SOURCE_ID.demo)).toMatch(/role\s*=\s*'operations'[\s\S]*status\s*=\s*'inactive'/);
    expect(byId(SOURCE_ID.historical)).toMatch(/status\s*=\s*'inactive'/);
  });

  it("retires Liễu's program-wide row instead of rewriting it into a season grant", () => {
    const stmt = updateStatements(APPLY).find((s) => s.includes(SOURCE_ID.lieu))!;
    expect(stmt).toMatch(/season_id\s*=\s*null/i);
    expect(stmt).toMatch(/status\s*=\s*'inactive'/);
    expect(stmt).not.toContain(S11);
    expect(stmt).not.toContain(S12);
  });

  it("creates no ACTIVE program-wide grant — that is WP1-A3", () => {
    const insert = stripComments(APPLY).slice(stripComments(APPLY).indexOf("insert into public.admin_scope_access"));
    expect(insert).not.toMatch(/null::text\s*,\s*'(?:full_access|operations|review|read)'/i);
    for (const id of Object.values(CREATED_ID)) {
      const row = insert.split("\n").find((l) => l.includes(id))!;
      // Every created row names a season on its own line or the line after it.
      const near = insert.slice(insert.indexOf(id), insert.indexOf(id) + 260);
      expect(near.includes(S11) || near.includes(S12), `${id} must be season-bearing`).toBe(true);
      expect(row).not.toMatch(/\bnull\b/i);
    }
    expect(APPLY).toContain("POST_PROGRAM_WIDE");
  });

  it("grants the demo account read authority only, in Season 12 only", () => {
    const insert = stripComments(APPLY).slice(stripComments(APPLY).indexOf("insert into public.admin_scope_access"));
    const demoRow = insert.slice(insert.indexOf(CREATED_ID.demoS12), insert.indexOf(CREATED_ID.demoS12) + 260);
    expect(demoRow).toContain(DEMO_EMAIL);
    expect(demoRow).toContain(S12);
    expect(demoRow).not.toContain(S11);
    expect(demoRow).toMatch(/'read'/);
    for (const level of ["full_access", "operations", "review"]) {
      expect(demoRow, `demo row must not carry ${level}`).not.toContain(`'${level}'`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D. The constraint contract
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the constraints are exactly the owner contract", () => {
  it("adds the six planned objects, under the six names the preflight proved free", () => {
    const preflight = readFileSync(`${PACKAGE_DIR}/preflight_v2.sql`, "utf8");
    for (const name of PLANNED_OBJECTS) {
      expect(APPLY, name).toContain(name);
      expect(preflight, `${name} was never proved free by the preflight`).toContain(name);
    }
    // …and nothing else.
    const added = (APPLY.match(/add\s+constraint\s+(\w+)/gi) ?? []).map((s) => s.split(/\s+/).pop()!);
    expect(added.sort()).toEqual(PLANNED_OBJECTS.filter((n) => !n.endsWith("_key")).slice().sort());
    expect((APPLY.match(/create\s+unique\s+index\s+(\w+)/gi) ?? []).length).toBe(1);
  });

  it("enforces NOT NULL on program_id, role and status", () => {
    expect(APPLY).toMatch(/constraint\s+admin_scope_access_program_id_not_null\s+check\s*\(\s*program_id\s+is\s+not\s+null\s*\)/i);
    expect(APPLY).toMatch(/admin_scope_access_role_check[\s\S]{0,120}role\s+is\s+not\s+null/i);
    expect(APPLY).toMatch(/admin_scope_access_status_check[\s\S]{0,120}status\s+is\s+not\s+null/i);
  });

  it("enforces the role and status vocabularies, and excludes the legacy level 'admin'", () => {
    // Slice the CONSTRAINT DEFINITION, not the first mention of the name — the
    // name also appears in the [ALREADY_APPLIED] collision list.
    const roleCheck = APPLY.slice(
      APPLY.indexOf("add constraint admin_scope_access_role_check"),
      APPLY.indexOf("add constraint admin_scope_access_status_check")
    );
    for (const level of ["full_access", "operations", "review", "read"]) {
      expect(roleCheck, level).toContain(`'${level}'`);
    }
    expect(roleCheck).not.toMatch(/'admin'/);
    const statusCheck = APPLY.slice(APPLY.indexOf("add constraint admin_scope_access_status_check"));
    expect(statusCheck.slice(0, 300)).toContain("'active'");
    expect(statusCheck.slice(0, 300)).toContain("'inactive'");
    expect(manifest.scope_levels.canonical).toEqual(["full_access", "operations", "review", "read"]);
  });

  it("requires canonical UUID text for program_id, and NULL-or-UUID for season_id", () => {
    expect(APPLY).toMatch(/admin_scope_access_program_id_canonical_check[\s\S]{0,200}\[0-9a-f\]\{8\}/);
    expect(APPLY).toMatch(/admin_scope_access_season_id_canonical_check[\s\S]{0,200}season_id\s+is\s+null\s+or/i);
  });

  it("keys active uniqueness on (user_id, program_id, season_id) with NULLS NOT DISTINCT", () => {
    const idx = APPLY.slice(APPLY.indexOf("create unique index"), APPLY.indexOf("comment on constraint"));
    expect(idx).toMatch(/\(user_id,\s*program_id,\s*season_id\)/);
    expect(idx).toMatch(/nulls\s+not\s+distinct/i);
    expect(idx).toMatch(/where\s+status\s*=\s*'active'/i);
    // Scope level is NOT part of the key — migration 020's index included it,
    // which lets an active `read` and an active `full_access` coexist on one scope.
    expect(idx).not.toMatch(/\brole\b/);
    const migration020 = readFileSync("supabase_migrations/020_admin_scope_access_schema_alignment.sql", "utf8");
    expect(migration020).toMatch(/coalesce\(season_id, ''\),\s*\n?\s*role/);
  });

  it("changes no column type — program_id and season_id stay TEXT in A2", () => {
    for (const [label, sql] of FILES) {
      expect(executable(sql), label).not.toMatch(/alter\s+column\s+\w+\s+type\b/i);
      expect(executable(sql), label).not.toMatch(/::uuid\s*,\s*alter/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// E. verifier.sql is read-only and derives its verdict
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · verifier.sql cannot write", () => {
  it.each([
    ["insert", /\binsert\s+into\b/i],
    ["update", /\bupdate\s+\w/i],
    ["delete", /\bdelete\s+from\b/i],
    ["merge", /\bmerge\s+into\b/i],
    ["truncate", /\btruncate\b/i],
    ["create", /\bcreate\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["alter", /\balter\s+(table|index|function|view|type|schema)\b/i],
    ["drop", /\bdrop\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["grant", /\bgrant\b/i],
    ["revoke", /\brevoke\b/i],
    ["do block", /\bdo\s+\$/i],
    ["commit", /\bcommit\b/i]
  ])("contains no %s statement", (_label, pattern) => {
    expect(executable(VERIFIER)).not.toMatch(pattern);
  });

  it("guards its transaction with SET TRANSACTION READ ONLY and ends it in ROLLBACK", () => {
    const body = executable(VERIFIER);
    expect((body.match(/\bbegin\b/gi) ?? []).length).toBe(1);
    expect((body.match(/set\s+transaction\s+read\s+only/gi) ?? []).length).toBe(1);
    expect((body.match(/\brollback\b/gi) ?? []).length).toBe(1);
  });

  it("reads the live RPC from the catalog instead of invoking it", () => {
    expect(executable(VERIFIER)).toContain("pg_get_functiondef");
    expect(executable(VERIFIER)).not.toMatch(/select\s+.*vam063_authorized_for_scope\s*\(/i);
  });

  it("derives A2_VERIFIED from the checks rather than asserting it", () => {
    const body = stripComments(VERIFIER);
    expect(body).toContain("[A2_VERIFIED]");
    expect(body).toMatch(/count\(\*\)\s+filter\s*\(\s*where\s+result\s*=\s*'FAIL'\s*\)/i);
    // Every PASS literal must be the branch of a CASE over observed state.
    const passLiterals = body.match(/'PASS'/g) ?? [];
    const guarded = body.match(/then\s+'PASS'\s+else\s+'FAIL'\s+end/g) ?? [];
    const verdict = body.match(/then\s+'FAIL'\s+else\s+'PASS'\s+end/g) ?? [];
    expect(passLiterals.length).toBe(guarded.length + verdict.length);
    expect(guarded.length).toBeGreaterThanOrEqual(20);
  });

  it("verifies the created rows, the constraints and the audit trail", () => {
    for (const token of [
      "[CREATED]",
      "[CONVERTED]",
      "[NO_DELETION]",
      "[ADMIN_GRANTS]",
      "[DEMO_VIEWER_S12_SCOPE]",
      "[DEMO_VIEWER_S11_ACTIVE]",
      "[DEMO_VIEWER_MUTATION_SCOPE]",
      "[HISTORICAL_INACTIVE]",
      "[ACTIVE_KEY_INDEX]",
      "[ACTIVE_KEY_EXCLUDES_ROLE]",
      "[CONSTRAINT_ROW]",
      "[RPC_UNCHANGED]",
      "[AUDIT_TRAIL]",
      "[NO_FOREIGN_AUTHORITY]"
    ]) {
      expect(VERIFIER, token).toContain(token);
    }
    expect(VERIFIER).toMatch(/nulls\s+not\s+distinct/i);
  });

  it("claims no more than the database can prove", () => {
    expect(VERIFIER).toMatch(/DOES NOT PROVE EVERY APPLICATION ROUTE IS PII-SAFE/);
    expect(VERIFIER).toMatch(/browser role UAT/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// F. rollback.sql is exact-guarded and never destroys evidence
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · rollback.sql reverses A2 and only A2", () => {
  it("is one transaction with guards that abort rather than adapt", () => {
    expect(ROLLBACK.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(ROLLBACK.match(/^commit;$/gm) ?? []).toHaveLength(1);
    for (const token of ["NOT_APPLIED", "ORGANIC_CHANGE", "POST_BASELINE", "POST_CONSTRAINTS"]) {
      expect(ROLLBACK, token).toContain(token);
    }
    expect((ROLLBACK.match(/raise\s+exception/gi) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("deletes only the six rows A2 created, guarded on the values A2 wrote", () => {
    const deletes = deleteStatements(ROLLBACK);
    expect(deletes).toHaveLength(1);
    const stmt = deletes[0];
    expect(stmt).toMatch(/\bwhere\b/i);
    expect(stmt).toMatch(/s\.id\s*=\s*g\.id/);
    expect(stmt).toMatch(/s\.status\s*=\s*'active'/);
    // Every created id appears in the delete; no inventoried id does.
    for (const id of Object.values(CREATED_ID)) expect(stmt, id).toContain(id);
    for (const id of Object.values(SOURCE_ID)) expect(stmt, `${id} must never be deleted`).not.toContain(id);
  });

  it("restores each inventoried row in place, keyed on its exact id", () => {
    const statements = updateStatements(ROLLBACK);
    for (const id of Object.values(SOURCE_ID)) {
      const forId = statements.filter((s) => s.includes(id));
      expect(forId, `expected exactly one restoring UPDATE for ${id}`).toHaveLength(1);
      expect(forId[0]).toMatch(/where\s+id\s*=\s*'[0-9a-f-]{36}'::uuid/i);
    }
  });

  it("restores the exact pre-A2 values the owner inventory recorded", () => {
    const byId = (id: string) => updateStatements(ROLLBACK).find((s) => s.includes(id))!;
    expect(byId(SOURCE_ID.ueh)).toMatch(/program_id\s*=\s*'UEH Mentoring'[\s\S]*season_id\s*=\s*'UEHM-S11'/);
    // The legacy scope level "admin" is restored — only possible because the
    // role CHECK is dropped first, in the same transaction.
    expect(byId(SOURCE_ID.lieu)).toMatch(/role\s*=\s*'admin'/);
    expect(byId(SOURCE_ID.lieu)).toMatch(/season_id\s*=\s*null/i);
    expect(byId(SOURCE_ID.lieu)).toMatch(/status\s*=\s*'active'/);
    for (const key of ["hoang", "toan", "demo"] as const) {
      expect(byId(SOURCE_ID[key]), key).toMatch(/program_id\s*=\s*'VAM'[\s\S]*role\s*=\s*'operations'[\s\S]*status\s*=\s*'active'/);
    }
    expect(byId(SOURCE_ID.historical)).toMatch(/status\s*=\s*'inactive'/);
    const platform = updateStatements(ROLLBACK).filter((s) => /update\s+public\.admin_users/i.test(s));
    expect(platform).toHaveLength(1);
    expect(platform[0]).toMatch(/set\s+role\s*=\s*'reviewer'/);
    expect(platform[0]).toContain(DEMO_EMAIL);
  });

  it("drops the constraints before restoring values they would reject", () => {
    const body = stripComments(ROLLBACK);
    expect(body.indexOf("drop constraint admin_scope_access_role_check")).toBeLessThan(
      body.search(/set\s+program_id\s*=\s*'UEHM'/)
    );
  });

  it("drops exactly the six objects A2 added, by name and without IF EXISTS", () => {
    const dropped = (ROLLBACK.match(/drop\s+constraint\s+(\w+)/gi) ?? []).map((s) => s.split(/\s+/).pop()!);
    expect(dropped.slice().sort()).toEqual(PLANNED_OBJECTS.filter((n) => !n.endsWith("_key")).slice().sort());
    expect(ROLLBACK).toMatch(/drop\s+index\s+public\.admin_scope_access_active_scope_key/i);
    // IF EXISTS would silently tolerate a partial installation the guards refuse.
    expect(stripComments(ROLLBACK)).not.toMatch(/drop\s+(?:constraint|index)\s+if\s+exists/i);
    // Nothing else is dropped, anywhere.
    expect(executable(ROLLBACK)).not.toMatch(/drop\s+(table|function|view|trigger|policy|schema|type)\b/i);
  });

  it("never deletes an audit row — the trail is retained and extended", () => {
    expect(deleteStatements(ROLLBACK).every((s) => !/admin_audit_log/i.test(s))).toBe(true);
    expect(stripComments(ROLLBACK)).toContain("insert into public.admin_audit_log");
    expect(ROLLBACK).toMatch(/IT DOES NOT REMOVE THE AUDIT TRAIL/);
    // The reason is evidence-based: the application only inserts and reads.
    const adminUsers = readFileSync("lib/admin-users.ts", "utf8");
    expect(adminUsers).not.toMatch(/from\("admin_audit_log"\)[\s\S]{0,80}\.delete\(/);
  });

  it("warns that A1 must not be deployed after a reversal", () => {
    expect(ROLLBACK).toMatch(/WP1-A1 must\s+NOT be deployed|DO NOT deploy WP1-A1|must NOT be deployed/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// G. Blast radius: what the package must never touch
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the package touches nothing outside its scope", () => {
  it.each(FILES)("%s replaces no function", (_label, sql) => {
    const body = executable(sql);
    expect(body).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(body).not.toMatch(/drop\s+function/i);
    expect(body).not.toMatch(/create\s+(or\s+replace\s+)?(procedure|trigger)/i);
  });

  it.each(FILES)("%s changes no RLS policy or grant", (_label, sql) => {
    const body = executable(sql);
    expect(body).not.toMatch(/row\s+level\s+security/i);
    expect(body).not.toMatch(/create\s+policy|alter\s+policy|drop\s+policy/i);
    expect(body).not.toMatch(/\bgrant\b|\brevoke\b/i);
  });

  it.each(FILES)("%s replays no migration", (_label, sql) => {
    const body = executable(sql);
    expect(body).not.toMatch(/vam062_\w+\s*\(/i);
    expect(body).not.toMatch(/supabase_migrations/i);
    expect(body).not.toMatch(/^\s*\\i\b/m);
    // The one function A2 depends on is READ from the catalog, never called.
    expect(body).not.toMatch(/select\s+public\.vam063_authorized_for_scope\s*\(/i);
  });

  it.each(FILES)("%s writes to no table outside admin_scope_access and admin_users", (_label, sql) => {
    const written = new Set(
      (stripComments(sql).match(/\b(?:update|insert\s+into|delete\s+from)\s+public\.(\w+)/gi) ?? []).map((s) =>
        s.split(".").pop()!.trim()
      )
    );
    for (const table of Array.from(written)) {
      expect(["admin_scope_access", "admin_users", "admin_audit_log"], `${table} is outside the blast radius`).toContain(
        table
      );
    }
  });

  it("touches no membership, application, match or people table", () => {
    for (const [label, sql] of FILES) {
      for (const table of ["person_season_memberships", "people", "applications", "matches", "mentor_profiles", "seasons", "programs"]) {
        const writes = new RegExp(`\\b(?:update|insert\\s+into|delete\\s+from)\\s+public\\.${table}\\b`, "i");
        expect(executable(sql), `${label} must not write ${table}`).not.toMatch(writes);
      }
    }
  });
});
