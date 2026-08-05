import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
// @ts-ignore - .mjs fixture scripts are untyped by design
import { runFixtures } from "../scripts/create-uat-fixtures.mjs";
// @ts-ignore
import { runCleanup } from "../scripts/cleanup-uat-fixtures.mjs";
// @ts-ignore
import * as fixtureCommon from "../scripts/uat-fixture-common.mjs";

const {
  ACCOUNTS,
  ACCOUNT_NOTES_MARKER,
  ACCOUNT_TAG,
  STAGING_HOSTNAME,
  assertRunId,
  assertStagingHost,
  classifyPersonRunMarker,
  email,
  isExactAdminNotesMarker,
  parseApplyMode,
  personIdentityForRun,
  resolveRunId
} = fixtureCommon as any;

const createScript = resolve(__dirname, "../scripts/create-uat-fixtures.mjs");
const preflightSqlPath = resolve(__dirname, "../scripts/uat-fixture-staging-preflight.sql");

const RUN_A = "20260805-01";
const RUN_B = "20260805-02";
const PERSON_A = personIdentityForRun(RUN_A);
const PERSON_B = personIdentityForRun(RUN_B);

const PROGRAM_ID = "program-uuid-0001";
const SEASON_ID = "season-uuid-0001";
const BATCH_ID = "batch-uuid-0001";
const PASSWORD = "pw-long-enough";

// ---------------------------------------------------------------------------
// In-memory PostgREST + GoTrue double.
//
// Query state is captured per builder so assertions can inspect the exact
// filters, payloads and ids each stage used. Filters are genuinely applied, so
// a script that widens a delete or drops a filter fails these tests.
//
//   world.fault(state)                  -> pre-empt a query with a fixed result
//   world.mangle(state, result, world)   -> corrupt the response of a real write
// ---------------------------------------------------------------------------

type Filter = [op: string, column: string, value: any];

type QueryState = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Filter[];
  payload?: any;
  columns?: string;
  head?: boolean;
  single?: boolean;
};

function createWorld() {
  const world: any = {
    seq: 0,
    tables: {
      seasons: [{ id: SEASON_ID, code: "UEHM-S12", program_id: PROGRAM_ID }],
      programs: [{ id: PROGRAM_ID, code: "UEHM", is_active: true }],
      intake_batches: [{ id: BATCH_ID, code: "UEHM-S12-B1", season_id: SEASON_ID }],
      admin_users: [],
      admin_scope_access: [],
      people: [],
      person_season_memberships: [],
      person_season_membership_log: [],
      admin_audit_log: []
    },
    authUsers: [] as any[],
    queries: [] as QueryState[],
    writes: [] as any[],
    authOps: [] as any[],
    order: [] as string[],
    fault: null as null | ((state: QueryState) => any),
    mangle: null as null | ((state: QueryState, result: any, world: any) => any)
  };
  return world;
}

function matchesFilters(row: any, filters: Filter[]) {
  return filters.every(([op, column, value]) => {
    if (op === "is") return (row[column] ?? null) === value;
    return String(row[column] ?? "") === String(value);
  });
}

function resolveQuery(world: any, state: QueryState) {
  world.queries.push(state);

  const preempt = world.fault ? world.fault(state) : null;
  if (preempt) return preempt;

  const table = world.tables[state.table] ?? (world.tables[state.table] = []);
  let result: any;

  if (state.op === "insert") {
    const row = { id: `${state.table}-${++world.seq}`, ...state.payload };
    table.push(row);
    world.writes.push({ table: state.table, op: "insert", payload: state.payload, ids: [row.id] });
    world.order.push(`${state.table}:insert`);
    result = state.single ? { data: { id: row.id }, error: null } : { data: [{ id: row.id }], error: null };
  } else {
    const matched = table.filter((row: any) => matchesFilters(row, state.filters));

    if (state.op === "update") {
      for (const row of matched) Object.assign(row, state.payload);
      world.writes.push({
        table: state.table,
        op: "update",
        payload: state.payload,
        filters: state.filters,
        ids: matched.map((r: any) => r.id)
      });
      world.order.push(`${state.table}:update`);
      result = { data: matched.map((r: any) => ({ id: r.id })), error: null };
    } else if (state.op === "delete") {
      world.tables[state.table] = table.filter((row: any) => !matched.includes(row));
      world.writes.push({
        table: state.table,
        op: "delete",
        filters: state.filters,
        ids: matched.map((r: any) => r.id)
      });
      world.order.push(`${state.table}:delete`);
      result = { data: matched.map((r: any) => ({ id: r.id })), error: null };
    } else if (state.head) {
      result = { count: matched.length, error: null };
    } else if (state.single) {
      result =
        matched.length > 1
          ? { data: null, error: { message: "JSON object requested, multiple rows returned" } }
          : { data: matched[0] ? { ...matched[0] } : null, error: null };
    } else {
      result = { data: matched.map((row: any) => ({ ...row })), error: null };
    }
  }

  const mangled = world.mangle ? world.mangle(state, result, world) : undefined;
  return mangled === undefined ? result : mangled;
}

function createDb(world: any) {
  return {
    auth: {
      admin: {
        listUsers: async ({ page = 1, perPage = 200 }: any = {}) => {
          const start = (page - 1) * perPage;
          return { data: { users: world.authUsers.slice(start, start + perPage) }, error: null };
        },
        createUser: async (payload: any) => {
          if (world.authCreateResult) return world.authCreateResult(payload, world);
          const user = {
            id: `auth-${++world.seq}`,
            email: payload.email,
            user_metadata: payload.user_metadata ?? {}
          };
          world.authUsers.push(user);
          world.authOps.push({ op: "create", email: payload.email, id: user.id });
          world.order.push("auth:create");
          return { data: { user }, error: null };
        },
        deleteUser: async (id: string) => {
          if (world.authDeleteResult) {
            const forced = world.authDeleteResult(id, world);
            if (forced) return forced;
          }
          world.authUsers = world.authUsers.filter((u: any) => u.id !== id);
          world.authOps.push({ op: "delete", id });
          world.order.push("auth:delete");
          return { error: null };
        }
      }
    },
    from(table: string) {
      const state: QueryState = { table, op: "select", filters: [] };
      const builder: any = {
        select(columns: string, opts: any) {
          state.columns = columns;
          if (opts?.head) state.head = true;
          return builder;
        },
        eq(column: string, value: any) {
          state.filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: any) {
          state.filters.push(["is", column, value]);
          return builder;
        },
        insert(payload: any) {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        update(payload: any) {
          state.op = "update";
          state.payload = payload;
          return builder;
        },
        delete() {
          state.op = "delete";
          return builder;
        },
        maybeSingle() {
          state.single = true;
          return Promise.resolve(resolveQuery(world, state));
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(resolveQuery(world, state)).then(onFulfilled, onRejected);
        }
      };
      return builder;
    }
  };
}

function createLogger() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (m: string) => logs.push(String(m)),
    error: (m: string) => errors.push(String(m)),
    logs,
    errors,
    all: () => logs.concat(errors).join("\n")
  };
}

/** Seed the world as if a successful `--apply` run had already happened. */
function seedProvisioned(world: any, person: any = PERSON_A) {
  const links: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    const authUser = {
      id: `auth-seed-${account.slug}`,
      email: email(account.slug),
      user_metadata: { vam_uat_fixture: ACCOUNT_TAG }
    };
    world.authUsers.push(authUser);
    links[account.slug] = authUser.id;

    if (!account.adminRole) continue;
    world.tables.admin_users.push({
      id: `admin-seed-${account.slug}`,
      auth_user_id: authUser.id,
      email: email(account.slug),
      full_name: account.fullName,
      role: account.adminRole,
      status: account.status,
      notes: ACCOUNT_NOTES_MARKER
    });
    world.tables.admin_scope_access.push({
      id: `scope-seed-${account.slug}`,
      user_id: authUser.id,
      program_id: PROGRAM_ID,
      season_id: SEASON_ID,
      role: account.scopeRole,
      status: account.status === "active" ? "active" : "inactive"
    });
  }

  world.tables.people.push({
    id: `person-seed-${person.runId}`,
    full_name: person.full_name,
    email_primary: person.email_primary,
    source_sheets: "admin_manual_input",
    data_quality_flags: person.activeMarker
  });
  world.tables.person_season_memberships.push({
    id: `membership-seed-${person.runId}`,
    person_id: `person-seed-${person.runId}`,
    program_id: PROGRAM_ID,
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    role: person.membershipRole,
    status: person.membershipStatus,
    source: "manual",
    notes: ACCOUNT_NOTES_MARKER
  });
  return links;
}

function pinAdmin(world: any, adminId: string) {
  world.tables.admin_audit_log.push({ id: `audit-${adminId}`, actor_admin_user_id: adminId, target_admin_user_id: null });
}

function pinMembership(world: any, membershipId: string, personId: string) {
  world.tables.person_season_membership_log.push({
    id: `log-${membershipId}`,
    membership_id: membershipId,
    person_id: personId,
    new_status: "active"
  });
}

const writesTo = (world: any, table: string, op?: string) =>
  world.writes.filter((w: any) => w.table === table && (!op || w.op === op));

const authIdFor = (world: any, slug: string) =>
  world.authOps.find((o: any) => o.op === "create" && o.email === email(slug))?.id;

const deletedAuthIds = (world: any) =>
  world.authOps.filter((o: any) => o.op === "delete").map((o: any) => o.id);

// ---------------------------------------------------------------------------

describe("shared fixture identity model", () => {
  it("defines exactly the six-account matrix with DEC-04 status vocabulary", () => {
    expect(ACCOUNTS.map((a: any) => a.slug)).toEqual([
      "admin",
      "reviewer",
      "support",
      "viewer",
      "nonadmin",
      "inactive"
    ]);
    expect(ACCOUNTS.map((a: any) => a.adminRole)).toEqual([
      "admin",
      "reviewer",
      "support_team",
      "viewer",
      null,
      "admin"
    ]);
    expect(ACCOUNTS.map((a: any) => a.scopeRole)).toEqual([
      "full_access",
      "review",
      "operations",
      "read",
      null,
      "read"
    ]);
    const statuses = ACCOUNTS.map((a: any) => a.status).filter(Boolean);
    expect(statuses.every((s: string) => s === "active" || s === "inactive")).toBe(true);
    expect(statuses).not.toContain("invited");
    expect(statuses).not.toContain("suspended");
    expect(ACCOUNTS.some((a: any) => a.adminRole === "super_admin")).toBe(false);
  });

  it("keeps stable account identity independent of the run id", () => {
    // Account emails and markers must be identical whichever run is active.
    expect(email("admin")).toBe(`uat.admin+${ACCOUNT_TAG}@example.com`);
    expect(email("admin")).not.toContain(RUN_A);
    expect(email("admin")).not.toContain(RUN_B);
    expect(ACCOUNT_NOTES_MARKER).toBe(`VAM UAT fixture ${ACCOUNT_TAG}`);
    expect(ACCOUNT_NOTES_MARKER).not.toContain(RUN_A);
  });

  it("derives per-run person identity in its own marker namespace", () => {
    expect(PERSON_A.full_name).toBe(`VAM-UAT-${RUN_A} Person`);
    expect(PERSON_A.email_primary).toBe(`uat.person+${RUN_A}@example.com`);
    expect(PERSON_A.activeMarker).toBe(`vam_uat_person_run:${RUN_A}`);
    expect(PERSON_A.retainedMarker).toBe(`vam_uat_person_run:${RUN_A}:retained`);
    // Two namespaces, never interchangeable.
    expect(PERSON_A.activeMarker.startsWith("vam_uat_person_run:")).toBe(true);
    expect(ACCOUNT_NOTES_MARKER.startsWith("vam_uat_person_run:")).toBe(false);
    expect(isExactAdminNotesMarker(PERSON_A.activeMarker)).toBe(false);
  });

  it("classifies a run marker only against its own run", () => {
    expect(classifyPersonRunMarker(PERSON_A.activeMarker, PERSON_A)).toBe("active");
    expect(classifyPersonRunMarker(PERSON_A.retainedMarker, PERSON_A)).toBe("retained");
    // Run A's marker is invisible to run B and vice versa.
    expect(classifyPersonRunMarker(PERSON_A.activeMarker, PERSON_B)).toBe("none");
    expect(classifyPersonRunMarker(PERSON_B.retainedMarker, PERSON_A)).toBe("none");
    expect(classifyPersonRunMarker(`${PERSON_A.activeMarker} extra`, PERSON_A)).toBe("none");
    expect(classifyPersonRunMarker(undefined, PERSON_A)).toBe("none");
  });

  it("rejects free-text notes that merely mention the fixture marker", () => {
    expect(isExactAdminNotesMarker(ACCOUNT_NOTES_MARKER)).toBe(true);
    expect(isExactAdminNotesMarker(`Real admin — see VAM UAT fixture ${ACCOUNT_TAG} ticket`)).toBe(false);
    expect(isExactAdminNotesMarker(`${ACCOUNT_NOTES_MARKER} — retained`)).toBe(false);
    expect(isExactAdminNotesMarker(null)).toBe(false);
  });

  it("rejects missing, malformed and dangerous run ids", () => {
    expect(assertRunId(RUN_A)).toBe(RUN_A);
    expect(assertRunId("abc")).toBe("abc");
    expect(() => assertRunId(undefined)).toThrow(/VAM_UAT_RUN_ID is not set/);
    expect(() => assertRunId("")).toThrow(/is not set/);
    expect(() => assertRunId("   ")).toThrow(/is not set/);
    expect(() => assertRunId("ab")).toThrow(/between 3 and 32 characters/);
    expect(() => assertRunId("a".repeat(33))).toThrow(/between 3 and 32 characters/);
    expect(() => assertRunId(" 20260805-01")).toThrow(/whitespace/);
    for (const bad of [
      "2026%0805",
      "2026_0805",
      "run id",
      "run/../id",
      "run'id",
      'run"id',
      "run;drop",
      "RUN-A",
      "-leading",
      "trailing-",
      "double--hyphen",
      "run.id",
      "rün-id"
    ]) {
      expect(() => assertRunId(bad), `expected ${bad} to be rejected`).toThrow(/not in the accepted format/);
    }
  });

  it("verifies the staging project by exact hostname, not substring", () => {
    expect(assertStagingHost(`https://${STAGING_HOSTNAME}`)).toBe(STAGING_HOSTNAME);
    expect(() => assertStagingHost(`https://evil.example.com/${STAGING_HOSTNAME}`)).toThrow(/is not VAM OS staging/);
    expect(() => assertStagingHost(`https://${STAGING_HOSTNAME}.evil.example.com`)).toThrow(/is not VAM OS staging/);
    expect(() => assertStagingHost(`http://${STAGING_HOSTNAME}`)).toThrow(/must use https/);
    expect(() => assertStagingHost("not-a-url")).toThrow(/not a parsable URL/);
  });

  it("treats only the exact --apply token as write mode", () => {
    expect(parseApplyMode(["node", "script", "--apply"])).toBe(true);
    expect(parseApplyMode(["node", "script", "--aply"])).toBe(false);
    expect(parseApplyMode(["node", "script", "--apply=true"])).toBe(false);
    expect(parseApplyMode(["node", "script"])).toBe(false);
  });

  it("prefers an explicit --run-id flag over the environment", () => {
    expect(resolveRunId([`--run-id=${RUN_B}`], { VAM_UAT_RUN_ID: RUN_A })).toBe(RUN_B);
    expect(resolveRunId([], { VAM_UAT_RUN_ID: RUN_A })).toBe(RUN_A);
    expect(resolveRunId([], {})).toBeUndefined();
  });
});

describe("create-uat-fixtures — ownership verification", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("refuses to run without a valid run id, before any network call", async () => {
    await expect(runFixtures(db, true, PASSWORD, logger, {})).rejects.toThrow(/VAM_UAT_RUN_ID is not set/);
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: "bad id" })).rejects.toThrow(
      /not in the accepted format/
    );
    expect(world.queries).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
  });

  it("aborts when an existing Auth user lacks the exact metadata marker", async () => {
    world.authUsers.push({
      id: "auth-foreign",
      email: email("admin"),
      user_metadata: { vam_uat_fixture: "20260101" }
    });
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /does not exactly equal the account tag/
    );
    expect(world.authOps.filter((o: any) => o.op === "create")).toHaveLength(0);
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when an existing admin row carries only a substring marker", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].notes = `Real admin — see VAM UAT fixture ${ACCOUNT_TAG} ticket`;
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /notes does not exactly equal the fixture marker/
    );
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when an existing admin row has the wrong role", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].role = "viewer";
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/expected admin/);
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when a scope row role does not exact-match", async () => {
    seedProvisioned(world);
    world.tables.admin_scope_access[0].role = "read";
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /admin_scope_access exists .* does not exact-match/
    );
  });

  it("aborts when the scope lookup is ambiguous", async () => {
    const links = seedProvisioned(world);
    world.tables.admin_scope_access.push({
      id: "scope-duplicate",
      user_id: links.admin,
      program_id: PROGRAM_ID,
      season_id: SEASON_ID,
      role: "read",
      status: "active"
    });
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /admin_scope_access read failed or ambiguity detected/
    );
  });

  it("aborts when the person row marker belongs to no run", async () => {
    seedProvisioned(world);
    world.tables.people[0].data_quality_flags = `${PERSON_A.activeMarker} plus notes`;
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /does not exactly equal a run 20260805-01 marker/
    );
  });

  it("aborts when an existing membership role/status does not exact-match", async () => {
    seedProvisioned(world);
    world.tables.person_season_memberships[0].status = "cancelled";
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /person_season_memberships exists .* does not exact-match/
    );
  });

  it("provisions the six stable accounts plus one per-run person", async () => {
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });

    expect(world.authUsers).toHaveLength(6);
    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.tables.admin_scope_access).toHaveLength(5);
    expect(world.tables.people).toHaveLength(1);
    expect(world.tables.person_season_memberships).toHaveLength(1);

    const nonadminId = world.authUsers.find((u: any) => u.email === email("nonadmin")).id;
    expect(world.tables.admin_users.some((r: any) => r.email === email("nonadmin"))).toBe(false);
    expect(world.tables.admin_scope_access.some((r: any) => r.user_id === nonadminId)).toBe(false);
    expect(world.tables.admin_users.every((r: any) => r.notes === ACCOUNT_NOTES_MARKER)).toBe(true);
    expect(world.tables.admin_users.every((r: any) => ["active", "inactive"].includes(r.status))).toBe(true);
    expect(world.tables.people[0].data_quality_flags).toBe(PERSON_A.activeMarker);
    expect(world.tables.people[0].email_primary).toBe(PERSON_A.email_primary);
  });
});

describe("create-uat-fixtures — retained row re-provisioning", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  function seedRetainedAdminRow(overrides: any = {}) {
    world.tables.admin_users.push({
      id: "admin-retained",
      auth_user_id: null,
      email: email("admin"),
      full_name: "UAT Active Admin",
      role: "admin",
      status: "inactive",
      notes: ACCOUNT_NOTES_MARKER,
      ...overrides
    });
  }

  it("relinks a retained fixture row to the newly created Auth user by exact id", async () => {
    seedRetainedAdminRow();
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });

    const newAuthId = world.authUsers.find((u: any) => u.email === email("admin")).id;
    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row.auth_user_id).toBe(newAuthId);
    expect(row.status).toBe("active");
    expect(row.notes).toBe(ACCOUNT_NOTES_MARKER);

    const relink = writesTo(world, "admin_users", "update")[0];
    expect(relink.ids).toEqual(["admin-retained"]);
    expect(relink.filters).toEqual([
      ["eq", "id", "admin-retained"],
      ["is", "auth_user_id", null]
    ]);
    expect(world.tables.admin_users.filter((r: any) => r.email === email("admin"))).toHaveLength(1);
  });

  it("aborts instead of relinking when the row holds a different non-null auth UUID", async () => {
    seedRetainedAdminRow({ auth_user_id: "auth-someone-else" });
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /is not a retained fixture row/
    );
    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row.auth_user_id).toBe("auth-someone-else");
    expect(writesTo(world, "admin_users", "update")).toHaveLength(0);
  });

  it("refuses to relink a retained-looking row that lacks the exact marker", async () => {
    seedRetainedAdminRow({ notes: "left over from something else" });
    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(
      /notes does not exactly equal the fixture marker/
    );
    expect(writesTo(world, "admin_users", "update")).toHaveLength(0);
  });

  it("reverts a relink rather than deleting the pre-existing row when a later step fails", async () => {
    seedRetainedAdminRow();
    world.fault = (state: QueryState) =>
      state.table === "people" && state.op === "insert" ? { data: null, error: { message: "people boom" } } : null;

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row).toBeDefined();
    expect(row.auth_user_id).toBeNull();
    expect(row.status).toBe("inactive");
    expect(row.notes).toBe(ACCOUNT_NOTES_MARKER);
    expect(writesTo(world, "admin_users", "delete").flatMap((w: any) => w.ids)).not.toContain("admin-retained");
  });
});

describe("create-uat-fixtures — malformed success responses", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("recovers and compensates an Auth user created behind a malformed response", async () => {
    world.authCreateResult = (payload: any, w: any) => {
      const user = { id: "auth-orphan", email: payload.email, user_metadata: payload.user_metadata };
      w.authUsers.push(user);
      w.authOps.push({ op: "create", email: payload.email, id: user.id });
      w.order.push("auth:create");
      return { data: null, error: null };
    };

    const error = await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A }).catch((e: any) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered auth-orphan by exact email and fixture metadata/);
    expect(world.authOps).toContainEqual({ op: "delete", id: "auth-orphan" });
    expect(world.authUsers).toHaveLength(0);
  });

  it("reports an unresolved Auth write when the created user cannot be identified", async () => {
    world.authCreateResult = () => ({ data: null, error: null });

    const error = await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A }).catch((e: any) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/could not be identified. Possible unresolved Auth write/);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
  });

  it("recovers an inserted admin row by exact email and marker, then rolls it back", async () => {
    world.mangle = (state: QueryState) =>
      state.table === "admin_users" && state.op === "insert" ? { data: null, error: null } : undefined;

    const error = await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A }).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered row admin_users-\d+ by exact identity/);

    const recovery = world.queries.find(
      (q: QueryState) => q.table === "admin_users" && q.op === "select" && !q.single && !q.head
    );
    expect(recovery!.filters).toEqual([
      ["eq", "email", email("admin")],
      ["eq", "notes", ACCOUNT_NOTES_MARKER]
    ]);
    expect(world.tables.admin_users).toHaveLength(0);
    expect(world.authUsers).toHaveLength(0);
  });

  it("recovers an inserted person row by exact email and run marker", async () => {
    world.mangle = (state: QueryState) =>
      state.table === "people" && state.op === "insert" ? { data: null, error: null } : undefined;

    const error = await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A }).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered row people-\d+ by exact identity/);

    const recovery = world.queries.find(
      (q: QueryState) => q.table === "people" && q.op === "select" && !q.single && !q.head
    );
    expect(recovery!.filters).toEqual([
      ["eq", "email_primary", PERSON_A.email_primary],
      ["eq", "data_quality_flags", PERSON_A.activeMarker]
    ]);
    expect(world.tables.people).toHaveLength(0);
  });

  it("fails closed when the recovery lookup is ambiguous", async () => {
    world.mangle = (state: QueryState, result: any, w: any) => {
      if (state.table !== "admin_scope_access" || state.op !== "insert") return undefined;
      const inserted = w.tables.admin_scope_access.find((r: any) => r.id === result.data.id);
      w.tables.admin_scope_access.push({ ...inserted, id: "scope-duplicate-write" });
      return { data: null, error: null };
    };

    const error = await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A }).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/matched 2 rows. Ambiguous, unresolved write state/);
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
  });
});

describe("create-uat-fixtures — per-Auth rollback gating", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  /** Fail after every account exists, and pin every admin row via the audit log. */
  function failAfterAccountsWithPinnedAdmins(extra: (state: QueryState) => any) {
    world.fault = (state: QueryState) => {
      if (state.table === "people" && state.op === "insert") {
        return { data: null, error: { message: "people boom" } };
      }
      if (state.table === "admin_audit_log" && state.head) {
        return { count: 1, error: null };
      }
      return extra(state);
    };
  }

  it("retains an Auth user when its admin row clear-link update errors", async () => {
    failAfterAccountsWithPinnedAdmins((state) =>
      state.table === "admin_users" && state.op === "update"
        ? { data: null, error: { message: "clear-link network error" } }
        : null
    );

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const adminAuthId = authIdFor(world, "admin");
    expect(deletedAuthIds(world)).not.toContain(adminAuthId);
    expect(logger.all()).toMatch(new RegExp(`\\[keep\\] auth\\.users ${adminAuthId} retained`));
    expect(logger.all()).toMatch(/still holds its auth_user_id/);
  });

  it("retains an Auth user when the clear-link update reports zero affected rows", async () => {
    failAfterAccountsWithPinnedAdmins((state) =>
      state.table === "admin_users" && state.op === "update" ? { data: [], error: null } : null
    );

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const adminAuthId = authIdFor(world, "admin");
    expect(deletedAuthIds(world)).not.toContain(adminAuthId);
    expect(logger.all()).toMatch(/0 row\(s\) affected/);
  });

  it("retains an Auth user when the clear-link update reports more than one affected row", async () => {
    failAfterAccountsWithPinnedAdmins((state) =>
      state.table === "admin_users" && state.op === "update"
        ? { data: [{ id: "one" }, { id: "two" }], error: null }
        : null
    );

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const adminAuthId = authIdFor(world, "admin");
    expect(deletedAuthIds(world)).not.toContain(adminAuthId);
    expect(logger.all()).toMatch(/2 row\(s\) affected/);
  });

  it("deletes unblocked Auth users while retaining blocked ones in the same rollback", async () => {
    failAfterAccountsWithPinnedAdmins((state) =>
      state.table === "admin_users" && state.op === "update" ? { data: [], error: null } : null
    );

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    // nonadmin has no admin row, so nothing references its UUID: it is deleted.
    const nonadminAuthId = authIdFor(world, "nonadmin");
    expect(deletedAuthIds(world)).toEqual([nonadminAuthId]);

    // Every account that owns a pinned admin row is retained.
    for (const slug of ["admin", "reviewer", "support", "viewer", "inactive"]) {
      expect(deletedAuthIds(world)).not.toContain(authIdFor(world, slug));
    }
  });

  it("names every retained Auth UUID in the rollback summary and ends non-zero", async () => {
    failAfterAccountsWithPinnedAdmins((state) =>
      state.table === "admin_users" && state.op === "update" ? { data: [], error: null } : null
    );

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const retained = ["admin", "reviewer", "support", "viewer", "inactive"].map((s) => authIdFor(world, s));
    const summary = logger.errors.find((line: string) => line.includes("Retained auth.users requiring manual review"));
    expect(summary).toBeDefined();
    for (const id of retained) expect(summary).toContain(id);
    // A rejected run is what makes the CLI exit non-zero.
    expect(logger.all()).toMatch(/\[ROLLBACK\] Completed with \d+ failure\(s\)/);
  });

  it("retains an Auth user when its scope row could not be deleted", async () => {
    world.fault = (state: QueryState) => {
      if (state.table === "people" && state.op === "insert") {
        return { data: null, error: { message: "people boom" } };
      }
      if (state.table === "admin_scope_access" && state.op === "delete") {
        return { data: null, error: { message: "scope delete blocked" } };
      }
      return null;
    };

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    const adminAuthId = authIdFor(world, "admin");
    expect(deletedAuthIds(world)).not.toContain(adminAuthId);
    expect(logger.all()).toMatch(/admin_scope_access .* could not be deleted/);
  });

  it("deletes every Auth user when the whole rollback succeeds", async () => {
    world.fault = (state: QueryState) =>
      state.table === "people" && state.op === "insert" ? { data: null, error: { message: "people boom" } } : null;

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    expect(deletedAuthIds(world)).toHaveLength(6);
    expect(world.authUsers).toHaveLength(0);
    expect(logger.all()).not.toContain("Retained auth.users requiring manual review");
  });
});

describe("create-uat-fixtures — rollback safety", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("keeps the row and reports a failure when the pin count query errors", async () => {
    world.fault = (state: QueryState) => {
      if (state.table === "person_season_memberships" && state.op === "insert") {
        return { data: null, error: { message: "membership boom" } };
      }
      if (state.table === "person_season_membership_log" && state.head) {
        return { count: null, error: { message: "count boom" } };
      }
      return null;
    };

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/membership boom/);

    expect(writesTo(world, "people", "delete")).toHaveLength(0);
    expect(world.tables.people).toHaveLength(1);
    expect(logger.all()).toMatch(/pin state unresolved .* retaining row rather than deleting blind/);
    expect(writesTo(world, "admin_scope_access", "delete").length).toBeGreaterThan(0);
    expect(deletedAuthIds(world)).toHaveLength(6);
    expect(logger.all()).toMatch(/\[ROLLBACK\] Completed with \d+ failure\(s\)/);
  });

  it("continues rolling back independent objects after one rollback failure", async () => {
    world.fault = (state: QueryState) => {
      if (state.table === "people" && state.op === "insert") {
        return { data: null, error: { message: "people boom" } };
      }
      if (state.table === "admin_users" && state.op === "delete") {
        return { data: null, error: { message: "admin delete boom" } };
      }
      return null;
    };

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/people boom/);

    expect(writesTo(world, "admin_scope_access", "delete").length).toBeGreaterThan(0);
    // Admin rows survived, so their Auth users are retained; nonadmin's is not.
    expect(deletedAuthIds(world)).toEqual([authIdFor(world, "nonadmin")]);
    expect(logger.all()).toMatch(/\[ROLLBACK\] Completed with \d+ failure\(s\)/);
  });

  it("rolls back in FK dependency order with Auth deletion last", async () => {
    world.mangle = (state: QueryState) =>
      state.table === "person_season_memberships" && state.op === "insert" ? { data: null, error: null } : undefined;

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/queued it for compensation/);

    const rollbackOrder = world.order.slice(world.order.indexOf("person_season_memberships:delete"));
    const stages = rollbackOrder.filter((entry: string) =>
      ["person_season_memberships:delete", "people:delete", "admin_scope_access:delete", "admin_users:delete", "auth:delete"].includes(entry)
    );
    const firstIndex = (name: string) => stages.indexOf(name);
    expect(firstIndex("person_season_memberships:delete")).toBeLessThan(firstIndex("people:delete"));
    expect(firstIndex("people:delete")).toBeLessThan(firstIndex("admin_scope_access:delete"));
    expect(firstIndex("admin_scope_access:delete")).toBeLessThan(firstIndex("admin_users:delete"));
    expect(firstIndex("admin_users:delete")).toBeLessThan(firstIndex("auth:delete"));
    expect(stages[stages.length - 1]).toBe("auth:delete");
  });

  it("never deletes or mutates objects that pre-existed the run", async () => {
    const links = seedProvisioned(world);
    world.fault = (state: QueryState) =>
      state.table === "person_season_memberships" && state.op === "insert"
        ? { data: null, error: { message: "membership boom" } }
        : null;
    world.tables.person_season_memberships = [];

    await expect(runFixtures(db, true, PASSWORD, logger, { runId: RUN_A })).rejects.toThrow(/membership boom/);

    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.tables.admin_scope_access).toHaveLength(5);
    expect(world.tables.people).toHaveLength(1);
    expect(world.authUsers).toHaveLength(6);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
    expect(world.writes.filter((w: any) => w.op === "delete" || w.op === "update")).toHaveLength(0);
    for (const account of ACCOUNTS.filter((a: any) => a.adminRole)) {
      const scope = world.tables.admin_scope_access.find((r: any) => r.id === `scope-seed-${account.slug}`);
      expect(scope.user_id).toBe(links[account.slug]);
      expect(scope.role).toBe(account.scopeRole);
    }
  });

  it("performs zero mutations in dry-run mode", async () => {
    await runFixtures(db, false, PASSWORD, logger, { runId: RUN_A });

    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(world.authUsers).toHaveLength(0);
    expect(world.queries.every((q: QueryState) => q.op === "select")).toBe(true);
    expect(logger.all()).toMatch(/Planned \d+ write\(s\)/);
  });
});

describe("create-uat-fixtures — dry-run schema reporting", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("separates plan and lookup results from schema verification", async () => {
    await runFixtures(db, false, PASSWORD, logger, { runId: RUN_A });

    expect(logger.all()).toContain("SCRIPT PLAN PASS");
    expect(logger.all()).toContain("LIVE DATA LOOKUP PASS");
    expect(logger.all()).toContain("SCHEMA PREFLIGHT NOT VERIFIED");
    expect(logger.all()).toContain("scripts/uat-fixture-staging-preflight.sql");
    // A REST dry-run must never claim the live schema is compatible.
    expect(logger.all()).not.toMatch(/SCHEMA PREFLIGHT PASS/);
    expect(logger.all()).not.toMatch(/schema compatible/i);
  });

  it("reports schema preflight as operator-acknowledged only when explicitly confirmed", async () => {
    await runFixtures(db, false, PASSWORD, logger, { runId: RUN_A, schemaPreflightVerified: true });

    expect(logger.all()).toContain("SCHEMA PREFLIGHT ACKNOWLEDGED (operator-confirmed, out of band)");
    expect(logger.all()).not.toContain("SCHEMA PREFLIGHT NOT VERIFIED");
    expect(logger.all()).not.toMatch(/SCHEMA PREFLIGHT PASS/);
  });

  it("does not print schema wording at all in apply mode", async () => {
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });
    expect(logger.all()).not.toMatch(/SCHEMA PREFLIGHT/);
  });
});

describe("cleanup-uat-fixtures — ownership verification", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("refuses to run without a valid run id, before any network call", async () => {
    await expect(runCleanup(db, true, logger, {})).rejects.toThrow(/VAM_UAT_RUN_ID is not set/);
    await expect(runCleanup(db, true, logger, { runId: "Bad-ID" })).rejects.toThrow(/not in the accepted format/);
    expect(world.queries).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
  });

  it("aborts when an Auth user lacks the exact fixture metadata marker", async () => {
    seedProvisioned(world);
    world.authUsers[0].user_metadata = { vam_uat_fixture: "20260101" };
    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(
      /does not exactly equal the account tag/
    );
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
    expect(writesTo(world, "admin_users")).toHaveLength(0);
  });

  it("aborts when admin notes only mention the marker as free text", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].notes = `Real admin — see VAM UAT fixture ${ACCOUNT_TAG} ticket`;
    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(
      /notes does not exactly equal the fixture marker/
    );
    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
  });

  it("aborts when the person marker is not exact for this run", async () => {
    seedProvisioned(world);
    world.tables.people[0].data_quality_flags = `${PERSON_A.activeMarker} and more`;
    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(
      /does not exactly equal a run 20260805-01 marker/
    );
    expect(world.tables.people).toHaveLength(1);
    expect(world.writes).toHaveLength(0);
  });

  it("performs zero mutations in dry-run mode", async () => {
    seedProvisioned(world);
    await runCleanup(db, false, logger, { runId: RUN_A });
    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(world.authUsers).toHaveLength(6);
  });
});

describe("cleanup-uat-fixtures — retained rows and Auth ordering", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("clears auth_user_id on a pinned admin row before deleting the Auth user", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");

    await runCleanup(db, true, logger, { runId: RUN_A });

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-seed-admin");
    expect(row).toBeDefined();
    expect(row.status).toBe("inactive");
    expect(row.auth_user_id).toBeNull();
    expect(row.notes).toBe(ACCOUNT_NOTES_MARKER);

    const retire = writesTo(world, "admin_users", "update")[0];
    expect(retire.payload).toEqual({ status: "inactive", auth_user_id: null });
    expect(retire.ids).toEqual(["admin-seed-admin"]);

    const retireIndex = world.order.indexOf("admin_users:update");
    const authDeleteIndex = world.order.indexOf("auth:delete");
    expect(retireIndex).toBeGreaterThanOrEqual(0);
    expect(retireIndex).toBeLessThan(authDeleteIndex);
    expect(world.authUsers.some((u: any) => u.email === email("admin"))).toBe(false);
  });

  it("retains the Auth user when the link cannot be cleared", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    world.fault = (state: QueryState) =>
      state.table === "admin_users" && state.op === "update"
        ? { data: null, error: { message: "update blocked" } }
        : null;

    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(/Teardown completed with 1 failure/);

    expect(logger.all()).toMatch(/auth\.users retained to avoid a dangling link/);
    expect(world.authUsers.some((u: any) => u.email === email("admin"))).toBe(true);
    expect(deletedAuthIds(world)).not.toContain("auth-seed-admin");
  });

  it("leaves a re-provisionable retained row that create can relink", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    await runCleanup(db, true, logger, { runId: RUN_A });

    const secondLogger = createLogger();
    await runFixtures(db, true, PASSWORD, secondLogger, { runId: RUN_B });

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-seed-admin");
    const newAuth = world.authUsers.find((u: any) => u.email === email("admin"));
    expect(row.auth_user_id).toBe(newAuth.id);
    expect(row.status).toBe("active");
    expect(world.tables.admin_users.filter((r: any) => r.email === email("admin"))).toHaveLength(1);
  });

  it("applies the run's retained marker to a log-pinned person and cancels its membership", async () => {
    seedProvisioned(world);
    pinMembership(world, `membership-seed-${RUN_A}`, `person-seed-${RUN_A}`);

    await runCleanup(db, true, logger, { runId: RUN_A });

    const person = world.tables.people.find((r: any) => r.id === `person-seed-${RUN_A}`);
    expect(person.data_quality_flags).toBe(PERSON_A.retainedMarker);
    const membership = world.tables.person_season_memberships.find((r: any) => r.id === `membership-seed-${RUN_A}`);
    expect(membership.status).toBe("cancelled");
    expect(membership.notes).toBe(ACCOUNT_NOTES_MARKER);
  });

  it("never deletes or updates append-only audit or log rows", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    pinMembership(world, `membership-seed-${RUN_A}`, `person-seed-${RUN_A}`);

    await runCleanup(db, true, logger, { runId: RUN_A });

    const immutable = world.writes.filter((w: any) =>
      ["admin_audit_log", "person_season_membership_log"].includes(w.table)
    );
    expect(immutable).toHaveLength(0);
    expect(world.tables.admin_audit_log).toHaveLength(1);
    expect(world.tables.person_season_membership_log).toHaveLength(1);
  });
});

describe("cleanup-uat-fixtures — exact scope deletion", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("deletes only the exact fixture scope and preserves unrelated scopes", async () => {
    const links = seedProvisioned(world);
    world.tables.admin_scope_access.push({
      id: "scope-unrelated",
      user_id: links.admin,
      program_id: "other-program-uuid",
      season_id: "other-season-uuid",
      role: "read",
      status: "active"
    });

    await runCleanup(db, true, logger, { runId: RUN_A });

    expect(world.tables.admin_scope_access.map((r: any) => r.id)).toEqual(["scope-unrelated"]);
    const scopeDeletes = writesTo(world, "admin_scope_access", "delete");
    for (const write of scopeDeletes) {
      expect(write.filters).toEqual([["eq", "id", write.ids[0]]]);
      expect(write.ids).toHaveLength(1);
    }
    expect(scopeDeletes.flatMap((w: any) => w.ids)).not.toContain("scope-unrelated");
    expect(logger.all()).toMatch(/unexpected admin_scope_access scope-unrelated .* left untouched/);
    expect(world.authUsers.some((u: any) => u.email === email("admin"))).toBe(true);
    expect(logger.all()).toMatch(/auth\.users auth-seed-admin retained/);
  });

  it("deletes nothing when the fixture scope match is ambiguous", async () => {
    const links = seedProvisioned(world);
    world.tables.admin_scope_access.push({
      id: "scope-duplicate",
      user_id: links.admin,
      program_id: PROGRAM_ID,
      season_id: SEASON_ID,
      role: "full_access",
      status: "inactive"
    });

    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(/Teardown completed with 1 failure/);

    expect(world.tables.admin_scope_access.some((r: any) => r.id === "scope-seed-admin")).toBe(true);
    expect(world.tables.admin_scope_access.some((r: any) => r.id === "scope-duplicate")).toBe(true);
    expect(logger.all()).toMatch(/matched 2 fixture rows; ambiguous, nothing deleted/);
  });
});

describe("cleanup-uat-fixtures — resilience and idempotency", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  it("continues tearing down independent accounts after one operational failure", async () => {
    seedProvisioned(world);
    world.fault = (state: QueryState) =>
      state.table === "admin_users" && state.op === "delete" && state.filters.some(([, , v]) => v === "admin-seed-reviewer")
        ? { data: null, error: { message: "reviewer delete blocked" } }
        : null;

    await expect(runCleanup(db, true, logger, { runId: RUN_A })).rejects.toThrow(/Teardown completed with 1 failure/);

    expect(world.tables.admin_users.map((r: any) => r.id)).toEqual(["admin-seed-reviewer"]);
    expect(world.authUsers.map((u: any) => u.email)).toEqual([email("reviewer")]);
    expect(world.tables.admin_users[0].auth_user_id).toBe(world.authUsers[0].id);
    expect(world.tables.admin_scope_access).toHaveLength(0);
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
  });

  it("is idempotent: a second run performs zero mutations", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    pinMembership(world, `membership-seed-${RUN_A}`, `person-seed-${RUN_A}`);

    await runCleanup(db, true, logger, { runId: RUN_A });
    expect(world.writes.length).toBeGreaterThan(0);

    world.writes = [];
    world.authOps = [];
    const secondLogger = createLogger();
    await runCleanup(db, true, secondLogger, { runId: RUN_A });

    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(secondLogger.all()).toMatch(/already retained \(inactive, auth link cleared\)/);
    expect(secondLogger.all()).toMatch(/already carries the run 20260805-01 retained marker/);
  });

  it("removes every detached fixture object on a clean teardown", async () => {
    seedProvisioned(world);
    await runCleanup(db, true, logger, { runId: RUN_A });

    expect(world.authUsers).toHaveLength(0);
    expect(world.tables.admin_users).toHaveLength(0);
    expect(world.tables.admin_scope_access).toHaveLength(0);
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
  });
});

describe("lifecycle run separation", () => {
  let world: any;
  let db: any;
  let logger: any;

  beforeEach(() => {
    world = createWorld();
    db = createDb(world);
    logger = createLogger();
  });

  /** Provision run A, exercise lifecycle so its person becomes log-pinned, tear it down. */
  async function completeRunA() {
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });
    const personA = world.tables.people[0];
    const membershipA = world.tables.person_season_memberships[0];
    pinMembership(world, membershipA.id, personA.id);
    await runCleanup(db, true, logger, { runId: RUN_A });
    return { personAId: personA.id, membershipAId: membershipA.id };
  }

  it("retains run A's person after its lifecycle teardown", async () => {
    const { personAId, membershipAId } = await completeRunA();

    const personA = world.tables.people.find((r: any) => r.id === personAId);
    expect(personA).toBeDefined();
    expect(personA.data_quality_flags).toBe(PERSON_A.retainedMarker);
    expect(personA.email_primary).toBe(PERSON_A.email_primary);
    const membershipA = world.tables.person_season_memberships.find((r: any) => r.id === membershipAId);
    expect(membershipA.status).toBe("cancelled");
    // Accounts were detached, so they were fully removed rather than accumulated.
    expect(world.authUsers).toHaveLength(0);
    expect(world.tables.admin_users).toHaveLength(0);
  });

  it("provisions run B on the same stable accounts without touching run A's person", async () => {
    const { personAId } = await completeRunA();
    const runBLogger = createLogger();

    await runFixtures(db, true, PASSWORD, runBLogger, { runId: RUN_B });

    // Six stable accounts again — no accumulation across runs.
    expect(world.authUsers).toHaveLength(6);
    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.authUsers.map((u: any) => u.email).sort()).toEqual(ACCOUNTS.map((a: any) => email(a.slug)).sort());
    expect(world.tables.admin_users.every((r: any) => r.notes === ACCOUNT_NOTES_MARKER)).toBe(true);

    // Run B has its own person; run A's retained person is untouched.
    const personB = world.tables.people.find((r: any) => r.email_primary === PERSON_B.email_primary);
    expect(personB.data_quality_flags).toBe(PERSON_B.activeMarker);
    const personA = world.tables.people.find((r: any) => r.id === personAId);
    expect(personA.data_quality_flags).toBe(PERSON_A.retainedMarker);
    expect(world.tables.people).toHaveLength(2);
  });

  it("keeps account emails and markers identical across run A and run B", async () => {
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });
    const unique = (values: any[]) => Array.from(new Set(values));
    const afterA = {
      emails: world.authUsers.map((u: any) => u.email).sort(),
      adminEmails: world.tables.admin_users.map((r: any) => r.email).sort(),
      markers: unique(world.tables.admin_users.map((r: any) => r.notes)),
      metadata: unique(world.authUsers.map((u: any) => u.user_metadata.vam_uat_fixture))
    };

    await runCleanup(db, true, logger, { runId: RUN_A });
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_B });

    expect(world.authUsers.map((u: any) => u.email).sort()).toEqual(afterA.emails);
    expect(world.tables.admin_users.map((r: any) => r.email).sort()).toEqual(afterA.adminEmails);
    expect(unique(world.tables.admin_users.map((r: any) => r.notes))).toEqual(afterA.markers);
    expect(unique(world.authUsers.map((u: any) => u.user_metadata.vam_uat_fixture))).toEqual(afterA.metadata);
    expect(afterA.markers).toEqual([ACCOUNT_NOTES_MARKER]);
  });

  it("cleanup of run B never reads or mutates run A's person", async () => {
    const { personAId } = await completeRunA();
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_B });

    world.writes = [];
    world.queries = [];
    const runBLogger = createLogger();
    await runCleanup(db, true, runBLogger, { runId: RUN_B });

    // No write touched run A's person row.
    const touchedIds = world.writes.flatMap((w: any) => w.ids ?? []);
    expect(touchedIds).not.toContain(personAId);
    // Every people lookup was scoped to run B's exact email.
    const peopleLookups = world.queries.filter((q: QueryState) => q.table === "people");
    expect(peopleLookups.length).toBeGreaterThan(0);
    for (const lookup of peopleLookups) {
      const emailFilter = lookup.filters.find((filter: Filter) => filter[1] === "email_primary");
      if (emailFilter) expect(emailFilter[2]).toBe(PERSON_B.email_primary);
    }
    const personA = world.tables.people.find((r: any) => r.id === personAId);
    expect(personA.data_quality_flags).toBe(PERSON_A.retainedMarker);
  });

  it("refuses to reuse a spent run id and says a new one is needed", async () => {
    await completeRunA();

    const rerunLogger = createLogger();
    await expect(runFixtures(db, true, PASSWORD, rerunLogger, { runId: RUN_A })).rejects.toThrow(
      /retained, log-pinned person of UAT run 20260805-01\. .*Start a new run with a fresh VAM_UAT_RUN_ID/
    );
  });

  it("resumes a run whose person is still active", async () => {
    await runFixtures(db, true, PASSWORD, logger, { runId: RUN_A });
    const personAId = world.tables.people[0].id;

    world.writes = [];
    const resumeLogger = createLogger();
    await runFixtures(db, true, PASSWORD, resumeLogger, { runId: RUN_A });

    // Everything already existed, so a resume is a no-op.
    expect(world.writes).toHaveLength(0);
    expect(world.tables.people).toHaveLength(1);
    expect(world.tables.people[0].id).toBe(personAId);
    expect(resumeLogger.all()).toMatch(/people row present/);
  });
});

describe("staging schema preflight SQL", () => {
  const raw = readFileSync(preflightSqlPath, "utf8");
  const withoutComments = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  // Split on statement separators only, ignoring semicolons inside string
  // literals (with '' escapes), so prose in a detail column cannot fool the
  // read-only assertions below.
  const statements = ((): string[] => {
    const out: string[] = [];
    let current = "";
    let inString = false;
    for (let i = 0; i < withoutComments.length; i += 1) {
      const ch = withoutComments[i];
      if (inString) {
        current += ch;
        if (ch === "'") {
          if (withoutComments[i + 1] === "'") current += withoutComments[++i];
          else inString = false;
        }
        continue;
      }
      if (ch === "'") {
        inString = true;
        current += ch;
      } else if (ch === ";") {
        out.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) out.push(current.trim());
    return out.filter(Boolean);
  })();

  it("contains only read-only statements", () => {
    expect(statements.length).toBeGreaterThan(0);
    const allowed = ["BEGIN", "SET", "WITH", "SELECT", "ROLLBACK"];
    for (const statement of statements) {
      const firstWord = statement.split(/\s+/)[0].toUpperCase();
      expect(allowed, `unexpected leading keyword in: ${statement.slice(0, 60)}`).toContain(firstWord);
    }
  });

  it("contains no DML or DDL", () => {
    expect(withoutComments).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(withoutComments).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(withoutComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(withoutComments).not.toMatch(/\bTRUNCATE\b/i);
    expect(withoutComments).not.toMatch(/\bALTER\s+(TABLE|INDEX|FUNCTION|POLICY|SEQUENCE)\b/i);
    expect(withoutComments).not.toMatch(/\bDROP\s+(TABLE|INDEX|FUNCTION|POLICY|CONSTRAINT|TRIGGER)\b/i);
    expect(withoutComments).not.toMatch(/\bCREATE\s+(TABLE|INDEX|FUNCTION|TRIGGER|POLICY|VIEW)\b/i);
    expect(withoutComments).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  it("opens a read-only transaction and ends with a rollback", () => {
    expect(statements[0].toUpperCase()).toBe("BEGIN");
    expect(statements[1].toUpperCase()).toBe("SET TRANSACTION READ ONLY");
    expect(statements[statements.length - 1].toUpperCase()).toBe("ROLLBACK");
    expect(withoutComments).not.toMatch(/\bCOMMIT\b/i);
  });

  it("emits explicit PASS/FAIL rows rather than raw data", () => {
    expect(withoutComments).toMatch(/'PASS'/);
    expect(withoutComments).toMatch(/'FAIL'/);
    expect(withoutComments).toMatch(/check_name/);
    expect(withoutComments).toMatch(/status/);
  });

  it("is parameterised by run id and checks the identities the scripts depend on", () => {
    expect(raw).toContain(":'run_id'");
    expect(withoutComments).toContain("vam_uat_person_run:");
    for (const slug of ["admin", "reviewer", "support", "viewer", "nonadmin", "inactive"]) {
      expect(withoutComments).toContain(email(slug));
    }
    expect(withoutComments).toContain("VAM UAT fixture 20260805");
    // The checks the REST dry-run provably cannot make.
    expect(withoutComments).toMatch(/admin_users\.status_vocabulary/);
    expect(withoutComments).toMatch(/data_quality_flags/);
    expect(withoutComments).toMatch(/confdeltype/);
    expect(withoutComments).toMatch(/indisunique/);
    expect(withoutComments).toContain("UEHM-S12");
    expect(withoutComments).toContain("UEHM-S12-B1");
  });

  it("documents how it must be executed, since PostgREST cannot run it", () => {
    expect(raw).toMatch(/psql/);
    expect(raw).toMatch(/-v run_id=/);
    expect(raw).toMatch(/PostgREST cannot run this/i);
  });
});

describe("create-uat-fixtures CLI safety guards", () => {
  const baseEnv = {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
    VAM_UAT_FIXTURE_PASSWORD: "longpassword123",
    VAM_UAT_RUN_ID: RUN_A
  };

  function runCli(env: NodeJS.ProcessEnv, args = "") {
    try {
      const stdout = execSync(`node "${createScript}" ${args}`.trim(), { env, stdio: "pipe" });
      return { code: 0, output: stdout.toString() };
    } catch (error: any) {
      return {
        code: error.status ?? 1,
        output: (error.stdout?.toString() ?? "") + (error.stderr?.toString() ?? "")
      };
    }
  }

  it("aborts with SAFETY ABORT when the host is not staging", () => {
    const result = runCli({ ...baseEnv, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("SAFETY ABORT");
    expect(result.output).toContain(`is not VAM OS staging (${STAGING_HOSTNAME})`);
    expect(result.output).not.toContain("MODE:");
  });

  it("aborts when the project ref appears only as a substring of a foreign URL", () => {
    const result = runCli({
      ...baseEnv,
      NEXT_PUBLIC_SUPABASE_URL: `https://evil.example.com/${STAGING_HOSTNAME}`
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("SAFETY ABORT");
    expect(result.output).toContain("is not VAM OS staging");
  });

  it("aborts before touching the network when the run id is missing", () => {
    const { VAM_UAT_RUN_ID, ...envWithoutRunId } = baseEnv;
    const result = runCli({ ...envWithoutRunId, NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_HOSTNAME}` });
    expect(result.code).toBe(1);
    expect(result.output).toContain("SAFETY ABORT");
    expect(result.output).toContain("VAM_UAT_RUN_ID is not set");
    expect(result.output).toContain("No network operation attempted");
    expect(result.output).not.toContain("MODE:");
  });

  it("aborts before touching the network when the run id is malformed", () => {
    const result = runCli({
      ...baseEnv,
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_HOSTNAME}`,
      VAM_UAT_RUN_ID: "bad run/id"
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("SAFETY ABORT");
    expect(result.output).toContain("not in the accepted format");
    expect(result.output).not.toContain("MODE:");
  });
});
