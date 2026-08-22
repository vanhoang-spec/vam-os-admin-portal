import { getSupabaseServiceRoleClient } from "./supabase-server";
import { getScopedIntakeBatchIds } from "./data";
import { ScopeFilter } from "./program-scope";
import { ApplicationListRowV1 } from "./types-r2";

export type GetPagedApplicationsOptions = {
  scope?: ScopeFilter;
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  role_applied?: string;
  season_code?: string;
  intake_batch?: string;
  consent?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
};

export async function getPagedApplications(options: GetPagedApplicationsOptions) {
  const serviceRole = getSupabaseServiceRoleClient();
  if (!serviceRole) return { data: [], count: 0, error: "Service role client required." };

  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(options.scope);
  if (batchScopeError) return { data: [], count: 0, error: batchScopeError };

  let query = serviceRole.from("application_list_v1").select("*", { count: "exact" });

  if (options.scope) {
    const allowedKeys = new Set<string>();
    if (options.scope.allowedSeasonIds?.length) {
      options.scope.allowedSeasonIds.forEach((id) => allowedKeys.add(id));
    }
    if (batchIds?.length) {
      batchIds.forEach((id) => allowedKeys.add(id));
    }
    if (allowedKeys.size > 0) {
      query = query.in("batch_season_id", Array.from(allowedKeys));
    } else {
      // no keys allowed
      return { data: [], count: 0, error: null };
    }
  }

  if (options.q) {
    const qTrimmed = options.q.trim().toLowerCase();
    const sanitized = qTrimmed.replace(/[%_\\]/g, "\\$&");
    if (sanitized) query = query.ilike("search_blob", `%${sanitized}%`);
  }

  if (options.status) query = query.eq("status_unified", options.status);
  if (options.role_applied) query = query.eq("role_applied", options.role_applied);
  if (options.season_code) query = query.eq("season_code", options.season_code);
  if (options.intake_batch) query = query.eq("intake_batch_code", options.intake_batch);
  if (options.consent) {
    if (options.consent === "yes") query = query.or("consent_unified.eq.true,consent_unified.eq.yes");
    if (options.consent === "no") query = query.or("consent_unified.eq.false,consent_unified.eq.no");
    if (options.consent === "unknown") query = query.is("consent_unified", null);
  }

  // Cap page size explicitly to avoid hitting PostgREST maxRows silently
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const page = Math.max(options.page || 1, 1);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  query = query.range(from, to);

  const sortBy = options.sortBy || "submitted_at";
  const sortDir = options.sortDirection || "desc";
  query = query.order(sortBy, { ascending: sortDir === "asc", nullsFirst: sortDir !== "asc" });

  const { data, count, error } = await query;
  if (error) return { data: [], count: 0, error: `Lỗi truy xuất đơn (applications): ${error.message}` };
  return { data: data as ApplicationListRowV1[], count: count || 0, error: null };
}

export async function getApplicationFacets(scope?: ScopeFilter) {
  const serviceRole = getSupabaseServiceRoleClient();
  if (!serviceRole) return { data: [], error: "Service role required" };
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) return { data: [], error: batchScopeError };

  let query = serviceRole.from("application_facets_v1").select("*");

  if (scope) {
    const allowedKeys = new Set<string>();
    if (scope.allowedSeasonIds?.length) {
      scope.allowedSeasonIds.forEach((id) => allowedKeys.add(id));
    }
    if (batchIds?.length) {
      batchIds.forEach((id) => allowedKeys.add(id));
    }
    if (allowedKeys.size > 0) {
      query = query.in("batch_season_id", Array.from(allowedKeys));
    } else {
      return { data: [], error: null };
    }
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data, error: null };
}
