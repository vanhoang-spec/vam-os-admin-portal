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
        order: vi.fn().mockReturnThis(),
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
      } if (table === "applications") {
        if (overrides.applications?.seed) {
          const filters: Array<(r: any) => boolean> = [];
          let maxLimit = Number.POSITIVE_INFINITY;
          let orderCol: string | null = null;
          tbChain.eq = vi.fn().mockImplementation((col: string, val: any) => { filters.push((r: any) => r[col] === val); return tbChain; });
          tbChain.ilike = vi.fn().mockImplementation((col: string, val: string) => {
            const pattern = val.replace(/%/g, '.*');
            const regex = new RegExp(`^${pattern}$`, 'i');
            filters.push((r: any) => regex.test(r[col] || ""));
            return tbChain;
          });
          tbChain.order = vi.fn().mockImplementation((col: string) => { orderCol = col; return tbChain; });
          tbChain.limit = vi.fn().mockImplementation((limit: number) => { maxLimit = limit; return tbChain; });
          tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "inserted_app_id" }, error: null });
          tbChain.then = (resolve: any) => {
            if (overrides.applications.error) return Promise.resolve({ data: null, error: overrides.applications.error }).then(resolve);
            let filtered = overrides.applications.seed.filter((r: any) => filters.every(f => f(r)));
            if (orderCol) {
              filtered.sort((a: any, b: any) => (a[orderCol as string] > b[orderCol as string] ? 1 : a[orderCol as string] < b[orderCol as string] ? -1 : 0));
            }
            const data = filtered.slice(0, maxLimit);
            return Promise.resolve({ data, error: null }).then(resolve);
          };
        } else {
          const resolveData = () => {
            appLimitCall++;
            if (appLimitCall === 1) return { data: overrides.applications?.dupEmail || [], error: null };
            if (appLimitCall === 2) return { data: overrides.applications?.dupEmailFallback || [], error: null };
            if (appLimitCall === 3) return { data: overrides.applications?.phone || overrides.applications?.limit || [], error: overrides.applications?.error || null };
            if (appLimitCall === 4) return { data: overrides.applications?.approvedMentee || [], error: null };
            return { data: [], error: null };
          };
          tbChain.limit = vi.fn().mockImplementation(() => Promise.resolve(resolveData()));
          tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "inserted_app_id" }, error: null });
          tbChain.order = vi.fn().mockReturnThis();
          tbChain.then = (resolve: any) => Promise.resolve(resolveData()).then(resolve);
        }
      } else if (table === "people") {
        tbChain.limit = vi.fn().mockImplementation(() => Promise.resolve({ data: overrides.people?.limit || [], error: null }));
      } else if (table === "mentor_profiles") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: overrides.mentor_profiles?.limit || [], error: null });
      } else if (table === "mentee_profiles") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: overrides.mentee_profiles?.limit || [], error: null });
      } else if (table === "person_season_memberships") {
        const resolveData = () => {
          if (overrides.person_season_memberships?.error) return { data: null, error: overrides.person_season_memberships.error };
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

    expect(mockInsert).not.toHaveBeenCalled(); // refusal -> zero writes
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
      person_season_memberships: { limit: [] }, // DB would filter out mentee roles since it queries role=mentor
      mentee_profiles: { limit: [{ id: "mp1" }] },
      applications: { limit: [] }
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

  describe("Phone Identity Guard", () => {
    const mentorInput = {
      role: "mentor" as const,
      seasonCode: S12_BINDING.seasonCode,
      intakeBatchCode: S12_BINDING.intakeBatchCode,
      fullName: "Test User",
      emailPrimary: "test@example.com",
      phonePrimary: "0901234567",
      consentDataStorage: true,
      rawPayload: {}
    };
    const phone = mentorInput.phonePrimary;

    it("same-role exact normalized phone -> identity_review", async () => {
      setupMocks({
        applications: { seed: [{ id: 1, email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentor" }] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
    });

    it("+84 / 0 normalization -> identity_review", async () => {
      setupMocks({
        applications: { seed: [{ id: 1, email_primary: "diff@example.com", phone_primary: phone.replace(/^0/, "+84"), role_applied: "mentor" }] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
    });

    it("changed email same role -> identity_review", async () => {
      setupMocks({
        applications: { seed: [{ id: 1, email_primary: "diff@example.com", phone_primary: phone, role_applied: "mentor" }] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
    });

    it("role filter correctly scopes the candidate set (10 mentor + 1 mentee same phone -> 10 candidates -> identity_review)", async () => {
      const mentors = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        email_primary: `mentor${i}@example.com`,
        phone_primary: phone,
        role_applied: "mentor"
      }));
      const mentee = { id: 100, email_primary: "mentee@example.com", phone_primary: phone, role_applied: "mentee" };
      setupMocks({
        applications: { seed: [...mentors, mentee] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
    });

    it("phone filter correctly scopes the candidate set (10 matching + 1 decoy phone -> 10 candidates -> identity_review)", async () => {
      const mentors = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        email_primary: `mentor${i}@example.com`,
        phone_primary: phone,
        role_applied: "mentor"
      }));
      const decoyPhone = { id: 100, email_primary: "decoy@example.com", phone_primary: "0909999999", role_applied: "mentor" };
      setupMocks({
        applications: { seed: [...mentors, decoyPhone] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với");
    });

    it("candidate set MAX+1 -> fail closed", async () => {
      const mentors = Array(11).fill(null).map((_, i) => ({
        id: i + 1,
        email_primary: `mentor${i}@example.com`,
        phone_primary: phone,
        role_applied: "mentor"
      }));
      setupMocks({
        applications: { seed: mentors }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("db");
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("cross-role same phone -> allowed", async () => {
      const mentee = { id: 1, email_primary: "mentee@example.com", phone_primary: phone, role_applied: "mentee" };
      setupMocks({
        applications: { seed: [mentee] }
      });
      const result = await submitPilotApplication(mentorInput);
      expect(result.ok).toBe(true);
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
});
