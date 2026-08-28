/** Matches the production policy used by getReviewEligibleReviewers(). */
export const REVIEW_ELIGIBLE_ROLES = Object.freeze([
  "super_admin",
  "admin",
  "core_team",
  "reviewer"
] as const);

const REVIEW_ELIGIBLE_ROLE_SET = new Set<string>(REVIEW_ELIGIBLE_ROLES);

type ReviewerRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
  status?: string | null;
};

export type ReviewerEligibilityResult =
  | { ok: true; reviewers: ReviewerRow[] }
  | { ok: false; message: string; error?: unknown };

/**
 * Re-fetch reviewer identities with the service client and fail closed unless
 * every requested account is active and holds a review-eligible role.
 */
export async function validateReviewEligibleReviewers(
  client: any,
  reviewerIds: readonly string[]
): Promise<ReviewerEligibilityResult> {
  const uniqueIds = Array.from(
    new Set(reviewerIds.map((id) => String(id).trim()).filter(Boolean))
  );
  if (!uniqueIds.length) return { ok: false, message: "Vui lòng chọn ít nhất một reviewer." };

  const { data, error } = await client
    .from("admin_users")
    .select("id,email,full_name,role,status")
    .in("id", uniqueIds);
  if (error) {
    return {
      ok: false,
      message: "Không thể xác minh tài khoản reviewer.",
      error
    };
  }

  const rows = (data ?? []) as ReviewerRow[];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const allEligible = uniqueIds.every((id) => {
    const row = byId.get(id);
    return row?.status === "active" && REVIEW_ELIGIBLE_ROLE_SET.has(String(row.role ?? ""));
  });
  if (!allEligible) {
    return {
      ok: false,
      message: "Reviewer được chọn không tồn tại, không hoạt động hoặc không có vai trò phù hợp."
    };
  }

  return { ok: true, reviewers: uniqueIds.map((id) => byId.get(id)!) };
}
