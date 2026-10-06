"use client";

import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { HELP_GUIDES } from "@/lib/help-guides";
import { helpGuideFor } from "@/lib/help-guides-core";
import { activeNavHref, navModuleFor, navPath, type NavGroupDef } from "@/lib/nav-model";

/**
 * Biểu tượng cuốn sách cạnh menu chính (góc trên bên trái): rê chuột hiện “Hướng
 * dẫn sử dụng”, bấm mở hướng dẫn của ĐÚNG trang đang xem cùng các trang con của
 * module đó (BTC 02/10/2026).
 *
 * Màu hổ phách cho khác hẳn màu xanh của menu — người dùng cần nhận ra ngay đây
 * là chỗ đọc hướng dẫn, không phải một mục điều hướng.
 */
export function HelpGuideButton({
  pathname,
  navGroups,
  activeHref
}: {
  pathname: string;
  navGroups: NavGroupDef[];
  /** Mục menu đang mở (activeNavHref) — AppShell tính sẵn vì cần cả ?query của URL. */
  activeHref?: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Đổi trang thì đóng — hướng dẫn đang mở là của trang cũ.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const match = helpGuideFor(pathname, HELP_GUIDES);
  const current = activeHref === undefined ? activeNavHref(navGroups, pathname, "") : activeHref;
  // Module = nhánh con chứa trang (Tuyển Mentor / Tuyển Mentee), không thì cả nhóm.
  const group = navModuleFor(navGroups, current);
  const moduleItems = group?.items ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Hướng dẫn sử dụng"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="group relative rounded-full border border-amber-300 bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
      >
        <BookOpen className="h-5 w-5" aria-hidden="true" />
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 whitespace-nowrap rounded bg-vam-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
        >
          Hướng dẫn sử dụng
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Hướng dẫn sử dụng"
          className="fixed inset-x-4 top-24 z-40 max-h-[75vh] overflow-y-auto rounded-lg border border-amber-200 bg-white p-4 text-sm shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[30rem]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-700">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wide">Hướng dẫn sử dụng</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng hướng dẫn" className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {match ? (
            <div className="grid gap-3">
              <div>
                <h2 className="text-base font-semibold text-vam-ink">{match.guide.title}</h2>
                <p className="mt-1 text-slate-600">{match.guide.summary}</p>
              </div>
              <div>
                <h3 className="font-semibold text-vam-ink">Cách dùng</h3>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-700">
                  {match.guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              {match.guide.notes?.length ? (
                <div className="rounded-md bg-amber-50 p-2">
                  <h3 className="font-semibold text-amber-900">Lưu ý</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-amber-900">
                    {match.guide.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-slate-400">Cập nhật {match.guide.updated}</p>
            </div>
          ) : (
            <p className="text-slate-600">Trang này chưa có hướng dẫn riêng. Liên hệ BTC nếu cần hỗ trợ.</p>
          )}

          {moduleItems.length > 1 ? (
            <nav aria-label={`Các trang trong module ${group?.label ?? ""}`} className="mt-4 border-t border-vam-line pt-3">
              <h3 className="mb-1 font-semibold text-vam-ink">Các trang trong module {group?.label}</h3>
              <ul className="grid gap-1">
                {moduleItems.map((item) => {
                  const isCurrent = item.href === current;
                  // Hướng dẫn theo trang: “Đánh giá mentor” và “Đánh giá mentee” dùng chung hướng dẫn của /reviews.
                  const summary = HELP_GUIDES[navPath(item.href)]?.summary;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isCurrent ? "page" : undefined}
                        className={isCurrent ? "font-semibold text-vam-green" : "text-slate-700 hover:text-vam-green hover:underline"}
                      >
                        {item.label}
                      </Link>
                      {summary ? <p className="text-xs text-slate-500">{summary}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
