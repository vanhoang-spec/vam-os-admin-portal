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