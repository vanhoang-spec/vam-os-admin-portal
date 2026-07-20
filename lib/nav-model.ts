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
  const showUserMgmt = roleIn(role, ["super_admin", "admin"]);

  const groups: NavGroupDef[] = [
    { key: "dashboard", label: "Tổng quan", href: "/" },
    { key: "operations", label: "Vận hành", href: "/operations" },
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
            { href: "/applications", label: "Ứng tuyển" },
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
