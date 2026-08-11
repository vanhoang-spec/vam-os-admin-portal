import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/season-config", () => ({
  SEASON_CONFIG: {
    ENABLE_PUBLIC_MENTOR_APPLICATION: true,
    ENABLE_PUBLIC_MENTEE_APPLICATION: true
  }
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication, type ApplicationRole } from "../lib/applications-create";
import { SEASON_CONFIG } from "../lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function mockClient() {
  const applicationInsert = vi.fn(() => {
    const chain: Record<string, any> = {};
    chain.select = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: { id: APPLICATION_ID }, error: null }));
    return chain;
  });

  const from = vi.fn((table: string) => {
    if (table === "seasons") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({
        data: { id: "season-12", code: "UEHM-S12" },
        error: null
      }));
      return chain;
    }
    if (table === "intake_batches") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({
        data: { id: "batch-1", code: "UEHM-S12-B1" },
        error: null
      }));
      return chain;
    }
    if (table === "applications") {
      return {
        select: vi.fn(() => {
          const chain: Record<string, any> = {};
          chain.eq = vi.fn(() => chain);
          chain.ilike = vi.fn(() => chain);
          chain.limit = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
          return chain;
        }),
        insert: applicationInsert
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, from, applicationInsert };
}

function input(role: ApplicationRole) {
  return {
    role,
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    fullName: `${role} Test`,
    emailPrimary: `${role}@example.com`,
    phonePrimary: "0900000000",
    consentDataStorage: true,
    rawPayload: {}
  };
}

describe("submitPilotApplication server-authoritative role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION = true;
    SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION = true;
  });

  it.each(["mentor", "mentee"] as const)(
    "blocks a closed %s gate before any application insert with a safe response",
    async (role) => {
      const { client, from, applicationInsert } = mockClient();
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
      if (role === "mentor") SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION = false;
      else SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION = false;

      const result = await submitPilotApplication(input(role));

      expect(result).toEqual({
        ok: false,
        code: "validation",
        message: "Đơn đăng ký cho vai trò này hiện chưa được mở. Vui lòng chờ thông báo chính thức."
      });
      expect(applicationInsert).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalledWith("application_answers");
      if (result.ok) throw new Error("Expected closed-gate validation failure");
      expect(result.message).not.toMatch(/season-12|batch-1|UEHM-S12|SUPABASE|database|internal/i);
    }
  );

  it.each(["mentor", "mentee"] as const)(
    "preserves the existing valid %s submission path when open",
    async (role) => {
      const { client, applicationInsert } = mockClient();
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

      await expect(submitPilotApplication(input(role))).resolves.toEqual({
        ok: true,
        applicationId: APPLICATION_ID
      });
      expect(applicationInsert).toHaveBeenCalledOnce();
      expect(applicationInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          role_applied: role,
          season_id: "season-12",
          intake_batch_id: "batch-1"
        })
      );
    }
  );

  it("keeps mentor and mentee gates independent", async () => {
    SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION = false;
    SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION = true;

    const mentor = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(mentor.client as never);
    await expect(submitPilotApplication(input("mentor"))).resolves.toMatchObject({
      ok: false,
      code: "validation"
    });
    expect(mentor.applicationInsert).not.toHaveBeenCalled();

    const mentee = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(mentee.client as never);
    await expect(submitPilotApplication(input("mentee"))).resolves.toEqual({
      ok: true,
      applicationId: APPLICATION_ID
    });
    expect(mentee.applicationInsert).toHaveBeenCalledOnce();
  });
});
