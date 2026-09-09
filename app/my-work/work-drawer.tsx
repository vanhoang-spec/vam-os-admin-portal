"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The detail surface that opens OVER the My Work list.
 *
 * ---------------------------------------------------------------------------
 * WHY CLOSING IS router.back() AND NOT router.push("/my-work")
 * ---------------------------------------------------------------------------
 * This drawer is rendered by an intercepted route, so it was reached by a
 * normal history entry pushed on top of the still-mounted list. `back()` pops
 * exactly that entry and leaves the list component instance untouched, which
 * is what preserves the operator's filter and scroll position.
 *
 * `push("/my-work")` would instead add ANOTHER entry and re-navigate to the
 * list route, remounting it with a fresh filter and a scroll reset — the exact
 * loss of context this screen exists to avoid — while also making the browser
 * Back button walk through a growing stack of list entries.
 */
export function WorkDrawer({
  children,
  fullScreenHref
}: {
  children: React.ReactNode;
  /**
   * Where "open full screen" goes. The drawer is a quick look; a reviewer
   * reading a full application in it reported running out of room, and the
   * same screen at `/reviews/<id>` has the whole window.
   */
  fullScreenHref?: string;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    // Escape is the expected way out of a layer like this, and without it a
    // keyboard user who cannot reach the close button has no way back to the
    // list at all.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    // The list behind the drawer must not scroll while the drawer is open, or
    // the operator loses the position the drawer exists to preserve.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      data-testid="my-work-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Chi tiết công việc"
    >
      <button
        type="button"
        aria-label="Đóng chi tiết công việc"
        data-testid="my-work-drawer-backdrop"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="my-work-drawer-panel"
        className="relative flex h-full w-full max-w-6xl flex-col overflow-y-auto bg-vam-bg shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-vam-line bg-white px-5 py-3">
          <span className="text-sm font-semibold text-slate-600">Chi tiết công việc</span>
          <div className="flex items-center gap-2">
            {fullScreenHref ? (
              <a
                href={fullScreenHref}
                data-testid="my-work-drawer-fullscreen"
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
              >
                Mở toàn màn hình
              </a>
            ) : null}
          <button
            type="button"
            onClick={close}
            data-testid="my-work-drawer-close"
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Đóng
          </button>
          </div>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
