import type { AdminRole } from "@/lib/auth-constants";

const OPERATIONS_READ_ROLES = new Set<AdminRole>([
  "super_admin",
  "admin",
  "core_team",
  "support_team"
]);

export function canBrowseApplications(role: AdminRole) {
  return OPERATIONS_READ_ROLES.has(role);
}

export function canBrowsePeople(role: AdminRole) {
  return OPERATIONS_READ_ROLES.has(role);
}

export function canBrowseTeam(role: AdminRole) {
  return OPERATIONS_READ_ROLES.has(role);
}

export function canBrowseParticipants(role: AdminRole) {
  return OPERATIONS_READ_ROLES.has(role);
}
