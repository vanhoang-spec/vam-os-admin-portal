"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filterMyWorkItems, summarize, type MyWorkFilter, type MyWorkItem } from "@/lib/my-work";
import { formatDate } from "@/lib/utils";
import { Card, EmptyState } from "@/components/ui";

/**
 * The personal inbox list.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FILTER IS COMPONENT STATE AND NOT A SEARCH PARAM
 * ---------------------------------------------------------------------------
 * Opening a work item navigates to `/reviews/<id>`, which the parallel
 * `@detail` slot intercepts and draws OVER this list (see `layout.tsx`). The
 * list stays mounted throughout, so anything held in component state — the
 * chosen filter, and the browser's scroll position — is still exactly as the
 * operator left it when the drawer closes.
 *
 * Putting the filter in the URL instead would lose it at precisely that
 * moment: the interception replaces the URL with the review's, and coming back
 * would re-render the list from a query string that no longer had it. The
 * requirement is that closing the detail returns the operator to the SAME
 * list, so the state that defines "same" has to outlive the navigation.
 */
const FILTERS: Array<{ key: MyWorkFilter; label: string }> = [
  { key: "all", label: "Tất cả" },
  { key: "profile", label: "Đánh giá hồ sơ" },
  { key: "interview", label: "Phỏng vấn" }
];

function SummaryPill({
  label,
  value,
  tone,
  testId
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "red" | "green";
  testId: string;
}) {
  const toneClass = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    green: "border-green-200 bg-green-50 text-green-700"
  }[tone];
  return (
    <span
      data-testid={testId}
      data-count={value}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${toneClass}`}
    >
      {label}: <strong>{value}</strong>
    </span>
  );
}

export function MyWorkClient({ items }: { items: MyWorkItem[] }) {
  const [filter, setFilter] = useState<MyWorkFilter>("all");

  // Summary counts describe the WHOLE inbox, not the current filter. An
  // operator switching to "Phỏng vấn" is narrowing what they are looking at,
  // not declaring that their profile-review backlog stopped existing — and an
  // overdue count that dropped when a filter changed would be actively
  // misleading.
  const summary = useMemo(() => summarize(items), [items]);
  const visible = useMemo(() => filterMyWorkItems(items, filter), [items, filter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3" data-testid="my-work-summary">
        <SummaryPill label="Cần làm" value={summary.todo} tone="slate" testId="my-work-summary-todo" />
        <SummaryPill label="Đang làm" value={summary.doing} tone="amber" testId="my-work-summary-doing" />
        <SummaryPill label="Quá hạn" value={summary.overdue} tone="red" testId="my-work-summary-overdue" />
        <SummaryPill label="Hoàn tất" value={summary.done} tone="green" testId="my-work-summary-done" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Lọc theo loại công việc">
        {FILTERS.map((entry) => {
          const active = filter === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              data-testid={`my-work-filter-${entry.key}`}
              aria-pressed={active}
              onClick={() => setFilter(entry.key)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-vam-green bg-vam-green text-white"
                  : "border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState message="Chưa có công việc nào được giao cho bạn." />
        ) : (
          <ul className="divide-y divide-vam-line" data-testid="my-work-list">
            {visible.map((item) => (
              <li
                key={item.reviewId}
                data-testid="my-work-item"
                data-review-id={item.reviewId}
                data-kind={item.kind}
                data-bucket={item.bucket}
                data-overdue={item.overdue ? "true" : "false"}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                  item.overdue ? "bg-red-50/60" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-vam-ink">
                      {item.applicantName ?? "Chưa rõ tên"}
                    </span>
                    {item.applicantRole ? (
                      <span className="rounded-md border border-vam-line px-2 py-0.5 text-xs font-medium text-slate-600">
                        {item.applicantRole}
                      </span>
                    ) : null}
                    <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {item.kindLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span data-testid="my-work-item-status">{item.statusLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Hạn hoàn tất: {item.dueAt ? formatDate(item.dueAt) : "Chưa đặt"}
                    </span>
                    {item.overdue ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                        Quá hạn
                      </span>
                    ) : item.dueSoon ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                        Sắp đến hạn
                      </span>
                    ) : null}
                  </div>
                </div>

                {/*
                  A plain Link, deliberately. The `@detail` slot intercepts this
                  exact href and renders the real review screen in a drawer over
                  this list; if interception is unavailable for any reason the
                  same href still resolves to the full `/reviews/<id>` page, so
                  the worst case is a normal navigation rather than dead UI.
                */}
                <Link
                  href={item.href}
                  data-testid="my-work-item-action"
                  className="inline-flex shrink-0 rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
                >
                  {item.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
