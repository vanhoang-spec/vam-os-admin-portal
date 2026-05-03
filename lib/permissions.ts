/**
 * VAM OS centralized permission system.
 *
 * Six roles are defined at the type level. The DB CHECK constraint on
 * `admin_users.role` (migration 017) currently allows only the four
 * historical values: viewer, reviewer, admin, super_admin. The two
 * additional roles (`support_team`, `core_team`) are defined here so
 * permission helpers, gating code, and UI labels are ready when a future
 * migration loosens the constraint. Until then, no admin_user can
 * actually be assigned `support_team` or `core_team`, and the helpers
 * for those branches stay dormant — they do not weaken existing
 * production behavior.
 *
 * Permission matrix (final):
 *
 * | Action          | viewer | reviewer | support_team | core_team | admin | super_admin |
 * | --------------- | :----: | :------: | :----------: | :-------: | :---: | :---------: |
 * | View data       |   ✔    |    ✔     |      ✔       |     ✔     |   ✔   |      ✔      |
 * | Edit mentee     |        |          |      ✔       |     ✔     |   ✔   |      ✔      |
 * | Edit mentor     |        |          |              |     ✔     |   ✔   |      ✔      |
 * | Create match    |        |    ✔     |      ✔       |     ✔     |   ✔   |      ✔      |
 * | Edit recap      |        |    ✔     |      ✔       |     ✔     |   ✔   |      ✔      |
 * | Admin workflow  |        |          |              |     ✔     |   ✔   |      ✔      |
 * | Manage users    |        |          |              |           |   ✔   |      ✔      |
 *
 * This module is the single source of truth — call sites should use these
 * helpers rather than comparing roles inline.
 */

import type { CurrentAdminUser } from "@/lib/auth-constants";

export const ALL_ADMIN_ROLES = [
  "viewer",
  "reviewer",
  "support_team",
  "core_team",
  "admin",
  "super_admin"
] as const;

export type AdminRoleAll = (typeof ALL_ADMIN_ROLES)[number];

type RoleArg = Pick<CurrentAdminUser, "role"> | null | undefined;

function role(adminUser: RoleArg): string {
  return String(adminUser?.role ?? "").trim().toLowerCase();
}

function isOneOf(adminUser: RoleArg, allowed: ReadonlyArray<AdminRoleAll>): boolean {
  const r = role(adminUser);
  return (allowed as readonly string[]).includes(r);
}

// ---- View ----
export function canViewData(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ALL_ADMIN_ROLES);
}

// ---- Mentee write ----
export function canEditMentee(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["support_team", "core_team", "admin", "super_admin"]);
}

// ---- Mentor write ----
export function canEditMentor(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["core_team", "admin", "super_admin"]);
}

// ---- Match ----
export function canCreateMatch(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["reviewer", "support_team", "core_team", "admin", "super_admin"]);
}

// ---- Recap ----
export function canEditRecap(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["reviewer", "support_team", "core_team", "admin", "super_admin"]);
}

// ---- Admin / Operations workflow ----
export function canAccessAdmin(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["core_team", "admin", "super_admin"]);
}

// ---- User management ----
export function canManageUsers(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, ["admin", "super_admin"]);
}

/**
 * Convenience: explicit list of "write-capable" roles for arbitrary
 * write contexts that don't deserve a dedicated helper. Avoid using this
 * in user-facing gating — prefer the named helpers above.
 */
export function isWriteCapable(adminUser: RoleArg): boolean {
  return isOneOf(adminUser, [
    "reviewer",
    "support_team",
    "core_team",
    "admin",
    "super_admin"
  ]);
}
