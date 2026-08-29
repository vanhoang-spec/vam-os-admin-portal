import type { CurrentAdminUser } from "@/lib/auth-constants";

export type NavItemDef = { href: string; label: string };

export type NavGroupDef = {
  key: string;
  label: string;
  href?: string;
  items?: NavItemDef[];
};

export function isActiveRoute(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  // Segment-aware: require a path separator, query, or fragment after the prefix
  const next = pathname[href.length];
  return pathname.startsWith(href) && (next === "/" || next === "?" || next === "#");
}

function roleIn(role: string | undefined, allowed: string[]) {
  return allowed.includes(role ?? "");
}

export function buildNavGroups(adminUser: CurrentAdminUser | null): NavGroupDef[] {
  const role = adminUser?.role;
  const showReviews = roleIn(role, ["super_admin", "admin", "core_team", "reviewer"]);
  const showAdminTier = roleIn(role, ["super_admin", "admin", "core_team"]);
  const showUserMgmt = role === "super_admin" && adminUser?.status === "active";

  const groups: NavGroupDef[] = [
    role === "super_admin"
      ? {
          key: "dashboard",
          label: "Tổng quan",
          items: [
            { href: "/portfolio", label: "Danh mục chương trình" },
            { href: "/", label: "Tổng quan vận hành hiện tại" },
          ],
        }
      : { key: "dashboard", label: "Tổng quan", href: "/" },
    showAdminTier
      ? {
          key: "operations",
          label: "Vận hành",
          items: [
            { href: "/operations", label: "Tổng quan vận hành" },
            { href: "/operations/tasks", label: "Nhiệm vụ & phân công" },
            { href: "/operations/monthly", label: "Báo cáo tháng" },
            { href: "/operations/intelligence", label: "Phân tích mùa" },
            { href: "/recaps/create", label: "Tạo báo cáo" },
          ],
        }
      : { key: "operations", label: "Vận hành", href: "/operations" },
    {
      key: "community",
      label: "Cộng đồng VAM",
      items: [
        { href: "/people", label: "Cộng đồng VAM" },
        { href: "/mentors", label: "Mentor" },
        { href: "/mentees", label: "Mentee" },
      ],
    },
    showReviews
      ? {
          key: "applications",
          label: "Ứng tuyển",
          items: [
            { href: "/applications/mentor-review", label: "Duyệt Mentor S12" },
            { href: "/applications", label: "Ứng tuyển (Tất cả)" },
            { href: "/reviews", label: "Đánh giá" },
            { href: "/interviews", label: "Phỏng vấn" },
          ],
        }
      : { key: "applications", label: "Ứng tuyển", href: "/applications" },
    { key: "matches", label: "Ghép cặp", href: "/matches" },
    { key: "events", label: "Sự kiện", href: "/events" },
    { key: "data", label: "Rà soát dữ liệu", href: "/data-issues" },
  ];

  if (showAdminTier) {
    groups.push({
      key: "admin",
      label: "Quản trị",
      items: [
        { href: "/admin", label: "Quản trị" },
        { href: "/admin/renewals", label: "Gia hạn mentor S12" },
        // M069. Visible to the admin tier (core_team included) because the
        // screen is useful read-only; the toggle itself is gated separately
        // by canToggleApplicationForm + season scope.
        { href: "/admin/seasons-forms", label: "Mùa & Form đăng ký" },
        { href: "/team", label: "Phân công & Trách nhiệm" },
        ...(showUserMgmt ? [{ href: "/admin/users", label: "Quản lý người dùng" }] : []),
      ],
    });
  }

  return groups;
}

export function allNavHrefs(groups: NavGroupDef[]): string[] {
  return groups.flatMap((g) =>
    g.href ? [g.href] : (g.items ?? []).map((i) => i.href)
  );
}
