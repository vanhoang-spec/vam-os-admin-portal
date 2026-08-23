import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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

function mockClient(options: { 
  rpcResult?: unknown; 
  rpcError?: unknown; 
  dupEmailRow?: unknown; 
  dupMssvRow?: unknown;
} = {}) {
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
    if (table === "applications") {
      return {
        select: vi.fn(() => {
          const duplicateChain: Record<string, any> = {};
          duplicateChain.eq = vi.fn((field, val) => {
             // Basic mock matching to differentiate email vs mssv check
             if (field === "email_primary" && options.dupEmailRow) {
                duplicateChain._mockReturn = options.dupEmailRow;
             } else if (field === "raw_payload->>mssv" && options.dupMssvRow) {
                duplicateChain._mockReturn = options.dupMssvRow;
             }
             return duplicateChain;
          });
          duplicateChain.ilike = vi.fn(() => duplicateChain);
          duplicateChain.limit = vi.fn(() => duplicateChain);
          duplicateChain.maybeSingle = vi.fn(async () => ({ data: duplicateChain._mockReturn || null, error: null }));
          return duplicateChain;
        })
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const rpc = vi.fn(async (...args: any[]) => ({ data: options.rpcResult, error: options.rpcError }));

  return { client: { from, rpc }, rpc };
}

const baseInput = {
  role: "mentee" as const,
  seasonCode: "UEHM-S12",
  intakeBatchCode: "UEHM-S12-B1",
  fullName: "Mentee Test",
  emailPrimary: "mentee@example.com",
  phonePrimary: "0900000000",
  consentDataStorage: true,
  rawPayload: { mssv: "31201020000" },
  answers: []
};

const DUPLICATE_MSG = "Email hoặc MSSV này đã có đơn đăng ký trong đợt hiện tại. Nếu cần điều chỉnh thông tin, vui lòng liên hệ BTC.";

  describe("M077 Canonical Applicant Identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("handles duplicate caught by DB unique index via RPC", async () => {
    const { client } = mockClient({ 
      rpcResult: { ok: false, code: "duplicate", message: DUPLICATE_MSG }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await submitPilotApplication(baseInput);

    expect(result).toEqual({
      ok: false,
      code: "duplicate",
      message: DUPLICATE_MSG
    });
  });

  it("fails correctly if RPC encounters a non-duplicate error", async () => {
    const { client } = mockClient({ rpcError: new Error("network issue") });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await submitPilotApplication(baseInput);

    expect(result).toEqual({
      ok: false,
      code: "db",
      message: expect.stringContaining("Không thể ghi đơn ứng tuyển")
    });
  });

  it("persists no raw token through the RPC", async () => {
    const { client, rpc } = mockClient({ rpcResult: { ok: true, applicationId: APPLICATION_ID } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    await submitPilotApplication({ ...baseInput, applyToken: "secret_token_123" });

    // Ensure rawPayload sent to DB does NOT contain applyToken, and the RPC arguments don't either
    expect(rpc).toHaveBeenCalledOnce();
    const rpcArgs = rpc.mock.calls[0][1] as any;
    expect(rpcArgs.p_raw_payload.applyToken).toBeUndefined();
    expect(rpcArgs.p_apply_token).toBeUndefined();
  });
});
