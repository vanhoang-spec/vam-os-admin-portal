/**
 * Bulk "Mời phỏng vấn" — shared constants and row eligibility.
 *
 * Plain module (no "use server", no "server-only") so the page and its client
 * form read one definition rather than two that happen to agree.
 *
 * ELIGIBILITY IS NOT DECIDED HERE. It delegates to
 * `evaluateDirectInterviewInvite`, the single canonical mirror of the
 * `invited_to_interview` branch of `vam084_application_decision_eligibility`,
 * which the individual decision panel also answers from. A second hand-written
 * allowlist here was the drift Codex found: it omitted profile-stage
 * `needs_more_review` entirely, so an application the individual command would
 * accept was invisible in bulk.
 *
 * And this is still only about what an operator is SHOWN.
 * `vam084_apply_application_decisions` re-derives eligibility per application
 * under a row lock, with the expected-status check, on every write.
 */

import {
  evaluateDirectInterviewInvite,
  type DirectInviteEvaluation
} from "@/lib/direct-interview-eligibility";

export const BULK_INVITE_TARGET_STATUS = "invited_to_interview";

/**
 * Rows per batch.
 *
 * `bulkApplicationDecisionAction` accepts up to 500 and the RPC locks every
 * requested application in one transaction, so the ceiling here is about the
 * operator, not the database: 100 is a reviewable screenful for a person who
 * has to stand behind each name, and it keeps one wave inside the default
 * serverless budget with room to spare.
 */
export const BULK_INVITE_MAX = 100;

export type BulkInviteCandidate = {
  status: unknown;
  submittedProfileReviewers: number;
  requiredProfileReviews: number | null;
  submittedInterviewReviewers: number;
  latestNeedsMoreReviewAt: string | null;
  latestProfileSubmissionAt: string | null;
};

/**
 * Whether a row is worth offering, by the same rules the server applies.
 *
 * Profile-stage `needs_more_review` IS offered when its provenance is
 * satisfied — a newer submitted profile review and no submitted interview
 * review. That is exactly what the database permits, and withholding it here
 * would leave Core Team unable to clear remediated applications in bulk.
 */
export function evaluateBulkInviteCandidate(input: BulkInviteCandidate): DirectInviteEvaluation {
  return evaluateDirectInterviewInvite({
    applicationStatus: input.status,
    submittedProfileReviewers: input.submittedProfileReviewers,
    requiredProfileReviews: input.requiredProfileReviews,
    submittedInterviewReviewers: input.submittedInterviewReviewers,
    latestNeedsMoreReviewAt: input.latestNeedsMoreReviewAt,
    latestProfileSubmissionAt: input.latestProfileSubmissionAt
  });
}

export function isBulkInviteCandidate(input: BulkInviteCandidate): boolean {
  return evaluateBulkInviteCandidate(input).eligible;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lọc theo đề xuất của người chấm vòng hồ sơ (26/09/2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// Không có bộ lọc này, lọc "mentee" trên màn này ra CẢ 548 đơn đã chấm — gồm
// cả những bạn người chấm đề xuất "không phù hợp" — và nút "Chọn 100 hồ sơ" lấy
// 100 người đầu danh sách bất kể đề xuất. Bấm theo phản xạ là mời nhầm người bị
// loại, và thư mời đã gửi thì không rút lại được.

/** Các đề xuất có thể lọc, đúng thứ tự trên ô chọn của phiếu chấm hồ sơ. */
export const PROFILE_RECOMMENDATION_FILTERS = [
  { value: "pass_to_interview", label: "Mời vào vòng phỏng vấn" },
  { value: "waitlist", label: "Đưa vào danh sách chờ" },
  { value: "needs_admin_review", label: "Cần core team/admin xem thêm" },
  { value: "reject", label: "Không phù hợp" }
] as const;

export type ProfileRecommendation = (typeof PROFILE_RECOMMENDATION_FILTERS)[number]["value"];

/** Nhiều người chấm, đề xuất không thống nhất. */
export const MIXED_RECOMMENDATION = "mixed";

export function isProfileRecommendationFilter(value: unknown): value is ProfileRecommendation {
  return PROFILE_RECOMMENDATION_FILTERS.some((row) => row.value === value);
}

/**
 * Đề xuất CHUNG của một hồ sơ, từ mọi phiếu chấm hồ sơ đã nộp.
 *
 * Mọi phiếu cùng một đề xuất → đề xuất đó. Khác nhau → `mixed`. Chưa có phiếu
 * nào → null.
 *
 * Cố ý KHÔNG lấy "phiếu mới nhất" hay "đa số": một hồ sơ có một người bảo mời
 * và một người bảo loại không được lọt vào danh sách "mời vào vòng phỏng vấn"
 * để bị mời hàng loạt. Hồ sơ đó cần một người đọc, không cần một cú bấm. Mùa
 * S12 cấu hình một phiếu mỗi hồ sơ nên `mixed` chưa xảy ra — luật này là cho
 * ngày ai đó nâng số phiếu tối thiểu lên.
 */
export function profileRecommendationOf(recommendations: readonly unknown[]): string | null {
  const values = Array.from(
    new Set(recommendations.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
  if (values.length === 0) return null;
  if (values.length > 1) return MIXED_RECOMMENDATION;
  return values[0];
}

/** Nhãn tiếng Việt của đề xuất chung, cho cột trên màn mời hàng loạt. */
export function profileRecommendationLabel(value: string | null): string {
  if (value === null) return "Chưa có đề xuất";
  if (value === MIXED_RECOMMENDATION) return "Người chấm đề xuất khác nhau";
  return PROFILE_RECOMMENDATION_FILTERS.find((row) => row.value === value)?.label ?? value;
}
