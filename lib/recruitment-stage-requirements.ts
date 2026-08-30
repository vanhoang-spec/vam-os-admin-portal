import "server-only";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export type StageRequirement = { season_id: string; review_stage: "profile_screening" | "interview"; minimum_submitted_reviews: number };

export async function getStageRequirements(seasonIds: string[]) {
  const client = getSupabaseServiceRoleClient();
  if (!client || !seasonIds.length) return { data: [] as StageRequirement[], error: null as string | null };
  const { data, error } = await client.from("recruitment_stage_requirements").select("season_id,review_stage,minimum_submitted_reviews").in("season_id", seasonIds);
  return { data: (data ?? []) as StageRequirement[], error: error?.message ?? null };
}

export async function updateStageRequirement(input: { seasonId: string; stage: "profile_screening" | "interview"; minimum: number }) {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !(await canOperateSeason(await getAdminScopeContext(), input.seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền cấu hình mùa này." };
  }
  if (!Number.isInteger(input.minimum) || input.minimum < 1 || input.minimum > 20) {
    return { ok: false as const, message: "Số review tối thiểu phải từ 1 đến 20." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false as const, message: "Thiếu kết nối quản trị." };
  const { error } = await client.rpc("vam084_upsert_stage_requirement", {
    p_actor: actor.id, p_season_id: input.seasonId, p_review_stage: input.stage, p_minimum: input.minimum
  });
  return error ? { ok: false as const, message: "Không thể lưu cấu hình." } : { ok: true as const, message: "Đã lưu cấu hình." };
}
