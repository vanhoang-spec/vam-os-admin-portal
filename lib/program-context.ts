import "server-only";

import { getAdminScopeContext, type AdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  ProgramContextError,
  resolveAccessiblePrograms,
  resolveCanonicalContext,
  type CanonicalProgramContext,
  type ContextRequest,
  type ProgramAccessPrincipal,
  type ProgramContextCatalog
} from "@/lib/program-context-core";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function principalFromAdminContext(context: AdminScopeContext): ProgramAccessPrincipal {
  return {
    authenticated: Boolean(context.adminUser && context.authUserId),
    isSuperAdmin: context.isSuperAdmin,
    grants: context.programScopes.map((scope) => ({
      programId: scope.programId,
      seasonId: scope.seasonId,
      scopeLevel: scope.scopeLevel
    }))
  };
}

export async function loadProgramContextCatalog(): Promise<ProgramContextCatalog> {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new ProgramContextError("forbidden", "Không thể xác minh phạm vi truy cập lúc này.");

  const [programsResult, seasonsResult, batchesResult] = await Promise.all([
    client.from("programs").select("id,code,name,is_active"),
    client.from("seasons").select("id,code,name,program_id"),
    client.from("intake_batches").select("id,code,name,season_id,is_active")
  ]);
  const error = programsResult.error ?? seasonsResult.error;
  if (error) {
    console.error("[program-context] catalog lookup failed", { code: error.code, message: error.message });
    throw new ProgramContextError("forbidden", "Không thể xác minh phạm vi truy cập lúc này.");
  }

  // Intake batches are optional. Their temporary unavailability must not
  // take down the authoritative program and season inventory.
  if (batchesResult.error) {
    console.error("[program-context] intake batch catalog lookup failed", {
      code: batchesResult.error.code,
      message: batchesResult.error.message
    });
  }

  const warnings: string[] = [];
  const programs = (programsResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      isActive: row.is_active !== false
    })).filter((row: any) => row.id && row.code && row.name);
  if (programs.length !== (programsResult.data ?? []).length) {
    warnings.push("Một số program thiếu dữ liệu bắt buộc và đã bị loại khỏi bộ chọn.");
  }
  const programIds = new Set(programs.map((row: any) => row.id));
  const seasons = (seasonsResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      programId: text(row.program_id)
    })).filter((row: any) => row.id && row.code && row.name && row.programId && programIds.has(row.programId));
  if (seasons.length !== (seasonsResult.data ?? []).length) {
    warnings.push("Một số season thiếu liên kết program hợp lệ và đã bị loại khỏi bộ chọn.");
  }

  return {
    programs,
    seasons,
    intakeBatches: (batchesResult.error ? [] : batchesResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      seasonId: text(row.season_id),
      isActive: row.is_active !== false
    })),
    warnings
  };
}

export async function resolveAuthorizedProgramContext(request: ContextRequest): Promise<CanonicalProgramContext> {
  const [adminContext, catalog] = await Promise.all([getAdminScopeContext(), loadProgramContextCatalog()]);
  return resolveCanonicalContext(principalFromAdminContext(adminContext), catalog, request);
}

export async function resolveAuthorizedPrograms() {
  const [adminContext, catalog] = await Promise.all([getAdminScopeContext(), loadProgramContextCatalog()]);
  return resolveAccessiblePrograms(principalFromAdminContext(adminContext), catalog);
}

export function toProgramAccessPrincipal(context: AdminScopeContext) {
  return principalFromAdminContext(context);
}
