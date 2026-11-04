"use client";

import { useMemo, useState, type FormEvent } from "react";
import { OFFLINE_OUTCOMES } from "@/lib/mentee-offline-core";
import { recommendationLabel } from "@/lib/screening-decision";
import { formatDateTime } from "@/lib/utils";
import { NONE, applyExportFilters, resultOptions, reviewerOptions, type ExportFilters, type ExportSummaryRow } from "@/lib/mentee-offline-export-filter";

const FIELD = "mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm";

const profileResultLabel = (key: string) => recommendationLabel(key);
const interviewResultLabel = (key: string) => OFFLINE_OUTCOMES[key as keyof typeof OFFLINE_OUTCOMES] ?? key;

function roundText(cell: ExportSummaryRow["profile"], label: (key: string) => string) {
  const who = cell.reviewerName || (cell.reviewerId ? "Đã phân" : "Chưa có");
  return cell.result ? `${who} · ${label(cell.result)}` : who;
}

/**
 * VAM00023 — chọn mentee và bộ lọc, rồi tải một file Excel. Bộ lọc ở đây chỉ là tiện dụng: máy chủ áp lại đúng các điều
 * kiện này khi dựng file (lib/mentee-offline-export-filter.ts), nên sửa biểu mẫu bằng tay cũng không xuất được thứ ngoài
 * điều kiện hay ngoài quyền.
 *
 * Không tick ai thì xuất TẤT CẢ mentee đang lọc; tick một số thì chỉ xuất những bạn đó (trong số đang hiện).
 */
export function ExportPanel({ rows }: { rows: ExportSummaryRow[] }) {
  const [q, setQ] = useState("");
  const [profileReviewer, setProfileReviewer] = useState("");
  const [profileResult, setProfileResult] = useState("");
  const [interviewReviewer, setInterviewReviewer] = useState("");
  const [interviewResult, setInterviewResult] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const filters: ExportFilters = { q, profileReviewer, profileResult, interviewReviewer, interviewResult };
  const visible = useMemo(() => applyExportFilters(rows, filters), [rows, q, profileReviewer, profileResult, interviewReviewer, interviewResult]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleTicked = visible.filter((row) => ticked.has(row.id));
  const exportCount = visibleTicked.length > 0 ? visibleTicked.length : visible.length;

  const profileReviewers = useMemo(() => reviewerOptions(rows, "profile"), [rows]);
  const interviewReviewers = useMemo(() => reviewerOptions(rows, "interview"), [rows]);
  const profileResults = useMemo(() => resultOptions(rows, "profile"), [rows]);
  const interviewResults = useMemo(() => resultOptions(rows, "interview"), [rows]);

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function tickAllVisible() {
    setTicked((prev) => new Set(Array.from(prev).concat(visible.map((row) => row.id))));
  }
  function clearFilters() {
    setQ("");
    setProfileReviewer("");
    setProfileResult("");
    setInterviewReviewer("");
    setInterviewResult("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || exportCount === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/exports/mentee-offline", { method: "POST", body: new FormData(event.currentTarget), credentials: "same-origin" });
      if (!response.ok) {
        setMessage({ ok: false, text: (await response.text()) || "Không tạo được file. Vui lòng thử lại." });
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "mentee-phong-van-truc-tiep.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: `Đã tạo file ${name} với ${exportCount} mentee.` });
    } catch {
      setMessage({ ok: false, text: "Mất kết nối khi tạo file. Kiểm tra mạng rồi thử lại." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/exports/mentee-offline" onSubmit={onSubmit} className="grid gap-4" data-testid="export-form">
      <input type="hidden" name="ids" value={visibleTicked.map((row) => row.id).join(",")} readOnly />

      <div className="grid gap-3 rounded-lg border border-vam-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-medium text-vam-ink sm:col-span-2 lg:col-span-3">
          Tìm mentee (tên hoặc email)
          <input name="q" value={q} onChange={(e) => setQ(e.target.value)} className={FIELD} placeholder="Gõ tên hoặc email, không cần dấu" />
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Người đánh giá vòng hồ sơ
          <select name="profile_reviewer" value={profileReviewer} onChange={(e) => setProfileReviewer(e.target.value)} className={FIELD}>
            <option value="">Tất cả</option>
            {profileReviewers.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
            <option value={NONE}>Chưa có người đánh giá</option>
          </select>
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Kết quả vòng hồ sơ
          <select name="profile_result" value={profileResult} onChange={(e) => setProfileResult(e.target.value)} className={FIELD}>
            <option value="">Tất cả</option>
            {profileResults.map((key) => (
              <option key={key} value={key}>{profileResultLabel(key)}</option>
            ))}
            <option value={NONE}>Chưa có kết quả</option>
          </select>
        </label>
        <div className="hidden lg:block" aria-hidden="true" />
        <label className="text-sm font-medium text-vam-ink">
          Người đánh giá vòng phỏng vấn
          <select name="interview_reviewer" value={interviewReviewer} onChange={(e) => setInterviewReviewer(e.target.value)} className={FIELD}>
            <option value="">Tất cả</option>
            {interviewReviewers.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
            <option value={NONE}>Chưa có người đánh giá</option>
          </select>
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Kết quả vòng phỏng vấn
          <select name="interview_result" value={interviewResult} onChange={(e) => setInterviewResult(e.target.value)} className={FIELD}>
            <option value="">Tất cả</option>
            {interviewResults.map((key) => (
              <option key={key} value={key}>{interviewResultLabel(key)}</option>
            ))}
            <option value={NONE}>Chưa có kết quả</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={clearFilters} className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-vam-ink hover:bg-vam-mint">
            Xoá bộ lọc
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span role="status" data-testid="export-count">
          Đang hiện <b>{visible.length}</b> / {rows.length} mentee · đã chọn <b>{visibleTicked.length}</b>
        </span>
        <button type="button" onClick={tickAllVisible} className="rounded-md border border-vam-line px-3 py-1 font-medium hover:bg-vam-mint">
          Chọn tất cả đang hiện
        </button>
        <button type="button" onClick={() => setTicked(new Set())} className="rounded-md border border-vam-line px-3 py-1 font-medium hover:bg-vam-mint">
          Bỏ chọn
        </button>
      </div>

      <div className="vam-table-frame rounded-lg border border-vam-line bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-600">
            <tr>
              <th className="w-10 px-3 py-2"><span className="sr-only">Chọn</span></th>
              <th className="px-3 py-2">Mentee</th>
              <th className="px-3 py-2">Ca phỏng vấn</th>
              <th className="px-3 py-2">Vòng hồ sơ</th>
              <th className="px-3 py-2">Vòng phỏng vấn</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-t border-vam-line align-top">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={ticked.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Chọn ${row.name}`} />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-vam-ink">{row.name || "(chưa có tên)"}</div>
                  <div className="text-xs text-slate-500">{row.email}</div>
                </td>
                <td className="px-3 py-2">{row.startsAt ? formatDateTime(row.startsAt) : "—"}</td>
                <td className="px-3 py-2">{roundText(row.profile, profileResultLabel)}</td>
                <td className="px-3 py-2">{roundText(row.interview, interviewResultLabel)}</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">Không có mentee nào khớp bộ lọc.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || exportCount === 0}
          className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Đang tạo file…" : visibleTicked.length > 0 ? `Xuất Excel ${visibleTicked.length} mentee đã chọn` : `Xuất Excel tất cả ${visible.length} mentee đang hiện`}
        </button>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{message.text}</p>
        ) : null}
      </div>
    </form>
  );
}
