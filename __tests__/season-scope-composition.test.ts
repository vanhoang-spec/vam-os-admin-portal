import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: (fn: unknown) => fn }));
import { intersectAuthorizedAndCohort } from "@/lib/season-cohort";
import { composeSeasonScope } from "@/lib/season-context";

describe("authorization, season and cohort composition", () => {
  it("preserves program authorization and always narrows to one selected season", () => {
    expect(composeSeasonScope({ allowedProgramIds: ["uehm", "UEHM"], allowedSeasonIds: ["s11", "s12"] }, "s12"))
      .toEqual({ allowedProgramIds: ["uehm", "UEHM"], allowedSeasonIds: ["s12"] });
    expect(composeSeasonScope(undefined, "s12")).toEqual({ allowedSeasonIds: ["s12"] });
  });

  it("intersects in both directions and keeps super admin inside the cohort", () => {
    expect(intersectAuthorizedAndCohort(["a", "b"], ["b", "c"])).toEqual(["b"]);
    expect(intersectAuthorizedAndCohort(["b", "c"], ["a", "b"])).toEqual(["b"]);
    expect(intersectAuthorizedAndCohort(null, ["official"])).toEqual(["official"]);
  });
});
