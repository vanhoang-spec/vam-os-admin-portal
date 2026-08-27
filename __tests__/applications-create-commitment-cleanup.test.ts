import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// M069: the role gate is now database-backed. This suite is about the
// answer-insert cleanup path, so the gate is stubbed OPEN; the gate's own
// behaviour is covered by apply-gate.test.ts and m069-application-gate.test.ts.
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication } from "../lib/applications-create";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function mockClient(options: { answersError?: unknown; cleanupError?: unknown } = {}) {
  const deleteEq = vi.fn(async () => ({ error: options.cleanupError ?? null }));

  const from = vi.fn((table: string) => {
    if (table === "seasons") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: { id: "season-12", code: "UEHM-S12" }, error: null }));
      return chain;
    }
    if (table === "intake_batches") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: { id: "batch-1", code: "UEHM-S12-B1" }, error: null }));
      return chain;
    }
    if (table === "application_answers") {
      return { insert: vi.fn(async () => ({ error: options.answersError ?? null })) };
    }
    if (table === "people") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.ilike = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      return chain;
    }
    if (table === "applications") {
      return {
        select: vi.fn(() => {
          const duplicateChain: Record<string, any> = {};
          duplicateChain.eq = vi.fn(() => duplicateChain);
          duplicateChain.ilike = vi.fn(() => duplicateChain);
          duplicateChain.limit = vi.fn(() => duplicateChain);
          duplicateChain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
          return duplicateChain;
        }),
        insert: vi.fn(() => {
          const insertChain: Record<string, any> = {};
          insertChain.select = vi.fn(() => insertChain);
          insertChain.maybeSingle = vi.fn(async () => ({ data: { id: APPLICATION_ID }, error: null }));
          return insertChain;
        }),
        delete: vi.fn(() => ({ eq: deleteEq }))
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, deleteEq };
}

const input = {
  role: "mentor" as const,
  seasonCode: "UEHM-S12",
  intakeBatchCode: "UEHM-S12-B1",
  fullName: "Mentor Test",
  emailPrimary: "mentor@example.com",
  phonePrimary: "0900000000",
  consentDataStorage: true,
  rawPayload: {},
  answers: [
    {
      questionKey: "MENTOR_TIME_COMMITMENT_V1",
      questionLabel: "Cam kết",
      valueText: "true",
      acceptedAt: "2026-08-09T00:00:00.000Z"
    }
  ]
};

describe("submitPilotApplication acknowledgement cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps normal DB failure behavior when answer insert fails and exact-ID cleanup succeeds", async () => {
    const { client, deleteEq } = mockClient({ answersError: { code: "500", message: "answers failed" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await submitPilotApplication(input);

    expect(result).toMatchObject({ ok: false, code: "db" });
    expect(deleteEq).toHaveBeenCalledOnce();
    expect(deleteEq).toHaveBeenCalledWith("id", APPLICATION_ID);
  });

  it("returns a distinct public-safe response when answer insert and cleanup both fail", async () => {
    const { client, deleteEq } = mockClient({
      answersError: { code: "500", message: "answers secret" },
      cleanupError: { code: "42501", message: "cleanup secret" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await submitPilotApplication(input);

    expect(result).toEqual({
      ok: false,
      code: "incomplete_submission",
      message:
        "Đơn của bạn có thể đã được ghi nhận chưa hoàn tất. Vui lòng không gửi lại nhiều lần và liên hệ Ban Tổ chức để được hỗ trợ."
    });
    expect(deleteEq).toHaveBeenCalledOnce();
    expect(deleteEq).toHaveBeenCalledWith("id", APPLICATION_ID);
    if (result.ok) throw new Error("Expected incomplete-submission failure");
    expect(result.message).not.toContain(APPLICATION_ID);
    expect(result.message).not.toContain("secret");
  });

  it("leaves successful application and answer persistence unchanged", async () => {
    const { client, deleteEq } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    await expect(submitPilotApplication(input)).resolves.toEqual({
      ok: true,
      applicationId: APPLICATION_ID
    });
    expect(deleteEq).not.toHaveBeenCalled();
  });
});
