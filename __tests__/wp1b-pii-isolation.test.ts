import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";
import {
  getAllApplicationReviews,
  getApplicationReviewById,
  getApplications,
  getInterviewCandidates,
  getRestrictedDashboardSummary
} from "@/lib/data";
import { getMatchList } from "@/lib/matches";
import { getScopeFilter, type AdminScopeContext } from "@/lib/program-scope";
import { canBrowseApplications, canBrowseParticipants, canBrowsePeople, canBrowseTeam } from "@/lib/read-access";
import { canManageMatches } from "@/lib/permissions";
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
  db.reset();
  const client = { from };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

function makeContext(
  role: AdminScopeContext["globalRole"],
  scopeLevel: "read" | "review" | "operations"
): AdminScopeContext {
  return {
    adminUser: null,
    authUserId: `${role}-auth`,
    globalRole: role,
    isSuperAdmin: false,
    scopeError: null,
    programScopes: [{ programId: "program-1", seasonId: null, scopeLevel, status: "active" }]
  };
}

function seedScopedApplication() {
  db.tables.programs = [{ id: "program-1", code: "PROGRAM-1" }];
  db.tables.seasons = [{ id: "season-1", program_id: "program-1", code: "S1" }];
  db.tables.intake_batches = [{ id: "batch-1", season_id: "season-1", code: "B1" }];
  db.tables.applications = [{ id: "app-1", season_id: "season-1", intake_batch_id: "batch-1", status: "submitted" }];
}

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
    expect(canBrowseParticipants("reviewer")).toBe(false);
  });

  it("denies viewer operational browse routes while preserving admin and support reads", () => {
    for (const fn of [canBrowsePeople, canBrowseTeam, canBrowseApplications]) {
      expect(fn("viewer")).toBe(false);
      expect(fn("admin")).toBe(true);
      expect(fn("super_admin")).toBe(true);
      expect(fn("support_team")).toBe(true);
      expect(fn("core_team")).toBe(true);
    }
  });
});

describe("WP1-B read scope contract", () => {
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

  it("uses every active grant as read scope without treating scopeLevel as route permission", async () => {
    db.tables.programs = [
      { id: "program-read", code: "READ" },
      { id: "program-review", code: "REVIEW" },
      { id: "program-ops", code: "OPS" }
    ];
    db.tables.seasons = [];
    expect((await getScopeFilter(context))?.allowedProgramIds).toEqual(
      expect.arrayContaining(["program-read", "READ", "program-review", "REVIEW", "program-ops", "OPS"])
    );
  });

  it.each([
    ["support_team", "read"],
    ["core_team", "read"]
  ] as const)("preserves %s operational reads with a legacy %s-level scope", async (role, scopeLevel) => {
    seedScopedApplication();
    const scope = await getScopeFilter(makeContext(role, scopeLevel));
    const result = await getApplications(scope);
    expect(canBrowseApplications(role)).toBe(true);
    expect(result.error).toBeNull();
    expect(result.data.map((row) => row.id)).toEqual(["app-1"]);
  });

  it("preserves admin review oversight with an operations-level scope", async () => {
    seedScopedApplication();
    db.tables.application_reviews = [
      { id: "review-1", application_id: "app-1", reviewer_admin_user_id: "reviewer-1", status: "submitted" }
    ];
    const scope = await getScopeFilter(makeContext("admin", "operations"));
    const result = await getAllApplicationReviews(scope);
    expect(result.error).toBeNull();
    expect(result.data.map((row) => row.id)).toEqual(["review-1"]);
  });

  it("combines reviewer ownership with read scope for guessed review IDs", async () => {
    seedScopedApplication();
    db.tables.application_reviews = [
      { id: "mine", application_id: "app-1", reviewer_admin_user_id: "reviewer-a", reviewer_note: "PRIVATE_A" },
      { id: "theirs", application_id: "app-1", reviewer_admin_user_id: "reviewer-b", reviewer_note: "PRIVATE_B" }
    ];
    const scope = await getScopeFilter(makeContext("reviewer", "read"));
    expect((await getApplicationReviewById("mine", scope, "reviewer-a")).data?.reviewer_note).toBe("PRIVATE_A");
    expect((await getApplicationReviewById("theirs", scope, "reviewer-a")).data).toBeNull();
  });

  it("keeps unowned reviewer interview queue rows free of contact and private application data", async () => {
    seedScopedApplication();
    db.tables.applications[0] = {
      ...db.tables.applications[0],
      full_name: "Candidate One",
      email_primary: "candidate-secret@example.test",
      phone_primary: "0900000000",
      raw_payload: { private_answer: "PRIVATE" },
      role_applied: "mentee",
      status: "invited_to_interview",
      sbd: "SBD-1",
      submitted_at: "2026-01-01"
    };
    db.tables.application_reviews = [{
      id: "other-review-secret",
      application_id: "app-1",
      review_round: "interview",
      reviewer_admin_user_id: "reviewer-b-secret",
      status: "in_progress",
      created_at: "2026-01-02"
    }];
    const scope = await getScopeFilter(makeContext("reviewer", "read"));
    const result = await getInterviewCandidates({
      intakeBatchId: "batch-1",
      roleApplied: "mentee",
      scope,
      actorRole: "reviewer",
      actorAdminUserId: "reviewer-a"
    });
    const raw = JSON.stringify(result.data);
    expect(raw).not.toContain("candidate-secret@example.test");
    expect(raw).not.toContain("0900000000");
    expect(raw).not.toContain("PRIVATE");
    expect(raw).not.toContain("other-review-secret");
    expect(raw).not.toContain("reviewer-b-secret");
    expect(result.data).toEqual([]);
    expect(db.requests.filter((request) => request.table === "applications").every((request) =>
      !request.columns.includes("email_primary") && !request.columns.includes("phone_primary") && !request.columns.includes("raw_payload")
    )).toBe(true);
  });

  it("restores required contact details after reviewer ownership is established", async () => {
    seedScopedApplication();
    db.tables.applications[0] = {
      ...db.tables.applications[0],
      full_name: "Candidate One",
      email_primary: "owned@example.test",
      phone_primary: "0911111111",
      role_applied: "mentee",
      status: "interview_in_progress",
      submitted_at: "2026-01-01"
    };
    db.tables.application_reviews = [{
      id: "owned-review",
      application_id: "app-1",
      review_round: "interview",
      reviewer_admin_user_id: "reviewer-a",
      status: "in_progress",
      created_at: "2026-01-02"
    }];
    const result = await getInterviewCandidates({
      intakeBatchId: "batch-1",
      actorRole: "reviewer",
      actorAdminUserId: "reviewer-a"
    });
    expect(result.data[0]).toMatchObject({
      interview_review_id: "owned-review",
      email_primary: "owned@example.test",
      phone_primary: "0911111111"
    });
  });

  it("preserves the admin interview queue contact path", async () => {
    seedScopedApplication();
    db.tables.applications[0] = {
      ...db.tables.applications[0],
      full_name: "Candidate One",
      email_primary: "candidate@example.test",
      phone_primary: "0922222222",
      role_applied: "mentee",
      status: "invited_to_interview",
      submitted_at: "2026-01-01"
    };
    db.tables.application_reviews = [];
    const result = await getInterviewCandidates({
      intakeBatchId: "batch-1",
      actorRole: "admin",
      actorAdminUserId: "admin-a"
    });
    expect(result.data[0]).toMatchObject({
      email_primary: "candidate@example.test",
      phone_primary: "0922222222"
    });
  });

  it("returns a viewer-safe match DTO without querying participant People PII", async () => {
    db.tables.matches = [{
      id: "match-1",
      season_id: "season-1",
      mentor_person_id: "mentor-1",
      mentee_person_id: "mentee-1",
      status: "active",
      match_type: "primary",
      match_source_raw: "manual",
      matched_at: "2026-01-01",
      notes: "PRIVATE NOTE"
    }];
    db.tables.intake_batches = [{ id: "batch-1", season_id: "season-1", code: "B1" }];
    db.tables.people = [
      { id: "mentor-1", full_name: "Mentor Secret", email_primary: "mentor-secret@example.test", phone_primary: "0900000001" },
      { id: "mentee-1", full_name: "Mentee Secret", email_primary: "mentee-secret@example.test", phone_primary: "0900000002" }
    ];
    const result = await getMatchList({
      scope: { allowedSeasonIds: ["season-1"] },
      audienceRole: "viewer"
    });
    const raw = JSON.stringify(result.data);
    expect(result.ok).toBe(true);
    expect(result.data[0]).toMatchObject({ id: "match-1", status: "active", batch_code: "B1" });
    for (const key of ["mentor_email", "mentee_email", "mentor_person_id", "mentee_person_id", "notes"]) {
      expect(result.data[0]).not.toHaveProperty(key);
    }
    expect(raw).not.toContain("mentor-secret@example.test");
    expect(raw).not.toContain("mentee-secret@example.test");
    expect(raw).not.toContain("0900000001");
    expect(raw).not.toContain("0900000002");
    expect(db.requests.some((request) => request.table === "people")).toBe(false);
    expect(db.requests.find((request) => request.table === "matches")?.columns).not.toContain("person_id");
  });

  it("preserves support match contact data while viewer mutation denial remains", async () => {
    db.tables.matches = [{
      id: "match-1", season_id: "season-1", mentor_person_id: "mentor-1", mentee_person_id: "mentee-1",
      status: "active", match_type: "primary", match_source_raw: "manual", matched_at: "2026-01-01"
    }];
    db.tables.intake_batches = [{ id: "batch-1", season_id: "season-1", code: "B1" }];
    db.tables.mentor_profiles = [{ id: "mp-1", person_id: "mentor-1", mentor_code: "M1", intake_batch_id: "batch-1" }];
    db.tables.mentee_profiles = [{ id: "me-1", person_id: "mentee-1", mentee_code: "E1", intake_batch_id: "batch-1" }];
    db.tables.people = [
      { id: "mentor-1", full_name: "Mentor", email_primary: "mentor@example.test", phone_primary: "0901" },
      { id: "mentee-1", full_name: "Mentee", email_primary: "mentee@example.test", phone_primary: "0902" }
    ];
    const result = await getMatchList({ audienceRole: "support_team" });
    expect(result.data[0]).toMatchObject({ mentor_email: "mentor@example.test", mentee_email: "mentee@example.test" });
    expect(canManageMatches("viewer")).toBe(false);
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
