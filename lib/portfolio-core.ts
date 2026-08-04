import type { ProgramContextCatalog, SeasonCatalogRow } from "@/lib/program-context-core";

export type CountValue = number | null;
export type PortfolioSources = { applications: any[] | null; memberships: any[] | null; matches: any[] | null; events: any[] | null; actions: any[] | null };
export type PortfolioSeasonScope = { mode: "current" } | { mode: "all" } | { mode: "selected"; seasonId: string };
export type ProgramPortfolioRow = {
  programId: string; programCode: string; programName: string; isActive: boolean;
  currentSeasonId: string | null; currentSeasonCode: string | null;
  applications: CountValue; mentors: CountValue; mentees: CountValue; activeMatches: CountValue;
  upcomingEvents: CountValue; dataIssues: CountValue; overdueTasks: CountValue;
  participantLinkageIncomplete: boolean;
  health: "normal" | "attention" | "data_issue" | "unknown";
};
const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();
const ordinal = (code: string) => Number(code.match(/(?:^|-)S(\d+)(?:$|-)/i)?.[1] ?? -1);
export function resolveCurrentSeason(seasons: SeasonCatalogRow[]) {
  return [...seasons].sort((a, b) => ordinal(b.code) - ordinal(a.code) || b.code.localeCompare(a.code))[0] ?? null;
}
const count = (rows: any[] | null, predicate: (row: any) => boolean) => rows === null ? null : rows.filter(predicate).length;
const isOpenApplication = (value: unknown) => !["approved", "rejected", "withdrawn", "cancelled", "declined", "profile_created"].includes(lower(value));
function participantCount(memberships: any[] | null, matches: any[] | null, role: "mentor" | "mentee") {
  if (memberships === null || matches === null) return { value: null, incomplete: false };
  const membershipIds = memberships.filter((row) => lower(row.role) === role && lower(row.status) === "active").map((row) => String(row.person_id ?? "").trim()).filter(Boolean);
  const personKey = role === "mentor" ? "mentor_person_id" : "mentee_person_id";
  const activeMatches = matches.filter((row) => lower(row.status) === "active");
  const matchIds = activeMatches.map((row) => String(row[personKey] ?? "").trim()).filter(Boolean);
  const incomplete = activeMatches.length > 0 && matchIds.length !== activeMatches.length && membershipIds.length === 0;
  return { value: incomplete ? null : new Set([...membershipIds, ...matchIds]).size, incomplete };
}
function health(dataIssues: CountValue, overdueTasks: CountValue): ProgramPortfolioRow["health"] {
  if (dataIssues === null || overdueTasks === null) return "unknown";
  if (dataIssues > 0) return "data_issue";
  if (overdueTasks > 0) return "attention";
  return "normal";
}
export function reconcilePortfolioRows(
  catalog: ProgramContextCatalog,
  sources: PortfolioSources,
  programId?: string,
  now = new Date(),
  scope: PortfolioSeasonScope = { mode: "current" }
) {
  const today = now.toISOString().slice(0, 10);
  return catalog.programs.filter((program) => !programId || program.id === programId).map((program) => {
    const linkedSeasons = catalog.seasons.filter((row) => row.programId === program.id);
    const currentSeason = resolveCurrentSeason(linkedSeasons);
    const selectedSeasons = scope.mode === "all"
      ? linkedSeasons
      : scope.mode === "selected"
        ? linkedSeasons.filter((row) => row.id === scope.seasonId)
        : currentSeason ? [currentSeason] : [];
    if (!selectedSeasons.length) return {
      programId: program.id, programCode: program.code, programName: program.name, isActive: program.isActive,
      currentSeasonId: null, currentSeasonCode: null, applications: null, mentors: null, mentees: null, activeMatches: null,
      upcomingEvents: null, dataIssues: null, overdueTasks: null, participantLinkageIncomplete: false, health: "unknown"
    } satisfies ProgramPortfolioRow;
    const selectedIds = new Set(selectedSeasons.map((row) => row.id));
    const inScope = (rows: any[] | null) => rows?.filter((row) => selectedIds.has(String(row.season_id ?? ""))) ?? null;
    const applications = inScope(sources.applications); const memberships = inScope(sources.memberships);
    const matches = inScope(sources.matches); const events = inScope(sources.events); const actions = inScope(sources.actions);
    const mentors = participantCount(memberships, matches, "mentor"); const mentees = participantCount(memberships, matches, "mentee");
    const dataIssues = count(actions, (row) => lower(row.action_type) === "data_issue" && ["open", "in_progress", "parked"].includes(lower(row.status)));
    const overdueTasks = count(actions, (row) => ["open", "in_progress", "parked"].includes(lower(row.status)) && String(row.due_date ?? "") < today);
    return {
      programId: program.id, programCode: program.code, programName: program.name, isActive: program.isActive,
      currentSeasonId: scope.mode === "all" ? null : selectedSeasons[0].id,
      currentSeasonCode: scope.mode === "all" ? null : selectedSeasons[0].code,
      applications: count(applications, (row) => isOpenApplication(row.status ?? row.final_status)), mentors: mentors.value, mentees: mentees.value,
      activeMatches: count(matches, (row) => lower(row.status) === "active"),
      upcomingEvents: count(events, (row) => Boolean(row.starts_at) && new Date(row.starts_at) >= now && !["cancelled", "completed"].includes(lower(row.status))),
      dataIssues, overdueTasks, participantLinkageIncomplete: mentors.incomplete || mentees.incomplete, health: health(dataIssues, overdueTasks)
    } satisfies ProgramPortfolioRow;
  }).sort((a, b) => a.programName.localeCompare(b.programName, "vi"));
}
export function total(rows: ProgramPortfolioRow[], key: keyof ProgramPortfolioRow): CountValue {
  const values = rows.map((row) => row[key]);
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + Number(value), 0);
}
