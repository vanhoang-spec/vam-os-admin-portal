"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarRange,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  DatabaseZap,
  Handshake,
  Home,
  LineChart,
  LogOut,
  Menu,
  Mic,
  Settings2,
  ShieldCheck,
  UserCog,
  Users,
  UserRoundCheck,
  UserRoundSearch,
  X,
  type LucideIcon
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { roleLabel } from "@/lib/auth-constants";
import { cn } from "@/lib/utils";
import { buildNavGroups, isActiveRoute, type NavGroupDef } from "@/lib/nav-model";
import { SeasonSelector } from "@/components/season-selector";
import { isSeasonAwarePath } from "@/lib/season-labels";

const ICON_MAP: Record<string, LucideIcon> = {
  "/": Home,
  "/operations": LineChart,
  "/operations/tasks": ClipboardList,
  "/operations/monthly": BarChart3,
  "/operations/intelligence": LineChart,
  "/recaps/create": ClipboardCheck,
  "/people": Users,
  "/mentors": UserRoundCheck,
  "/mentees": UserRoundSearch,
  "/applications": ClipboardList,
  "/reviews": ClipboardCheck,
  "/interviews": Mic,
  "/matches": Handshake,
  "/events": CalendarRange,
  "/data-issues": DatabaseZap,
  "/admin": Settings2,
  "/team": ShieldCheck,
  "/admin/users": UserCog,
  community: Users,
  admin: Settings2,
  operations: LineChart,
};

function getGroupIcon(group: NavGroupDef): LucideIcon {
  if (group.href) return ICON_MAP[group.href] ?? Home;
  return ICON_MAP[group.key] ?? Settings2;
}

function isGroupActive(pathname: string, group: NavGroupDef): boolean {
  if (group.href) return isActiveRoute(pathname, group.href);
  return (group.items ?? []).some((item) => isActiveRoute(pathname, item.href));
}

function getDefaultOpenGroups(pathname: string, groups: NavGroupDef[]): Set<string> {
  const open = new Set<string>();
  for (const g of groups) {
    if (g.items && isGroupActive(pathname, g)) open.add(g.key);
  }
  return open;
}

const NAV_LINK_BASE =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-vam-green focus-visible:ring-offset-1 focus-visible:outline-none";

function SidebarNav({
  groups,
  pathname,
  navId,
  onNavigate,
}: {
  groups: NavGroupDef[];
  pathname: string;
  navId: string;
  onNavigate?: () => void;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(() =>
    getDefaultOpenGroups(pathname, groups)
  );

  useEffect(() => {
    setOpenGroups(getDefaultOpenGroups(pathname, groups));
    // groups is derived from adminUser.role, which is stable for the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <nav aria-label="Điều hướng chính" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {groups.map((group) => {
        const GroupIcon = getGroupIcon(group);
        const panelId = `${navId}-panel-${group.key}`;

        if (group.href) {
          const active = isActiveRoute(pathname, group.href);
          return (
            <Link
              key={group.key}
              href={group.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                NAV_LINK_BASE,
                active
                  ? "bg-vam-mint text-vam-ink"
                  : "text-slate-600 hover:bg-slate-50 hover:text-vam-ink"
              )}
            >
              <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {group.label}
            </Link>
          );
        }

        const isOpen = openGroups.has(group.key);
        const groupActive = isGroupActive(pathname, group);

        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={cn(
                NAV_LINK_BASE,
                "w-full",
                groupActive && !isOpen
                  ? "text-vam-ink"
                  : "text-slate-600 hover:bg-slate-50 hover:text-vam-ink"
              )}
            >
              <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150",
                  isOpen && "rotate-180"
                )}
                aria-hidden="true"
              />
            </button>
            {isOpen && (
              <div id={panelId} className="mt-0.5 space-y-0.5">
                {(group.items ?? []).map((item) => {
                  const ItemIcon = ICON_MAP[item.href] ?? Home;
                  const active = isActiveRoute(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        NAV_LINK_BASE,
                        "pl-9",
                        active
                          ? "bg-vam-mint text-vam-ink"
                          : "text-slate-500 hover:bg-slate-50 hover:text-vam-ink"
                      )}
                    >
                      <ItemIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ adminUser }: { adminUser: CurrentAdminUser }) {
  return (
    <div className="border-t border-vam-line px-6 py-4 text-xs text-slate-500">
      <div>Vietnam Alumni Mentoring</div>
      <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
        <div className="truncate font-medium text-vam-ink">{adminUser.email}</div>
        <div>{roleLabel(adminUser.role)}</div>
      </div>
    </div>
  );
}

function MobileDrawer({
  id,
  groups,
  pathname,
  adminUser,
  onClose,
}: {
  id: string;
  groups: NavGroupDef[];
  pathname: string;
  adminUser: CurrentAdminUser;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Move focus to close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape to close; Tab focus trap
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Prevent background scroll while drawer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="fixed inset-0 bg-vam-ink/20 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Menu điều hướng"
        className="fixed inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-vam-line px-6 py-5">
          <div>
            <div className="text-lg font-bold text-vam-ink">VAM OS</div>
            <div className="text-sm text-slate-500">Cổng quản trị</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Đóng menu"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-vam-green focus-visible:ring-offset-1 focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <SidebarNav groups={groups} pathname={pathname} navId="mobile-nav" onNavigate={onClose} />
        <SidebarFooter adminUser={adminUser} />
      </div>
    </div>
  );
}

const DRAWER_ID = "mobile-nav-drawer";

export function AppShell({
  children,
  adminUser,
}: {
  children: React.ReactNode;
  adminUser: CurrentAdminUser | null;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navGroups = useMemo(() => buildNavGroups(adminUser), [adminUser]);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const prevDrawerOpenRef = useRef(false);

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Return focus to menu button when drawer closes
  useEffect(() => {
    if (prevDrawerOpenRef.current && !drawerOpen) {
      menuButtonRef.current?.focus();
    }
    prevDrawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  if (pathname === "/login" || pathname.startsWith("/apply")) {
    return <>{children}</>;
  }

  if (!adminUser) {
    if (pathname === "/e2e-harness") {
      return (
        <main id="main-content" tabIndex={-1} className="min-h-screen bg-[#f7faf8] px-4 py-10">
          {children}
        </main>
      );
    }
    return (
      <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10">
        <section className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
          <h1 className="text-xl font-semibold text-vam-ink">Cần đăng nhập</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Vui lòng đăng nhập bằng tài khoản admin đã được cấp quyền active.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-ink focus-visible:ring-2 focus-visible:ring-vam-green focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Đến trang đăng nhập
          </Link>
        </section>
      </main>
    );
  }

  return (
    <>
      {/* Skip navigation: always fixed, starts above viewport, drops in on focus (no CSS-specificity conflict) */}
      <a
        href="#main-content"
        className="fixed -top-full left-4 z-[100] rounded-md bg-white px-4 py-2 text-sm font-medium text-vam-ink shadow-soft ring-2 ring-vam-green focus:top-4"
      >
        Chuyển đến nội dung chính
      </a>

      <div className="min-h-screen bg-[#f7faf8]">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col border-r border-vam-line bg-white lg:flex">
          <div className="border-b border-vam-line px-6 py-5">
            <div className="text-lg font-bold text-vam-ink">VAM OS</div>
            <div className="text-sm text-slate-500">Cổng quản trị</div>
          </div>
          <SidebarNav groups={navGroups} pathname={pathname} navId="desktop-nav" />
          <SidebarFooter adminUser={adminUser} />
        </aside>

        {/* Mobile drawer — conditionally mounted; focus managed by MobileDrawer */}
        {drawerOpen && (
          <MobileDrawer
            id={DRAWER_ID}
            groups={navGroups}
            pathname={pathname}
            adminUser={adminUser}
            onClose={() => setDrawerOpen(false)}
          />
        )}

        <div className="lg:pl-72">
          <header className="sticky top-0 z-10 border-b border-vam-line bg-white/95 backdrop-blur">
            <div className="px-4 py-3 sm:px-6 lg:px-8">
              <div className="mb-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Cổng quản trị nội bộ đang vận hành thử nghiệm. Vui lòng báo cáo mọi sự cố cho người phụ trách.
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    ref={menuButtonRef}
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Mở menu điều hướng"
                    aria-expanded={drawerOpen}
                    aria-controls={DRAWER_ID}
                    className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-vam-green focus-visible:ring-offset-1 focus-visible:outline-none lg:hidden"
                  >
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <div>
                    <div className="text-xl font-semibold text-vam-ink">VAM OS</div>
                    <div className="text-sm text-slate-500">
                      Cổng quản trị dữ liệu Vietnam Alumni Mentoring
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isSeasonAwarePath(pathname) ? <SeasonSelector /> : null}
                  <div className="hidden text-right text-xs text-slate-500 sm:block">
                    <div className="max-w-60 truncate font-medium text-vam-ink">{adminUser.email}</div>
                    <div>{roleLabel(adminUser.role)}</div>
                  </div>
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-vam-line bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-vam-green focus-visible:ring-offset-1 focus-visible:outline-none"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Đăng xuất
                    </button>
                  </form>
                  <BarChart3 className="h-6 w-6 text-vam-green" aria-hidden="true" />
                </div>
              </div>
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
