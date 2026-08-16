/**
 * WP1-A2 — the owner-approved staff scope manifest and its read-only preflight.
 *
 * These two artifacts decide what a future migration is allowed to do to live
 * staff authority in Production, so the properties worth locking are the ones
 * that would silently grant or remove authority if they eroded:
 *
 *   1. The manifest is EXHAUSTIVE and EXACT — it names the six inventoried rows
 *      and nothing else, with the values the owner recorded.
 *   2. Conversion is keyed on scope_id, never on a stored legacy string. The
 *      sharpest proof is that the synthetic reviewer row is byte-identical to
 *      Hoàng's and Toàn's in every stored field, and converts to nothing.
 *   3. Nothing inactive becomes active, and no program-wide grant is created.
 *   4. The preflight cannot write, and cannot report SAFE_TO_APPLY_V2 = true
 *      while the synthetic row has no owner disposition.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = "VAM_OS_WP1A_CANONICAL_SCOPE_20260816";
const MANIFEST_PATH = `${PACKAGE_DIR}/staff_scope_manifest_v2.json`;
const PREFLIGHT_V2 = `${PACKAGE_DIR}/preflight_v2.sql`;

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const sql = readFileSync(PREFLIGHT_V2, "utf8");

// Canonical identities, verbatim from the owner manifest.
const UEHM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
const S11 = "710f4ec9-1cf7-461e-98d4-f33799047add";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";

/**
 * THE OWNER INVENTORY, transcribed from the owner's exact six-row statement.
 *
 * This literal is the single source of truth in this file — SCOPE_ID below is
 * derived from it, never typed twice. It exists because a transposed UUID
 * (`…-d812-4b37-…` for `…-b37d-4812-…`) once reached the committed manifest,
 * the preflight and this test at the same time: every copy was consistent with
 * every other copy, so no cross-file check could have caught it.
 *
 * Two guards follow from that. Each row is asserted field by field against this
 * table, and the set of UUIDs appearing ANYWHERE in the manifest and the
 * preflight is asserted to be exactly the closed set of identities this work
 * package is allowed to name — so a stray or mistyped UUID fails immediately
 * instead of being carried consistently into Production.
 */
const OWNER_INVENTORY = [
  {
    key: "ueh_shared_admin", email: "uehmentoring@gmail.com",
    scope_id: "68fe466c-b37d-4812-baeb-eb5fe4ea24ec",
    platform_role: "admin", account_status: "active",
    program_id: "UEH Mentoring", season_id: "UEHM-S11",
    scope_level: "full_access", scope_status: "active"
  },
  {
    key: "lieu", email: "lieu.nguyen@hoatay.com.vn",
    scope_id: "17a86485-c241-4cff-9bd5-60efe75b802a",
    platform_role: "admin", account_status: "active",
    program_id: "UEHM", season_id: null,
    scope_level: "admin", scope_status: "active"
  },
  {
    key: "hoang", email: "hoang.nguyen@embassy.edu.vn",
    scope_id: "60ef3d0b-8f41-4c76-aad7-dc91f26a470a",
    platform_role: "admin", account_status: "active",
    program_id: "VAM", season_id: "UEHM-S11",
    scope_level: "operations", scope_status: "active"
  },
  {
    key: "toan", email: "lyductoan@gmail.com",
    scope_id: "1e58beb9-b7ce-4392-ac81-429743f61534",
    platform_role: "admin", account_status: "active",
    program_id: "VAM", season_id: "UEHM-S11",
    scope_level: "operations", scope_status: "active"
  },
  {
    key: "synthetic_viewer_test", email: "viewer.vam.test@redsquarevietnam.com",
    scope_id: "487a7562-bb40-4c5c-9dc1-0fe363f1158a",
    platform_role: "reviewer", account_status: "active",
    program_id: "VAM", season_id: "UEHM-S11",
    scope_level: "operations", scope_status: "active"
  },
  {
    key: "historical_admin_test", email: "admin.vam.test@redsquarevietnam.com",
    scope_id: "eaa60d5c-66eb-4ef8-a8c0-0db0bc701028",
    platform_role: "admin", account_status: "inactive",
    program_id: "VAM", season_id: "UEHM-S11",
    scope_level: "full_access", scope_status: "inactive"
  }
] as const;

// The UEH shared Admin's auth identity, pinned from the WP1-A1 evidence run.
const UEH_AUTH_USER_ID = "0cbe980a-6027-4645-828d-d994a1a38869";

const idOf = (key: string) => OWNER_INVENTORY.find((r) => r.key === key)!.scope_id;
const SCOPE_ID = {
  ueh: idOf("ueh_shared_admin"),
  lieu: idOf("lieu"),
  hoang: idOf("hoang"),
  toan: idOf("toan"),
  synthetic: idOf("synthetic_viewer_test"),
  historical: idOf("historical_admin_test")
} as const;

type Row = {
  manifest_key: string;
  classification: string;
  account: { email: string; platform_role: string; account_status: string; platform_role_change: string };
  current: { scope_id: string; program_id: string | null; season_id: string | null; scope_level: string; scope_status: string };
};
type Target = {
  target_key: string;
  manifest_key: string;
  classification: string;
  action: string;
  source_scope_id: string | null;
  program_id: string | null;
  season_id: string | null;
  scope_level: string;
  scope_status: string;
  preserves?: string[];
};

const rows: Row[] = manifest.source_rows;
const targets: Target[] = manifest.targets;
const rowOf = (key: string) => rows.find((r) => r.manifest_key === key)!;
const targetsOf = (key: string) => targets.filter((t) => t.manifest_key === key);

// ───────────────────────────────────────────────────────────────────────────
// 0. The six owner-inventory identities are locked, character for character
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the exact owner inventory is locked", () => {
  it.each(OWNER_INVENTORY.map((r) => [r.key, r] as const))(
    "%s matches the owner inventory in every field",
    (key, want) => {
      const row = rowOf(key);
      expect(row.account.email).toBe(want.email);
      expect(row.account.platform_role).toBe(want.platform_role);
      expect(row.account.account_status).toBe(want.account_status);
      expect(row.current).toEqual({
        scope_id: want.scope_id,
        program_id: want.program_id,
        season_id: want.season_id,
        scope_level: want.scope_level,
        scope_status: want.scope_status
      });
      // The preflight carries its own copy of the manifest so it can run
      // standalone; both copies must name the same row.
      expect(sql, `${key} scope_id missing from preflight_v2.sql`).toContain(want.scope_id);
      expect(sql, `${key} email missing from preflight_v2.sql`).toContain(want.email);
    }
  );

  it("names six distinct, well-formed scope ids", () => {
    const ids = OWNER_INVENTORY.map((r) => r.scope_id);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) {
      expect(id, id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("the manifest and preflight name no UUID outside the approved closed set", () => {
    // A transposed UUID copied consistently into every file is invisible to any
    // cross-file comparison. Enumerating what MAY appear is what catches it.
    const approved = new Set<string>([
      ...OWNER_INVENTORY.map((r) => r.scope_id),
      UEHM,
      S11,
      S12,
      UEH_AUTH_USER_ID
    ]);
    const uuids = (text: string) =>
      new Set((text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? []).map((u) => u.toLowerCase()));

    for (const [label, text] of [
      ["staff_scope_manifest_v2.json", readFileSync(MANIFEST_PATH, "utf8")],
      ["preflight_v2.sql", sql]
    ] as const) {
      const found = uuids(text);
      const unexpected = Array.from(found).filter((u) => !approved.has(u));
      expect(unexpected, `${label} names unapproved UUID(s)`).toEqual([]);
      // And every approved identity is actually used, so a silent drop is caught too.
      if (label === "preflight_v2.sql") {
        Array.from(approved).forEach((id) => expect(found, `${label} lost ${id}`).toContain(id));
      }
    }
  });

  it("the catalog identities are the owner's canonical UEHM triple", () => {
    expect(manifest.catalog.program.id).toBe(UEHM);
    expect(manifest.catalog.program.code).toBe("UEHM");
    expect(manifest.catalog.program.name).toBe("UEH Mentoring");
    expect(manifest.catalog.seasons.map((s: any) => [s.code, s.id])).toEqual([
      ["UEHM-S11", S11],
      ["UEHM-S12", S12]
    ]);
  });

  it("every target program and season is one of those canonical identities", () => {
    for (const t of targets) {
      expect(t.program_id, t.target_key).toBe(UEHM);
      expect([S11, S12, null], t.target_key).toContain(t.season_id);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A. The manifest is exactly the known inventory
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the manifest is exactly the owner inventory", () => {
  it("names the six inventoried rows and no others", () => {
    expect(rows.map((r) => r.current.scope_id).sort()).toEqual(Object.values(SCOPE_ID).slice().sort());
    expect(rows.map((r) => r.manifest_key).sort()).toEqual([
      "historical_admin_test",
      "hoang",
      "lieu",
      "synthetic_viewer_test",
      "toan",
      "ueh_shared_admin"
    ]);
  });

  it("records each row's current values exactly as the owner supplied them", () => {
    expect(rowOf("ueh_shared_admin").current).toEqual({
      scope_id: SCOPE_ID.ueh, program_id: "UEH Mentoring", season_id: "UEHM-S11",
      scope_level: "full_access", scope_status: "active"
    });
    expect(rowOf("lieu").current).toEqual({
      scope_id: SCOPE_ID.lieu, program_id: "UEHM", season_id: null,
      scope_level: "admin", scope_status: "active"
    });
    expect(rowOf("hoang").current).toEqual({
      scope_id: SCOPE_ID.hoang, program_id: "VAM", season_id: "UEHM-S11",
      scope_level: "operations", scope_status: "active"
    });
    expect(rowOf("toan").current).toEqual({
      scope_id: SCOPE_ID.toan, program_id: "VAM", season_id: "UEHM-S11",
      scope_level: "operations", scope_status: "active"
    });
    expect(rowOf("synthetic_viewer_test").current).toEqual({
      scope_id: SCOPE_ID.synthetic, program_id: "VAM", season_id: "UEHM-S11",
      scope_level: "operations", scope_status: "active"
    });
    expect(rowOf("historical_admin_test").current).toEqual({
      scope_id: SCOPE_ID.historical, program_id: "VAM", season_id: "UEHM-S11",
      scope_level: "full_access", scope_status: "inactive"
    });
  });

  it("keeps all four real Admins on platform role admin, changing none of them", () => {
    for (const key of ["ueh_shared_admin", "lieu", "hoang", "toan"]) {
      expect(rowOf(key).account.platform_role, key).toBe("admin");
      expect(rowOf(key).account.account_status, key).toBe("active");
      expect(rowOf(key).account.platform_role_change, key).toBe("none");
    }
    // The synthetic account's reviewer role is likewise recorded, not rewritten.
    expect(rowOf("synthetic_viewer_test").account.platform_role).toBe("reviewer");
    expect(rows.every((r) => r.account.platform_role_change === "none")).toBe(true);
  });

  it("uses only the agreed classification vocabulary", () => {
    const allowed = Object.keys(manifest.classification_vocabulary);
    expect(allowed).toContain("KEEP_CONVERT_S11");
    expect(allowed).toContain("ADD_S12");
    expect(allowed).toContain("RETIRE_LEGACY_PROGRAM_WIDE");
    expect(allowed).toContain("HISTORICAL_CANONICALIZE_ONLY");
    expect(allowed).toContain("SYNTHETIC_REQUIRES_OWNER_DECISION");
    for (const item of [...rows, ...targets]) {
      expect(allowed, item.manifest_key).toContain(item.classification);
    }
  });

  it("never admits the legacy scope level 'admin' as a canonical level", () => {
    expect(manifest.scope_levels.canonical).toEqual(["full_access", "operations", "review", "read"]);
    expect(manifest.scope_levels.canonical).not.toContain("admin");
    for (const t of targets) {
      expect(manifest.scope_levels.canonical, t.target_key).toContain(t.scope_level);
    }
  });

  it("agrees with the manifest embedded in preflight_v2.sql", () => {
    // The SQL carries its own copy so it can run standalone against Production.
    // If the two ever disagree, the preflight proves a plan nobody approved.
    for (const row of rows) {
      expect(sql, row.manifest_key).toContain(row.current.scope_id);
      expect(sql, row.manifest_key).toContain(row.account.email);
    }
    for (const id of [UEHM, S11, S12]) expect(sql).toContain(id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. Conversion is keyed on scope_id, not on the string "VAM"
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · no legacy string drives a conversion", () => {
  it("every conversion target names an exact scope_id belonging to its own account", () => {
    const known = new Set(rows.map((r) => r.current.scope_id));
    for (const t of targets) {
      if (t.source_scope_id === null) continue;
      expect(known, t.target_key).toContain(t.source_scope_id);
      // The source row a target converts must be that target's OWN account's row.
      expect(rowOf(t.manifest_key).current.scope_id, t.target_key).toBe(t.source_scope_id);
    }
  });

  it("Hoàng's mapping cannot reach any other account's row", () => {
    const hoang = targetsOf("hoang").filter((t) => t.source_scope_id !== null);
    expect(hoang).toHaveLength(1);
    expect(hoang[0].source_scope_id).toBe(SCOPE_ID.hoang);
    // No other target, for any account, may be driven by Hoàng's row.
    const others = targets.filter((t) => t.manifest_key !== "hoang" && t.source_scope_id === SCOPE_ID.hoang);
    expect(others).toEqual([]);
  });

  it("Toàn's mapping cannot reach any other account's row", () => {
    const toan = targetsOf("toan").filter((t) => t.source_scope_id !== null);
    expect(toan).toHaveLength(1);
    expect(toan[0].source_scope_id).toBe(SCOPE_ID.toan);
    expect(targets.filter((t) => t.manifest_key !== "toan" && t.source_scope_id === SCOPE_ID.toan)).toEqual([]);
  });

  it("three rows store identical legacy values and get three different outcomes", () => {
    // This is the property a value-driven rule cannot have. Hoàng, Toàn and the
    // synthetic reviewer row are indistinguishable by stored value.
    const shape = (k: string) => JSON.stringify({ ...rowOf(k).current, scope_id: undefined });
    expect(shape("synthetic_viewer_test")).toBe(shape("hoang"));
    expect(shape("synthetic_viewer_test")).toBe(shape("toan"));

    expect(targetsOf("hoang").length).toBeGreaterThan(0);
    expect(targetsOf("toan").length).toBeGreaterThan(0);
    expect(targetsOf("synthetic_viewer_test")).toEqual([]);
  });

  it("carries no generic VAM → UEHM rewrite in the manifest or the preflight", () => {
    // A rule of the form "if the stored program is VAM then use UEHM" would
    // convert the synthetic row too. Nothing may express one.
    const executable = sql
      .split("\n")
      .map((line) => (line.indexOf("--") === -1 ? line : line.slice(0, line.indexOf("--"))))
      .join("\n");
    expect(executable).not.toMatch(/when\s+.*'VAM'\s+then/i);
    expect(executable).not.toMatch(/'VAM'\s*(?:=>|->)/i);
    // The one place 'VAM' may appear in executable SQL is as an observation:
    // the manifest's recorded current values and the [VAM_LEGACY] / [INFO] counts.
    expect(rows.filter((r) => r.current.program_id === "VAM")).toHaveLength(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C. Liễu's program-wide legacy row is treated specially
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the legacy program-wide row", () => {
  it("is classified for retirement rather than conversion", () => {
    expect(rowOf("lieu").classification).toBe("RETIRE_LEGACY_PROGRAM_WIDE");
    const legacy = targets.find((t) => t.target_key === "lieu/LEGACY")!;
    expect(legacy.action).toBe("RETIRE_IN_PLACE");
    expect(legacy.source_scope_id).toBe(SCOPE_ID.lieu);
    expect(legacy.scope_status).toBe("inactive");
    expect(legacy.season_id).toBeNull();
    // Retired, never deleted: the row keeps its identity and creation time.
    expect(legacy.preserves).toEqual(expect.arrayContaining(["id", "created_at"]));
    expect(manifest.post_state_expectation.rows_deleted).toBe(0);
  });

  it("records the pre-image of the one value that cannot be preserved", () => {
    const legacy = targets.find((t) => t.target_key === "lieu/LEGACY")!;
    expect((legacy as any).pre_image.scope_level).toBe("admin");
    expect((legacy as any).owner_visible_history_rewrite).toMatchObject({
      field: "scope_level", from: "admin", to: "full_access"
    });
  });

  it("replaces her authority with explicit season grants, not another program-wide row", () => {
    const keys = targetsOf("lieu").map((t) => t.target_key).sort();
    expect(keys).toEqual(["lieu/LEGACY", "lieu/S11", "lieu/S12"]);
    expect(targets.find((t) => t.target_key === "lieu/S11")!.season_id).toBe(S11);
    expect(targets.find((t) => t.target_key === "lieu/S12")!.season_id).toBe(S12);
  });

  it("creates no ACTIVE program-wide grant anywhere in the plan — that is WP1-A3", () => {
    for (const t of targets) {
      if (t.scope_status === "active") expect(t.season_id, t.target_key).not.toBeNull();
    }
    expect(manifest.gates.program_wide_grants.authorized).toBe(false);
    expect(manifest.gates.program_wide_grants.status).toBe("DEFERRED_TO_WP1_A3");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D. The synthetic reviewer row is not silently converted
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · the synthetic reviewer row", () => {
  it("has no target of any kind", () => {
    expect(rowOf("synthetic_viewer_test").classification).toBe("SYNTHETIC_REQUIRES_OWNER_DECISION");
    expect(targetsOf("synthetic_viewer_test")).toEqual([]);
    const parked = manifest.no_target.find((n: any) => n.manifest_key === "synthetic_viewer_test");
    expect(parked.action).toBe("NONE");
    expect(parked.scope_id).toBe(SCOPE_ID.synthetic);
  });

  it("is gated as unauthorized and blocks apply", () => {
    expect(manifest.gates.synthetic_disposition.authorized).toBe(false);
    expect(manifest.gates.synthetic_disposition.blocks_apply).toBe(true);
    expect(manifest.apply_authorized).toBe(false);
  });

  it("has its own named preflight check rather than a generic count", () => {
    expect(sql).toContain("[SYNTHETIC_DISPOSITION]");
    expect(manifest.gates.synthetic_disposition.preflight_check).toBe("[SYNTHETIC_DISPOSITION]");
    expect(manifest.gates.expected_blocking_checks).toContain("[SYNTHETIC_DISPOSITION]");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// E. Nothing inactive is reactivated
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · identifier canonicalization never restores authority", () => {
  it("the inactive historical row stays inactive in every target that touches it", () => {
    expect(rowOf("historical_admin_test").classification).toBe("HISTORICAL_CANONICALIZE_ONLY");
    const t = targets.find((x) => x.target_key === "historical_admin_test/CANONICALIZE")!;
    expect(t.scope_status).toBe("inactive");
    expect(t.preserves).toEqual(expect.arrayContaining(["scope_status"]));
    // Identifiers change; nothing else does.
    expect(t.program_id).toBe(UEHM);
    expect(t.season_id).toBe(S11);
    expect(t.scope_level).toBe(rowOf("historical_admin_test").current.scope_level);
  });

  it("derives that row's program from its own season, not from the string it stores", () => {
    const t: any = targets.find((x) => x.target_key === "historical_admin_test/CANONICALIZE")!;
    expect(t.program_identity_derivation).toMatch(/owns this row/i);
    expect(t.program_identity_derivation).toMatch(/not.*derived from the string/i);
  });

  it("no target promotes an inactive source row to active", () => {
    for (const t of targets) {
      if (t.source_scope_id === null) continue;
      const source = rows.find((r) => r.current.scope_id === t.source_scope_id)!;
      if (source.current.scope_status === "inactive") {
        expect(t.scope_status, t.target_key).toBe("inactive");
      }
    }
  });

  it("no ACTIVE grant is issued to an account that is not active", () => {
    for (const t of targets) {
      if (t.scope_status !== "active") continue;
      expect(rowOf(t.manifest_key).account.account_status, t.target_key).toBe("active");
    }
  });

  it("the preflight names the reactivation guard as a gating check", () => {
    expect(sql).toContain("[NO_REACTIVATION]");
    expect(sql).toContain("[HISTORICAL_INACTIVE]");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// F. Target uniqueness is computed on post-conversion keys
// ───────────────────────────────────────────────────────────────────────────

describe("WP1-A2 · duplicate detection uses canonical post-conversion keys", () => {
  it("no two active targets share one canonical (account, program, season) key", () => {
    const seen = new Map<string, string>();
    for (const t of targets) {
      if (t.scope_status !== "active") continue;
      const key = `${t.manifest_key}|${t.program_id}|${t.season_id ?? "<program-wide>"}`;
      expect(seen.has(key), `${t.target_key} collides with ${seen.get(key)}`).toBe(false);
      seen.set(key, t.target_key);
    }
    expect(seen.size).toBe(manifest.post_state_expectation.active_grants);
  });

  it("the preflight groups on post-plan identity, not on stored strings", () => {
    // Two rows that look different today ("UEHM-S11" and the S11 uuid) land on
    // one key after conversion. Grouping on stored values would miss that.
    expect(sql).toMatch(/post_plan\s+as\s*\(/);
    expect(sql).toMatch(/active_keys\s+as\s*\(/);
    expect(sql).toMatch(/from\s+post_plan_violations\s+where\s+status_key\s*=\s*'active'/);
  });

  it("excludes scope level from the uniqueness key", () => {
    // Migration 020 keyed on (user_id, program_id, season_id, role), which lets
    // an active `read` and an active `full_access` grant coexist on one scope.
    const activeKeys = sql.slice(sql.indexOf("active_keys as ("), sql.indexOf("unknown_rows as ("));
    expect(activeKeys).toContain("program_key");
    expect(activeKeys).toContain("season_key");
    expect(activeKeys).not.toContain("level_key");
  });

  it("distinguishes existing-row collisions from manifest self-collisions", () => {
    expect(sql).toContain("[TARGET_COLLISION]");
    expect(sql).toContain("[TARGET_DUPLICATE]");
    expect(sql).toContain("[ACTIVE_KEY_UNIQUE]");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// G. preflight_v2.sql is read-only and refuses to authorize itself
// ───────────────────────────────────────────────────────────────────────────

const withoutComments = sql
  .split("\n")
  .map((line) => {
    const idx = line.indexOf("--");
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join("\n");

// String literals carry the report's prose ("1 active grant", "the grant A2
// creates"), which a naive /\bgrant\b/ would match. Blank them before asserting
// on statements, exactly as the V1 guard does.
const executable = withoutComments.replace(/'(?:[^']|'')*'/g, "''");

describe("WP1-A2 · preflight_v2 is read-only", () => {
  it.each([
    ["insert", /\binsert\s+into\b/i],
    ["update", /\bupdate\s+\w/i],
    ["delete", /\bdelete\s+from\b/i],
    ["merge", /\bmerge\s+into\b/i],
    ["truncate", /\btruncate\b/i],
    ["copy", /\bcopy\b/i],
    ["create", /\bcreate\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["alter", /\balter\s+(table|index|function|view|type|schema)\b/i],
    ["drop", /\bdrop\s+(table|index|function|view|constraint|trigger|policy|schema|type)\b/i],
    ["grant", /\bgrant\b/i],
    ["revoke", /\brevoke\b/i],
    ["do block", /\bdo\s+\$/i],
    ["commit", /\bcommit\b/i]
  ])("contains no %s statement", (_label, pattern) => {
    expect(executable).not.toMatch(pattern);
  });

  it("guards every transaction with SET TRANSACTION READ ONLY and ends it in ROLLBACK", () => {
    const begins = executable.match(/\bbegin\b/gi) ?? [];
    const readOnly = executable.match(/set\s+transaction\s+read\s+only/gi) ?? [];
    const rollbacks = executable.match(/\brollback\b/gi) ?? [];
    expect(begins.length).toBe(3);
    expect(readOnly.length).toBe(begins.length);
    expect(rollbacks.length).toBe(begins.length);
  });

  it("reads the live RPC from the catalog instead of invoking it", () => {
    expect(executable).toContain("pg_get_functiondef");
    expect(executable).not.toMatch(/select\s+.*vam063_authorized_for_scope\s*\(/i);
  });

  it("never writes a NULL season into any target", () => {
    // Guards against WP1-A3 work leaking in as a program-wide grant.
    expect(executable).not.toMatch(/season_id\s*=\s*null/i);
  });
});

describe("WP1-A2 · SAFE_TO_APPLY_V2 is false until the owner disposes of the synthetic row", () => {
  it("ships with the disposition switch off", () => {
    expect(withoutComments).toMatch(/false\s+as\s+synthetic_disposition_authorized/i);
    expect(withoutComments).not.toMatch(/true\s+as\s+synthetic_disposition_authorized/i);
    expect(withoutComments).toMatch(/'PENDING_OWNER_DECISION'/);
    expect(manifest.gates.safe_to_apply_v2_expected).toBe(false);
    expect(manifest.status).toBe("PENDING_OWNER_SYNTHETIC_DISPOSITION");
  });

  it("derives the verdict from the checks rather than asserting it", () => {
    expect(withoutComments).toMatch(/'SAFE_TO_APPLY_V2'/);
    expect(withoutComments).toMatch(/exists\s*\(\s*select\s+1\s+from\s+checks\s+where\s+result\s*=\s*'FAIL'\s*\)/i);
  });

  it("requires the synthetic check to see BOTH an authorization and an encoded target", () => {
    // Flipping the flag alone must not clear the gate: with no target for that
    // scope_id the row survives the plan unchanged and still blocks the
    // table-wide program_id constraint.
    const check = sql.slice(sql.indexOf("[SYNTHETIC_DISPOSITION]"));
    expect(check).toMatch(/synthetic_disposition_authorized[\s\S]{0,200}targets\s+t\s+where\s+t\.manifest_key\s*=\s*'synthetic_viewer_test'/);
  });
});

describe("WP1-A2 · the package still carries no migration", () => {
  it("has a preflight and a manifest, and no apply, verifier or rollback SQL", () => {
    expect(readdirSync(PACKAGE_DIR).sort()).toEqual([
      "README.md",
      "preflight.sql",
      "preflight_v2.sql",
      "staff_scope_manifest_v2.json"
    ]);
  });

  it("keeps the V1 preflight intact as prior evidence", () => {
    const v1 = readFileSync(`${PACKAGE_DIR}/preflight.sql`, "utf8");
    expect(v1).toContain("SAFE_TO_APPLY");
    expect(v1).not.toContain("SAFE_TO_APPLY_V2");
  });
});
