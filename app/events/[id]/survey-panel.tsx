"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import {
  createEventSurveyLinkAction,
  dispatchEventSurveyAction,
  sendEventSurveyAction,
  setEventSurveySendAtAction
} from "@/app/actions/event-survey";
import { VietnamDateTimeField } from "@/app/events/vietnam-datetime-field";
import { parseVietnamDateTime } from "@/lib/event-datetime";
import {
  SURVEY_AUDIENCE_LABELS,
  describeSurveyCounts,
  shouldContinueSurvey,
  surveyAutoSendDue,
  surveyMaxRounds,
  surveyRemaining,
  surveyTotal,
  type SurveyAudience,
  type SurveyCounts,
  type SurveySendResult
} from "@/lib/event-survey-core";
import { formatDateTime } from "@/lib/utils";

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

const NOTICE_CLASS: Record<"success" | "warning" | "error", string> = {
  success: "border-green-200 bg-green-50 text-green-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-700"
};

const NETWORK_ERROR = "Mất kết nối giữa chừng. Tải lại trang rồi bấm gửi tiếp — không ai nhận hai lần.";

/** Bao lâu kiểm "đã tới giờ tự gửi chưa" một lần. */
const AUTO_TICK_MS = 20_000;

/**
 * Khảo sát cuối buổi: link, mã QR, và thư gửi cho người đã check in.
 *
 * ---------------------------------------------------------------------------
 * "TỰ GỬI" CẦN MỘT TAB ĐANG MỞ — VÀ MÀN HÌNH NÓI THẲNG ĐIỀU ĐÓ
 * ---------------------------------------------------------------------------
 * Hệ thống không có bộ hẹn giờ chạy nền. Tới giờ đã đặt, chính tab này gọi máy
 * chủ gửi thư. Ban tổ chức cần biết điều kiện đó trước khi dựa vào nó, nên nó
 * được viết ngay dưới ô giờ chứ không giấu trong tài liệu: một dòng chữ thừa thì
 * chỉ tốn chỗ, còn một lượt gửi không xảy ra thì mất cả buổi khảo sát.
 */
export function EventSurveyPanel({
  eventId,
  canOperate,
  url,
  qrDataUrl,
  sendAt,
  counts,
  eligibleCheckedIn,
  eligibleAll,
  responses,
  completed,
  checkedIn,
  blockReason
}: {
  eventId: string;
  canOperate: boolean;
  url: string | null;
  qrDataUrl: string | null;
  sendAt: string | null;
  counts: SurveyCounts;
  eligibleCheckedIn: number;
  eligibleAll: number;
  responses: number;
  completed: number;
  checkedIn: number;
  blockReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [progress, setProgress] = useState<SurveySendResult | null>(null);
  const [audience, setAudience] = useState<SurveyAudience>("checked_in");
  const busyRef = useRef(false);

  const queuedTotal = surveyTotal(counts);
  const remaining = surveyRemaining(counts);

  const setWorking = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  /**
   * Gọi lặp lại tới khi hết hàng đợi.
   *
   * Trần số vòng để một lỗi lặp không biến thành vòng quay vô tận; mỗi vòng gửi
   * tối đa mười thư, và dừng ngay khi một lần gọi không gửi được thư nào.
   */
  const runUntilDone = useCallback(
    async (first: SurveySendResult, call: () => Promise<SurveySendResult>) => {
      let result = first;
      const rounds = surveyMaxRounds(surveyTotal(result.counts ?? counts));
      for (let round = 0; round < rounds && shouldContinueSurvey(result); round += 1) {
        result = await call();
        setProgress(result);
      }
      return result;
    },
    [counts]
  );

  async function send(target: SurveyAudience) {
    if (busyRef.current || !canOperate) return;
    setWorking(true);
    setNotice(null);
    try {
      const call = () => sendEventSurveyAction({ eventId, audience: target });
      const first = await call();
      setProgress(first);
      const last = await runUntilDone(first, call);
      setNotice({ tone: last.ok ? "success" : "error", text: last.message });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setWorking(false);
    }
  }

  function confirmAndSend() {
    const label = SURVEY_AUDIENCE_LABELS[audience];
    const count = audience === "checked_in" ? eligibleCheckedIn : eligibleAll;
    const extra =
      audience === "all_registered"
        ? "\n\nLƯU Ý: nhóm này RỘNG HƠN quy tắc gốc (chỉ gửi cho người đã check in). Thư sẽ tới cả những người không dự."
        : "";
    if (!window.confirm(`Gửi thư khảo sát tới ${count} người — ${label}?${extra}`)) return;
    void send(audience);
  }

  /**
   * Vòng tự gửi.
   *
   * Máy chủ mới là nơi quyết định đã tới giờ hay chưa; phép so ở đây chỉ để không
   * gọi máy chủ mỗi hai mươi giây suốt cả ngày cho một buổi chưa tới lượt.
   */
  useEffect(() => {
    if (!canOperate || !sendAt || !url) return;

    let stopped = false;

    async function tick() {
      if (stopped || busyRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!surveyAutoSendDue(sendAt, Date.now())) return;

      setWorking(true);
      try {
        const call = async () => {
          const { due: _due, ...rest } = await dispatchEventSurveyAction(eventId);
          return rest as SurveySendResult;
        };
        const first = await call();
        if (stopped) return;
        setProgress(first);
        const last = await runUntilDone(first, call);
        if (last.chunk && last.chunk.sent > 0) {
          setNotice({ tone: "success", text: `Tự gửi: ${last.message}` });
          router.refresh();
        }
      } catch {
        // Im lặng: vòng này chạy nền, và một lần mất mạng không nên hiện lên một
        // thông báo đỏ giữa lúc ban tổ chức đang quét mã.
      } finally {
        setWorking(false);
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), AUTO_TICK_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [canOperate, sendAt, url, eventId, router, runUntilDone]);

  async function createLink() {
    if (busyRef.current || !canOperate) return;
    setWorking(true);
    setNotice(null);
    try {
      const result = await createEventSurveyLinkAction(eventId);
      setNotice({ tone: result.ok ? "success" : "error", text: result.message });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setWorking(false);
    }
  }

  async function saveSendAt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !canOperate) return;
    const raw = String(new FormData(event.currentTarget).get("survey_send_at") ?? "").trim();
    const iso = raw ? parseVietnamDateTime(raw) : null;
    if (raw && !iso) {
      setNotice({ tone: "error", text: "Giờ tự gửi chưa hợp lệ. Nhập theo dạng dd/mm/yyyy và hh:mm." });
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      const result = await setEventSurveySendAtAction({ eventId, sendAtIso: iso });
      setNotice({ tone: result.ok ? "success" : "error", text: result.message });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setWorking(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", text: "Đã chép link khảo sát." });
    } catch {
      setNotice({ tone: "warning", text: "Trình duyệt không cho chép tự động. Bôi đen link rồi chép tay." });
    }
  }

  return (
    <section className="rounded-lg border border-vam-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="h-5 w-5 text-vam-green" aria-hidden />
        <h2 className="text-base font-semibold text-vam-ink">Khảo sát cuối buổi (check out)</h2>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Người tham dự điền 2 câu hỏi; bấm gửi là hệ thống ghi luôn lượt <strong>check out</strong> cho họ, đối chiếu
        bằng email và số điện thoại với lượt check in đầu buổi.
      </p>

      {notice ? (
        <p className={`mt-3 rounded-md border px-3 py-2 text-sm ${NOTICE_CLASS[notice.tone]}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full border border-vam-line bg-white px-3 py-1">
          Đã check in: <strong className="tabular-nums text-vam-green">{checkedIn}</strong>
        </span>
        <span className="rounded-full border border-vam-line bg-white px-3 py-1">
          Phiếu đã nhận: <strong className="tabular-nums text-vam-green">{responses}</strong>
        </span>
        <span className="rounded-full border border-vam-line bg-white px-3 py-1">
          Đủ check in + check out: <strong className="tabular-nums text-vam-green">{completed}</strong>
        </span>
        {queuedTotal ? (
          <span className="rounded-full border border-vam-line bg-white px-3 py-1">
            Thư: <strong className="tabular-nums text-vam-green">{describeSurveyCounts(counts, queuedTotal)}</strong>
          </span>
        ) : null}
      </div>

      {progress ? <p className="mt-2 text-sm text-slate-600">{progress.message}</p> : null}

      {!url ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void createLink()}
            disabled={!canOperate || busy}
            className="inline-flex items-center justify-center rounded-md bg-vam-green px-3 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60"
          >
            Tạo link khảo sát
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Link này mở ra mã QR để chiếu hoặc in, và là đường dẫn nằm trong thư gửi cuối buổi.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Link phiếu khảo sát</p>
              <p className="mt-1 break-all rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-vam-ink">
                {url}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-ink hover:bg-slate-50"
                >
                  Chép link
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
                >
                  Mở thử phiếu
                </a>
                <a
                  href={`/events/${eventId}/survey`}
                  className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
                >
                  Xem câu trả lời ({responses})
                </a>
              </div>
            </div>

            <div className="grid gap-2 rounded-md border border-vam-line bg-slate-50 p-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Gửi thư khảo sát cho</span>
                <select
                  value={audience}
                  onChange={(event) => setAudience(event.target.value as SurveyAudience)}
                  className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink"
                >
                  <option value="checked_in">
                    {SURVEY_AUDIENCE_LABELS.checked_in} ({eligibleCheckedIn})
                  </option>
                  <option value="all_registered">
                    {SURVEY_AUDIENCE_LABELS.all_registered} ({eligibleAll})
                  </option>
                </select>
              </label>
              <button
                type="button"
                onClick={confirmAndSend}
                disabled={!canOperate || busy || Boolean(blockReason)}
                className="inline-flex w-fit items-center justify-center rounded-md bg-vam-green px-3 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60"
              >
                {busy ? "Đang gửi..." : remaining ? "Gửi tiếp" : "Gửi khảo sát ngay"}
              </button>
              {blockReason ? <p className="text-xs text-amber-800">{blockReason}</p> : null}
              {!blockReason && audience === "checked_in" && eligibleCheckedIn === 0 ? (
                <p className="text-xs text-amber-800">
                  Chưa ai được quét check in, nên chưa có ai để gửi. Buổi trực tuyến thường không quét mã — khi đó
                  chọn “{SURVEY_AUDIENCE_LABELS.all_registered}”.
                </p>
              ) : null}
            </div>

            <form onSubmit={saveSendAt} className="grid gap-2 rounded-md border border-vam-line bg-slate-50 p-3">
              <VietnamDateTimeField
                name="survey_send_at"
                label="Giờ tự gửi thư khảo sát"
                defaultValue={sendAt}
                helper="Để trống rồi bấm Lưu là tắt tự gửi."
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={!canOperate || busy}
                  className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-ink hover:bg-slate-50 disabled:opacity-60"
                >
                  Lưu giờ tự gửi
                </button>
                {sendAt ? (
                  <span className="text-xs text-slate-600">Đang đặt: {formatDateTime(sendAt)}</span>
                ) : (
                  <span className="text-xs text-slate-500">Chưa đặt — chỉ gửi khi bấm tay.</span>
                )}
              </div>
              <p className="text-xs text-amber-800">
                Tự gửi chạy từ chính trang này: tới giờ, một tab trang sự kiện đang mở sẽ gửi thư. Cứ để máy của bạn
                mở trang này trong buổi; nếu không có tab nào mở, hãy bấm “Gửi khảo sát ngay”.
              </p>
            </form>
          </div>

          {qrDataUrl ? (
            <div className="justify-self-start text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Mã QR mở phiếu khảo sát"
                className="h-44 w-44 rounded-md border border-vam-line bg-white p-2"
              />
              <p className="mt-1 text-xs text-slate-500">Chiếu lên màn hình hoặc in ra cho người tham dự quét.</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
