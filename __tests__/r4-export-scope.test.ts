/**
 * R4 — scope catalog resolution must not fail open into a plausible export.
 *
 * THE DEFECT
 * ----------
 * `program-scope` resolves an admin's grants against the `seasons` and
 * `programs` reference relations. A failed read of either used to be swallowed
 * and returned as an empty catalog, and the shape of what came out afterwards
 * depended on the KIND of grant:
 *
 *   * A SEASON-level grant names its season directly, so `allowedSeasonIds`
 *     survived the failure and downstream reads still filtered correctly.
 *   * A PROGRAM-level grant names only a program. `allowedProgramIds` survived
 *     (it is copied straight off the grant row) but `allowedSeasonIds` is
 *     DERIVED by matching seasons to that program, and collapsed to `[]`.
 *
 * The export route then saw a filter that named a program — "something is
 * granted" — and every season-filtered loader beneath it returned zero rows
 * with `error: null`. The result was HTTP 200 and a header-only file. For an
 * export used to notify applicants, that file asserts "this season had no
 * applicants" on the strength of an infrastructure outage.
 *
 * These tests run the REAL `program-scope`, the REAL data layer and the REAL
 * route over the PostgREST emulator, so the distinction being asserted is the
 * one production actually makes:
 *
 *   catalog failure      -> non-200
 *   authorized + empty   -> 200, a valid empty export
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
// `program-scope` memoises `getAdminScopeContext` with React's request-scoped
// `cache`, which react@18 does not export outside a server-component render.
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn(async () => null),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({
    envName: "SUPABASE_SERVICE_ROLE_KEY",
    loaded: true,
    usesPublicPrefix: false,
    sameAsAnonKey: false
  }))
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import { GET } from "@/app/api/applications/export/route";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter, getScopeFilterResult } from "@/lib/program-scope";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";
import { parseCsv, parseCsvTable } from "./support/rfc4180";

const PROGRAM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROGRAM_CODE = "UEHM";
const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_CODE = "UEHM-S12";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTH_USER_ID = "auth-1";

const db = createFakeDb();

function seedCatalog() {
  db.tables.programs = [{ id: PROGRAM_ID, code: PROGRAM_CODE, name: "UEH Mentoring" }];
  db.tables.seasons = [{ id: SEASON_ID, code: SEASON_CODE, name: "UEH Mentoring S12", program_id: PROGRAM_ID }];
  db.tables.intake_batches = [{ id: BATCH_ID, season_id: SEASON_ID, code: "B1", name: "Đợt 1", is_active: true }];
  db.tables.applications = [];
  db.tables.application_reviews = [];
  db.tables.admin_users = [];
}

/** A PROGRAM-level grant: names a program, no season. This is the vulnerable shape. */
function grantProgramScope() {
  db.tables.admin_scope_access = [
    {
      id: "grant-1",
      user_id: AUTH_USER_ID,
      program_id: PROGRAM_ID,
      season_id: null,
      role: "operations",
      status: "active"
    }
  ];
}

function seedApplication(overrides: Record<string, unknown> = {}) {
  db.tables.applications = [
    {
      id: "app-1",
      season_id: SEASON_ID,
      intake_batch_id: BATCH_ID,
      role_applied: "mentee",
      full_name: "Nguyễn Văn Ánh",
      email_primary: "anh@example.com",
      status: "submitted",
      raw_payload: { mssv: "0012345678" },
      ...overrides
    }
  ];
}

beforeEach(() => {
  db.reset();
  seedCatalog();
  grantProgramScope();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "actor-1",
    email: "actor@example.com",
    full_name: "Actor",
    role: "admin",
    status: "active",
    auth_user_id: AUTH_USER_ID
  } as never);
});

function call(query = "") {
  return GET(new NextRequest(`http://localhost/api/applications/export${query}`));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("scope catalog failure is reported, not rendered as empty data", () => {
  it("S1 returns non-200 when the seasons catalog read fails under a program-level grant", async () => {
    db.errors.seasons = { message: "permission denied for relation seasons" };

    const response = await call();

    expect(response.status).not.toBe(200);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("returns non-200 when the programs catalog read fails", async () => {
    db.errors.programs = { message: "permission denied for relation programs" };

    const response = await call();

    expect(response.status).not.toBe(200);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("does not emit a header-only file that would read as 'no applicants'", async () => {
    seedApplication();
    db.errors.seasons = { message: "seasons unavailable" };

    const response = await call();

    expect(response.status).not.toBe(200);
    const body = await response.text();
    // Neither a header row nor a BOM: nothing that a recipient could mistake
    // for an export of an empty season.
    expect(body).not.toContain("Application ID");
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("surfaces the failure through getScopeFilterResult for a program-level grant", async () => {
    db.errors.seasons = { message: "seasons unavailable" };
    const context = await getAdminScopeContext();

    // The grant itself resolved — this is not an ungranted user.
    expect(context.scopeError).toBeNull();
    expect(context.programScopes).toHaveLength(1);

    const result = await getScopeFilterResult(context);

    expect(result.error).toBeTruthy();
    // And the shape that made the bug invisible: a populated program list beside
    // an empty season list.
    expect(result.scope?.allowedProgramIds).toContain(PROGRAM_ID);
    expect(result.scope?.allowedSeasonIds).toEqual([]);
  });

  it("keeps getScopeFilter's existing contract so other callers do not fail open", async () => {
    db.errors.seasons = { message: "seasons unavailable" };
    const context = await getAdminScopeContext();

    const legacy = await getScopeFilter(context);

    // Returning `undefined` here would mean "no restriction" to every scoped
    // page in the app. The degraded (narrower) filter must survive unchanged;
    // only callers that ask for the error get it.
    expect(legacy).toBeDefined();
    expect(legacy?.allowedProgramIds).toContain(PROGRAM_ID);
    expect(legacy?.allowedSeasonIds).toEqual([]);
  });
});

describe("an authorized scope over genuinely empty data still exports", () => {
  it("S2 returns a valid empty export when the catalog reads and there are no applications", async () => {
    db.tables.applications = [];

    const response = await call();

    expect(response.status).toBe(200);
    const rows = parseCsv(await response.text());
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Season");
    expect(rows[0][3]).toBe("Application ID");
  });

  it("resolves the program grant to its seasons and exports real rows with the canonical code", async () => {
    // The other half of the S1/S2 pair: proves the fail-closed check is not
    // simply refusing every program-level grant.
    seedApplication();

    const response = await call();

    expect(response.status).toBe(200);
    const { rows } = parseCsvTable(await response.text());
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(SEASON_CODE);
    expect(rows[0][0]).not.toBe(SEASON_ID);
    expect(rows[0][3]).toBe("app-1");
  });
});
