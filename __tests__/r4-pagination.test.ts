/**
 * R4 — pagination and chunking evidence for the export, against a PostgREST
 * emulator that actually caps rows.
 *
 * WHY THE PREVIOUS VERSION PROVED NOTHING
 * ---------------------------------------
 * It replaced the Supabase client with an object whose `range(from, to)`
 * returned a slice of a canned array, and asserted the row count came back.
 * Production does not page these reads with `range` at all: `readAllPages`
 * uses KEYSET paging — `gt(key, cursor).order(key).limit(pageSize)` — and
 * `selectInChunks` splits the IN list into chunks of 200 first. The old double
 * modelled an API the code never calls, so `.gt()`, `.order()` and `.limit()`
 * were free no-ops returning the whole array on the first request. Every
 * "1000/1500/2000 rows" case passed without a single page boundary being
 * crossed, and would have passed identically against a read with no paging at
 * all.
 *
 * This file uses `__tests__/support/fake-postgrest.ts`, which enforces the two
 * behaviours that actually bite: the SILENT 1000-row cap (200 OK, `error:
 * null`, truncated array) and undefined row order without an ORDER BY. Nothing
 * below the route is mocked — `getApplications`, `getAllApplicationReviews`,
 * `getAdminUsersByIds`, `readAllPages` and `selectInChunks` are the production
 * functions, and the export route is driven end-to-end over them.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn(async () => null),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ envName: "SUPABASE_SERVICE_ROLE_KEY", loaded: true, usesPublicPrefix: false, sameAsAnonKey: false }))
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  getScopeFilterResult: vi.fn()
}));

import { GET } from "@/app/api/applications/export/route";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter, getScopeFilterResult } from "@/lib/program-scope";
import { getAdminUsersByIds, getAllApplicationReviews, getApplications } from "@/lib/data";
import { SELECT_PAGE_SIZE } from "@/lib/paged-read";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";
import { parseCsvTable } from "./support/rfc4180";

const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const SCOPE = { allowedProgramIds: ["prog-1"], allowedSeasonIds: [SEASON_ID] };

/** Chunk width used by `selectInChunks` for IN lists. */
const IN_FILTER_CHUNK_SIZE = 200;

const db = createFakeDb();

/** Zero-padded so string keyset ordering matches numeric intent. */
const pad = (index: number) => String(index).padStart(6, "0");

function seedCatalog() {
  db.tables.seasons = [{ id: SEASON_ID, code: "UEHM-S12", name: "UEH Mentoring S12", program_id: "prog-1" }];
  db.tables.intake_batches = [{ id: BATCH_ID, season_id: SEASON_ID, code: "B1", name: "Đợt 1", is_active: true }];
  db.tables.admin_users = [];
  db.tables.application_reviews = [];
}

function seedApplications(count: number) {
  db.tables.applications = Array.from({ length: count }, (_, index) => ({
    id: `app-${pad(index)}`,
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    role_applied: "mentee",
    full_name: `Ứng viên ${index}`,
    email_primary: `applicant${index}@example.com`,
    status: "submitted",
    raw_payload: { mssv: `00${pad(index)}` }
  }));
}

beforeEach(() => {
  db.reset();
  seedCatalog();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "admin" } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: null,
    authUserId: "auth-1",
    globalRole: "admin",
    isSuperAdmin: false,
    programScopes: [],
    scopeError: null
  } as never);
  vi.mocked(getScopeFilter).mockResolvedValue(SCOPE as never);
  vi.mocked(getScopeFilterResult).mockResolvedValue({ scope: SCOPE, error: null } as never);
});

function call(query = "") {
  return GET(new NextRequest(`http://localhost/api/applications/export${query}`));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("application pagination — the real keyset path", () => {
  const sizes = [999, 1000, 1001, 1500, 2000];

  it.each(sizes)("getApplications returns all %i rows through readAllPages", async (total) => {
    seedApplications(total);

    const result = await getApplications(SCOPE);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(total);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(total);
    expect(result.data[total - 1].id).toBe(`app-${pad(total - 1)}`);
  });

  it("pages with gt/order/limit and never asks for more than one page at a time", async () => {
    seedApplications(2000);
    await getApplications(SCOPE);

    const requests = requestsFor(db, "applications");
    // 2000 rows at a 1000-row cap: two full pages plus the empty page that
    // proves exhaustion. Anything fewer means the read stopped early.
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.order).toEqual(["id:asc"]);
      expect(request.limit).toBe(SELECT_PAGE_SIZE);
      expect(request.returned).toBeLessThanOrEqual(SELECT_PAGE_SIZE);
    }
    // Later pages must carry the cursor AND the original scope predicate.
    expect(requests[1].filters).toContain('"kind":"gt"');
    for (const request of requests) {
      expect(request.filters).toContain(SEASON_ID);
    }
  });

  it("fails closed when a LATER page errors instead of returning the prefix", async () => {
    seedApplications(2000);
    db.injectError = (request, prior) =>
      request.table === "applications" && prior >= 1 ? { message: "page 2 exploded" } : null;

    const result = await getApplications(SCOPE);
    expect(result.error).toBeTruthy();
    expect(result.data).toHaveLength(0);
  });
});

describe("review pagination — the real chunk-then-page path", () => {
  /** apps 0..199 get `heavy` reviews each, apps 200..249 get `light` each. */
  function seedReviews(heavy: number, light: number) {
    const rows: Array<Record<string, unknown>> = [];
    let counter = 0;
    const push = (appIndex: number) => {
      rows.push({
        id: `rev-${pad(counter)}`,
        application_id: `app-${pad(appIndex)}`,
        reviewer_admin_user_id: `reviewer-${pad(counter % 3)}`,
        review_round: counter % 2 === 0 ? "profile_screening" : "interview",
        status: "submitted",
        total_score: 10,
        recommendation: "Yes",
        reviewer_note: null
      });
      counter += 1;
    };
    for (let appIndex = 0; appIndex < IN_FILTER_CHUNK_SIZE; appIndex += 1) {
      for (let n = 0; n < heavy; n += 1) push(appIndex);
    }
    for (let appIndex = IN_FILTER_CHUNK_SIZE; appIndex < IN_FILTER_CHUNK_SIZE + 50; appIndex += 1) {
      for (let n = 0; n < light; n += 1) push(appIndex);
    }
    db.tables.application_reviews = rows;
    return rows.length;
  }

  it("returns every review when one chunk alone exceeds the row cap", async () => {
    seedApplications(2000);
    // 200 applications x 6 reviews = 1200 rows inside the FIRST chunk of ids,
    // so that chunk cannot be satisfied by a single capped response.
    const total = seedReviews(6, 5);
    expect(total).toBeGreaterThan(SELECT_PAGE_SIZE);

    const result = await getAllApplicationReviews(SCOPE);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(total);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(total);
  });

  it("splits the application-id IN list into chunks rather than one giant filter", async () => {
    seedApplications(2000);
    seedReviews(6, 5);
    await getAllApplicationReviews(SCOPE);

    const requests = requestsFor(db, "application_reviews");
    expect(requests.length).toBeGreaterThanOrEqual(2000 / IN_FILTER_CHUNK_SIZE);
    for (const request of requests) {
      expect(request.order).toEqual(["id:asc"]);
      const filter = JSON.parse(request.filters) as Array<{ kind: string; values?: unknown[] }>;
      const inFilter = filter.find((entry) => entry.kind === "in");
      expect(inFilter?.values?.length).toBeLessThanOrEqual(IN_FILTER_CHUNK_SIZE);
    }
  });

  it("fails closed when a later chunk errors after earlier chunks returned rows", async () => {
    seedApplications(2000);
    seedReviews(6, 5);
    db.injectError = (request, prior) =>
      request.table === "application_reviews" && prior >= 4 ? { message: "chunk 3 exploded" } : null;

    const result = await getAllApplicationReviews(SCOPE);
    expect(result.error).toBeTruthy();
    expect(result.data).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the export route over the real paged reads", () => {
  const sizes = [999, 1000, 1001, 1500, 2000];

  it.each(sizes)("exports all %i applications as one summary row each", async (total) => {
    seedApplications(total);

    const response = await call("");
    expect(response.status).toBe(200);

    const { header, rows } = parseCsvTable(await response.text());
    expect(header[0]).toBe("Season");
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((row) => row[3])).size).toBe(total);
    // The last row proves the final page reached the file, not just the count.
    expect(rows[total - 1][3]).toBe(`app-${pad(total - 1)}`);
    expect(rows[0][0]).toBe("UEHM-S12");
    expect(rows[0][6]).toBe(`00${pad(0)}`);
  });

  it("exports more than 1000 review rows in the detail file", async () => {
    seedApplications(2000);
    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 1400; index += 1) {
      rows.push({
        id: `rev-${pad(index)}`,
        application_id: `app-${pad(index % IN_FILTER_CHUNK_SIZE)}`,
        reviewer_admin_user_id: "reviewer-000000",
        review_round: "profile_screening",
        status: "submitted",
        total_score: 10,
        recommendation: "Yes",
        reviewer_note: null
      });
    }
    db.tables.application_reviews = rows;
    db.tables.admin_users = [
      { id: "reviewer-000000", email: "hoa@example.com", full_name: "Trần Thị Hoa", role: "reviewer", status: "inactive" }
    ];

    const response = await call("?type=detail");
    expect(response.status).toBe(200);

    const parsed = parseCsvTable(await response.text());
    expect(parsed.rows).toHaveLength(1400);
    expect(parsed.rows[0][4]).toBe("Trần Thị Hoa");
  });

  it("returns non-200 when a later application page fails", async () => {
    seedApplications(2000);
    db.injectError = (request, prior) =>
      request.table === "applications" && prior >= 1 ? { message: "page 2 exploded" } : null;

    const response = await call("");
    expect(response.status).toBe(500);
  });

  it("returns non-200 when a review chunk fails", async () => {
    seedApplications(400);
    db.tables.application_reviews = [
      {
        id: "rev-000000",
        application_id: "app-000000",
        reviewer_admin_user_id: "reviewer-000000",
        review_round: "profile_screening",
        status: "submitted",
        total_score: 10,
        recommendation: "Yes"
      }
    ];
    db.injectError = (request, prior) =>
      request.table === "application_reviews" && prior >= 2 ? { message: "chunk exploded" } : null;

    const response = await call("?type=detail");
    expect(response.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getAdminUsersByIds — reviewer identity data layer", () => {
  it("resolves a large id set in chunks, with no per-id round trip", async () => {
    const ids = Array.from({ length: 1200 }, (_, index) => `reviewer-${pad(index)}`);
    db.tables.admin_users = ids.map((id, index) => ({
      id,
      email: `reviewer${index}@example.com`,
      full_name: `Reviewer ${index}`,
      role: "reviewer",
      status: index % 2 === 0 ? "active" : "inactive"
    }));

    const result = await getAdminUsersByIds(ids);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1200);
    const requests = requestsFor(db, "admin_users");
    // Chunked, not one request per id, and nowhere near 1200 round trips.
    expect(requests.length).toBeLessThan(ids.length / 10);
    for (const request of requests) {
      expect(request.order).toEqual(["id:asc"]);
      const filter = JSON.parse(request.filters) as Array<{ kind: string; values?: unknown[] }>;
      expect(filter.find((entry) => entry.kind === "in")?.values?.length).toBeLessThanOrEqual(IN_FILTER_CHUNK_SIZE);
    }
  });

  it("returns reviewers whose account is no longer active", async () => {
    db.tables.admin_users = [
      { id: "reviewer-000000", email: "cu@example.com", full_name: "Lê Văn Cũ", role: "reviewer", status: "inactive" },
      { id: "reviewer-000001", email: "sus@example.com", full_name: "Bị Khoá", role: "reviewer", status: "suspended" }
    ];

    const result = await getAdminUsersByIds(["reviewer-000000", "reviewer-000001"]);

    expect(result.error).toBeNull();
    expect(result.data.map((row) => row.full_name).sort()).toEqual(["Bị Khoá", "Lê Văn Cũ"]);
  });

  it("omits an id that has no row, and does so without an error", async () => {
    db.tables.admin_users = [
      { id: "reviewer-000000", email: "hoa@example.com", full_name: "Hoa", role: "reviewer", status: "active" }
    ];

    const result = await getAdminUsersByIds(["reviewer-000000", "reviewer-deleted"]);

    expect(result.error).toBeNull();
    expect(result.data.map((row) => row.id)).toEqual(["reviewer-000000"]);
  });

  it("fails closed on a query failure and returns no rows", async () => {
    db.tables.admin_users = [
      { id: "reviewer-000000", email: "hoa@example.com", full_name: "Hoa", role: "reviewer", status: "active" }
    ];
    db.errors.admin_users = { message: "permission denied for table admin_users" };

    const result = await getAdminUsersByIds(["reviewer-000000"]);

    expect(result.error).toBeTruthy();
    expect(result.data).toHaveLength(0);
  });

  it("makes no request at all for an empty id list", async () => {
    const result = await getAdminUsersByIds([null, undefined, ""]);

    expect(result).toEqual({ data: [], error: null });
    expect(requestsFor(db, "admin_users")).toHaveLength(0);
  });
});
