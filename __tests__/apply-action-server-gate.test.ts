import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication, type ApplicationRole } from "../lib/applications-create";
import { evaluateApplyGate } from "@/lib/apply-gate";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const CLOSED_MESSAGE =
  "Đơn đăng ký cho vai trò này hiện chưa được mở. Vui lòng chờ thông báo chính thức.";

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
    if (table === "people") {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.ilike = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, from, applicationInsert };
}

function input(role: ApplicationRole, overrides: Record<string, unknown> = {}) {
  return {
    role,
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    fullName: `${role} Test`,
    emailPrimary: `${role}@example.com`,
    phonePrimary: "0900000000",
    consentDataStorage: true,
    rawPayload: {},
    ...overrides
  } as Parameters<typeof submitPilotApplication>[0];
}

function gateOpen() {
  vi.mocked(evaluateApplyGate).mockResolvedValue({ status: "open", state: "open" } as never);
}

function gateClosed(code = "state_closed") {
  vi.mocked(evaluateApplyGate).mockResolvedValue({
    status: "closed",
    state: "closed",
    reason: "closed",
    code
  } as never);
}

describe("submitPilotApplication — M069 server-authoritative gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateOpen();
  });

  it.each(["mentor", "mentee"] as const)(
    "refuses a closed %s gate before any application insert, with a safe message",
    async (role) => {
      const { client, from, applicationInsert } = mockClient();
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
      gateClosed();

      const result = await submitPilotApplication(input(role));

      expect(result).toEqual({ ok: false, code: "validation", message: CLOSED_MESSAGE });
      expect(applicationInsert).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalledWith("application_answers");
      if (result.ok) throw new Error("Expected closed-gate refusal");
      expect(result.message).not.toMatch(/season-12|batch-1|SUPABASE|database|internal/i);
    }
  );

  it("evaluates the gate BEFORE touching the database at all", async () => {
    const { client, from } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
    gateClosed();

    await submitPilotApplication(input("mentor"));

    // Not one table was read. A closed form is not a queryable endpoint.
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["token_required", "a stale pilot link with no token"],
    ["token_invalid", "a forged token"],
    ["token_not_configured", "an unconfigured server token"],
    ["lookup_failed", "an unreadable control row"]
  ])("refuses on gate code %s (%s) with the same generic message", async (code) => {
    const { client, applicationInsert } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
    gateClosed(code);

    const result = await submitPilotApplication(input("mentor"));

    expect(result).toEqual({ ok: false, code: "validation", message: CLOSED_MESSAGE });
    expect(applicationInsert).not.toHaveBeenCalled();
  });

  it.each(["mentor", "mentee"] as const)(
    "preserves the valid %s submission path when the gate is open",
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
    vi.mocked(evaluateApplyGate).mockImplementation(
      async (_token, role) =>
        (role === "mentor"
          ? { status: "closed", state: "closed", reason: "closed", code: "state_closed" }
          : { status: "open", state: "open" }) as never
    );

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

  // ── Fixed Season 12 binding ───────────────────────────────────────────────
  it.each([
    ["a Season 11 season code", { seasonCode: "UEHM-S11" }],
    ["a Season 11 intake code", { intakeBatchCode: "UEHM-S11-B1" }],
    ["a fabricated future intake", { intakeBatchCode: "UEHM-S12-B2" }],
    ["an empty season code", { seasonCode: "" }]
  ])("refuses %s outright and never consults the gate", async (_label, overrides) => {
    const { client, from } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await submitPilotApplication(input("mentor", overrides));

    expect(result).toEqual({ ok: false, code: "validation", message: CLOSED_MESSAGE });
    expect(evaluateApplyGate).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("binds an accepted submission to exactly UEHM-S12 / UEHM-S12-B1", async () => {
    const { client, from } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    await submitPilotApplication(input("mentee"));

    const seasonChain = from.mock.results.find((r, i) => from.mock.calls[i][0] === "seasons");
    expect(seasonChain).toBeDefined();
    expect((seasonChain!.value as any).eq).toHaveBeenCalledWith("code", "UEHM-S12");
  });

  // ── Token hygiene ─────────────────────────────────────────────────────────
  it("passes the token to the gate and to nothing else", async () => {
    const { client, applicationInsert } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const secret = "pilot-secret-abc123";
    await submitPilotApplication(input("mentor", { applyToken: secret }));

    expect(evaluateApplyGate).toHaveBeenCalledWith(secret, "mentor");

    // The token must not reach the applications row in any column.
    expect(applicationInsert).toHaveBeenCalledOnce();
    expect(JSON.stringify(applicationInsert.mock.calls)).not.toContain(secret);
  });

  it("never logs the token on a refusal", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { client } = mockClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
    gateClosed("token_invalid");

    const secret = "pilot-secret-xyz789";
    await submitPilotApplication(input("mentor", { applyToken: secret }));
    await submitPilotApplication(input("mentor", { applyToken: secret, seasonCode: "UEHM-S11" }));

    for (const spy of [warnSpy, errorSpy]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    }

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
