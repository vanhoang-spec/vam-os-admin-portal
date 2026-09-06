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
    
    // Default chain setup for fluent Supabase mocks
    const chain = {
      select: mockSelect,
      eq: mockEq,
      in: mockIn,
      ilike: mockIlike,
      limit: mockLimit,
      maybeSingle: mockMaybeSingle,
      insert: mockInsert,
      delete: mockDelete
    };
    mockClient.from.mockReturnValue(chain as any);
    mockSelect.mockReturnValue(chain as any);
    mockEq.mockReturnValue(chain as any);
    mockIn.mockReturnValue(chain as any);
    mockIlike.mockReturnValue(chain as any);
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsert.mockReturnValue(chain as any);
    
    // Specific table mock responses
    (mockClient.from as any).mockImplementation((table: string) => {
      const tbChain: any = {
        select: vi.fn(() => tbChain),
        eq: vi.fn(() => tbChain),
        in: vi.fn(() => tbChain),
        ilike: vi.fn(() => tbChain),
        limit: vi.fn(() => tbChain),
        maybeSingle: vi.fn(() => tbChain),
        insert: vi.fn(() => tbChain)
      };

      if (table === "seasons") {
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "season_id", code: S12_BINDING.seasonCode }, error: null });
      } else if (table === "intake_batches") {
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "batch_id" }, error: null });
      } else if (table === "applications") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "inserted_app_id" }, error: null });
      } else if (table === "people") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      } else if (table === "mentor_profiles" || table === "mentee_profiles" || table === "person_season_memberships") {
        tbChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      }
      return tbChain;
    });
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

  it("1. brand new -> allow", async () => {
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(true);
  });

  it("2. same-season duplicate -> block", async () => {
    (mockClient.from as any).mockImplementation((table: string) => {
      const tbChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnThis()
      };
      if (table === "seasons") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null });
      if (table === "intake_batches") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });
      if (table === "applications") tbChain.limit = vi.fn().mockResolvedValue({ data: [{ email_primary: "test@example.com" }], error: null });
      return tbChain;
    });
    
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
  });

  it("3. current S12 Mentee -> block", async () => {
    (mockClient.from as any).mockImplementation((table: string) => {
      const tbChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnThis()
      };
      if (table === "seasons") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null });
      if (table === "intake_batches") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });
      if (table === "applications") tbChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      if (table === "people") tbChain.limit = vi.fn().mockResolvedValue({ data: [{ id: "p1", email_primary: "test@example.com" }], error: null });
      if (table === "person_season_memberships") tbChain.limit = vi.fn().mockResolvedValue({ data: [{ role: "mentee" }], error: null });
      if (table === "mentee_profiles") tbChain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      return tbChain;
    });
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Hồ sơ của bạn đã có trên hệ thống VAM OS");
  });

  it("9. changed email + same-role historical phone -> identity_review", async () => {
    let callCount = 0;
    (mockClient.from as any).mockImplementation((table: string) => {
      const tbChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis()
      };
      if (table === "seasons") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null });
      if (table === "intake_batches") tbChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });
      if (table === "applications") {
        tbChain.limit = vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ data: [], error: null }); // duplicate email check
          if (callCount === 2) return Promise.resolve({ data: [], error: null }); // duplicate email check fallback
          if (callCount === 3) return Promise.resolve({ data: [{ email_primary: "other@example.com" }], error: null }); // phone check
          return Promise.resolve({ data: [], error: null });
        });
      }
      return tbChain;
    });
    
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Thông tin bạn nhập trùng với một hồ sơ");
  });
});
