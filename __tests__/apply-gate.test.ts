import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluateApplyGate } from "../lib/apply-gate";
import { SEASON_CONFIG } from "../lib/season-config";

// Mock SEASON_CONFIG so we can safely mutate ENABLE_PUBLIC_* for tests
vi.mock("../lib/season-config", () => ({
  SEASON_CONFIG: {
    ENABLE_PUBLIC_MENTOR_APPLICATION: false,
    ENABLE_PUBLIC_MENTEE_APPLICATION: false,
  }
}));

describe("evaluateApplyGate Security Requirements", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "production" };
    // Reset config explicitly
    SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION = true;
    SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION = true;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("A. enabled form + correct token => OPEN", () => {
    process.env.VAM_OS_APPLY_TOKEN = "SECRET123";
    const result = evaluateApplyGate("SECRET123", "mentor");
    expect(result.status).toBe("open");
  });

  it("B. enabled form + no token + tokenless flag absent => CLOSED", () => {
    process.env.VAM_OS_APPLY_TOKEN = "SECRET123";
    delete process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS;
    const result = evaluateApplyGate(undefined, "mentor");
    expect(result.status).toBe("closed");
  });

  it("C. enabled form + no token + tokenless flag false => CLOSED", () => {
    process.env.VAM_OS_APPLY_TOKEN = "SECRET123";
    process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS = "false";
    const result = evaluateApplyGate(undefined, "mentor");
    expect(result.status).toBe("closed");
  });

  it("D. enabled form + no token + tokenless flag true => OPEN", () => {
    process.env.VAM_OS_APPLY_TOKEN = "SECRET123";
    process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS = "true";
    const result = evaluateApplyGate(undefined, "mentor");
    expect(result.status).toBe("open");
  });

  it("E. disabled Mentor form remains CLOSED even with tokenless flag", () => {
    SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION = false;
    process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS = "true";
    const result = evaluateApplyGate(undefined, "mentor");
    expect(result.status).toBe("closed");
  });

  it("F. disabled Mentee form remains CLOSED even with tokenless flag", () => {
    SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION = false;
    process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS = "true";
    const result = evaluateApplyGate(undefined, "mentee");
    expect(result.status).toBe("closed");
  });

  it("G. malformed/unknown flag value => CLOSED", () => {
    process.env.VAM_OS_APPLY_TOKEN = "SECRET123";
    process.env.VAM_OS_ALLOW_TOKENLESS_APPLICATIONS = "yes"; // Not "true"
    const result = evaluateApplyGate(undefined, "mentor");
    expect(result.status).toBe("closed");
  });
});
