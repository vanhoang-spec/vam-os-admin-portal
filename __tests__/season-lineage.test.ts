import { describe, expect, it } from "vitest";
import { resolveContinuationLineage } from "@/lib/season-lineage";

const STAGING_UEHM_PROGRAM = "9722d13c-c82a-46e9-b6bd-0a70e16a37c7";
const STAGING_VAM_PROGRAM = "08b28067-d9c7-4fe9-9fe8-47054f0ac577";
const STAGING_S11 = "e4c34a77-df5c-4b6e-8730-3f53c8361553";
const STAGING_S12 = "7fca95f5-2205-4060-8a9a-7d604e4268f7";

const PROD_UEHM_PROGRAM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
const PROD_S11 = "710f4ec9-1cf7-461e-98d4-f33799047add";
const PROD_S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";

const FIXTURES = [
  {
    name: "Staging Shape",
    uehmProgramId: STAGING_UEHM_PROGRAM,
    s11SeasonId: STAGING_S11,
    s11ProgramId: STAGING_VAM_PROGRAM,
    s12SeasonId: STAGING_S12,
  },
  {
    name: "Production Shape",
    uehmProgramId: PROD_UEHM_PROGRAM,
    s11SeasonId: PROD_S11,
    s11ProgramId: PROD_UEHM_PROGRAM,
    s12SeasonId: PROD_S12,
  },
];

describe("Season Lineage Resolver", () => {
  describe.each(FIXTURES)("$name", ({ uehmProgramId, s11SeasonId, s11ProgramId, s12SeasonId }) => {
    const validPrograms = [{ id: uehmProgramId, code: "UEHM" }];
    const validSeasons = [
      { id: s11SeasonId, code: "UEHM-S11", programId: s11ProgramId },
      { id: s12SeasonId, code: "UEHM-S12", programId: uehmProgramId },
    ];

    it("resolves successfully with correct shape", () => {
      const result = resolveContinuationLineage(validPrograms, validSeasons);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sourceSeasonId).toBe(s11SeasonId);
        expect(result.targetSeasonId).toBe(s12SeasonId);
        expect(result.targetProgramId).toBe(uehmProgramId);
      }
    });

    it("fails with missing_program", () => {
      expect(resolveContinuationLineage([], validSeasons)).toEqual({
        ok: false,
        reason: "missing_program",
      });
    });

    it("fails with ambiguous_program", () => {
      const programs = [
        ...validPrograms,
        { id: "duplicate-program", code: "UEHM" },
      ];
      expect(resolveContinuationLineage(programs, validSeasons)).toEqual({
        ok: false,
        reason: "ambiguous_program",
      });
    });

    it("fails with program_inactive", () => {
      const programs = [{ id: uehmProgramId, code: "UEHM", is_active: false }];
      expect(resolveContinuationLineage(programs, validSeasons)).toEqual({
        ok: false,
        reason: "program_inactive",
      });
    });

    it("fails with missing_source", () => {
      const seasons = [validSeasons[1]]; // Only S12
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "missing_source",
      });
    });

    it("fails with ambiguous_source", () => {
      const seasons = [
        ...validSeasons,
        { id: "duplicate-s11", code: "UEHM-S11", programId: s11ProgramId },
      ];
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "ambiguous_source",
      });
    });

    it("fails with missing_target", () => {
      const seasons = [validSeasons[0]]; // Only S11
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "missing_target",
      });
    });

    it("fails with ambiguous_target", () => {
      const seasons = [
        ...validSeasons,
        { id: "duplicate-s12", code: "UEHM-S12", programId: uehmProgramId },
      ];
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "ambiguous_target",
      });
    });

    it("fails with target_ownership_mismatch", () => {
      const seasons = [
        validSeasons[0],
        { id: s12SeasonId, code: "UEHM-S12", programId: "wrong-program" },
      ];
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "target_ownership_mismatch",
      });
    });

    it("fails with degenerate_edge", () => {
      // both codes on the same ID
      const seasons = [
        { id: s11SeasonId, code: "UEHM-S11", programId: s11ProgramId },
        { id: s11SeasonId, code: "UEHM-S12", programId: uehmProgramId },
      ];
      expect(resolveContinuationLineage(validPrograms, seasons)).toEqual({
        ok: false,
        reason: "degenerate_edge",
      });
    });

    it("handles null season codes", () => {
      const seasons = [
        ...validSeasons,
        { id: "null-code", code: null, programId: uehmProgramId },
      ];
      const result = resolveContinuationLineage(validPrograms, seasons);
      expect(result.ok).toBe(true);
    });
  });
});
