/**
 * Shared constants for S12 bounded bulk screening.
 *
 * These live outside the `"use server"` action module on purpose: a Next.js
 * server-action file may export ONLY async functions, so exporting the role
 * list or the batch cap from there would break the build. The repo-wide
 * use-server export contract test enforces that rule.
 */

export const BULK_SCREENING_ROLES = ["mentor", "mentee"] as const;
export type BulkScreeningRole = (typeof BULK_SCREENING_ROLES)[number];

/** Hard cap on one bulk screening submission. The server action is authoritative. */
export const BULK_SCREENING_MAX = 25;

export const BULK_SCREENING_QUEUE_PATH: Record<BulkScreeningRole, string> = {
  mentor: "/applications/mentor-review",
  mentee: "/applications/mentee-review"
};

export const BULK_SCREENING_ROLE_LABEL: Record<BulkScreeningRole, string> = {
  mentor: "Mentor",
  mentee: "Mentee"
};
