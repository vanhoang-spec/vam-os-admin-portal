import "server-only";

import { getAdminScopeContext } from "@/lib/program-scope";
import { loadProgramContextCatalog, toProgramAccessPrincipal } from "@/lib/program-context";
import { requireGlobalAdmin, type CanonicalProgramContext, type ProgramContextCatalog } from "@/lib/program-context-core";
import { reconcilePortfolioRows, total, type CountValue, type PortfolioSeasonScope } from "@/lib/portfolio-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export type { ProgramPortfolioRow } from "@/lib/portfolio-core";
export type PortfolioData = {
  totals: {
    programs: number; activePrograms: number; activeSeasons: number;
    openApplications: CountValue; activeMentors: CountValue; activeMentees: CountValue;
    activeMatches: CountValue; upcomingEvents: CountValue; dataIssues: CountValue; overdueTasks: CountValue;
  };
  programs: import("@/lib/portfolio-core").ProgramPortfolioRow[];
  warnings: string[];
};

async function loadAggregateRows(catalog: ProgramContextCatalog, programId?: string, scope: PortfolioSeasonScope = { mode: "current" }): Promise<PortfolioData> {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("Không thể tải dữ liệu portfolio lúc này.");
  const programSeasonIds = catalog.seasons.filter((season) => !programId || season.programId === programId).map((season) => season.id);
  const seasonIds = scope.mode === "selected" ? programSeasonIds.filter((id) => id === scope.seasonId) : programSeasonIds;
  const filterSeason = (query: any) => programId ? query.in("season_id", seasonIds.length ? seasonIds : ["00000000-0000-0000-0000-000000000000"]) : query;
  const [applicationsRes, membershipsRes, matchesRes, eventsRes, actionsRes] = await Promise.all([
    filterSeason(client.from("applications").select("season_id,status,final_status")),
    programId
      ? client.from("person_season_memberships").select("person_id,program_id,season_id,role,status").eq("program_id", programId)
      : client.from("person_season_memberships").select("person_id,program_id,season_id,role,status"),
    filterSeason(client.from("matches").select("season_id,status,mentor_person_id,mentee_person_id")),
    filterSeason(client.from("events").select("season_id,status,starts_at")),
    filterSeason(client.from("action_items").select("season_id,status,action_type,due_date"))
  ]);
  const warnings: string[] = [...(catalog.warnings ?? [])];
  function rowsOrNull(result: any, label: string) {
    if (result.error) {
      console.error(`[portfolio] ${label} aggregate failed`, { code: result.error.code, message: result.error.message });
      warnings.push(label);
      return null;
    }
    return (result.data ?? []) as any[];
  }
  const programs = reconcilePortfolioRows(catalog, {
    applications: rowsOrNull(applicationsRes, "Ứng tuyển"),
    memberships: rowsOrNull(membershipsRes, "Thành viên theo mùa"),
    matches: rowsOrNull(matchesRes, "Ghép cặp"),
    events: rowsOrNull(eventsRes, "Sự kiện"),
    actions: rowsOrNull(actionsRes, "Vấn đề dữ liệu và nhiệm vụ")
  }, programId, new Date(), scope);
  return {
    totals: {
      programs: programs.length,
      activePrograms: programs.filter((program) => program.isActive).length,
      activeSeasons: catalog.seasons.filter((season) => !programId || season.programId === programId).length,
      openApplications: total(programs, "applications"),
      activeMentors: total(programs, "mentors"),
      activeMentees: total(programs, "mentees"),
      activeMatches: total(programs, "activeMatches"),
      upcomingEvents: total(programs, "upcomingEvents"),
      dataIssues: total(programs, "dataIssues"),
      overdueTasks: total(programs, "overdueTasks")
    },
    programs,
    warnings
  };
}
export async function getSuperAdminPortfolio(): Promise<PortfolioData> {
  const [adminContext, catalog] = await Promise.all([getAdminScopeContext(), loadProgramContextCatalog()]);
  requireGlobalAdmin(toProgramAccessPrincipal(adminContext));
  return loadAggregateRows(catalog);
}
export async function getProgramWorkspaceSummary(context: CanonicalProgramContext): Promise<PortfolioData> {
  const scope: PortfolioSeasonScope = context.selectedSeasonId
    ? { mode: "selected", seasonId: context.selectedSeasonId }
    : { mode: "all" };
  return loadAggregateRows(await loadProgramContextCatalog(), context.selectedProgramId, scope);
}
