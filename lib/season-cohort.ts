import "server-only";

import { readAllPages } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";

export type SeasonCohortRole = "mentor" | "mentee";

const COHORT_STATUSES = new Set(["active", "completed"]);
const COHORT_ERROR = "Không thể xác minh danh sách thành viên chính thức của mùa.";

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isOfficialSeasonMembership(
  row: { role?: unknown; status?: unknown },
  role: SeasonCohortRole
) {
  return normalized(row.role) === role && COHORT_STATUSES.has(normalized(row.status));
}

export function intersectAuthorizedAndCohort(
  authorizedPersonIds: string[] | null,
  cohortPersonIds: string[]
) {
  const cohort = Array.from(new Set(cohortPersonIds.filter(Boolean)));
  if (authorizedPersonIds === null) return cohort;
  const authorized = new Set(authorizedPersonIds);
  return cohort.filter((personId) => authorized.has(personId));
}

/** Mọi tư cách thành viên của một mùa. Một phép đọc cho mọi câu hỏi về thành viên chính thức. */
async function readSeasonMemberships(seasonId: string): Promise<{ data: JsonRecord[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client || !seasonId) return { data: [], error: COHORT_ERROR };

  const { data, error } = await readAllPages<JsonRecord>(
    "person_season_memberships",
    "id,person_id,role,status,season_id",
    (projection) => client
      .from("person_season_memberships")
      .select(projection)
      .eq("season_id", seasonId)
  );

  if (error) {
    const detail = error as { code?: string; message?: string };
    console.error("[season-cohort] membership lookup failed", {
      code: detail.code,
      message: detail.message
    });
    return { data: [], error: COHORT_ERROR };
  }

  return { data, error: null };
}

export async function getSeasonCohortPersonIds(
  seasonId: string,
  role: SeasonCohortRole
): Promise<{ data: string[]; error: string | null }> {
  const memberships = await readSeasonMemberships(seasonId);
  if (memberships.error) return { data: [], error: memberships.error };

  return {
    data: Array.from(new Set(
      memberships.data
        .filter((row) => isOfficialSeasonMembership(row, role))
        .map((row) => String(row.person_id ?? "").trim())
        .filter(Boolean)
    )),
    error: null
  };
}

/**
 * Thành viên chính thức của mùa, kèm vai trò của từng người.
 *
 * Một người có thể vừa là mentor vừa là mentee trong cùng một mùa (ràng buộc
 * duy nhất là theo người-mùa-vai trò), nên trả về danh sách vai trò chứ không
 * phải một vai trò.
 */
export async function getSeasonCohortRoleMap(
  seasonId: string
): Promise<{ data: Map<string, SeasonCohortRole[]>; error: string | null }> {
  const memberships = await readSeasonMemberships(seasonId);
  if (memberships.error) return { data: new Map(), error: memberships.error };

  const roles = new Map<string, SeasonCohortRole[]>();
  for (const row of memberships.data) {
    const personId = String(row.person_id ?? "").trim();
    if (!personId) continue;
    for (const role of ["mentor", "mentee"] as const) {
      if (!isOfficialSeasonMembership(row, role)) continue;
      const list = roles.get(personId) ?? [];
      if (!list.includes(role)) list.push(role);
      roles.set(personId, list);
    }
  }
  return { data: roles, error: null };
}
