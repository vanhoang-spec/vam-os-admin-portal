import { describe, expect, it } from "vitest";
import { isSeasonAwarePath, seasonLabel } from "@/lib/season-labels";
import { readFileSync } from "node:fs";

describe("season labels and P0 visibility", () => {
  it("uses the locked friendly labels", () => {
    expect(seasonLabel("UEHM-S12")).toBe("Mùa 12");
    expect(seasonLabel("UEHM-S11")).toBe("Mùa 11");
  });

  it("shows the selector only on the seven season-aware routes", () => {
    expect(
      ["/", "/mentors", "/mentees", "/matches", "/operations", "/operations/tasks", "/participant-accounts"].every(
        isSeasonAwarePath
      )
    ).toBe(true);
    expect([
      "/applications", "/admin/applications/x", "/portfolio", "/programs/UEHM",
      "/admin/renewals", "/admin/users", "/apply/mentor", "/renew/x",
      "/register/x", "/checkin/x", "/operations/monthly", "/operations/intelligence"
    ].some(isSeasonAwarePath)).toBe(false);
  });

  it("keeps selection server-validated and persists only an HttpOnly Lax cookie", () => {
    const action = readFileSync("app/actions/season-context.ts", "utf8");
    const selector = readFileSync("components/season-selector.tsx", "utf8");
    expect(action).toContain("resolveSeasonContext(requestedSeason)");
    expect(action).toContain("httpOnly: true");
    expect(action).toContain('sameSite: "lax"');
    expect(action).toContain('path: "/"');
    expect(action).toContain('secure: process.env.NODE_ENV === "production"');
    expect(`${action}\n${selector}`).not.toContain("localStorage");
  });
});
