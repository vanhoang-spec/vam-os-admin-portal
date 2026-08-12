import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({
    adminUser: { role: "super_admin" },
    authUserId: "auth-super",
    isSuperAdmin: true,
    programScopes: []
  }))
}));

const contextCatalog = {
  programs: [
    { id: "program-ueh", code: "UEHM", name: "UEH Mentoring", isActive: true },
    { id: "program-ham", code: "HAM", name: "Hanoi Alumni Mentoring", isActive: true }
  ],
  seasons: [
    { id: "season-ueh", code: "UEHM-S12", name: "UEH S12", programId: "program-ueh" },
    { id: "season-ham", code: "HAM-S6", name: "HAM S6", programId: "program-ham" }
  ],
  intakeBatches: []
};

vi.mock("@/lib/program-context", () => ({
  loadProgramContextCatalog: vi.fn(async () => contextCatalog),
  toProgramAccessPrincipal: vi.fn(() => ({ authenticated: true, isSuperAdmin: true, grants: [] }))
}));

const tableRows: Record<string, unknown[]> = {
  applications: [
    { season_id: "season-ueh", status: "submitted" },
    { season_id: "season-ham", status: "approved" }
  ],
  person_season_memberships: [
    { person_id: "mentor-ueh", program_id: "program-ueh", season_id: "season-ueh", role: "mentor", status: "active" },
    { person_id: "mentee-ueh", program_id: "program-ueh", season_id: "season-ueh", role: "mentee", status: "active" },
    { person_id: "mentor-ham", program_id: "program-ham", season_id: "season-ham", role: "mentor", status: "active" }
  ],
  matches: [{ season_id: "season-ueh", status: "active", mentor_person_id: "mentor-ueh", mentee_person_id: "mentee-ueh" }],
  events: [{ season_id: "season-ham", status: "scheduled", starts_at: "2099-01-01T00:00:00Z" }],
  action_items: [
    { season_id: "season-ueh", status: "open", action_type: "data_issue", due_date: "2020-01-01" },
    { season_id: "season-ham", status: "resolved", action_type: "data_issue", due_date: "2020-01-01" }
  ]
};

// The portfolio aggregate reads five relations that all exceed the PostgREST
// row cap in Production, so it is exercised against the faithful fake: the cap
// is enforced silently and an unordered read comes back in an arbitrary order.
const db = createFakeDb();
const from = vi.fn((table: string) => fakeClient(db).from(table));

vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(() => ({ from })) }));

import { getSuperAdminPortfolio } from "@/lib/portfolio";

describe("Super Admin portfolio aggregate", () => {
  beforeEach(() => {
    from.mockClear();
    db.reset();
    for (const [table, rows] of Object.entries(tableRows)) {
      // Ordering keys the real tables carry; the fake projects only the
      // requested columns, so the loader must ask for them itself.
      db.tables[table] = (rows as any[]).map((row, index) => ({ id: `${table}-${index}`, ...(row as object) }));
    }
  });

  it("aggregates both programs without N+1 queries", async () => {
    const result = await getSuperAdminPortfolio();
    // Five paged reads, each one data page plus one terminating empty page.
    // Constant in the number of rows — the property this assertion guards.
    expect(from).toHaveBeenCalledTimes(10);
    expect(result.totals).toMatchObject({
      programs: 2,
      activePrograms: 2,
      activeSeasons: 2,
      openApplications: 1,
      activeMentors: 2,
      activeMentees: 1,
      activeMatches: 1,
      upcomingEvents: 1,
      dataIssues: 1,
      overdueTasks: 1
    });
  });

  it("applies documented health rules per program", async () => {
    const result = await getSuperAdminPortfolio();
    expect(result.programs.find((row) => row.programCode === "UEHM")?.health).toBe("data_issue");
    expect(result.programs.find((row) => row.programCode === "HAM")?.health).toBe("normal");
  });

  it("does not return PII fields", async () => {
    const result = await getSuperAdminPortfolio();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/email|phone|full_name|raw_payload|student_id/i);
  });
});
