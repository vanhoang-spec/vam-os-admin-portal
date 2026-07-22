import { describe, expect, it } from "vitest";
import {
  ProgramContextError,
  assertEntityBelongsToProgram,
  assertEntityBelongsToSeason,
  assertIntakeBatchBelongsToSeason,
  requireGlobalAdmin,
  resolveAccessiblePrograms,
  resolveCanonicalContext,
  resetDependentContext,
  type ProgramAccessPrincipal,
  type ProgramContextCatalog
} from "@/lib/program-context-core";

const catalog: ProgramContextCatalog = {
  programs: [
    { id: "program-ueh", code: "UEHM", name: "UEH Mentoring", isActive: true },
    { id: "program-ham", code: "HAM", name: "Hanoi Alumni Mentoring", isActive: true },
    { id: "program-old", code: "OLD", name: "Archived", isActive: false }
  ],
  seasons: [
    { id: "season-ueh-12", code: "UEHM-S12", name: "UEH Season 12", programId: "program-ueh", status: "active" },
    { id: "season-ham-6", code: "HAM-S6", name: "HAM Season 6", programId: "program-ham", status: "active" }
  ],
  intakeBatches: [
    { id: "batch-ueh", code: "UEHM-S12-B1", name: "UEH B1", seasonId: "season-ueh-12", isActive: true },
    { id: "batch-ham", code: "HAM-S6-B1", name: "HAM B1", seasonId: "season-ham-6", isActive: true }
  ]
};

const superAdmin: ProgramAccessPrincipal = { authenticated: true, isSuperAdmin: true, grants: [] };
const uehAdmin: ProgramAccessPrincipal = {
  authenticated: true,
  isSuperAdmin: false,
  grants: [{ programId: "program-ueh", seasonId: null, scopeLevel: "full_access" }]
};
const hamAdmin: ProgramAccessPrincipal = {
  authenticated: true,
  isSuperAdmin: false,
  grants: [{ programId: "HAM", seasonId: null, scopeLevel: "operations" }]
};
const uehSeasonReviewer: ProgramAccessPrincipal = {
  authenticated: true,
  isSuperAdmin: false,
  grants: [{ programId: null, seasonId: "UEHM-S12", scopeLevel: "review" }]
};

function errorCode(run: () => unknown) {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ProgramContextError);
    return (error as ProgramContextError).code;
  }
}

describe("multi-program access resolution", () => {
  it("Super Admin sees every active program but not archived programs", () => {
    expect(resolveAccessiblePrograms(superAdmin, catalog).map((row) => row.code)).toEqual(["UEHM", "HAM"]);
  });

  it("UEH Admin sees only UEH", () => {
    expect(resolveAccessiblePrograms(uehAdmin, catalog).map((row) => row.code)).toEqual(["UEHM"]);
  });

  it("HAM Admin sees only HAM even when the grant stores a legacy code", () => {
    expect(resolveAccessiblePrograms(hamAdmin, catalog).map((row) => row.code)).toEqual(["HAM"]);
  });

  it("a season-only grant resolves its parent program", () => {
    expect(resolveAccessiblePrograms(uehSeasonReviewer, catalog).map((row) => row.code)).toEqual(["UEHM"]);
  });

  it("requires authentication before resolving any catalog", () => {
    expect(
      errorCode(() => resolveAccessiblePrograms({ authenticated: false, isSuperAdmin: false, grants: [] }, catalog))
    ).toBe("unauthenticated");
  });

  it("requires Super Admin for global portfolio access", () => {
    expect(() => requireGlobalAdmin(superAdmin)).not.toThrow();
    expect(errorCode(() => requireGlobalAdmin(uehAdmin))).toBe("forbidden");
  });
});

describe("canonical context validation", () => {
  it("resolves a complete UEH context to canonical IDs", () => {
    expect(
      resolveCanonicalContext(uehAdmin, catalog, {
        programCode: "uehm",
        seasonCode: "uehm-s12",
        intakeBatchId: "batch-ueh"
      })
    ).toEqual({
      selectedProgramId: "program-ueh",
      selectedProgramCode: "UEHM",
      selectedSeasonId: "season-ueh-12",
      selectedSeasonCode: "UEHM-S12",
      selectedIntakeBatchId: "batch-ueh",
      accessMode: "program_scoped"
    });
  });

  it("marks a Super Admin program context as global access mode without adding PII", () => {
    const result = resolveCanonicalContext(superAdmin, catalog, { programCode: "HAM" });
    expect(result.accessMode).toBe("global");
    expect(Object.keys(result).some((key) => /email|phone|name/i.test(key))).toBe(false);
  });

  it("rejects a manually edited cross-program query parameter", () => {
    expect(errorCode(() => resolveCanonicalContext(uehAdmin, catalog, { programCode: "HAM" }))).toBe("not_found");
  });

  it("rejects an invalid program/season pair", () => {
    expect(
      errorCode(() => resolveCanonicalContext(superAdmin, catalog, { programCode: "UEHM", seasonCode: "HAM-S6" }))
    ).toBe("invalid_scope");
  });

  it("rejects an intake batch from another season", () => {
    expect(
      errorCode(() =>
        resolveCanonicalContext(superAdmin, catalog, {
          programCode: "UEHM",
          seasonCode: "UEHM-S12",
          intakeBatchId: "batch-ham"
        })
      )
    ).toBe("invalid_scope");
  });

  it("does not accept a batch without a validated season", () => {
    expect(
      errorCode(() => resolveCanonicalContext(superAdmin, catalog, { programCode: "UEHM", intakeBatchId: "batch-ueh" }))
    ).toBe("invalid_scope");
  });

  it("a season-only UEH reviewer cannot open HAM", () => {
    expect(errorCode(() => resolveCanonicalContext(uehSeasonReviewer, catalog, { programCode: "HAM" }))).toBe("not_found");
  });
});

describe("dependent selector reset", () => {
  it("retains a season and batch that belong to the selected program", () => {
    expect(resetDependentContext(catalog, "UEHM", "UEHM-S12", "batch-ueh")).toEqual({
      seasonCode: "UEHM-S12",
      intakeBatchId: "batch-ueh"
    });
  });

  it("resets stale season and batch when switching programs", () => {
    expect(resetDependentContext(catalog, "HAM", "UEHM-S12", "batch-ueh")).toEqual({
      seasonCode: null,
      intakeBatchId: null
    });
  });

  it("resets only a stale batch when season remains valid", () => {
    expect(resetDependentContext(catalog, "UEHM", "UEHM-S12", "batch-ham")).toEqual({
      seasonCode: "UEHM-S12",
      intakeBatchId: null
    });
  });
});

describe("entity isolation after service-role reads", () => {
  const domains = ["application", "mentor", "mentee", "match", "event", "recap", "report"];

  it.each(domains)("UEH Admin cannot receive a HAM %s by direct ID", () => {
    expect(errorCode(() => assertEntityBelongsToSeason("season-ham-6", catalog.seasons[0]))).toBe("not_found");
  });

  it.each(domains)("HAM Admin cannot receive a UEH %s by direct ID", () => {
    expect(errorCode(() => assertEntityBelongsToSeason("season-ueh-12", catalog.seasons[1]))).toBe("not_found");
  });

  it("validates a direct program-owned entity after a service-role query", () => {
    expect(() => assertEntityBelongsToProgram("program-ueh", catalog.programs[0])).not.toThrow();
    expect(errorCode(() => assertEntityBelongsToProgram("program-ham", catalog.programs[0]))).toBe("not_found");
  });

  it("validates batch/season consistency independently of UI filtering", () => {
    expect(() => assertIntakeBatchBelongsToSeason(catalog.intakeBatches[0], catalog.seasons[0])).not.toThrow();
    expect(errorCode(() => assertIntakeBatchBelongsToSeason(catalog.intakeBatches[1], catalog.seasons[0]))).toBe(
      "invalid_scope"
    );
  });

  it("a shared global person exposes only memberships in the resolved context", () => {
    const memberships = [
      { personId: "shared-person", programId: "program-ueh", seasonId: "season-ueh-12" },
      { personId: "shared-person", programId: "program-ham", seasonId: "season-ham-6" }
    ];
    const context = resolveCanonicalContext(uehAdmin, catalog, { programCode: "UEHM", seasonCode: "UEHM-S12" });
    const visible = memberships.filter(
      (row) => row.programId === context.selectedProgramId && row.seasonId === context.selectedSeasonId
    );
    expect(visible).toEqual([memberships[0]]);
  });
});
