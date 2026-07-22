import "server-only";

import { getAdminScopeContext } from "@/lib/program-scope";
import { loadProgramContextCatalog, toProgramAccessPrincipal } from "@/lib/program-context";
import { requireGlobalAdmin, type CanonicalProgramContext, type ProgramContextCatalog } from "@/lib/program-context-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type CountValue = number | null;

export type ProgramPortfolioRow = {
  programId: string;
  programCode: string;
  programName: string;
  isActive: boolean;
  currentSeasonCode: string | null;
  applications: CountValue;
  mentors: CountValue;
  mentees: CountValue;
  activeMatches: CountValue;
  upcomingEvents: CountValue;
  dataIssues: CountValue;
  overdueTasks: CountValue;
  health: "normal" | "attention" | "data_issue" | "unknown";
};

export type PortfolioData = {
  totals: {
    programs: number;
    activePrograms: number;
    activeSeasons: number;
    openApplications: CountValue;
    activeMentors: CountValue;
    activeMentees: CountValue;
    activeMatches: CountValue;
    upcomingEvents: CountValue;
    dataIssues: CountValue;
    overdueTasks: CountValue;
  };
  programs: ProgramPortfolioRow[];
  warnings: string[];
};

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isActiveSeason(value: unknown) {
  return ["active", "open", "ongoing", "current"].includes(lower(value));
}

function isOpenApplication(value: unknown) {
  return !["approved", "rejected", "withdrawn", "cancelled", "declined", "profile_created"].includes(lower(value));
}

function countByProgram(rows: any[] | null, programBySeason: Map<string, string>, predicate: (row: any) => boolean = () => true) {
  if (!rows) return null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const programId = row.program_id ? String(row.program_id) : programBySeason.get(String(row.season_id ?? ""));
    if (!programId) continue;
    counts.set(programId, (counts.get(programId) ?? 0) + 1);
  }
  return counts;
}

function sum(map: Map<string, number> | null) {
  return map ? Array.from(map.values()).reduce((total, value) => total + value, 0) : null;
}

function value(map: Map<string, number> | null, programId: string): CountValue {
  return map ? map.get(programId) ?? 0 : null;
}

function health(dataIssues: CountValue, overdueTasks: CountValue): ProgramPortfolioRow["health"] {
  if (dataIssues === null || overdueTasks === null) return "unknown";
  if (dataIssues > 0) return "data_issue";
  if (overdueTasks > 0) return "attention";
  return "normal";
}

async function loadAggregateRows(catalog: ProgramContextCatalog, programId?: string): Promise<PortfolioData> {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("Không thể tải dữ liệu portfolio lúc này.");

  const seasonIds = catalog.seasons.filter((season) => !programId || season.programId === programId).map((season) => season.id);
  const filterSeason = (query: any) => (programId ? query.in("season_id", seasonIds.length ? seasonIds : ["00000000-0000-0000-0000-000000000000"]) : query);

  const [applicationsRes, membershipsRes, matchesRes, eventsRes, actionsRes] = await Promise.all([
    filterSeason(client.from("applications").select("season_id,status,final_status")),
    programId
      ? client.from("person_season_memberships").select("program_id,season_id,role,status").eq("program_id", programId)
      : client.from("person_season_memberships").select("program_id,season_id,role,status"),
    filterSeason(client.from("matches").select("season_id,status")),
    filterSeason(client.from("events").select("season_id,status,starts_at")),
    filterSeason(client.from("action_items").select("season_id,status,action_type,due_date"))
  ]);

  const warnings: string[] = [];
  function rowsOrNull(result: any, label: string) {
    if (result.error) {
      console.error(`[portfolio] ${label} aggregate failed`, { code: result.error.code, message: result.error.message });
      warnings.push(label);
      return null;
    }
    return (result.data ?? []) as any[];
  }

  const applicationsRows = rowsOrNull(applicationsRes, "Ứng tuyển");
  const membershipRows = rowsOrNull(membershipsRes, "Thành viên theo mùa");
  const matchRows = rowsOrNull(matchesRes, "Ghép cặp");
  const eventRows = rowsOrNull(eventsRes, "Sự kiện");
  const actionRows = rowsOrNull(actionsRes, "Vấn đề dữ liệu và nhiệm vụ");
  const programBySeason = new Map(catalog.seasons.map((season) => [season.id, season.programId]));
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const applications = countByProgram(applicationsRows, programBySeason, (row) => isOpenApplication(row.status ?? row.final_status));
  const mentors = countByProgram(membershipRows, programBySeason, (row) => lower(row.role) === "mentor" && lower(row.status) === "active");
  const mentees = countByProgram(membershipRows, programBySeason, (row) => lower(row.role) === "mentee" && lower(row.status) === "active");
  const matches = countByProgram(matchRows, programBySeason, (row) => lower(row.status) === "active");
  const events = countByProgram(eventRows, programBySeason, (row) => {
    const startsAt = String(row.starts_at ?? "");
    return Boolean(startsAt) && new Date(startsAt) >= now && !["cancelled", "completed"].includes(lower(row.status));
  });
  const issues = countByProgram(actionRows, programBySeason, (row) =>
    lower(row.action_type) === "data_issue" && ["open", "in_progress", "parked"].includes(lower(row.status))
  );
  const overdue = countByProgram(actionRows, programBySeason, (row) =>
    ["open", "in_progress", "parked"].includes(lower(row.status)) && String(row.due_date ?? "") < today
  );

  const programs = catalog.programs
    .filter((program) => !programId || program.id === programId)
    .map((program) => {
      const seasons = catalog.seasons.filter((season) => season.programId === program.id);
      const currentSeason = seasons.find((season) => isActiveSeason(season.status)) ?? seasons.at(-1) ?? null;
      const dataIssues = value(issues, program.id);
      const overdueTasks = value(overdue, program.id);
      return {
        programId: program.id,
        programCode: program.code,
        programName: program.name,
        isActive: program.isActive,
        currentSeasonCode: currentSeason?.code ?? null,
        applications: value(applications, program.id),
        mentors: value(mentors, program.id),
        mentees: value(mentees, program.id),
        activeMatches: value(matches, program.id),
        upcomingEvents: value(events, program.id),
        dataIssues,
        overdueTasks,
        health: health(dataIssues, overdueTasks)
      } satisfies ProgramPortfolioRow;
    })
    .sort((a, b) => a.programName.localeCompare(b.programName, "vi"));

  return {
    totals: {
      programs: programs.length,
      activePrograms: programs.filter((program) => program.isActive).length,
      activeSeasons: catalog.seasons.filter((season) => (!programId || season.programId === programId) && isActiveSeason(season.status)).length,
      openApplications: sum(applications),
      activeMentors: sum(mentors),
      activeMentees: sum(mentees),
      activeMatches: sum(matches),
      upcomingEvents: sum(events),
      dataIssues: sum(issues),
      overdueTasks: sum(overdue)
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
  const catalog = await loadProgramContextCatalog();
  return loadAggregateRows(catalog, context.selectedProgramId);
}
