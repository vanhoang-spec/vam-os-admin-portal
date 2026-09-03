import "server-only";

import { readAllPages } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export type ReviewerOption = {
  adminUserId: string;
  email: string;
  fullName: string;
  /** How many review records this reviewer holds in the scoped season. */
  reviewCount: number;
};

/**
 * Reviewer options for the Review Scores export filter.
 *
 * Deliberately sourced from the reviews that ACTUALLY EXIST in the scoped
 * season, not from the current reviewer pool
 * (vam084_list_recruitment_participants). Those two sets diverge in both
 * directions and the pool would be the wrong answer for a historical export:
 *
 *   * A reviewer whose participation was later revoked, or whose season grant
 *     expired, still has their submitted scores in the data. Sourcing from the
 *     pool would make those rows unreachable through the UI.
 *   * Screening done by an admin / core_team account is not a "reviewer pool"
 *     membership at all, but it is a real review record that Core Team needs
 *     to be able to filter by.
 *
 * Read-only and pagination-safe: `readAllPages` exhausts `application_reviews`
 * under its keyset key, rebuilding the season constraint on every page, so the
 * option list cannot be silently truncated at the PostgREST row cap. No new
 * database object is introduced for this dropdown.
 */
export async function getSeasonReviewerOptions(
  seasonId: string
): Promise<{ data: ReviewerOption[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { data: [], error: "Service client unavailable" };

  const { data, error } = await readAllPages<Record<string, any>>(
    "application_reviews",
    `
      id,
      reviewer_admin_user_id,
      reviewer:admin_users!application_reviews_reviewer_admin_user_id_fkey(
        id,
        email,
        full_name
      ),
      application:applications!inner(
        season_id
      )
    `,
    (columns) =>
      client.from("application_reviews").select(columns).eq("application.season_id", seasonId)
  );

  if (error) {
    console.error("Reviewer options read failed", error);
    return { data: [], error: "Không thể tải danh sách reviewer." };
  }

  const byId = new Map<string, ReviewerOption>();
  for (const row of data ?? []) {
    const id = String(row.reviewer_admin_user_id ?? row.reviewer?.id ?? "").trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      existing.reviewCount += 1;
      continue;
    }
    byId.set(id, {
      adminUserId: id,
      email: String(row.reviewer?.email ?? ""),
      fullName: String(row.reviewer?.full_name ?? ""),
      reviewCount: 1
    });
  }

  const options = Array.from(byId.values()).sort((a, b) => {
    const left = (a.fullName || a.email || a.adminUserId).toLocaleLowerCase("vi");
    const right = (b.fullName || b.email || b.adminUserId).toLocaleLowerCase("vi");
    return left.localeCompare(right, "vi");
  });

  return { data: options, error: null };
}
