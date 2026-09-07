/**
 * INTERVIEW OPS — Slice 1 oversight contract.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * Before Slice 1 the two oversight surfaces answered the same operational
 * question with two different hand-written populations:
 *
 *   /reviews/progress counted EVERY application_reviews row for a round,
 *                     including `cancelled` and including rows whose parent
 *                     application had already left recruitment;
 *   /reviews          listed only rows whose parent was still operational,
 *                     and for a reviewer also dropped `cancelled`.
 *
 * So a progress number and the list behind it could never be reconciled, and
 * no link between them could have fixed that — the two numbers described
 * different sets. This module is the single definition both surfaces read:
 * the filter vocabulary, the population rule, the bucket rule, the identity
 * rule and the URL representation. Nothing here performs I/O, so every rule is
 * unit-testable without a database.
 *
 * ---------------------------------------------------------------------------
 * THE POPULATION CONTRACT
 * ---------------------------------------------------------------------------
 *   CURRENT (operational) = parent application is recruitment-operational
 *                           AND review.status <> 'cancelled'
 *   HISTORY  (scope=all)  = the same authorised scope, plus cancelled
 *                           assignments and terminal-parent rows.
 *
 * `current_total` therefore NEVER contains a cancelled assignment. Cancelled is
 * reported as its own historical metric, never folded into workload.
 *
 * A review whose parent application is missing, deleted or outside the caller's
 * authorised scope is not rendered at all — the joined read fails closed on it
 * (`applications!inner`). It is never labelled "đã rút", because "not found"
 * and "withdrawn" are different operational facts.
 */

// ---------------------------------------------------------------------------
// Page size
// ---------------------------------------------------------------------------

/** Server-side page size for /reviews. Totals always describe the FULL filtered population. */
export const REVIEW_OVERSIGHT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Operational parent statuses
// ---------------------------------------------------------------------------

/**
 * The application statuses that still count as live recruitment work.
 *
 * This is a BOUNDED, OVERSIGHT-LOCAL mirror of the canonical predicate
 * `isApplicationRecruitmentOperational` in lib/application-review-assignability.ts.
 * It exists as an array because the oversight read must express the same rule as
 * a PostgREST `in.(...)` filter, and the canonical module deliberately exports
 * only the predicate. Rather than widen that module's public surface for one
 * consumer, the list is mirrored here and the Slice 1 test asserts the two agree
 * over the entire application-status universe, so a drift in either direction
 * fails the suite instead of silently changing what an operator sees.
 */
export const OVERSIGHT_OPERATIONAL_STATUSES: readonly string[] = Object.freeze([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "screening_passed",
  "invited_to_meeting",
  "invited_to_orientation",
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "interview_completed",
  "ready_for_final_decision",
  "interview_passed",
  "waitlisted",
  "needs_more_review",
  "needs_admin_review"
]);

const OVERSIGHT_OPERATIONAL_STATUS_SET = new Set<string>(OVERSIGHT_OPERATIONAL_STATUSES);

/**
 * Whether a parent application is still live recruitment work.
 *
 * Reads `applications.status` only — the same column the SQL filter constrains.
 * The legacy `final_status` column is NOT coalesced in here: every assignment
 * path gates on a non-null `status`, so a review row cannot exist under a
 * status-null parent, and coalescing in JS while the query filters on `status`
 * would reintroduce exactly the count/list drift this module exists to prevent.
 */
export function isOversightOperationalParent(status: unknown): boolean {
  return OVERSIGHT_OPERATIONAL_STATUS_SET.has(String(status ?? "").trim());
}

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

export type ReviewOversightScopeMode = "operational" | "all";

/** Applicant roles the oversight surfaces filter on. */
export const REVIEW_OVERSIGHT_ROLES: readonly string[] = Object.freeze(["mentee", "mentor"]);

/** Review rounds. Mirrors the application_reviews.review_round CHECK constraint. */
export const REVIEW_OVERSIGHT_ROUNDS: readonly string[] = Object.freeze([
  "profile_screening",
  "interview"
]);

/** Assignment statuses. Mirrors the application_reviews.status CHECK constraint. */
export const REVIEW_OVERSIGHT_STATUSES: readonly string[] = Object.freeze([
  "assigned",
  "in_progress",
  "returned_for_clarification",
  "submitted",
  "cancelled"
]);

/**
 * The URL sentinel for "assignments with no reviewer".
 *
 * `reviewer_admin_user_id IS NULL` is a real, countable bucket that Progress
 * aggregates and renders as "(Chưa gán)". It needs a value of its own because
 * the reviewer filter has THREE states, not two, and the absent parameter is
 * already spoken for by "every reviewer":
 *
 *   reviewer absent        -> no reviewer constraint
 *   reviewer=<uuid>        -> that reviewer
 *   reviewer=unassigned    -> reviewer_admin_user_id IS NULL
 *
 * Without it, clicking an unassigned count served a list of EVERY reviewer's
 * rows under the remaining filters — the count and its list disagreed, which is
 * the one invariant this module exists to hold.
 */
export const REVIEW_OVERSIGHT_UNASSIGNED = "unassigned";

/**
 * The three states of the reviewer filter. Empty string and `undefined` are not
 * among them: `null` is "no filter" and the sentinel is "no reviewer".
 */
export type ReviewOversightReviewerFilter = string | typeof REVIEW_OVERSIGHT_UNASSIGNED | null;

/** True when the filter selects the unassigned bucket rather than a person. */
export function isUnassignedReviewerFilter(
  reviewerId: ReviewOversightReviewerFilter
): reviewerId is typeof REVIEW_OVERSIGHT_UNASSIGNED {
  return reviewerId === REVIEW_OVERSIGHT_UNASSIGNED;
}

/**
 * The filter value that drills into one Progress row.
 *
 * A row keyed by a real reviewer filters by that id; the unassigned row filters
 * by the sentinel. Both surfaces call this rather than passing
 * `reviewer_admin_user_id` straight through, which is what dropped the
 * constraint for the unassigned bucket.
 */
export function reviewerFilterForRow(
  reviewerAdminUserId: string | null | undefined
): ReviewOversightReviewerFilter {
  return reviewerAdminUserId ?? REVIEW_OVERSIGHT_UNASSIGNED;
}

/**
 * THE canonical filter structure. Both oversight surfaces, every drill-down link
 * and every pagination link carry exactly these keys and no others.
 */
export type ReviewOversightFilters = {
  seasonId: string | null;
  intakeBatchId: string | null;
  roleApplied: string | null;
  /** `null` means every round. */
  reviewRound: string | null;
  /** A reviewer id, the unassigned sentinel, or `null` for every reviewer. */
  reviewerId: ReviewOversightReviewerFilter;
  reviewStatus: string | null;
  scopeMode: ReviewOversightScopeMode;
  /** 1-based. */
  page: number;
};

/** URL parameter names. `round` is NOT one of them — the key is `review_round`. */
export const REVIEW_OVERSIGHT_PARAMS = Object.freeze({
  seasonId: "season_id",
  intakeBatchId: "intake_batch_id",
  roleApplied: "role_applied",
  reviewRound: "review_round",
  reviewerId: "reviewer",
  reviewStatus: "review_status",
  scopeMode: "scope",
  page: "page"
} as const);

export type ReviewOversightSearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw ?? "").trim();
  return text || null;
}

function oneOf(value: string | null, allowed: readonly string[]): string | null {
  return value && allowed.includes(value) ? value : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiers reach the query as `.eq` values; anything not id-shaped is dropped. */
function identifier(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/**
 * The reviewer parameter, which accepts the unassigned sentinel in addition to
 * an id. Anything else degrades to "no reviewer filter" rather than reaching
 * the query.
 */
function reviewerFilter(value: string | null): ReviewOversightReviewerFilter {
  if (value === REVIEW_OVERSIGHT_UNASSIGNED) return REVIEW_OVERSIGHT_UNASSIGNED;
  return identifier(value);
}

/**
 * Parses the URL into the canonical filter structure.
 *
 * `defaultReviewRound` differs per surface by owner decision: /reviews defaults
 * to ALL rounds, /reviews/progress keeps its existing `profile_screening`
 * default so the screen an operator already knows does not change meaning.
 *
 * Unknown enum values are dropped rather than passed through, so a hand-edited
 * URL degrades to "no filter" instead of reaching the query.
 */
export function parseReviewOversightFilters(
  searchParams: ReviewOversightSearchParams | undefined,
  options?: { defaultReviewRound?: string | null }
): ReviewOversightFilters {
  const params = searchParams ?? {};
  const pageRaw = Number.parseInt(single(params[REVIEW_OVERSIGHT_PARAMS.page]) ?? "", 10);
  const requestedRound = single(params[REVIEW_OVERSIGHT_PARAMS.reviewRound]);

  return {
    seasonId: identifier(single(params[REVIEW_OVERSIGHT_PARAMS.seasonId])),
    intakeBatchId: identifier(single(params[REVIEW_OVERSIGHT_PARAMS.intakeBatchId])),
    roleApplied: oneOf(single(params[REVIEW_OVERSIGHT_PARAMS.roleApplied]), REVIEW_OVERSIGHT_ROLES),
    reviewRound: requestedRound
      ? oneOf(requestedRound, REVIEW_OVERSIGHT_ROUNDS)
      : options?.defaultReviewRound ?? null,
    reviewerId: reviewerFilter(single(params[REVIEW_OVERSIGHT_PARAMS.reviewerId])),
    reviewStatus: oneOf(
      single(params[REVIEW_OVERSIGHT_PARAMS.reviewStatus]),
      REVIEW_OVERSIGHT_STATUSES
    ),
    scopeMode: single(params[REVIEW_OVERSIGHT_PARAMS.scopeMode]) === "all" ? "all" : "operational",
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  };
}

/**
 * Serialises a filter set back to a query string.
 *
 * Every drill-down and pagination link is built from the ACTIVE filter object
 * plus explicit overrides, never from whatever the page happened to hold in a
 * local variable. That is what keeps `intake_batch_id` — and every other key —
 * attached across navigation.
 */
export function buildReviewOversightQuery(
  filters: ReviewOversightFilters,
  overrides: Partial<ReviewOversightFilters> = {}
): string {
  const merged: ReviewOversightFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.seasonId) params.set(REVIEW_OVERSIGHT_PARAMS.seasonId, merged.seasonId);
  if (merged.intakeBatchId) params.set(REVIEW_OVERSIGHT_PARAMS.intakeBatchId, merged.intakeBatchId);
  if (merged.roleApplied) params.set(REVIEW_OVERSIGHT_PARAMS.roleApplied, merged.roleApplied);
  if (merged.reviewRound) params.set(REVIEW_OVERSIGHT_PARAMS.reviewRound, merged.reviewRound);
  if (merged.reviewerId) params.set(REVIEW_OVERSIGHT_PARAMS.reviewerId, merged.reviewerId);
  if (merged.reviewStatus) params.set(REVIEW_OVERSIGHT_PARAMS.reviewStatus, merged.reviewStatus);
  if (merged.scopeMode === "all") params.set(REVIEW_OVERSIGHT_PARAMS.scopeMode, "all");
  if (merged.page > 1) params.set(REVIEW_OVERSIGHT_PARAMS.page, String(merged.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** A link carrying the active filter context plus explicit overrides. */
export function buildReviewOversightHref(
  path: string,
  filters: ReviewOversightFilters,
  overrides: Partial<ReviewOversightFilters> = {}
): string {
  return `${path}${buildReviewOversightQuery(filters, overrides)}`;
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/**
 * The reported buckets. These are the Production buckets, not new ones:
 * `returned_for_clarification` is broken out under its own explicit label rather
 * than folded into "chưa bắt đầu", because it is work that came BACK to the
 * assignee and an operator reading "chưa bắt đầu" would act on it wrongly. It
 * remains part of current workload.
 */
export type ReviewOversightBucket =
  | "submitted"
  | "in_progress"
  | "pending"
  | "returned"
  | "cancelled";

export function reviewOversightBucket(status: unknown): ReviewOversightBucket | null {
  const value = String(status ?? "").trim();
  if (value === "submitted") return "submitted";
  if (value === "in_progress") return "in_progress";
  if (value === "assigned") return "pending";
  if (value === "returned_for_clarification") return "returned";
  if (value === "cancelled") return "cancelled";
  return null;
}

/** Cancelled is history, never workload. */
export function isCurrentWorkloadStatus(status: unknown): boolean {
  const bucket = reviewOversightBucket(status);
  return bucket !== null && bucket !== "cancelled";
}

/** The `review_status` value a progress count cell drills down to. */
export const BUCKET_DRILLDOWN_STATUS: Readonly<Record<ReviewOversightBucket, string>> =
  Object.freeze({
    submitted: "submitted",
    in_progress: "in_progress",
    pending: "assigned",
    returned: "returned_for_clarification",
    cancelled: "cancelled"
  });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * THE reviewer/interviewer display rule.
 *
 *   no assignee            -> "(Chưa gán)"   (the only place this string is used)
 *   admin_users.full_name  -> full name
 *   admin_users.email      -> email
 *   row unresolvable       -> traceable placeholder carrying the short id
 *
 * `people` is deliberately not consulted. `admin_users` is the assignment
 * authority; an account with a known email is never rendered as unassigned.
 */
export function reviewerIdentityLabel(
  reviewerAdminUserId: string | null | undefined,
  fullName: string | null | undefined,
  email: string | null | undefined
): string {
  if (!reviewerAdminUserId) return "(Chưa gán)";
  const name = String(fullName ?? "").trim();
  if (name) return name;
  const address = String(email ?? "").trim();
  if (address) return address;
  return `Reviewer không xác định (${String(reviewerAdminUserId).slice(0, 8)})`;
}

/** True only for the unassigned sentinel, so the UI can suppress a reviewer link. */
export function isUnassignedReviewer(reviewerAdminUserId: string | null | undefined): boolean {
  return !reviewerAdminUserId;
}

// ---------------------------------------------------------------------------
// Actionability
// ---------------------------------------------------------------------------

export type ReviewOversightActionability = {
  /** true -> "Làm review"; false -> "Xem" and nothing else. */
  actionable: boolean;
  /** Why it is read-only, for the row badge. */
  readOnlyReason: "none" | "cancelled" | "submitted" | "terminal_parent";
};

/**
 * A row is actionable only when the assignment is live AND the parent is still
 * recruitment work. Cancelled is never actionable — not in either scope mode,
 * not for any role — and neither is anything hanging off a terminal parent.
 */
export function reviewOversightActionability(input: {
  reviewStatus: unknown;
  parentStatus: unknown;
}): ReviewOversightActionability {
  const status = String(input.reviewStatus ?? "").trim();
  if (status === "cancelled") return { actionable: false, readOnlyReason: "cancelled" };
  if (status === "submitted") return { actionable: false, readOnlyReason: "submitted" };
  if (!isOversightOperationalParent(input.parentStatus)) {
    return { actionable: false, readOnlyReason: "terminal_parent" };
  }
  return { actionable: true, readOnlyReason: "none" };
}
