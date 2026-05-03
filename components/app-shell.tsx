"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarRange, ClipboardList, DatabaseZap, Handshake, Home, LineChart, LogOut, Settings2, ShieldCheck, UserCog, Users, UserRoundCheck, UserRoundSearch } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { roleLabel } from "@/lib/auth-constants";
import { canAccessAdmin, canManageUsers } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/operations", label: "Operations", icon: LineChart },
  { href: "/people", label: "People", icon: Users },
  { href: "/mentors", label: "Mentors", icon: UserRoundCheck },
  { href: "/mentees", label: "Mentees", icon: UserRoundSearch },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/matches", label: "Matches", icon: Handshake },
  { href: "/events", label: "Sự kiện", icon: CalendarRange },
  { href: "/team", label: "Team & Trách nhiệm", icon: ShieldCheck },
  { href: "/data-issues", label: "Data Issues", icon: DatabaseZap }
];

const adminCorrectionNavItem = { href: "/admin", label: "Admin Workflow", icon: Settings2 };

export function AppShell({ children, adminUser }: { children: React.ReactNode; adminUser: CurrentAdminUser | null }) {
  const pathname = usePathname();

  // ROLE DEBUG — confirms the prop arrived at the client component with
  // the right role string. Browser console only — remove after the
  // production behavior is verified.
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("ROLE DEBUG (AppShell):", adminUser);
  }

  // Sidebar nav visibility uses the centralized permission helpers
  // (lib/permissions.ts) instead of inlining role string lists. The
  // previous hard-coded `role === "super_admin" || role === "admin"`
  // check silently excluded core_team from the Admin Workflow item.
  const showAdminWorkflow = canAccessAdmin(adminUser);
  const showUserManagement = canManageUsers(adminUser);
  const visibleNavItems = [
    ...navItems,
    ...(showAdminWorkflow ? [adminCorrectionNavItem] : []),
    ...(showUserManagement ? [{ href: "/admin/users", label: "Quản lý người dùng", icon: UserCog }] : [])
  ];

  if (pathname === "/unlock" || pathname === "/login") return <>{children}</>;

  if (!adminUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10">
        <section className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
          <h1 className="text-xl font-semibold text-vam-ink">Cần đăng nhập Supabase Auth</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Vui lòng đăng nhập bằng tài khoản admin đã được cấp quyền active.</p>
          <Link href="/login" className="mt-4 inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-ink">
            Đến trang đăng nhập
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7faf8]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-vam-line bg-white lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-vam-line px-6 py-5">
            <div className="text-lg font-bold text-vam-ink">VAM OS</div>
            <div className="text-sm text-slate-500">Admin Portal</div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                    active ? "bg-vam-mint text-vam-green" : "text-slate-600 hover:bg-slate-50 hover:text-vam-ink"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-vam-line px-6 py-4 text-xs text-slate-500">
            <div>UEH Mentoring Season 11</div>
            <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="truncate font-medium text-vam-ink">{adminUser.email}</div>
              <div>{roleLabel(adminUser.role)}</div>
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-vam-line bg-white/95 backdrop-blur">
          <div className="px-4 py-3 sm:px-6 lg:px-8">
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              MVP nội bộ - Sprint 1A dùng Supabase Auth ở app layer, RLS chưa bật. Password gate chỉ là lớp chuyển tiếp, không cấp quyền admin.
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xl font-semibold text-vam-ink">VAM OS Admin Portal</div>
                <div className="text-sm text-slate-500">Cổng quản trị dữ liệu Vietnam Alumni Mentoring</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right text-xs text-slate-500 sm:block">
                  <div className="max-w-60 truncate font-medium text-vam-ink">{adminUser.email}</div>
                  <div>{roleLabel(adminUser.role)}</div>
                </div>
                <form action={logoutAction}>
                  <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-md border border-vam-line bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <LogOut className="h-4 w-4" />
                    Đăng xuất
                  </button>
                </form>
                <BarChart3 className="h-6 w-6 text-vam-green" />
              </div>
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {visibleNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 rounded-md border px-3 py-2 text-sm",
                    pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
                      ? "border-vam-green bg-vam-mint text-vam-green"
                      : "border-vam-line bg-white text-slate-600"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
