"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, DatabaseZap, Handshake, Home, LineChart, Users, UserRoundCheck, UserRoundSearch } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/operations", label: "Operations", icon: LineChart },
  { href: "/people", label: "People", icon: Users },
  { href: "/mentors", label: "Mentors", icon: UserRoundCheck },
  { href: "/mentees", label: "Mentees", icon: UserRoundSearch },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/matches", label: "Matches", icon: Handshake },
  { href: "/data-issues", label: "Data Issues", icon: DatabaseZap }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/unlock") return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#f7faf8]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-vam-line bg-white lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-vam-line px-6 py-5">
            <div className="text-lg font-bold text-vam-ink">VAM OS</div>
            <div className="text-sm text-slate-500">Admin Portal</div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => {
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
            UEH Mentoring Season 11
          </div>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-vam-line bg-white/95 backdrop-blur">
          <div className="px-4 py-3 sm:px-6 lg:px-8">
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              MVP nội bộ - chưa bật phân quyền người dùng.
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xl font-semibold text-vam-ink">VAM OS Admin Portal</div>
                <div className="text-sm text-slate-500">Cổng quản trị dữ liệu Vietnam Alumni Mentoring</div>
              </div>
              <BarChart3 className="h-6 w-6 text-vam-green" />
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map((item) => (
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
