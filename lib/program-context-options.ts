import "server-only";

import { getAdminScopeContext } from "@/lib/program-scope";
import { loadProgramContextCatalog, toProgramAccessPrincipal } from "@/lib/program-context";
import { resolveAccessiblePrograms, resolveAccessibleSeasons } from "@/lib/program-context-core";

export async function resolveAuthorizedContextOptions() {
  const [adminContext, catalog] = await Promise.all([getAdminScopeContext(), loadProgramContextCatalog()]);
  const principal = toProgramAccessPrincipal(adminContext);
  const programs = resolveAccessiblePrograms(principal, catalog);
  // Seasons are resolved from the grants themselves, not from program
  // accessibility. A season-scoped holder reaches the program but must only be
  // offered the season(s) they hold.
  const seasons = resolveAccessibleSeasons(principal, catalog);
  const seasonIds = new Set(seasons.map((season) => season.id));
  const intakeBatches = catalog.intakeBatches.filter((batch) => seasonIds.has(batch.seasonId) && batch.isActive);
  return { programs, seasons, intakeBatches, canViewPortfolio: principal.isSuperAdmin };
}
