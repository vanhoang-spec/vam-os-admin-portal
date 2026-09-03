import "server-only";

/**
 * Shared filter contract and decision derivation for the two operational
 * recruitment exports (/api/exports/recruitment-results and
 * /api/exports/review-scores).
 *
 * ---------------------------------------------------------------------------
 * WHY A SHARED MODULE
 * ---------------------------------------------------------------------------
 * Both routes must answer the same operational questions ("which Mentors
 * passed screening?", "who passed interview?") over the same canonical data,
 * and both must fail the same way on a bad filter. Duplicating the parsing
 * would let the two routes drift into disagreeing about what `role_applied=
 * mentor` means, which is exactly the ambiguity this slice exists to remove.
 *
 * ---------------------------------------------------------------------------
 * FILTER CONTRACT (one consistent rule, both routes)
 * ---------------------------------------------------------------------------
 *   * An ABSENT parameter means "no constraint".
 *   * A PRESENT parameter with a value outside its documented domain is a
 *     hard 400. It is never ignored and never silently widened — a Core Team
 *     member who mistypes `role_applied=mentors` must not receive a file
 *     silently containing Mentees as well, because a wrong export that looks
 *     right is worse than no export.
 *   * An unrecognised parameter NAME is ignored (documented, so adding a
 *     parameter later is not a breaking change for saved URLs).
 */

/** Canonical application statuses — mirrors applications_status_check. */
export const APPLICATION_STATUSES = [
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
  "approved_as_mentor",
  "approved_as_mentee",
  "waitlisted",
  "rejected_or_not_fit",
  "needs_more_review",
  "needs_admin_review",
  "withdrawn"
] as const;

export const ROLE_VALUES = ["mentor", "mentee"] as const;
export const REVIEW_ROUNDS = ["profile_screening", "interview"] as const;
export const REVIEW_STATUSES = ["assigned", "in_progress", "submitted", "cancelled"] as const;
export const STAGE_VALUES = ["screening", "interview", "final"] as const;

export type Stage = (typeof STAGE_VALUES)[number];

/**
 * Which stage an application sits in once it HOLDS a given status.
 *
 * `screening_passed` maps to "interview" because holding it means screening
 * is finished and the interview stage has begun — as a *decision outcome* it
 * is still attributed to screening, which `deriveDecisions` handles explicitly.
 *
 * The four statuses deliberately absent are stage-NEUTRAL: waitlisted,
 * rejected_or_not_fit, needs_more_review and withdrawn can each occur in any
 * stage, so the stage they belong to is only knowable from the decision
 * history, never from the status alone.
 */
const STAGE_BY_STATUS: Partial<Record<string, Stage>> = {
  submitted: "screening",
  under_data_check: "screening",
  ready_for_screening: "screening",
  screening_assigned: "screening",
  screening_in_progress: "screening",
  screening_completed: "screening",
  needs_admin_review: "screening",
  screening_passed: "interview",
  invited_to_meeting: "interview",
  invited_to_orientation: "interview",
  invited_to_interview: "interview",
  interview_scheduled: "interview",
  interview_in_progress: "interview",
  interview_completed: "interview",
  ready_for_final_decision: "interview",
  interview_passed: "final",
  approved_as_mentor: "final",
  approved_as_mentee: "final"
};

/** Outcomes that can terminate or pause ANY stage; attributed to the stage in progress. */
const NEUTRAL_OUTCOMES = new Set(["waitlisted", "rejected_or_not_fit", "needs_more_review", "withdrawn"]);

const FINAL_APPROVALS = new Set(["approved_as_mentor", "approved_as_mentee"]);

export type DecisionRow = {
  new_status?: unknown;
  decision?: unknown;
  previous_status?: unknown;
  created_at?: unknown;
};

export type StageDecision = { status: string; at: string } | null;

export type DerivedDecisions = {
  screening: StageDecision;
  interview: StageDecision;
  final: StageDecision;
  /** Stage the application had reached according to its decision history. */
  reachedStage: Stage;
};

/**
 * Reconstructs per-stage outcomes by replaying the decision audit trail in
 * chronological order.
 *
 * A single `new_status` is not enough to attribute a decision to a stage:
 * `rejected_or_not_fit` is a valid screening outcome AND a valid interview
 * outcome, and `needs_more_review` occurs in both. Replaying the trail and
 * tracking the stage in progress at the moment of each decision resolves that
 * without inventing any state the database does not already record.
 *
 * An application with no decision rows yields all-null outcomes: the export
 * then reports its `current_status` and leaves the decision columns empty,
 * rather than back-filling an outcome that was never recorded.
 */
export function deriveDecisions(rows: readonly DecisionRow[]): DerivedDecisions {
  const ordered = [...rows]
    .map((row) => ({
      status: String(row.new_status ?? row.decision ?? "").trim(),
      at: String(row.created_at ?? "")
    }))
    .filter((row) => row.status)
    .sort((a, b) => {
      const left = Date.parse(a.at);
      const right = Date.parse(b.at);
      if (Number.isNaN(left) || Number.isNaN(right)) return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
      return left - right;
    });

  const out: DerivedDecisions = { screening: null, interview: null, final: null, reachedStage: "screening" };
  let stage: Stage = "screening";

  for (const row of ordered) {
    if (row.status === "screening_passed") {
      out.screening = { status: row.status, at: row.at };
      stage = "interview";
      continue;
    }
    if (row.status === "interview_passed") {
      out.interview = { status: row.status, at: row.at };
      stage = "final";
      continue;
    }
    if (FINAL_APPROVALS.has(row.status)) {
      out.final = { status: row.status, at: row.at };
      stage = "final";
      continue;
    }
    if (NEUTRAL_OUTCOMES.has(row.status)) {
      out[stage] = { status: row.status, at: row.at };
      continue;
    }
    // Plain progression (invited_to_interview, interview_scheduled, ...):
    // it advances the stage but is not itself a stage outcome.
    const target = STAGE_BY_STATUS[row.status];
    if (target && STAGE_VALUES.indexOf(target) > STAGE_VALUES.indexOf(stage)) stage = target;
  }

  out.reachedStage = stage;
  return out;
}

/**
 * Stage an application is in now. Prefers the status when the status alone
 * determines it; falls back to the replayed decision history for the four
 * stage-neutral statuses.
 */
export function currentStage(status: unknown, derived: DerivedDecisions): Stage {
  return STAGE_BY_STATUS[String(status ?? "").trim()] ?? derived.reachedStage;
}

// ── Filter parsing ───────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID parameter. Absent → null. Present but malformed → 400. */
export function parseUuid(params: URLSearchParams, name: string): ParseResult<string | null> {
  const raw = params.get(name);
  if (raw === null) return { ok: true, value: null };
  const value = raw.trim();
  if (!UUID_RE.test(value)) return { ok: false, message: `Invalid ${name}: expected a UUID.` };
  return { ok: true, value };
}

/** A single-valued enum parameter. Absent → null. Outside the domain → 400. */
export function parseEnum<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[]
): ParseResult<T | null> {
  const raw = params.get(name);
  if (raw === null) return { ok: true, value: null };
  const value = raw.trim().toLowerCase() as T;
  if (!allowed.includes(value)) {
    return { ok: false, message: `Invalid ${name}: expected one of ${allowed.join(", ")}.` };
  }
  return { ok: true, value };
}

/**
 * A comma-separated enum list. Absent → null (no constraint). Empty string or
 * any member outside the domain → 400; an empty list is rejected rather than
 * treated as "everything", so `?status=` cannot silently widen the export.
 */
export function parseEnumList<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[]
): ParseResult<T[] | null> {
  const raw = params.get(name);
  if (raw === null) return { ok: true, value: null };
  const values = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean) as T[];
  if (!values.length) return { ok: false, message: `Invalid ${name}: expected a non-empty comma-separated list.` };
  const unknown = values.filter((value) => !allowed.includes(value));
  if (unknown.length) {
    return { ok: false, message: `Invalid ${name}: ${unknown.join(", ")}. Expected any of ${allowed.join(", ")}.` };
  }
  return { ok: true, value: Array.from(new Set(values)) };
}

// ── Current-state operational classification ─────────────────────────────────
//
// The audit fields above are exact evidence, but Owner UAT on real Staging data
// showed the trail is incomplete for older/UAT flows: of 16 finally-approved
// applications, 11 had no screening decision row and all 16 had no interview
// decision row. So `screening_decision=passed` answers "who has an audit row
// proving they passed screening", NOT "who operationally passed screening".
// Those are different questions and Core Team needs both.
//
// The operational answer is derived ONLY where the canonical lifecycle PROVES
// the state is unreachable otherwise. Two facts in the deployed model carry
// that proof (supabase/migrations/20260830070430, sections 4 and 8):
//
//   1. vam084_recompute_application_review_status guards its two branches on
//      DISJOINT status sets. The interview branch only ever fires when the
//      application already holds one of
//      {invited_to_interview, interview_scheduled, interview_in_progress,
//       interview_completed, ready_for_final_decision, needs_more_review}.
//      Nothing else can produce ready_for_final_decision or
//      interview_in_progress.
//   2. vam084_application_decision_eligibility gates invited_to_interview on
//      status = 'screening_passed' AND the profile-review minimum, and gates
//      interview_passed / approved_as_* behind the interview minimum.
//
// Therefore every interview-set status except needs_more_review is reachable
// only by having passed screening first. needs_more_review is deliberately
// excluded: it is the one status that appears in BOTH recompute guards, so it
// proves nothing on its own.
//
// invited_to_meeting and invited_to_orientation are also excluded. They exist
// in applications_status_check and have display labels, but no code path, RPC
// or transition in this repository ever sets them — the state machine does not
// prove how they are reached, so nothing is inferred from them.

/** Statuses unreachable without screening having been passed. */
export const PROVES_SCREENING_PASSED: ReadonlySet<string> = new Set([
  "screening_passed",
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "interview_completed",
  "ready_for_final_decision",
  "interview_passed",
  "approved_as_mentor",
  "approved_as_mentee"
]);

/**
 * Statuses unreachable without the interview having been passed.
 * ready_for_final_decision is NOT here: it means the interview reviews are in,
 * not that the pass decision was made.
 */
export const PROVES_INTERVIEW_PASSED: ReadonlySet<string> = new Set([
  "interview_passed",
  "approved_as_mentor",
  "approved_as_mentee"
]);

export const PROVES_OFFICIAL_APPROVAL: ReadonlySet<string> = new Set([
  "approved_as_mentor",
  "approved_as_mentee"
]);

const REJECTED_STATUSES: ReadonlySet<string> = new Set(["rejected_or_not_fit", "withdrawn"]);

/** How the operational columns on a row were evidenced. */
export type EvidenceBasis = "" | "audit" | "current_status" | "audit+current_status";

export type OperationalClassification = {
  passedScreening: boolean;
  passedInterview: boolean;
  officiallyApproved: boolean;
  rejected: boolean;
  needsMoreReview: boolean;
  basis: EvidenceBasis;
};

/**
 * Current-state operational grouping. Never mutates or backfills the audit
 * fields — the two live side by side in the export so a blank audit column and
 * a positive operational column together tell Core Team exactly what is known
 * and how.
 */
export function classifyOperational(status: unknown, derived: DerivedDecisions): OperationalClassification {
  const value = String(status ?? "").trim();

  const statusScreening = PROVES_SCREENING_PASSED.has(value);
  const statusInterview = PROVES_INTERVIEW_PASSED.has(value);
  const statusApproved = PROVES_OFFICIAL_APPROVAL.has(value);
  const rejected = REJECTED_STATUSES.has(value);
  const needsMoreReview = value === "needs_more_review";

  const auditScreening = derived.screening?.status === "screening_passed";
  const auditInterview = derived.interview?.status === "interview_passed";
  const auditApproved = Boolean(derived.final && PROVES_OFFICIAL_APPROVAL.has(derived.final.status));
  const auditRejected =
    classifyOutcome(derived.screening) === "rejected" ||
    classifyOutcome(derived.interview) === "rejected" ||
    classifyOutcome(derived.final) === "rejected";

  const auditSupport = auditScreening || auditInterview || auditApproved || auditRejected;
  const statusSupport = statusScreening || statusInterview || statusApproved || rejected || needsMoreReview;

  const basis: EvidenceBasis =
    auditSupport && statusSupport
      ? "audit+current_status"
      : auditSupport
        ? "audit"
        : statusSupport
          ? "current_status"
          : "";

  return {
    passedScreening: statusScreening || auditScreening,
    passedInterview: statusInterview || auditInterview,
    officiallyApproved: statusApproved || auditApproved,
    rejected: rejected || auditRejected,
    needsMoreReview,
    basis
  };
}

/** Operational grouping offered to Core Team in the export UI. */
export const OPERATIONAL_GROUPS = [
  "passed_screening",
  "passed_interview",
  "approved",
  "rejected",
  "needs_more_review"
] as const;
export type OperationalGroup = (typeof OPERATIONAL_GROUPS)[number];

export function matchesOperationalGroup(group: OperationalGroup, classification: OperationalClassification): boolean {
  switch (group) {
    case "passed_screening":
      return classification.passedScreening;
    case "passed_interview":
      return classification.passedInterview;
    case "approved":
      return classification.officiallyApproved;
    case "rejected":
      return classification.rejected;
    case "needs_more_review":
      return classification.needsMoreReview;
  }
}

/** Per-stage outcome filter domain. */
export const DECISION_OUTCOMES = ["passed", "rejected", "waitlisted", "needs_more_review", "pending"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/** Classifies a recorded stage outcome into the filterable outcome domain. */
export function classifyOutcome(decision: StageDecision): DecisionOutcome {
  if (!decision) return "pending";
  const status = decision.status;
  if (status === "screening_passed" || status === "interview_passed" || FINAL_APPROVALS.has(status)) return "passed";
  if (status === "rejected_or_not_fit" || status === "withdrawn") return "rejected";
  if (status === "waitlisted") return "waitlisted";
  if (status === "needs_more_review") return "needs_more_review";
  return "pending";
}
