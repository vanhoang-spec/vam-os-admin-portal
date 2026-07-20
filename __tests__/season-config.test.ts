import { describe, it, expect } from "vitest";
import { SEASON_CONFIG } from "../lib/season-config";

// ── S11 operating season guard ────────────────────────────────────────────────
//
// CURRENT_OPERATING_SEASON_CODE must remain "UEHM-S11" for the entire Batch-3
// window. S11 data is historical reference; changing this constant would break
// all operational queries that scope data to the current operating season.

describe("SEASON_CONFIG — S11 operating season guard", () => {
  it('CURRENT_OPERATING_SEASON_CODE is exactly "UEHM-S11"', () => {
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).toBe("UEHM-S11");
  });

  it("CURRENT_OPERATING_SEASON_CODE has not been altered from the S11 value", () => {
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).not.toBe("UEHM-S12");
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).not.toBe("");
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).not.toBeNull();
  });
});

// ── S12 application season ────────────────────────────────────────────────────

describe("SEASON_CONFIG — S12 application season", () => {
  it('CURRENT_APPLICATION_SEASON_CODE is "UEHM-S12"', () => {
    expect(SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).toBe("UEHM-S12");
  });

  it('CURRENT_APPLICATION_BATCH_CODE starts with "UEHM-S12"', () => {
    expect(SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE).toMatch(/^UEHM-S12/);
  });
});

// ── Public application env flags ──────────────────────────────────────────────
//
// ENABLE_PUBLIC_MENTOR_APPLICATION and ENABLE_PUBLIC_MENTEE_APPLICATION must
// be controlled by env vars (VAM_OS_ENABLE_MENTOR_APPLICATION / MENTEE_APPLICATION),
// not hardcoded. In test environments the env vars are unset, so both resolve
// to false. This guards against accidental hardcoding of true.

describe("SEASON_CONFIG — public application flags", () => {
  it("ENABLE_PUBLIC_MENTOR_APPLICATION is boolean", () => {
    expect(typeof SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION).toBe("boolean");
  });

  it("ENABLE_PUBLIC_MENTEE_APPLICATION is boolean", () => {
    expect(typeof SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION).toBe("boolean");
  });

  it("ENABLE_PUBLIC_MENTOR_APPLICATION is false when env var is unset (test env)", () => {
    // Guards against the flag being hardcoded to true
    expect(SEASON_CONFIG.ENABLE_PUBLIC_MENTOR_APPLICATION).toBe(false);
  });

  it("ENABLE_PUBLIC_MENTEE_APPLICATION is false when env var is unset (test env)", () => {
    expect(SEASON_CONFIG.ENABLE_PUBLIC_MENTEE_APPLICATION).toBe(false);
  });
});
