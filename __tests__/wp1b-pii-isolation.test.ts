import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";
import { getApplicationReviewById, getRestrictedDashboardSummary } from "@/lib/data";
import { getScopeFilter, type AdminScopeContext } from "@/lib/program-scope";
import { canBrowseApplications, canBrowsePeople, canBrowseTeam } from "@/lib/read-access";
import { getSupabaseServiceRoleClient, getSupabaseServerClient } from "@/lib/supabase-server";

const { holder, from } = vi.hoisted(() => {
  const state: { client: any } = { client: null };
  return { holder: state, from: vi.fn((table: string) => state.client.from(table)) };
});

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => null) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => from(table) } }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

const db = createFakeDb();
holder.client = fakeClient(db);

beforeEach(() => {
  vi.clearAllMocks();
  db.requests.length = 0;
  for (const key of Object.keys(db.tables)) delete db.tables[key];
  const client = { from };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

describe("WP1-B reviewer row isolation", () => {
  beforeEach(() => {
    db.tables.application_reviews = [
      { id: "review-a", application_id: "app-a", reviewer_admin_user_id: "reviewer-a", reviewer_note: "PRIVATE_A" },
      { id: "review-b", application_id: "app-b", reviewer_admin_user_id: "reviewer-b", reviewer_note: "PRIVATE_B" }
    ];
  });

  it("does not return another reviewer's private review by ID", async () => {
    expect((await getApplicationReviewById("review-b", undefined, "reviewer-a")).data).toBeNull();
  });

  it("still returns the reviewer's own review", async () => {
    expect((await getApplicationReviewById("review-a", undefined, "reviewer-a")).data?.reviewer_note).toBe("PRIVATE_A");
  });

  it.each(["admin", "super_admin"])("preserves %s oversight when no owner constraint is supplied", async () => {
    expect((await getApplicationReviewById("review-b")).data?.reviewer_note).toBe("PRIVATE_B");
  });
});

describe("WP1-B route role contract", () => {
  it("denies reviewer unrestricted People, team and application browsing", () => {
    expect(canBrowsePeople("reviewer")).toBe(false);
    expect(canBrowseTeam("reviewer")).toBe(false);
    expect(canBrowseApplications("reviewer")).toBe(false);
  });

  it("denies viewer operational browse routes while preserving admin and support reads", () => {
    for (const fn of [canBrowsePeople, canBrowseTeam, canBrowseApplications]) {
      expect(fn("viewer")).toBe(false);
      expect(fn("admin")).toBe(true);
      expect(fn("super_admin")).toBe(true);
      expect(fn("support_team")).toBe(true);
    }
  });
});

describe("WP1-B scope-level and viewer projection", () => {
  const context: AdminScopeContext = {
    adminUser: null,
    authUserId: "auth-1",
    globalRole: "admin",
    isSuperAdmin: false,
    scopeError: null,
    programScopes: [
      { programId: "program-read", seasonId: null, scopeLevel: "read", status: "active" },
      { programId: "program-review", seasonId: null, scopeLevel: "review", status: "active" },
      { programId: "program-ops", seasonId: null, scopeLevel: "operations", status: "active" }
    ]
  };

  it("does not treat read, review and operations grants as byte-identical authority", async () => {
    db.tables.programs = [
      { id: "program-read", code: "READ" },
      { id: "program-review", code: "REVIEW" },
      { id: "program-ops", code: "OPS" }
    ];
    db.tables.seasons = [];
    expect((await getScopeFilter(context, "review"))?.allowedProgramIds).toEqual(expect.arrayContaining(["program-review", "REVIEW"]));
    expect((await getScopeFilter(context, "review"))?.allowedProgramIds).not.toContain("program-read");
    expect((await getScopeFilter(context, "operate"))?.allowedProgramIds).toEqual(expect.arrayContaining(["program-ops", "OPS"]));
  });

  it("viewer aggregate payload excludes seeded email and phone from the raw serialized result", async () => {
    db.tables.seasons = [{ id: "season-1", program_id: "program-read", code: "S1" }];
    db.tables.matches = [{ id: "match-1", season_id: "season-1", status: "active", email_primary: "seeded@example.invalid", phone_primary: "0900000000" }];
    db.tables.applications = [{ id: "app-1", season_id: "season-1", status: "submitted", email_primary: "seeded@example.invalid", phone_primary: "0900000000" }];
    const payload = await getRestrictedDashboardSummary({ allowedSeasonIds: ["season-1"], allowedProgramIds: ["program-read"] });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("seeded@example.invalid");
    expect(raw).not.toContain("0900000000");
    expect(payload).toMatchObject({ seasonCount: 1, matchCount: 1, activeMatchCount: 1, applicationCount: 1 });
    const sensitiveSelect = db.requests.some((request: any) =>
      ["matches", "applications"].includes(request.table) && String(request.columns).includes("*")
    );
    expect(sensitiveSelect).toBe(false);
  });
});
