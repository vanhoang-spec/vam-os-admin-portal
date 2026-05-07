import "server-only";

import { cache } from "react";
import { getCurrentAdminUser } from "@/lib/admin-auth";
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
};

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

function asScopeLevel(value: unknown): ScopeLevel {
  const text = String(value ?? "read");
  return SCOPE_LEVELS.has(text) ? (text as ScopeLevel) : "read";
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

async function loadSeasonsAndPrograms() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { seasons: [] as JsonRecord[], programs: [] as JsonRecord[] };
  const [seasonsRes, programsRes] = await Promise.all([
    client.from("seasons").select("id,code,name,program_id"),
    client.from("programs").select("id,code,name")
  ]);
  return {
    seasons: (seasonsRes.data ?? []) as JsonRecord[],
    programs: (programsRes.data ?? []) as JsonRecord[]
  };
}

export const getAdminScopeContext = cache(async (): Promise<AdminScopeContext> => {
  const adminUser = await getCurrentAdminUser();
  const authUserId = adminUser?.auth_user_id ?? null;
  const globalRole = adminUser?.role ?? null;
  const isSuperAdmin = globalRole === "super_admin";

  if (!adminUser || !authUserId) {
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [] };
  }
  if (isSuperAdmin) {
    return { adminUser, authUserId, globalRole, isSuperAdmin: true, programScopes: [] };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [] };
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
    return { adminUser, authUserId, globalRole, isSuperAdmin: false, programScopes: [] };
  }

  return {
    adminUser,
    authUserId,
    globalRole,
    isSuperAdmin: false,
    programScopes: ((data ?? []) as JsonRecord[]).map((row) => ({
      programId: clean(row.program_id),
      seasonId: clean(row.season_id),
      scopeLevel: asScopeLevel(row.role),
      status: "active"
    }))
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
