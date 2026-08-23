type AdminLike = {
  role?: string | null;
} | null | undefined;

export function canAccessAdminUser(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

export function canManageUsers(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

export function canEditRecap(adminUser: AdminLike) {
  return ["super_admin", "admin", "core_team"].includes(adminUser?.role || "");
}

/** Can assign review tasks to reviewers and see all reviews. */
export function canAssignReview(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can access /reviews and submit scoring.
 * Includes reviewer role in addition to admin tiers.
 */
export function canReview(role?: string | null) {
  return ["super_admin", "admin", "core_team", "reviewer"].includes(role || "");
}

/** True only for pure reviewer role — used to scope list to own assignments. */
export function isReviewerOnly(role?: string | null) {
  return role === "reviewer";
}

/**
 * Can make and record an application decision (status transition + audit row).
 * Intentionally excludes reviewer, support_team, and viewer.
 */
export function canDecide(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can bulk-assign applications to reviewers.
 * Same role set as canAssignReview — reviewer role cannot bulk-assign.
 */
export function canBulkAssignReviews(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can enable a mentor as a reviewer (create/upgrade their admin_users row).
 * Same role set as canBulkAssignReviews — separate name for semantic clarity.
 */
export function canManageReviewers(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can self-claim an interview review from /interviews.
 * Includes reviewer role in addition to all admin tiers.
 * Viewer and support_team cannot self-claim.
 */
export function canSelfClaimInterview(role?: string | null) {
  return ["super_admin", "admin", "core_team", "reviewer"].includes(role || "");
}

/**
 * Can create, view, and cancel mentor–mentee matches.
 * Reviewer role is excluded — only core_team and above.
 * Phase 046A: manual matching foundation.
 */
export function canManageMatches(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can record a mentor's season confirmation (continue yes/no + max mentees)
 * on the mentor's behalf, after reaching them by phone.
 *
 * This is the ONE predicate that includes support_team: chasing the mentors who
 * did not answer the emailed link is exactly their job, and the write is narrow
 * — a decision plus a number on a single season row, always paired with
 * `canOperateSeason` in lib/mentor-confirmations.ts.
 *
 * Reviewer is excluded: a mentor acting as a reviewer must not be able to set
 * another mentor's capacity.
 */
export function canRecordMentorConfirmation(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can write the program documents (code of conduct, tips) and the bodies of
 * the post-matching emails, and send those emails to a cohort.
 *
 * Core team and above. Support team is deliberately excluded: their one write
 * capability stays the mentor confirmation above. Publishing a document puts
 * text on a public page and mailing a batch reaches hundreds of students —
 * neither is a phone-call task.
 */
export function canManageProgramDocuments(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can triage a mentee's cross-mentoring wish: approve or reject it, run the
 * invitation sweep, and choose which mentor takes the session.
 *
 * Support team is included, and that is a deliberate widening of the one write
 * capability they have had until now. The reasoning is the same as the one
 * beside canRecordMentorConfirmation: this is coordination — reading a request,
 * deciding it is sensible, chasing the mentors who replied. What it is not is
 * the moment anything reaches the public, which is the next predicate.
 */
export function canTriageCrossRequest(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can fix the time and place, create the event, and approve the post that
 * announces it.
 *
 * Core team and above, for the same reason canManageProgramDocuments excludes
 * support team: this step creates a publicly registerable event and sends two
 * letters that tell mentors they were or were not chosen. Neither is a
 * phone-call task, and neither can be taken back.
 */
export function canPublishCrossSession(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can read the content calendar: the month's theme, the week's slots, what is
 * written and what is still waiting on somebody.
 *
 * Wider than the write predicate on purpose. A calendar nobody outside the
 * marketing pair can see is a calendar people ask about in chat, which is the
 * problem this module exists to end.
 */
export function canViewMktPlan(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team", "viewer"].includes(role || "");
}

/**
 * Can plan, write, edit, approve a post and record that it went out.
 *
 * Support team is included deliberately, and this is the owner's instruction
 * rather than an inference: each programme's support team approves and posts to
 * that programme's own fanpage, and decides whether the programme runs TikTok
 * at all.
 *
 * It sits differently from canPublishCrossSession, which excludes them, and the
 * difference is real: nothing in this module reaches the outside world. There
 * is no auto-post. A post reaches `approved`, and a person opens Facebook and
 * publishes it. What the application records is that a human did so.
 */
export function canManageMktPlan(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}
