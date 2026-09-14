"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import {
  cancelEventReminderAction,
  continueEventReminderAction,
  retryFailedEventReminderAction,
  startEventReminderAction
} from "@/app/actions/event-reminders";
import { maskVietnamDate, parseVietnamDateInput } from "@/lib/event-datetime";
import {
  REMINDER_CONFIRM_QUESTION,
  REMINDER_DATE_INVALID,
  REMINDER_DATE_MISMATCH,
  REMINDER_RUN_STATE_LABELS,
  describeReminderCounts,
  reminderMaxRounds,
  reminderRemaining,
  shouldContinueReminder,
  type ReminderProgress,
  type ReminderRunSummary
} from "@/lib/event-reminder-core";
import { formatDateTime } from "@/lib/utils";

type Phase = "idle" | "date" | "confirm" | "working";
type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

const NETWORK_ERROR =
  "Mất kết nối giữa chừng. Tải lại trang rồi bấm “Gửi tiếp” để gửi phần còn lại — không ai nhận hai lần.";

const NOTICE_CLASS: Record<"success" | "warning" | "error", string> = {
  success: "border-green-200 bg-green-50 text-green-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-700"
};

/**
 * "Gửi remind" cho đúng một buổi.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO PHẢI NHẬP LẠI NGÀY
 * ---------------------------------------------------------------------------
 * Một chuỗi có nhiều buổi cùng tên, trang của chúng trông giống hệt nhau, và cú
 * bấm này gửi thư tới hàng trăm người thật. Gõ lại ngày của buổi bắt người bấm
 * nhìn lại mình đang đứng ở buổi nào — một hộp "Bạn chắc chứ?" thì người ta bấm
 * Yes theo phản xạ. Máy chủ so lại ngày đó một lần nữa.
 *
 * ---------------------------------------------------------------------------
 * VÒNG GỬI TỰ ĐỘNG
 * ---------------------------------------------------------------------------
 * Bấm Yes là màn hình gọi máy chủ lặp lại, mỗi lần mười thư, tới khi hết. Mỗi
 * người trong danh sách có dòng kết quả riêng ở máy chủ, nên đóng tab giữa chừng
 * rồi bấm "Gửi tiếp" chỉ gửi phần còn lại.
 */
export function EventReminderPanel({
  eventId,
  sessionLabel,
  expectedDate,
  recipientCount,
  waitlistedCount,
  blockReason,
  canSend,
  latestRun,
  latestRunError
}: {
  eventId: string;
  sessionLabel: string;
  /** Ngày diễn ra theo giờ Việt Nam, `YYYY-MM-DD`. */
  expectedDate: string;
  recipientCount: number;
  waitlistedCount: number;
  blockReason: string | null;
  canSend: boolean;
  latestRun: ReminderRunSummary | null;
  latestRunError: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dateInput, setDateInput] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReminderProgress | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "date") dateRef.current?.focus();
  }, [phase]);

  const runIsOpen = latestRun?.status === "running";
  const latestRemaining = latestRun ? reminderRemaining(latestRun.counts) : 0;
  const startDisabledReason = !canSend
    ? "Bạn không có quyền vận hành trong mùa của sự kiện này."
    : blockReason
      ? blockReason
      : recipientCount === 0
        ? "Buổi này chưa có ai đang giữ chỗ để gửi remind."
        : runIsOpen
          ? "Buổi này đang có một lượt remind chưa gửi xong — gửi tiếp hoặc dừng lượt đó trước."
          : null;

  function closeDialog() {
    if (busyRef.current) return;
    setPhase("idle");
    setDateInput("");
    setDateError(null);
    setProgress(null);
  }

  function openDialog() {
    if (startDisabledReason || busyRef.current) return;
    setNotice(null);
    setDateInput("");
    setDateError(null);
    setProgress(null);
    setPhase("date");
  }

  function submitDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isoDate = parseVietnamDateInput(dateInput);
    if (!isoDate) {
      setDateError(REMINDER_DATE_INVALID);
      return;
    }
    if (isoDate !== expectedDate) {
      setDateError(REMINDER_DATE_MISMATCH);
      return;
    }
    setDateError(null);
    setPhase("confirm");
  }

  /** Gọi "gửi tiếp" lặp lại tới khi xong, gặp lỗi, hoặc một lần gọi không gửi được thư nào. */
  async function drive(runId: string, initial: ReminderProgress) {
    setProgress(initial);
    const rounds = reminderMaxRounds(initial.total ?? recipientCount);
    let finished = false;

    for (let round = 0; round < rounds; round += 1) {
      const next = await continueEventReminderAction({ runId });
      if (!next.ok) {
        setNotice({ tone: "error", text: next.message });
        finished = true;
        break;
      }
      setProgress(next);
      if (next.done) {
        setNotice({ tone: "success", text: next.message });
        finished = true;
        break;
      }
      if (!shouldContinueReminder(next)) {
        const allFailed = (next.chunk?.failed ?? 0) > 0 && (next.chunk?.sent ?? 0) === 0;
        setNotice({
          tone: "warning",
          text: allFailed
            ? "Các thư vừa rồi đều gửi lỗi nên hệ thống dừng lại, để không biến cả danh sách thành thư lỗi. Xem Nhật ký gửi, rồi bấm “Gửi lại cho người bị lỗi”."
            : next.message
        });
        finished = true;
        break;
      }
    }

    if (!finished) {
      setNotice({ tone: "warning", text: "Đã tạm dừng vòng gửi tự động. Bấm “Gửi tiếp” để gửi phần còn lại." });
    }
  }

  async function withBusy(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      busyRef.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  function confirmYes() {
    setPhase("working");
    setNotice(null);
    void withBusy(async () => {
      const started = await startEventReminderAction({ eventId, typedDate: dateInput });
      if (!started.ok || !started.runId) {
        setNotice({ tone: "error", text: started.message });
        return;
      }
      await drive(started.runId, started);
    });
  }

  function resumeLatest() {
    if (!latestRun) return;
    const run = latestRun;
    setNotice(null);
    setPhase("working");
    void withBusy(async () => {
      await drive(run.id, { ok: true, message: "", runId: run.id, counts: run.counts, total: run.total, done: false });
    });
  }

  function retryLatest() {
    if (!latestRun) return;
    const run = latestRun;
    if (!window.confirm(`Gửi lại thư remind cho ${run.counts.failed} người bị lỗi của lượt này?`)) return;
    setNotice(null);
    setPhase("working");
    void withBusy(async () => {
      const reopened = await retryFailedEventReminderAction({ runId: run.id });
      if (!reopened.ok) {
        setNotice({ tone: "error", text: reopened.message });
        return;
      }
      await drive(run.id, reopened);
    });
  }

  function cancelLatest() {
    if (!latestRun) return;
    const run = latestRun;
    if (!window.confirm("Dừng lượt remind này? Những người chưa được gửi sẽ không nhận thư.")) return;
    setNotice(null);
    void withBusy(async () => {
      const stopped = await cancelEventReminderAction({ runId: run.id });
      setNotice({ tone: stopped.ok ? "success" : "error", text: stopped.message });
    });
  }

  const shownCounts = progress?.counts ?? null;
  const shownTotal = progress?.total ?? 0;
  const percent = shownCounts && shownTotal
    ? Math.round(((shownCounts.sent + shownCounts.failed + shownCounts.skipped) / shownTotal) * 100)
    : 0;

  return (
    <section className="rounded-md border border-vam-line bg-white p-4" aria-label="Gửi remind">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-vam-ink">Gửi remind</h2>
          <p className="mt-1 text-sm text-slate-600">
            Gửi email nhắc lịch tới <strong className="tabular-nums">{recipientCount}</strong> người đang giữ chỗ của buổi
            này, kèm thông tin mới nhất (giờ, địa điểm, link họp, vé QR).
            {waitlistedCount > 0 ? ` Không gửi cho ${waitlistedCount} người trong danh sách chờ.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={openDialog}
          disabled={Boolean(startDisabledReason) || busy}
          title={startDisabledReason ?? undefined}
          className="inline-flex items-center gap-2 rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Gửi remind
        </button>
      </div>

      {startDisabledReason && !runIsOpen ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {startDisabledReason}
        </p>
      ) : null}

      {latestRunError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{latestRunError}</p>
      ) : null}

      {latestRun ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p>
            <span className="font-medium">Lần remind gần nhất:</span>{" "}
            <span className="tabular-nums">{formatDateTime(latestRun.createdAt)}</span>
            {latestRun.createdByName ? ` · ${latestRun.createdByName}` : ""} ·{" "}
            <span className="font-medium">{REMINDER_RUN_STATE_LABELS[latestRun.status]}</span> —{" "}
            <span className="tabular-nums">{describeReminderCounts(latestRun.counts, latestRun.total)}</span>
          </p>
          {(runIsOpen && latestRemaining > 0) || (latestRun.counts.failed > 0 && latestRun.status !== "cancelled") || runIsOpen ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {runIsOpen && latestRemaining > 0 ? (
                <button
                  type="button"
                  onClick={resumeLatest}
                  disabled={busy}
                  className="rounded-md bg-vam-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60"
                >
                  Gửi tiếp {latestRemaining} thư
                </button>
              ) : null}
              {latestRun.counts.failed > 0 && latestRun.status !== "cancelled" ? (
                <button
                  type="button"
                  onClick={retryLatest}
                  disabled={busy || Boolean(blockReason)}
                  className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-semibold text-vam-green hover:bg-vam-mint disabled:opacity-60"
                >
                  Gửi lại cho {latestRun.counts.failed} người bị lỗi
                </button>
              ) : null}
              {runIsOpen ? (
                <button
                  type="button"
                  onClick={cancelLatest}
                  disabled={busy}
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Dừng lượt này
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {notice && phase === "idle" ? (
        <p role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm ${NOTICE_CLASS[notice.tone]}`}>
          {notice.text}
        </p>
      ) : null}

      {phase !== "idle" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-reminder-title"
            className="w-full max-w-lg rounded-lg border border-vam-line bg-white p-5 shadow-xl"
          >
            <h3 id="event-reminder-title" className="text-base font-semibold text-vam-ink">
              Gửi remind
            </h3>
            <p className="mt-1 text-sm text-slate-600">{sessionLabel}</p>

            {phase === "date" ? (
              <form onSubmit={submitDate} className="mt-4 grid gap-3" noValidate>
                <label className="block">
                  <span className="text-sm font-medium text-vam-ink">
                    Nhập ngày diễn ra của buổi này để xác nhận <span className="text-red-600">*</span>
                  </span>
                  <input
                    ref={dateRef}
                    name="reminder_event_date"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="dd/mm/yyyy"
                    value={dateInput}
                    onChange={(event) => {
                      setDateInput(maskVietnamDate(event.target.value));
                      setDateError(null);
                    }}
                    aria-invalid={dateError ? true : undefined}
                    aria-describedby={dateError ? "event-reminder-date-error" : undefined}
                    className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm tabular-nums text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
                  />
                </label>
                {dateError ? (
                  <p id="event-reminder-date-error" role="alert" className="text-sm text-red-700">
                    {dateError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Huỷ
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
                  >
                    Tiếp tục
                  </button>
                </div>
              </form>
            ) : null}

            {phase === "confirm" ? (
              <div className="mt-4 grid gap-3">
                <p className="text-sm font-medium text-vam-ink">{REMINDER_CONFIRM_QUESTION}</p>
                <p className="text-sm text-slate-600">
                  Người nhận: <strong className="tabular-nums">{recipientCount}</strong> người đang giữ chỗ · Ngày buổi:{" "}
                  <span className="tabular-nums">{dateInput}</span>
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Không
                  </button>
                  <button
                    type="button"
                    onClick={confirmYes}
                    className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
                  >
                    Yes
                  </button>
                </div>
              </div>
            ) : null}

            {phase === "working" ? (
              <div className="mt-4 grid gap-3">
                {shownCounts ? (
                  <>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <div className="h-full bg-vam-green transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="text-sm tabular-nums text-vam-ink">{describeReminderCounts(shownCounts, shownTotal)}</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">Đang lập danh sách người nhận…</p>
                )}
                {busy ? (
                  <p className="text-xs text-slate-500">
                    Giữ trang này mở tới khi gửi xong. Lỡ đóng thì bấm “Gửi tiếp” — không ai nhận hai lần.
                  </p>
                ) : null}
                {notice ? (
                  <p role="status" className={`rounded-md border px-3 py-2 text-sm ${NOTICE_CLASS[notice.tone]}`}>
                    {notice.text}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={busy}
                    className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Đang gửi…" : "Đóng"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
