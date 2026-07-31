export const STAFF_IMPORT_ROLES = ["viewer", "reviewer", "support_team", "core_team", "admin"] as const;
export const PARTICIPANT_IMPORT_ROLES = ["mentor", "mentee"] as const;
export const ACCOUNT_IMPORT_ROLES = [...STAFF_IMPORT_ROLES, ...PARTICIPANT_IMPORT_ROLES] as const;

export type StaffImportRole = (typeof STAFF_IMPORT_ROLES)[number];
export type ParticipantImportRole = (typeof PARTICIPANT_IMPORT_ROLES)[number];
export type AccountImportRole = (typeof ACCOUNT_IMPORT_ROLES)[number];

export function isStaffImportRole(value: string): value is StaffImportRole {
  return (STAFF_IMPORT_ROLES as readonly string[]).includes(value);
}

export function isParticipantImportRole(value: string): value is ParticipantImportRole {
  return (PARTICIPANT_IMPORT_ROLES as readonly string[]).includes(value);
}

export function isAccountImportRole(value: string): value is AccountImportRole {
  return (ACCOUNT_IMPORT_ROLES as readonly string[]).includes(value);
}

export function scopeRoleForStaffRole(role: StaffImportRole) {
  if (role === "admin") return "full_access" as const;
  if (role === "core_team" || role === "support_team") return "operations" as const;
  if (role === "reviewer") return "review" as const;
  return "read" as const;
}

export function roleKind(role: AccountImportRole) {
  return isParticipantImportRole(role) ? "participant_membership" as const : "staff_account" as const;
}
