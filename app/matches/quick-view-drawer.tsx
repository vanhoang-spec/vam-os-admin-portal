"use client";

import { useEffect, useRef } from "react";
import { ApplicationAnswerCard } from "@/components/application-answer-card";
import type { QuickViewPayload } from "@/lib/matching-quick-view-core";

/**
 * The matching profile drawer.
 *
 * ---------------------------------------------------------------------------
 * WHY A DRAWER AND NOT A LINK
 * ---------------------------------------------------------------------------
 * The operator is mid-decision: search text typed, a mentor chosen, a mentee
 * chosen, a note half-written. Navigating to the application page — or opening
 * a tab and coming back to a re-rendered page — throws all of that away. This
 * renders over /matches and unmounts again, so the form underneath is never
 * touched.
 *
 * The component holds NO selection state of its own and never calls
 * `router.refresh()`. Everything it needs arrives as props, which is what makes
 * "open drawer, read, close drawer, selections intact" true by construction
 * rather than by careful handling.
 *
 * Read-only by design: no edit control, no decision control, no review UI.
 */
export function QuickViewDrawer({
  open,
  title,
  loading,
  error,
  payload,
  onClose
}: {
  open: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  payload: QuickViewPayload | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes, matching the cancel-confirmation pattern already used on
  // this page. Bound only while open so the page keeps normal key handling.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      {/* Scrim. Clicking it closes, the same as the X. */}
      <button
        type="button"
        aria-label="Đóng hồ sơ"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30"
      />

      {/* Full width on a narrow screen, a right-hand panel on desktop. */}
      <aside className="relative flex h-full w-full max-w-full flex-col bg-white shadow-xl sm:max-w-md md:max-w-lg">
        <header className="flex items-start justify-between gap-3 border-b border-vam-line px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hồ sơ ghép cặp</p>
            <h2 className="mt-0.5 text-base font-semibold text-vam-ink">{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-vam-line px-2.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-vam-mint"
          >
            Đóng
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3" aria-live="polite">
              <p className="text-sm text-slate-500">Đang tải hồ sơ…</p>
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
              <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" aria-live="polite">
              {error}
            </div>
          ) : payload ? (
            <div className="space-y-5">
              {payload.summary.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-vam-ink">Tóm tắt</h3>
                  <dl className="divide-y divide-vam-line rounded-md border border-vam-line">
                    {payload.summary.map((row) => (
                      <div key={row.label} className="grid grid-cols-3 gap-3 px-3 py-2">
                        <dt className="col-span-1 text-xs font-medium uppercase text-slate-500">{row.label}</dt>
                        <dd className="col-span-2 whitespace-pre-wrap break-words text-sm text-vam-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              {payload.answers.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-vam-ink">Thông tin từ hồ sơ ứng tuyển</h3>
                  <div className="grid gap-3">
                    {payload.answers.map((answer) => (
                      // The same card the application detail page uses, so long
                      // free text truncates and expands identically.
                      <ApplicationAnswerCard
                        key={answer.key}
                        questionLabel={answer.label}
                        valueText={answer.value}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {payload.empty ? (
                <p className="rounded-md border border-dashed border-vam-line px-3 py-6 text-center text-sm text-slate-400">
                  Hồ sơ này chưa có thông tin ứng tuyển để hiển thị.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
