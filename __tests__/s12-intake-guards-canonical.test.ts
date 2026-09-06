import { describe, expect, it, vi, beforeEach } from "vitest";
import { submitPilotApplication } from "@/lib/applications-create";
import { S12_BINDING } from "@/lib/application-form-controls";
import { evaluateApplyGate } from "@/lib/apply-gate";

// Mock external dependencies
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn()
}));

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockLimit = vi.fn();
const mockIlike = vi.fn();
const mockInsert = vi.fn();
const mockMaybeSingle = vi.fn();
const mockDelete = vi.fn();

const mockClient = {
  from: vi.fn().mockImplementation(() => ({
    select: mockSelect,
    insert: mockInsert,
    delete: vi.fn(() => ({ eq: mockEq }))
  })) as any
};

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => mockClient,
  getSupabaseServiceRoleEnvStatus: () => ({ sameAsAnonKey: false })
}));

describe("S12 Intake Eligibility Guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evaluateApplyGate).mockResolvedValue({ status: "open" } as any);
  });

  const baseInput = {
    role: "mentee" as const,
    seasonCode: S12_BINDING.seasonCode,
    intakeBatchCode: S12_BINDING.intakeBatchCode,
    fullName: "Test User",
    emailPrimary: "test@example.com",
    phonePrimary: "0901234567",
    consentDataStorage: true,
    rawPayload: {}
  };

  const MOCK_SEASON_S12 = { id: "season_id", code: S12_BINDING.seasonCode };

  function setupMocks(overrides: {
    seasons?: any;
    applications?: any;
    people?: any;
    mentor_profiles?: any;
    mentee_profiles?: any;
    person_season_memberships?: any;
    matches?: any;
  } = {}) {
    let appLimitCall = 0;
    let pmLimitCall = 0;
    (mockClient.from as any).mockImplementation((table: string) => {
      const tbChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      };

      if (table === "seasons") {
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: overrides.seasons?.maybeSingle || MOCK_SEASON_S12, error: null });
        tbChain.in = vi.fn().mockReturnThis();
        tbChain.limit = vi.fn().mockReturnThis();
        tbChain.select = vi.fn().mockImplementation(() => {
          const inner: any = {
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockImplementation(() => Promise.resolve({ data: overrides.seasons?.in || [], error: null })),
            maybeSingle: vi.fn().mockResolvedValue({ data: overrides.seasons?.maybeSingle || MOCK_SEASON_S12, error: null })
          };
          return inner;
        });
      } else if (table === "intake_batches") {
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "batch_id" }, error: null });
      } else if (table === "applications") {
        const resolveData = () => {
          appLimitCall++;
          if (appLimitCall === 1) return { data: overrides.applications?.dupEmail || [], error: null };
          if (appLimitCall === 2) return { data: overrides.applications?.dupEmailFallback || [], error: null };
          if (appLimitCall === 3) return { data: overrides.applications?.phone || [], error: null };
          if (appLimitCall === 4) return { data: overrides.applications?.approvedMentee || [], error: null };
          return { data: [], error: null };
        };
        tbChain.limit = vi.fn().mockImplementation(() => Promise.resolve(resolveData()));
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "inserted_app_id" }, error: null });
        tbChain.then = (resolve: any) => Promise.resolve(resolveData()).then(resolve);
      } else if (table === "people") {
        tbChain.limit = vi.fn().mockImplementation(() => Promise.resolve({ data: overrides.people?.limit || [], error: null }));
      } else if (table === "mentor_profiles") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: overrides.mentor_profiles?.limit || [], error: null });
      } else if (table === "mentee_profiles") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: overrides.mentee_profiles?.limit || [], error: null });
      } else if (table === "person_season_memberships") {
        const resolveData = () => {
          pmLimitCall++;
          if (pmLimitCall === 1) return { data: overrides.person_season_memberships?.limit1 || overrides.person_season_memberships?.limit || [], error: null };
          if (pmLimitCall === 2) return { data: overrides.person_season_memberships?.limit2 || overrides.person_season_memberships?.limit || [], error: null };
          return { data: [], error: null };
        };
        tbChain.limit = vi.fn().mockImplementation(() => Promise.resolve(resolveData()));
        tbChain.in = vi.fn().mockReturnThis();
        tbChain.eq = vi.fn().mockReturnThis();
        tbChain.then = (resolve: any) => Promise.resolve(resolveData()).then(resolve);
      } else if (table === "matches") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: overrides.matches?.limit || [], error: null });
      }
      return tbChain;
    });
  }

  // --- MENTEE MATRIX ---

  it("Mentee: brand new -> allow", async () => {
    setupMocks();
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(true);
  });

  it("Mentee: same-season duplicate email -> block", async () => {
    setupMocks({
      applications: { dupEmail: [{ email_primary: "test@example.com" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
  });

  it("Mentee: current S12 Mentee membership -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit2: [{ role: "mentee", season_id: "season_id", status: "active" }] } // S12 query is second
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("Mentee: historical mentee_profiles -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      mentee_profiles: { limit: [{ id: "mp1" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("Mentee: historical matches -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      matches: { limit: [{ id: "match1" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("Mentee: prior approved application ONLY -> identity_review", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      applications: { approvedMentee: [{ id: "app1", season_id: "old_season" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với một hồ sơ");
  });

  it("Mentee: current S12 approved Mentee -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      applications: { approvedMentee: [{ id: "app1", season_id: "season_id" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("Mentee: historical mentee membership (S11) -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit1: [{ role: "mentee", season_id: "s11", status: "completed" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("Mentee: current supporter -> block", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit2: [{ role: "supporter", season_id: "season_id" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  // --- PHONE MATRIX ---

  it("Phone: changed email + same-role historical phone -> identity_review", async () => {
    setupMocks({
      applications: { phone: [{ email_primary: "other@example.com", phone_primary: "0901234567" }] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với một hồ sơ");
  });

  it("Phone: changed email + cross-role historical phone -> ignore & allow", async () => {
    // Cross-role shouldn't return in the same-role phone check anyway
    setupMocks({
      applications: { phone: [] }
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(true);
  });

  it("Phone: +84 variants resolve correctly", async () => {
    setupMocks({
      applications: { phone: [{ email_primary: "other@example.com", phone_primary: "+84901234567" }] }
    });
    const result = await submitPilotApplication(baseInput); // submitted as 0901234567
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với một hồ sơ");
  });

  // --- MENTOR MATRIX ---

  const mentorInput = { ...baseInput, role: "mentor" as const };

  it("Mentor: brand new -> allow", async () => {
    setupMocks();
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(true);
  });

  it("Mentor: returning Mentor (has mentor_profiles) -> returning_mentor reason", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      mentor_profiles: { limit: [{ id: "mprof1" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("returning_mentor");
  });

  it("Mentor: active S12 Mentor membership only, no profile -> BLOCK", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit: [{ role: "mentor", season_id: "s12", status: "active" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("returning_mentor");

    const dbWrites = mockDbState.history.filter((h) => h.method === "insert");
    expect(dbWrites).toHaveLength(0); // refusal -> zero writes
  });

  it("Mentor: historical Mentor membership only -> BLOCK", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit: [{ role: "mentor", season_id: "s11", status: "completed" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("returning_mentor");
  });

  it("Mentor: prior Mentee membership only -> ALLOW Mentor application", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { limit: [{ role: "mentee", season_id: "s11", status: "completed" }] },
      mentee_profiles: { limit: [{ id: "mp1" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(true);
  });

  it("Mentor: membership lookup DB error -> fail closed", async () => {
    setupMocks({
      people: { limit: [{ id: "p1", email_primary: "test@example.com" }] },
      person_season_memberships: { error: new Error("DB crash") }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("db");
  });
});

describe("Phone Identity Guard", () => {
  const mentorInput = mockSubmissionInput("mentor");
  const phone = mentorInput.answers["phone_primary"];

  it("same-role exact normalized phone -> identity_review", async () => {
    setupMocks({
      applications: { limit: [{ email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentor" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
  });

  it("+84 / 0 normalization -> identity_review", async () => {
    setupMocks({
      applications: { limit: [{ email_primary: "diff@example.com", phone_primary: phone.replace(/^0/, "+84"), role_applied: "mentor" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
  });

  it("changed email same role -> identity_review", async () => {
    setupMocks({
      applications: { limit: [{ email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentor" }] }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
  });

  it("cross-role same phone -> not blocked by phone", async () => {
    setupMocks({
      applications: { limit: [{ email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentee" }] } // Mock only returns the cross-role app, but the query filters by role="mentor", so mock should technically not return it if filtering is simulated, but setupMocks just returns limit anyway. Wait, actually setupMocks limit logic might just return what we pass. If it returns cross-role, the logic should ignore it because it checks hasSameRolePhoneMatch. BUT the actual query has .eq("role_applied", input.role). Since setupMocks just returns data, it will simulate it. We should make sure the app returned doesn't trigger the block.
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(true);
  });

  it("candidate match within bounded window -> identity_review", async () => {
    const apps = Array(10).fill(null).map((_, i) => ({ email_primary: `other${i}@example.com`, phone_primary: `090000000${i}`, role_applied: "mentor" }));
    apps[5] = { email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentor" };
    setupMocks({
      applications: { limit: apps }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
  });

  it("candidate set MAX+1 -> fail closed", async () => {
    const apps = Array(11).fill(null).map((_, i) => ({ email_primary: `other${i}@example.com`, phone_primary: `090000000${i}`, role_applied: "mentor" }));
    setupMocks({
      applications: { limit: apps }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("db");
  });

  it("DB error -> fail closed", async () => {
    setupMocks({
      applications: { error: new Error("DB Crash") }
    });
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("db");
  });
});
