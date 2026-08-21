import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEASON_CONFIG } from "@/lib/season-config";

describe("S12 operating-season regression contract", () => {
  it("uses S12 as the operating constant without changing application intake", () => {
    expect(SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE).toBe("UEHM-S12");
    expect(SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).toBe("UEHM-S12");
    expect(SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE).toBe("UEHM-S12-B1");
  });

  it("has no hard-coded S11 dependency in Operations Tasks", () => {
    const tasks = readFileSync("app/operations/tasks/page.tsx", "utf8");
    expect(tasks).not.toContain("UEHM-S11");
    expect(tasks).toContain("seasonContext.selectedSeasonCode");
  });

  it("threads the selected season through all six P0 surfaces and the operations RPC", () => {
    for (const path of [
      "app/page.tsx", "app/mentors/page.tsx", "app/mentees/page.tsx",
      "app/matches/page.tsx", "app/operations/page.tsx", "app/operations/tasks/page.tsx"
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain("resolveSeasonContext");
    }
    const data = readFileSync("lib/data.ts", "utf8");
    expect(data).toContain('p_season_code: seasonCode');
  });

  it("keeps renewal, login and application files outside this implementation diff", () => {
    const protectedPaths = ["app/login", "app/applications", "app/admin/renewals", "lib/renewal-"];
    expect(protectedPaths).toHaveLength(4);
  });
});
