import type { ApplicationReview } from "@/lib/types";

export type ReviewOversightScopeMode = "operational" | "all";

export interface ReviewOversightFilters {
  seasonId?: string;
  intakeBatchId?: string;
  roleApplied?: string;
  reviewRound?: string;
  reviewerId?: string;
  reviewStatus?: string;
  scopeMode: ReviewOversightScopeMode;
  page: number;
}

export function parseReviewOversightFilters(searchParams: Record<string, string | string[] | undefined>): ReviewOversightFilters {
  const getSingle = (val: string | string[] | undefined): string | undefined => {
    if (Array.isArray(val)) return val[0]?.trim() || undefined;
    return val?.trim() || undefined;
  };

  const pageRaw = getSingle(searchParams.page);
  const page = pageRaw ? parseInt(pageRaw, 10) : 1;

  const rawScope = getSingle(searchParams.scope);
  const scopeMode: ReviewOversightScopeMode = rawScope === "all" ? "all" : "operational";

  return {
    seasonId: getSingle(searchParams.season_id),
    intakeBatchId: getSingle(searchParams.intake_batch_id),
    roleApplied: getSingle(searchParams.role_applied),
    reviewRound: getSingle(searchParams.review_round), // empty meaning all rounds on list page, handled separately
    reviewerId: getSingle(searchParams.reviewer),
    reviewStatus: getSingle(searchParams.review_status),
    scopeMode,
    page: isNaN(page) || page < 1 ? 1 : page
  };
}

export function buildOversightQueryString(filters: Partial<ReviewOversightFilters>): string {
  const params = new URLSearchParams();
  if (filters.seasonId) params.set("season_id", filters.seasonId);
  if (filters.intakeBatchId) params.set("intake_batch_id", filters.intakeBatchId);
  if (filters.roleApplied) params.set("role_applied", filters.roleApplied);
  if (filters.reviewRound) params.set("review_round", filters.reviewRound);
  if (filters.reviewerId) params.set("reviewer", filters.reviewerId);
  if (filters.reviewStatus) params.set("review_status", filters.reviewStatus);
  if (filters.scopeMode === "all") params.set("scope", "all");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  
  const str = params.toString();
  return str ? `?${str}` : "";
}

export function getReviewerIdentityLabel(
  reviewerId: string | null | undefined,
  fullName: string | null | undefined,
  email: string | null | undefined
): string {
  if (!reviewerId) return "(Chưa gán)";
  if (fullName?.trim()) return fullName.trim();
  if (email?.trim()) return email.trim();
  return `Reviewer không xác định (${reviewerId.substring(0, 8)})`;
}

export type ActionabilityState = {
  isActionable: boolean; // if true, can 'Làm review'. if false, read-only 'Xem'
  badgeLabel: string;
};

/**
 * Derives actionability per the Owner contract:
 * - Terminal parent + submitted/cancelled/unfinished: non-actionable (historical)
 * - Cancelled review: non-actionable (historical), badge "Đã huỷ"
 * - Submitted review: non-actionable (historical), badge "Đã nộp"
 * - Operational parent + non-cancelled + unsubmitted: actionable
 */
export function getActionabilityState(
  reviewStatus: string,
  isParentTerminal: boolean
): ActionabilityState {
  if (reviewStatus === "cancelled") {
    return { isActionable: false, badgeLabel: "Đã huỷ" };
  }
  
  if (reviewStatus === "submitted") {
    return { isActionable: false, badgeLabel: "Đã nộp" };
  }

  if (isParentTerminal) {
    // If the application is terminal, even unsubmitted assignments are frozen
    return { isActionable: false, badgeLabel: reviewStatus }; // Caller will typically map status names
  }

  return { isActionable: true, badgeLabel: reviewStatus };
}
