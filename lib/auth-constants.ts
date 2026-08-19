export const AUTH_ACCESS_COOKIE = "vam_os_sb_access_token";
export const AUTH_REFRESH_COOKIE = "vam_os_sb_refresh_token";

/**
 * Roles accepted by the DB CHECK constraint on `admin_users.role`.
 * Migration 036 extends the constraint to include `support_team` and
 * `core_team`. Apply that migration before assigning the new values to
 * any admin_user row.
 */
export const ADMIN_ROLES = [
  "viewer",
  "reviewer",
  "support_team",
  "core_team",
  "admin",
  "super_admin",
  // Migration 071. Reads and exports across every programme, operates none of
  // them. Every predicate below and in lib/permissions.ts is an allow-list, so
  // adding the value here grants nothing on its own — which is the point.
  "vam_admin"
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type CurrentAdminUser = {
  id?: string | null;
  email: string;
  full_name: string | null;
  role: AdminRole;
  status: "active";
  auth_user_id: string | null;
};

/**
 * Legacy compatibility shims.
 *
 * The Phase 2 work moved permission logic to `lib/permissions.ts`
 * (canEditRecap, canAccessAdmin, canEditMentee, canEditMentor, ...),
 * but a number of files on the deployed branch still import the old
 * names (`canEditRecaps`, `canManageWorkflow`) from this module.
 * Removing the exports here breaks the production Vercel build with
 * "Module ... has no exported member 'canEditRecaps'".
 *
 * These shims restore the old exports so the legacy call sites
 * compile, while applying the updated role allowlist (now also
 * including `core_team`). Once every legacy call site has been
 * migrated to `lib/permissions.ts`, these can be deleted.
 */
export function canEditRecaps(adminUser: { role?: string | null } | null | undefined) {
  return ["super_admin", "admin", "core_team"].includes(adminUser?.role ?? "");
}

export function canManageWorkflow(adminUser: { role?: string | null } | null | undefined) {
  return ["super_admin", "admin", "core_team"].includes(adminUser?.role ?? "");
}

export function roleLabel(role: AdminRole | string | null | undefined) {
  // Exact match per known role. The default branch used to silently
  // return "Viewer" for ANY unknown / missing / corrupted value, which
  // masked real bugs (e.g., a core_team user appearing as Viewer when
  // the role string was momentarily missing in transit). Now we only
  // return "Viewer" when the role is literally "viewer", and surface
  // anything else as an explicit "unknown role" so the bug becomes
  // visible instead of disguised.
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  if (role === "core_team") return "Core team";
  if (role === "support_team") return "Support team";
  if (role === "reviewer") return "Reviewer";
  if (role === "viewer") return "Viewer";
  if (role === "vam_admin") return "VAM admin (chỉ báo cáo)";
  return `Vai trò không xác định: ${role ?? "(không có giá trị)"}`;
}
