import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
// @ts-ignore - .mjs fixture scripts are untyped by design
import { runFixtures } from "../scripts/create-uat-fixtures.mjs";
// @ts-ignore
import { runCleanup } from "../scripts/cleanup-uat-fixtures.mjs";
// @ts-ignore
import * as fixtureCommon from "../scripts/uat-fixture-common.mjs";

const {
  ACCOUNTS,
  ACTIVE_MARKER,
  ADMIN_NOTES_MARKER,
  FIXTURE_TAG,
  PERSON,
  RETAINED_MARKER,
  STAGING_HOSTNAME,
  assertStagingHost,
  classifyFixtureMarker,
  email,
  isExactAdminNotesMarker,
  parseApplyMode
} = fixtureCommon as any;

const createScript = resolve(__dirname, "../scripts/create-uat-fixtures.mjs");

const PROGRAM_ID = "program-uuid-0001";
const SEASON_ID = "season-uuid-0001";
const BATCH_ID = "batch-uuid-0001";

// ---------------------------------------------------------------------------
// In-memory PostgREST + GoTrue double.
//
// Query state is captured per builder so assertions can inspect the exact
// filters, payloads and ids each stage used. Filters are genuinely applied, so
// a script that widens a delete or drops a filter fails these tests.
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
function seedProvisioned(world: any) {
  const links: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    const authUser = {
      id: `auth-seed-${account.slug}`,
      email: email(account.slug),
      user_metadata: { vam_uat_fixture: FIXTURE_TAG }
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
      notes: ADMIN_NOTES_MARKER
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
    id: "person-seed",
    full_name: PERSON.full_name,
    email_primary: PERSON.email_primary,
    source_sheets: "admin_manual_input",
    data_quality_flags: ACTIVE_MARKER
  });
  world.tables.person_season_memberships.push({
    id: "membership-seed",
    person_id: "person-seed",
    program_id: PROGRAM_ID,
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    role: PERSON.membershipRole,
    status: PERSON.membershipStatus,
    source: "manual",
    notes: ADMIN_NOTES_MARKER
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

  it("accepts only the two canonical data_quality_flags markers", () => {
    expect(classifyFixtureMarker(ACTIVE_MARKER)).toBe("active");
    expect(classifyFixtureMarker(RETAINED_MARKER)).toBe("retained");
    expect(classifyFixtureMarker(`prefix ${ACTIVE_MARKER}`)).toBe("none");
    expect(classifyFixtureMarker(`${ACTIVE_MARKER} suffix`)).toBe("none");
    expect(classifyFixtureMarker(`vam_uat_fixture:${FIXTURE_TAG}:other`)).toBe("none");
    expect(classifyFixtureMarker(undefined)).toBe("none");
    expect(classifyFixtureMarker(null)).toBe("none");
  });

  it("rejects free-text notes that merely mention the fixture marker", () => {
    expect(isExactAdminNotesMarker(ADMIN_NOTES_MARKER)).toBe(true);
    expect(isExactAdminNotesMarker(`Real admin — see VAM UAT fixture ${FIXTURE_TAG} ticket`)).toBe(false);
    expect(isExactAdminNotesMarker(`${ADMIN_NOTES_MARKER} — retained`)).toBe(false);
    expect(isExactAdminNotesMarker(null)).toBe(false);
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

  it("aborts when an existing Auth user lacks the exact metadata marker", async () => {
    world.authUsers.push({
      id: "auth-foreign",
      email: email("admin"),
      user_metadata: { vam_uat_fixture: "20260101" }
    });
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /does not exactly equal the fixture tag/
    );
    expect(world.authOps.filter((o: any) => o.op === "create")).toHaveLength(0);
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when an existing admin row carries only a substring marker", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].notes = `Real admin — see VAM UAT fixture ${FIXTURE_TAG} ticket`;
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /notes does not exactly equal the fixture marker/
    );
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when an existing admin row has the wrong role", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].role = "viewer";
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/expected admin/);
    expect(world.writes).toHaveLength(0);
  });

  it("aborts when a scope row role does not exact-match", async () => {
    seedProvisioned(world);
    world.tables.admin_scope_access[0].role = "read";
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
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
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /admin_scope_access read failed or ambiguity detected/
    );
  });

  it("aborts when the person row marker is not exact", async () => {
    seedProvisioned(world);
    world.tables.people[0].data_quality_flags = `${ACTIVE_MARKER} plus notes`;
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /does not exactly equal a fixture marker/
    );
  });

  it("aborts on a retained log-pinned person instead of transitioning its status", async () => {
    seedProvisioned(world);
    world.tables.people[0].data_quality_flags = RETAINED_MARKER;
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /retained, log-pinned fixture person .* Bump FIXTURE_TAG/
    );
    expect(writesTo(world, "people")).toHaveLength(0);
    expect(writesTo(world, "person_season_memberships")).toHaveLength(0);
  });

  it("aborts when an existing membership role/status does not exact-match", async () => {
    seedProvisioned(world);
    world.tables.person_season_memberships[0].status = "cancelled";
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /person_season_memberships exists .* does not exact-match/
    );
  });

  it("provisions the full six-account matrix on a clean staging database", async () => {
    await runFixtures(db, true, "pw-long-enough", logger);

    expect(world.authUsers).toHaveLength(6);
    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.tables.admin_scope_access).toHaveLength(5);
    expect(world.tables.people).toHaveLength(1);
    expect(world.tables.person_season_memberships).toHaveLength(1);

    const nonadminId = world.authUsers.find((u: any) => u.email === email("nonadmin")).id;
    expect(world.tables.admin_users.some((r: any) => r.email === email("nonadmin"))).toBe(false);
    expect(world.tables.admin_scope_access.some((r: any) => r.user_id === nonadminId)).toBe(false);
    expect(world.tables.admin_users.every((r: any) => r.notes === ADMIN_NOTES_MARKER)).toBe(true);
    expect(world.tables.admin_users.every((r: any) => ["active", "inactive"].includes(r.status))).toBe(true);
    expect(world.tables.people[0].data_quality_flags).toBe(ACTIVE_MARKER);
  });
});

describe("create-uat-fixtures — retained row re-provisioning (HIGH-1)", () => {
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
      notes: ADMIN_NOTES_MARKER,
      ...overrides
    });
  }

  it("relinks a retained fixture row to the newly created Auth user by exact id", async () => {
    seedRetainedAdminRow();
    await runFixtures(db, true, "pw-long-enough", logger);

    const newAuthId = world.authUsers.find((u: any) => u.email === email("admin")).id;
    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row.auth_user_id).toBe(newAuthId);
    expect(row.status).toBe("active");
    expect(row.notes).toBe(ADMIN_NOTES_MARKER);

    const relink = writesTo(world, "admin_users", "update")[0];
    expect(relink.ids).toEqual(["admin-retained"]);
    expect(relink.filters).toEqual([
      ["eq", "id", "admin-retained"],
      ["is", "auth_user_id", null]
    ]);
    // The retained row is reused, never duplicated.
    expect(world.tables.admin_users.filter((r: any) => r.email === email("admin"))).toHaveLength(1);
  });

  it("aborts instead of relinking when the row holds a different non-null auth UUID", async () => {
    seedRetainedAdminRow({ auth_user_id: "auth-someone-else" });
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /is not a retained fixture row/
    );
    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row.auth_user_id).toBe("auth-someone-else");
    expect(writesTo(world, "admin_users", "update")).toHaveLength(0);
  });

  it("refuses to relink a retained-looking row that lacks the exact marker", async () => {
    seedRetainedAdminRow({ notes: "left over from something else" });
    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(
      /notes does not exactly equal the fixture marker/
    );
    expect(writesTo(world, "admin_users", "update")).toHaveLength(0);
  });

  it("reverts a relink rather than deleting the pre-existing row when a later step fails", async () => {
    seedRetainedAdminRow();
    world.fault = (state: QueryState) =>
      state.table === "people" && state.op === "insert" ? { data: null, error: { message: "people boom" } } : null;

    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/people boom/);

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-retained");
    expect(row).toBeDefined();
    expect(row.auth_user_id).toBeNull();
    expect(row.status).toBe("inactive");
    expect(row.notes).toBe(ADMIN_NOTES_MARKER);
    expect(writesTo(world, "admin_users", "delete").flatMap((w: any) => w.ids)).not.toContain("admin-retained");
  });
});

describe("create-uat-fixtures — malformed success responses (HIGH-2)", () => {
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

    const error = await runFixtures(db, true, "pw-long-enough", logger).catch((e: any) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered auth-orphan by exact email and fixture metadata/);
    expect(world.authOps).toContainEqual({ op: "delete", id: "auth-orphan" });
    expect(world.authUsers).toHaveLength(0);
  });

  it("reports an unresolved Auth write when the created user cannot be identified", async () => {
    world.authCreateResult = () => ({ data: null, error: null });

    const error = await runFixtures(db, true, "pw-long-enough", logger).catch((e: any) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/could not be identified. Possible unresolved Auth write/);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
  });

  it("recovers an inserted admin row by exact email and marker, then rolls it back", async () => {
    world.mangle = (state: QueryState, result: any) =>
      state.table === "admin_users" && state.op === "insert" ? { data: null, error: null } : undefined;

    const error = await runFixtures(db, true, "pw-long-enough", logger).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered row admin_users-\d+ by exact identity/);

    const recovery = world.queries.find(
      (q: QueryState) => q.table === "admin_users" && q.op === "select" && !q.single && !q.head
    );
    expect(recovery!.filters).toEqual([
      ["eq", "email", email("admin")],
      ["eq", "notes", ADMIN_NOTES_MARKER]
    ]);
    expect(world.tables.admin_users).toHaveLength(0);
    expect(world.authUsers).toHaveLength(0);
  });

  it("recovers an inserted person row by exact email and marker", async () => {
    world.mangle = (state: QueryState) =>
      state.table === "people" && state.op === "insert" ? { data: null, error: null } : undefined;

    const error = await runFixtures(db, true, "pw-long-enough", logger).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/recovered row people-\d+ by exact identity/);
    expect(world.tables.people).toHaveLength(0);
  });

  it("fails closed when the recovery lookup is ambiguous", async () => {
    world.mangle = (state: QueryState, result: any, w: any) => {
      if (state.table !== "admin_scope_access" || state.op !== "insert") return undefined;
      const inserted = w.tables.admin_scope_access.find((r: any) => r.id === result.data.id);
      w.tables.admin_scope_access.push({ ...inserted, id: "scope-duplicate-write" });
      return { data: null, error: null };
    };

    const error = await runFixtures(db, true, "pw-long-enough", logger).catch((e: any) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/matched 2 rows. Ambiguous, unresolved write state/);
    // Provisioning stopped: no person or membership was attempted afterwards.
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
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

  it("keeps the row and reports a failure when the pin count query errors (MEDIUM-1)", async () => {
    world.fault = (state: QueryState) => {
      if (state.table === "person_season_memberships" && state.op === "insert") {
        return { data: null, error: { message: "membership boom" } };
      }
      if (state.table === "person_season_membership_log" && state.head) {
        return { count: null, error: { message: "count boom" } };
      }
      return null;
    };

    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/membership boom/);

    // The person created this run must NOT be blind-deleted on an unresolved pin state.
    expect(writesTo(world, "people", "delete")).toHaveLength(0);
    expect(world.tables.people).toHaveLength(1);
    expect(logger.all()).toMatch(/pin state unresolved .* retaining row rather than deleting blind/);
    // Independent objects still roll back, and the run still ends non-zero.
    expect(writesTo(world, "admin_scope_access", "delete").length).toBeGreaterThan(0);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(6);
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

    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/people boom/);

    expect(writesTo(world, "admin_scope_access", "delete").length).toBeGreaterThan(0);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(6);
    expect(logger.all()).toMatch(/\[ROLLBACK\] Completed with \d+ failure\(s\)/);
  });

  it("rolls back in FK dependency order with Auth deletion last", async () => {
    world.mangle = (state: QueryState) =>
      state.table === "person_season_memberships" && state.op === "insert" ? { data: null, error: null } : undefined;

    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/queued it for compensation/);

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
    // Force a fresh membership insert attempt against the pre-existing person.
    world.tables.person_season_memberships = [];

    await expect(runFixtures(db, true, "pw-long-enough", logger)).rejects.toThrow(/membership boom/);

    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.tables.admin_scope_access).toHaveLength(5);
    expect(world.tables.people).toHaveLength(1);
    expect(world.authUsers).toHaveLength(6);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
    expect(world.writes.filter((w: any) => w.op === "delete" || w.op === "update")).toHaveLength(0);
    // Each pre-existing scope is still owned by its original Auth user.
    for (const account of ACCOUNTS.filter((a: any) => a.adminRole)) {
      const scope = world.tables.admin_scope_access.find((r: any) => r.id === `scope-seed-${account.slug}`);
      expect(scope.user_id).toBe(links[account.slug]);
      expect(scope.role).toBe(account.scopeRole);
    }
  });

  it("performs zero mutations in dry-run mode", async () => {
    await runFixtures(db, false, "pw-long-enough", logger);

    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(world.authUsers).toHaveLength(0);
    expect(world.queries.every((q: QueryState) => q.op === "select")).toBe(true);
    expect(logger.all()).toMatch(/Planned \d+ write\(s\)/);
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

  it("aborts when an Auth user lacks the exact fixture metadata marker", async () => {
    seedProvisioned(world);
    world.authUsers[0].user_metadata = { vam_uat_fixture: "20260101" };
    await expect(runCleanup(db, true, logger)).rejects.toThrow(/does not exactly equal the fixture tag/);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
    expect(writesTo(world, "admin_users")).toHaveLength(0);
  });

  it("aborts when admin notes only mention the marker as free text", async () => {
    seedProvisioned(world);
    world.tables.admin_users[0].notes = `Real admin — see VAM UAT fixture ${FIXTURE_TAG} ticket`;
    await expect(runCleanup(db, true, logger)).rejects.toThrow(/notes does not exactly equal the fixture marker/);
    expect(world.tables.admin_users).toHaveLength(5);
    expect(world.authOps.filter((o: any) => o.op === "delete")).toHaveLength(0);
  });

  it("aborts when the person marker is not exact", async () => {
    seedProvisioned(world);
    world.tables.people[0].data_quality_flags = `${ACTIVE_MARKER} and more`;
    await expect(runCleanup(db, true, logger)).rejects.toThrow(/does not exactly equal a fixture marker/);
    expect(world.tables.people).toHaveLength(1);
    expect(world.writes).toHaveLength(0);
  });

  it("performs zero mutations in dry-run mode", async () => {
    seedProvisioned(world);
    await runCleanup(db, false, logger);
    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(world.authUsers).toHaveLength(6);
  });
});

describe("cleanup-uat-fixtures — retained rows and Auth ordering (HIGH-1)", () => {
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

    await runCleanup(db, true, logger);

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-seed-admin");
    expect(row).toBeDefined();
    expect(row.status).toBe("inactive");
    expect(row.auth_user_id).toBeNull();
    expect(row.notes).toBe(ADMIN_NOTES_MARKER);

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

    await expect(runCleanup(db, true, logger)).rejects.toThrow(/Teardown completed with 1 failure/);

    expect(logger.all()).toMatch(/auth\.users retained to avoid a dangling link/);
    expect(world.authUsers.some((u: any) => u.email === email("admin"))).toBe(true);
    expect(world.authOps.filter((o: any) => o.op === "delete" && o.id === "auth-seed-admin")).toHaveLength(0);
  });

  it("leaves a re-provisionable retained row that create can relink", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    await runCleanup(db, true, logger);

    const secondLogger = createLogger();
    await runFixtures(db, true, "pw-long-enough", secondLogger);

    const row = world.tables.admin_users.find((r: any) => r.id === "admin-seed-admin");
    const newAuth = world.authUsers.find((u: any) => u.email === email("admin"));
    expect(row.auth_user_id).toBe(newAuth.id);
    expect(row.status).toBe("active");
    expect(world.tables.admin_users.filter((r: any) => r.email === email("admin"))).toHaveLength(1);
  });

  it("applies the retained marker to a log-pinned person and cancels its membership", async () => {
    seedProvisioned(world);
    pinMembership(world, "membership-seed", "person-seed");

    await runCleanup(db, true, logger);

    const person = world.tables.people.find((r: any) => r.id === "person-seed");
    expect(person.data_quality_flags).toBe(RETAINED_MARKER);
    const membership = world.tables.person_season_memberships.find((r: any) => r.id === "membership-seed");
    expect(membership.status).toBe("cancelled");
    expect(membership.notes).toBe(ADMIN_NOTES_MARKER);
  });

  it("never deletes or updates append-only audit or log rows", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    pinMembership(world, "membership-seed", "person-seed");

    await runCleanup(db, true, logger);

    const immutable = world.writes.filter((w: any) =>
      ["admin_audit_log", "person_season_membership_log"].includes(w.table)
    );
    expect(immutable).toHaveLength(0);
    expect(world.tables.admin_audit_log).toHaveLength(1);
    expect(world.tables.person_season_membership_log).toHaveLength(1);
  });
});

describe("cleanup-uat-fixtures — exact scope deletion (MEDIUM-2)", () => {
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

    await runCleanup(db, true, logger);

    expect(world.tables.admin_scope_access.map((r: any) => r.id)).toEqual(["scope-unrelated"]);
    const scopeDeletes = writesTo(world, "admin_scope_access", "delete");
    for (const write of scopeDeletes) {
      expect(write.filters).toEqual([["eq", "id", write.ids[0]]]);
      expect(write.ids).toHaveLength(1);
    }
    expect(scopeDeletes.flatMap((w: any) => w.ids)).not.toContain("scope-unrelated");
    expect(logger.all()).toMatch(/unexpected admin_scope_access scope-unrelated .* left untouched/);
    // The surviving scope row still references this Auth UUID, so the Auth user
    // must be retained rather than left dangling.
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

    await expect(runCleanup(db, true, logger)).rejects.toThrow(/Teardown completed with 1 failure/);

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

    await expect(runCleanup(db, true, logger)).rejects.toThrow(/Teardown completed with 1 failure/);

    // The blocked account keeps both its row and its Auth user, still linked to
    // each other — the failure must never leave a dangling auth_user_id.
    expect(world.tables.admin_users.map((r: any) => r.id)).toEqual(["admin-seed-reviewer"]);
    expect(world.authUsers.map((u: any) => u.email)).toEqual([email("reviewer")]);
    expect(world.tables.admin_users[0].auth_user_id).toBe(world.authUsers[0].id);
    // Every other account, and the synthetic person, were still torn down.
    expect(world.tables.admin_scope_access).toHaveLength(0);
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
  });

  it("is idempotent: a second run performs zero mutations", async () => {
    seedProvisioned(world);
    pinAdmin(world, "admin-seed-admin");
    pinMembership(world, "membership-seed", "person-seed");

    await runCleanup(db, true, logger);
    const firstRunWrites = world.writes.length;
    expect(firstRunWrites).toBeGreaterThan(0);

    world.writes = [];
    world.authOps = [];
    const secondLogger = createLogger();
    await runCleanup(db, true, secondLogger);

    expect(world.writes).toHaveLength(0);
    expect(world.authOps).toHaveLength(0);
    expect(secondLogger.all()).toMatch(/already retained \(inactive, auth link cleared\)/);
    expect(secondLogger.all()).toMatch(/already carries the retained marker/);
  });

  it("removes every detached fixture object on a clean teardown", async () => {
    seedProvisioned(world);
    await runCleanup(db, true, logger);

    expect(world.authUsers).toHaveLength(0);
    expect(world.tables.admin_users).toHaveLength(0);
    expect(world.tables.admin_scope_access).toHaveLength(0);
    expect(world.tables.people).toHaveLength(0);
    expect(world.tables.person_season_memberships).toHaveLength(0);
  });
});

describe("create-uat-fixtures CLI safety guards", () => {
  const baseEnv = {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
    VAM_UAT_FIXTURE_PASSWORD: "longpassword123"
  };

  function runCli(env: NodeJS.ProcessEnv) {
    try {
      const stdout = execSync(`node "${createScript}"`, { env, stdio: "pipe" });
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
});
