import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/application-form-controls", () => ({
  readApplicationFormState: vi.fn()
}));

import { evaluateApplyGate } from "../lib/apply-gate";
import { readApplicationFormState } from "@/lib/application-form-controls";

const TOKEN = "s12-pilot-token-value";

function dbState(state: "closed" | "pilot" | "open", reason: string | null = null) {
  vi.mocked(readApplicationFormState).mockResolvedValue({ state, reason } as never);
}

/**
 * M069 — the canonical gate. Both the page render and the submission Server
 * Action resolve THIS function, so every row of this decision table is
 * simultaneously a statement about what a direct Server Action invocation can
 * and cannot do.
 */
describe("evaluateApplyGate — M069 database-backed decision table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAM_OS_APPLY_TOKEN = TOKEN;
    delete process.env.VAM_OS_APPLICATION_PILOT_TOKEN;
  });

  // ── CLOSED ────────────────────────────────────────────────────────────────
  it.each(["mentor", "mentee"] as const)("CLOSED %s denies with no token", async (role) => {
    dbState("closed");
    await expect(evaluateApplyGate(undefined, role)).resolves.toMatchObject({
      status: "closed",
      code: "state_closed"
    });
  });

  it("CLOSED cannot be bypassed by presenting the correct token", async () => {
    dbState("closed");
    const gate = await evaluateApplyGate(TOKEN, "mentor");
    expect(gate.status).toBe("closed");
    // Specifically NOT a token-related denial: closed is closed regardless.
    expect(gate).toMatchObject({ code: "state_closed" });
  });

  // ── OPEN ──────────────────────────────────────────────────────────────────
  it.each(["mentor", "mentee"] as const)("OPEN %s allows with no token", async (role) => {
    dbState("open");
    await expect(evaluateApplyGate(undefined, role)).resolves.toEqual({
      status: "open",
      state: "open"
    });
  });

  it("OPEN ignores a wrong token rather than failing on it", async () => {
    dbState("open");
    await expect(evaluateApplyGate("garbage", "mentee")).resolves.toMatchObject({
      status: "open"
    });
  });

  // ── PILOT ─────────────────────────────────────────────────────────────────
  it("PILOT allows the exact token", async () => {
    dbState("pilot");
    await expect(evaluateApplyGate(TOKEN, "mentor")).resolves.toEqual({
      status: "open",
      state: "pilot"
    });
  });

  it("PILOT tolerates surrounding whitespace on the provided token", async () => {
    dbState("pilot");
    await expect(evaluateApplyGate(`  ${TOKEN}  `, "mentor")).resolves.toMatchObject({
      status: "open"
    });
  });

  it("PILOT denies a missing token", async () => {
    dbState("pilot");
    await expect(evaluateApplyGate(undefined, "mentor")).resolves.toMatchObject({
      status: "closed",
      code: "token_required"
    });
  });

  it("PILOT denies an empty token", async () => {
    dbState("pilot");
    await expect(evaluateApplyGate("   ", "mentee")).resolves.toMatchObject({
      status: "closed",
      code: "token_required"
    });
  });

  it.each([
    ["wrong value", "not-the-token"],
    ["correct prefix", `${TOKEN.slice(0, 8)}`],
    ["token plus suffix", `${TOKEN}x`],
    ["case flipped", TOKEN.toUpperCase()]
  ])("PILOT denies a %s token", async (_label, provided) => {
    dbState("pilot");
    await expect(evaluateApplyGate(provided, "mentor")).resolves.toMatchObject({
      status: "closed",
      code: "token_invalid"
    });
  });

  it("PILOT fails closed when no token is configured on the server", async () => {
    dbState("pilot");
    delete process.env.VAM_OS_APPLY_TOKEN;
    await expect(evaluateApplyGate("anything", "mentor")).resolves.toMatchObject({
      status: "closed",
      code: "token_not_configured"
    });
  });

  it("PILOT still honours the legacy VAM_OS_APPLICATION_PILOT_TOKEN name", async () => {
    dbState("pilot");
    delete process.env.VAM_OS_APPLY_TOKEN;
    process.env.VAM_OS_APPLICATION_PILOT_TOKEN = TOKEN;
    await expect(evaluateApplyGate(TOKEN, "mentor")).resolves.toMatchObject({
      status: "open"
    });
  });

  it("VAM_OS_APPLY_TOKEN takes precedence over the legacy name", async () => {
    dbState("pilot");
    process.env.VAM_OS_APPLY_TOKEN = TOKEN;
    process.env.VAM_OS_APPLICATION_PILOT_TOKEN = "legacy-value";
    await expect(evaluateApplyGate("legacy-value", "mentor")).resolves.toMatchObject({
      status: "closed",
      code: "token_invalid"
    });
  });

  // ── FAIL-CLOSED ───────────────────────────────────────────────────────────
  it("fails closed when the control lookup reports an error", async () => {
    dbState("closed", "control_rows_unreadable");
    await expect(evaluateApplyGate(TOKEN, "mentor")).resolves.toMatchObject({
      status: "closed",
      code: "lookup_failed"
    });
  });

  it("fails closed on a malformed role without consulting the database", async () => {
    const gate = await evaluateApplyGate(TOKEN, "administrator" as never);
    expect(gate).toMatchObject({ status: "closed", code: "bad_role" });
    expect(readApplicationFormState).not.toHaveBeenCalled();
  });

  // ── SECRET HYGIENE ────────────────────────────────────────────────────────
  it("never returns the configured token in any decision", async () => {
    for (const state of ["closed", "pilot", "open"] as const) {
      dbState(state);
      for (const provided of [undefined, TOKEN, "wrong"]) {
        const gate = await evaluateApplyGate(provided, "mentor");
        expect(JSON.stringify(gate)).not.toContain(TOKEN);
      }
    }
  });

  it("never writes the token to the console", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    dbState("pilot");
    await evaluateApplyGate("wrong-token", "mentor");
    await evaluateApplyGate(TOKEN, "mentor");
    dbState("closed", "control_rows_missing");
    await evaluateApplyGate(TOKEN, "mentee");

    for (const spy of [errorSpy, warnSpy, logSpy]) {
      const emitted = JSON.stringify(spy.mock.calls);
      expect(emitted).not.toContain(TOKEN);
      expect(emitted).not.toContain("wrong-token");
    }

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ── ROLE INDEPENDENCE ─────────────────────────────────────────────────────
  it("resolves mentor and mentee independently", async () => {
    vi.mocked(readApplicationFormState).mockImplementation(
      async (role) =>
        ({ state: role === "mentor" ? "open" : "closed", reason: null }) as never
    );

    await expect(evaluateApplyGate(undefined, "mentor")).resolves.toMatchObject({
      status: "open"
    });
    await expect(evaluateApplyGate(undefined, "mentee")).resolves.toMatchObject({
      status: "closed"
    });
  });
});
