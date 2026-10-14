"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import type { MenteeCard } from "@/lib/matching-round2-link-core";
import { availableMenteesAction, menteeDetailAction } from "./actions";
import { PickButton } from "./pick-forms";
import { PickReport, type PickReportMessage } from "./pick-report";

/**
 * Danh sách mentee trên trang chọn (BTC 14/10/2026).
 *
 * "Thời gian thực" bằng một lệnh đọc nhẹ mỗi 20 giây (chỉ mã đơn còn trống, vài KB) thay vì tải
 * lại cả trang: hàng trăm mentor mở trang cùng lúc lúc vòng mở, mỗi lần tải lại cả trang của nhóm
 * đông nhất là cả trăm KB từ database. Database vẫn là nơi phân xử người bấm trước — danh sách
 * trên trang chỉ để mentor đỡ chọn trúng bạn đã có người chọn.
 */
export const POLL_MS = 20_000;

function Detail({ token, applicationId }: { token: string; applicationId: string }) {
  const [state, setState] = useState<
    { kind: "closed" } | { kind: "loading" } | { kind: "open"; texts: Array<[string, string]> } | { kind: "error"; message: string }
  >({ kind: "closed" });
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const result = await menteeDetailAction(token, applicationId);
      setState(result.ok ? { kind: "open", texts: result.texts } : { kind: "error", message: result.message });
    } catch {
      setState({ kind: "error", message: "Chưa tải được hồ sơ. Anh/chị thử lại sau ít phút." });
    }
  };
  if (state.kind === "open") {
    return (
      <div className="grid gap-3" data-testid="mentee-detail">
        {state.texts.length ? (
          state.texts.map(([label, value]) => (
            <div key={label} className="text-sm">
              <div className="font-medium text-slate-600">{label}</div>
              <p className="whitespace-pre-line text-vam-ink">{value}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">Bạn này không trả lời thêm câu tự luận nào.</p>
        )}
        <button type="button" onClick={() => setState({ kind: "closed" })} className="self-start text-sm text-slate-600 underline">
          Thu gọn
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={load}
        disabled={state.kind === "loading"}
        className="self-start text-sm font-medium text-vam-green underline disabled:opacity-60"
      >
        {state.kind === "loading" ? "Đang tải…" : "Xem đầy đủ hồ sơ"}
      </button>
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function MenteeCardView({ card, token }: { card: MenteeCard; token: string }) {
  return (
    <Card>
      <article data-testid="mentee-card" data-application={card.applicationId} className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-vam-ink">{card.name}</h2>
          {card.groupLabel ? (
            <span data-testid="mentee-group" className="rounded-full bg-vam-mint px-2 py-0.5 text-[11px] font-semibold text-vam-green">
              {card.groupLabel}
            </span>
          ) : null}
        </div>
        {card.facts.length ? (
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            {card.facts.map(([label, value]) => (
              <div key={label}>
                <dt className="inline text-slate-500">{label}: </dt>
                <dd className="inline text-vam-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {card.cv ? (
          <p className="break-words text-sm">
            <span className="text-slate-500">CV / hồ sơ: </span>
            {card.cv.map((part, index) =>
              part.kind === "link" ? (
                <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all text-vam-green underline">
                  {part.value}{" "}
                </a>
              ) : (
                <span key={index}>{part.value} </span>
              )
            )}
          </p>
        ) : null}
        {card.texts.map(([label, value]) => (
          <div key={label} className="text-sm">
            <div className="font-medium text-slate-600">{label}</div>
            <p className="whitespace-pre-line text-vam-ink">{value}</p>
          </div>
        ))}
        <Detail token={token} applicationId={card.applicationId} />
        <PickButton token={token} applicationId={card.applicationId} menteeName={card.name} />
      </article>
    </Card>
  );
}

export function MenteeList({
  token,
  cards,
  groups,
  closesAt,
  pollMs = POLL_MS
}: {
  token: string;
  cards: MenteeCard[];
  groups: Array<{ code: number; label: string }>;
  closesAt: string | null;
  pollMs?: number;
}) {
  const [available, setAvailable] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [report, setReport] = useState<PickReportMessage | null>(null);
  const [closed, setClosed] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    const closes = closesAt ? Date.parse(closesAt) : NaN;
    if (Number.isFinite(closes) && Date.now() >= closes) {
      setClosed(true);
      return;
    }
    busy.current = true;
    try {
      const result = await availableMenteesAction(token);
      // Không đọc được thì giữ nguyên danh sách: ẩn nhầm cả danh sách còn tệ hơn để thừa một thẻ.
      if (result.ok) setAvailable(new Set(result.ids));
    } catch {
      // như trên
    } finally {
      busy.current = false;
    }
  }, [token, closesAt]);

  useEffect(() => {
    if (closed) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, pollMs);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs, closed]);

  if (closed) {
    return (
      <Card>
        <p className="text-sm text-vam-ink" data-testid="round-closed">
          Vòng 2 đã đóng. Anh/chị tải lại trang để xem mentee đã chọn; ban tổ chức sẽ liên hệ về bước tiếp theo.
        </p>
      </Card>
    );
  }

  const open = cards.filter((card) => !available || available.has(card.applicationId));
  const gone = cards.length - open.length;
  const shown = open.filter((card) => filter === null || card.groupCode === filter);

  return (
    <PickReport.Provider value={setReport}>
      {report ? (
        <div
          role="status"
          data-testid="pick-report"
          className={`sticky top-2 z-10 rounded-md border px-3 py-2 text-sm shadow-sm ${
            report.status === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {report.message}
        </div>
      ) : null}
      {gone > 0 ? (
        <p data-testid="gone-note" className="text-sm text-amber-700">
          {gone} bạn vừa được mentor khác chọn và đã ẩn khỏi danh sách.
        </p>
      ) : null}
      {groups.length > 1 ? (
        <div role="group" aria-label="Lọc theo nhóm ngành" className="flex flex-wrap gap-2" data-testid="group-filter">
          {[{ code: null as number | null, label: "Tất cả" }, ...groups].map((g) => {
            const count = g.code === null ? open.length : open.filter((card) => card.groupCode === g.code).length;
            const active = filter === g.code;
            return (
              <button
                key={String(g.code)}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(g.code)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  active ? "border-vam-green bg-vam-green text-white" : "border-vam-line bg-white text-slate-700"
                }`}
              >
                {g.label} ({count})
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">Hiện chưa còn mentee nào trong danh sách của anh/chị. Ban tổ chức sẽ báo khi có thêm hồ sơ.</p>
        </Card>
      ) : (
        shown.map((card) => <MenteeCardView key={card.applicationId} card={card} token={token} />)
      )}
    </PickReport.Provider>
  );
}
