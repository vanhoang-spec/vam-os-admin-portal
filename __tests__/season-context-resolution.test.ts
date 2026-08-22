import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: (fn: unknown) => fn }));
import { resolveSeasonSelection } from "@/lib/season-context";

const seasons = [
  { id: "s9", code: "UEHM-S9", name: "Season 9", programId: "uehm" },
  { id: "s12", code: "UEHM-S12", name: "Season 12", programId: "uehm" },
  { id: "s11", code: "UEHM-S11", name: "Season 11", programId: "uehm" }
];

function resolve(explicitSeason?: string | string[] | null, cookieSeason?: string | null) {
  return resolveSeasonSelection({
    explicitSeason,
    cookieSeason,
    defaultSeasonCode: "UEHM-S12",
    authorizedCurrentProgramSeasons: seasons
  });
}

describe("season request precedence", () => {
  it("defaults explicitly to S12 even when lexical order would put S9 last", () => {
    expect(resolve().code).toBe("UEHM-S12");
  });

  it("resolves query over cookie over the constant", () => {
    expect(resolve("UEHM-S11", "UEHM-S9").code).toBe("UEHM-S11");
    expect(resolve(undefined, "UEHM-S11").code).toBe("UEHM-S11");
    expect(resolve(undefined, null).code).toBe("UEHM-S12");
  });

  it("fails closed for an invalid explicit value and discards a stale cookie", () => {
    expect(() => resolve("../../S11", "UEHM-S11")).toThrowError("Không thể xác minh mùa vận hành được yêu cầu");
    expect(resolve(undefined, "UEHM-S404").code).toBe("UEHM-S12");
    expect(resolve(undefined, "not a season").code).toBe("UEHM-S12");
  });
});
