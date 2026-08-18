/**
 * lib/selection-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure ranking logic for a selection run: order the scored applications, cut
 * the list at the number of mentee places that exist, and mark a reserve group
 * behind the cut. No Supabase, no cookies — the I/O wrapper is lib/selection.ts.
 *
 * Two rules make the result defensible to an applicant who asks why:
 *   1. Nobody is separated from an equal score. Where the cut would split a
 *      group of applications on identical scores, the whole group moves down
 *      into the reserve rather than some of them being invited and the rest not.
 *   2. Every tie is broken by a stated rule, not by row order: more reviews
 *      first (a score from three reviewers is worth more than one from a single
 *      reviewer), then the earlier submission, then the application id so the
 *      run is reproducible.
 */

export type SelectionGroup = "main" | "reserve" | "below";

export type SelectionCandidate = {
  applicationId: string;
  /** Sum or average of submitted screening scores; null when nothing is scored. */
  totalScore: number | null;
  /** How many submitted screening reviews produced that score. */
  reviewCount: number;
  /** ISO date; earlier submissions win a tie. */
  submittedAt: string | null;
};

export type RankedCandidate = SelectionCandidate & {
  rank: number;
  group: SelectionGroup;
  /** Set when this row shares a score with its neighbours at the cut. */
  tieBreakNote: string | null;
};

export type SelectionPlan = {
  ranked: RankedCandidate[];
  capacityTotal: number;
  reservePct: number;
  mainCount: number;
  reserveCount: number;
  scoredCount: number;
  unscoredCount: number;
  /** True when the ranked list is shorter than the places available. */
  underSubscribed: boolean;
};

export const DEFAULT_RESERVE_PCT = 10;

/** Applications with no submitted score cannot be ranked; they are reported separately. */
export function partitionScored(candidates: SelectionCandidate[]) {
  const scored: SelectionCandidate[] = [];
  const unscored: SelectionCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.totalScore === null || candidate.totalScore === undefined || candidate.reviewCount <= 0) {
      unscored.push(candidate);
    } else {
      scored.push(candidate);
    }
  }
  return { scored, unscored };
}

/**
 * Deterministic ordering: score desc, review count desc, submitted asc, id asc.
 * The last key guarantees the same run computed twice produces the same list.
 */
export function compareCandidates(a: SelectionCandidate, b: SelectionCandidate): number {
  const scoreA = a.totalScore ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.totalScore ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;

  if (a.reviewCount !== b.reviewCount) return b.reviewCount - a.reviewCount;

  const dateA = a.submittedAt ? Date.parse(a.submittedAt) : Number.POSITIVE_INFINITY;
  const dateB = b.submittedAt ? Date.parse(b.submittedAt) : Number.POSITIVE_INFINITY;
  const validA = Number.isNaN(dateA) ? Number.POSITIVE_INFINITY : dateA;
  const validB = Number.isNaN(dateB) ? Number.POSITIVE_INFINITY : dateB;
  if (validA !== validB) return validA - validB;

  return a.applicationId.localeCompare(b.applicationId);
}

/** Reserve size: `reservePct` of capacity, rounded up, at least 1 when capacity > 0. */
export function reserveSize(capacityTotal: number, reservePct = DEFAULT_RESERVE_PCT): number {
  if (capacityTotal <= 0) return 0;
  if (reservePct <= 0) return 0;
  return Math.max(1, Math.ceil((capacityTotal * reservePct) / 100));
}

/**
 * Move a boundary down so it never splits a group of equal scores.
 * Returns the index of the first candidate NOT included.
 */
function boundaryWithoutSplittingTies(sorted: SelectionCandidate[], desired: number): number {
  if (desired <= 0) return 0;
  if (desired >= sorted.length) return sorted.length;

  const boundaryScore = sorted[desired - 1]?.totalScore ?? null;
  const nextScore = sorted[desired]?.totalScore ?? null;
  if (boundaryScore === null || nextScore === null || boundaryScore !== nextScore) return desired;

  // The cut falls inside a group on the same score: extend past the whole group.
  let index = desired;
  while (index < sorted.length && (sorted[index]?.totalScore ?? null) === boundaryScore) index += 1;
  return index;
}

/**
 * Build the ranking for one run.
 *
 * `capacityTotal` is the number of mentee places: the sum of the capacities
 * mentors confirmed for the season. The main group takes those places; the
 * reserve group sits immediately behind it.
 */
export function buildSelectionPlan(input: {
  candidates: SelectionCandidate[];
  capacityTotal: number;
  reservePct?: number;
}): SelectionPlan {
  const reservePct = input.reservePct ?? DEFAULT_RESERVE_PCT;
  const capacityTotal = Math.max(0, Math.floor(input.capacityTotal));

  const { scored, unscored } = partitionScored(input.candidates);
  const sorted = [...scored].sort(compareCandidates);

  // Main group: capacity places, never splitting a tie.
  const desiredMainEnd = Math.min(capacityTotal, sorted.length);
  const mainEnd = boundaryWithoutSplittingTies(sorted, desiredMainEnd);

  // Reserve group: the next slice, again never splitting a tie.
  const desiredReserveEnd = Math.min(mainEnd + reserveSize(capacityTotal, reservePct), sorted.length);
  const reserveEnd = boundaryWithoutSplittingTies(sorted, desiredReserveEnd);

  const ranked: RankedCandidate[] = sorted.map((candidate, index) => {
    const group: SelectionGroup = index < mainEnd ? "main" : index < reserveEnd ? "reserve" : "below";

    // Mark the rows that are only in their group because the boundary was moved
    // to avoid separating equal scores. The organisers need to be able to point
    // at these and say why the list is longer than the number of places.
    let tieBreakNote: string | null = null;
    if (index >= desiredMainEnd && index < mainEnd) {
      tieBreakNote = "Đồng điểm với hồ sơ cuối danh sách chính — được giữ lại thay vì cắt ngang nhóm";
    } else if (index >= desiredReserveEnd && index < reserveEnd) {
      tieBreakNote = "Đồng điểm với hồ sơ cuối nhóm dự phòng — được giữ lại thay vì cắt ngang nhóm";
    }

    return {
      ...candidate,
      rank: index + 1,
      group,
      tieBreakNote
    };
  });

  const mainCount = ranked.filter((row) => row.group === "main").length;
  const reserveCount = ranked.filter((row) => row.group === "reserve").length;

  return {
    ranked,
    capacityTotal,
    reservePct,
    mainCount,
    reserveCount,
    scoredCount: scored.length,
    unscoredCount: unscored.length,
    underSubscribed: sorted.length < capacityTotal
  };
}

/** Status an application moves to when a run is applied. */
export function statusForGroup(group: SelectionGroup): string | null {
  if (group === "main") return "invited_to_interview";
  if (group === "reserve") return "waitlisted";
  // `below` is deliberately left alone: not selected is a decision the
  // organisers make explicitly, not a side effect of ranking.
  return null;
}

export type SelectionSummary = {
  capacityTotal: number;
  mainCount: number;
  reserveCount: number;
  belowCount: number;
  scoredCount: number;
  unscoredCount: number;
  canApply: boolean;
  blockReason: string | null;
};

/**
 * What the operator is shown before applying, and whether applying is allowed.
 *
 * A run cannot be applied while applications are still unscored: the ranking
 * would be built on a partial picture and would invite the wrong people.
 */
export function summarizePlan(plan: SelectionPlan): SelectionSummary {
  const belowCount = plan.ranked.length - plan.mainCount - plan.reserveCount;

  let blockReason: string | null = null;
  if (plan.unscoredCount > 0) {
    blockReason = `Còn ${plan.unscoredCount} hồ sơ chưa có điểm chấm. Hoàn tất chấm trước khi chốt danh sách.`;
  } else if (plan.scoredCount === 0) {
    blockReason = "Chưa có hồ sơ nào được chấm.";
  } else if (plan.capacityTotal === 0) {
    blockReason = "Chưa có mentor nào xác nhận nhận mentee, nên chưa xác định được số suất.";
  }

  return {
    capacityTotal: plan.capacityTotal,
    mainCount: plan.mainCount,
    reserveCount: plan.reserveCount,
    belowCount,
    scoredCount: plan.scoredCount,
    unscoredCount: plan.unscoredCount,
    canApply: blockReason === null,
    blockReason
  };
}
