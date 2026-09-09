type AdminLike = {
  role?: string | null;
} | null | undefined;

export function canAccessAdminUser(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

export function canManageUsers(role?: string | null) {
  return role === "super_admin";
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
 * Can OPEN or CLOSE a public application form (M069).
 *
 * Deliberately narrower than every other admin-tier permission in this file.
 * Changing this state changes what the public internet can do: opening the
 * mentor form publishes a live intake to anyone with the link, and closing it
 * mid-recruitment silently drops applicants who are part-way through.
 *
 * core_team is NOT granted. It holds `canDecide` and `canManageMatches`, but
 * those act on records already inside the system; none of them is an
 * externally-visible publication event, so neither is evidence that core_team
 * was ever intended to control public recruitment. No existing permission
 * safely maps to this action, so core_team stays read-only here until the
 * owner decides otherwise. reviewer, support_team and viewer are excluded for
 * the same reason.
 *
 * This is only the global-role half of the check. The caller must ALSO prove
 * season scope via `canOperateSeason` — a scoped admin with no UEHM-S12 grant
 * must not be able to toggle UEHM-S12.
 */
export function canToggleApplicationForm(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/** Can view the season/form control screen without being able to change it. */
export function canViewApplicationFormControls(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can browse general admin-tier operational surfaces: /operations,
 * /operations/tasks, /matches/[id].
 *
 * H2 fix: these routes previously gated only on season *scope* (e.g.
 * canReadSeason, which is true for any scope level including "review"),
 * never on global role. A reviewer holding a valid season review grant
 * could therefore reach operational dashboards and match detail pages
 * that have nothing to do with reviewing applications. reviewer is
 * deliberately excluded here even though it is included in canReview —
 * this predicate answers a different question (general operations
 * browsing) than review-workflow access.
 */
export function canBrowseOperations(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/** Can read the outbound email log without being able to send anything. */
export function canViewOutboundEmails(role?: string | null) {
  return ["super_admin", "admin", "core_team"].includes(role || "");
}

/**
 * Can send the confirmation-email backfill to applicants who applied before the
 * email layer existed.
 *
 * As narrow as `canToggleApplicationForm`, and for the same reason: pressing
 * this writes to people outside the system. A mistake here is not a wrong row
 * that can be corrected — it is mail already in somebody's inbox, and a second
 * press is a second letter to the same applicant. core_team is excluded on the
 * same argument used there: nothing it already holds is an outward-facing
 * publication event, so nothing maps to this.
 *
 * This is only the global-role half. The caller must ALSO prove season scope
 * via `canOperateSeason`.
 */
export function canRunConfirmationBackfill(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}

/**
 * Can write and edit a DRAFT bulk-email template.
 *
 * Deliberately wider than `canViewOutboundEmails`: support_team is the group
 * that actually writes to participants, and the whole point of the Mail module
 * is that they stop filing a ticket to get a sentence changed. Writing a draft
 * sends nothing — the draft sits in the app until somebody who can approve it
 * reads it.
 */
export function canComposeEmailTemplate(role?: string | null) {
  return ["super_admin", "admin", "core_team", "support_team"].includes(role || "");
}

/**
 * Can approve a template, which is what makes it eligible for a bulk send.
 *
 * As narrow as `canRunConfirmationBackfill`, and for the same reason: approval
 * is the last human read before mail reaches hundreds of inboxes, and a mistake
 * is not a wrong row that can be corrected — it is mail already delivered.
 *
 * Editing an approved template drops it back to draft, so this predicate is the
 * only way text reaches a recipient: nobody can send words an approver did not
 * read.
 */
export function canApproveEmailTemplate(role?: string | null) {
  return ["super_admin", "admin"].includes(role || "");
}
