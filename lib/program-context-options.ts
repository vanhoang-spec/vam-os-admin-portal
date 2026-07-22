import "server-only";

import { getAdminScopeContext } from "@/lib/program-scope";
import { loadProgramContextCatalog, toProgramAccessPrincipal } from "@/lib/program-context";
import { resolveAccessiblePrograms } from "@/lib/program-context-core";

export async function resolveAuthorizedContextOptions() {
  const [adminContext, catalog] = await Promise.all([getAdminScopeContext(), loadProgramContextCatalog()]);
  const principal = toProgramAccessPrincipal(adminContext);
  const programs = resolveAccessiblePrograms(principal, catalog);
  const programIds = new Set(programs.map((program) => program.id));
  const seasons = catalog.seasons.filter((season) => programIds.has(season.programId));
  const seasonIds = new Set(seasons.map((season) => season.id));
  const intakeBatches = catalog.intakeBatches.filter((batch) => seasonIds.has(batch.seasonId) && batch.isActive);
  return { programs, seasons, intakeBatches, canViewPortfolio: principal.isSuperAdmin };
}
