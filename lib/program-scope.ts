import "server-only";

import { cache } from "react";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { readBounded } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import type { JsonRecord } from "@/lib/types";

export type ScopeLevel = "full_access" | "operations" | "review" | "read";

export type ProgramScope = {
  programId: string | null;
  seasonId: string | null;
  scopeLevel: ScopeLevel;
  status: "active";
};

export type AdminScopeContext = {
  adminUser: CurrentAdminUser | null;
  authUserId: string | null;
  globalRole: string | null;
  isSuperAdmin: boolean;
  programScopes: ProgramScope[];
  /**
   * Non-null when the grants could not be read at all. An unreadable
   * `admin_scope_access` produces the same empty `programScopes` as a genuinely
   * ungranted user, and downstream that empty scope filters every table to zero
   * rows — an infrastructure failure rendered as legitimate "no activity".
   * Callers must surface this instead of treating the empty scope as truth.
   */
  scopeError: string | null;
};

export const SCOPE_RESOLUTION_ERROR =
  "Không xác minh được phạm vi truy cập của bạn. Đây là lỗi hệ thống, không phải dữ liệu trống. Vui lòng thử lại hoặc liên hệ quản trị viên.";

export type ScopeFilter = {
  allowedProgramIds?: string[];
  allowedSeasonIds?: string[];
};

const SCOPE_LEVELS = new Set(["full_access", "operations", "review", "read"]);
const SCOPE_RANK: Record<ScopeLevel, number> = {
  read: 1,
  review: 2,
  operations: 3,
  full_access: 4
};

/**
 * Fail closed on an unrecognised scope level.
 *
 * This used to normalise anything it did not understand — NULL, empty string,
 * a typo, a value from a future migration — into "read", which granted real
 * read authority on the strength of a value the system could not interpret.
 * `admin_scope_access.role` is nullable on Production and carries no CHECK
 * constraint, so that fallback was reachable by a single bad write.
 *
 * A grant whose level cannot be resolved now confers NOTHING and is dropped
 * during resolution. It is not downgraded to the weakest usable level.
 */
function asScopeLevel(value: unknown): ScopeLevel | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return SCOPE_LEVELS.has(text) ? (text as ScopeLevel) : null;
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

/**
 * Class B. `seasons` and `programs` are reference relations — tens of rows, one
 * per operating season and program — and every scope decision on the site is
 * derived from them. `readBounded` asserts that bound: if either relation ever
 * grows past it the read fails instead of silently returning a partial catalog,
 * which would quietly shrink every admin's resolved scope.
 */
async function loadSeasonsAndPrograms() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { seasons: [] as JsonRecord[], programs: [] as JsonRecord[] };
  const [seasonsRes, programsRes] = await Promise.all([
    readBounded<JsonRecord>("seasons", client.from("seasons").select("id,code,name,program_id")),
    readBounded<JsonRecord>("programs", client.from("programs").select("id,code,name"))
  ]);
  if (seasonsRes.error || programsRes.error) {
    console.error("[program-scope] season/program catalog read failed", {
      seasons: (seasonsRes.error as { message?: string } | null)?.message,
      programs: (programsRes.error as { message?: string } | null)?.message
    });
    return { seasons: [] as JsonRecord[], programs: [] as JsonRecord[] };
  }
  return { seasons: seasonsRes.data, programs: programsRes.data };
}

export const getAdminScopeContext = cache(async (): Promise<AdminScopeContext> => {
  const adminUser = await getCurrentAdminUser();
  const authUserId = adminUser?.auth_user_id ?? null;
  const globalRole = adminUser?.role ?? null;
  const isSuperAdmin = globalRole === "super_admin";

  if (!adminUser || !authUserId) {
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [], scopeError: null };
  }
  if (isSuperAdmin) {
    return { adminUser, authUserId, globalRole, isSuperAdmin: true, programScopes: [], scopeError: null };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    // Missing service-role credential, not an ungranted user.
    console.error("[program-scope] service-role client unavailable; cannot resolve scope");
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [], scopeError: SCOPE_RESOLUTION_ERROR };
  }

  const { data, error } = await client
    .from("admin_scope_access")
    .select("user_id,program_id,season_id,role,status")
    .eq("user_id", authUserId)
    .eq("status", "active");

  if (error) {
    console.error("[program-scope] admin_scope_access lookup failed", {
      code: error.code,
      message: error.message,
      hint: error.hint,
      details: error.details
    });
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [], scopeError: SCOPE_RESOLUTION_ERROR };
  }

  const rows = (data ?? []) as JsonRecord[];
  const programScopes: ProgramScope[] = [];
  let droppedGrants = 0;

  for (const row of rows) {
    const scopeLevel = asScopeLevel(row.role);
    const programId = clean(row.program_id);
    const seasonId = clean(row.season_id);

    // An unreadable level, or a grant that names neither a program nor a
    // season, is not a weaker grant — it is not a grant. Dropping it here is
    // what stops it reaching the scope-blind `canOperateAnyScope` family, which
    // inspects only the level and would otherwise unlock every mutation entry
    // point on the strength of a row that authorizes no program at all.
    //
    // One malformed row must not poison the others: a holder with a valid
    // UEHM-S12 grant keeps it even if a second row is unusable.
    if (!scopeLevel || (!programId && !seasonId)) {
      droppedGrants += 1;
      continue;
    }
    programScopes.push({ programId, seasonId, scopeLevel, status: "active" });
  }

  if (droppedGrants > 0) {
    console.warn("[program-scope] dropped unusable admin_scope_access grants", {
      droppedGrants,
      totalGrants: rows.length
    });
  }

  return {
    adminUser,
    authUserId,
    globalRole,
    isSuperAdmin: false,
    scopeError: null,
    programScopes
  };
});

export async function getAllowedProgramIds(ctx: AdminScopeContext): Promise<string[]> {
  const { seasons, programs } = await loadSeasonsAndPrograms();
  if (ctx.isSuperAdmin) return unique(programs.flatMap((row) => [String(row.id ?? ""), clean(row.code)]));

  const programCodesById = new Map(programs.map((row) => [String(row.id ?? ""), clean(row.code)]));
  const programIdsByCode = new Map(programs.map((row) => [String(row.code ?? ""), String(row.id ?? "")]));
  const seasonProgramBySeasonKey = new Map<string, string | null>();
  for (const season of seasons) {
    const programId = clean(season.program_id);
    if (season.id) seasonProgramBySeasonKey.set(String(season.id), programId);
    if (season.code) seasonProgramBySeasonKey.set(String(season.code), programId);
  }

  const values: string[] = [];
  for (const scope of ctx.programScopes) {
    if (scope.programId) {
      values.push(scope.programId);
      const byCode = programIdsByCode.get(scope.programId);
      if (byCode) values.push(byCode);
      const code = programCodesById.get(scope.programId);
      if (code) values.push(code);
    }
    if (scope.seasonId) {
      const programId = seasonProgramBySeasonKey.get(scope.seasonId);
      if (programId) {
        values.push(programId);
        const code = programCodesById.get(programId);
        if (code) values.push(code);
      }
    }
  }
  return unique(values);
}

export async function getAllowedSeasonIds(ctx: AdminScopeContext): Promise<string[]> {
  const { seasons, programs } = await loadSeasonsAndPrograms();
  if (ctx.isSuperAdmin) return seasons.map((row) => String(row.id)).filter(Boolean);

  const programIdsByKey = new Map<string, string>();
  for (const program of programs) {
    if (program.id) programIdsByKey.set(String(program.id), String(program.id));
    if (program.code) programIdsByKey.set(String(program.code), String(program.id));
  }

  const allowed: string[] = [];
  for (const scope of ctx.programScopes) {
    if (scope.seasonId) {
      const matchingSeason = seasons.find((season) => season.id === scope.seasonId || season.code === scope.seasonId);
      if (matchingSeason?.id) allowed.push(String(matchingSeason.id));
      if (isUuidLike(scope.seasonId)) allowed.push(scope.seasonId);
      continue;
    }

    if (scope.programId) {
      const programId = programIdsByKey.get(scope.programId) ?? scope.programId;
      for (const season of seasons) {
        if (String(season.program_id ?? "") === programId || String(season.program_id ?? "") === scope.programId) {
          allowed.push(String(season.id));
        }
      }
    }
  }
  return unique(allowed);
}

/**
 * Resolve the rows an already role-authorized read may see.
 *
 * Scope levels continue to gate mutations through the canOperate and
 * canReview helpers.
 * They must not shrink a read scope: role answers whether the user may enter a
 * read route, while this filter answers which program/season rows are visible.
 */
export async function getScopeFilter(ctx: AdminScopeContext): Promise<ScopeFilter | undefined> {
  if (ctx.isSuperAdmin) return undefined;
  const [allowedProgramIds, allowedSeasonIds] = await Promise.all([
    getAllowedProgramIds(ctx),
    getAllowedSeasonIds(ctx)
  ]);
  return { allowedProgramIds, allowedSeasonIds };
}

export function canAccessProgram(ctx: AdminScopeContext, programId: string | null | undefined) {
  if (ctx.isSuperAdmin) return true;
  if (!programId) return false;
  return ctx.programScopes.some((scope) => scope.programId === programId);
}

export function canAccessSeason(ctx: AdminScopeContext, seasonId: string | null | undefined, allowedSeasonIds: string[]) {
  if (ctx.isSuperAdmin) return true;
  if (!seasonId) return false;
  return allowedSeasonIds.includes(seasonId);
}

export function getScopeLevelForProgram(ctx: AdminScopeContext, programId: string | null | undefined): ScopeLevel | null {
  if (ctx.isSuperAdmin) return "full_access";
  if (!programId) return null;
  return ctx.programScopes.find((scope) => scope.programId === programId)?.scopeLevel ?? null;
}

export function hasScopeLevel(ctx: AdminScopeContext, programId: string | null | undefined, requiredLevel: ScopeLevel) {
  if (ctx.isSuperAdmin) return true;
  const level = getScopeLevelForProgram(ctx, programId);
  if (!level) return false;
  return SCOPE_RANK[level] >= SCOPE_RANK[requiredLevel];
}

function bestScopeLevel(levels: ScopeLevel[]) {
  return levels.sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a])[0] ?? null;
}

export function resolveCanonicalScope(
  ctx: AdminScopeContext,
  programId: string | null | undefined,
  programCode: string | null | undefined,
  seasonId: string | null | undefined,
  seasonCode: string | null | undefined
): ScopeLevel | null {
  if (ctx.isSuperAdmin) return "full_access";

  const matchingLevels = ctx.programScopes
    .filter((scope) => {
      if (scope.seasonId) {
        return (seasonId && scope.seasonId === seasonId) || (seasonCode && scope.seasonId === seasonCode);
      }
      if (scope.programId) {
        return (programId && scope.programId === programId) || (programCode && scope.programId === programCode);
      }
      return false;
    })
    .map((scope) => scope.scopeLevel);

  return bestScopeLevel(matchingLevels);
}

export async function getScopeLevelForSeason(
  ctx: AdminScopeContext,
  seasonId: string | null | undefined
): Promise<ScopeLevel | null> {
  if (ctx.isSuperAdmin) return "full_access";
  if (!seasonId) return null;

  const { seasons, programs } = await loadSeasonsAndPrograms();
  const season = seasons.find((row) => row.id === seasonId || row.code === seasonId);
  const resolvedSeasonId = clean(season?.id) ?? seasonId;
  const seasonCode = clean(season?.code);
  const seasonProgramId = clean(season?.program_id);
  const program = programs.find((row) => row.id === seasonProgramId || row.code === seasonProgramId);
  const programCode = clean(program?.code);

  return resolveCanonicalScope(ctx, seasonProgramId, programCode, resolvedSeasonId, seasonCode);
}

export async function canReadSeason(ctx: AdminScopeContext, seasonId: string | null | undefined) {
  const level = await getScopeLevelForSeason(ctx, seasonId);
  return Boolean(level);
}

export async function canOperateSeason(ctx: AdminScopeContext, seasonId: string | null | undefined) {
  const level = await getScopeLevelForSeason(ctx, seasonId);
  return level === "full_access" || level === "operations";
}

export async function canReviewSeason(ctx: AdminScopeContext, seasonId: string | null | undefined) {
  const level = await getScopeLevelForSeason(ctx, seasonId);
  return level === "full_access" || level === "review";
}

export function canReadAnyScope(ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || ctx.programScopes.some((scope) => SCOPE_RANK[scope.scopeLevel] >= SCOPE_RANK.read);
}

export function canOperateAnyScope(ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || ctx.programScopes.some((scope) => scope.scopeLevel === "full_access" || scope.scopeLevel === "operations");
}

export function canReviewAnyScope(ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || ctx.programScopes.some((scope) => scope.scopeLevel === "full_access" || scope.scopeLevel === "review");
}

export function requireProgramAccess(ctx: AdminScopeContext, programId?: string | null) {
  if (ctx.isSuperAdmin) return;
  if (programId && canAccessProgram(ctx, programId)) return;
  if (!programId && ctx.programScopes.length > 0) return;
  throw new Error("UNAUTHORIZED: no access to this program");
}
