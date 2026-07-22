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
    client.from("seasons").select("id,code,name,program_id,status"),
    client.from("intake_batches").select("id,code,name,season_id,is_active")
  ]);
  const error = programsResult.error ?? seasonsResult.error ?? batchesResult.error;
  if (error) {
    console.error("[program-context] catalog lookup failed", { code: error.code, message: error.message });
    throw new ProgramContextError("forbidden", "Không thể xác minh phạm vi truy cập lúc này.");
  }

  return {
    programs: (programsResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      isActive: row.is_active !== false
    })),
    seasons: (seasonsResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      programId: text(row.program_id),
      status: row.status == null ? null : text(row.status)
    })),
    intakeBatches: (batchesResult.data ?? []).map((row: any) => ({
      id: text(row.id),
      code: text(row.code),
      name: text(row.name),
      seasonId: text(row.season_id),
      isActive: row.is_active !== false
    }))
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
