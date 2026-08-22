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

export async function getSeasonCohortPersonIds(
  seasonId: string,
  role: SeasonCohortRole
): Promise<{ data: string[]; error: string | null }> {
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

  return {
    data: Array.from(new Set(
      data
        .filter((row) => isOfficialSeasonMembership(row, role))
        .map((row) => String(row.person_id ?? "").trim())
        .filter(Boolean)
    )),
    error: null
  };
}
