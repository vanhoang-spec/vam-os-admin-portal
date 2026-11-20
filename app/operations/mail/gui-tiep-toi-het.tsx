"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AUTO_CONTINUE_END_WORDS,
  autoContinueStep,
  type AutoContinueStep
} from "@/lib/bulk-mail-core";
import { initialBulkMailActionState, type BulkMailActionState } from "@/lib/bulk-mail-action-types";
import { continueBulkSendAction } from "@/app/actions/bulk-mail";

function GuiTiepButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-semibold text-vam-ink transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang gửi…" : "Gửi tiếp"}
    </button>
  );
}

/**
 * Hai nút của một lô đang gửi dở: "Gửi tiếp" (một lần chạy) và "Gửi tiếp tới hết" (tự bấm lại).
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TỰ BẤM Ở TRÌNH DUYỆT, KHÔNG CHẠY NỀN TRÊN MÁY CHỦ
 * ---------------------------------------------------------------------------
 * Mỗi lần chạy vẫn là đúng một lệnh "Gửi tiếp" như bấm tay: cùng cổng quyền, cùng ngân sách thời
 * gian, cùng sổ thư để không ai nhận hai lá. Nút này chỉ bấm lại hộ, NỐI TIẾP — lần sau chỉ bắt đầu
 * khi lần trước đã trả lời — nên không bao giờ có hai lần chạy chồng lên nhau trên cùng một lô từ
 * tab này. Vì thế nút "Gửi tiếp" thường bị khoá trong lúc đang tự chạy. Đóng tab là dừng; phần còn
 * lại vẫn nằm trong lô.
 *
 * Khi nào dừng: xem `autoContinueStep` — chỉ đi tiếp khi lần vừa rồi chắc chắn tiến được.
 */
export function GuiTiepControls({
  batchId,
  continueAction
}: {
  batchId: string;
  continueAction: (formData: FormData) => void;
}) {
  const [running, setRunning] = useState(false);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [last, setLast] = useState<BulkMailActionState | null>(null);
  const [ended, setEnded] = useState<Exclude<AutoContinueStep, "continue"> | null>(null);
  const stopRequested = useRef(false);
  const busy = useRef(false);

  async function runToEnd() {
    // Chặn bấm đúp trước cả khi React kịp vẽ lại nút: hai vòng lặp song song là hai lần chạy chồng nhau.
    if (busy.current) return;
    busy.current = true;
    stopRequested.current = false;
    setRunning(true);
    setEnded(null);
    setLast(null);
    setProcessedTotal(0);

    let total = 0;
    try {
      for (let round = 0; ; round += 1) {
        const formData = new FormData();
        formData.set("batch_id", batchId);
        const result = await continueBulkSendAction(initialBulkMailActionState, formData);
        total += result.processed ?? 0;
        setProcessedTotal(total);
        setLast(result);

        const step = autoContinueStep({
          ok: result.ok,
          remaining: result.remaining,
          processed: result.processed,
          rateLimited: result.rateLimited,
          stopRequested: stopRequested.current,
          round
        });
        if (step !== "continue") {
          setEnded(step);
          break;
        }
      }
    } catch (error) {
      console.error("[GuiTiepControls]", error);
      setEnded("error");
      setLast({ ...initialBulkMailActionState, message: "Mất kết nối với máy chủ. Phần còn lại vẫn nằm trong lô." });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2" data-testid={`gui-tiep-${batchId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <form action={continueAction}>
          <input type="hidden" name="batch_id" value={batchId} />
          <GuiTiepButton disabled={running} />
        </form>
        {running ? (
          <button
            type="button"
            onClick={() => {
              stopRequested.current = true;
            }}
            className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Dừng
          </button>
        ) : (
          <button
            type="button"
            onClick={runToEnd}
            className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90"
          >
            Gửi tiếp tới hết
          </button>
        )}
      </div>
      {running || ended ? (
        <p role="status" className="max-w-md text-right text-xs text-slate-600" data-testid={`gui-tiep-trang-thai-${batchId}`}>
          {running
            ? `Đang tự gửi tiếp… đã xử lý ${processedTotal} thư${
                typeof last?.remaining === "number" ? `, còn ${last.remaining}` : ""
              }. Giữ tab này mở; bấm “Dừng” thì dừng sau lần chạy đang dở.`
            : `${ended ? AUTO_CONTINUE_END_WORDS[ended] : ""} Lượt này đã xử lý ${processedTotal} thư.${
                last?.message ? ` ${last.message}` : ""
              }`}
        </p>
      ) : null}
      {!running && last?.problems.length ? (
        <details className="max-w-md rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <summary className="cursor-pointer font-medium">{last.problems.length} người chưa nhận được thư (lần chạy cuối)</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {last.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
