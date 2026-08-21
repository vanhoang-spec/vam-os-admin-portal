import "server-only";

import { cookies } from "next/headers";
import { SEASON_CONFIG } from "@/lib/season-config";
import { loadProgramContextCatalog, toProgramAccessPrincipal } from "@/lib/program-context";
import {
  resolveAccessibleSeasons,
  type ProgramContextCatalog,
  type SeasonCatalogRow
} from "@/lib/program-context-core";
import { getAdminScopeContext, getScopeFilter, type ScopeFilter } from "@/lib/program-scope";

export const SEASON_COOKIE_NAME = "vam_season";
export const SEASON_CONTEXT_ERROR_MESSAGE =
  "Không thể xác minh mùa vận hành được yêu cầu. Vui lòng chọn một mùa bạn được cấp quyền truy cập.";

export class SeasonContextError extends Error {
  readonly code = "invalid_season_context";

  constructor() {
    super(SEASON_CONTEXT_ERROR_MESSAGE);
    this.name = "SeasonContextError";
  }
}

export class SeasonAccessDeniedError extends Error {
  readonly code = "season_access_denied";

  constructor() {
    super("No authorized seasons are available in the current program.");
    this.name = "SeasonAccessDeniedError";
  }
}

type ExplicitSeasonValue = string | string[] | null | undefined;

function normalizeSeasonCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (!code || code.length > 64 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(code)) return null;
  return code;
}

function findSeason(seasons: SeasonCatalogRow[], value: unknown) {
  const code = normalizeSeasonCode(value);
  return code ? seasons.find((season) => season.code.trim().toUpperCase() === code) ?? null : null;
}

export function sortSeasonOptions(seasons: SeasonCatalogRow[]) {
  return [...seasons].sort((a, b) => {
    const aNumber = Number(a.code.match(/-S(\d+)$/i)?.[1] ?? -1);
    const bNumber = Number(b.code.match(/-S(\d+)$/i)?.[1] ?? -1);
    return bNumber - aNumber || a.code.localeCompare(b.code);
  });
}

export function resolveCurrentProgramSeasonOptions(input: {
  catalog: ProgramContextCatalog;
  accessibleSeasons: SeasonCatalogRow[];
  operatingSeasonCode: string;
}) {
  const operatingCode = normalizeSeasonCode(input.operatingSeasonCode);
  const operatingSeason = operatingCode
    ? input.catalog.seasons.find((season) => season.code.trim().toUpperCase() === operatingCode)
    : null;
  const currentProgram = operatingSeason
    ? input.catalog.programs.find((program) => program.id === operatingSeason.programId && program.isActive)
    : null;
  if (!operatingSeason || !currentProgram) throw new SeasonContextError();
  return {
    currentProgramId: currentProgram.id,
    seasons: sortSeasonOptions(
      input.accessibleSeasons.filter((season) => season.programId === currentProgram.id)
    )
  };
}

export function resolveSeasonSelection(input: {
  explicitSeason?: ExplicitSeasonValue;
  cookieSeason?: string | null;
  defaultSeasonCode: string;
  authorizedCurrentProgramSeasons: SeasonCatalogRow[];
}) {
  const explicitWasSupplied = input.explicitSeason !== undefined && input.explicitSeason !== null;
  if (explicitWasSupplied) {
    if (typeof input.explicitSeason !== "string") throw new SeasonContextError();
    const selected = findSeason(input.authorizedCurrentProgramSeasons, input.explicitSeason);
    if (!selected) throw new SeasonContextError();
    return selected;
  }

  if (input.authorizedCurrentProgramSeasons.length === 0) {
    throw new SeasonAccessDeniedError();
  }

  const cookieSelection = findSeason(input.authorizedCurrentProgramSeasons, input.cookieSeason);
  if (cookieSelection) return cookieSelection;

  const fallback = findSeason(input.authorizedCurrentProgramSeasons, input.defaultSeasonCode);
  if (!fallback) throw new SeasonContextError();
  return fallback;
}

export function composeSeasonScope(baseScope: ScopeFilter | undefined, selectedSeasonId: string): ScopeFilter {
  return {
    ...(baseScope?.allowedProgramIds ? { allowedProgramIds: [...baseScope.allowedProgramIds] } : {}),
    allowedSeasonIds: [selectedSeasonId]
  };
}

export type ResolvedSeasonContext = {
  currentProgramId: string;
  selectedSeasonId: string;
  selectedSeasonCode: string;
  availableSeasons: SeasonCatalogRow[];
  effectiveScope: ScopeFilter;
};

export async function resolveSeasonContext(
  explicitSeason?: ExplicitSeasonValue
): Promise<ResolvedSeasonContext> {
  const [adminContext, catalog, cookieStore] = await Promise.all([
    getAdminScopeContext(),
    loadProgramContextCatalog(),
    cookies()
  ]);

  if (adminContext.scopeError) throw new SeasonContextError();

  // The program anchor is derived only from the explicit operating-season
  // constant. The requested/cookie season is never allowed to choose a program.
  const principal = toProgramAccessPrincipal(adminContext);
  const currentProgram = resolveCurrentProgramSeasonOptions({
    catalog,
    accessibleSeasons: resolveAccessibleSeasons(principal, catalog),
    operatingSeasonCode: SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE
  });
  const availableSeasons = currentProgram.seasons;
  const selectedSeason = resolveSeasonSelection({
    explicitSeason,
    cookieSeason: cookieStore.get(SEASON_COOKIE_NAME)?.value ?? null,
    defaultSeasonCode: SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE,
    authorizedCurrentProgramSeasons: availableSeasons
  });
  const baseScope = await getScopeFilter(adminContext);

  return {
    currentProgramId: currentProgram.currentProgramId,
    selectedSeasonId: selectedSeason.id,
    selectedSeasonCode: selectedSeason.code,
    availableSeasons,
    effectiveScope: composeSeasonScope(baseScope, selectedSeason.id)
  };
}
