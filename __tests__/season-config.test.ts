import { describe, it, expect } from "vitest";
import { SEASON_CONFIG } from "../lib/season-config";

// ── S12 operating season guard ────────────────────────────────────────────────
//
// CURRENT_OPERATING_SEASON_CODE must remain "UEHM-S12" for the current operating
// window. S11 data is historical reference; changing this constant would break
// all operational queries that scope data to the current operating season.

describe("SEASON_CONFIG — S12 operating season guard", () => {
  it('CURRENT_OPERATING_SEASON_CODE is exactly "UEHM-S12"', () => {
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).toBe("UEHM-S12");
  });

  it("CURRENT_OPERATING_SEASON_CODE has not been altered from the S12 value", () => {
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).not.toBe("UEHM-S11");
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

// ── M069: the env enable-flags are gone ───────────────────────────────────────
//
// The public form state moved out of SEASON_CONFIG and into the database
// (public.application_form_controls). These assertions exist so the flags
// cannot quietly come back: a re-added ENABLE_PUBLIC_* would give the codebase
// two sources of truth for whether recruitment is open, and the DB one would
// stop being authoritative.

describe("SEASON_CONFIG — M069 removed the public application env flags", () => {
  it("no longer exposes ENABLE_PUBLIC_MENTOR_APPLICATION", () => {
    expect(SEASON_CONFIG).not.toHaveProperty("ENABLE_PUBLIC_MENTOR_APPLICATION");
  });

  it("no longer exposes ENABLE_PUBLIC_MENTEE_APPLICATION", () => {
    expect(SEASON_CONFIG).not.toHaveProperty("ENABLE_PUBLIC_MENTEE_APPLICATION");
  });

  it("exposes no key at all that could re-open a form from config", () => {
    const openers = Object.keys(SEASON_CONFIG).filter((key) =>
      /ENABLE|OPEN|TOKENLESS|ALLOW/i.test(key)
    );
    expect(openers).toEqual([]);
  });
});
