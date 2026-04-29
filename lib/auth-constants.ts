export const AUTH_ACCESS_COOKIE = "vam_os_sb_access_token";
export const AUTH_REFRESH_COOKIE = "vam_os_sb_refresh_token";

export const ADMIN_ROLES = ["viewer", "reviewer", "admin", "super_admin"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type CurrentAdminUser = {
  email: string;
  full_name: string | null;
  role: AdminRole;
  status: "active";
  auth_user_id: string | null;
  isPasswordGateFallback?: boolean;
};

export function canEditRecaps(adminUser: Pick<CurrentAdminUser, "role"> | null) {
  return adminUser?.role === "admin" || adminUser?.role === "super_admin";
}

export function roleLabel(role: AdminRole) {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  if (role === "reviewer") return "Reviewer";
  return "Viewer";
}
