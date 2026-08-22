const SEASON_AWARE_PATHS = new Set([
  "/",
  "/mentors",
  "/mentees",
  "/matches",
  "/operations",
  "/operations/tasks"
]);

export function seasonLabel(code: string, fallback?: string | null) {
  const match = String(code ?? "").trim().toUpperCase().match(/-S(\d+)$/);
  return match ? `Mùa ${Number(match[1])}` : String(fallback ?? code ?? "").trim();
}

export function isSeasonAwarePath(pathname: string) {
  return SEASON_AWARE_PATHS.has(pathname);
}

