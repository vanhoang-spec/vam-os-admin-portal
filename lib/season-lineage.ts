import type { Program, Season, JsonRecord } from "@/lib/types";

export const SOURCE_SEASON_CODE = "UEHM-S11";
export const TARGET_SEASON_CODE = "UEHM-S12";
export const TARGET_PROGRAM_CODE = "UEHM";

export function normalizeCode(code: string | null | undefined): string {
  return String(code ?? "").trim();
}

export function normalizeRoleOrStatus(val: string | null | undefined): string {
  return String(val ?? "").trim().toLowerCase();
}

export function isEligibleSourceMembership(
  membership: { seasonId?: string; role: string; status: string } & Record<string, any>,
  sourceSeasonId: string
): boolean {
  if (membership.seasonId !== sourceSeasonId) return false;

  const role = normalizeRoleOrStatus(membership.role);
  if (role !== "mentor" && role !== "mentee") return false;

  const status = normalizeRoleOrStatus(membership.status);
  if (status !== "active" && status !== "completed") return false;

  return true;
}

export function isSuppressedForRole(
  memberships: Array<{ seasonId?: string; role: string } & Record<string, any>>,
  targetSeasonId: string,
  sourceRole: string
): boolean {
  const normalizedSourceRole = normalizeRoleOrStatus(sourceRole);
  return memberships.some((m) => {
    return (
      m.seasonId === targetSeasonId &&
      normalizeRoleOrStatus(m.role) === normalizedSourceRole
    );
  });
}

type ResolverResult =
  | {
      ok: true;
      sourceSeasonId: string;
      targetSeasonId: string;
      targetProgramId: string;
    }
  | {
      ok: false;
      reason:
        | "missing_program"
        | "ambiguous_program"
        | "missing_source"
        | "ambiguous_source"
        | "missing_target"
        | "ambiguous_target"
        | "target_ownership_mismatch"
        | "degenerate_edge"
        | "program_inactive";
    };

export function resolveContinuationLineage(
  programs: Array<{ id: string; code?: string; is_active?: boolean } & Record<string, any>>,
  seasons: Array<{ id: string; code?: string | null; program_id?: string | null; programId?: string } & Record<string, any>>
): ResolverResult {
  const targetPrograms = programs.filter(
    (p) => normalizeCode(p.code) === TARGET_PROGRAM_CODE
  );

  if (targetPrograms.length === 0) return { ok: false, reason: "missing_program" };
  if (targetPrograms.length > 1) return { ok: false, reason: "ambiguous_program" };

  const targetProgram = targetPrograms[0];
  if (targetProgram.is_active === false || targetProgram.isActive === false) {
    return { ok: false, reason: "program_inactive" };
  }

  const sourceSeasons = seasons.filter(
    (s) => normalizeCode(s.code) === SOURCE_SEASON_CODE
  );

  if (sourceSeasons.length === 0) return { ok: false, reason: "missing_source" };
  if (sourceSeasons.length > 1) return { ok: false, reason: "ambiguous_source" };

  const targetSeasons = seasons.filter(
    (s) => normalizeCode(s.code) === TARGET_SEASON_CODE
  );

  if (targetSeasons.length === 0) return { ok: false, reason: "missing_target" };
  if (targetSeasons.length > 1) return { ok: false, reason: "ambiguous_target" };

  const sourceSeason = sourceSeasons[0];
  const targetSeason = targetSeasons[0];

  const targetSeasonProgramId = targetSeason.programId ?? targetSeason.program_id;
  if (targetSeasonProgramId !== targetProgram.id) {
    return { ok: false, reason: "target_ownership_mismatch" };
  }

  if (sourceSeason.id === targetSeason.id) {
    return { ok: false, reason: "degenerate_edge" };
  }

  return {
    ok: true,
    sourceSeasonId: sourceSeason.id,
    targetSeasonId: targetSeason.id,
    targetProgramId: targetProgram.id,
  };
}
