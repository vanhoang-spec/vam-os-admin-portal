"use client";

import Link from "next/link";
import { useState } from "react";
import { matchesTableQuery } from "@/lib/table-search-core";
import {
  MENTOR_PROGRESS_LABELS,
  type MentorProgress,
  type MentorProgressRow,
  type MentorProgressStatus
} from "@/lib/mentor-progress-core";

type Filter = "all" | MentorProgressStatus | "not_yet";
const FILTERS: Array<[Filter, string]> = [
  ["all", "Tất cả"],
  ["done", "Đã xong"],
  ["in_progress", "Đang phỏng vấn"],
  ["awaiting_result", "Qua giờ, chưa có phiếu"],
  ["scheduled", "Đã đặt lịch"],
  ["not_yet", "Chưa phỏng vấn (chưa đặt / chưa lịch)"],
  ["stopped", "Dừng / rút / vòng hồ sơ"]
];

const BADGE: Record<MentorProgressStatus, string> = {
  done: "bg-vam-mint text-vam-green",
  in_progress: "bg-sky-100 text-sky-800",
  awaiting_result: "bg-red-100 text-red-800",
  scheduled: "bg-indigo-50 text-indigo-800",
  assigned: "bg-amber-100 text-amber-900",
  not_booked: "bg-amber-100 text-amber-900",
  pending_screening: "bg-slate-100 text-slate-600",
  stopped: "bg-slate-100 text-slate-600",
  withdrawn: "bg-slate-100 text-slate-400 line-through"
};

function inFilter(row: MentorProgressRow, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "not_yet") return row.status === "not_booked" || row.status === "assigned";
  if (filter === "stopped") return row.status === "stopped" || row.status === "withdrawn" || row.status === "pending_screening";
  return row.status === filter;
}

/** Bỏ dấu, đủ mọi từ, SĐT gõ liền — cùng phép tìm với mọi bảng khác của CRM. */
function matches(row: MentorProgressRow, query: string) {
  return matchesTableQuery([row.name, row.email, row.interviewer, row.phone], query);
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-vam-line bg-white px-3 py-2">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone ?? "text-vam-ink"}`}>{value}</p>
    </div>
  );
}

export function MentorProgressBoard({ progress }: { progress: MentorProgress }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const c = progress.counts;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="mentor-progress-tiles">
        <Tile label="Mentor vào vòng PV" value={c.total} />
        <Tile label="Đã phỏng vấn xong" value={c.done} tone="text-vam-green" />
        <Tile label="Đang phỏng vấn" value={c.in_progress} tone="text-sky-800" />
        <Tile label="Qua giờ, chưa có phiếu" value={c.awaiting_result} tone="text-red-700" />
        <Tile label="Đã đặt lịch, chờ PV" value={c.scheduled} />
        <Tile label="Chưa phỏng vấn" value={c.not_booked + c.assigned} tone="text-amber-800" />
        <Tile label="Dừng / rút / vòng hồ sơ" value={c.stopped + c.withdrawn + c.pending_screening} />
      </div>
      {progress.resultCounts.length ? (
        <p className="text-sm text-slate-600" data-testid="mentor-result-breakdown">
          Kết quả đã có: {progress.resultCounts.map(([label, n]) => `${label} ${n}`).join(" · ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-vam-line bg-white p-3">
        <label className="grid gap-1 text-sm">
          Ngày hẹn
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-md border border-slate-300 bg-white p-2">
            <option value="all">Tất cả</option>
            {progress.groups.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.counts.total})</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tìm mentor / người phỏng vấn
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên, email hoặc số điện thoại"
            className="rounded-md border border-slate-300 bg-white p-2" />
        </label>
        <div role="group" aria-label="Lọc trạng thái" className="flex flex-wrap gap-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-sm ${filter === key ? "border-vam-green bg-vam-green text-white" : "border-slate-300 bg-white"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {progress.groups.filter((g) => group === "all" || g.key === group).map((g) => {
        const rows = g.rows.filter((r) => inFilter(r, filter) && matches(r, query));
        if (rows.length === 0) return null;
        return (
          <section key={g.key} className="rounded-lg border border-vam-line bg-white p-3" aria-label={g.label}>
            <h2 className="font-semibold text-vam-ink">
              {g.label} <span className="font-normal text-slate-500">· {rows.length}/{g.counts.total} mentor</span>
            </h2>
            <div className="vam-table-frame mt-2">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Giờ hẹn</th>
                    <th className="p-2">Mentor</th>
                    <th className="p-2">Tình trạng</th>
                    <th className="p-2">Người phỏng vấn</th>
                    <th className="p-2">Kết quả</th>
                    <th className="p-2">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.applicationId} className="border-t border-vam-line align-top" data-status={r.status}>
                      <td className="p-2 tabular-nums">{r.slotLabel || "—"}</td>
                      <td className="p-2">
                        <Link href={`/applications/${r.applicationId}`} className="font-medium text-vam-green underline">{r.name}</Link>
                        <div className="text-xs text-slate-500">{[r.email, r.phone].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="p-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{MENTOR_PROGRESS_LABELS[r.status]}</span>
                      </td>
                      <td className="p-2">{r.interviewer || "—"}</td>
                      <td className="p-2">{r.resultLabel || "—"}</td>
                      <td className="p-2 text-xs text-slate-600">{r.detail || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
