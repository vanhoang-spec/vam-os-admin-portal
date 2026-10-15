"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import type { MenteeCard } from "@/lib/matching-round2-link-core";
import { availableMenteesAction, menteeDetailAction, swapWindowAction, windowCardsAction } from "./actions";
import { PickButton } from "./pick-forms";
import { PickReport, type PickReportMessage } from "./pick-report";

type WindowView = { cards: MenteeCard[]; viewedIds: string[]; canSwap: boolean };

/**
 * Danh sách mentee trên trang chọn (BTC 14/10/2026).
 *
 * "Thời gian thực" bằng một lệnh đọc nhẹ mỗi 20 giây (chỉ mã đơn còn trống, vài KB) thay vì tải
 * lại cả trang: hàng trăm mentor mở trang cùng lúc lúc vòng mở, mỗi lần tải lại cả trang của nhóm
 * đông nhất là cả trăm KB từ database. Database vẫn là nơi phân xử người bấm trước — danh sách
 * trên trang chỉ để mentor đỡ chọn trúng bạn đã có người chọn.
 */
export const POLL_MS = 20_000;

function Detail({ token, applicationId, onViewed }: { token: string; applicationId: string; onViewed: (applicationId: string) => void }) {
  const [state, setState] = useState<
    { kind: "closed" } | { kind: "loading" } | { kind: "open"; texts: Array<[string, string]> } | { kind: "error"; message: string }
  >({ kind: "closed" });
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const result = await menteeDetailAction(token, applicationId);
      setState(result.ok ? { kind: "open", texts: result.texts } : { kind: "error", message: result.message });
      // Chỉ đếm lượt máy chủ đã ghi được: nút "Đổi 15 hồ sơ khác" hiện theo số đếm này, và máy chủ
      // kiểm lại đúng những lượt đã ghi.
      if (result.ok && result.viewed) onViewed(applicationId);
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

function MenteeCardView({
  card,
  token,
  viewed,
  onViewed
}: {
  card: MenteeCard;
  token: string;
  viewed: boolean;
  onViewed: (applicationId: string) => void;
}) {
  return (
    <Card>
      <article data-testid="mentee-card" data-application={card.applicationId} className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-vam-ink">{card.name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {viewed ? (
              <span data-testid="viewed-badge" className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Đã xem chi tiết
              </span>
            ) : null}
            {card.groupLabel ? (
              <span data-testid="mentee-group" className="rounded-full bg-vam-mint px-2 py-0.5 text-[11px] font-semibold text-vam-green">
                {card.groupLabel}
              </span>
            ) : null}
          </div>
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
        <Detail token={token} applicationId={card.applicationId} onViewed={onViewed} />
        <PickButton token={token} applicationId={card.applicationId} menteeName={card.name} />
      </article>
    </Card>
  );
}

export function MenteeList({
  token,
  cards: serverCards,
  groups,
  closesAt,
  windowSize,
  viewedIds: serverViewed,
  canSwap: serverCanSwap,
  pollMs = POLL_MS
}: {
  token: string;
  cards: MenteeCard[];
  groups: Array<{ code: number; label: string }>;
  closesAt: string | null;
  /** Số hồ sơ tối đa của một mentor (máy chủ gửi xuống — ROUND2_WINDOW_SIZE). */
  windowSize: number;
  /** Hồ sơ mentor đã mở "Xem đầy đủ hồ sơ" (máy chủ đã ghi) — BTC 15/10/2026. */
  viewedIds: string[];
  /** Còn bạn trống ngoài danh sách để "Đổi 15 hồ sơ khác". */
  canSwap: boolean;
  pollMs?: number;
}) {
  // Danh sách 15 hồ sơ của mentor (BTC 14/10/2026). Trang làm mới sau một lượt chọn thì theo danh
  // sách máy chủ gửi; giữa hai lần đó, hồ sơ bù đến từ windowCardsAction, danh sách mới từ lệnh đổi.
  const [cards, setCards] = useState(serverCards);
  const cardsRef = useRef(serverCards);
  const [available, setAvailable] = useState<Set<string> | null>(null);
  const [replaced, setReplaced] = useState(0);
  const [filter, setFilter] = useState<number | null>(null);
  const [report, setReport] = useState<PickReportMessage | null>(null);
  const [closed, setClosed] = useState(false);
  const [viewed, setViewed] = useState(() => new Set(serverViewed));
  const [swappable, setSwappable] = useState(serverCanSwap);
  const [swapping, setSwapping] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    cardsRef.current = serverCards;
    setCards(serverCards);
    setAvailable(null);
    setViewed(new Set(serverViewed));
    setSwappable(serverCanSwap);
  }, [serverCards, serverViewed, serverCanSwap]);

  const markViewed = useCallback((applicationId: string) => {
    setViewed((prev) => (prev.has(applicationId) ? prev : new Set(prev).add(applicationId)));
  }, []);

  const applyView = useCallback((view: WindowView) => {
    cardsRef.current = view.cards;
    setCards(view.cards);
    setViewed(new Set(view.viewedIds));
    setSwappable(view.canSwap);
  }, []);

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
      if (!result.ok) return;
      const ids = new Set(result.ids);
      setAvailable(ids);
      const current = cardsRef.current;
      const gone = current.filter((card) => !ids.has(card.applicationId)).length;
      const shown = new Set(current.map((card) => card.applicationId));
      // Danh sách chưa đủ 15 mà có bạn mới trống (vd. một bạn vừa được bỏ chọn) thì cũng bù.
      const canGrow = current.length < windowSize && result.ids.some((id) => !shown.has(id));
      if (gone === 0 && !canGrow) return;
      const next = await windowCardsAction(token);
      if (!next.ok) return;
      applyView(next);
      if (gone > 0) setReplaced(gone);
    } catch {
      // như trên
    } finally {
      busy.current = false;
    }
  }, [token, closesAt, windowSize, applyView]);

  // "Đổi 15 hồ sơ khác" (BTC 15/10/2026). Dùng chung cờ bận với lệnh tự cập nhật: danh sách bù về
  // giữa chừng không được đè lên danh sách vừa đổi.
  const swap = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSwapping(true);
    try {
      const result = await swapWindowAction(token);
      if (result.view) {
        applyView(result.view);
        setAvailable(null);
        setReplaced(0);
        setFilter(null);
      }
      setReport({ status: result.ok ? "ok" : "error", message: result.message });
      if (result.ok) document.getElementById("danh-sach-ho-so")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } catch {
      setReport({ status: "error", message: "Chưa đổi được danh sách. Anh/Chị thử lại sau ít phút." });
    } finally {
      busy.current = false;
      setSwapping(false);
    }
  }, [token, applyView]);

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
          Vòng 2 đã đóng. Anh/Chị tải lại trang để xem mentee đã chọn. Ban tổ chức sẽ liên hệ Anh/Chị cho các bước tiếp theo.
        </p>
      </Card>
    );
  }

  const open = cards.filter((card) => !available || available.has(card.applicationId));
  const gone = cards.length - open.length;
  const shown = open.filter((card) => filter === null || card.groupCode === filter);
  // Nút lọc: các nhóm của cụm, cộng nhóm của thẻ bù sang (BTC 15/10/2026) — hiện khi có hơn một nhóm.
  const filterGroups = Array.from(
    new Map([
      ...groups.map((g) => [g.code, g.label] as const),
      ...cards.filter((card) => card.groupCode !== null).map((card) => [card.groupCode as number, card.groupLabel ?? String(card.groupCode)] as const)
    ]).entries()
  )
    .sort((a, b) => a[0] - b[0])
    .map(([code, label]) => ({ code, label }));
  // Đếm trên các thẻ đang hiện (bạn vừa bị chọn mất đã ẩn), không theo nút lọc: phải xem hết cả danh sách.
  const viewedCount = open.filter((card) => viewed.has(card.applicationId)).length;
  const allViewed = open.length > 0 && viewedCount === open.length;

  return (
    <PickReport.Provider value={setReport}>
      <div id="danh-sach-ho-so" />
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
      ) : replaced > 0 ? (
        <p data-testid="gone-note" className="text-sm text-amber-700">
          {replaced} bạn vừa được mentor khác chọn — đã thay bằng hồ sơ khác.
        </p>
      ) : null}
      {filterGroups.length > 1 ? (
        <div role="group" aria-label="Lọc theo nhóm ngành" className="flex flex-wrap gap-2" data-testid="group-filter">
          {[{ code: null as number | null, label: "Tất cả" }, ...filterGroups].map((g) => {
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
        shown.map((card) => (
          <MenteeCardView key={card.applicationId} card={card} token={token} viewed={viewed.has(card.applicationId)} onViewed={markViewed} />
        ))
      )}
      {open.length > 0 ? (
        <Card>
          <div data-testid="swap-panel" className="grid gap-2 text-sm text-vam-ink">
            {!swappable ? (
              <p data-testid="swap-none">Anh/Chị đang thấy toàn bộ hồ sơ còn trống — không còn hồ sơ khác để đổi.</p>
            ) : allViewed ? (
              <>
                <p data-testid="swap-ready">
                  Anh/Chị đã xem chi tiết hết {open.length} hồ sơ. Chưa thấy bạn phù hợp thì đổi sang các bạn còn trống khác — danh sách
                  hiện tại sẽ được thay.
                </p>
                <button
                  type="button"
                  data-testid="swap-button"
                  onClick={() => void swap()}
                  disabled={swapping}
                  className="self-start rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {swapping ? "Đang đổi…" : `Đổi ${windowSize} hồ sơ khác`}
                </button>
              </>
            ) : (
              <p data-testid="swap-progress">
                Đã xem chi tiết <strong>{viewedCount}/{open.length}</strong> hồ sơ. Bấm &quot;Xem đầy đủ hồ sơ&quot; ở tất cả hồ sơ trong danh
                sách thì Anh/Chị đổi được sang {windowSize} hồ sơ khác.
              </p>
            )}
          </div>
        </Card>
      ) : null}
    </PickReport.Provider>
  );
}
