export type ProgramContextErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_scope";

export class ProgramContextError extends Error {
  readonly code: ProgramContextErrorCode;
  readonly status: 401 | 403 | 404 | 422;

  constructor(code: ProgramContextErrorCode, message?: string) {
    const defaults: Record<ProgramContextErrorCode, string> = {
      unauthenticated: "Bạn cần đăng nhập để tiếp tục.",
      forbidden: "Bạn không có quyền truy cập phạm vi này.",
      not_found: "Không tìm thấy phạm vi được yêu cầu.",
      invalid_scope: "Chương trình, mùa hoặc đợt tuyển không hợp lệ."
    };
    super(message ?? defaults[code]);
    this.name = "ProgramContextError";
    this.code = code;
    this.status = code === "unauthenticated" ? 401 : code === "forbidden" ? 403 : code === "not_found" ? 404 : 422;
  }
}

export type ProgramCatalogRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type SeasonCatalogRow = {
  id: string;
  code: string;
  name: string;
  programId: string;
};

export type IntakeBatchCatalogRow = {
  id: string;
  code: string;
  name: string;
  seasonId: string;
  isActive: boolean;
};

export type ScopeGrant = {
  programId: string | null;
  seasonId: string | null;
  scopeLevel: "full_access" | "operations" | "review" | "read";
};

export type ProgramAccessPrincipal = {
  authenticated: boolean;
  isSuperAdmin: boolean;
  grants: ScopeGrant[];
};

export type ProgramContextCatalog = {
  programs: ProgramCatalogRow[];
  seasons: SeasonCatalogRow[];
  intakeBatches: IntakeBatchCatalogRow[];
  warnings?: string[];
};

export type ContextRequest = {
  programCode?: string | null;
  seasonCode?: string | null;
  intakeBatchId?: string | null;
};

export type CanonicalProgramContext = {
  selectedProgramId: string;
  selectedProgramCode: string;
  selectedSeasonId: string | null;
  selectedSeasonCode: string | null;
  selectedIntakeBatchId: string | null;
  accessMode: "global" | "program_scoped";
};

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeCode(value: unknown) {
  return clean(value)?.toUpperCase() ?? null;
}

function requireAuthenticated(principal: ProgramAccessPrincipal) {
  if (!principal.authenticated) throw new ProgramContextError("unauthenticated");
}

export function requireGlobalAdmin(principal: ProgramAccessPrincipal) {
  requireAuthenticated(principal);
  if (!principal.isSuperAdmin) throw new ProgramContextError("forbidden");
}

function programForGrant(grant: ScopeGrant, catalog: ProgramContextCatalog) {
  if (grant.programId) {
    const value = clean(grant.programId);
    const byProgram = catalog.programs.find((program) => program.id === value || normalizeCode(program.code) === normalizeCode(value));
    if (byProgram) return byProgram;
  }
  if (grant.seasonId) {
    const value = clean(grant.seasonId);
    const season = catalog.seasons.find((row) => row.id === value || normalizeCode(row.code) === normalizeCode(value));
    if (season) return catalog.programs.find((program) => program.id === season.programId) ?? null;
  }
  return null;
}

export function resolveAccessiblePrograms(principal: ProgramAccessPrincipal, catalog: ProgramContextCatalog) {
  requireAuthenticated(principal);
  if (principal.isSuperAdmin) return catalog.programs.filter((program) => program.isActive);
  const ids = new Set(principal.grants.map((grant) => programForGrant(grant, catalog)?.id).filter((id): id is string => Boolean(id)));
  return catalog.programs.filter((program) => program.isActive && ids.has(program.id));
}

/**
 * A grant with no season names the whole program: every season inside it,
 * present and future. A grant that names a season authorizes that season only.
 * These two predicates are the single definition of that split — both
 * `requireSeasonAccess` (the enforcement path) and `resolveAccessibleSeasons`
 * (the option-listing path) read from them so the two can never drift into
 * offering a season that enforcement then refuses, or the reverse.
 */
function hasProgramWideGrant(principal: ProgramAccessPrincipal, programId: string, catalog: ProgramContextCatalog) {
  return principal.grants.some((grant) => {
    if (grant.seasonId) return false;
    return programForGrant(grant, catalog)?.id === programId;
  });
}

function hasDirectSeasonGrant(principal: ProgramAccessPrincipal, season: SeasonCatalogRow) {
  return principal.grants.some((grant) => {
    const value = clean(grant.seasonId);
    if (!value) return false;
    return value === season.id || normalizeCode(value) === normalizeCode(season.code);
  });
}

/**
 * The seasons a principal may actually operate in.
 *
 * Program accessibility is NOT sufficient: a reviewer granted only UEHM-S12
 * can reach the UEHM program but must never be offered UEHM-S11. Listing a
 * season the holder cannot read would either leak the existence of another
 * season's scope or hand them a selector entry that renders empty — and a
 * selector must narrow an existing authority, never imply a new one.
 */
export function resolveAccessibleSeasons(principal: ProgramAccessPrincipal, catalog: ProgramContextCatalog) {
  requireAuthenticated(principal);
  const programIds = new Set(resolveAccessiblePrograms(principal, catalog).map((program) => program.id));
  const seasons = catalog.seasons.filter((season) => programIds.has(season.programId));
  if (principal.isSuperAdmin) return seasons;
  return seasons.filter(
    (season) => hasProgramWideGrant(principal, season.programId, catalog) || hasDirectSeasonGrant(principal, season)
  );
}

export function requireProgramAccess(principal: ProgramAccessPrincipal, program: ProgramCatalogRow, catalog: ProgramContextCatalog) {
  requireAuthenticated(principal);
  if (principal.isSuperAdmin) return;
  if (!resolveAccessiblePrograms(principal, catalog).some((row) => row.id === program.id)) {
    // Deliberately use the same response for missing/inaccessible cross-program entities.
    throw new ProgramContextError("not_found");
  }
}

export function requireSeasonAccess(
  principal: ProgramAccessPrincipal,
  season: SeasonCatalogRow,
  program: ProgramCatalogRow,
  catalog: ProgramContextCatalog
) {
  requireProgramAccess(principal, program, catalog);
  assertSeasonBelongsToProgram(season, program);
  if (principal.isSuperAdmin) return;
  if (!hasProgramWideGrant(principal, program.id, catalog) && !hasDirectSeasonGrant(principal, season)) {
    throw new ProgramContextError("not_found");
  }
}

export function assertSeasonBelongsToProgram(season: SeasonCatalogRow, program: ProgramCatalogRow) {
  if (season.programId !== program.id) throw new ProgramContextError("invalid_scope");
}

export function assertIntakeBatchBelongsToSeason(batch: IntakeBatchCatalogRow, season: SeasonCatalogRow) {
  if (batch.seasonId !== season.id) throw new ProgramContextError("invalid_scope");
}

export function assertEntityBelongsToSeason(entitySeasonId: string | null | undefined, season: SeasonCatalogRow) {
  if (!entitySeasonId || entitySeasonId !== season.id) throw new ProgramContextError("not_found");
}

export function assertEntityBelongsToProgram(entityProgramId: string | null | undefined, program: ProgramCatalogRow) {
  if (!entityProgramId || entityProgramId !== program.id) throw new ProgramContextError("not_found");
}

export function resolveCanonicalContext(
  principal: ProgramAccessPrincipal,
  catalog: ProgramContextCatalog,
  request: ContextRequest
): CanonicalProgramContext {
  requireAuthenticated(principal);
  const requestedProgramCode = normalizeCode(request.programCode);
  if (!requestedProgramCode) throw new ProgramContextError("invalid_scope");

  const program = catalog.programs.find((row) => normalizeCode(row.code) === requestedProgramCode);
  if (!program || !program.isActive) throw new ProgramContextError("not_found");
  requireProgramAccess(principal, program, catalog);

  const requestedSeasonCode = normalizeCode(request.seasonCode);
  const season = requestedSeasonCode
    ? catalog.seasons.find((row) => normalizeCode(row.code) === requestedSeasonCode)
    : null;
  if (requestedSeasonCode && !season) throw new ProgramContextError("not_found");
  if (season) requireSeasonAccess(principal, season, program, catalog);

  const requestedBatchId = clean(request.intakeBatchId);
  const batch = requestedBatchId ? catalog.intakeBatches.find((row) => row.id === requestedBatchId) : null;
  if (requestedBatchId && !batch) throw new ProgramContextError("not_found");
  if (batch && !season) throw new ProgramContextError("invalid_scope");
  if (batch && season) assertIntakeBatchBelongsToSeason(batch, season);

  return {
    selectedProgramId: program.id,
    selectedProgramCode: program.code,
    selectedSeasonId: season?.id ?? null,
    selectedSeasonCode: season?.code ?? null,
    selectedIntakeBatchId: batch?.id ?? null,
    accessMode: principal.isSuperAdmin ? "global" : "program_scoped"
  };
}

export function resetDependentContext(
  catalog: ProgramContextCatalog,
  nextProgramCode: string,
  currentSeasonCode?: string | null,
  currentIntakeBatchId?: string | null
) {
  const program = catalog.programs.find((row) => normalizeCode(row.code) === normalizeCode(nextProgramCode));
  if (!program) return { seasonCode: null, intakeBatchId: null };
  const season = catalog.seasons.find(
    (row) => row.programId === program.id && normalizeCode(row.code) === normalizeCode(currentSeasonCode)
  );
  if (!season) return { seasonCode: null, intakeBatchId: null };
  const batch = catalog.intakeBatches.find((row) => row.id === clean(currentIntakeBatchId) && row.seasonId === season.id);
  return { seasonCode: season.code, intakeBatchId: batch?.id ?? null };
}
