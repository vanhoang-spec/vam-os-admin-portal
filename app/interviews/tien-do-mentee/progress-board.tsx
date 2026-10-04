"use client";

import Link from "next/link";
import { useState } from "react";
import {
  PROGRESS_LABELS,
  emptyCounts,
  type MenteeProgress,
  type ProgressCounts,
  type ProgressRow,
  type ProgressStatus
} from "@/lib/mentee-progress-core";
import { formatTime } from "@/lib/utils";

type StatusFilter = "all" | ProgressStatus;
const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ["all", "Tất cả"],
  ["not_arrived", "Chưa đến"],
  ["waiting", "Chờ phân bàn"],
  ["in_progress", "Đang phỏng vấn"],
  ["done", "Đã xong"]
];

const BADGE: Record<ProgressStatus, string> = {
  done: "bg-vam-mint text-vam-green",
  in_progress: "bg-sky-100 text-sky-800",
  waiting: "bg-amber-100 text-amber-900",
  not_arrived: "bg-slate-100 text-slate-600",
  withdrawn: "bg-slate-100 text-slate-400 line-through"
};

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-vam-line bg-white px-3 py-2">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone ?? "text-vam-ink"}`}>{value}</p>
    </div>
  );
}

function CountsLine({ counts }: { counts: ProgressCounts }) {
  return (
    <span className="text-sm text-slate-600 tabular-nums">
      {counts.total} bạn · xong {counts.done} (Đạt {counts.passed}, Không chọn {counts.rejected}, Cần xem xét {counts.needs_review}) · đang PV{" "}
      {counts.in_progress} · chờ phân bàn {counts.waiting} · chưa đến {counts.not_arrived}
    </span>
  );
}

function matches(row: ProgressRow, status: StatusFilter, query: string) {
  if (status !== "all" && row.status !== status) return false;
  if (!query) return true;
  const q = query.toLocaleLowerCase("vi");
  const digits = query.replace(/\D/g, "");
  return row.name.toLocaleLowerCase("vi").includes(q) || (digits.length >= 3 && row.phone.replace(/\D/g, "").includes(digits));
}

/**
 * Bảng tiến độ — lọc theo ngày / buổi / trạng thái / tên. Ô số liệu đầu bảng tính
 * theo ngày + buổi đang chọn (không theo ô tìm), để BTC luôn thấy bức tranh của
 * cả buổi đang chạy.
 */
export function ProgressBoard({ progress, todayKey }: { progress: MenteeProgress; todayKey: string }) {
  const hasToday = progress.days.some((d) => d.dateKey === todayKey);
  const [day, setDay] = useState<string>(hasToday ? todayKey : "all");
  const [half, setHalf] = useState<"all" | "sang" | "chieu">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const days = progress.days.filter((d) => day === "all" || d.dateKey === day);
  const counts = emptyCounts();
  for (const d of days) {
    for (const h of d.halves) {
      if (half !== "all" && h.key !== half) continue;
      for (const key of Object.keys(counts) as Array<keyof ProgressCounts>) counts[key] += h.counts[key];
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-vam-line bg-white p-3">
        <label className="grid gap-1 text-sm">
          Ngày
          <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-md border border-slate-300 bg-white p-2">
            <option value="all">Cả hai ngày</option>
            {progress.days.map((d) => <option key={d.dateKey} value={d.dateKey}>{d.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Buổi
          <select value={half} onChange={(e) => setHalf(e.target.value as typeof half)} className="rounded-md border border-slate-300 bg-white p-2">
            <option value="all">Cả ngày</option>
            <option value="sang">Buổi sáng</option>
            <option value="chieu">Buổi chiều</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tìm mentee
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên hoặc số điện thoại"
            className="rounded-md border border-slate-300 bg-white p-2" />
        </label>
        <div role="group" aria-label="Lọc trạng thái" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}
              className={`rounded-full border px-3 py-1 text-sm ${status === key ? "border-vam-green bg-vam-green text-white" : "border-slate-300 bg-white"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="progress-tiles">
        <Tile label="Đăng ký" value={counts.total} />
        <Tile label="Đã xong" value={counts.done} tone="text-vam-green" />
        <Tile label="Đạt" value={counts.passed} tone="text-vam-green" />
        <Tile label="Không chọn" value={counts.rejected} />
        <Tile label="Cần BTC xem xét" value={counts.needs_review} tone="text-amber-800" />
        <Tile label="Đang phỏng vấn" value={counts.in_progress} tone="text-sky-800" />
        <Tile label="Chờ phân bàn / Chưa đến" value={counts.waiting + counts.not_arrived} />
      </div>

      {days.map((d) => (
        <section key={d.dateKey} className="grid gap-3" aria-label={d.label}>
          <h2 className="text-lg font-semibold text-vam-ink">{d.label}</h2>
          {d.halves.filter((h) => half === "all" || h.key === half).map((h) => (
            <div key={h.key} className="grid gap-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-semibold text-vam-ink">{h.label}</h3>
                <CountsLine counts={h.counts} />
              </div>
              {h.sessions.map((s) => {
                const rows = s.rows.filter((r) => matches(r, status, query));
                if (rows.length === 0 && (status !== "all" || query)) return null;
                return (
                  <details key={s.id} open className="rounded-lg border border-vam-line bg-white p-3" aria-label={`Ca ${s.label}`}>
                    <summary className="cursor-pointer">
                      <span className="font-semibold">Ca {s.label}</span>{" "}
                      <CountsLine counts={s.counts} />
                    </summary>
                    {rows.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">Chưa có mentee đăng ký ca này.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[720px] text-sm">
                          <thead className="text-left text-xs uppercase text-slate-500">
                            <tr>
                              <th className="p-2">Mentee</th>
                              <th className="p-2">Trạng thái</th>
                              <th className="p-2">Phòng / bàn</th>
                              <th className="p-2">Người phỏng vấn</th>
                              <th className="p-2">Kết quả</th>
                              <th className="p-2">Check-in</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.id} className="border-t border-vam-line" data-status={r.status}>
                                <td className="p-2">
                                  <Link href={`/interviews/mentee-offline?application=${r.id}`} className="font-medium text-vam-green underline">{r.name}</Link>
                                  <div className="text-xs text-slate-500">{r.phone}</div>
                                </td>
                                <td className="p-2">
                                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{PROGRESS_LABELS[r.status]}</span>
                                  {r.isOnline ? <span className="ml-1 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">Online</span> : null}
                                </td>
                                <td className="p-2 tabular-nums">{r.place || "—"}</td>
                                <td className="p-2">{r.interviewer || "—"}</td>
                                <td className="p-2">{r.outcomeLabel || "—"}</td>
                                <td className="p-2 tabular-nums">{r.checkedInAt ? formatTime(r.checkedInAt) : "—"}{r.checkedInBy ? <div className="text-xs text-slate-500">bởi {r.checkedInBy}</div> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
